// Fichiers natifs (DCL-F) simulés sur les tables de context/tables.json.
// Les opérations renvoient l'enregistrement et les indicateurs ; elles ne lèvent
// aucune erreur d'exécution RPG (statuts gérés par l'interpréteur).
import { DataTypeNode } from './types';
import { isDateTimeType, kindOf, parseIso } from './datetime';
import { NotSupportedError, incompatibleTypes } from './errors';
import { describeType } from './datatypes';

export interface FieldDefinition {
  name: string;          // En majuscules
  type: DataTypeNode;
}

export interface FileResult {
  record?: any;
  found: boolean;
  eof: boolean;
  equal: boolean;
}

export type FileSpecial = 'start' | 'end';

const NUMERIC = new Set(['int', 'uns', 'packed', 'zoned']);
const dataType = (typeName: string, length?: number, decimals?: number): DataTypeNode =>
  ({ type: 'DataType', typeName, length, decimals });

// Type d'une zone, écrit en RPG (packed(7:0)) ou en SQL (DECIMAL(9,2)) ; undefined si inconnu
export function parseFieldType(text: string): DataTypeNode | undefined {
  const m = /^([a-z]+)(?:\((\d+)(?:[:,](\d+))?\))?$/.exec(String(text).toLowerCase().replace(/\s+/g, ''));
  if (!m) return undefined;
  const [, name, a, b] = m;
  const length = a === undefined ? undefined : Number(a);
  const decimals = b === undefined ? undefined : Number(b);
  switch (name) {
    case 'char': case 'varchar':
      return length !== undefined && decimals === undefined ? dataType(name, length) : undefined;
    case 'packed': case 'decimal': case 'dec':
      return length !== undefined ? dataType('packed', length, decimals ?? 0) : undefined;
    case 'zoned': case 'numeric':
      return length !== undefined ? dataType('zoned', length, decimals ?? 0) : undefined;
    case 'int': case 'uns':
      return [3, 5, 10, 20].includes(length ?? 10) && decimals === undefined ? dataType(name, length ?? 10) : undefined;
    case 'integer': return a === undefined ? dataType('int', 10) : undefined;
    case 'smallint': return a === undefined ? dataType('int', 5) : undefined;
    case 'bigint': return a === undefined ? dataType('int', 20) : undefined;
    case 'ind': case 'date': case 'time': case 'timestamp':
      return a === undefined ? dataType(name) : undefined;
    default: return undefined;
  }
}

// Collation EBCDIC des caractères invariants (identiques dans tous les CCSID EBCDIC latins)
const EBCDIC: { [ch: string]: number } = (() => {
  const map: { [ch: string]: number } = { ' ': 0x40, '.': 0x4b, '<': 0x4c, '(': 0x4d, '+': 0x4e, '&': 0x50,
    '*': 0x5c, ')': 0x5d, ';': 0x5e, '-': 0x60, '/': 0x61, ',': 0x6b, '%': 0x6c, '_': 0x6d, '>': 0x6e,
    '?': 0x6f, ':': 0x7a, "'": 0x7d, '=': 0x7e, '"': 0x7f };
  const range = (from: string, to: string, start: number) => {
    for (let c = from.charCodeAt(0), i = 0; c <= to.charCodeAt(0); c++, i++) map[String.fromCharCode(c)] = start + i;
  };
  range('a', 'i', 0x81); range('j', 'r', 0x91); range('s', 'z', 0xa2);
  range('A', 'I', 0xc1); range('J', 'R', 0xd1); range('S', 'Z', 0xe2);
  range('0', '9', 0xf0);
  return map;
})();

// Texte comparable dans l'ordre EBCDIC d'IBM i (blancs de fin ignorés)
export function ebcdicKey(text: string): string {
  let result = '';
  for (const ch of text.replace(/ +$/, '')) {
    const code = EBCDIC[ch];
    if (code === undefined) throw new NotSupportedError(`Clé contenant le caractère '${ch}' (ordre EBCDIC non simulé)`);
    result += String.fromCharCode(code);
  }
  return result;
}

const INT_BITS: { [digits: number]: number } = { 3: 8, 5: 16, 10: 32, 20: 64 };

