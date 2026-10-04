import { ASTNode, ProgramNode, ExpressionNode, ProcedureNode, PrototypeNode, ParameterNode, DataTypeNode } from './types';
import { Runtime } from './runtime';
import { ExecutionContext, MockCase, emptyContext } from './context';
import { coerce, defaultValue, describeValue, formatChar } from './datatypes';
import { DateTimeValue, FigurativeValue, RpgDuration, addDuration, compareDateTime, fromClock, isDateTime, isDateTimeType, isDuration, kindOf, parseIso, resolveFigurative } from './datetime';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { ProgramResolver } from './sources';
import { RpgError, STATUS_CALL_FAILED, STATUS_CALL_NOT_FOUND, STATUS_DATE_OVERFLOW, STATUS_DIVIDE_BY_ZERO, incompatibleTypes, matchesStatus } from './errors';

// Signaux de contrôle : levés comme exceptions pour traverser les blocs imbriqués
// jusqu'à la boucle (LEAVE/ITER) ou la procédure / le programme (RETURN) concerné.
class LeaveSignal {}
class IterSignal {}
class ReturnSignal {
  constructor(public value?: any) {}
}

export interface InterpreterOptions {
  // Nombre total d'itérations de boucle autorisées avant d'arrêter l'exécution
  maxIterations?: number;
  // Nombre maximal d'appels de procédure imbriqués (protège des récursions infinies)
  maxCallDepth?: number;
  // Source des programmes appelés par EXTPGM sans bouchon
  resolveProgram?: ProgramResolver;
  // Horloge de *SYS, *JOB, %DATE()... ; les tests la figent
  clock?: () => Date;
}

const DEFAULT_MAX_ITERATIONS = 1_000_000;

// Deux chaînes de longueurs différentes se comparent comme si la plus courte
// était complétée par des blancs : 'Dupont    ' = 'Dupont'
function compare(left: any, right: any): number {
  if (typeof left === 'string' && typeof right === 'string') {
    const length = Math.max(left.length, right.length);
    left = left.padEnd(length, ' ');
    right = right.padEnd(length, ' ');
  }
  if (left === right) return 0;
  return left < right ? -1 : left > right ? 1 : NaN;
}

const COMPARISONS: { [op: string]: (c: number) => boolean } = {
  '=': c => c === 0, '<>': c => c !== 0, '<': c => c < 0, '<=': c => c <= 0, '>': c => c > 0, '>=': c => c >= 0,
};

const involvesDateTime = (value: any) => isDateTime(value) || isDuration(value) || value instanceof FigurativeValue;

// Avec une date, une heure ou un timestamp : comparaison au même type, ou + / - d'une durée à droite.
// *LOVAL / *HIVAL prennent le type de l'autre opérande.
function dateTimeOperation(op: string, left: any, right: any): any {
  if ((op === '+' || op === '-') && isDateTime(left) && isDuration(right)) {
    return applyDuration(left, right, op === '+' ? 1 : -1);
  }
  if (op === '+' && isDuration(left) && isDateTime(right)) {
    throw new Error(`Durée à gauche d'une date (${left} + ${describeValue(right)}) : pas encore supporté par l'interpréteur`);
  }
  const test = COMPARISONS[op];
  if (left instanceof FigurativeValue && kindOf(right)) left = resolveFigurative(left, kindOf(right)!);
  if (right instanceof FigurativeValue && kindOf(left)) right = resolveFigurative(right, kindOf(left)!);
  if (test && kindOf(left) !== undefined && kindOf(left) === kindOf(right)) {
    return test(compareDateTime(left, right));
  }
  const operands = right === undefined ? describeValue(left) : `${describeValue(left)} et ${describeValue(right)}`;
  throw incompatibleTypes(`Opération ${op.toUpperCase()} avec ${operands}`);
}

