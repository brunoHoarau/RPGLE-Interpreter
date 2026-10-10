import { ExecutionContext, emptyContext } from './context';
import { SQLEngine, SQLResult, HostVariables } from './sql-engine';
import { DataTypeNode } from './types';
import { coerce } from './datatypes';
import { BUILTINS } from './builtins';
import { DsShape, DsOrigin } from './ds-shape';
import { ArrayStore, elementCount, readElement, writeElement, nextIndex } from './arrays';
import { NotSupportedError } from './errors';

// Portée de noms : le programme principal (globale) ou un appel de procédure (locale)
// Type marqueur des tableaux de DS (comparé par identité)
const DS_ELEMENT_TYPE: DataTypeNode = { type: 'DataType', typeName: 'ds' };

interface Scope {
  variables: Map<string, any>;
  constants: Map<string, any>;
  types: Map<string, DataTypeNode>; // Clés : 'var' ou 'ds.champ', en minuscules
  aliases: Map<string, string>;     // Champ de DS non qualifiée -> nom de la DS
  readOnly: Set<string>;            // Paramètres CONST de l'appel (minuscules)
  shapes: Map<string, DsShape>;     // Disposition et origine de chaque DS déclarée (minuscules)
  arrays: Map<string, ArrayStore>;  // Tableaux DIM (minuscules) ; leur type d'élément est dans `types`
}

