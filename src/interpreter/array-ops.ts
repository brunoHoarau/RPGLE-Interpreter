import { ExpressionNode, DataTypeNode } from '../types';
import { describeType, describeValue } from '../datatypes';
import { NotSupportedError, RpgError, STATUS_ARRAY_INDEX, incompatibleTypes } from '../errors';
import { materialize } from '../arrays';
import { compare } from './evaluate/operators';
import { evaluate } from './evaluate/evaluate';
import { elementIndexValue } from './evaluate/element';
import { InterpreterState } from './state';

type Category = 'number' | 'string' | 'boolean';
interface ArrayRef { name: string; field?: string }

const NUMERIC = ['int', 'uns', 'packed', 'zoned'];

// Catégorie de comparaison des éléments (les dates, heures et timestamps ne sont pas simulés ici)
function elementCategory(type: DataTypeNode | undefined, what: string): Category {
  if (type && NUMERIC.includes(type.typeName)) return 'number';
  if (type && (type.typeName === 'char' || type.typeName === 'varchar')) return 'string';
  if (type && type.typeName === 'ind') return 'boolean';
  throw new NotSupportedError(`${what} sur un tableau ${type ? describeType(type) : 'de type inconnu'}`);
}

function operandType(s: InterpreterState, ref: ArrayRef, what: string): DataTypeNode {
  const type = s.runtime.getType(ref.field ? `${ref.name}.${ref.field}` : ref.name);
  if (!type) throw new Error(`Champ '${ref.field}' non trouvé dans '${ref.name}'`);
  elementCategory(type, what);
  return type;
}

// %LOOKUP(valeur : tableau {: début {: nombre}}) : index du premier élément égal (ordre de compare), 0 si absent
export function lookup(s: InterpreterState, args: ExpressionNode[]): number {
  const ref: ArrayRef = args[1].value;
  const label = `${ref.name}${ref.field ? `(*).${ref.field}` : ''}`.toUpperCase();
  const type = operandType(s, ref, '%LOOKUP');
  const value = evaluate(s, args[0]);
  const valueCategory = typeof value;
  if (valueCategory !== 'number' && valueCategory !== 'string' && valueCategory !== 'boolean') {
    throw new NotSupportedError(`%LOOKUP d'une valeur ${describeValue(value)}`);
  }
  if (valueCategory !== elementCategory(type, '%LOOKUP')) {
    throw incompatibleTypes(`%LOOKUP(${describeValue(value)} : ${label} ${describeType(type)})`);
  }
  const integer = (expr: ExpressionNode, what: string): number => elementIndexValue(evaluate(s, expr), `%LOOKUP, ${what} de ${label}`);
  const count = s.runtime.arrayCount(ref.name);
  const start = args[2] ? integer(args[2], 'début') : 1;
  const length = args[3] ? integer(args[3], 'nombre') : undefined;
  if (count === 0) return 0;
  const end = length === undefined ? count : start + length - 1;
  if (start < 1 || start > count || (length !== undefined && (length < 0 || end > count))) {
    throw new RpgError(STATUS_ARRAY_INDEX, `%LOOKUP de ${label} : début ${start}${length === undefined ? '' : ` et nombre ${length}`} hors des limites (RNX0121)`);
  }
  for (let i = start; i <= end; i++) {
    const element = ref.field ? s.runtime.getElementField(ref.name, i, ref.field) : s.runtime.getElement(ref.name, i);
    if (compare(element, value) === 0) return i;
  }
  return 0;
}

// SORTA[(A|D)] tab | d(*).champ : tri stable des éléments courants (ordre de compare, donc EBCDIC) ; les DS sont déplacées entières
export function executeSorta(s: InterpreterState, node: any): void {
  operandType(s, node, 'SORTA');
  const store = s.runtime.array(node.name);
  const items = materialize(store);
  const key = (item: any) => (node.field ? item[node.field.toLowerCase()] : item);
  const sorted = [...items].sort((a, b) => (node.descending ? -1 : 1) * compare(key(a), key(b)));
  sorted.forEach((item, i) => { items[i] = item; });
}
