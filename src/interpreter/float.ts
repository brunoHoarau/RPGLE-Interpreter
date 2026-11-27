// Analyse statique : une expression est-elle flottante ? (variable, élément, sous-zone ou retour déclaré FLOAT,
// littéral à exposant, %FLOAT, -x, %ABS(x), opération arithmétique ayant un opérande flottant)
// Résultat : 4 pour une zone FLOAT(4) seule, 8 pour toute autre expression flottante, undefined sinon.
import { ExpressionNode } from '../types';
import { InterpreterState } from './state';
import { declaredType } from './calls';

export function floatLength(s: InterpreterState, expr: ExpressionNode | undefined): 4 | 8 | undefined {
  if (!expr) return undefined;
  if (expr.operator === 'neg') return floatLength(s, expr.left) && 8;
  if (expr.operator) {
    if (!['+', '-', '*', '/', '**'].includes(expr.operator)) return undefined;
    return floatLength(s, expr.left) || floatLength(s, expr.right) ? 8 : undefined;
  }
  switch (expr.valueType) {
    case 'number': return expr.isFloat ? 8 : undefined;
    case 'builtin': {
      const name = expr.value.name.toLowerCase();
      if (name === '%float') return 8;
      if (name === '%abs') return floatLength(s, expr.value.args?.[0]) && 8;
      return undefined;
    }
    case 'element': case 'call': return ofType(declaredType(s, expr));
    case 'identifier': {
      const type = s.runtime.getType(expr.value);
      if (type) return ofType(type);
      const literal = s.runtime.getConstantLiteral(expr.value);
      return literal ? floatLength(s, literal) : undefined;
    }
    default: return undefined;
  }
}

function ofType(type: { typeName: string; length?: number } | undefined): 4 | 8 | undefined {
  return type?.typeName === 'float' ? (type.length === 4 ? 4 : 8) : undefined;
}
