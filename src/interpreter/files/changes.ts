import { FileOperationNode } from '../../types';
import { fitsField } from '../../files';
import { describeType } from '../../datatypes';
import { isDateTime, isDateTimeType, parseIso } from '../../datetime';
import { RpgError, NotSupportedError } from '../../errors';
import { NUMERIC_TYPES } from '../evaluate/builtins';
import { fileState } from './operations';
import { fieldsToUpdate } from './ds-io';
import { InterpreterState, FileState } from '../state';

// Contrôles du compilateur : toute opération de fichier (et l'argument de %EOF, %FOUND, %EQUAL, %OPEN)
// nomme un fichier ou un format connu (un format renommé par RENAME ne l'est plus) ; OPEN et CLOSE nomment
// le fichier ; pour WRITE, UPDATE,
// DELETE, UNLOCK : nom du format pour WRITE/UPDATE, USAGE suffisante. Faits sur tout le programme avant
// l'exécution (formats connus seulement avec tables.json), y compris dans les branches et procédures jamais exécutées.
export function checkFileChanges(s: InterpreterState, node: any): void {
  if (Array.isArray(node)) {
    for (const child of node) checkFileChanges(s, child);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (node.type === 'FileOperation') {
    const state = fileState(s, node.file);
    if (['write', 'update', 'delete', 'unlock'].includes(node.operation)) checkFileChange(s, node, state);
    // OPEN et CLOSE : nom du fichier, pas du format
    if ((node.operation === 'open' || node.operation === 'close') && String(node.file).toUpperCase() !== state.file.name) {
      throw new Error(`${node.operation.toUpperCase()} attend le nom du fichier ${state.file.name}, pas le format ${state.file.format}`);
    }
  }
  if (node.type === 'Expression' && node.valueType === 'file') fileState(s, String(node.value));
  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') checkFileChanges(s, value);
  }
}

export function checkFileChange(s: InterpreterState, node: FileOperationNode, state: FileState): void {
  const file = state.file;
  const op = node.operation.toUpperCase();
  if (node.operation === 'write' || node.operation === 'update') {
    if (node.file.toUpperCase() !== file.format) {
      throw new Error(`${op} attend le nom du format ${file.format} du fichier ${file.name}`);
    }
  }
  const needed = { write: 'output', update: 'update', delete: 'delete' } as { [op: string]: 'output' | 'update' | 'delete' | undefined };
  const usage = needed[node.operation];
  if (usage && !state.usage[usage]) {
    throw new Error(`Le fichier ${file.name} n'est pas déclaré avec USAGE(*${usage.toUpperCase()}) : ${op} impossible`);
  }
}

// WRITE, UPDATE, DELETE, UNLOCK
export function executeFileChange(s: InterpreterState, node: FileOperationNode, state: FileState, key: any[]): void {
  const file = state.file;
  const op = node.operation.toUpperCase();
  checkFileChange(s, node, state);
  if (!state.open) throw new RpgError(1211, `Fichier ${file.name} non ouvert (RNX1211)`);
  const noCurrent = () => new RpgError(1221, `${op} de ${file.format} sans enregistrement lu (RNX1221)`);
  const refused = (what: string) => new NotSupportedError(
    `${op} de ${file.format} ${what} (comportement IBM i non vérifié)`);
  const blocked = () => refused(`sans nouvelle lecture après ${file.blockedReason ?? 'repositionnement'}`);

  switch (node.operation) {
    case 'unlock':
      if (!state.usage.update) {
        throw new NotSupportedError(`UNLOCK du fichier ${file.name} sans USAGE(*UPDATE) (comportement IBM i non vérifié)`);
      }
      file.unlock();
      return;
    case 'write': {
      const result = file.write(recordValues(s, state, node.resultDs));
      if (result.failure === 'duplicate') {
        throw new RpgError(1021, `Clé en double dans le fichier ${file.name} (RNX1021)`);
      }
      return;
    }
    case 'update': {
      // %FIELDS : seules les zones citées sont transmises, les autres gardent la valeur de l'enregistrement en base
      const zones = fieldsToUpdate(s, node, state);
      const values = recordValues(s, state, node.resultDs);
      if (zones) for (const zone of Object.keys(values)) if (!zones.has(zone)) delete values[zone];
      const result = file.update(values);
      if (result.failure === 'noCurrent') throw noCurrent();
      if (result.failure === 'repositioned') throw blocked();
      if (result.failure === 'gone') throw refused("d'un enregistrement supprimé entre-temps");
      if (result.failure === 'duplicate') {
        throw new RpgError(1021, `Clé en double dans le fichier ${file.name} (RNX1021)`);
      }
      return;
    }
    case 'delete': {
      if (node.key || node.kds) {
        const found = file.deleteByKey(key).found;
        state.found = s.lastIndicators.found = found;
        if (found) markDeleted(s, state);
        return;
      }
      const result = file.delete();
      if (result.failure === 'noCurrent') throw noCurrent();
      if (result.failure === 'repositioned') throw blocked();
      if (result.failure === 'gone') throw refused("d'un enregistrement supprimé entre-temps");
      markDeleted(s, state);
      return;
    }
  }
}

