// Présentation d'une valeur numérique par DSPLY, constatée sur IBM i :
// chiffres sans point décimal, zéros de tête supprimés (le dernier chiffre reste), cadrés à droite
// sur la longueur du type, suivis du signe ('-' si négatif, blanc sinon).
//   packed(7:2) 100 -> '  10000 '   packed(7:2) -1.5 -> '    150-'   int(10) -42 -> '        42-'
// Longueur du type : déclarée (variable, élément, sous-zone, retour de procédure) ; écrite pour un littéral ;
// chiffres du résultat pour une expression constante (calculée à la compilation) ; int(20) pour une
// expression sur des entiers, -int et %INT ; règles de précision IBM i pour + - * décimaux (un int(n) mêlé
// à un décimal compte pour n chiffres) ; -décimal et %ABS gardent le format ; %DEC(x:l:d) ; %LEN d'un varchar int(10).
import { DataTypeNode, ExpressionNode } from '../types';
import { NotSupportedError } from '../errors';
import { InterpreterState } from './state';
import { declaredType } from './calls';
import { evaluate } from './evaluate/evaluate';

interface NumericFormat {
  kind: 'int' | 'dec' | 'const';
  digits: number;
  decimals: number;
}

const INTEGER_TYPES = ['int', 'uns'];
const DECIMAL_TYPES = ['packed', 'zoned'];
const MAX_DIGITS = 63;          // précision maximale d'un résultat intermédiaire (division)
const MAX_DISPLAY_LENGTH = 52;  // au-delà, le compilateur refuse le DSPLY (RNF7030)
const INT20: NumericFormat = { kind: 'int', digits: 20, decimals: 0 };

function typeFormat(type: DataTypeNode | undefined): NumericFormat | undefined {
  if (!type || type.length === undefined) return undefined;
  if (INTEGER_TYPES.includes(type.typeName)) return { kind: 'int', digits: type.length, decimals: 0 };
  if (DECIMAL_TYPES.includes(type.typeName)) return { kind: 'dec', digits: type.length, decimals: type.decimals ?? 0 };
  return undefined;
}

// Littéral numérique : autant de chiffres qu'écrits (zéros de tête exclus), décimales comprises
function literalFormat(expr: ExpressionNode): NumericFormat {
  const decimals = expr.decimals ?? 0;
  const integerDigits = Math.trunc(Math.abs(expr.value)).toString().replace(/^0+/, '').length;
  return { kind: 'const', digits: Math.max(1, integerDigits + decimals), decimals };
}

// Expression constante calculée à la compilation : chiffres du résultat (entier seulement)
function foldedFormat(s: InterpreterState, expr: ExpressionNode): NumericFormat | undefined {
  const value = evaluate(s, expr);
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return { kind: 'const', digits: Math.abs(value).toString().length, decimals: 0 };
}

// BIF dont la valeur est connue à la compilation, ou de type fixe
function builtinFormat(s: InterpreterState, expr: ExpressionNode): NumericFormat | undefined {
  const name = expr.value.name.toLowerCase();
  const arg: ExpressionNode | undefined = expr.value.args?.[0];
  if (name === '%int') return INT20;
  if (name === '%dec' && expr.value.args?.length === 3) {
    const [digits, decimals] = expr.value.args.slice(1).map((a: ExpressionNode) => evaluate(s, a));
    return { kind: 'dec', digits, decimals };
  }
  if (name === '%abs' && arg) {
    const operand = formatOf(s, arg);
    return operand?.kind === 'const' ? foldedFormat(s, expr) : operand?.kind === 'dec' ? operand : undefined;
  }
  if (name === '%len' && arg && !arg.operator && arg.valueType === 'identifier' && s.runtime.getType(arg.value)?.typeName === 'varchar') {
    return { kind: 'int', digits: 10, decimals: 0 };
  }
  if (name === '%elem' && arg && !arg.operator && typeof arg.value === 'string' && !s.runtime.isAutoArray(arg.value)) {
    return foldedFormat(s, expr);
  }
  if (name === '%len' && arg && !arg.operator && arg.valueType === 'string') return foldedFormat(s, expr);
  return undefined;
}

// Résultat de a op b selon les règles de précision IBM i
function combine(operator: string, a: NumericFormat, b: NumericFormat): NumericFormat | undefined {
  if (a.kind === 'int' || b.kind === 'int') {
    // entier avec entier ou littéral entier : int(20) ; avec un décimal, l'entier int(n) compte pour n chiffres
    const other = a.kind === 'int' ? b : a;
    if (other.kind === 'int' || (other.kind === 'const' && other.decimals === 0)) return INT20;
    return combine(operator, { ...a, kind: 'dec' }, { ...b, kind: 'dec' });
  }
  if (operator === '/') return { kind: 'dec', digits: MAX_DIGITS, decimals: 0 };
  if (operator === '*') return { kind: 'dec', digits: a.digits + b.digits, decimals: a.decimals + b.decimals };
  const decimals = Math.max(a.decimals, b.decimals);
  return { kind: 'dec', digits: Math.max(a.digits - a.decimals, b.digits - b.decimals) + 1 + decimals, decimals };
}

function formatOf(s: InterpreterState, expr: ExpressionNode): NumericFormat | undefined {
  if (expr.operator === 'neg') {
    if (!expr.left?.operator && expr.left?.valueType === 'number') return literalFormat(expr.left);
    const operand = formatOf(s, expr.left!);
    if (operand?.kind === 'const') return foldedFormat(s, expr);
    return operand?.kind === 'int' ? INT20 : operand;
  }
  if (expr.operator) {
    if (!['+', '-', '*', '/'].includes(expr.operator)) return undefined;
    const left = formatOf(s, expr.left!);
    const right = formatOf(s, expr.right!);
    if (!left || !right) return undefined;
    if (left.kind === 'const' && right.kind === 'const') return foldedFormat(s, expr);
    return combine(expr.operator, left, right);
  }
  switch (expr.valueType) {
    case 'number': return literalFormat(expr);
    case 'builtin': return builtinFormat(s, expr);
    case 'element': case 'call': return typeFormat(declaredType(s, expr));
    case 'identifier': {
      const type = s.runtime.getType(expr.value);
      if (type) return typeFormat(type);
      const literal = s.runtime.getConstantLiteral(expr.value);
      return literal ? formatOf(s, literal) : undefined;
    }
    default: return undefined;
  }
}

export function formatNumericDsply(s: InterpreterState, expr: ExpressionNode, value: number | bigint): string {
  const format = formatOf(s, expr);
  if (!format) {
    throw new NotSupportedError('DSPLY de cette expression numérique : présentation IBM i non simulée '
      + '(précision du résultat) ; affichez une variable ou %CHAR(...)');
  }
  if (format.digits + 1 > MAX_DISPLAY_LENGTH) {
    throw new Error(`DSPLY : longueur d'affichage supérieure au maximum admis (${format.digits} chiffres) (RNF7030)`);
  }
  const negative = value < 0;
  const magnitude = typeof value === 'bigint' ? (negative ? -value : value).toString()
    : Math.abs(value).toFixed(format.decimals).replace('.', '');
  return magnitude.replace(/^0+(?=\d)/, '').padStart(format.digits) + (negative ? '-' : ' ');
}
