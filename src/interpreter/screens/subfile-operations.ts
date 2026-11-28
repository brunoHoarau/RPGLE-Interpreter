// WRITE, CHAIN, UPDATE, READC sur un format sous-fichier : variables <-> AREA, rang <-> variable de SFILE
import { FileOperationNode } from '../../types';
import { NotSupportedError } from '../../errors';
import { decodeArea } from '../../screens/area';
import { evaluate } from '../evaluate/evaluate';
import { DisplayState, InterpreterState } from '../state';
import { call, currentArea, formatFields } from './io';

const OPERATIONS = ['write', 'chain', 'update', 'readc'];

export function executeSubfileOperation(s: InterpreterState, node: FileOperationNode, state: DisplayState, format: string): void {
  const op = node.operation.toUpperCase();
  if (!OPERATIONS.includes(node.operation)) {
    throw new Error(`${op} ${format} : ${format} est un format sous-fichier : seuls WRITE, CHAIN, UPDATE et READC s'y appliquent (ligne ${node.line})`);
  }
  if (node.extender || node.resultDs || node.kds || node.special || node.fields || node.lastKey) {
    throw new NotSupportedError(`${op} sur le sous-fichier ${format} avec un extenseur ou une structure de données`);
  }
  const needs = (what: 'input' | 'output', usage: string) => {
    if (!state.usage[what]) throw new Error(`${op} sur le fichier écran ${state.file} sans USAGE(${usage}) (ligne ${node.line})`);
  };
  needs(node.operation === 'write' || node.operation === 'update' ? 'output' : 'input',
    node.operation === 'write' || node.operation === 'update' ? '*OUTPUT' : '*INPUT');
  const rrnVariable = state.sfile.get(format)!;
  const currentRrn = () => Number(s.runtime.getVariable(rrnVariable));
  if (node.operation === 'write') {
    call(s, state, 'SW', format, currentArea(s, state, format), currentRrn());
  } else if (node.operation === 'update') {
    call(s, state, 'SU', format, currentArea(s, state, format), currentRrn());
  } else if (node.operation === 'chain') {
    if (!node.key || node.key.length !== 1) throw new Error(`CHAIN ${format} : un seul numéro de rang est attendu (ligne ${node.line})`);
    const rrn = Number(evaluate(s, node.key[0]));
    const result = call(s, state, 'SC', format, '', rrn);
    state.found = s.lastIndicators.found = result.status === '0';
    if (state.found) load(s, state, format, result.area, rrnVariable, rrn);
  } else {
    const result = call(s, state, 'SR', format, '');
    state.eof = s.lastIndicators.eof = result.status === '1';
    if (!state.eof) load(s, state, format, result.area, rrnVariable, result.rrn!);
  }
}

// Ligne lue : zones I, B et H (les zones O ne reviennent pas du poste) et variable de rang
function load(s: InterpreterState, state: DisplayState, format: string, area: string, rrnVariable: string, rrn: number): void {
  const fields = formatFields(state, format);
  const returned = new Set(fields.filter(f => f.usage !== 'O').map(f => f.name));
  for (const [name, value] of decodeArea(fields, area)) {
    if (returned.has(name)) s.runtime.setVariable(name, value);
  }
  s.runtime.setVariable(rrnVariable, rrn);
}
