// Échanges avec le simulateur d'écran : indicateurs <-> chaîne de 99 caractères, variables <-> AREA, appel SPECIAL
import { SpecialCall } from '../../screens/protocol';
import { DisplayField } from '../../screens/definition';
import { encodeArea, indicatorsString, parseIndicators } from '../../screens/area';
import { DisplayState, InterpreterState } from '../state';
import { inddsPositions, displayError } from './declare';

// Indicateur nn : sous-zone de la DS INDDS à la position nn, sinon valeur interne du fichier ; sans INDDS : *INnn
export function readIndicators(s: InterpreterState, state: DisplayState): string {
  if (!state.indds) return indicatorsString(n => s.runtime.getVariable(indicatorName(n)) === true);
  const positions = inddsPositions(s, state);
  return indicatorsString(n => {
    const name = positions.get(n);
    return name === undefined ? state.area?.[n] === true : s.runtime.getField(state.indds!, name) === true;
  });
}

export function writeIndicators(s: InterpreterState, state: DisplayState, indicators: string): void {
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

export function formatFields(state: DisplayState, format: string): DisplayField[] {
  return state.definition.formats[format].fields;
}

export function call(s: InterpreterState, state: DisplayState, option: SpecialCall['option'], format: string, area: string, rrn?: number): SpecialCall {
  const parameters: SpecialCall = { option, status: '0', error: 0, area, format, indicators: readIndicators(s, state) };
  if (rrn !== undefined) parameters.rrn = rrn;
  state.routine.call(parameters);
  if (parameters.status === '2') throw displayError(state.file, parameters);
  return parameters;
}

// Image courante de l'enregistrement : les variables des zones du format
export function currentArea(s: InterpreterState, state: DisplayState, format: string): string {
  const values = new Map(formatFields(state, format).map(f => [f.name, s.runtime.getVariable(f.name)]));
  return encodeArea(formatFields(state, format), values);
}