// Traduit un échec du calcul en erreur RPG
function applyDuration(value: DateTimeValue, duration: RpgDuration, sign: 1 | -1): DateTimeValue {
  const result = addDuration(value, duration, sign);
  if (typeof result !== 'string') return result;
  const what = `${describeValue(value)} ${sign > 0 ? '+' : '-'} ${duration}`;
  switch (result) {
    case 'unit': throw incompatibleTypes(what);
    case 'overflow': throw new RpgError(STATUS_DATE_OVERFLOW, `Résultat hors limites pour ${what} (RNX0113)`);
    case 'wrap': throw new Error(`${what} passe minuit : pas encore supporté par l'interpréteur`);
    case '24h': throw new Error(`Calcul sur la valeur 24.00.00 (${what}) : pas encore supporté par l'interpréteur`);
  }
  throw new Error(`Cas imprévu : ${result}`);
}

// Un bouchon JSON donne les dates, heures et timestamps en texte *ISO
function fromMock(value: any, type: DataTypeNode | undefined, what: string): any {
  if (!type || !isDateTimeType(type.typeName) || value === undefined || value === null || isDateTime(value)) return value;
  if (typeof value !== 'string') {
    throw new Error(`${what} : la valeur ${type.typeName.toUpperCase()} doit être un texte *ISO, reçu ${value}`);
  }
  const parsed = parseIso(type.typeName, value);
  if (!parsed) throw new Error(`${what} : '${value}' n'est pas une valeur ${type.typeName.toUpperCase()} *ISO valide`);
  return parsed;
}

// Fonctions intégrées qui acceptent une date, une heure ou un timestamp
const DATE_AWARE_BUILTINS = new Set(['%date', '%time', '%timestamp', '%len']);
// Acceptées sur IBM i (ou doute) mais pas encore implémentées pour les dates
const NOT_YET_DATE_BUILTINS = new Set(['%dec', '%int', '%max', '%min']);

const DEFAULT_MAX_CALL_DEPTH = 256;

export class Interpreter {
  private runtime: Runtime;
  private maxIterations: number;
  private maxCallDepth: number;
  private iterations = 0;
  private procedures = new Map<string, ProcedureNode>();
  private prototypes = new Map<string, PrototypeNode>();
  private context: ExecutionContext;
  private options: InterpreterOptions;
  private programDepth = 0; // Niveau d'imbrication des appels de programmes source

  constructor(context?: ExecutionContext, options: InterpreterOptions = {}) {
    this.context = context ?? emptyContext();
    this.options = options;
    this.runtime = new Runtime(this.context, options.clock);
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
  }

  execute(ast: ProgramNode): string[] {
    const parameters = ast.parameters ?? [];
    if (parameters.length > 0) {
      throw new Error(`Ce programme attend des paramètres d'entrée (${parameters.map(p => p.name).join(', ')}) : `
        + `exécutez le programme qui l'appelle`);
    }
    this.runProgram(ast, []);
    return this.runtime.getOutput();
  }

