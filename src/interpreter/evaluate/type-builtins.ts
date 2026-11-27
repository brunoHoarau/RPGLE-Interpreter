import { ExpressionNode, DataTypeNode } from '../../types';
import { byteLength } from '../../datatypes';
import { DsShape } from '../../ds-shape';
import { NotSupportedError } from '../../errors';
import { highValue, lowValue } from '../../datetime';
import { editw } from '../../editw';
import { declaredType } from '../calls';
import { InterpreterState } from '../state';

// Types dont la taille en octets est connue sans ambiguïté (dates : dépend de DATFMT, non simulé)
const SIZED_TYPES = new Set(['char', 'varchar', 'ind', 'int', 'uns', 'packed', 'zoned']);

function typeSize(type: DataTypeNode | undefined, what: string): number {
  if (!type || !SIZED_TYPES.has(type.typeName)) throw new NotSupportedError(`%SIZE de ${what}`);
  return byteLength(type);
}

// Taille d'une DS : fin de la sous-zone qui va le plus loin
function dsSize(shape: DsShape, name: string): number {
  return Math.max(0, ...shape.fields.map(f => f.start - 1 + typeSize(f.type, `la sous-zone ${name.toUpperCase()}.${f.name.toUpperCase()}`)));
}

// %SIZE(zone {: *ALL}) : taille en octets ; pour un tableau, d'un élément, ou de tous avec *ALL
export function sizeBuiltin(s: InterpreterState, args: ExpressionNode[]): number {
  const [operand, all] = args;
  const name = typeof operand.value === 'string' ? operand.value : '';
  if (operand.valueType === 'array') {
    const shape = s.runtime.getShape(name);
    const element = s.runtime.isDsArray(name) && shape ? dsSize(shape, name) : typeSize(s.runtime.getType(name), name.toUpperCase());
    return all ? element * s.runtime.array(name).max : element;
  }
  if (all) throw new Error(`%SIZE(${name.toUpperCase() || 'expression'} : *ALL) : le 1er argument doit être un tableau`);
  if (operand.valueType === 'string') return String(operand.value).length;
  if (operand.valueType === 'identifier') {
    const shape = s.runtime.getShape(name);
    if (shape) return dsSize(shape, name);
    return typeSize(s.runtime.getType(name), name.toUpperCase());
  }
  if (operand.valueType === 'element') {
    const ref = operand.value;
    if (!ref.field && s.runtime.isDsArray(ref.name)) {
      const shape = s.runtime.getShape(ref.name);
      if (shape) return dsSize(shape, ref.name);
    }
    return typeSize(declaredType(s, operand), `${String(ref.name).toUpperCase()}(…)`);
  }
  throw new NotSupportedError(`%SIZE d'un littéral numérique ou d'une expression`);
}

// %HIVAL / %LOVAL(zone) : plus grande / plus petite valeur du type déclaré de la zone
export function limitBuiltin(s: InterpreterState, name: '%hival' | '%loval', args: ExpressionNode[]): any {
  const operand = args[0];
  const type = operand?.valueType === 'identifier' || operand?.valueType === 'element' ? declaredType(s, operand) : undefined;
  const high = name === '%hival';
  const what = `${name.toUpperCase()} de ${type ? type.typeName.toUpperCase() : 'une expression'}`;
  if (!type) throw new NotSupportedError(what);
  if (type.typeName === 'date' || type.typeName === 'time' || type.typeName === 'timestamp') {
    return high ? highValue(type.typeName) : lowValue(type.typeName);
  }
  if (type.typeName === 'packed' || type.typeName === 'zoned') {
    const digits = type.length ?? 0, decimals = type.decimals ?? 0;
    if (digits > 15) throw new NotSupportedError(`${what} de plus de 15 chiffres`);
    const max = Number(`${'9'.repeat(digits - decimals) || '0'}.${'9'.repeat(decimals) || '0'}`);
    return high ? max : -max;
  }
  if (type.typeName === 'int' || type.typeName === 'uns') {
    const bits = byteLength(type) * 8;
    if (bits > 32) throw new NotSupportedError(`${what}(20)`);
    if (type.typeName === 'uns') return high ? 2 ** bits - 1 : 0;
    return high ? 2 ** (bits - 1) - 1 : -(2 ** (bits - 1));
  }
  throw new NotSupportedError(what);
}

// %EDITW(zone : mot d'édition) : chiffres et décimales viennent du type déclaré ; le mot d'édition est une constante
export function editwBuiltin(s: InterpreterState, args: ExpressionNode[], evaluate: (e: ExpressionNode) => any): string {
  const [operand, wordExpr] = args;
  const literal = wordExpr?.valueType === 'identifier' ? s.runtime.getConstantLiteral(wordExpr.value) : wordExpr;
  if (literal?.valueType !== 'string') throw new Error(`%EDITW : le mot d'édition doit être un littéral ou une constante caractère`);
  const type = operand?.valueType === 'identifier' || operand?.valueType === 'element' ? declaredType(s, operand) : undefined;
  if (type?.typeName === 'packed' || type?.typeName === 'zoned') {
    return editw(evaluate(operand), type.length ?? 0, type.decimals ?? 0, String(literal.value));
  }
  if (type?.typeName === 'int' || type?.typeName === 'uns') {
    return editw(evaluate(operand), type.length ?? 10, 0, String(literal.value));
  }
  throw new NotSupportedError(`%EDITW d'une valeur sans type numérique déclaré (littéral, expression)`);
}
