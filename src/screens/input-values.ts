// Conversion d'une saisie de terminal en valeur de zone écran
import type { DisplayField } from './definition';

export type ParsedInput = { value: string | number } | { message: string };

export function parseInput(field: DisplayField, text: string): ParsedInput {
  if (field.type.typeName !== 'zoned') {
    const trimmed = text.replace(/\s+$/, '');
    const value = field.lc ? trimmed : trimmed.toUpperCase();   // sans CHECK(LC), le poste met en majuscules
    if (value.length > field.length) {
      return { message: `Zone ${field.name} : valeur trop longue (${field.length} caractères au plus)` };
    }
    return { value };
  }
  return parseNumeric(field, text);
}

// Chiffres, un signe '-' (début ou fin), un séparateur ',' ou '.' ; vide ou '-' seul = zéro
function parseNumeric(field: DisplayField, text: string): ParsedInput {
  const decimals = field.type.decimals ?? 0;
  let body = text.trim();
  let negative = false;
  if (body.startsWith('-')) { negative = true; body = body.slice(1).trim(); }
  else if (body.endsWith('-')) { negative = true; body = body.slice(0, -1).trim(); }
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(body);
  if (!match) return { message: `Zone ${field.name} : valeur numérique invalide` };
  const integer = match[1].replace(/^0+/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > decimals) {
    return { message: `Zone ${field.name} : trop de décimales (${decimals} au plus)` };
  }
  if (integer.length > field.length - decimals) {
    return { message: `Zone ${field.name} : valeur trop grande (${field.length - decimals} chiffres entiers au plus)` };
  }
  const magnitude = Number(`${integer || '0'}.${fraction || '0'}`);
  return { value: negative && magnitude !== 0 ? -magnitude : magnitude };
}
