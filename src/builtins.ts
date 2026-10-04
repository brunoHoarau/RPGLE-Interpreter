// Fonctions intégrées supportées. Cette table est la seule source de vérité :
// le runtime les exécute, le parser refuse dès l'analyse celles qui n'y sont pas.

import { DateTimeKind, DurationUnit, RpgDate, RpgDuration, RpgTime, RpgTimestamp, diffDateTime, fromClock, isDateTime, kindOf, parseIso, subdt, unitFromName } from './datetime';
import { describeValue } from './datatypes';
import { NotSupportedError, RpgError, STATUS_INVALID_DATE, STATUS_INVALID_NUMERIC, incompatibleTypes } from './errors';

// %INT et %DEC sur un texte : il doit être numérique, sinon RNX0105
// Grammaire IBM : blancs n'importe où, un signe en tête ou en queue, un seul séparateur décimal (. ou ,), un chiffre au moins
function numericText(value: any): number {
  if (typeof value === 'number') return checkDigits(value);
  const text = String(value).replace(/ /g, '');
  const m = text.match(/^([+-])?(\d*[.,]?\d*)([+-])?$/);
  if (!m || (m[1] && m[3]) || !/\d/.test(m[2])) throw new RpgError(STATUS_INVALID_NUMERIC, `Valeur non numérique '${value}' (RNX0105)`);
  const n = Number(m[2].replace(',', '.')) * (m[1] === '-' || m[3] === '-' ? -1 : 1);
  return checkDigits(n);
}

// Au-delà de 15 chiffres significatifs, la précision des décimaux IBM n'est pas simulée
function checkDigits(n: number): number {
  if (Math.abs(n) >= 1e15) throw new NotSupportedError('Valeur numérique de 15 chiffres ou plus');
  return n;
}

// %DEC tronque (%DECH arrondit) : troncature sur le texte, sans erreur binaire (1.15 donne 1.1 à 1 décimale)
function truncateDecimals(n: number, decimals: number): number {
  let text = Math.abs(n).toPrecision(15);
  if (/e/i.test(text)) text = Math.abs(n).toFixed(20);
  const [int, frac = ''] = text.split('.');
  const result = Number(decimals > 0 ? `${int}.${frac.slice(0, decimals)}` : int);
  return n < 0 ? -result : result;
}

export interface BuiltinContext {
  status: number; // Pour %STATUS
  now(): Date;    // Pour %DATE(), %TIME(), %TIMESTAMP()
}

type Builtin = (ctx: BuiltinContext, ...args: any[]) => any;

// %DATE / %TIME / %TIMESTAMP : instant présent, conversion entre types, ou lecture d'un texte *ISO
// (les blancs de fin d'un char sont ignorés ; texte invalide : statut 00112)
function toDateTime(kind: DateTimeKind, ctx: BuiltinContext, value: any): any {
  const name = `%${kind.toUpperCase()}`;
  if (value === undefined) return fromClock(kind, ctx.now());
  if (typeof value === 'string') {
    const parsed = parseIso(kind, value.trimEnd());
    if (!parsed) throw new RpgError(STATUS_INVALID_DATE, `Valeur '${value.trimEnd()}' invalide pour ${name} (RNX0112)`);
    return parsed;
  }
  if (typeof value === 'number') {
    throw new Error(`${name} d'une valeur numérique : pas encore supporté par l'interpréteur`);
  }
  if (kindOf(value) === kind) return value;
  if (kind === 'date' && value instanceof RpgTimestamp) return value.date;
  if (kind === 'time' && value instanceof RpgTimestamp) return value.time;
  if (kind === 'timestamp' && value instanceof RpgDate) return new RpgTimestamp(value, new RpgTime(0, 0, 0), 0);
  throw incompatibleTypes(`${name}(${describeValue(value)})`);
}

// %YEARS(n) ... %MSECONDS(n) : durée entière, seulement utilisable à droite d'un + ou - avec une date
function duration(unit: DurationUnit, amount: any): RpgDuration {
  const name = `%${unit.toUpperCase()}`;
  if (typeof amount !== 'number') throw incompatibleTypes(`${name}(${describeValue(amount)})`);
  if (!Number.isInteger(amount)) {
    throw new Error(`${name} d'une valeur non entière (${amount}) : pas encore supporté par l'interpréteur`);
  }
  return new RpgDuration(unit, amount);
}