// Les numéros d'enregistrement ne sont plus fiables après une suppression
export function markDeleted(s: InterpreterState, state: FileState): void {
  state.table.deletedRows = true;
}

// Valeurs des zones du fichier, lues dans les variables globales du programme
// (une variable locale de même nom ne les masque pas) ou, avec ds, dans les sous-zones de cette DS
// (dans l'ordre du format, contrôlé par checkIoDs) ; seul un CHAR perd ses blancs de remplissage
export function recordValues(s: InterpreterState, state: FileState, ds?: string): { [zone: string]: any } {
  const file = state.file;
  const values: { [zone: string]: any } = {};
  const shape = ds ? s.runtime.getShape(ds) : undefined;
  file.fields.forEach((field, index) => {
    const value = shape ? s.runtime.getField(ds!, shape.fields[index].name) : s.runtime.getGlobal(state.variables.get(field.name)!);
    if (typeof value === 'string' && field.type.typeName === 'char') values[field.name] = value.replace(/ +$/, '');
    else if (typeof value === 'boolean') values[field.name] = value ? '1' : '0';
    else if (isDateTime(value)) values[field.name] = String(value);
    else values[field.name] = value;
  });
  return values;
}

// Copie les zones d'un enregistrement dans les variables du programme, ou dans les sous-zones de la DS ds
// (chemin « données » : pas de checkAssignable)
export function copyRecord(s: InterpreterState, state: FileState, row: any, ds?: string): void {
  const file = state.file;
  const shape = ds ? s.runtime.getShape(ds) : undefined;
  file.fields.forEach((field, index) => {
    const column = Object.keys(row).find(c => c.toUpperCase() === field.name);
    const raw = column === undefined ? undefined : row[column];
    const invalid = () => new Error(`Donnée invalide dans le fichier ${file.name} : zone ${field.name} = '${String(raw)}'`);
    const tooBig = () => new Error(`Donnée invalide dans le fichier ${file.name} : zone ${field.name} = '${String(raw)}' `
      + `(ne tient pas dans ${describeType(field.type)})`);
    if (raw === undefined || raw === null) throw invalid();
    const kind = field.type.typeName;
    let value = raw;
    if (isDateTimeType(kind)) {
      if (!isDateTime(raw)) {
        const parsed = typeof raw === 'string' ? parseIso(kind, raw) : undefined;
        if (!parsed) throw invalid();
        value = parsed;
      }
    } else if (kind === 'ind') {
      if (raw === '1' || raw === 1 || raw === true) value = true;
      else if (raw === '0' || raw === 0 || raw === false) value = false;
      else throw invalid();
    } else if (NUMERIC_TYPES.has(kind)) {
      if (typeof raw === 'string' && /^[+-]?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
      else if (typeof raw !== 'number' || !Number.isFinite(raw)) throw invalid();
      if (!fitsField(value, field.type)) throw tooBig();
    } else if (!fitsField(raw, field.type)) {
      throw tooBig();
    }
    if (shape) s.runtime.setField(ds!, shape.fields[index].name, value);
    else s.runtime.setGlobal(state.variables.get(field.name)!, value);
  });
}
