import { ExpressionNode } from '../../types';
import { describeValue } from '../../datatypes';
import { RpgError, STATUS_DIVIDE_BY_ZERO, NotSupportedError, incompatibleTypes } from '../../errors';
import { isZeroOrBlank } from '../declarations';
import { involvesDateTime, dateTimeOperation } from './datetime';
import { evaluate, zeroOrBlankLike } from './evaluate';
import { InterpreterState } from '../state';

// Deux chaînes de longueurs différentes se comparent comme si la plus courte
// était complétée par des blancs : 'Dupont    ' = 'Dupont'
export function compare(left: any, right: any): number {
  // Un indicateur se compare à un caractère comme '1' ou '0'
  if (typeof left === 'boolean' && typeof right === 'string') left = left ? '1' : '0';
  if (typeof right === 'boolean' && typeof left === 'string') right = right ? '1' : '0';
  if (typeof left === 'string' && typeof right === 'string') {
    const length = Math.max(left.length, right.length);
    left = left.padEnd(length, ' ');
    right = right.padEnd(length, ' ');
  }
  if (left === right) return 0;
  return left < right ? -1 : left > right ? 1 : NaN;
}

export const COMPARISONS: { [op: string]: (c: number) => boolean } = {
  '=': c => c === 0, '<>': c => c !== 0, '<': c => c < 0, '<=': c => c <= 0, '>': c => c > 0, '>=': c => c >= 0,
};

export function executeOperator(s: InterpreterState, expr: ExpressionNode): any {
  const op = expr.operator!;
  let left: any;
  let right: any;
  if (COMPARISONS[op] && isZeroOrBlank(expr.left) !== isZeroOrBlank(expr.right)) {
    if (isZeroOrBlank(expr.left)) {
      right = evaluate(s, expr.right!);
      left = zeroOrBlankLike(s, expr.left!.value, right);
    } else {
      left = evaluate(s, expr.left!);
      right = zeroOrBlankLike(s, expr.right!.value, left);
    }
  } else {
    left = expr.left ? evaluate(s, expr.left) : undefined;
    right = expr.right ? evaluate(s, expr.right) : undefined;
  }
  if (involvesDateTime(left) || involvesDateTime(right)) {
    return dateTimeOperation(op, left, right);
  }

  const refuse = () => incompatibleTypes(
    op === 'neg' || op === 'not'
      ? `Opérateur ${op === 'neg' ? '-' : 'NOT'} appliqué à ${describeValue(left)}`
      : `Opérateur ${op.toUpperCase()} entre ${describeValue(left)} et ${describeValue(right)}`);
  const isNum = (v: any) => typeof v === 'number';
  const isText = (v: any) => typeof v === 'string';
  const isInd = (v: any) => typeof v === 'boolean';
  const unknown = left === null || left === undefined || (op !== 'neg' && op !== 'not' && (right === null || right === undefined));

  switch (op) {
    case '+':
      if (isNum(left) && isNum(right)) return left + right;
      if (isText(left) && isText(right)) return left + right;
      if ((isText(left) && isInd(right)) || (isInd(left) && isText(right))) {
        throw new NotSupportedError('Indicateur dans une concaténation');
      }
      if (!unknown) throw refuse();
      return left + right;
    case '-': case '*': case '/': case '**':
      if (!unknown && !(isNum(left) && isNum(right))) throw refuse();
      if (op === '-') return left - right;
      if (op === '*') return left * right;
      if (op === '**') return Math.pow(left, right);
      if (right === 0) throw new RpgError(STATUS_DIVIDE_BY_ZERO, 'Division par zéro (RNX0102)');
      return left / right;
    case '=': case '<>': case '<': case '<=': case '>': case '>=': {
      const comparable = (isNum(left) && isNum(right)) || (isText(left) && isText(right)) || (isInd(left) && isInd(right))
        || (isInd(left) && isText(right)) || (isText(left) && isInd(right));
      if (!unknown && !comparable) throw refuse();
      return COMPARISONS[op](compare(left, right));
    }
    case 'and': case 'or':
      if (!unknown && !(isInd(left) && isInd(right))) throw refuse();
      return op === 'and' ? left && right : left || right;
    case 'not':
      if (!isInd(left)) throw refuse();
      return !left;
    case 'neg':
      if (!isNum(left)) throw refuse();
      return -left;
    default: throw new Error(`Opérateur non supporté: ${expr.operator}`);
  }
}
