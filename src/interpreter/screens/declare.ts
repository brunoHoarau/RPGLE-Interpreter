// Déclaration des fichiers écran (DCL-F … WORKSTN) : variables des zones, routine SPECIAL, appels O et C
import { FileDeclarationNode, ParameterNode } from '../../types';
import { NotSupportedError } from '../../errors';
import { SpecialCall } from '../../screens/protocol';
import { declareFileField } from '../files/declare';
import { DisplayState, InterpreterState } from '../state';

export function displayError(file: string, call: SpecialCall): Error {
  return new Error(`fichier écran ${file} : ${call.message ?? 'erreur'} (erreur ${String(call.error).padStart(5, '0')})`);
}

function callSpecial(s: InterpreterState, file: string, option: 'O' | 'C'): void {
  const routine = s.displays.get(file)!.routine;
  const call: SpecialCall = { option, status: '0', error: 0, area: '', format: '', indicators: '' };
  routine.call(call);
  if (call.status === '2') throw displayError(file, call);
}

export function declareDisplayFile(s: InterpreterState, node: FileDeclarationNode, parameters: ParameterNode[]): void {
  const name = node.name.toUpperCase();
  if (!s.options.screens) throw new NotSupportedError(`Fichier écran ${name} : exécution interactive requise`);
  const definition = s.context.displays?.[name];
  if (!definition) throw new Error(`Fichier écran ${name} absent de displays.json`);
  if (node.indds && !definition.indara) {
    throw new Error(`Fichier écran ${name} : INDDS(${node.indds}) sans "indara" dans displays.json`);
  }
  // Sur IBM i, les noms de fichiers et de formats d'un programme sont distincts
  const formats = Object.keys(definition.formats);
  if (formats.includes(name)) throw new Error(`Fichier écran ${name} : le format ${name} porte le nom du fichier`);
  for (const used of [name, ...formats]) {
    const other = s.files.get(used)?.file.name ?? s.displays.get(used)?.file;
    if (other) throw new Error(`Fichier écran ${name} : le nom ${used} est déjà utilisé par le fichier ${other}`);
  }
  for (const format of formats) {
    for (const field of definition.formats[format].fields) declareFileField(s, field.name, field.type, name, parameters);
  }
  const state = { file: name, definition, routine: s.options.screens(name, definition), indds: node.indds };
  s.displays.set(name, state);
  for (const format of formats) s.displays.set(format, state);
}

// INDDS : structure de données du programme ; à contrôler une fois les déclarations exécutées.
// Une DS de moins de 99 octets est acceptée (indicateurs nommés à POS clairsemés)
export function checkDisplayIndds(s: InterpreterState): void {
  for (const state of new Set(s.displays.values())) {
    if (state.indds && !s.runtime.getShape(state.indds)) {
      throw new Error(`Fichier écran ${state.file} : INDDS(${state.indds}) : structure de données non déclarée`);
    }
  }
}

// Indicateur nn (position nn de la DS INDDS) -> nom de la sous-zone ind placée à cette position
export function inddsPositions(s: InterpreterState, state: DisplayState): Map<number, string> {
  const positions = new Map<number, string>();
  for (const field of s.runtime.getShape(state.indds ?? '')?.fields ?? []) {
    if (field.type.typeName === 'ind' && field.start >= 1 && field.start <= 99) positions.set(field.start, field.name);
  }
  return positions;
}

// Appel O de chaque fichier écran, une fois toutes les déclarations contrôlées (sinon un fichier ouvert ne serait jamais fermé)
export function openDisplayFiles(s: InterpreterState): void {
  for (const state of new Set(s.displays.values())) callSpecial(s, state.file, 'O');
}

// Fin de programme : un appel C par fichier écran
export function closeDisplayFiles(s: InterpreterState): void {
  for (const state of new Set(s.displays.values())) callSpecial(s, state.file, 'C');
}
