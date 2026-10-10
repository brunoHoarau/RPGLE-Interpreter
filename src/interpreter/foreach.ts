import { isDataStructure, checkAssignable } from '../datatypes';
import { NotSupportedError, incompatibleTypes } from '../errors';
import { runIteration } from './control-flow';
import { sameLayout } from './ds-assign';
import { assignTo } from './statements';
import { InterpreterState } from './state';

// FOR-EACH item IN tableau : le nombre d'éléments est lu au départ ; chaque élément est copié dans item
// (scalaire : contrôle puis coercition vers le type de item ; DS : même disposition exigée). item garde le dernier élément.
export function executeForEach(s: InterpreterState, node: any): void {
  const { item, source } = node;
  const itemIsDs = !item.includes('.') && isDataStructure(s.runtime.lookup(item));
  if (itemIsDs !== s.runtime.isDsArray(source)) {
    throw incompatibleTypes(`FOR-EACH ${item.toUpperCase()} IN ${source.toUpperCase()}`);
  }
  const to = itemIsDs ? s.runtime.getShape(item) : undefined;
  const from = itemIsDs ? s.runtime.getShape(source) : undefined;
  if (itemIsDs && (!to || !from || !sameLayout(to, from))) {
    throw new NotSupportedError(`FOR-EACH ${item.toUpperCase()} IN ${source.toUpperCase()} : ${source.toUpperCase()} n'a pas la même disposition (types des sous-zones, copie d'octets non simulée)`);
  }
  const count = s.runtime.arrayCount(source);
  for (let i = 1; i <= count; i++) {
    if (to && from) {
      const values = from.fields.map(f => s.runtime.getElementField(source, i, f.name));
      to.fields.forEach((f, j) => s.runtime.setField(item, f.name, values[j]));
    } else {
      const value = s.runtime.getElement(source, i);
      checkAssignable(value, s.runtime.getType(item), item, false);
      assignTo(s, item, value);
    }
    if (!runIteration(s, node.body)) return;
  }
}
