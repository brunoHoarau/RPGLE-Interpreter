import { ASTNode, ProgramNode, ExpressionNode, ProcedureNode, PrototypeNode, ParameterNode, DataTypeNode, FileDeclarationNode, FileOperationNode } from './types';
import { NativeFile, FileResult, parseFieldType, fitsField } from './files';
import { Runtime } from './runtime';
import { ExecutionContext, MockCase, TableDefinition, emptyContext } from './context';
import { checkAssignable, coerce, defaultValue, describeType, describeValue, formatChar, isDataStructure, sameDeclaredType } from './datatypes';
import { DateTimeValue, FigurativeValue, RpgDuration, addDuration, compareDateTime, fromClock, isDateTime, isDateTimeType, isDuration, kindOf, parseIso, resolveFigurative } from './datetime';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { ProgramResolver } from './sources';
import { RpgError, STATUS_CALL_FAILED, STATUS_CALL_NOT_FOUND, STATUS_DATE_OVERFLOW, STATUS_DIVIDE_BY_ZERO, NotSupportedError, incompatibleTypes, matchesStatus } from './errors';

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
  // Un indicateur se compare à un caractère comme '1' ou '0'
  if (typeof left === 'boolean' && typeof right === 'string') left = left ? '1' : '0';
  if (typeof right === 'boolean' && typeof left === 'string') right = right ? '1' : '0';
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

const isZeroOrBlank = (expr: ExpressionNode | undefined) =>
  expr?.valueType === 'special' && /^\*(zero|blank)s?$/.test(expr.value);

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
const DURATION_BUILTINS = new Set(['%years', '%months', '%days', '%hours', '%minutes', '%seconds', '%mseconds']);
const WHOLE_NUMBER_BUILTINS = new Set(['%int', '%diff', '%subdt', '%len', '%scan', '%check', '%rem', '%div']);
const DATE_AWARE_BUILTINS = new Set(['%date', '%time', '%timestamp', '%len', '%diff', '%subdt']);
// Acceptées sur IBM i (ou doute) mais pas encore implémentées pour les dates
const NOT_YET_DATE_BUILTINS = new Set(['%dec', '%int', '%max', '%min']);

const DEFAULT_MAX_CALL_DEPTH = 256;

const FILE_BUILTINS = new Set(['%eof', '%found', '%equal', '%open']);
const NUMERIC_TYPES = new Set(['int', 'uns', 'packed', 'zoned']);

// État d'un fichier déclaré par DCL-F dans le programme en cours
interface FileState {
  file: NativeFile;
  open: boolean;
  eof: boolean | undefined;   // undefined : inconnu (après un CHAIN non trouvé)
  found: boolean;
  equal: boolean;
  usage: FileDeclarationNode['usage'];
  table: TableDefinition;     // Pour deletedRows après une suppression native
}

