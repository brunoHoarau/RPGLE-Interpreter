import { ExecutionContext, emptyContext } from './context';
import { SQLEngine, SQLResult, HostVariables } from './sql-engine';
import { DataTypeNode } from './types';
import { coerce } from './datatypes';

// Portée de noms : le programme principal (globale) ou un appel de procédure (locale)
interface Scope {
  variables: Map<string, any>;
  constants: Map<string, any>;
  types: Map<string, DataTypeNode>; // Clés : 'var' ou 'ds.champ', en minuscules
  aliases: Map<string, string>;     // Champ de DS non qualifiée -> nom de la DS
}

const newScope = (): Scope => ({ variables: new Map(), constants: new Map(), types: new Map(), aliases: new Map() });

// Un nom visible est une variable, ou un champ de DS non qualifiée (dsName renseigné)
interface Resolved {
  scope: Scope;
  dsName?: string;
}

export interface FieldDeclaration {
  name: string;
  type: DataTypeNode;
  value: any;
}

export class Runtime {
  private globals: Scope = newScope();
  private frames: Scope[] = [];
  private procedures: Map<string, Function> = new Map();
  private files: Map<string, any[]> = new Map();
  private output: string[] = [];
  private callStack: string[] = [];

  private filePointers: Map<string, number> = new Map();
  private fileStatus: Map<string, { found: boolean; eof: boolean }> = new Map();

  // 🆕 NOUVEAUX ÉLÉMENTS (avec 'private')
  private context: ExecutionContext;
  private sqlEngine: SQLEngine;
  public lastSQLResult: SQLResult = { rows: [], rowCount: 0, sqlCode: 0, sqlState: '00000' };

  constructor(context?: ExecutionContext) {
    // ✅ UTILISATION DE this.context
    this.context = context || emptyContext();
    this.sqlEngine = new SQLEngine(this.context);
    this.initializeBuiltinFunctions();
  }

  private get currentScope(): Scope {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : this.globals;
  }

  // Une procédure voit ses noms locaux puis les globaux, jamais ceux de son appelant
  private visibleScopes(): Scope[] {
    return this.frames.length > 0 ? [this.currentScope, this.globals] : [this.globals];
  }

  private findScope(kind: 'variables' | 'constants', name: string): Scope | undefined {
    const key = name.toLowerCase();
    return this.visibleScopes().find(scope => scope[kind].has(key));
  }

  private resolve(name: string): Resolved | undefined {
    const key = name.toLowerCase();
    for (const scope of this.visibleScopes()) {
      if (scope.variables.has(key)) return { scope };
      const dsName = scope.aliases.get(key);
      if (dsName !== undefined) return { scope, dsName };
    }
    return undefined;
  }

  private assertUndeclared(name: string): void {
    const key = name.toLowerCase();
    if (this.currentScope.variables.has(key) || this.currentScope.aliases.has(key)) {
      throw new Error(`'${name}' est déjà déclaré`);
    }
  }

  // Déclare une variable dans la portée courante (dcl-s, paramètre) ;
  // son type s'applique ensuite à chaque affectation
  declareVariable(name: string, value: any, type?: DataTypeNode): void {
    const key = name.toLowerCase();
    if (this.currentScope.aliases.has(key)) {
      throw new Error(`'${name}' est déjà déclaré`);
    }
    if (type) {
      this.currentScope.types.set(key, type);
    } else {
      this.currentScope.types.delete(key);
    }
    this.currentScope.variables.set(key, coerce(value, type, name));
  }

  // Les champs sont indexés en minuscules : ds.Champ et DS.CHAMP désignent le même champ.
  // Les champs d'une DS non qualifiée sont aussi accessibles directement par leur nom.
  declareDataStructure(name: string, fields: FieldDeclaration[], qualified: boolean): void {
    const ds: any = {};
    for (const field of fields) {
      const key = field.name.toLowerCase();
      if (!qualified) {
        this.assertUndeclared(field.name);
        this.currentScope.aliases.set(key, name.toLowerCase());
      }
      this.currentScope.types.set(`${name.toLowerCase()}.${key}`, field.type);
      ds[key] = coerce(field.value, field.type, `${name}.${field.name}`);
    }
    this.declareVariable(name, ds);
  }