  // Exécute un programme avec ses paramètres d'entrée ; renvoie leurs valeurs finales
  private runProgram(ast: ProgramNode, args: any[]): any[] {
    this.runtime.reset();
    this.runtime.clearOutput();
    this.iterations = 0;
    this.procedures.clear();
    this.prototypes.clear();

    // Déclarer SQLCOD et SQLSTT par défaut
    this.runtime.declareVariable('SQLCOD', 0, { type: 'DataType', typeName: 'int', length: 10 });
    this.runtime.declareVariable('SQLSTT', '00000', { type: 'DataType', typeName: 'char', length: 5 });

    // Indicateurs *INLR et *IN01 à *IN99
    const ind = { type: 'DataType' as const, typeName: 'ind' };
    this.runtime.declareVariable('*inlr', false, ind);
    for (let i = 1; i <= 99; i++) {
      this.runtime.declareVariable(`*in${String(i).padStart(2, '0')}`, false, ind);
    }

    // Paramètres d'entrée du programme (dcl-pi principal), passés par l'appelant
    const parameters = ast.parameters ?? [];
    parameters.forEach((p, i) => {
      const type = p.dataType.typeName;
      // Sur IBM i les octets d'un autre type seraient réinterprétés comme une date
      if (isDateTimeType(type) && args[i] !== undefined && kindOf(args[i]) !== type) {
        throw new Error(`Paramètre ${p.name} : passage d'une valeur ${describeValue(args[i])} à un paramètre ${type.toUpperCase()} : `
          + `pas encore supporté par l'interpréteur`);
      }
      this.runtime.declareVariable(p.name, args[i], p.dataType);
    });

    // Première passe : déclarer variables, constantes, procédures
    for (const node of ast.body) {
      if (node.type === 'VariableDeclaration') {
        this.executeVariableDeclaration(node as any);
      } else if (node.type === 'ConstantDeclaration') {
        this.executeConstantDeclaration(node as any);
      } else if (node.type === 'DataStructure') {
        this.executeDataStructure(node as any);
      } else if (node.type === 'Procedure') {
        this.procedures.set(node.name.toLowerCase(), node);
      } else if (node.type === 'Prototype') {
        this.prototypes.set(node.name.toLowerCase(), node);
      }
    }

    // Deuxième passe : exécuter le code
    try {
      for (const node of ast.body) {
        if (node.type !== 'VariableDeclaration' &&
            node.type !== 'ConstantDeclaration' &&
            node.type !== 'DataStructure' &&
            node.type !== 'Procedure') {
          this.executeNode(node);
        }
      }
    } catch (e) {
      if (e instanceof LeaveSignal) throw new Error('LEAVE en dehors d\'une boucle');
      if (e instanceof IterSignal) throw new Error('ITER en dehors d\'une boucle');
      if (!(e instanceof ReturnSignal)) throw e;
    }

    return parameters.map(p => this.runtime.lookup(p.name));
  }

  private executeBlock(statements: ASTNode[]): void {
    for (const stmt of statements) {
      this.executeNode(stmt);
    }
  }

  // Exécute une itération ; renvoie false si la boucle doit s'arrêter (LEAVE)
  private runIteration(body: ASTNode[]): boolean {
    if (++this.iterations > this.maxIterations) {
      throw new Error(`Limite de ${this.maxIterations} itérations atteinte (boucle infinie ?)`);
    }
    try {
      this.executeBlock(body);
    } catch (e) {
      if (e instanceof LeaveSignal) return false;
      if (e instanceof IterSignal) return true;
      throw e;
    }
    return true;
  }

  private executeNode(node: ASTNode): any {
    switch (node.type) {
      case 'Assignment':
        return this.executeAssignment(node as any);
      case 'IfStatement':
        return this.executeIf(node as any);
      case 'SelectStatement':
        return this.executeSelect(node as any);
      case 'LoopStatement':
        return this.executeLoop(node as any);
      case 'ProcedureCall':
        return this.executeProcedureCall(node as any);
      case 'Return':
        return this.executeReturn(node as any);
      case 'Monitor':
        return this.executeMonitor(node as any);
      case 'DataStructure':
        return this.executeDataStructure(node as any);
      case 'VariableDeclaration':
        return this.executeVariableDeclaration(node as any);
      case 'ConstantDeclaration':
        return this.executeConstantDeclaration(node as any);
      case 'Dsply':
        return this.executeDsply(node as any);
      case 'SQL':
        return this.executeSQL(node as any);
      case 'Prototype':
        // Prototype local à une procédure
        this.prototypes.set(node.name.toLowerCase(), node);
        return;
      case 'Leave':
        throw new LeaveSignal();
      case 'Iter':
        throw new IterSignal();
      default:
        return;
    }
  }

  private executeVariableDeclaration(node: any): void {
    this.runtime.declareVariable(node.name, this.initialValue(node.initialValue, node.dataType), node.dataType);
  }

  // Valeur de INZ ; INZ(*SYS) et INZ(*JOB) lisent l'horloge (*JOB : date du jour, faute de travail IBM i)
  private initialValue(expr: ExpressionNode | undefined, type: DataTypeNode): any {
    if (!expr) return defaultValue(type);
    if (expr.valueType === 'special' && (expr.value === '*sys' || expr.value === '*job') && isDateTimeType(type.typeName)) {
      return fromClock(type.typeName, this.runtime.now());
    }
    return this.evaluate(expr);
  }

