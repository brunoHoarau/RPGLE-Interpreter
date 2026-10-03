import { ASTNode, ProgramNode, ExpressionNode, ProcedureNode } from './types';
import { Runtime } from './runtime';
import { ExecutionContext } from './context';
import { coerce, defaultValue, formatChar } from './datatypes';

// Signaux de contrôle : levés comme exceptions pour traverser les blocs imbriqués
// jusqu'à la boucle (LEAVE/ITER) ou la procédure / le programme (RETURN) concerné.
class LeaveSignal {}
class IterSignal {}
class ReturnSignal {
  constructor(public value?: any) {}
}

const isControlSignal = (e: unknown) =>
  e instanceof LeaveSignal || e instanceof IterSignal || e instanceof ReturnSignal;

export interface InterpreterOptions {
  // Nombre total d'itérations de boucle autorisées avant d'arrêter l'exécution
  maxIterations?: number;
  // Nombre maximal d'appels de procédure imbriqués (protège des récursions infinies)
  maxCallDepth?: number;
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
const DEFAULT_MAX_CALL_DEPTH = 256;

export class Interpreter {
  private runtime: Runtime;
  private maxIterations: number;
  private maxCallDepth: number;
  private iterations = 0;
  private procedures = new Map<string, ProcedureNode>();

  constructor(context?: ExecutionContext, options: InterpreterOptions = {}) {
    this.runtime = new Runtime(context);
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
  }

  execute(ast: ProgramNode): string[] {
    this.runtime.reset();
    this.runtime.clearOutput();
    this.iterations = 0;
    this.procedures.clear();

    // Déclarer SQLCOD et SQLSTT par défaut
    this.runtime.declareVariable('SQLCOD', 0, { type: 'DataType', typeName: 'int', length: 10 });
    this.runtime.declareVariable('SQLSTT', '00000', { type: 'DataType', typeName: 'char', length: 5 });

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

    return this.runtime.getOutput();
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
      case 'Leave':
        throw new LeaveSignal();
      case 'Iter':
        throw new IterSignal();
      default:
        return;
    }
  }

  private executeVariableDeclaration(node: any): void {
    const value = node.initialValue ? this.evaluate(node.initialValue) : defaultValue(node.dataType);
    this.runtime.declareVariable(node.name, value, node.dataType);
  }

  private executeConstantDeclaration(node: any): void {
    this.runtime.setConstant(node.name, this.evaluate(node.value));
  }

  private executeDataStructure(node: any): void {
    this.runtime.declareDataStructure(node.name, node.fields.map((field: any) => ({
      name: field.name,
      type: field.dataType,
      value: field.initialValue ? this.evaluate(field.initialValue) : defaultValue(field.dataType),
    })), node.isQualified);
  }

