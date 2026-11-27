// BIF dont le résultat dépend du caractère flottant de l'argument (connu seulement par le type déclaré)
import { ExpressionNode } from '../../types';
import { NotSupportedError, incompatibleTypes } from '../../errors';
import { describeValue } from '../../datatypes';
import { formatFloat, truncateExact } from '../../float';
import { floatLength } from '../float';
import { InterpreterState } from '../state';
import { evaluate } from './evaluate';

// %EDITFLT(numérique) : 14 caractères pour une zone FLOAT(4), 23 sinon ; un décimal ou un entier est converti en flottant
export function editfltBuiltin(s: InterpreterState, args: ExpressionNode[]): string {
  const value = evaluate(s, args[0]);
  if (typeof value !== 'number') throw incompatibleTypes(`%EDITFLT(${describeValue(value)})`);
  return formatFloat(value, floatLength(s, args[0]) ?? 8);
}

// %INT(flottant) et %DEC(flottant : p : d) : troncature de la valeur binaire exacte
export function floatToNumber(s: InterpreterState, name: string, args: ExpressionNode[]): number {
  const value = evaluate(s, args[0]);
  if (typeof value !== 'number') throw incompatibleTypes(`${name.toUpperCase()}(${describeValue(value)})`);
  if (name === '%int') return truncateExact(value, 0);
  if (args.length < 3) throw new NotSupportedError('%DEC d\'un flottant sans longueur ni décimales : précision IBM i non simulée');
  const [precision, decimals] = args.slice(1).map(a => evaluate(s, a));
  return s.runtime.executeBuiltin('%dec', [truncateExact(value, decimals), precision, decimals]);
}