// La valeur tient-elle dans la zone sans troncature ni arrondi ? (texte : blancs de fin ignorés)
export function fitsField(value: any, type: DataTypeNode): boolean {
  const kind = type.typeName;
  if (kind === 'int' || kind === 'uns') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return false;
    const bits = INT_BITS[type.length ?? 10] ?? 32;
    const [min, max] = kind === 'int' ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] : [0, 2 ** bits - 1];
    return value >= min && value <= max;
  }
  if (kind === 'packed' || kind === 'zoned') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const decimals = type.decimals ?? 0;
    const n = normalize(value);
    if (Number(n.toFixed(decimals)) !== n) return false;
    return Math.abs(n) < 10 ** ((type.length ?? 15) - decimals);
  }
  if (kind === 'char' || kind === 'varchar') {
    return type.length === undefined || String(value).replace(/ +$/, '').length <= type.length;
  }
  return true;
}

// Absorbe les erreurs d'arrondi binaire (0.1 + 0.2)
const normalize = (n: number): number => Number(n.toPrecision(15));

type Cursor =
  | { side: 'before' | 'after'; at: any[] | FileSpecial }   // SETLL, SETGT, *START, *END, fin ou début de fichier
  | { side: 'on'; at: any[] }                               // Sur le dernier enregistrement lu (READx, CHAIN trouvé)
  | { side: 'lost' };                                       // Position IBM i non vérifiée

interface Item { row: any; key: any[] }
// Clé d'une ligne : colonnes et valeurs dont elle est tirée, génération du dernier tri qui contenait la ligne
interface KeyEntry { columns: (string | undefined)[]; raw: any[]; key: any[]; sort: number }

export class NativeFile {
  private sequence = new WeakMap<object, number>();
  private nextSequence = 0;
  private cursor: Cursor = { side: 'before', at: 'start' };
  private eofReached: 'read' | 'readp' | undefined;   // dernière lecture ayant donné %EOF, sans repositionnement
  // Numéros d'enregistrement : toutes les lignes déjà vues, et les tableaux sources déjà vus
  // (le moteur SQL crée un tableau à chaque DELETE : l'ancien garde les lignes insérées puis supprimées)
  private seen = new Set<object>();
  private arrays: any[][] = [];
  // Cache : clé de tri par ligne (recalculée si une zone clé change), ordre trié par tableau source
  private keys_ = new WeakMap<object, KeyEntry>();
  private recomputed = false;
  private sorted: { source: any[]; length: number; revision: number | undefined; items: Item[] } | undefined;
  private generation = 0;
  // Dernier enregistrement rendu (la position reste sur lui) et sa clé d'accès au moment de la lecture
  private last: Item | undefined;
  // Enregistrement courant (UPDATE, DELETE) : dernière lecture réussie, ni mise à jour ni supprimée ni déverrouillée
  private current: object | undefined;
  // Enregistrement verrouillé par ce fichier dans le registre partagé
  private held: object | undefined;
  private locks: WeakMap<object, NativeFile>;

  // source : tableau, ou fonction le renvoyant (relue à chaque opération : le moteur SQL peut remplacer le tableau)
  // options.rowsDeleted : des lignes ont-elles été supprimées avant la déclaration du fichier (numéros d'enregistrement décalés) ?
  // options.revision : numéro de version des données (change à chaque modification) ; sans lui, toutes les lignes
  // sont revérifiées à chaque opération
  // options.updatable : fichier ouvert en mise à jour (les lectures réussies verrouillent l'enregistrement)
  // options.uniqueKeys : zones de la clé unique de la table, contrôlées à l'écriture même sans accès par clé
  // options.locks : registre des verrous, partagé par toutes les ouvertures d'une même table
  constructor(readonly name: string, readonly format: string, readonly fields: FieldDefinition[],
              readonly keys: string[], private source: any[] | (() => any[]),
              private options: { rowsDeleted?: () => boolean; revision?: () => number; updatable?: boolean;
                                 uniqueKeys?: string[]; locks?: WeakMap<object, NativeFile> } = {}) {
    for (const key of [...keys, ...(options.uniqueKeys ?? [])]) {
      if (!fields.some(f => f.name === key)) {
        throw new Error(`Zone clé ${key} absente des zones du fichier ${name}`);
      }
    }
    this.locks = options.locks ?? new WeakMap();
    for (const row of this.observe()) {
      this.seen.add(row);
      this.sequenceOf(row);
    }
  }

  private get rows(): any[] {
    return typeof this.source === 'function' ? this.source() : this.source;
  }

  get keyed(): boolean {
    return this.keys.length > 0;
  }