const newScope = (): Scope => ({ variables: new Map(), constants: new Map(), types: new Map(), aliases: new Map(), readOnly: new Set(), shapes: new Map(), arrays: new Map() });

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
  private output: string[] = [];
  public status = 0; // Code de la dernière erreur interceptée par MONITOR (%STATUS)
  private callStack: string[] = [];

  // 🆕 NOUVEAUX ÉLÉMENTS (avec 'private')
  private context: ExecutionContext;
  private sqlEngine: SQLEngine;
  public lastSQLResult: SQLResult = { rows: [], rowCount: 0, sqlCode: 0, sqlState: '00000' };

  constructor(context?: ExecutionContext, private clock: () => Date = () => new Date()) {
    // ✅ UTILISATION DE this.context
    this.context = context || emptyContext();
    this.sqlEngine = new SQLEngine(this.context);
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
      if (scope.variables.has(key) || scope.arrays.has(key)) return { scope };
      const dsName = scope.aliases.get(key);
      if (dsName !== undefined) return { scope, dsName };
    }
    return undefined;
  }

  private assertUndeclared(name: string): void {
    const key = name.toLowerCase();
    if (this.currentScope.variables.has(key) || this.currentScope.arrays.has(key) || this.currentScope.aliases.has(key)) {
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
    this.currentScope.arrays.delete(key);
    if (type) {
      this.currentScope.types.set(key, type);
    } else {
      this.currentScope.types.delete(key);
    }
    this.currentScope.variables.set(key, coerce(value, type, name));
  }

  // Les champs sont indexés en minuscules : ds.Champ et DS.CHAMP désignent le même champ.
  // Les champs d'une DS non qualifiée sont aussi accessibles directement par leur nom.
  // link : origine (fichier) et filiation (racine) héritées d'une DS source (LIKEDS) ou propres à la DS (LIKEREC, EXTNAME)
  declareDataStructure(name: string, fields: FieldDeclaration[], qualified: boolean, link: { origin?: DsOrigin; root?: number } = {}, dim?: { max: number; auto: boolean }): void {
    const ds: any = {};
    const shape: DsShape = { fields: [], initial: {}, origin: link.origin, root: link.root ?? ++this.lastRoot };
    for (const field of fields) {
      const key = field.name.toLowerCase();
      if (!qualified) {
        this.assertUndeclared(field.name);
        this.currentScope.aliases.set(key, name.toLowerCase());
      }
      this.currentScope.types.set(`${name.toLowerCase()}.${key}`, field.type);
      ds[key] = coerce(field.value, field.type, `${name}.${field.name}`);
      shape.fields.push({ name: field.name, type: field.type });
      shape.initial[key] = ds[key];
    }
    if (dim) {
      // DS tableau : chaque élément naît comme une copie de la DS initiale ; les types 'ds.champ' sont ceux d'une DS
      this.assertUndeclared(name);
      this.currentScope.arrays.set(name.toLowerCase(), { values: [], max: dim.max, auto: dim.auto, type: DS_ELEMENT_TYPE, fresh: () => ({ ...shape.initial }) });
    } else {
      this.declareVariable(name, ds);
    }
    this.currentScope.shapes.set(name.toLowerCase(), shape);
  }

  // Disposition et origine d'une DS visible (undefined si le nom n'est pas une DS déclarée)
  getShape(name: string): DsShape | undefined {
    const resolved = this.resolve(name);
    return resolved && !resolved.dsName ? resolved.scope.shapes.get(name.toLowerCase()) : undefined;
  }

  // Mémorise la disposition d'une DS qui n'est pas déclarée par declareDataStructure (paramètre DS)
  setShape(name: string, shape: DsShape): void {
    this.currentScope.shapes.set(name.toLowerCase(), shape);
  }

  private lastRoot = 0;

  // Affecte la variable visible ; la crée dans la portée courante si elle n'existe pas
  setVariable(name: string, value: any): void {
    const resolved = this.resolve(name);
    if (resolved?.dsName) {
      this.setField(resolved.dsName, name, value);
      return;
    }
    const key = name.toLowerCase();
    const scope = resolved?.scope ?? this.currentScope;
    if (scope.arrays.has(key)) throw this.wholeArray(name);
    scope.variables.set(key, coerce(value, scope.types.get(key), name));
  }

  // Tableau DIM : max éléments, ou *AUTO jusqu'à max ; fresh() donne la valeur initiale d'un élément
  declareArray(name: string, type: DataTypeNode, max: number, auto: boolean, fresh: () => any): void {
    const key = name.toLowerCase();
    this.assertUndeclared(name);
    this.currentScope.types.set(key, type);
    this.currentScope.arrays.set(key, { values: [], max, auto, type, fresh });
  }

  private arrayOf(name: string): { store: ArrayStore; type: DataTypeNode } | undefined {
    const resolved = this.resolve(name);
    const store = resolved?.scope.arrays.get(name.toLowerCase());
    return store && { store, type: store.type };
  }

  isArray(name: string): boolean {
    return this.arrayOf(name) !== undefined;
  }

  wholeArray(name: string): Error {
    return new NotSupportedError(`Opération sur le tableau entier ${name.toUpperCase()}`);
  }

  private array(name: string): ArrayStore {
    const found = this.arrayOf(name);
    if (!found) throw new Error(`'${name}' n'est pas un tableau`);
    return found.store;
  }

  // Nombre d'éléments : DIM, ou nombre courant d'un tableau *AUTO (%ELEM)
  arrayCount(name: string): number {
    return elementCount(this.array(name));
  }

  isDsArray(name: string): boolean {
    return this.arrayOf(name)?.store.type === DS_ELEMENT_TYPE;
  }

  // Sous-zone d'un élément de DS tableau, en lecture
  getElementField(name: string, index: number, field: string): any {
    const element = this.getElement(name, index);
    const key = field.toLowerCase();
    if (!(key in element)) throw new Error(`Champ '${field}' non trouvé dans '${name}'`);
    return element[key];
  }

  // Écriture de sous-zones dans un élément de DS tableau (créé à la demande, comme une écriture d'élément) ;
  // chaque valeur passe par la coercition du type de sa sous-zone
  setElementFields(name: string, index: number | '*next', entries: [string, any][]): void {
    const store = this.array(name);
    const at = index === '*next' ? nextIndex(store) : index;
    const values = entries.map(([field, value]) => {
      const key = field.toLowerCase();
      const type = this.getType(`${name}.${key}`);
      if (!type) throw new Error(`Champ '${field}' non trouvé dans '${name}'`);
      return [key, coerce(value, type, `${name}(${at}).${field}`)] as [string, any];
    });
    if (at < 1 || at > store.values.length) writeElement(store, name, at, store.fresh());
    for (const [key, value] of values) store.values[at - 1][key] = value;
  }

  isAutoArray(name: string): boolean {
    return this.array(name).auto;
  }

  getElement(name: string, index: number): any {
    return readElement(this.array(name), name, index);
  }

  // index : numéro 1..DIM, ou '*next' (élément suivant d'un tableau *AUTO)
  setElement(name: string, index: number | '*next', value: any): void {
    const store = this.array(name);
    const at = index === '*next' ? nextIndex(store) : index;
    writeElement(store, name, at, coerce(value, store.type, `${name}(${at})`));
  }

  // Affecte une variable globale, même depuis une procédure (zones des fichiers)
  setGlobal(name: string, value: any): void {
    const key = name.toLowerCase();
    this.globals.variables.set(key, coerce(value, this.globals.types.get(key), name));
  }

  // Valeur d'une variable globale, même depuis une procédure qui a une variable locale de même nom (zones des fichiers)
  getGlobal(name: string): any {
    return this.globals.variables.get(name.toLowerCase());
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
  lookup(name: string): any {
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

  // Paramètre CONST de la procédure en cours : il ne peut pas être transmis à un paramètre modifiable
  markReadOnly(name: string): void {
    this.currentScope.readOnly.add(name.toLowerCase());
  }

  isReadOnly(name: string): boolean {
    // La portée qui porte le nom : paramètre CONST de la procédure en cours ou du programme principal
    return this.resolve(name)?.scope.readOnly.has(name.toLowerCase()) ?? false;
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
    // :ds.champ désigne un champ de DS ; :nom une variable (ou un champ de DS non qualifiée)
    const split = (name: string): [string, string] | undefined => {
      const dot = name.indexOf('.');
      return dot < 0 ? undefined : [name.slice(0, dot), name.slice(dot + 1)];
    };
    return {
      get: name => {
        const parts = split(name);
        if (!parts) return this.lookup(name);
        return this.lookup(parts[0]) === undefined ? undefined : this.getField(parts[0], parts[1]);
      },
      set: (name, value) => {
        const parts = split(name);
        if (parts) this.setField(parts[0], parts[1], value);
        else this.setVariable(name, value);
      },
      type: name => this.getType(name),
    };
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
    const builtin = BUILTINS[name.toLowerCase()];
    if (!builtin) {
      throw new Error(`Fonction intégrée non supportée: ${name}`);
    }
    return builtin(this, ...args);
  }

  // Instant présent : *SYS, *JOB, %DATE()... (horloge injectable pour les tests)
  now(): Date {
    return this.clock();
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
    this.status = 0;
    this.output = [];
    this.callStack = [];
    // Note: on ne réinitialise pas this.context car il est en lecture seule pour la session
  }

  getCallStack(): string[] {
    return [...this.callStack];
  }
}