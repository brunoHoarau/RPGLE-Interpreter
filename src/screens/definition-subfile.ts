// displays.json : sous-fichier (SFL) et contrôle (SFLCTL) — validation et normalisation
import type { Condition } from './conditions';
import { condition, isObject } from './conditions';
import type { DisplayField, DisplayFormat } from './definition';

export interface SubfileSpec { nextChanged?: Condition }

// Condition absente = mot-clé absent ; null = toujours actif
export interface ControlSpec {
  subfile: string; size: number; page: number;
  display?: Condition | null; displayControl?: Condition | null; clear?: Condition | null;
  delete?: Condition | null; initialize?: Condition | null;
  end?: { condition: Condition | null; text: '*MORE' | '*PLUS' };
  recordNumber?: string; drop?: string;
}

const SCREEN_ROWS = 24;
const CONTROL_KEYS = ['subfile', 'size', 'page', 'display', 'displayControl', 'clear', 'delete', 'initialize', 'end', 'recordNumber', 'drop'];
const CONDITION_KEYS = ['display', 'displayControl', 'clear', 'delete', 'initialize'] as const;

function rejectUnknown(raw: any, allowed: string[], where: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new Error(`${where} : clé '${key}' inconnue ou non supportée (${allowed.join(', ')})`);
  }
}

export function normalizeSubfile(raw: any, where: string): SubfileSpec {
  if (!isObject(raw)) throw new Error(`${where} : "subfile" doit être un objet`);
  rejectUnknown(raw, ['nextChanged'], `${where}, subfile`);
  return raw.nextChanged === undefined ? {} : { nextChanged: condition(raw.nextChanged, `${where}, subfile "nextChanged"`) };
}

export function normalizeControl(raw: any, where: string, fields: DisplayField[]): ControlSpec {
  const here = `${where}, control`;
  if (!isObject(raw)) throw new Error(`${where} : "control" doit être un objet`);
  rejectUnknown(raw, CONTROL_KEYS, here);
  if (typeof raw.subfile !== 'string') throw new Error(`${here} : "subfile" (format sous-fichier lié) est obligatoire`);
  if (!Number.isInteger(raw.size) || raw.size < 1 || raw.size > 9999) throw new Error(`${here} : "size" doit être un entier de 1 à 9999`);
  if (!Number.isInteger(raw.page) || raw.page < 1) throw new Error(`${here} : "page" doit être un entier d'au moins 1`);
  if (raw.page > raw.size) throw new Error(`${here} : "page" (${raw.page}) ne peut dépasser "size" (${raw.size})`);
  const spec: ControlSpec = { subfile: raw.subfile, size: raw.size, page: raw.page };
  for (const key of CONDITION_KEYS) {
    if (raw[key] === undefined) continue;
    spec[key] = raw[key] === null ? null : condition(raw[key], `${here} "${key}"`)!;
  }
  if (raw.end !== undefined) {
    const text = isObject(raw.end) ? raw.end.text ?? '*MORE' : undefined;
    if (text !== '*MORE' && text !== '*PLUS') {
      throw new Error(`${here} : "end" doit être { "if": condition, "text": "*MORE" ou "*PLUS" }`);
    }
    const when = raw.end.if === undefined || raw.end.if === null ? null : condition(raw.end.if, `${here} "end"`)!;
    spec.end = { condition: when, text };
  }
  if (raw.recordNumber !== undefined) {
    const field = fields.find(f => f.name === raw.recordNumber);
    if (!field || field.type.typeName !== 'zoned' || (field.type.decimals ?? 0) !== 0) {
      throw new Error(`${here} : "recordNumber" doit nommer une zone numérique du contrôle sans décimales ('${raw.recordNumber}')`);
    }
    spec.recordNumber = raw.recordNumber;
  }
  if (raw.drop !== undefined) {
    if (typeof raw.drop !== 'string' || !/^(CA|CF)(0[1-9]|1\d|2[0-4])$/.test(raw.drop)) {
      throw new Error(`${here} : "drop" doit être une touche CA01-CA24 ou CF01-CF24 ('${raw.drop}')`);
    }
    spec.drop = raw.drop;
  }
  return spec;
}

// Hauteur d'un enregistrement sous-fichier : de min(row) à max(row) de ses zones affichées
export function recordHeight(format: DisplayFormat): number {
  const rows = format.fields.filter(f => f.usage !== 'H').map(f => f.row!);
  return rows.length === 0 ? 1 : Math.max(...rows) - Math.min(...rows) + 1;
}

// Contrôles entre formats : liaison contrôle -> sous-fichier, un seul contrôle, page dans l'écran
export function validateSubfiles(formats: { [name: string]: DisplayFormat }, where: string): void {
  const owner = new Map<string, string>();
  for (const [name, format] of Object.entries(formats)) {
    if (!format.control) continue;
    const here = `${where}, format '${name}', control`;
    const target = formats[format.control.subfile];
    if (!target) throw new Error(`${here} : sous-fichier '${format.control.subfile}' inconnu`);
    if (!target.subfile) throw new Error(`${here} : '${format.control.subfile}' n'est pas un format sous-fichier`);
    const other = owner.get(format.control.subfile);
    if (other) throw new Error(`${here} : le sous-fichier '${format.control.subfile}' est déjà lié au contrôle '${other}'`);
    owner.set(format.control.subfile, name);
    const height = recordHeight(target);
    if (format.control.page * height > SCREEN_ROWS) {
      throw new Error(`${here} : la page (${format.control.page} enregistrements de ${height} ligne(s)) ne tient pas dans les ${SCREEN_ROWS} lignes de l'écran`);
    }
  }
}