  // Position perdue après un CHAIN non trouvé (position IBM i non vérifiée)
  get positionLost(): boolean {
    return this.cursor.side === 'lost';
  }

  // OPEN : retour au début ; les lignes déjà vues restent connues (un enregistrement supprimé garde son numéro)
  reset(): void {
    this.release();
    this.cursor = { side: 'before', at: 'start' };
    this.eofReached = undefined;
    this.last = undefined;
  }

  read(): FileResult {
    this.checkPosition();
    this.checkCurrentKey();
    if (this.eofReached === 'read') {
      throw new NotSupportedError(`READ de ${this.name} après la fin de fichier (comportement IBM i non vérifié)`);
    }
    this.eofReached = undefined;
    const item = this.next();
    if (!item) {
      this.drop();
      this.cursor = { side: 'after', at: 'end' };
      this.eofReached = 'read';
      return { found: false, eof: true, equal: false };
    }
    return this.readOn(item);
  }

  readp(): FileResult {
    this.checkPosition();
    this.checkCurrentKey();
    if (this.eofReached === 'readp') {
      throw new NotSupportedError(`READP de ${this.name} après le début de fichier (comportement IBM i non vérifié)`);
    }
    this.eofReached = undefined;
    const item = this.previous();
    if (!item) {
      this.drop();
      this.cursor = { side: 'before', at: 'start' };
      this.eofReached = 'readp';
      return { found: false, eof: true, equal: false };
    }
    return this.readOn(item);
  }

  reade(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    this.checkPosition();
    this.checkCurrentKey();
    this.eofReached = undefined;
    const item = this.next();
    if (!item || this.compare(item.key, wanted) !== 0) return this.mismatch();
    return this.readOn(item);
  }

  readpe(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    this.checkPosition();
    this.checkCurrentKey();
    this.eofReached = undefined;
    const item = this.previous();
    if (!item || this.compare(item.key, wanted) !== 0) return this.mismatch();
    return this.readOn(item);
  }

  chain(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    this.eofReached = undefined;
    const item = this.ordered().find(it => this.compare(it.key, wanted) === 0);
    if (!item) {
      this.drop();
      this.cursor = { side: 'lost' };
      return { found: false, eof: false, equal: false };
    }
    return this.readOn(item);
  }

  // Fichier sans clé : lecture par rang d'arrivée (1 = premier)
  chainRrn(n: any): FileResult {
    if (this.keyed) throw new Error(`Fichier ${this.name} avec clé : CHAIN par numéro d'enregistrement impossible`);
    if (typeof n !== 'number') {
      throw incompatibleTypes(`Numéro d'enregistrement ${typeof n === 'string' ? `'${n}'` : String(n)} pour le fichier ${this.name}`);
    }
    if (!Number.isInteger(n) || n < 1) throw new NotSupportedError(`Numéro d'enregistrement ${n} pour le fichier ${this.name}`);
    const items = this.ordered();
    const rows = this.rows;
    const present = new Set<object>(rows);
    const gone = (r: object) => !present.has(r);
    if (this.options.rowsDeleted?.() || [...this.seen].some(gone) || this.arrays.some(a => a.some(gone))) {
      throw new NotSupportedError(`Numéro d'enregistrement du fichier ${this.name} après suppression`);
    }
    this.eofReached = undefined;
    const row = rows[n - 1];
    if (!row) {
      this.drop();
      this.cursor = { side: 'lost' };
      return { found: false, eof: false, equal: false };
    }
    return this.readOn(items.find(it => it.row === row)!);
  }

  setll(key: any[] | FileSpecial): FileResult {
    if (key === 'start' || key === 'end') {
      this.eofReached = undefined;
      this.cursor = key === 'start' ? { side: 'before', at: 'start' } : { side: 'after', at: 'end' };
      return { found: key === 'start' && this.rows.length > 0, eof: false, equal: false };
    }
    const wanted = this.searchKey(key);
    this.eofReached = undefined;
    const items = this.ordered();
    this.cursor = { side: 'before', at: wanted };
    return {
      found: items.some(it => this.compare(it.key, wanted) >= 0),
      eof: false,
      equal: items.some(it => this.compare(it.key, wanted) === 0),
    };
  }