  // Affecte la variable visible ; la crée dans la portée courante si elle n'existe pas
  setVariable(name: string, value: any): void {
    const resolved = this.resolve(name);
    if (resolved?.dsName) {
      this.setField(resolved.dsName, name, value);
      return;
    }
    const key = name.toLowerCase();
    const scope = resolved?.scope ?? this.currentScope;
    scope.variables.set(key, coerce(value, scope.types.get(key), name));
  }

  getField(dsName: string, field: string): any {
    const ds = this.getVariable(dsName);
    const key = field.toLowerCase();
    if (typeof ds !== 'object' || ds === null || !(key in ds)) {
      throw new Error(`Champ '${field}' non trouvé dans '${dsName}'`);
    }
    return ds[key];
  }

  setField(dsName: string, field: string, value: any): void {
    this.getField(dsName, field); // Vérifie que le champ existe
    this.getVariable(dsName)[field.toLowerCase()] = coerce(value, this.getType(`${dsName}.${field}`), `${dsName}.${field}`);
  }

  // Type déclaré d'une variable ('nom') ou d'un champ de DS ('ds.champ' ou 'champ' si non qualifiée)
  getType(name: string): DataTypeNode | undefined {
    const [owner, field] = name.toLowerCase().split('.');
    const resolved = this.resolve(owner);
    if (!resolved) return undefined;
    if (resolved.dsName) return resolved.scope.types.get(`${resolved.dsName}.${owner}`);
    return resolved.scope.types.get(field === undefined ? owner : `${owner}.${field}`);
  }

  // Valeur d'un nom visible, undefined s'il n'existe pas ou n'a pas de valeur
  private lookup(name: string): any {
    const resolved = this.resolve(name);
    if (!resolved) return undefined;
    return resolved.dsName
      ? this.getField(resolved.dsName, name)
      : resolved.scope.variables.get(name.toLowerCase());
  }

  getVariable(name: string): any {
    const value = this.lookup(name);
    if (value === undefined) {
      throw new Error(`Variable non déclarée: ${name}`);
    }
    return value;
  }

  hasVariable(name: string): boolean {
    return this.resolve(name) !== undefined;
  }

  setConstant(name: string, value: any): void {
    this.currentScope.constants.set(name.toLowerCase(), value);
  }

  getConstant(name: string): any {
    const value = this.findScope('constants', name)?.constants.get(name.toLowerCase());
    if (value === undefined) {
      throw new Error(`Constante non déclarée: ${name}`);
    }
    return value;
  }

  pushFrame(procName: string): void {
    this.frames.push(newScope());
    this.callStack.push(procName);
  }

  popFrame(): void {
    this.frames.pop();
    this.callStack.pop();
  }

  get callDepth(): number {
    return this.frames.length;
  }

  // Variables hôtes SQL résolues dans la portée courante
  private hostVariables(): HostVariables {
    return {
      get: name => this.lookup(name),
      set: (name, value) => this.setVariable(name, value),
    };
  }

  registerProcedure(name: string, proc: Function): void {
    this.procedures.set(name.toLowerCase(), proc);
  }

  callProcedure(name: string, args: any[]): any {
    const proc = this.procedures.get(name.toLowerCase());
    if (!proc) {
      throw new Error(`Procédure non trouvée: ${name}`);
    }

    this.callStack.push(name);
    try {
      return proc(...args);
    } finally {
      this.callStack.pop();
    }
  }

  declareFile(name: string, data: any[] = []): void {
    this.files.set(name.toLowerCase(), data);
    this.filePointers.set(name.toLowerCase(), 0);
    this.fileStatus.set(name.toLowerCase(), { found: false, eof: false });
  }

  setll(fileName: string, key?: any): boolean {
    const file = this.files.get(fileName.toLowerCase());
    if (!file) throw new Error(`Fichier non déclaré: ${fileName}`);

    this.filePointers.set(fileName.toLowerCase(), 0);
    const status = this.fileStatus.get(fileName.toLowerCase())!;
    status.found = false;
    status.eof = false;
    return true;
  }

  read(fileName: string): any {
    const file = this.files.get(fileName.toLowerCase());
    if (!file) throw new Error(`Fichier non déclaré: ${fileName}`);

    const pointer = this.filePointers.get(fileName.toLowerCase())!;
    const status = this.fileStatus.get(fileName.toLowerCase())!;

    if (pointer >= file.length) {
      status.eof = true;
      status.found = false;
      return null;
    }

    const record = file[pointer];
    this.filePointers.set(fileName.toLowerCase(), pointer + 1);
    status.found = true;
    status.eof = false;
    return record;
  }