  private executeConstantDeclaration(node: any): void {
    this.runtime.setConstant(node.name, this.evaluate(node.value));
  }

  private executeDataStructure(node: any): void {
    this.runtime.declareDataStructure(node.name, node.fields.map((field: any) => ({
      name: field.name,
      type: field.dataType,
      value: this.initialValue(field.initialValue, field.dataType),
    })), node.isQualified);
  }

  // Appelle une procédure utilisateur, sinon une procédure du runtime.
  // Les arguments restent des expressions : un paramètre passé par référence
  // (ni CONST ni VALUE) dont l'argument est une variable est recopié chez l'appelant.
  private callProcedure(name: string, argExprs: ExpressionNode[]): any {
    const proc = this.procedures.get(name.toLowerCase());
    if (!proc) {
      // Pas de procédure interne : programme ou procédure externe déclaré par dcl-pr
      const prototype = this.prototypes.get(name.toLowerCase());
      if (prototype) return this.callExternal(prototype, argExprs);
      throw new Error(`Procédure non trouvée: ${name}`);
    }

    const params = proc.parameters;
    this.checkArgumentCount(proc.name, params, argExprs.length);
    if (this.runtime.callDepth >= this.maxCallDepth) {
      throw new Error(`Profondeur de récursion maximale (${this.maxCallDepth}) atteinte dans ${proc.name}`);
    }

    const args = argExprs.map(arg => this.evaluate(arg));
    const byReference = params.map((p, i) =>
      i < argExprs.length && !p.isConst && !p.byValue && argExprs[i].valueType === 'identifier');

    let returnValue: any;
    const outValues: any[] = [];
    this.runtime.pushFrame(proc.name);
    try {
      params.forEach((p, i) => this.runtime.declareVariable(p.name, args[i], p.dataType));
      try {
        this.executeBlock(proc.body);
      } catch (e) {
        if (e instanceof LeaveSignal) throw new Error(`LEAVE en dehors d'une boucle dans ${proc.name}`);
        if (e instanceof IterSignal) throw new Error(`ITER en dehors d'une boucle dans ${proc.name}`);
        if (!(e instanceof ReturnSignal)) throw e;
        returnValue = coerce(e.value, proc.returnType, proc.name);
      }
      params.forEach((p, i) => {
        if (byReference[i]) outValues[i] = this.runtime.getVariable(p.name);
      });
    } finally {
      this.runtime.popFrame();
    }

    byReference.forEach((isRef, i) => {
      if (isRef) this.assignTo(argExprs[i].value, outValues[i]);
    });
    return returnValue;
  }

  private declaredType(expr: ExpressionNode | undefined): DataTypeNode | undefined {
    if (expr?.valueType === 'identifier') return this.runtime.getType(expr.value);
    if (expr?.valueType === 'call') {
      const name = expr.value.name.toLowerCase();
      return (this.procedures.get(name) ?? this.prototypes.get(name))?.returnType;
    }
    return undefined;
  }

  private checkArgumentCount(name: string, params: ParameterNode[], count: number): void {
    const required = params.filter(p => !p.options.includes('*nopass')).length;
    if (count < required || count > params.length) {
      const expected = required === params.length ? `${required}` : `${required} à ${params.length}`;
      throw new Error(`Nombre de paramètres incorrect pour ${name} : ${count} reçu(s), ${expected} attendu(s)`);
    }
  }