  setgt(key: any[] | FileSpecial): FileResult {
    if (key === 'start' || key === 'end') return this.setll(key);
    const wanted = this.searchKey(key);
    this.eofReached = undefined;
    const items = this.ordered();
    this.cursor = { side: 'after', at: wanted };
    return { found: items.some(it => this.compare(it.key, wanted) > 0), eof: false, equal: false };
  }

  // WRITE : nouvel enregistrement en fin de table ; ni la position ni l'enregistrement courant ne changent
  write(values: { [zone: string]: any }): { failure?: 'duplicate' } {
    const rows = this.observe();
    if (this.duplicates(rows, values, undefined)) return { failure: 'duplicate' };
    rows.push({ ...values });
    this.sorted = undefined;
    return {};
  }

  // UPDATE : réécrit l'enregistrement courant, qui cesse de l'être (verrou libéré, position inchangée)
  update(values: { [zone: string]: any }): { failure?: 'noCurrent' | 'duplicate' } {
    const row: any = this.current;
    if (!row) return { failure: 'noCurrent' };
    if (this.duplicates(this.observe(), values, row)) return { failure: 'duplicate' };
    for (const [zone, value] of Object.entries(values)) row[this.columnOf(row, zone) ?? zone] = value;
    this.sorted = undefined;
    this.drop();
    return {};
  }

  // DELETE sans clé : supprime l'enregistrement courant (le READ suivant lit celui qui le suivait)
  delete(): { failure?: 'noCurrent' } {
    const row = this.current;
    if (!row) return { failure: 'noCurrent' };
    const rows = this.observe();
    const index = rows.indexOf(row);
    if (index >= 0) rows.splice(index, 1);
    this.sorted = undefined;
    this.drop();
    return {};
  }

  // DELETE par clé : premier enregistrement de cette clé ; position et enregistrement courant inchangés
  deleteByKey(key: any[]): { found: boolean } {
    const wanted = this.searchKey(key);
    const item = this.ordered().find(it => this.compare(it.key, wanted) === 0);
    if (!item) return { found: false };
    this.checkLock(item.row);
    const rows = this.rows;
    rows.splice(rows.indexOf(item.row), 1);
    this.sorted = undefined;
    if (item.row === this.current) this.drop();
    return { found: true };
  }

  // UNLOCK : plus d'enregistrement courant, verrou libéré
  unlock(): void {
    this.drop();
  }

  // Fermeture, fin de programme : libère les verrous tenus par ce fichier
  release(): void {
    this.drop();
  }

  // --- Interne ---

  // Lecture réussie : le fichier est positionné sur l'enregistrement lu, qui devient l'enregistrement courant
  private readOn(item: Item): FileResult {
    this.take(item.row);
    this.cursor = { side: 'on', at: item.key };
    this.last = item;
    return { record: item.row, found: true, eof: false, equal: false };
  }

  // Fichier en mise à jour : verrouille l'enregistrement (refusé s'il est tenu par une autre ouverture)
  private take(row: object): void {
    if (this.options.updatable) {
      this.checkLock(row);
      if (this.held !== undefined && this.held !== row) this.unlockHeld();
      this.locks.set(row, this);
      this.held = row;
    }
    this.current = row;
  }

  private checkLock(row: object): void {
    const owner = this.locks.get(row);
    if (owner !== undefined && owner !== this) {
      throw new NotSupportedError(`Enregistrement du fichier ${this.name} verrouillé par un autre programme (attente de verrou non simulée)`);
    }
  }

  // Plus d'enregistrement courant, verrou libéré
  private drop(): void {
    this.current = undefined;
    this.unlockHeld();
  }

  private unlockHeld(): void {
    if (this.held !== undefined && this.locks.get(this.held) === this) this.locks.delete(this.held);
    this.held = undefined;
  }

  // Lecture séquentielle depuis un enregistrement dont la clé a changé depuis sa lecture : position IBM i non vérifiée
  private checkCurrentKey(): void {
    const last = this.last;
    if (this.cursor.side !== 'on' || last === undefined) return;
    if (this.compare(this.entryOf(last.row).key, last.key) === 0) return;   // clé en cache : contrôle rapide
    if (!this.rows.includes(last.row)) return;
    throw new NotSupportedError(`Lecture séquentielle de ${this.name} après modification de la clé de l'enregistrement courant (position IBM i non vérifiée)`);
  }

  // Colonne d'une ligne correspondant à une zone (casse ignorée)
  private columnOf(row: any, zone: string): string | undefined {
    return Object.keys(row).find(c => c.toUpperCase() === zone.toUpperCase());
  }

