// WRITE, READ et EXFMT sur un format de fichier écran ; les formats sous-fichier vont à subfile-operations.ts
import { FileOperationNode } from '../../types';
import { NotSupportedError } from '../../errors';
import { decodeArea } from '../../screens/area';
import { InterpreterState } from '../state';
import { call, currentArea, formatFields, writeIndicators } from './io';
import { executeSubfileOperation } from './subfile-operations';
import { DisplayState } from '../state';

function write(s: InterpreterState, state: DisplayState, format: string): void {
  call(s, state, 'W', format, currentArea(s, state, format));
}

function read(s: InterpreterState, state: DisplayState, format: string): void {
  const result = call(s, state, 'R', format, currentArea(s, state, format));
  // Seules les zones I, B et H reviennent du poste : les zones O ne font pas partie de l'enregistrement d'entrée
  const returned = new Set(formatFields(state, format).filter(f => f.usage !== 'O').map(f => f.name));
  for (const [name, value] of decodeArea(formatFields(state, format), result.area)) {
    if (returned.has(name)) s.runtime.setVariable(name, value);
  }
  writeIndicators(s, state, result.indicators);
}

export function executeScreenOperation(s: InterpreterState, node: FileOperationNode): void {
  const name = node.file.toUpperCase();
  const state = s.displays.get(name);
  const op = node.operation.toUpperCase();
  if (!state) throw new Error(`EXFMT n'est permis que sur un format de fichier écran, pas sur ${name}`);
  if (node.operation === 'open' || node.operation === 'close') {
    throw new NotSupportedError(`${op} sur un fichier écran (${state.file})`);
  }
  const format = Object.keys(state.definition.formats).find(f => f === name);
  if (format !== undefined && state.definition.formats[format].subfile) {
    return executeSubfileOperation(s, node, state, format);
  }
  if (node.operation === 'readc') throw new Error(`READC ${name} : ${name} n'est pas un format sous-fichier`);
  if (node.operation !== 'write' && node.operation !== 'read' && node.operation !== 'exfmt') {
    throw new NotSupportedError(`${op} sur le format écran ${name}`);
  }
  if (!format) {
    throw new NotSupportedError(`${op} sur le fichier écran ${name} : un nom de format est attendu`);
  }
  if (node.extender || node.resultDs || node.key || node.kds || node.special || node.fields || node.lastKey) {
    throw new NotSupportedError(`${op} sur le format écran ${name} avec un extenseur, une clé ou une structure de données`);
  }
  const needs = (what: 'input' | 'output', usage: string) => {
    if (!state.usage[what]) throw new Error(`${op} sur le fichier écran ${state.file} sans USAGE(${usage}) (ligne ${node.line})`);
  };
  if (node.operation !== 'read') needs('output', '*OUTPUT');
  if (node.operation !== 'write') needs('input', '*INPUT');
  if (node.operation !== 'read') write(s, state, format);
  if (node.operation !== 'write') read(s, state, format);
}
