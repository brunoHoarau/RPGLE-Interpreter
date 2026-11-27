import { defaultValue, isDataStructure } from '../datatypes';
import { materialize } from '../arrays';
import { DsShape } from '../ds-shape';
import { NotSupportedError } from '../errors';
import { elementTarget } from './evaluate/element';
import { assignTo } from './statements';
import { InterpreterState } from './state';
import { subarrRange } from './array-ops';

const defaultFields = (shape: DsShape): { [field: string]: any } =>
  Object.fromEntries(shape.fields.map(f => [f.name.toLowerCase(), defaultValue(f.type)]));

export function shapeOf(s: InterpreterState, name: string): DsShape {
  const shape = s.runtime.getShape(name);
  if (!shape) throw new Error(`Disposition de la structure de données ${name.toUpperCase()} inconnue`);
  return shape;
}

// Cible déclarée : un nom de format ou de fichier est refusé, un nom inconnu est une erreur
export function checkTarget(s: InterpreterState, name: string, op: string): void {
  if (s.runtime.hasVariable(name.split('.')[0])) return;
  const format = s.files.has(name.toUpperCase()) || s.displays.has(name.toUpperCase());
  if (format) throw new NotSupportedError(`${op} du format d'enregistrement ou du fichier ${name.toUpperCase()}`);
  throw new Error(`Variable non déclarée: ${name}`);
}

// tab(i), ds(i), ds(i).champ
function clearElement(s: InterpreterState, name: string, at: number | '*next', field?: string): void {
  const runtime = s.runtime;
  if (field) {
    const type = runtime.getType(`${name}.${field}`);
    if (!type) throw new Error(`Champ '${field}' non trouvé dans '${name}'`);
    return runtime.setElementFields(name, at, [[field, defaultValue(type)]]);
  }
  if (runtime.isDsArray(name)) {
    return runtime.setElementFields(name, at, shapeOf(s, name).fields.map(f => [f.name, defaultValue(f.type)]));
  }
  runtime.setElement(name, at, defaultValue(runtime.array(name).type));
}

// CLEAR : chaque variable reprend la valeur par défaut de son type (jamais INZ) ; une DS, sous-zone par sous-zone
export function executeClear(s: InterpreterState, node: any): void {
  const { name, target } = node;
  const runtime = s.runtime;
  if (name.startsWith('*in')) return assignTo(s, name, false);
  if (target) return clearElement(s, name, elementTarget(s, target), target.field);
  if (node.range) {
    const [from, to] = subarrRange(s, name, node.range.start, node.range.count);
    for (let i = from; i <= to; i++) clearElement(s, name, i);
    return;
  }
  if (runtime.isArray(name)) {
    // DIM(*AUTO) : CLEAR remet le nombre d'éléments à 0, comme %ELEM(tab) = 0 (confirmé sur IBM i)
    if (runtime.isAutoArray(name)) { runtime.array(name).values.length = 0; return; }
    const items = materialize(runtime.array(name));
    if (runtime.isDsArray(name)) {
      const shape = shapeOf(s, name);
      items.forEach((_, i) => { items[i] = defaultFields(shape); });
    } else {
      items.fill(defaultValue(runtime.array(name).type));
    }
    return;
  }
  checkTarget(s, name, 'CLEAR');
  if (!name.includes('.') && isDataStructure(runtime.lookup(name))) {
    return shapeOf(s, name).fields.forEach(f => runtime.setField(name, f.name, defaultValue(f.type)));
  }
  const type = runtime.getType(name);
  if (!type) throw new Error(`Variable non déclarée: ${name}`);
  assignTo(s, name, defaultValue(type));
}