  // Une autre ligne a-t-elle les mêmes valeurs sur les zones de la clé unique ?
  private duplicates(rows: any[], values: { [zone: string]: any }, except: any): boolean {
    const unique = this.options.uniqueKeys;
    if (!unique || unique.length === 0) return false;
    const valueOf = (row: any, zone: string) => {
      const column = this.columnOf(row, zone);
      return column === undefined ? undefined : row[column];
    };
    const wanted = unique.map(zone => {
      const column = this.columnOf(values, zone);
      return this.dataKey(zone, column !== undefined ? values[column] : except !== undefined ? valueOf(except, zone) : undefined);
    });
    return rows.some(row => row !== except && unique.every((zone, i) => this.dataKey(zone, valueOf(row, zone)) === wanted[i]));
  }

  // READE/READPE sans correspondance : %EOF, position IBM i non vérifiée
  private mismatch(): FileResult {
    this.drop();
    this.cursor = { side: 'lost' };
    return { found: false, eof: true, equal: false };
  }

  private checkPosition(): void {
    if (this.cursor.side === 'lost') {
      throw new NotSupportedError(`Lecture séquentielle de ${this.name} après un CHAIN non trouvé ou un READE/READPE sans correspondance`);
    }
  }

  // Premier enregistrement devant le curseur (lu par READ) ; les enregistrements devant forment la fin de l'ordre trié
  private next(): Item | undefined {
    const items = this.ordered();
    return items[this.firstWhere(items, it => this.ahead(it.key))];
  }

  // Dernier enregistrement derrière le curseur (lu par READP) ; ceux de derrière forment le début de l'ordre trié
  private previous(): Item | undefined {
    const items = this.ordered();
    return items[this.firstWhere(items, it => !this.behind(it.key)) - 1];
  }

