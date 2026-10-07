import { FileOperationNode } from '../../types';
import { FileResult } from '../../files';
import { RpgError, NotSupportedError, incompatibleTypes } from '../../errors';
import { executeFileChange, copyRecord } from './changes';
import { evaluate } from '../evaluate/evaluate';
import { InterpreterState, FileState } from '../state';

// Statuts d'erreur de fichier (01000 à 01999) : les seuls interceptés par l'extenseur (E)
export const isFileStatus = (status: number) => status >= 1000 && status <= 1999;

export function fileState(s: InterpreterState, name: string): FileState {
  const state = s.files.get(name.toUpperCase());
  if (!state) throw new Error(`Fichier ou format ${name.toUpperCase()} inconnu`);
  return state;
}

// Extenseur (E) : une erreur de fichier (RpgError 01xxx) de l'opération met %ERROR à *ON et %STATUS au statut,
// le programme continue ; une réussite met %ERROR à *OFF. Les refus « pas encore supporté », les erreurs de données
// et les erreurs d'expression traversent. Sans (E), %ERROR est inchangé.
// Les opérandes (clé, numéro d'enregistrement) sont évalués avant : (E) n'intercepte que les erreurs
// de l'opération elle-même, pas celles d'une procédure appelée dans la clé.
export function executeFileOperation(s: InterpreterState, node: FileOperationNode): void {
  if (node.resultDs) throw new NotSupportedError(`${node.operation.toUpperCase()} avec la structure de données résultat ${node.resultDs.toUpperCase()}`);
  if (node.kds) throw new NotSupportedError(`%KDS(${node.kds.ds.toUpperCase()}) comme clé de ${node.operation.toUpperCase()}`);
  if (node.fields) throw new NotSupportedError('%FIELDS de UPDATE');
  const key = (node.key ?? []).map(expr => evaluate(s, expr));
  if (!node.extender?.error) {
    performFileOperation(s, node, key);
    return;
  }
  // %STATUS est remis à 0 avant toute opération avec (E)
  s.runtime.status = 0;
  try {
    performFileOperation(s, node, key);
  } catch (error) {
    if (!(error instanceof RpgError) || !isFileStatus(error.status)) throw error;
    s.lastError = true;
    s.runtime.status = error.status;
    s.runtime.addOutput(`[JOBLOG] ${error.message} - interceptée par l'extenseur (E)`);
    return;
  }
  s.lastError = false;
}

export function performFileOperation(s: InterpreterState, node: FileOperationNode, key: any[]): void {
  const state = fileState(s, node.file);
  const file = state.file;
  if (node.operation === 'open') {
    if (state.open) throw new RpgError(1215, `Fichier ${file.name} déjà ouvert (RNX1215)`);
    state.open = true;
    state.eof = state.found = state.equal = false;
    file.reset();
    return;
  }
  if (node.operation === 'close') {
    if (!state.open) throw new NotSupportedError(`CLOSE du fichier ${file.name} déjà fermé (comportement IBM i non vérifié)`);
    state.open = false;
    file.release();
    return;
  }
  if (node.operation === 'write' || node.operation === 'update' || node.operation === 'delete' || node.operation === 'unlock') {
    executeFileChange(s, node, state, key);
    return;
  }
  if (!state.open) throw new RpgError(1211, `Fichier ${file.name} non ouvert (RNX1211)`);

  // READE / READPE sans clé : clé complète du dernier enregistrement lu
  const equalKey = node.lastKey ? 'last' as const : key;
  // Extenseur (N) : lecture sans verrou
  const options = { noLock: node.extender?.noLock === true };
  let result: FileResult;
  switch (node.operation) {
    case 'read': result = file.read(options); break;
    case 'readp': result = file.readp(options); break;
    case 'reade': result = file.reade(equalKey, options); break;
    case 'readpe': result = file.readpe(equalKey, options); break;
    case 'chain':
      if (!file.keyed && key.length > 1) {
        throw incompatibleTypes(`CHAIN par numéro d'enregistrement avec une liste de ${key.length} valeurs sur le fichier sans clé ${file.name}`);
      }
      result = file.keyed ? file.chain(key, options) : file.chainRrn(key[0], options);
      break;
    case 'setll': result = file.setll(node.special ?? key); break;
    case 'setgt': result = file.setgt(node.special ?? key); break;
    default: throw new Error(`Opération ${node.operation} non supportée`);
  }
  if (result.record) copyRecord(s, state, result.record);

  switch (node.operation) {
    case 'read': case 'readp': case 'reade': case 'readpe':
      state.eof = s.lastIndicators.eof = result.eof;
      break;
    // %EOF(fichier) remis à *OFF par SETLL, SETGT et CHAIN réussis (%EOF sans argument inchangé) ;
    // après un CHAIN non trouvé, sa valeur IBM i n'est pas vérifiée : inconnue
    case 'chain':
      state.found = s.lastIndicators.found = result.found;
      state.eof = result.found ? false : undefined;
      break;
    case 'setll':
      state.found = s.lastIndicators.found = result.found;
      state.equal = s.lastIndicators.equal = result.equal;
      state.eof = false;
      break;
    case 'setgt':
      state.found = s.lastIndicators.found = result.found;
      state.eof = false;
      break;
  }
}
