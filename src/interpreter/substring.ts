import { describeType } from '../datatypes';
import { stringRange } from '../builtins';
import { valueFor } from './declarations';
import { evaluate } from './evaluate/evaluate';
import { executeAssignment } from './statements';
import { InterpreterState } from './state';

// {EVAL | EVALR} %SUBST(cible : début {: longueur}) = valeur : la plage est contrôlée sur la longueur
// courante de la cible (statut 00100 sinon), puis reçoit la valeur cadrée à gauche (EVAL) ou à droite
// (EVALR), complétée de blancs ou tronquée ; la longueur de la cible ne change pas.
export function assignSubstring(s: InterpreterState, node: any): void {
  const { start, length, current } = node.substring;
  const target = node.target ? (node.target.field ? `${node.target.name}.${node.target.field}` : node.target.name) : node.variable;
  if (s.runtime.isArray(target) && !node.target) throw s.runtime.wholeArray(target);
  const type = s.runtime.getType(target);
  if (type?.typeName !== 'char' && type?.typeName !== 'varchar') {
    throw new Error(`%SUBST exige une cible caractère : ${target.toUpperCase()} est ${type ? describeType(type) : 'une structure de données'}`);
  }
  const text = String(evaluate(s, current));
  const from = Number(evaluate(s, start));
  const count = length ? Number(evaluate(s, length)) : undefined;
  const [begin, end] = stringRange('%SUBST', text, from, count);
  const size = end - begin;
  const piece = String(valueFor(s, node.value, { type: 'DataType', typeName: 'char', length: size } as any, `%SUBST(${target.toUpperCase()})`));
  const fitted = node.rightAdjust
    ? (piece.length >= size ? piece.slice(piece.length - size) : piece.padStart(size, ' '))
    : (piece.length >= size ? piece.slice(0, size) : piece.padEnd(size, ' '));
  const value = { type: 'Expression', valueType: 'string', value: text.slice(0, begin) + fitted + text.slice(end) };
  executeAssignment(s, { type: 'Assignment', variable: node.variable, target: node.target, value });
}