  // Recherche dichotomique du premier élément vérifiant un prédicat monotone (faux… puis vrai…)
  private firstWhere(items: Item[], predicate: (item: Item) => boolean): number {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (predicate(items[middle])) high = middle;
      else low = middle + 1;
    }
    return low;
  }

  private observe(): any[] {
    const rows = this.rows;
    if (this.arrays[this.arrays.length - 1] !== rows && !this.arrays.includes(rows)) this.arrays.push(rows);
    return rows;
  }

  private sequenceOf(row: object): number {
    let s = this.sequence.get(row);
    if (s === undefined) {
      s = this.nextSequence++;
      this.sequence.set(row, s);
    }
    return s;
  }

  private field(name: string): FieldDefinition {
    return this.fields.find(f => f.name === name)!;
  }

  private invalidData(name: string, value: any, reason = ''): Error {
    return new Error(`Donnée invalide dans le fichier ${this.name} : zone ${name} = '${String(value)}'${reason}`);
  }

  // Valeur de clé lue dans les données : nombre pour une zone numérique, texte EBCDIC sinon
  private dataKey(name: string, value: any): any {
    const type = this.field(name).type;
    const kind = type.typeName;
    const tooBig = () => this.invalidData(name, value, ` (ne tient pas dans ${describeType(type)})`);
    if (NUMERIC.has(kind)) {
      let n: number;
      if (typeof value === 'number' && Number.isFinite(value)) n = value;
      else if (typeof value === 'string' && /^[+-]?\d+(\.\d+)?$/.test(value)) n = Number(value);
      else throw this.invalidData(name, value);
      if (!fitsField(n, type)) throw tooBig();
      return normalize(n);
    }
    if (isDateTimeType(kind)) {
      if (typeof value === 'string') {
        const parsed = parseIso(kind, value);
        if (parsed) return ebcdicKey(String(parsed));
      } else if (kindOf(value) === kind) {
        return ebcdicKey(String(value));
      }
      throw this.invalidData(name, value);
    }
    if (kind === 'ind') {
      if (typeof value === 'boolean') return value ? '1' : '0';
      if (value === 0 || value === 1 || value === '0' || value === '1') return String(value);
      throw this.invalidData(name, value);
    }
    if (value === undefined || value === null || typeof value === 'object') throw this.invalidData(name, value);
    if (!fitsField(String(value), type)) throw tooBig();
    return ebcdicKey(String(value));
  }

  // Valeur de clé fournie par le programme : doit avoir le genre de la zone et y tenir
  private programKey(value: any, name: string): any {
    const type = this.field(name).type;
    const kind = type.typeName;
    const shown = typeof value === 'string' ? `'${value}'` : String(value);
    const refuse = () => incompatibleTypes(`Clé ${shown} pour la zone ${name} (${kind})`);
    const tooBig = () => new NotSupportedError(
      `Clé ${shown} pour la zone ${name} ${describeType(type)} : valeur qui ne tient pas dans la zone (conversion IBM i non vérifiée)`);
    if (NUMERIC.has(kind)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw refuse();
      if (!fitsField(value, type)) throw tooBig();
      return normalize(value);
    }
    if (isDateTimeType(kind)) {
      if (kindOf(value) !== kind) throw refuse();
      return ebcdicKey(String(value));
    }
    if (kind === 'ind') {
      if (typeof value !== 'boolean') throw refuse();
      return value ? '1' : '0';
    }
    if (typeof value !== 'string') throw refuse();
    if (!fitsField(value, type)) throw tooBig();
    return ebcdicKey(value);
  }

  // Clé de tri d'un enregistrement : zones clés puis numéro d'arrivée (mise en cache tant que les zones clés sont inchangées)
  private entryOf(row: any): KeyEntry {
    const cached = this.keys_.get(row);
    if (cached) {
      let same = true;
      for (let i = 0; i < cached.columns.length && same; i++) {
        const column = cached.columns[i];
        same = column !== undefined && row[column] === cached.raw[i];
      }
      if (same) return cached;
    }
    if (!cached) this.seen.add(row);
    this.recomputed = true;
    const names = Object.keys(row);
    const columns = this.keys.map(k => names.find(c => c.toUpperCase() === k));
    const raw = columns.map(c => (c === undefined ? undefined : row[c]));
    const key = this.keys.map((k, i) => this.dataKey(k, raw[i]));
    key.push(this.sequenceOf(row));
    const entry = { columns, raw, key, sort: -1 };
    this.keys_.set(row, entry);
    return entry;
  }

  private searchKey(key: any[]): any[] {
    if (!this.keyed) {
      throw new NotSupportedError(`Positionnement par valeur sur le fichier sans clé ${this.name} (numéro d'enregistrement non simulé)`);
    }
    if (key.length > this.keys.length) {
      throw new Error(`Clé de ${key.length} valeurs pour ${this.keys.length} zones clés du fichier ${this.name}`);
    }
    return key.map((v, i) => this.programKey(v, this.keys[i]));
  }

  // Comparaison sur la partie commune (clé partielle)
  private compare(a: any[], b: any[]): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  // Enregistrements dans l'ordre des clés ; tri conservé tant que le tableau source et les clés sont inchangés
  private ordered(): Item[] {
    const rows = this.observe();
    this.recomputed = false;
    const s = this.sorted;
    let valid = s !== undefined && s.source === rows && s.length === rows.length;
    const revision = this.options.revision?.();
    if (valid && revision !== undefined && s!.revision === revision) return s!.items;
    for (let i = 0; i < rows.length; i++) {
      if (this.entryOf(rows[i]).sort !== this.generation) valid = false;   // ligne absente du dernier tri
    }
    if (valid && !this.recomputed) return s!.items;
    const entries = rows.map(row => this.entryOf(row));
    this.generation++;
    entries.forEach(entry => { entry.sort = this.generation; });
    const items = rows.map((row, i) => ({ row, key: entries[i].key })).sort((x, y) => this.compare(x.key, y.key));
    this.sorted = { source: rows, length: rows.length, revision, items };
    return items;
  }

  // L'enregistrement est-il devant le curseur (lu par le prochain READ) ?
  private ahead(key: any[]): boolean {
    const c = this.cursor as Exclude<Cursor, { side: 'lost' }>;
    if (c.at === 'start') return true;
    if (c.at === 'end') return false;
    const cmp = this.compare(key, c.at);
    return c.side === 'before' ? cmp >= 0 : cmp > 0;
  }

  // L'enregistrement est-il derrière le curseur (lu par le prochain READP) ?
  private behind(key: any[]): boolean {
    const c = this.cursor as Exclude<Cursor, { side: 'lost' }>;
    if (c.at === 'start') return false;
    if (c.at === 'end') return true;
    const cmp = this.compare(key, c.at);
    return c.side === 'after' ? cmp <= 0 : cmp < 0;
  }
}
