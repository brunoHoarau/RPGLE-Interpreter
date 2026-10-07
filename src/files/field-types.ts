// Types des zones d'un fichier : lecture de leur description, contrôle de tenue d'une valeur.
import type { DataTypeNode } from '../types';

export const NUMERIC = new Set(['int', 'uns', 'packed', 'zoned']);
export const dataType = (typeName: string, length?: number, decimals?: number): DataTypeNode =>
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

export const INT_BITS: { [digits: number]: number } = { 3: 8, 5: 16, 10: 32, 20: 64 };

// La valeur tient-elle dans la zone sans troncature ni arrondi ? (CHAR : blancs de fin ignorés ; VARCHAR : longueur exacte)
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
  if (kind === 'char') {
    return type.length === undefined || String(value).replace(/ +$/, '').length <= type.length;
  }
  if (kind === 'varchar') {
    return type.length === undefined || String(value).length <= type.length;
  }
  return true;
}

// Absorbe les erreurs d'arrondi binaire (0.1 + 0.2)
export const normalize = (n: number): number => Number(n.toPrecision(15));
