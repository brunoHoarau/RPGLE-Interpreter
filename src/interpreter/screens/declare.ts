// Déclaration des fichiers écran (DCL-F … WORKSTN) : variables des zones, routine SPECIAL, appels O et C
import { FileDeclarationNode, ParameterNode } from '../../types';
import { byteLength } from '../../datatypes';
import { NotSupportedError } from '../../errors';
import { SpecialCall } from '../../screens/protocol';
import { declareFileField } from '../files/declare';
import { InterpreterState } from '../state';

const INDICATORS_BYTES = 99;

function callSpecial(s: InterpreterState, file: string, option: 'O' | 'C'): void {
  const routine = s.displays.get(file)!.routine;
  const call: SpecialCall = { option, status: '0', error: 0, area: '', format: '', indicators: '' };
  routine.call(call);
  if (call.status === '2') {
    throw new Error(`fichier écran ${file} : ${call.message ?? 'erreur'} (erreur ${String(call.error).padStart(5, '0')})`);
  }
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
  callSpecial(s, name, 'O');
}

// INDDS : structure de données du programme d'au moins 99 octets ; à contrôler une fois les déclarations exécutées
export function checkDisplayIndds(s: InterpreterState): void {
  for (const state of new Set(s.displays.values())) {
    if (!state.indds) continue;
    const shape = s.runtime.getShape(state.indds);
    if (!shape) throw new Error(`Fichier écran ${state.file} : INDDS(${state.indds}) : structure de données non déclarée`);
    const size = shape.fields.reduce((sum, f) => sum + byteLength(f.type), 0);
    if (size < INDICATORS_BYTES) {
      throw new Error(`Fichier écran ${state.file} : INDDS(${state.indds}) fait ${size} octets : ${INDICATORS_BYTES} au moins sont requis`);
    }
  }
}

// Fin de programme : un appel C par fichier écran
export function closeDisplayFiles(s: InterpreterState): void {
  for (const state of new Set(s.displays.values())) callSpecial(s, state.file, 'C');
}
