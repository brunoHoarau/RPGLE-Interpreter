import { defaultValue, isDataStructure } from '../datatypes';
import { materialize } from '../arrays';
import { DsShape } from '../ds-shape';
import { NotSupportedError } from '../errors';
import { elementTarget } from './evaluate/element';
import { assignTo } from './statements';
import { InterpreterState } from './state';

const defaultFields = (shape: DsShape): { [field: string]: any } =>
  Object.fromEntries(shape.fields.map(f => [f.name.toLowerCase(), defaultValue(f.type)]));

function shapeOf(s: InterpreterState, name: string): DsShape {
  const shape = s.runtime.getShape(name);
  if (!shape) throw new Error(`Disposition de la structure de données ${name.toUpperCase()} inconnue`);
  return shape;
}

// CLEAR : chaque variable reprend la valeur par défaut de son type (jamais INZ) ; une DS, sous-zone par sous-zone
export function executeClear(s: InterpreterState, node: any): void {
  const { name, target } = node;
  const runtime = s.runtime;
  if (name.startsWith('*in')) return assignTo(s, name, false);
  if (target) {
    // tab(i), ds(i), ds(i).champ
    const at = elementTarget(s, target);
    if (target.field) {
      const type = runtime.getType(`${name}.${target.field}`);
      if (!type) throw new Error(`Champ '${target.field}' non trouvé dans '${name}'`);
      return runtime.setElementFields(name, at, [[target.field, defaultValue(type)]]);
    }
    if (runtime.isDsArray(name)) {
      return runtime.setElementFields(name, at, shapeOf(s, name).fields.map(f => [f.name, defaultValue(f.type)]));
    }
    return runtime.setElement(name, at, defaultValue(runtime.array(name).type));
  }
  if (runtime.isArray(name)) {
    if (runtime.isAutoArray(name)) throw new NotSupportedError(`CLEAR du tableau DIM(*AUTO) ${name.toUpperCase()}`);
    const items = materialize(runtime.array(name));
    if (runtime.isDsArray(name)) {
      const shape = shapeOf(s, name);
      items.forEach((_, i) => { items[i] = defaultFields(shape); });
    } else {
      items.fill(defaultValue(runtime.array(name).type));
    }
    return;
  }
  if (!runtime.hasVariable(name.split('.')[0])) {
    const format = s.files.has(name.toUpperCase()) || s.displays.has(name.toUpperCase());
    if (format) throw new NotSupportedError(`CLEAR du format d'enregistrement ou du fichier ${name.toUpperCase()}`);
    throw new Error(`Variable non déclarée: ${name}`);
  }
  if (!name.includes('.') && isDataStructure(runtime.lookup(name))) {
    return shapeOf(s, name).fields.forEach(f => runtime.setField(name, f.name, defaultValue(f.type)));
  }
  const type = runtime.getType(name);
  if (!type) throw new Error(`Variable non déclarée: ${name}`);
  assignTo(s, name, defaultValue(type));
}
