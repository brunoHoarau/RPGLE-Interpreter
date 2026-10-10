import { ElementRef } from '../../types';
import { NotSupportedError, incompatibleTypes } from '../../errors';
import { describeValue } from '../../datatypes';
import { InterpreterState } from '../state';
import { evaluate } from './evaluate';

// Numéro d'élément d'une référence arr(index) évalué : entier obligatoire.
// '*next' n'a pas de numéro avant l'écriture : il est résolu par le runtime.
export function elementIndex(s: InterpreterState, ref: ElementRef): number {
  if (ref.index === '*' || ref.index === '*next') {
    throw new NotSupportedError(`${ref.name.toUpperCase()}(${ref.index.toUpperCase()}) utilisé comme valeur`);
  }
  const value = evaluate(s, ref.index);
  if (typeof value !== 'number') throw incompatibleTypes(`Index ${describeValue(value)} de ${ref.name.toUpperCase()}`);
  if (!Number.isInteger(value)) {
    throw new NotSupportedError(`Index ${value} de ${ref.name.toUpperCase()} : un index non entier`);
  }
  return value;
}

// Numéro de l'élément visé par une écriture, ou '*next' (résolu par le runtime)
export const elementTarget = (s: InterpreterState, ref: ElementRef): number | '*next' =>
  ref.index === '*next' ? '*next' : elementIndex(s, ref);
