// Description des fichiers écran (displays.json) : types normalisés et validation au chargement.
import type { DataTypeNode } from '../types';
import { parseFieldType } from '../files/field-types';

// Indicateurs tous vrais (ET) ; negated : l'indicateur doit être à 0
export type Condition = { indicator: number; negated: boolean }[];

// Touche normalisée (CA03, CF05, PAGEUP, PAGEDOWN) -> indicateur de réponse, ou null (touche autorisée sans indicateur)
export type KeyMap = Map<string, number | null>;

export interface DisplayConstant { row: number; col: number; text: string; condition?: Condition }

export interface DisplayField {
  name: string;
  type: DataTypeNode;
  usage: 'I' | 'O' | 'B' | 'H';
  row?: number;
  col?: number;
  length: number;
  condition?: Condition;
  lc?: boolean;                    // saisie char conservée en minuscules (équivalent DDS CHECK(LC))
}

export interface DisplayFormat { keys: KeyMap; constants: DisplayConstant[]; fields: DisplayField[] }

export interface DisplayFileDefinition { indara: boolean; keys: KeyMap; formats: { [name: string]: DisplayFormat } }

const ROWS = 24;
const COLS = 80;
const KEY_SYNONYMS = new Map([['ROLLDOWN', 'PAGEUP'], ['ROLLUP', 'PAGEDOWN']]);

// Valide displays.json et le convertit ; les erreurs citent le chemin du fichier
export function normalizeDisplays(raw: any, path: string): { [file: string]: DisplayFileDefinition } {
  if (!isObject(raw)) throw new Error(`Fichier ${path} invalide : un objet { fichier écran: description } est attendu`);
  const result: { [file: string]: DisplayFileDefinition } = {};
  for (const name of Object.keys(raw)) {
    requireUpper(name, `Fichier écran '${name}'`, path);
    result[name] = normalizeFile(raw[name], `Fichier écran '${name}' de ${path}`);
  }
  return result;
}

function normalizeFile(raw: any, where: string): DisplayFileDefinition {
  if (!isObject(raw)) throw new Error(`${where} : un objet est attendu`);
  if (raw.indara !== undefined && typeof raw.indara !== 'boolean') {
    throw new Error(`${where} : "indara" doit être vrai ou faux`);
  }
  const keys = normalizeKeys(raw.keys, where);
  rejectCaAndCf(keys, where);
  const formats: { [name: string]: DisplayFormat } = {};
  if (raw.formats !== undefined && !isObject(raw.formats)) throw new Error(`${where} : "formats" doit être un objet`);
  for (const name of Object.keys(raw.formats ?? {})) {
    requireUpper(name, `format '${name}'`, where);
    formats[name] = normalizeFormat(raw.formats[name], `${where}, format '${name}'`, keys);
  }
  return { indara: raw.indara ?? false, keys, formats };
}

