// WRITE, READ et EXFMT sur un format de fichier écran : variables <-> AREA, indicateurs <-> chaîne de 99 caractères
import { FileOperationNode } from '../../types';
import { NotSupportedError } from '../../errors';
import { SpecialCall } from '../../screens/protocol';
import { DisplayField } from '../../screens/definition';
import { encodeArea, decodeArea, indicatorsString, parseIndicators } from '../../screens/area';
import { DisplayState, InterpreterState } from '../state';
import { inddsPositions, displayError } from './declare';

// Indicateur nn : sous-zone de la DS INDDS à la position nn, sinon valeur interne du fichier ; sans INDDS : *INnn
function readIndicators(s: InterpreterState, state: DisplayState): string {
  if (!state.indds) return indicatorsString(n => s.runtime.getVariable(indicatorName(n)) === true);
  const positions = inddsPositions(s, state);
  return indicatorsString(n => {
    const name = positions.get(n);
    return name === undefined ? state.area?.[n] === true : s.runtime.getField(state.indds!, name) === true;
  });
}

function writeIndicators(s: InterpreterState, state: DisplayState, indicators: string): void {
  const flags = parseIndicators(indicators);
  if (!state.indds) {
    for (let n = 1; n <= 99; n++) s.runtime.setVariable(indicatorName(n), flags[n] === true);
    return;
  }
  const positions = inddsPositions(s, state);
  state.area = state.area ?? [];
  for (let n = 1; n <= 99; n++) {
    const name = positions.get(n);
    if (name === undefined) state.area[n] = flags[n] === true;
    else s.runtime.setField(state.indds, name, flags[n] === true);
  }
}

const indicatorName = (n: number) => `*in${String(n).padStart(2, '0')}`;

function formatFields(state: DisplayState, format: string): DisplayField[] {
  return state.definition.formats[format].fields;
}

function call(s: InterpreterState, state: DisplayState, option: 'W' | 'R', format: string, area: string): SpecialCall {
  const parameters: SpecialCall = { option, status: '0', error: 0, area, format, indicators: readIndicators(s, state) };
  state.routine.call(parameters);
  if (parameters.status === '2') throw displayError(state.file, parameters);
  return parameters;
}

// Image courante de l'enregistrement : les variables des zones du format
function currentArea(s: InterpreterState, state: DisplayState, format: string): string {
  const values = new Map(formatFields(state, format).map(f => [f.name, s.runtime.getVariable(f.name)]));
  return encodeArea(formatFields(state, format), values);
}

function write(s: InterpreterState, state: DisplayState, format: string): void {
  call(s, state, 'W', format, currentArea(s, state, format));
}

function read(s: InterpreterState, state: DisplayState, format: string): void {
  const result = call(s, state, 'R', format, currentArea(s, state, format));
  // Toutes les zones du format, y compris O et H : l'AREA rendue les contient
  for (const [name, value] of decodeArea(formatFields(state, format), result.area)) s.runtime.setVariable(name, value);
  writeIndicators(s, state, result.indicators);
}

export function executeScreenOperation(s: InterpreterState, node: FileOperationNode): void {
  const name = node.file.toUpperCase();
  const state = s.displays.get(name);
  const op = node.operation.toUpperCase();
  if (!state) throw new Error(`EXFMT n'est permis que sur un format de fichier écran, pas sur ${name}`);
  if (node.operation !== 'write' && node.operation !== 'read' && node.operation !== 'exfmt') {
    throw new NotSupportedError(`${op} sur le format écran ${name}`);
  }
  const format = Object.keys(state.definition.formats).find(f => f === name);
  if (!format) {
    throw new NotSupportedError(`${op} sur le fichier écran ${name} : un nom de format est attendu`);
  }
  if (node.extender || node.resultDs || node.key || node.kds || node.special || node.fields || node.lastKey) {
    throw new NotSupportedError(`${op} sur le format écran ${name} avec un extenseur, une clé ou une structure de données`);
  }
  if (node.operation !== 'read') write(s, state, format);
  if (node.operation !== 'write') read(s, state, format);
}