  // Appelle une procédure utilisateur, sinon une procédure du runtime.
  // Les arguments restent des expressions : un paramètre passé par référence
  // (ni CONST ni VALUE) dont l'argument est une variable est recopié chez l'appelant.
  private callProcedure(name: string, argExprs: ExpressionNode[]): any {
    const proc = this.procedures.get(name.toLowerCase());
    if (!proc) {
      const args = argExprs.map(arg => this.evaluate(arg));
      return this.runtime.callProcedure(name, args);
    }

    const params = proc.parameters;
    const required = params.filter(p => !p.options.includes('*nopass')).length;
    if (argExprs.length < required || argExprs.length > params.length) {
      const expected = required === params.length ? `${required}` : `${required} à ${params.length}`;
      throw new Error(`Nombre de paramètres incorrect pour ${proc.name} : ${argExprs.length} reçu(s), ${expected} attendu(s)`);
    }
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

  private executeIf(node: any): void {
    if (this.evaluate(node.condition)) {
      this.executeBlock(node.thenBlock);
      return;
    }
    for (const elseIf of node.elseIfBlocks ?? []) {
      if (this.evaluate(elseIf.condition)) {
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
      if (this.evaluate(when.condition)) {
        this.executeBlock(when.block);
        return;
      }
    }
    if (node.otherBlock) {
      this.executeBlock(node.otherBlock);
    }
  }

  private executeLoop(node: any): void {
    if (node.loopType === 'for') {
      // La variable de boucle est relue à chaque tour : le corps peut la modifier,
      // et elle vaut limite + pas en sortie de boucle, comme en RPG.
      const varName = node.variable;
      const limit = this.evaluate(node.limit);
      const step = node.step ? this.evaluate(node.step) : 1;
      const delta = node.direction === 'to' ? step : -step;
      const inRange = () => {
        const i = this.runtime.getVariable(varName);
        return node.direction === 'to' ? i <= limit : i >= limit;
      };

      this.runtime.setVariable(varName, this.evaluate(node.init));
      while (inRange()) {
        if (!this.runIteration(node.body)) return;
        this.runtime.setVariable(varName, this.runtime.getVariable(varName) + delta);
      }
    } else if (node.loopType === 'dow') {
      while (this.evaluate(node.condition)) {
        if (!this.runIteration(node.body)) return;
      }
    } else if (node.loopType === 'dou') {
      do {
        if (!this.runIteration(node.body)) return;
      } while (!this.evaluate(node.condition));
    }
  }

  private executeProcedureCall(node: any): void {
    const procName = node.name.toLowerCase();

    if (procName === 'dsply') {
      const message = this.evaluate(node.args[0]);
      this.runtime.addOutput(String(message));
      return;
    }

    if (['setll', 'read', 'chain', 'update', 'delete', 'write'].includes(procName)) {
      this.executeFileOperation(procName, node.args);
      return;
    }

    return this.callProcedure(node.name, node.args);
  }

  private executeFileOperation(operation: string, args: any[]): void {
    const fileName = this.evaluate(args[args.length - 1]);

    switch (operation) {
      case 'setll':
        const key = args.length > 1 ? this.evaluate(args[0]) : undefined;
        this.runtime.setll(fileName, key);
        break;
      case 'read':
        const record = this.runtime.read(fileName);
        if (record) {
          for (const [key, value] of Object.entries(record)) {
            if (this.runtime.hasVariable(key)) {
              this.runtime.setVariable(key, value);
            }
          }
        }
        break;
      case 'chain':
        const chainKey = this.evaluate(args[0]);
        const chainRecord = this.runtime.chain(fileName, chainKey);
        if (chainRecord) {
          for (const [key, value] of Object.entries(chainRecord)) {
            if (this.runtime.hasVariable(key)) {
              this.runtime.setVariable(key, value);
            }
          }
        }
        break;
    }
  }

  private executeDsply(node: any): void {
    let msg = '';
    if (node.message) {
      // Les blancs de fin d'un char sont invisibles à l'écran
      msg = String(this.evaluate(node.message)).trimEnd();
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
      if (isControlSignal(error)) throw error;
      if (node.catchBlocks && node.catchBlocks.length > 0) {
        for (const catchBlock of node.catchBlocks) {
          this.executeBlock(catchBlock.block);
        }
      }
    }
  }

  private evaluate(expr: ExpressionNode): any {
    if (expr.valueType === 'number') {
      return expr.value;
    }

    if (expr.valueType === 'string') {
      return expr.value;
    }

    if (expr.valueType === 'special') {
      switch (expr.value) {
        case '*on': return true;
        case '*off': return false;
        case '*zero': return 0;
        case '*blank': return '';
        case '*all': return '';
        default: return expr.value;
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
      const args = expr.value.args.map((arg: ExpressionNode) => this.evaluate(arg));
      if (expr.value.name.toLowerCase() === '%char') {
        // Le format dépend du type déclaré quand l'argument est une variable
        const arg = expr.value.args[0];
        return formatChar(args[0], arg?.valueType === 'identifier' ? this.runtime.getType(arg.value) : undefined);
      }
      return this.runtime.executeBuiltin(expr.value.name, args);
    }

    if (expr.operator) {
      return this.executeOperator(expr);
    }

    throw new Error(`Expression non supportée`);
  }

  private executeOperator(expr: ExpressionNode): any {
    const left = expr.left ? this.evaluate(expr.left) : undefined;
    const right = expr.right ? this.evaluate(expr.right) : undefined;

    switch (expr.operator) {
      case '+': 
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left) + String(right);
        }
        return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': 
        if (right === 0) throw new Error('Division par zéro');
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