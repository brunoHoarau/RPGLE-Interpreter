// Image mémoire (AREA) d'un enregistrement écran et chaîne des 99 indicateurs.
// Utilisée à l'identique par l'interpréteur et par le simulateur d'écran.
import type { DisplayField } from './definition';

const NEGATIVE_DIGITS = '}JKLMNOPQR';   // dernière position d'un zoned négatif : chiffre 0..9 (image EBCDIC)

export type AreaValue = string | number;

const isNumeric = (field: DisplayField): boolean => field.type.typeName === 'zoned';

export function encodeArea(fields: DisplayField[], values: Map<string, AreaValue>): string {
  return fields.map(field => encodeField(field, values.get(field.name))).join('');
}

export function decodeArea(fields: DisplayField[], area: string): Map<string, AreaValue> {
  const expected = fields.reduce((sum, f) => sum + f.length, 0);
  if (area.length !== expected) {
    throw new Error(`Image de l'enregistrement de longueur ${area.length} au lieu de ${expected} (longueur attendue)`);
  }
  const values = new Map<string, AreaValue>();
  let position = 0;
  for (const field of fields) {
    const part = area.substr(position, field.length);
    position += field.length;
    values.set(field.name, isNumeric(field) ? decodeZoned(part, field) : part);
  }
  return values;
}

function encodeField(field: DisplayField, value: AreaValue | undefined): string {
  if (!isNumeric(field)) return String(value ?? '').padEnd(field.length, ' ').slice(0, field.length);
  const decimals = field.type.decimals ?? 0;
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(number)) throw new Error(`Zone ${field.name} : valeur numérique invalide`);
  const digits = Math.round(Math.abs(number) * 10 ** decimals).toString();
  if (digits.length > field.length) {
    throw new Error(`Zone ${field.name} : la valeur ${number} ne tient pas dans zoned(${field.length}:${decimals})`);
  }
  const padded = digits.padStart(field.length, '0');
  if (number >= 0 || /^0+$/.test(padded)) return padded;
  return padded.slice(0, -1) + NEGATIVE_DIGITS[Number(padded.slice(-1))];
}

function decodeZoned(part: string, field: DisplayField): number {
  const negative = NEGATIVE_DIGITS.indexOf(part.slice(-1));
  const digits = negative >= 0 ? part.slice(0, -1) + negative : part;
  if (!/^\d+$/.test(digits)) throw new Error(`Zone ${field.name} : image zoned invalide '${part}'`);
  const magnitude = Number(digits) / 10 ** (field.type.decimals ?? 0);
  return negative >= 0 && magnitude !== 0 ? -magnitude : magnitude;
}

// 99 caractères '0'/'1' : l'indicateur nn est la position nn
export function indicatorsString(get: (n: number) => boolean): string {
  let s = '';
  for (let n = 1; n <= 99; n++) s += get(n) ? '1' : '0';
  return s;
}

// Lecture inverse : tableau indexé de 1 à 99 (l'index 0 est inutilisé)
export function parseIndicators(indicators: string): boolean[] {
  const result: boolean[] = [false];
  for (let n = 1; n <= 99; n++) result.push(indicators[n - 1] === '1');
  return result;
}