export class Interpreter {
  private runtime: Runtime;
  private maxIterations: number;
  private maxCallDepth: number;
  private iterations = 0;
  private returnTypes: (DataTypeNode | undefined)[] = [];
  private procedures = new Map<string, ProcedureNode>();
  private prototypes = new Map<string, PrototypeNode>();
  private context: ExecutionContext;
  private options: InterpreterOptions;
  private programDepth = 0; // Niveau d'imbrication des appels de programmes source
  private files = new Map<string, FileState>();          // Par nom de fichier et par nom de format, en majuscules
  private fileFields = new Map<string, { type: DataTypeNode; file: string }>(); // Zones des fichiers, en minuscules
  private lastIndicators = { eof: false, found: false, equal: false }; // %EOF, %FOUND, %EQUAL sans argument

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
    this.files.clear();
    this.fileFields.clear();
    this.lastIndicators = { eof: false, found: false, equal: false };

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
      if (p.isConst) this.runtime.markReadOnly(p.name);
    });

    // Fichiers : avant les autres déclarations, leurs zones sont des variables globales
    for (const declaration of ast.files ?? []) this.declareFile(declaration, parameters);
    if ((ast.files ?? []).length > 0) this.checkFileChanges(ast.body);

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

    // Deuxième passe : exécuter le code (les verrous de ce programme sont libérés à sa fin)
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
    } finally {
      for (const state of this.files.values()) state.file.release();
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
      case 'FileOperation':
        return this.executeFileOperation(node as FileOperationNode);
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
    this.refuseFileFieldName(node.name, node.dataType);
    this.runtime.declareVariable(node.name, this.initialValue(node.initialValue, node.dataType, node.name), node.dataType);
  }

  // --- Fichiers natifs (lecture) ---

  // Au niveau du programme, un nom de zone de fichier ne peut pas être redéclaré (une procédure peut le masquer).
  // Une variable de même type est valide sur IBM i (elle partage la zone) mais n'est pas simulée ;
  // une structure de données ou une constante de même nom est un doublon refusé par le compilateur.
  private refuseFileFieldName(name: string, type?: DataTypeNode): void {
    if (this.runtime.callDepth > 0) return;
    const field = this.fileFields.get(String(name).toLowerCase());
    if (!field) return;
    if (type) this.refuseSameNameAsField(String(name).toUpperCase(), type, field.type, field.file, 'Variable');
    throw new Error(`${String(name).toUpperCase()} est déjà déclaré (zone du fichier ${field.file})`);
  }

  private refuseSameNameAsField(name: string, type: DataTypeNode, fieldType: DataTypeNode, file: string, what: string): never {
    if (!sameDeclaredType(fieldType, type)) {
      throw incompatibleTypes(`${what} ${name} ${describeType(type)} déclarée comme zone de fichier ${describeType(fieldType)}`);
    }
    throw new NotSupportedError(`${what} ${name} : ${name} porte le nom d'une zone du fichier ${file}`);
  }

  private declareFile(node: FileDeclarationNode, parameters: ParameterNode[]): void {
    const name = node.name.toUpperCase();
    const tableName = Object.keys(this.context.tables).find(n => n.toUpperCase() === name);
    const table = tableName === undefined ? undefined : this.context.tables[tableName];
    if (!table) throw new Error(`Fichier ${name} absent de context/tables.json`);
    if (table.columns.some(c => c.type === 'AUTO')) {
      throw new Error(`Fichier ${name} : décrivez ses zones dans "schema" de context/tables.json`);
    }
    if (node.keyed && !(table.keys && table.keys.length > 0)) {
      throw new Error(`Fichier ${name} déclaré KEYED sans "keys" dans context/tables.json`);
    }
    const fields = table.columns.map(col => {
      const type = parseFieldType(col.type);
      if (!type) throw new Error(`Fichier ${name} : type '${col.type}' de la zone ${col.name} inconnu`);
      return { name: col.name.toUpperCase(), type };
    });
    const format = (table.format ?? name + 'F').toUpperCase();
    // Le moteur SQL remplace table.data à chaque DELETE : la source est relue à chaque opération
    // Seul le moteur SQL modifie les données pendant l'exécution : il incrémente table.revision
    // Les écritures natives font avancer la revision (changed) ; les verrous sont partagés par toutes les ouvertures
    table.locks ??= new WeakMap();
    const file = new NativeFile(name, format, fields, node.keyed ? table.keys! : [], () => table.data,
      { rowsDeleted: () => table.deletedRows === true, revision: () => table.revision ?? 0,
        updatable: node.usage.update || node.usage.delete, uniqueKeys: table.unique ? table.keys : undefined,
        locks: table.locks as WeakMap<object, NativeFile>, changed: () => { table.revision = (table.revision ?? 0) + 1; } });
    const duplicate = file.duplicateKey();
    if (duplicate) {
      const shown = Object.entries(duplicate).map(([zone, value]) => `${zone} = ${typeof value === 'string' ? `'${value}'` : String(value)}`);
      throw new Error(`Fichier ${name} : clé en double dans tables.json (${shown.join(', ')})`);
    }
    const state: FileState = { file, open: !node.usropn, eof: false, found: false, equal: false, usage: node.usage, table };
    this.files.set(name, state);
    this.files.set(format, state);

    for (const field of fields) {
      const key = field.name.toLowerCase();
      const existing = this.fileFields.get(key);
      if (existing) {
        if (!sameDeclaredType(existing.type, field.type)) {
          throw incompatibleTypes(`Zone ${field.name} du fichier ${name} ${describeType(field.type)} déjà déclarée par un autre fichier ${describeType(existing.type)}`);
        }
        continue;
      }
      const parameter = parameters.find(p => p.name.toLowerCase() === key);
      if (parameter) this.refuseSameNameAsField(field.name, parameter.dataType, field.type, name, 'Paramètre');
      this.fileFields.set(key, { type: field.type, file: name });
      this.runtime.declareVariable(field.name, defaultValue(field.type), field.type);
    }
  }

  private fileState(name: string): FileState {
    const state = this.files.get(name.toUpperCase());
    if (!state) throw new Error(`Fichier ou format ${name.toUpperCase()} inconnu`);
    return state;
  }

  private executeFileOperation(node: FileOperationNode): void {
    const state = this.fileState(node.file);
    const file = state.file;
    if (node.operation === 'open') {
      if (state.open) throw new RpgError(1215, `Fichier ${file.name} déjà ouvert (RNX1215)`);
      state.open = true;
      state.eof = state.found = state.equal = false;
      file.reset();
      return;
    }
    if (node.operation === 'close') {
      if (!state.open) throw new NotSupportedError(`CLOSE du fichier ${file.name} déjà fermé (comportement IBM i non vérifié)`);
      state.open = false;
      file.release();
      return;
    }
    if (node.operation === 'write' || node.operation === 'update' || node.operation === 'delete' || node.operation === 'unlock') {
      this.executeFileChange(node, state);
      return;
    }
    if (!state.open) throw new RpgError(1211, `Fichier ${file.name} non ouvert (RNX1211)`);

    const key = (node.key ?? []).map(expr => this.evaluate(expr));
    let result: FileResult;
    switch (node.operation) {
      case 'read': result = file.read(); break;
      case 'readp': result = file.readp(); break;
      case 'reade': result = file.reade(key); break;
      case 'readpe': result = file.readpe(key); break;
      case 'chain':
        if (!file.keyed && key.length > 1) {
          throw incompatibleTypes(`CHAIN par numéro d'enregistrement avec une liste de ${key.length} valeurs sur le fichier sans clé ${file.name}`);
        }
        result = file.keyed ? file.chain(key) : file.chainRrn(key[0]);
        break;
      case 'setll': result = file.setll(node.special ?? key); break;
      case 'setgt': result = file.setgt(node.special ?? key); break;
      default: throw new Error(`Opération ${node.operation} non supportée`);
    }
    if (result.record) this.copyRecord(file, result.record);

    switch (node.operation) {
      case 'read': case 'readp': case 'reade': case 'readpe':
        state.eof = this.lastIndicators.eof = result.eof;
        break;
      // %EOF(fichier) remis à *OFF par SETLL, SETGT et CHAIN réussis (%EOF sans argument inchangé) ;
      // après un CHAIN non trouvé, sa valeur IBM i n'est pas vérifiée : inconnue
      case 'chain':
        state.found = this.lastIndicators.found = result.found;
        state.eof = result.found ? false : undefined;
        break;
      case 'setll':
        state.found = this.lastIndicators.found = result.found;
        state.equal = this.lastIndicators.equal = result.equal;
        state.eof = false;
        break;
      case 'setgt':
        state.found = this.lastIndicators.found = result.found;
        state.eof = false;
        break;
    }
  }

  // Contrôles du compilateur pour WRITE, UPDATE, DELETE, UNLOCK : fichier ou format connu, nom du format
  // pour WRITE/UPDATE, USAGE suffisante. Faits sur tout le programme avant l'exécution (formats connus
  // seulement avec tables.json), y compris dans les branches et procédures jamais exécutées.
  private checkFileChanges(node: any): void {
    if (Array.isArray(node)) {
      for (const child of node) this.checkFileChanges(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'FileOperation' && ['write', 'update', 'delete', 'unlock'].includes(node.operation)) {
      this.checkFileChange(node, this.fileState(node.file));
    }
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === 'object') this.checkFileChanges(value);
    }
  }

  private checkFileChange(node: FileOperationNode, state: FileState): void {
    const file = state.file;
    const op = node.operation.toUpperCase();
    if (node.operation === 'write' || node.operation === 'update') {
      if (node.file.toUpperCase() !== file.format) {
        throw new Error(`${op} attend le nom du format ${file.format} du fichier ${file.name}`);
      }
    }
    const needed = { write: 'output', update: 'update', delete: 'delete' } as { [op: string]: 'output' | 'update' | 'delete' | undefined };
    const usage = needed[node.operation];
    if (usage && !state.usage[usage]) {
      throw new Error(`Le fichier ${file.name} n'est pas déclaré avec USAGE(*${usage.toUpperCase()}) : ${op} impossible`);
    }
  }

  // WRITE, UPDATE, DELETE, UNLOCK
  private executeFileChange(node: FileOperationNode, state: FileState): void {
    const file = state.file;
    const op = node.operation.toUpperCase();
    this.checkFileChange(node, state);
    if (!state.open) throw new RpgError(1211, `Fichier ${file.name} non ouvert (RNX1211)`);
    const noCurrent = () => new RpgError(1221, `${op} de ${file.format} sans enregistrement lu (RNX1221)`);
    const refused = (what: string) => new NotSupportedError(
      `${op} de ${file.format} ${what} (comportement IBM i non vérifié)`);
    const blocked = () => refused(`sans nouvelle lecture après ${file.blockedReason ?? 'repositionnement'}`);

    switch (node.operation) {
      case 'unlock':
        if (!state.usage.update) {
          throw new NotSupportedError(`UNLOCK du fichier ${file.name} sans USAGE(*UPDATE) (comportement IBM i non vérifié)`);
        }
        file.unlock();
        return;
      case 'write': {
        const result = file.write(this.recordValues(file));
        if (result.failure === 'duplicate') {
          throw new RpgError(1021, `Clé en double dans le fichier ${file.name} (RNX1021)`);
        }
        return;
      }
      case 'update': {
        const result = file.update(this.recordValues(file));
        if (result.failure === 'noCurrent') throw noCurrent();
        if (result.failure === 'repositioned') throw blocked();
        if (result.failure === 'gone') throw refused("d'un enregistrement supprimé entre-temps");
        if (result.failure === 'duplicate') {
          throw new RpgError(1021, `Clé en double dans le fichier ${file.name} (RNX1021)`);
        }
        return;
      }
      case 'delete': {
        if (node.key) {
          const found = file.deleteByKey(node.key.map(expr => this.evaluate(expr))).found;
          state.found = this.lastIndicators.found = found;
          if (found) this.markDeleted(state);
          return;
        }
        const result = file.delete();
        if (result.failure === 'noCurrent') throw noCurrent();
        if (result.failure === 'repositioned') throw blocked();
        if (result.failure === 'gone') throw refused("d'un enregistrement supprimé entre-temps");
        this.markDeleted(state);
        return;
      }
    }
  }

  // Les numéros d'enregistrement ne sont plus fiables après une suppression
  private markDeleted(state: FileState): void {
    state.table.deletedRows = true;
  }

  // Valeurs des zones du fichier, lues dans les variables globales du programme
  // (une variable locale de même nom ne les masque pas) ; seul un CHAR perd ses blancs de remplissage
  private recordValues(file: NativeFile): { [zone: string]: any } {
    const values: { [zone: string]: any } = {};
    for (const field of file.fields) {
      const value = this.runtime.getGlobal(field.name);
      if (typeof value === 'string' && field.type.typeName === 'char') values[field.name] = value.replace(/ +$/, '');
      else if (typeof value === 'boolean') values[field.name] = value ? '1' : '0';
      else if (isDateTime(value)) values[field.name] = String(value);
      else values[field.name] = value;
    }
    return values;
  }

  // Copie les zones d'un enregistrement dans les variables du programme (chemin « données » : pas de checkAssignable)
  private copyRecord(file: NativeFile, row: any): void {
    for (const field of file.fields) {
      const column = Object.keys(row).find(c => c.toUpperCase() === field.name);
      const raw = column === undefined ? undefined : row[column];
      const invalid = () => new Error(`Donnée invalide dans le fichier ${file.name} : zone ${field.name} = '${String(raw)}'`);
      const tooBig = () => new Error(`Donnée invalide dans le fichier ${file.name} : zone ${field.name} = '${String(raw)}' `
        + `(ne tient pas dans ${describeType(field.type)})`);
      if (raw === undefined || raw === null) throw invalid();
      const kind = field.type.typeName;
      let value = raw;
      if (isDateTimeType(kind)) {
        if (!isDateTime(raw)) {
          const parsed = typeof raw === 'string' ? parseIso(kind, raw) : undefined;
          if (!parsed) throw invalid();
          value = parsed;
        }
      } else if (kind === 'ind') {
        if (raw === '1' || raw === 1 || raw === true) value = true;
        else if (raw === '0' || raw === 0 || raw === false) value = false;
        else throw invalid();
      } else if (NUMERIC_TYPES.has(kind)) {
        if (typeof raw === 'string' && /^[+-]?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
        else if (typeof raw !== 'number' || !Number.isFinite(raw)) throw invalid();
        if (!fitsField(value, field.type)) throw tooBig();
      } else if (!fitsField(raw, field.type)) {
        throw tooBig();
      }
      this.runtime.setGlobal(field.name, value);
    }
  }

  // %EOF, %FOUND, %EQUAL, %OPEN : état d'un fichier, ou dernier état connu sans argument
  private fileBuiltin(name: string, args: ExpressionNode[]): boolean {
    const builtin = name.toLowerCase();
    if (args.length > 0) {
      const state = this.fileState(String(args[0].value));
      switch (builtin) {
        case '%open': return state.open;
        case '%eof':
          if (state.eof === undefined) {
            throw new NotSupportedError(`%EOF(${state.file.name}) après un CHAIN non trouvé`);
          }
          return state.eof;
        case '%found': return state.found;
        case '%equal': return state.equal;
      }
    } else {
      if (this.files.size === 0) throw new Error(`${name.toUpperCase()} sans fichier déclaré`);
      switch (builtin) {
        case '%eof': return this.lastIndicators.eof;
        case '%found': return this.lastIndicators.found;
        case '%equal': return this.lastIndicators.equal;
      }
    }
    throw new Error(`Fonction ${name.toUpperCase()} inattendue pour un fichier`);
  }

  // Valeur de INZ ; INZ(*SYS) et INZ(*JOB) lisent l'horloge (*JOB : date du jour, faute de travail IBM i)
  private initialValue(expr: ExpressionNode | undefined, type: DataTypeNode, target: string): any {
    if (!expr) return defaultValue(type);
    if (expr.valueType === 'special' && (expr.value === '*sys' || expr.value === '*job') && isDateTimeType(type.typeName)) {
      return fromClock(type.typeName, this.runtime.now());
    }
    return this.valueFor(expr, type, target);
  }

  // Valeur d'une expression destinée à une cible typée, écrite dans le code RPG : *ZEROS et *BLANKS
  // prennent la longueur de la cible, puis le type de la valeur est contrôlé comme le fait le compilateur IBM i
  private valueFor(expr: ExpressionNode, type: DataTypeNode | undefined, target: string): any {
    let value: any;
    if (type && !isDateTimeType(type.typeName) && isZeroOrBlank(expr)) {
      value = this.zeroOrBlankFor(expr.value, type, target);
    } else {
      value = this.evaluate(expr);
    }
    checkAssignable(value, type, target, expr.valueType === 'string');
    return value;
  }

  private zeroOrBlankFor(name: string, type: DataTypeNode, target: string): any {
    const zeros = name.startsWith('*zero');
    switch (type.typeName) {
      case 'char': return (zeros ? '0' : ' ').repeat(type.length ?? 1);
      case 'int': case 'uns': case 'packed': case 'zoned':
        if (!zeros) throw incompatibleTypes(`Affectation de ${name.toUpperCase()} à ${target} ${describeType(type)}`);
        return 0;
      default:
        throw new NotSupportedError(`${name.toUpperCase()} affecté à ${target} ${describeType(type)}`);
    }
  }

  private executeConstantDeclaration(node: any): void {
    this.refuseFileFieldName(node.name);
    this.runtime.setConstant(node.name, this.evaluate(node.value));
  }

  private executeDataStructure(node: any): void {
    this.refuseFileFieldName(node.name);
    if (!node.isQualified) for (const field of node.fields) this.refuseFileFieldName(field.name, field.dataType);
    this.runtime.declareDataStructure(node.name, node.fields.map((field: any) => ({
      name: field.name,
      type: field.dataType,
      value: this.initialValue(field.initialValue, field.dataType, `${node.name}.${field.name}`),
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
    this.checkReferenceArguments(params, argExprs);
    if (this.runtime.callDepth >= this.maxCallDepth) {
      throw new Error(`Profondeur de récursion maximale (${this.maxCallDepth}) atteinte dans ${proc.name}`);
    }

    const args = argExprs.map((arg, i) => this.valueFor(arg, params[i].dataType, params[i].name));
    const byReference = params.map((p, i) =>
      i < argExprs.length && !p.isConst && !p.byValue && argExprs[i].valueType === 'identifier');

    let returnValue: any;
    const outValues: any[] = [];
    this.runtime.pushFrame(proc.name);
    this.returnTypes.push(proc.returnType);
    try {
      params.forEach((p, i) => {
        this.runtime.declareVariable(p.name, args[i], p.dataType);
        if (p.isConst) this.runtime.markReadOnly(p.name);
      });
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
      this.returnTypes.pop();
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

  // Un paramètre par référence (ni CONST ni VALUE) exige une variable modifiable du même type exact : le compilateur
  // IBM i refuse un littéral, une expression, une constante, un paramètre CONST ou une variable d'un autre type
  private checkReferenceArguments(params: ParameterNode[], argExprs: ExpressionNode[]): void {
    argExprs.forEach((arg, i) => {
      const param = params[i];
      if (!param || param.isConst || param.byValue) return;
      const what = `passée à un paramètre modifiable ${param.name}`;
      if (arg.valueType !== 'identifier') {
        // Un indicateur *INxx est une variable : l'évaluation le traite comme avant
        if (arg.valueType === 'special' && /^\*in(lr|\d\d)$/.test(arg.value)) return;
        throw incompatibleTypes(`Valeur ou expression ${what}`);
      }
      const name = String(arg.value);
      const owner = name.split('.')[0]; // d.x : la structure de données porte le nom visible
      if (!this.runtime.hasVariable(owner)) {
        try {
          this.runtime.getConstant(name);
        } catch {
          return; // Ni variable ni constante : l'évaluation signalera l'erreur
        }
        throw incompatibleTypes(`Constante ${name} ${what}`);
      }
      if (this.runtime.isReadOnly(owner)) throw incompatibleTypes(`Paramètre CONST ${name} ${what}`);
      const declared = this.runtime.getType(name);
      if (declared && !sameDeclaredType(declared, param.dataType)) {
        throw incompatibleTypes(`Variable ${name} ${describeType(declared)} ${what} ${describeType(param.dataType)}`);
      }
    });
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
    this.checkReferenceArguments(proto.parameters, argExprs);

    const args = argExprs.map((arg, i) => coerce(this.valueFor(arg, proto.parameters[i].dataType, proto.parameters[i].name), proto.parameters[i].dataType, proto.parameters[i].name));
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
    this.assignTo(node.variable, this.valueFor(node.value, this.runtime.getType(node.variable), node.variable));
  }

  private assignTo(variable: string, value: any): void {
    if (!variable.includes('.') && isDataStructure(this.runtime.lookup(variable))) throw this.dataStructureAsValue(variable);
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
    if (typeof value !== 'boolean') {
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

  // Variable ou borne d'une boucle FOR : un nombre
  private numericBound(expr: ExpressionNode, what: string): any {
    const value = this.evaluate(expr);
    if (typeof value !== 'number') {
      throw incompatibleTypes(`FOR, ${what} ${describeValue(value)}`);
    }
    return value;
  }

  private executeLoop(node: any): void {
    if (node.loopType === 'for') {
      // La variable de boucle est relue à chaque tour : le corps peut la modifier,
      // et elle vaut limite + pas en sortie de boucle, comme en RPG.
      const varName = node.variable;
      const loopType = this.runtime.getType(varName);
      if (loopType && !['int', 'uns', 'packed', 'zoned'].includes(loopType.typeName)) {
        throw incompatibleTypes(`FOR, variable ${varName} ${describeType(loopType)}`);
      }
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

  private dataStructureAsValue(name: string): Error {
    return new NotSupportedError(`Structure de données ${name.toUpperCase()} utilisée comme valeur`);
  }

  private executeDsply(node: any): void {
    let msg = '';
    if (node.message) {
      // Les blancs de fin d'un char sont invisibles à l'écran
      const value = this.evaluate(node.message);
      if (isDuration(value)) throw incompatibleTypes(`DSPLY ${describeValue(value)}`);
      msg = String(value).trimEnd();
    }

    let queueInfo = '';
    if (node.queue) {
      // File vide ou *BLANK : file par défaut, rien à afficher
      const queue = String(this.evaluate(node.queue)).trim();
      if (queue !== '' && !/^\*blanks?$/i.test(queue)) queueInfo = ` (File: ${queue})`;
    }
    const extenderInfo = node.hasErrorExtender ? ' [Gestion d\'erreur active]' : '';

    this.runtime.addOutput(`[DSPLY${extenderInfo}] ${msg}${queueInfo}`);

    if (node.responseVar) {
      // La réponse simulée est un caractère : les autres types de variable ne sont pas pris en charge
      const responseType = this.runtime.getType(node.responseVar);
      if (responseType && responseType.typeName !== 'char' && responseType.typeName !== 'varchar') {
        throw new NotSupportedError(`Réponse de DSPLY dans une variable de type ${describeType(responseType)}`);
      }
      const simulatedResponse = 'Y'; 
      this.runtime.addOutput(`  -> (Simulé) Réponse '${simulatedResponse}' enregistrée dans la variable '${node.responseVar}'`);
      this.assignTo(node.responseVar, simulatedResponse);
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
    const returnType = this.returnTypes[this.returnTypes.length - 1];
    throw new ReturnSignal(node.value ? this.valueFor(node.value, returnType, 'valeur de retour') : undefined);
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
          const value = this.runtime.getVariable(expr.value);
          if (isDataStructure(value)) throw this.dataStructureAsValue(expr.value);
          return value;
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
      if (FILE_BUILTINS.has(builtin)) return this.fileBuiltin(expr.value.name, expr.value.args);
      const isChar = builtin === '%char';
      // Le 2e argument (*ISO) est un format, inutile à évaluer
      const args = (isChar ? expr.value.args.slice(0, 1) : expr.value.args).map((arg: ExpressionNode) => this.evaluate(arg));
      // L'argument d'une durée doit être un entier garanti, quelle que soit sa valeur
      if (DURATION_BUILTINS.has(builtin) && typeof args[0] === 'number' && !this.isWholeNumberExpression(expr.value.args[0])) {
        throw new Error(`${expr.value.name.toUpperCase()} d'une valeur qui peut avoir des décimales : pas encore supporté par l'interpréteur`);
      }
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

  // Vrai si l'expression est numérique sans décimales par construction (pas selon sa valeur)
  private isWholeNumberExpression(expr: ExpressionNode | undefined): boolean {
    if (!expr) return false;
    if (expr.operator) {
      if (expr.operator === 'neg') return this.isWholeNumberExpression(expr.left);
      if (['+', '-', '*'].includes(expr.operator)) return this.isWholeNumberExpression(expr.left) && this.isWholeNumberExpression(expr.right);
      return false;
    }
    if (expr.valueType === 'number') return !expr.hasDecimalPoint;
    if (expr.valueType === 'builtin') return WHOLE_NUMBER_BUILTINS.has(expr.value.name.toLowerCase());
    const type = this.declaredType(expr);
    if (!type) return false;
    if (type.typeName === 'int' || type.typeName === 'uns') return true;
    return (type.typeName === 'packed' || type.typeName === 'zoned') && !type.decimals;
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

  // *ZEROS / *BLANKS face à une autre valeur : ils prennent sa nature (texte : blancs ou zéros à sa longueur)
  private zeroOrBlankLike(name: string, other: any): any {
    const zeros = name.startsWith('*zero');
    if (typeof other === 'string') return zeros ? '0'.repeat(other.length) : '';
    if (typeof other === 'number') {
      if (!zeros) throw incompatibleTypes(`Comparaison de ${name.toUpperCase()} avec ${describeValue(other)}`);
      return 0;
    }
    if (typeof other === 'boolean') throw new NotSupportedError(`Comparaison de ${name.toUpperCase()} avec un indicateur`);
    return zeros ? 0 : '';
  }

  private executeOperator(expr: ExpressionNode): any {
    const op = expr.operator!;
    let left: any;
    let right: any;
    if (COMPARISONS[op] && isZeroOrBlank(expr.left) !== isZeroOrBlank(expr.right)) {
      if (isZeroOrBlank(expr.left)) {
        right = this.evaluate(expr.right!);
        left = this.zeroOrBlankLike(expr.left!.value, right);
      } else {
        left = this.evaluate(expr.left!);
        right = this.zeroOrBlankLike(expr.right!.value, left);
      }
    } else {
      left = expr.left ? this.evaluate(expr.left) : undefined;
      right = expr.right ? this.evaluate(expr.right) : undefined;
    }
    if (involvesDateTime(left) || involvesDateTime(right)) {
      return dateTimeOperation(op, left, right);
    }

    const refuse = () => incompatibleTypes(
      op === 'neg' || op === 'not'
        ? `Opérateur ${op === 'neg' ? '-' : 'NOT'} appliqué à ${describeValue(left)}`
        : `Opérateur ${op.toUpperCase()} entre ${describeValue(left)} et ${describeValue(right)}`);
    const isNum = (v: any) => typeof v === 'number';
    const isText = (v: any) => typeof v === 'string';
    const isInd = (v: any) => typeof v === 'boolean';
    const unknown = left === null || left === undefined || (op !== 'neg' && op !== 'not' && (right === null || right === undefined));

    switch (op) {
      case '+':
        if (isNum(left) && isNum(right)) return left + right;
        if (isText(left) && isText(right)) return left + right;
        if ((isText(left) && isInd(right)) || (isInd(left) && isText(right))) {
          throw new NotSupportedError('Indicateur dans une concaténation');
        }
        if (!unknown) throw refuse();
        return left + right;
      case '-': case '*': case '/': case '**':
        if (!unknown && !(isNum(left) && isNum(right))) throw refuse();
        if (op === '-') return left - right;
        if (op === '*') return left * right;
        if (op === '**') return Math.pow(left, right);
        if (right === 0) throw new RpgError(STATUS_DIVIDE_BY_ZERO, 'Division par zéro (RNX0102)');
        return left / right;
      case '=': case '<>': case '<': case '<=': case '>': case '>=': {
        const comparable = (isNum(left) && isNum(right)) || (isText(left) && isText(right)) || (isInd(left) && isInd(right))
          || (isInd(left) && isText(right)) || (isText(left) && isInd(right));
        if (!unknown && !comparable) throw refuse();
        return COMPARISONS[op](compare(left, right));
      }
      case 'and': case 'or':
        if (!unknown && !(isInd(left) && isInd(right))) throw refuse();
        return op === 'and' ? left && right : left || right;
      case 'not':
        if (!isInd(left)) throw refuse();
        return !left;
      case 'neg':
        if (!isNum(left)) throw refuse();
        return -left;
      default: throw new Error(`Opérateur non supporté: ${expr.operator}`);
    }
  }
}