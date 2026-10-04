// Sémantique des types RPG : valeurs par défaut, conversion à l'affectation, %CHAR
import { DataTypeNode } from './types';
import { DateTimeKind, FigurativeValue, isDateTime, isDateTimeType, kindOf, lowValue, resolveFigurative } from './datetime';
import { RpgError, STATUS_INVALID_NUMERIC, STATUS_OVERFLOW, incompatibleTypes } from './errors';

const INT_BITS: { [digits: number]: number } = { 3: 8, 5: 16, 10: 32, 20: 64 };

export function defaultValue(type: DataTypeNode): any {
  switch (type.typeName) {
    case 'char': return ' '.repeat(type.length ?? 0);
    case 'varchar': return '';
    case 'packed': case 'zoned': case 'int': case 'uns': return 0;
    case 'ind': return false;
    case 'date': case 'time': case 'timestamp': return lowValue(type.typeName as DateTimeKind);
    default: return null;
  }
}

// Convertit une valeur vers le type de la variable qui la reçoit (comme EVAL sans (H)).
// Lève RNX0103 si la valeur ne tient pas dans la cible.
export function coerce(value: any, type: DataTypeNode | undefined, target: string): any {
  if (!type || value === undefined || value === null) return value;
  if (isDateTimeType(type.typeName)) return coerceDateTime(value, type, target);
  if (value instanceof FigurativeValue) {
    throw new Error(`${value.name.toUpperCase()} affecté à ${target} ${describeType(type)} : pas encore supporté par l'interpréteur`);
  }
  if (isDateTime(value)) throw incompatibleAssignment(value, type, target);

  switch (type.typeName) {
    case 'char': {
      const str = toText(value);
      if (type.length === undefined) return str;
      return str.length >= type.length ? str.slice(0, type.length) : str.padEnd(type.length, ' ');
    }
    case 'varchar': {
      const str = toText(value);
      return type.length === undefined ? str : str.slice(0, type.length);
    }
    case 'int':
    case 'uns': {
      const n = Math.trunc(normalize(toNumber(value, target)));
      const bits = INT_BITS[type.length ?? 10] ?? 32;
      const [min, max] = type.typeName === 'int'
        ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1]
        : [0, 2 ** bits - 1];
      if (n < min || n > max) throw overflow(value, type, target);
      return n;
    }
    case 'packed':
    case 'zoned': {
      const decimals = type.decimals ?? 0;
      const factor = 10 ** decimals;
      const n = Math.trunc(normalize(toNumber(value, target) * factor)) / factor;
      const digits = type.length ?? 15;
      if (Math.abs(n) >= 10 ** (digits - decimals)) throw overflow(value, type, target);
      return n;
    }
    case 'ind':
      if (value === '1') return true;
      if (value === '0') return false;
      return Boolean(value);
    default:
      return value;
  }
}

// %CHAR : un décimal garde ses décimales déclarées, sans zéros de tête (0.5 -> '.50')
export function formatChar(value: any, type: DataTypeNode | undefined): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value !== 'number' || !type || (type.typeName !== 'packed' && type.typeName !== 'zoned')) {
    return String(value);
  }
  const decimals = type.decimals ?? 0;
  const text = Math.abs(value).toFixed(decimals).replace(/^0+(?=\.|$)/, decimals > 0 ? '' : '0');
  return value < 0 ? `-${text}` : text;
}

export function describeType(type: DataTypeNode): string {
  if (type.length === undefined) return type.typeName;
  return type.decimals === undefined
    ? `${type.typeName}(${type.length})`
    : `${type.typeName}(${type.length}:${type.decimals})`;
}

function toText(value: any): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function toNumber(value: any, target: string): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const str = String(value).trim();
  const n = Number(str);
  if (str === '' || isNaN(n)) {
    throw new RpgError(STATUS_INVALID_NUMERIC, `Valeur non numérique '${value}' affectée à ${target} (RNX0105)`);
  }
  return n;
}

// Absorbe les erreurs d'arrondi binaire avant troncature : 1.15 * 100 = 114.99999999999999
function normalize(n: number): number {
  return Number(n.toPrecision(15));
}

function overflow(value: any, type: DataTypeNode, target: string): Error {
  return new RpgError(STATUS_OVERFLOW, `Dépassement de capacité : ${value} ne tient pas dans ${target} ${describeType(type)} (RNX0103)`);
}

// Une date, une heure ou un timestamp ne reçoit qu'une valeur du même type
function coerceDateTime(value: any, type: DataTypeNode, target: string): any {
  if (value instanceof FigurativeValue) return resolveFigurative(value, type.typeName as DateTimeKind);
  if (kindOf(value) === type.typeName) return value;
  throw incompatibleAssignment(value, type, target);
}

function incompatibleAssignment(value: any, type: DataTypeNode, target: string): Error {
  return incompatibleTypes(`Affectation de ${describeValue(value)} à ${target} ${describeType(type)}`);
}

// Nature d'une valeur pour les messages d'erreur
export function describeValue(value: any): string {
  if (value instanceof FigurativeValue) return value.name.toUpperCase();
  const kind = kindOf(value);
  if (kind) return `${kind.toUpperCase()} ${value}`;
  if (typeof value === 'number') return `numérique ${value}`;
  if (typeof value === 'boolean') return 'indicateur';
  return `caractère '${value}'`;
}
