// Fichiers natifs (DCL-F) simulés sur les tables de context/tables.json.
// Les opérations renvoient l'enregistrement et les indicateurs ; elles ne lèvent
// aucune erreur d'exécution RPG (statuts gérés par l'interpréteur).
import { DataTypeNode } from './types';
import { isDateTimeType, kindOf, parseIso } from './datetime';
import { NotSupportedError, incompatibleTypes } from './errors';

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

type Cursor = { side: 'before' | 'after'; at: any[] | FileSpecial } | { side: 'lost' };

export class NativeFile {
  private sequence = new WeakMap<object, number>();
  private nextSequence = 0;
  private cursor: Cursor = { side: 'before', at: 'start' };
  private eofReached: 'read' | 'readp' | undefined;   // dernière lecture ayant donné %EOF, sans repositionnement
  private initialRows: any[] = [];                    // lignes présentes à la construction ou au dernier reset()

  // source : tableau, ou fonction le renvoyant (relue à chaque opération : le moteur SQL peut remplacer le tableau)
  constructor(readonly name: string, readonly format: string, readonly fields: FieldDefinition[],
              readonly keys: string[], private source: any[] | (() => any[])) {
    for (const key of keys) {
      if (!fields.some(f => f.name === key)) {
        throw new Error(`Zone clé ${key} absente des zones du fichier ${name}`);
      }
    }
    this.snapshot();
  }

  private get rows(): any[] {
    return typeof this.source === 'function' ? this.source() : this.source;
  }

  private snapshot(): void {
    this.initialRows = this.rows.slice();
    this.initialRows.forEach(row => this.sequenceOf(row));
  }

  get keyed(): boolean {
    return this.keys.length > 0;
  }

  // Position perdue après un CHAIN non trouvé (position IBM i non vérifiée)
  get positionLost(): boolean {
    return this.cursor.side === 'lost';
  }

  reset(): void {
    this.cursor = { side: 'before', at: 'start' };
    this.eofReached = undefined;
    this.snapshot();
  }