  // Appel d'un programme (EXTPGM) ou d'une procédure externe, simulé par le bouchon
  // de context/programs.json. Sans bouchon : erreur 00211, comme un programme introuvable.
  private callExternal(proto: PrototypeNode, argExprs: ExpressionNode[]): any {
    const target = proto.externalName.toUpperCase();
    const what = proto.kind === 'program' ? 'Programme' : 'Procédure externe';
    this.checkArgumentCount(proto.name, proto.parameters, argExprs.length);

    const args = argExprs.map((arg, i) => coerce(this.evaluate(arg), proto.parameters[i].dataType, proto.parameters[i].name));
    const describe = (v: any) => (typeof v === 'string' ? `'${v.trimEnd()}'` : String(v));
    const callText = proto.parameters
      .slice(0, args.length)
      .map((p, i) => `${p.name}=${describe(args[i])}`)
      .join(', ');

    const mockName = Object.keys(this.context.programs).find(n => n.toUpperCase() === target);
    const mock = mockName !== undefined ? this.context.programs[mockName] : undefined;
    if (!mock) {
      // Sans bouchon, un programme dont le source est disponible est exécuté
      const program = proto.kind === 'program' ? this.options.resolveProgram?.(target) : undefined;
      if (program) return this.callSourceProgram(proto, target, program, argExprs, args, callText);
      const hint = proto.kind === 'program'
        ? `placez ${target}.rpgle à côté du programme appelant ou ajoutez son bouchon dans context/programs.json`
        : 'ajoutez son bouchon dans context/programs.json';
      throw new RpgError(STATUS_CALL_NOT_FOUND, `${what} ${target} introuvable : ${hint} (RNX0211)`);
    }
    this.runtime.addOutput(`[APPEL] ${target}(${callText}) (bouchon)`);

    const paramIndex = (paramName: string) => {
      const index = proto.parameters.findIndex(p => p.name.toLowerCase() === paramName.toLowerCase());
      if (index < 0) throw new Error(`Bouchon ${target} : paramètre '${paramName}' inconnu dans le prototype ${proto.name}`);
      return index;
    };
    const sameValue = (actual: any, expected: any) =>
      typeof actual === 'string' ? actual.trimEnd() === String(expected).trimEnd()
        : isDateTime(actual) ? String(actual) === String(expected)
        : actual === expected;

    const matching = mock.calls.find((c: MockCase) =>
      Object.entries(c.when ?? {}).every(([paramName, expected]) => sameValue(args[paramIndex(paramName)], expected)));
    if (!matching) {
      throw new Error(`Bouchon ${target} : aucun cas ne correspond à l'appel (${callText})`);
    }

    if (matching.error !== undefined) {
      throw new RpgError(STATUS_CALL_FAILED, `${what} ${target} en échec : ${matching.error} (RNX0202)`);
    }
    for (const [paramName, value] of Object.entries(matching.set ?? {})) {
      const index = paramIndex(paramName);
      const param = proto.parameters[index];
      if (param.isConst || param.byValue) {
        throw new Error(`Bouchon ${target} : le paramètre ${param.name} est ${param.isConst ? 'CONST' : 'VALUE'}, il ne peut pas être renvoyé`);
      }
      const arg = argExprs[index];
      if (!arg || arg.valueType !== 'identifier') {
        throw new Error(`Bouchon ${target} : le paramètre ${param.name} doit recevoir une variable pour être renvoyé`);
      }
      this.assignTo(arg.value, coerce(fromMock(value, param.dataType, `Bouchon ${target}`), param.dataType, param.name));
    }
    return coerce(fromMock(matching.return, proto.returnType, `Bouchon ${target}`), proto.returnType, proto.name);
  }