function normalizeFormat(raw: any, where: string, fileKeys: KeyMap): DisplayFormat {
  if (!isObject(raw)) throw new Error(`${where} : un objet est attendu`);
  const keys = normalizeKeys(raw.keys, where);
  for (const key of keys.keys()) {
    if (fileKeys.has(key)) throw new Error(`${where} : touche '${key}' définie au niveau du fichier et au format`);
  }
  rejectCaAndCf(new Map([...fileKeys, ...keys]), where);
  const list = (value: any, what: string): any[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${where} : "${what}" doit être une liste`);
    return value;
  };
  const constants = list(raw.constants, 'constants').map(c => normalizeConstant(c, where));
  const fields: DisplayField[] = [];
  for (const f of list(raw.fields, 'fields')) {
    const field = normalizeField(f, where);
    if (fields.some(other => other.name === field.name)) {
      throw new Error(`${where}, zone '${field.name}' : zone en double dans le format`);
    }
    fields.push(field);
  }
  return { keys, constants, fields };
}

function normalizeKeys(raw: any, where: string): KeyMap {
  const keys: KeyMap = new Map();
  if (raw === undefined) return keys;
  if (!isObject(raw)) throw new Error(`${where} : "keys" doit être un objet touche -> indicateur`);
  for (const written of Object.keys(raw)) {
    const key = normalizeKey(written);
    if (key === undefined) throw new Error(`${where} : touche '${written}' inconnue (CA01-CA24, CF01-CF24, PAGEUP, PAGEDOWN)`);
    if (keys.has(key)) throw new Error(`${where} : touche '${key}' définie deux fois`);
    const value = raw[written];
    if (value !== null && !(typeof value === 'string' && /^\d+$/.test(value))) {
      throw new Error(`${where} : touche '${written}' : indicateur "01" à "99" ou null attendu`);
    }
    keys.set(key, value === null ? null : indicator(value, `${where} : touche '${written}'`));
  }
  return keys;
}

// Impossible en DDS : CAnn et CFnn pour la même touche
function rejectCaAndCf(keys: KeyMap, where: string): void {
  for (const key of keys.keys()) {
    if (key.startsWith('CA') && keys.has(`CF${key.slice(2)}`)) {
      throw new Error(`${where} : touches '${key}' et 'CF${key.slice(2)}' déclarées toutes deux pour la même touche`);
    }
  }
}

function normalizeKey(written: string): string | undefined {
  const synonym = KEY_SYNONYMS.get(written);
  if (synonym) return synonym;
  if (written === 'PAGEUP' || written === 'PAGEDOWN') return written;
  const m = /^(CA|CF)(\d\d)$/.exec(written);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 24 ? written : undefined;
}

function normalizeConstant(raw: any, where: string): DisplayConstant {
  const here = `${where}, constante`;
  if (!isObject(raw) || typeof raw.text !== 'string' || raw.text === '') {
    throw new Error(`${here} : "row", "col" et "text" sont attendus`);
  }
  const { row, col } = position(raw, raw.text.length, here);
  return { row, col, text: raw.text, condition: condition(raw.if, here) };
}

function normalizeField(raw: any, where: string): DisplayField {
  if (!isObject(raw) || typeof raw.name !== 'string') throw new Error(`${where} : chaque zone doit avoir un "name"`);
  const here = `${where}, zone '${raw.name}'`;
  requireUpper(raw.name, `zone '${raw.name}'`, where);
  if (!['I', 'O', 'B', 'H'].includes(raw.usage)) {
    throw new Error(`${here} : usage '${raw.usage}' inconnu (I, O, B ou H)`);
  }
  const type = typeof raw.type === 'string' ? parseFieldType(raw.type) : undefined;
  if (!type) throw new Error(`${here} : type '${raw.type}' invalide`);
  if (type.typeName !== 'char' && type.typeName !== 'zoned') {
    throw new Error(`${here} : seuls les types char(n) ou zoned(p:d) sont acceptés (type '${raw.type}')`);
  }
  const length = type.length as number;
  const decimals = type.decimals ?? 0;
  if (type.typeName === 'char' ? length < 1 : length < 1 || length > 63 || decimals > length) {
    throw new Error(`${here} : longueur invalide pour le type '${raw.type}' (char : 1 ou plus ; zoned : 1 à 63 chiffres, décimales <= chiffres)`);
  }
  const field: DisplayField = { name: raw.name, type, usage: raw.usage, length, condition: condition(raw.if, here) };
  if (raw.lc !== undefined) {
    if (typeof raw.lc !== 'boolean') throw new Error(`${here} : "lc" doit être vrai ou faux`);
    if (type.typeName !== 'char') throw new Error(`${here} : "lc" n'est permis que sur une zone char`);
    if (raw.lc) field.lc = true;
  }
  if (raw.usage !== 'H') {
    if (raw.row === undefined || raw.col === undefined) throw new Error(`${here} : "row" et "col" sont obligatoires (sauf usage H)`);
    Object.assign(field, position(raw, length, here));
  }
  return field;
}

// Position 1-based d'une zone ou d'une constante : doit tenir dans l'écran 24 x 80
function position(raw: any, length: number, where: string): { row: number; col: number } {
  const { row, col } = raw;
  if (!Number.isInteger(row) || !Number.isInteger(col)) throw new Error(`${where} : "row" et "col" doivent être des entiers`);
  if (row < 1 || row > ROWS || col < 1 || col + length - 1 > COLS) {
    throw new Error(`${where} : la position (${row}, ${col}) sur ${length} colonnes sort de l'écran de ${ROWS} lignes sur ${COLS} colonnes`);
  }
  return { row, col };
}

// "31 N32" : indicateurs séparés par des blancs, N devant = négation
function condition(raw: any, where: string): Condition | undefined {
  if (raw === undefined) return undefined;
  const tokens = typeof raw === 'string' ? raw.trim().split(/\s+/) : [];
  if (typeof raw !== 'string' || raw.trim() === '' || !tokens.every(t => /^N?\d+$/.test(t))) {
    throw new Error(`${where} : "if" mal formé : indicateurs "01" à "99" séparés par des blancs, N devant pour la négation`);
  }
  return tokens.map(t => {
    const negated = t.startsWith('N');
    return { indicator: indicator(negated ? t.slice(1) : t, `${where} : "if"`), negated };
  });
}

function indicator(digits: string, where: string): number {
  const n = Number(digits);
  if (n < 1 || n > 99) throw new Error(`${where} : indicateur '${digits}' hors de 01 à 99`);
  return n;
}

function requireUpper(name: string, what: string, where: string): void {
  if (name !== name.toUpperCase()) throw new Error(`${where} : ${what} : le nom doit être en majuscules`);
}

const isObject = (v: any): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
