// Présentation d'une valeur numérique par DSPLY, constatée sur IBM i :
// chiffres sans point décimal, zéros de tête supprimés (le dernier chiffre reste), cadrés à droite
// sur la longueur du type, suivis du signe ('-' si négatif, blanc sinon).
//   packed(7:2) 100 -> '  10000 '   packed(7:2) -1.5 -> '    150-'   int(10) -42 -> '        42-'
import { DataTypeNode, ExpressionNode } from '../types';
import { NotSupportedError } from '../errors';
import { InterpreterState } from './state';
import { declaredType } from './calls';

interface NumericFormat {
  digits: number;
  decimals: number;
}

const INTEGER_TYPES = ['int', 'uns'];
const DECIMAL_TYPES = ['packed', 'zoned'];

function typeFormat(type: DataTypeNode | undefined): NumericFormat | undefined {
  if (!type || type.length === undefined) return undefined;
  if (INTEGER_TYPES.includes(type.typeName)) return { digits: type.length, decimals: 0 };
  if (DECIMAL_TYPES.includes(type.typeName)) return { digits: type.length, decimals: type.decimals ?? 0 };
  return undefined;
}

// Littéral numérique : autant de chiffres qu'écrits (zéros de tête exclus), décimales comprises
function literalFormat(expr: ExpressionNode): NumericFormat | undefined {
  if (expr.operator === 'neg' && expr.left) return literalFormat(expr.left);
  if (expr.operator || expr.valueType !== 'number') return undefined;
  const decimals = expr.decimals ?? 0;
  const integerDigits = Math.trunc(Math.abs(expr.value)).toString().replace(/^0+/, '').length;
  return { digits: Math.max(1, integerDigits + decimals), decimals };
}

// Feuille de type entier (int/uns) ou littéral entier
function integerLeaf(s: InterpreterState, expr: ExpressionNode): 'int' | 'literal' | undefined {
  if (expr.valueType === 'number' && !expr.operator) return expr.hasDecimalPoint ? undefined : 'literal';
  const type = declaredType(s, expr);
  return type && INTEGER_TYPES.includes(type.typeName) ? 'int' : undefined;
}

// Expression + - * dont toutes les feuilles sont entières, au moins une int/uns : résultat int(20)
function isIntegerExpression(s: InterpreterState, expr: ExpressionNode): boolean {
  const leaves: ('int' | 'literal' | undefined)[] = [];
  const walk = (e: ExpressionNode): boolean => {
    if (e.operator === 'neg') return walk(e.left!);
    if (e.operator) return ['+', '-', '*'].includes(e.operator) && walk(e.left!) && walk(e.right!);
    leaves.push(integerLeaf(s, e));
    return true;
  };
  return walk(expr) && leaves.every(l => l !== undefined) && leaves.includes('int');
}

function numericFormat(s: InterpreterState, expr: ExpressionNode): NumericFormat | undefined {
  if (!expr.operator && expr.valueType === 'identifier') {
    const type = s.runtime.getType(expr.value);
    if (type) return typeFormat(type);
    const literal = s.runtime.getConstantLiteral(expr.value);
    return literal ? literalFormat(literal) : undefined;
  }
  if (!expr.operator && (expr.valueType === 'element' || expr.valueType === 'call')) return typeFormat(declaredType(s, expr));
  const literal = literalFormat(expr);
  if (literal) return literal;
  return isIntegerExpression(s, expr) ? { digits: 20, decimals: 0 } : undefined;
}

export function formatNumericDsply(s: InterpreterState, expr: ExpressionNode, value: number | bigint): string {
  const format = numericFormat(s, expr);
  if (!format) {
    throw new NotSupportedError('DSPLY de cette expression numérique : présentation IBM i non simulée '
      + '(précision du résultat) ; affichez une variable ou %CHAR(...)');
  }
  const negative = value < 0;
  const magnitude = typeof value === 'bigint' ? (negative ? -value : value).toString()
    : Math.abs(value).toFixed(format.decimals).replace('.', '');
  return magnitude.replace(/^0+(?=\d)/, '').padStart(format.digits) + (negative ? '-' : ' ');
}