  // Exécute le source d'un programme appelé, avec ses propres variables globales.
  // Paramètres passés par référence ; une erreur RPG non interceptée remonte en 00202.
  private callSourceProgram(proto: PrototypeNode, target: string, program: { source: string; path?: string },
                            argExprs: ExpressionNode[], args: any[], callText: string): void {
    if (this.programDepth >= (this.options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH)) {
      throw new Error(`Profondeur maximale d'appels de programmes atteinte en appelant ${target}`);
    }
    this.runtime.addOutput(`[APPEL] ${target}(${callText}) (source ${program.path ?? target})`);

    let ast: ProgramNode;
    try {
      ast = new Parser(new Lexer(program.source).tokenize()).parse();
    } catch (e: any) {
      throw new Error(`${target} (${program.path ?? 'source'}) : ${e.message}`);
    }

    const callee = new Interpreter(this.context, this.options);
    callee.programDepth = this.programDepth + 1;
    let finalValues: any[];
    try {
      finalValues = callee.runProgram(ast, args);
    } catch (e) {
      callee.runtime.getOutput().forEach(line => this.runtime.addOutput(line));
      if (e instanceof RpgError) {
        throw new RpgError(STATUS_CALL_FAILED, `Programme ${target} en échec : ${e.message} (RNX0202)`);
      }
      throw e;
    }
    callee.runtime.getOutput().forEach(line => this.runtime.addOutput(line));

    proto.parameters.forEach((param, i) => {
      const arg = argExprs[i];
      if (i < finalValues.length && !param.isConst && !param.byValue && arg?.valueType === 'identifier') {
        this.assignTo(arg.value, coerce(finalValues[i], param.dataType, param.name));
      }
    });
  }

  private executeAssignment(node: any): void {
    this.assignTo(node.variable, this.evaluate(node.value));
  }

  private assignTo(variable: string, value: any): void {
    // Gestion des structures de données qualifiées
    if (variable.includes('.')) {
        const [dsName, fieldName] = variable.split('.');
        if (!this.runtime.hasVariable(dsName)) {
            throw new Error(`Structure de données '${dsName}' non déclarée`);
        }
        this.runtime.setField(dsName, fieldName, value);
    } else {
        this.runtime.setVariable(variable, value);
    }
}

  // Évalue une condition (IF, WHEN, DOW, DOU) : une date, une heure ou un timestamp n'est pas un indicateur
  private condition(expr: ExpressionNode): any {
    const value = this.evaluate(expr);
    if (isDateTime(value) || isDuration(value) || value instanceof FigurativeValue) {
      throw incompatibleTypes(`Condition ${describeValue(value)}`);
    }
    return value;
  }

  private executeIf(node: any): void {
    if (this.condition(node.condition)) {
      this.executeBlock(node.thenBlock);
      return;
    }
    for (const elseIf of node.elseIfBlocks ?? []) {
      if (this.condition(elseIf.condition)) {
        this.executeBlock(elseIf.block);
        return;
      }
    }
    if (node.elseBlock) {
      this.executeBlock(node.elseBlock);
    }
  }

  private executeSelect(node: any): void {
    for (const when of node.whenBlocks) {
      if (this.condition(when.condition)) {
        this.executeBlock(when.block);
        return;
      }
    }
    if (node.otherBlock) {
      this.executeBlock(node.otherBlock);
    }
  }

  // Borne d'une boucle FOR : ni date, ni durée, ni constante figurative
  private numericBound(expr: ExpressionNode, what: string): any {
    const value = this.evaluate(expr);
    if (isDateTime(value) || isDuration(value) || value instanceof FigurativeValue) {
      throw incompatibleTypes(`FOR, ${what} ${describeValue(value)}`);
    }
    return value;
  }

  private executeLoop(node: any): void {
    if (node.loopType === 'for') {
      // La variable de boucle est relue à chaque tour : le corps peut la modifier,
      // et elle vaut limite + pas en sortie de boucle, comme en RPG.
      const varName = node.variable;
      const limit = this.numericBound(node.limit, 'limite');
      const step = node.step ? this.numericBound(node.step, 'pas') : 1;
      const delta = node.direction === 'to' ? step : -step;
      const inRange = () => {
        const i = this.runtime.getVariable(varName);
        return node.direction === 'to' ? i <= limit : i >= limit;
      };

      this.runtime.setVariable(varName, this.numericBound(node.init, 'valeur initiale'));
      while (inRange()) {
        if (!this.runIteration(node.body)) return;
        this.runtime.setVariable(varName, this.runtime.getVariable(varName) + delta);
      }
    } else if (node.loopType === 'dow') {
      while (this.condition(node.condition)) {
        if (!this.runIteration(node.body)) return;
      }
    } else if (node.loopType === 'dou') {
      do {
        if (!this.runIteration(node.body)) return;
      } while (!this.condition(node.condition));
    }
  }

