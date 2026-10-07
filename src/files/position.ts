// Position, enregistrement courant et verrous d'un fichier natif.
import { NotSupportedError } from '../errors';
import { compare, entryOf } from './keys';
import type { NativeFile } from './native-file';
import type { FileResult, Item } from './types';

// Lecture réussie : le fichier est positionné sur l'enregistrement lu, qui devient l'enregistrement courant
export function readOn(f: NativeFile, item: Item, noLock = false): FileResult {
  take(f, item.row, noLock);
  f.lastKey = item.key.slice(0, f.keys.length);   // sans le numéro d'ordre ajouté en fin de clé
  f.cursor = { side: 'on', at: item.key };
  f.last = item;
  return { record: item.row, found: true, eof: false, equal: false };
}

// Fichier en mise à jour : verrouille l'enregistrement (refusé s'il est tenu par une autre ouverture)
// noLock (indicateur N) : pas de verrou ni d'enregistrement courant ; le verrou précédent est libéré comme à toute lecture
export function take(f: NativeFile, row: object, noLock = false): void {
  if (noLock) {
    drop(f);
    return;
  }
  if (f.options.updatable) {
    checkLock(f, row);
    if (f.held !== undefined && f.held !== row) unlockHeld(f);
    f.locks.set(row, f);
    f.held = row;
  }
  f.current = row;
  f.blockedBy = undefined;
}

// SETLL, SETGT, OPEN : verrou libéré ; un enregistrement courant ne peut plus être mis à jour ni supprimé
export function reposition(f: NativeFile, operation: string): void {
  const had = f.current !== undefined || f.blockedBy !== undefined;
  drop(f);
  f.lastKey = undefined;   // READE/READPE sans clé après un positionnement : non vérifié
  if (had) f.blockedBy = operation;
}

export function checkLock(f: NativeFile, row: object): void {
  const owner = f.locks.get(row);
  if (owner !== undefined && owner !== f) {
    throw new NotSupportedError(`Enregistrement du fichier ${f.name} verrouillé par un autre programme (attente de verrou non simulée)`);
  }
}

// Plus d'enregistrement courant, verrou libéré
export function drop(f: NativeFile): void {
  f.current = undefined;
  f.blockedBy = undefined;
  unlockHeld(f);
}

export function unlockHeld(f: NativeFile): void {
  if (f.held !== undefined && f.locks.get(f.held) === f) f.locks.delete(f.held);
  f.held = undefined;
}

// Lecture séquentielle depuis un enregistrement dont la clé a changé depuis sa lecture : position IBM i non vérifiée
export function checkCurrentKey(f: NativeFile): void {
  const last = f.last;
  if (f.cursor.side !== 'on' || last === undefined) return;
  if (compare(f, entryOf(f, last.row).key, last.key) === 0) return;   // clé en cache : contrôle rapide
  if (!f.rows.includes(last.row)) return;
  throw new NotSupportedError(`Lecture séquentielle de ${f.name} après modification de la clé de l'enregistrement courant (position IBM i non vérifiée)`);
}

export function checkPosition(f: NativeFile): void {
  if (f.cursor.side === 'lost') {
    throw new NotSupportedError(`Lecture séquentielle de ${f.name} après un CHAIN non trouvé, un READE/READPE sans correspondance ou un DELETE par clé`);
  }
}

// READE/READPE sans correspondance : %EOF, position IBM i non vérifiée
export function mismatch(f: NativeFile): FileResult {
  drop(f);
  f.lastKey = undefined;
  f.cursor = { side: 'lost' };
  return { found: false, eof: true, equal: false };
}

export function observe(f: NativeFile): any[] {
  const rows = f.rows;
  if (f.arrays[f.arrays.length - 1] !== rows && !f.arrays.includes(rows)) f.arrays.push(rows);
  return rows;
}