  chain(fileName: string, key: any): any {
    const file = this.files.get(fileName.toLowerCase());
    if (!file) throw new Error(`Fichier non déclaré: ${fileName}`);

    const status = this.fileStatus.get(fileName.toLowerCase())!;
    const record = file.find(r => r.id === key || r.key === key);

    if (record) {
      status.found = true;
      status.eof = false;
      return record;
    } else {
      status.found = false;
      return null;
    }
  }

  getFileStatus(fileName: string): { found: boolean; eof: boolean } {
    return this.fileStatus.get(fileName.toLowerCase()) || { found: false, eof: true };
  }

  // 🆕 Exécution SQL
  executeSQL(sql: string): SQLResult {
    this.lastSQLResult = this.sqlEngine.execute(sql, this.hostVariables());
    return this.lastSQLResult;
  }

  // 🆕 Accès au contexte
  getContext(): ExecutionContext {
    return this.context;
  }

  executeBuiltin(name: string, args: any[]): any {
    const proc = this.procedures.get(name.toLowerCase());
    if (!proc) {
      throw new Error(`Fonction intégrée non supportée: ${name}`);
    }
    return proc(...args);
  }

  addOutput(message: string): void {
    this.output.push(message);
  }

  getOutput(): string[] {
    return [...this.output];
  }

  clearOutput(): void {
    this.output = [];
  }

  reset(): void {
    this.globals = newScope();
    this.frames = [];
    this.files.clear();
    this.filePointers.clear();
    this.fileStatus.clear();
    this.output = [];
    this.callStack = [];
    // Note: on ne réinitialise pas this.context car il est en lecture seule pour la session
  }

  getCallStack(): string[] {
    return [...this.callStack];
  }

  private initializeBuiltinFunctions(): void {
    this.registerProcedure('%len', (str: any) => String(str).length);
    this.registerProcedure('%trim', (str: any) => String(str).trim());
    this.registerProcedure('%trimr', (str: any) => String(str).trimEnd());
    this.registerProcedure('%triml', (str: any) => String(str).trimStart());
    this.registerProcedure('%subst', (source: any, start: number, length?: number) => {
      const str = String(source);
      const startPos = start - 1;
      return length !== undefined ? str.substr(startPos, length) : str.substr(startPos);
    });
    this.registerProcedure('%int', (value: any) => parseInt(value));
    this.registerProcedure('%dec', (value: any, precision?: number, decimals?: number) => {
      const num = parseFloat(value);
      return decimals !== undefined ? parseFloat(num.toFixed(decimals)) : num;
    });
    this.registerProcedure('%char', (value: any) => String(value));
    this.registerProcedure('%scan', (search: any, source: any) => {
      const pos = String(source).indexOf(String(search));
      return pos === -1 ? 0 : pos + 1;
    });
    this.registerProcedure('%upper', (str: any) => String(str).toUpperCase());
    this.registerProcedure('%lower', (str: any) => String(str).toLowerCase());
    this.registerProcedure('%replace', (newStr: any, source: any, start: number, length?: number) => {
      const str = String(source);
      const startPos = start - 1;
      const len = length !== undefined ? length : String(newStr).length;
      return str.substr(0, startPos) + String(newStr) + str.substr(startPos + len);
    });
    this.registerProcedure('%check', (comparator: any, base: any, start: number = 1) => {
      const comp = String(comparator);
      const baseStr = String(base);
      const startPos = start - 1;
      for (let i = startPos; i < baseStr.length; i++) {
        if (comp.indexOf(baseStr[i]) === -1) return i + 1;
      }
      return 0;
    });
    this.registerProcedure('%abs', (value: number) => Math.abs(value));
    this.registerProcedure('%max', (...values: number[]) => Math.max(...values));
    this.registerProcedure('%min', (...values: number[]) => Math.min(...values));
    this.registerProcedure('%rem', (dividend: number, divisor: number) => dividend % divisor);
    this.registerProcedure('%div', (dividend: number, divisor: number) => Math.floor(dividend / divisor));
  }
}