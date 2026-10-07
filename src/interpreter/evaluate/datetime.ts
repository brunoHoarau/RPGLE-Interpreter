import { describeValue } from '../../datatypes';
import { DateTimeValue, FigurativeValue, RpgDuration, addDuration, compareDateTime, isDateTime, isDuration, kindOf, resolveFigurative } from '../../datetime';
import { RpgError, STATUS_DATE_OVERFLOW, incompatibleTypes } from '../../errors';
import { COMPARISONS } from './operators';

export const involvesDateTime = (value: any) => isDateTime(value) || isDuration(value) || value instanceof FigurativeValue;

// Avec une date, une heure ou un timestamp : comparaison au même type, ou + / - d'une durée à droite.
// *LOVAL / *HIVAL prennent le type de l'autre opérande.
export function dateTimeOperation(op: string, left: any, right: any): any {
  if ((op === '+' || op === '-') && isDateTime(left) && isDuration(right)) {
    return applyDuration(left, right, op === '+' ? 1 : -1);
  }
  if (op === '+' && isDuration(left) && isDateTime(right)) {
    throw new Error(`Durée à gauche d'une date (${left} + ${describeValue(right)}) : pas encore supporté par l'interpréteur`);
  }
  const test = COMPARISONS[op];
  if (left instanceof FigurativeValue && kindOf(right)) left = resolveFigurative(left, kindOf(right)!);
  if (right instanceof FigurativeValue && kindOf(left)) right = resolveFigurative(right, kindOf(left)!);
  if (test && kindOf(left) !== undefined && kindOf(left) === kindOf(right)) {
    return test(compareDateTime(left, right));
  }
  const operands = right === undefined ? describeValue(left) : `${describeValue(left)} et ${describeValue(right)}`;
  throw incompatibleTypes(`Opération ${op.toUpperCase()} avec ${operands}`);
}

// Traduit un échec du calcul en erreur RPG
export function applyDuration(value: DateTimeValue, duration: RpgDuration, sign: 1 | -1): DateTimeValue {
  const result = addDuration(value, duration, sign);
  if (typeof result !== 'string') return result;
  const what = `${describeValue(value)} ${sign > 0 ? '+' : '-'} ${duration}`;
  switch (result) {
    case 'unit': throw incompatibleTypes(what);
    case 'overflow': throw new RpgError(STATUS_DATE_OVERFLOW, `Résultat hors limites pour ${what} (RNX0113)`);
    case 'wrap': throw new Error(`${what} passe minuit : pas encore supporté par l'interpréteur`);
    case '24h': throw new Error(`Calcul sur la valeur 24.00.00 (${what}) : pas encore supporté par l'interpréteur`);
  }
  throw new Error(`Cas imprévu : ${result}`);
}
