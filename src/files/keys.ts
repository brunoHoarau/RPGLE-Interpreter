// Clés d'accès d'un fichier natif : conversion, tri, comparaison et recherche du curseur.
import { describeType } from '../datatypes';
import { isDateTimeType, kindOf, parseIso } from '../datetime';
import { NotSupportedError, incompatibleTypes } from '../errors';
import { ebcdicKey } from './ebcdic';
import { NUMERIC, fitsField, normalize } from './field-types';
import type { NativeFile } from './native-file';
import { observe } from './position';
import type { Cursor, FieldDefinition, Item, KeyEntry } from './types';

// Clé de READE/READPE : explicite, ou clé complète du dernier enregistrement rendu
export function wantedKey(f: NativeFile, key: any[] | 'last'): any[] {
  if (key !== 'last') return searchKey(f, key);
  if (!f.keyed) {
    throw new NotSupportedError(`READE/READPE sans clé sur le fichier sans clé ${f.name}`);
  }
  if (f.lastKey === undefined) {
    throw new NotSupportedError(`READE/READPE sans clé de ${f.name} sans lecture préalable (comportement IBM i non vérifié)`);
  }
  return f.lastKey;
}

// Recherche dichotomique du premier élément vérifiant un prédicat monotone (faux… puis vrai…)
export function firstWhere(f: NativeFile, items: Item[], predicate: (item: Item) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (predicate(items[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
}

// Premier enregistrement devant le curseur (lu par READ) ; les enregistrements devant forment la fin de l'ordre trié
export function next(f: NativeFile): Item | undefined {
  const items = ordered(f);
  return items[firstWhere(f, items, it => ahead(f, it.key))];
}

// Dernier enregistrement derrière le curseur (lu par READP) ; ceux de derrière forment le début de l'ordre trié
export function previous(f: NativeFile): Item | undefined {
  const items = ordered(f);
  return items[firstWhere(f, items, it => !behind(f, it.key)) - 1];
}

export function sequenceOf(f: NativeFile, row: object): number {
  let s = f.sequence.get(row);
  if (s === undefined) {
    s = f.nextSequence++;
    f.sequence.set(row, s);
  }
  return s;
}

export function field(f: NativeFile, name: string): FieldDefinition {
  return f.fields.find(f => f.name === name)!;
}

export function invalidData(f: NativeFile, name: string, value: any, reason = ''): Error {
  return new Error(`Donnée invalide dans le fichier ${f.name} : zone ${name} = '${String(value)}'${reason}`);
}

// Valeur de clé lue dans les données : nombre pour une zone numérique, texte EBCDIC sinon
export function dataKey(f: NativeFile, name: string, value: any): any {
  const type = field(f, name).type;
  const kind = type.typeName;
  const tooBig = () => invalidData(f, name, value, ` (ne tient pas dans ${describeType(type)})`);
  if (NUMERIC.has(kind)) {
    let n: number;
    if (typeof value === 'number' && Number.isFinite(value)) n = value;
    else if (typeof value === 'string' && /^[+-]?\d+(\.\d+)?$/.test(value)) n = Number(value);
    else throw invalidData(f, name, value);
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
    throw invalidData(f, name, value);
  }
  if (kind === 'ind') {
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (value === 0 || value === 1 || value === '0' || value === '1') return String(value);
    throw invalidData(f, name, value);
  }
  if (value === undefined || value === null || typeof value === 'object') throw invalidData(f, name, value);
  if (!fitsField(String(value), type)) throw tooBig();
  return ebcdicKey(String(value));
}

// Valeur de clé fournie par le programme : doit avoir le genre de la zone et y tenir
export function programKey(f: NativeFile, value: any, name: string): any {
  const type = field(f, name).type;
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
export function entryOf(f: NativeFile, row: any): KeyEntry {
  const cached = f.keys_.get(row);
  if (cached) {
    let same = true;
    for (let i = 0; i < cached.columns.length && same; i++) {
      const column = cached.columns[i];
      same = column !== undefined && row[column] === cached.raw[i];
    }
    if (same) return cached;
  }
  if (!cached) f.seen.add(row);
  f.recomputed = true;
  const names = Object.keys(row);
  const columns = f.keys.map(k => names.find(c => c.toUpperCase() === k));
  const raw = columns.map(c => (c === undefined ? undefined : row[c]));
  const key = f.keys.map((k, i) => dataKey(f, k, raw[i]));
  key.push(sequenceOf(f, row));
  const entry = { columns, raw, key, sort: -1 };
  f.keys_.set(row, entry);
  return entry;
}

export function searchKey(f: NativeFile, key: any[]): any[] {
  if (!f.keyed) {
    throw new NotSupportedError(`Positionnement par valeur sur le fichier sans clé ${f.name} (numéro d'enregistrement non simulé)`);
  }
  if (key.length > f.keys.length) {
    throw new Error(`Clé de ${key.length} valeurs pour ${f.keys.length} zones clés du fichier ${f.name}`);
  }
  return key.map((v, i) => programKey(f, v, f.keys[i]));
}

// Comparaison sur la partie commune (clé partielle)
export function compare(f: NativeFile, a: any[], b: any[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

// Enregistrements dans l'ordre des clés ; tri conservé tant que le tableau source et les clés sont inchangés
export function ordered(f: NativeFile): Item[] {
  const rows = observe(f);
  f.recomputed = false;
  const s = f.sorted;
  let valid = s !== undefined && s.source === rows && s.length === rows.length;
  const revision = f.options.revision?.();
  if (valid && revision !== undefined && s!.revision === revision) return s!.items;
  for (let i = 0; i < rows.length; i++) {
    if (entryOf(f, rows[i]).sort !== f.generation) valid = false;   // ligne absente du dernier tri
  }
  if (valid && !f.recomputed) return s!.items;
  const entries = rows.map(row => entryOf(f, row));
  f.generation++;
  entries.forEach(entry => { entry.sort = f.generation; });
  const items = rows.map((row, i) => ({ row, key: entries[i].key })).sort((x, y) => compare(f, x.key, y.key));
  f.sorted = { source: rows, length: rows.length, revision, items };
  return items;
}

// L'enregistrement est-il devant le curseur (lu par le prochain READ) ?
export function ahead(f: NativeFile, key: any[]): boolean {
  const c = f.cursor as Exclude<Cursor, { side: 'lost' }>;
  if (c.at === 'start') return true;
  if (c.at === 'end') return false;
  const cmp = compare(f, key, c.at);
  return c.side === 'before' ? cmp >= 0 : cmp > 0;
}

// L'enregistrement est-il derrière le curseur (lu par le prochain READP) ?
export function behind(f: NativeFile, key: any[]): boolean {
  const c = f.cursor as Exclude<Cursor, { side: 'lost' }>;
  if (c.at === 'start') return false;
  if (c.at === 'end') return true;
  const cmp = compare(f, key, c.at);
  return c.side === 'after' ? cmp <= 0 : cmp < 0;
}
