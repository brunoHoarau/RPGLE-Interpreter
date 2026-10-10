import { ExpressionNode } from '../types';
import { isDataStructure, sameDeclaredType } from '../datatypes';
import { DsShape } from '../ds-shape';
import { NotSupportedError } from '../errors';
import { elementIndex, elementTarget } from './evaluate/element';
import { InterpreterState } from './state';

// Source d'une affectation de DS : une DS, ou un élément entier d'une DS tableau
interface DsSource {
  name: string;
  read: (field: string) => any;
}

function dsSource(s: InterpreterState, expr: ExpressionNode): DsSource | undefined {
  if (expr.valueType === 'identifier') {
    const name = String(expr.value);
    if (name.includes('.') || !isDataStructure(s.runtime.lookup(name))) return undefined;
    return { name, read: field => s.runtime.getField(name, field) };
  }
  if (expr.valueType === 'element' && !expr.value.field && s.runtime.isDsArray(expr.value.name)) {
    const ref = expr.value;
    const index = elementIndex(s, ref);
    return { name: ref.name, read: field => s.runtime.getElementField(ref.name, index, field) };
  }
  return undefined;
}

// Mêmes types dans le même ordre (les noms des sous-zones sont indifférents)
export const sameLayout = (to: DsShape, from: DsShape): boolean =>
  to.fields.length === from.fields.length && to.fields.every((f, i) => sameDeclaredType(f.type, from.fields[i].type));

// a = b, d(i) = b, a = d(i), d(i) = d(j) entre deux DS de même disposition (mêmes types dans le même ordre, noms
// indifférents) : copie champ par champ. IBM i copie des octets : toute autre combinaison n'est pas simulée.
export function assignDataStructure(s: InterpreterState, node: any): void {
  const target: string = node.target ? node.target.name : node.variable;
  const label = node.target ? `${target}(…)` : target;
  const refuse = (reason: string) => new NotSupportedError(`Affectation à la structure de données ${label.toUpperCase()} : ${reason} (copie d'octets non simulée)`);
  const source = dsSource(s, node.value);
  if (!source) throw refuse("la valeur n'est pas une structure de données");
  const to = s.runtime.getShape(target);
  const from = s.runtime.getShape(source.name);
  if (!to || !from) throw refuse(`disposition de ${(to ? source.name : target).toUpperCase()} inconnue`);
  if (!sameLayout(to, from)) throw refuse(`${source.name.toUpperCase()} n'a pas la même disposition (types des sous-zones)`);
  // Valeurs lues avant toute écriture, puis passage par la coercition normale de chaque sous-zone
  const values = from.fields.map(f => source.read(f.name));
  if (node.target) {
    s.runtime.setElementFields(target, elementTarget(s, node.target), to.fields.map((f, i) => [f.name, values[i]]));
  } else {
    to.fields.forEach((f, i) => s.runtime.setField(target, f.name, values[i]));
  }
}