  read(): FileResult {
    if (this.eofReached === 'read') {
      throw new NotSupportedError(`READ de ${this.name} après la fin de fichier (comportement IBM i non vérifié)`);
    }
    this.eofReached = undefined;
    const row = this.ordered().find(r => this.ahead(r));
    if (!row) {
      this.cursor = { side: 'after', at: 'end' };
      this.eofReached = 'read';
      return { found: false, eof: true, equal: false };
    }
    this.cursor = { side: 'after', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  readp(): FileResult {
    if (this.eofReached === 'readp') {
      throw new NotSupportedError(`READP de ${this.name} après le début de fichier (comportement IBM i non vérifié)`);
    }
    this.eofReached = undefined;
    const behind = this.ordered().filter(r => !this.ahead(r));
    const row = behind[behind.length - 1];
    if (!row) {
      this.cursor = { side: 'before', at: 'start' };
      this.eofReached = 'readp';
      return { found: false, eof: true, equal: false };
    }
    this.cursor = { side: 'before', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  reade(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    this.eofReached = undefined;
    const row = this.ordered().find(r => this.ahead(r));
    if (!row || this.compare(this.tuple(row), wanted) !== 0) return this.mismatch();
    this.cursor = { side: 'after', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  readpe(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    this.eofReached = undefined;
    const behind = this.ordered().filter(r => !this.ahead(r));
    const row = behind[behind.length - 1];
    if (!row || this.compare(this.tuple(row), wanted) !== 0) return this.mismatch();
    this.cursor = { side: 'before', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  // READE/READPE sans correspondance : %EOF, position IBM i non vérifiée
  private mismatch(): FileResult {
    this.cursor = { side: 'lost' };
    return { found: false, eof: true, equal: false };
  }

  chain(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    this.eofReached = undefined;
    const row = this.ordered().find(r => this.compare(this.tuple(r), wanted) === 0);
    if (!row) {
      this.cursor = { side: 'lost' };
      return { found: false, eof: false, equal: false };
    }
    this.cursor = { side: 'after', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  // Fichier sans clé : lecture par rang d'arrivée (1 = premier)
  chainRrn(n: number): FileResult {
    if (this.keyed) throw new Error(`Fichier ${this.name} avec clé : CHAIN par numéro d'enregistrement impossible`);
    const rows = this.rows;
    if (this.initialRows.some(r => !rows.includes(r))) {
      throw new NotSupportedError(`Numéro d'enregistrement du fichier ${this.name} après suppression`);
    }
    this.eofReached = undefined;
    const row = Number.isInteger(n) && n >= 1 ? rows[n - 1] : undefined;
    if (!row) {
      this.cursor = { side: 'lost' };
      return { found: false, eof: false, equal: false };
    }
    this.cursor = { side: 'after', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  setll(key: any[] | FileSpecial): FileResult {
    this.eofReached = undefined;
    if (key === 'start' || key === 'end') {
      this.cursor = key === 'start' ? { side: 'before', at: 'start' } : { side: 'after', at: 'end' };
      return { found: key === 'start' && this.rows.length > 0, eof: false, equal: false };
    }
    const wanted = this.searchKey(key);
    this.cursor = { side: 'before', at: wanted };
    const tuples = this.rows.map(r => this.tuple(r));
    return {
      found: tuples.some(tp => this.compare(tp, wanted) >= 0),
      eof: false,
      equal: tuples.some(tp => this.compare(tp, wanted) === 0),
    };
  }

  setgt(key: any[] | FileSpecial): FileResult {
    this.eofReached = undefined;
    if (key === 'start' || key === 'end') return this.setll(key);
    const wanted = this.searchKey(key);
    this.cursor = { side: 'after', at: wanted };
    return { found: this.rows.some(r => this.compare(this.tuple(r), wanted) > 0), eof: false, equal: false };
  }

  // --- Interne ---

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

  private valueOf(row: any, name: string): any {
    const column = Object.keys(row).find(c => c.toUpperCase() === name);
    return column === undefined ? undefined : row[column];
  }

  private invalidData(name: string, value: any): Error {
    return new Error(`Donnée invalide dans le fichier ${this.name} : zone ${name} = '${String(value)}'`);
  }

  // Valeur de clé lue dans les données : nombre pour une zone numérique, texte EBCDIC sinon
  private dataKey(row: any, name: string): any {
    const kind = this.field(name).type.typeName;
    const value = this.valueOf(row, name);
    if (NUMERIC.has(kind)) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && /^[+-]?\d+(\.\d+)?$/.test(value)) return Number(value);
      throw this.invalidData(name, value);
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
    return ebcdicKey(String(value));
  }

  // Valeur de clé fournie par le programme : doit avoir le genre de la zone
  private programKey(value: any, name: string): any {
    const type = this.field(name).type;
    const kind = type.typeName;
    const refuse = () => incompatibleTypes(`Clé ${typeof value === 'string' ? `'${value}'` : String(value)} pour la zone ${name} (${kind})`);
    if (NUMERIC.has(kind)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw refuse();
      return value;
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
    return ebcdicKey(type.length === undefined ? value : value.slice(0, type.length));
  }

  // Clé de tri d'un enregistrement : zones clés puis numéro d'arrivée
  private tuple(row: any): any[] {
    const values = this.keys.map(k => this.dataKey(row, k));
    values.push(this.sequenceOf(row));
    return values;
  }

  private searchKey(key: any[]): any[] {
    if (!this.keyed) throw new Error(`Fichier ${this.name} sans clé : opération par clé impossible`);
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

  private ordered(): any[] {
    return this.rows.map(row => ({ row, key: this.tuple(row) }))
      .sort((x, y) => this.compare(x.key, y.key))
      .map(item => item.row);
  }

  // L'enregistrement est-il devant le curseur (lu par le prochain READ) ?
  private ahead(row: any): boolean {
    const c = this.cursor;
    if (c.side === 'lost') throw new NotSupportedError(`Lecture séquentielle de ${this.name} après un CHAIN non trouvé`);
    if (c.at === 'start') return true;
    if (c.at === 'end') return false;
    const cmp = this.compare(this.tuple(row), c.at);
    return c.side === 'before' ? cmp >= 0 : cmp > 0;
  }
}