  private executeProcedureCall(node: any): void {
    return this.callProcedure(node.name, node.args);
  }

  private executeDsply(node: any): void {
    let msg = '';
    if (node.message) {
      // Les blancs de fin d'un char sont invisibles à l'écran
      const value = this.evaluate(node.message);
      if (isDuration(value)) throw incompatibleTypes(`DSPLY ${describeValue(value)}`);
      msg = String(value).trimEnd();
    }

    const queueInfo = node.queue ? ` (File: ${this.evaluate(node.queue)})` : '';
    const extenderInfo = node.hasErrorExtender ? ' [Gestion d\'erreur active]' : '';

    this.runtime.addOutput(`[DSPLY${extenderInfo}] ${msg}${queueInfo}`);

    if (node.responseVar) {
      const simulatedResponse = 'Y'; 
      this.runtime.addOutput(`  -> (Simulé) Réponse '${simulatedResponse}' enregistrée dans la variable '${node.responseVar}'`);
      this.runtime.setVariable(node.responseVar, simulatedResponse);
    }
  }

  // 🆕 MÉTHODE SQL AJOUTÉE
  private executeSQL(node: any): void {
    // Variables hôtes date/heure : les dates en SQL font l'objet d'un incrément à venir
    for (const [, name] of node.sql.matchAll(/:([A-Za-z_$#@][\w$#@]*(?:\.[\w$#@]+)?)/g)) {
      const type = this.runtime.getType(name);
      if (type && isDateTimeType(type.typeName)) {
        throw new Error(`Variable hôte :${name} de type ${type.typeName.toUpperCase()} dans EXEC SQL : pas encore supporté par l'interpréteur`);
      }
    }
    const result = this.runtime.executeSQL(node.sql);

    // Mettre à jour les variables RPG standard
    this.runtime.setVariable('SQLCOD', result.sqlCode);
    this.runtime.setVariable('SQLSTT', result.sqlState);

    if (result.sqlCode === 100) {
      this.runtime.addOutput(`[SQL] Aucune ligne trouvée (SQLCOD=100)`);
    } else if (result.sqlCode < 0) {
      this.runtime.addOutput(`[SQL] Erreur: SQLCOD=${result.sqlCode}${result.message ? ` - ${result.message}` : ''}`);
    } else {
      this.runtime.addOutput(`[SQL] Succès - ${result.rowCount} ligne(s) traitée(s)`);
    }
  }

  private executeReturn(node: any): never {
    throw new ReturnSignal(node.value ? this.evaluate(node.value) : undefined);
  }

  private executeMonitor(node: any): void {
    try {
      this.executeBlock(node.tryBlock);
    } catch (error) {
      // Les signaux LEAVE/ITER/RETURN et les erreurs de l'interpréteur ne sont pas des RpgError
      if (!(error instanceof RpgError)) throw error;
      const { status } = error;
      const handler = node.catchBlocks.find((c: any) => matchesStatus(c.errorCodes, status));
      if (!handler) throw error;
      this.runtime.status = status;
      this.runtime.addOutput(`[JOBLOG] ${error.message} - interceptée par MONITOR`);
      this.executeBlock(handler.block);
    }
  }

  private evaluate(expr: ExpressionNode): any {
    if (expr.valueType === 'number') {
      return expr.value;
    }

    if (expr.valueType === 'string') {
      return expr.value;
    }

    if (expr.valueType === 'datetime') {
      return expr.value;
    }

    if (expr.valueType === 'special') {
      switch (expr.value) {
        case '*loval': case '*hival': return new FigurativeValue(expr.value);
        case '*on': return true;
        case '*off': return false;
        case '*zero': case '*zeros': return 0;
        case '*blank': case '*blanks': return '';
        default:
          // Indicateurs *INLR, *INxx ; les autres valeurs (*EXT, *JOBLOG) ne viennent que de DSPLY
          return /^\*in(lr|\d\d)$/.test(expr.value) ? this.runtime.getVariable(expr.value) : expr.value;
      }
    }

    if (expr.valueType === 'identifier') {
      // Gestion des structures de données qualifiées
      if (expr.value.includes('.')) {
          const [dsName, fieldName] = expr.value.split('.');
          if (!this.runtime.hasVariable(dsName)) {
              throw new Error(`Structure de données '${dsName}' non déclarée`);
          }
          return this.runtime.getField(dsName, fieldName);
      }

      if (this.runtime.hasVariable(expr.value)) {
          return this.runtime.getVariable(expr.value);
      }
      try {
          return this.runtime.getConstant(expr.value);
      } catch {
          throw new Error(`Variable non déclarée: ${expr.value}`);
      }
    }

    if (expr.valueType === 'call') {
      return this.callProcedure(expr.value.name, expr.value.args);
    }

    if (expr.valueType === 'builtin') {
      const builtin = expr.value.name.toLowerCase();
      const isChar = builtin === '%char';
      // Le 2e argument (*ISO) est un format, inutile à évaluer
      const args = (isChar ? expr.value.args.slice(0, 1) : expr.value.args).map((arg: ExpressionNode) => this.evaluate(arg));
      // Aucune fonction intégrée ne prend une durée en argument
      const duration = args.find(isDuration);
      if (duration) throw incompatibleTypes(`${expr.value.name.toUpperCase()}(${describeValue(duration)})`);
      if (!isChar && !DATE_AWARE_BUILTINS.has(builtin)) this.refuseDateArguments(expr.value.name, args);
      if (isChar) {
        // %CHAR(x : *ISO) n'existe que pour une date, une heure ou un timestamp
        if (expr.value.args.length > 1 && !isDateTime(args[0])) {
          throw incompatibleTypes(`%CHAR(${describeValue(args[0])} : *ISO)`);
        }
        // Le format dépend du type déclaré : variable, ou valeur de retour d'une procédure
        return formatChar(args[0], this.declaredType(expr.value.args[0]));
      }
      return this.runtime.executeBuiltin(expr.value.name, args);
    }

    if (expr.operator) {
      return this.executeOperator(expr);
    }

    throw new Error(`Expression non supportée`);
  }

  // Les autres fonctions intégrées ne savent pas traiter une date, une heure ou un timestamp
  private refuseDateArguments(name: string, args: any[]): void {
    const date = args.find(isDateTime);
    if (!date) return;
    if (NOT_YET_DATE_BUILTINS.has(name.toLowerCase())) {
      throw new Error(`${name.toUpperCase()} d'une valeur ${date.kind.toUpperCase()} : pas encore supporté par l'interpréteur`);
    }
    throw incompatibleTypes(`${name.toUpperCase()}(${describeValue(date)})`);
  }

  private executeOperator(expr: ExpressionNode): any {
    const left = expr.left ? this.evaluate(expr.left) : undefined;
    const right = expr.right ? this.evaluate(expr.right) : undefined;
    if (involvesDateTime(left) || involvesDateTime(right)) {
      return dateTimeOperation(expr.operator!, left, right);
    }

    switch (expr.operator) {
      case '+': 
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left) + String(right);
        }
        return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': 
        if (right === 0) throw new RpgError(STATUS_DIVIDE_BY_ZERO, 'Division par zéro (RNX0102)');
        return left / right;
      case '**': return Math.pow(left, right);
      case '=': return compare(left, right) === 0;
      case '<>': return compare(left, right) !== 0;
      case '<': return compare(left, right) < 0;
      case '<=': return compare(left, right) <= 0;
      case '>': return compare(left, right) > 0;
      case '>=': return compare(left, right) >= 0;
      case 'and': return left && right;
      case 'or': return left || right;
      case 'not': return !left;
      case 'neg': return -left;
      default: throw new Error(`Opérateur non supporté: ${expr.operator}`);
    }
  }
}