// %DIFF(a : b : unité) : unités entières de a - b ; l'unité arrive en minuscules ('*days')
function diff(a: any, b: any, unitName: string): number {
  if (!isDateTime(a) || !isDateTime(b)) throw incompatibleTypes(`%DIFF(${describeValue(a)} : ${describeValue(b)})`);
  const result = diffDateTime(a, b, unitFromName(unitName)!);
  if (typeof result === 'number') return result;
  const unit = unitName.toUpperCase();
  switch (result) {
    case 'unit': throw incompatibleTypes(`%DIFF de deux valeurs ${a.kind.toUpperCase()} en ${unit}`);
    case 'kind': throw new Error(`%DIFF entre ${a.kind.toUpperCase()} et ${b.kind.toUpperCase()} : pas encore supporté par l'interpréteur`);
    case '24h': throw new Error(`%DIFF d'une valeur 24.00.00 : pas encore supporté par l'interpréteur`);
    case 'seconds': throw new Error(`%DIFF de deux TIMESTAMP en ${unit} : pas encore supporté par l'interpréteur`);
    case 'precision': throw new Error(`%DIFF en ${unit} trop grand pour être exact : pas encore supporté par l'interpréteur`);
  }
}

// %SUBDT(valeur : unité) : composante numérique (année, mois, ..., microsecondes)
function subdtBuiltin(value: any, unitName: string): number {
  if (!isDateTime(value)) throw incompatibleTypes(`%SUBDT(${describeValue(value)})`);
  const result = subdt(value, unitFromName(unitName)!);
  if (result === 'unit') throw incompatibleTypes(`%SUBDT d'une valeur ${value.kind.toUpperCase()} en ${unitName.toUpperCase()}`);
  return result;
}

export const BUILTINS: { [name: string]: Builtin } = {
  '%status': ctx => ctx.status,
  '%date': (ctx, value?: any) => toDateTime('date', ctx, value),
  '%time': (ctx, value?: any) => toDateTime('time', ctx, value),
  '%timestamp': (ctx, value?: any) => toDateTime('timestamp', ctx, value),
  '%years': (_, n: any) => duration('years', n),
  '%months': (_, n: any) => duration('months', n),
  '%days': (_, n: any) => duration('days', n),
  '%hours': (_, n: any) => duration('hours', n),
  '%minutes': (_, n: any) => duration('minutes', n),
  '%seconds': (_, n: any) => duration('seconds', n),
  '%mseconds': (_, n: any) => duration('mseconds', n),
  '%diff': (_, a: any, b: any, unit: string) => diff(a, b, unit),
  '%subdt': (_, value: any, unit: string) => subdtBuiltin(value, unit),
  '%len': (_, str: any) => String(str).length,
  '%trim': (_, str: any) => String(str).trim(),
  '%trimr': (_, str: any) => String(str).trimEnd(),
  '%triml': (_, str: any) => String(str).trimStart(),
  '%subst': (_, source: any, start: number, length?: number) => {
    const str = String(source);
    const startPos = start - 1;
    return length !== undefined ? str.substr(startPos, length) : str.substr(startPos);
  },
  '%int': (_, value: any) => Math.trunc(numericText(value)),
  '%dec': (_, value: any, precision?: number, decimals?: number) => {
    const num = numericText(value);
    // Précision demandée supérieure à 15 et texte de plus de 15 chiffres significatifs : non exact
    if (precision !== undefined && precision > 15 && typeof value === 'string' && value.replace(/\D/g, '').replace(/^0+/, '').length > 15) {
      throw new NotSupportedError('%DEC d\'une valeur de plus de 15 chiffres');
    }
    return decimals !== undefined ? truncateDecimals(num, decimals) : num;
  },
  '%char': (_, value: any) => String(value),
  '%scan': (_, search: any, source: any) => {
    const pos = String(source).indexOf(String(search));
    return pos === -1 ? 0 : pos + 1;
  },
  '%upper': (_, str: any) => String(str).toUpperCase(),
  '%lower': (_, str: any) => String(str).toLowerCase(),
  '%replace': (_, newStr: any, source: any, start: number, length?: number) => {
    const str = String(source);
    const startPos = start - 1;
    const len = length !== undefined ? length : String(newStr).length;
    return str.substr(0, startPos) + String(newStr) + str.substr(startPos + len);
  },
  '%check': (_, comparator: any, base: any, start: number = 1) => {
    const comp = String(comparator);
    const baseStr = String(base);
    for (let i = start - 1; i < baseStr.length; i++) {
      if (comp.indexOf(baseStr[i]) === -1) return i + 1;
    }
    return 0;
  },
  '%abs': (_, value: number) => Math.abs(value),
  '%max': (_, ...values: number[]) => Math.max(...values),
  '%min': (_, ...values: number[]) => Math.min(...values),
  '%rem': (_, dividend: number, divisor: number) => dividend % divisor,
  '%div': (_, dividend: number, divisor: number) => Math.floor(dividend / divisor),
};

export function isSupportedBuiltin(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTINS, name.toLowerCase());
}
