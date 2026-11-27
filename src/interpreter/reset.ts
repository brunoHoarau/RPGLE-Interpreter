import { isDataStructure } from '../datatypes';
import { NotSupportedError, RpgError, STATUS_RESET_DURING_INIT } from '../errors';
import { elementTarget } from './evaluate/element';
import { assignTo } from './statements';
import { shapeOf, checkTarget } from './clear';
import { InterpreterState } from './state';

// Valeurs de RESET : celles de fin d'initialisation (INZ, puis *INZSR) pour le programme principal,
// celles du premier appel avant ses calculs pour les variables locales d'une procédure.
// s.initialValues : '' pour les globales, nom de procédure (minuscules) pour ses locales.

const PARAMETER = Symbol('paramètre');

const copy = (v: any): any =>
  Array.isArray(v) ? v.map(copy) : v && typeof v === 'object' && v.constructor === Object ? { ...v } : v;

const scopeKey = (s: InterpreterState): string =>
  s.runtime.callDepth === 0 ? '' : s.runtime.getCallStack().slice(-1)[0].toLowerCase();

function current(s: InterpreterState, name: string): any {
  return s.runtime.isArray(name) ? s.runtime.array(name).values.map(copy) : copy(s.runtime.lookup(name));
}

function snapshots(s: InterpreterState, key: string): Map<string, any> {
  let map = s.initialValues.get(key);
  if (!map) s.initialValues.set(key, map = new Map());
  return map;
}

// Déclaration exécutée : la valeur de RESET d'une locale est fixée au premier appel de sa procédure
export function rememberInitial(s: InterpreterState, names: string[]): void {
  const map = snapshots(s, scopeKey(s));
  for (const name of names) {
    const key = name.toLowerCase();
    if (s.runtime.callDepth === 0 || !map.has(key)) map.set(key, current(s, key));
  }
}

// Paramètre : pas de valeur de RESET (refusé)
export function rememberParameter(s: InterpreterState, name: string): void {
  const map = snapshots(s, scopeKey(s));
  if (!map.has(name.toLowerCase())) map.set(name.toLowerCase(), PARAMETER);
}

// Fin de *INZSR : les globales, zones de fichier et indicateurs prennent leur valeur de RESET
export function rememberGlobals(s: InterpreterState): void {
  const map = snapshots(s, '');
  const indicators = ['*inlr', ...Array.from({ length: 99 }, (_, i) => `*in${String(i + 1).padStart(2, '0')}`)];
  const names = [...map.keys(), ...s.fileFields.keys(), ...indicators];
  for (const name of names) {
    if (map.get(name) !== PARAMETER && s.runtime.hasVariable(name)) map.set(name, current(s, name));
  }
}

export function executeReset(s: InterpreterState, node: any): void {
  const { name, target } = node;
  const runtime = s.runtime;
  checkTarget(s, name, 'RESET');
  const root = name.split('.')[0].toLowerCase();
  const local = runtime.callDepth > 0 ? s.initialValues.get(scopeKey(s)) : undefined;
  const isLocal = local?.has(root) ?? false;
  if (!isLocal && s.initializing) {
    throw new RpgError(STATUS_RESET_DURING_INIT, `RESET de ${name.toUpperCase()} pendant l'initialisation du programme (*INZSR) (RNX0109)`);
  }
  const saved = isLocal ? local!.get(root) : s.initialValues.get('')?.get(root);
  if (saved === PARAMETER) throw new NotSupportedError(`RESET du paramètre ${name.toUpperCase()}`);
  if (saved === undefined) throw new NotSupportedError(`RESET de ${name.toUpperCase()} (pas de valeur d'initialisation connue)`);

  if (target) {
    // tab(i), ds(i), ds(i).champ
    const store = runtime.array(name);
    const at = elementTarget(s, target);
    const element = at !== '*next' && at <= saved.length ? copy(saved[at - 1]) : store.fresh();
    if (target.field) return runtime.setElementFields(name, at, [[target.field, element[target.field.toLowerCase()]]]);
    if (runtime.isDsArray(name)) return runtime.setElementFields(name, at, Object.entries(element));
    return runtime.setElement(name, at, element);
  }
  if (runtime.isArray(name)) {
    const values = runtime.array(name).values;
    values.length = 0;
    values.push(...copy(saved));
    return;
  }
  if (name.includes('.')) return assignTo(s, name, copy(saved[name.split('.')[1].toLowerCase()]));
  if (isDataStructure(runtime.lookup(name))) {
    return shapeOf(s, name).fields.forEach(f => runtime.setField(name, f.name, saved[f.name.toLowerCase()]));
  }
  assignTo(s, name, copy(saved));
}
