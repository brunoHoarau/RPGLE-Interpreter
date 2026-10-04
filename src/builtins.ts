// Fonctions intégrées supportées. Cette table est la seule source de vérité :
// le runtime les exécute, le parser refuse dès l'analyse celles qui n'y sont pas.

import { DateTimeKind, DurationUnit, RpgDate, RpgDuration, RpgTime, RpgTimestamp, fromClock, kindOf, parseIso } from './datetime';
import { describeValue } from './datatypes';
import { RpgError, STATUS_INVALID_DATE, incompatibleTypes } from './errors';

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
  '%len': (_, str: any) => String(str).length,
  '%trim': (_, str: any) => String(str).trim(),
  '%trimr': (_, str: any) => String(str).trimEnd(),
  '%triml': (_, str: any) => String(str).trimStart(),
  '%subst': (_, source: any, start: number, length?: number) => {
    const str = String(source);
    const startPos = start - 1;
    return length !== undefined ? str.substr(startPos, length) : str.substr(startPos);
  },
  '%int': (_, value: any) => parseInt(value),
  '%dec': (_, value: any, precision?: number, decimals?: number) => {
    const num = parseFloat(value);
    return decimals !== undefined ? parseFloat(num.toFixed(decimals)) : num;
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
