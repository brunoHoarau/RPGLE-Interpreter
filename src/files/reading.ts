// Lectures et positionnements d'un fichier natif (READ, READP, READE, READPE, CHAIN, SETLL, SETGT).
import { NotSupportedError, incompatibleTypes } from '../errors';
import { compare, next, ordered, previous, searchKey, wantedKey } from './keys';
import type { NativeFile } from './native-file';
import { checkCurrentKey, checkPosition, drop, mismatch, readOn, reposition } from './position';
import type { FileResult, FileSpecial, ReadOptions } from './types';

export function read(f: NativeFile, options: ReadOptions = {}): FileResult {
  checkPosition(f);
  checkCurrentKey(f);
  if (f.eofReached === 'read') {
    throw new NotSupportedError(`READ de ${f.name} après la fin de fichier (comportement IBM i non vérifié)`);
  }
  f.eofReached = undefined;
  const item = next(f);
  if (!item) {
    drop(f);
    f.lastKey = undefined;
    f.cursor = { side: 'after', at: 'end' };
    f.eofReached = 'read';
    return { found: false, eof: true, equal: false };
  }
  return readOn(f, item, options.noLock);
}

export function readp(f: NativeFile, options: ReadOptions = {}): FileResult {
  checkPosition(f);
  checkCurrentKey(f);
  if (f.eofReached === 'readp') {
    throw new NotSupportedError(`READP de ${f.name} après le début de fichier (comportement IBM i non vérifié)`);
  }
  f.eofReached = undefined;
  const item = previous(f);
  if (!item) {
    drop(f);
    f.lastKey = undefined;
    f.cursor = { side: 'before', at: 'start' };
    f.eofReached = 'readp';
    return { found: false, eof: true, equal: false };
  }
  return readOn(f, item, options.noLock);
}

export function reade(f: NativeFile, key: any[] | 'last', options: ReadOptions = {}): FileResult {
  const wanted = wantedKey(f, key);
  checkPosition(f);
  checkCurrentKey(f);
  f.eofReached = undefined;
  const item = next(f);
  if (!item || compare(f, item.key, wanted) !== 0) return mismatch(f);
  return readOn(f, item, options.noLock);
}

export function readpe(f: NativeFile, key: any[] | 'last', options: ReadOptions = {}): FileResult {
  const wanted = wantedKey(f, key);
  checkPosition(f);
  checkCurrentKey(f);
  f.eofReached = undefined;
  const item = previous(f);
  if (!item || compare(f, item.key, wanted) !== 0) return mismatch(f);
  return readOn(f, item, options.noLock);
}

export function chain(f: NativeFile, key: any[], options: ReadOptions = {}): FileResult {
  const wanted = searchKey(f, key);
  f.eofReached = undefined;
  const item = ordered(f).find(it => compare(f, it.key, wanted) === 0);
  if (!item) {
    drop(f);
    f.lastKey = undefined;
    f.cursor = { side: 'lost' };
    return { found: false, eof: false, equal: false };
  }
  return readOn(f, item, options.noLock);
}

// Fichier sans clé : lecture par rang d'arrivée (1 = premier)
export function chainRrn(f: NativeFile, n: any, options: ReadOptions = {}): FileResult {
  if (f.keyed) throw new Error(`Fichier ${f.name} avec clé : CHAIN par numéro d'enregistrement impossible`);
  if (typeof n !== 'number') {
    throw incompatibleTypes(`Numéro d'enregistrement ${typeof n === 'string' ? `'${n}'` : String(n)} pour le fichier ${f.name}`);
  }
  if (!Number.isInteger(n) || n < 1) throw new NotSupportedError(`Numéro d'enregistrement ${n} pour le fichier ${f.name}`);
  const items = ordered(f);
  const rows = f.rows;
  const present = new Set<object>(rows);
  const gone = (r: object) => !present.has(r);
  if (f.options.rowsDeleted?.() || [...f.seen].some(gone) || f.arrays.some(a => a.some(gone))) {
    throw new NotSupportedError(`Numéro d'enregistrement du fichier ${f.name} après suppression`);
  }
  f.eofReached = undefined;
  const row = rows[n - 1];
  if (!row) {
    drop(f);
    f.lastKey = undefined;
    f.cursor = { side: 'lost' };
    return { found: false, eof: false, equal: false };
  }
  return readOn(f, items.find(it => it.row === row)!, options.noLock);
}

export function setll(f: NativeFile, key: any[] | FileSpecial): FileResult {
  if (key === 'start' || key === 'end') {
    f.eofReached = undefined;
    reposition(f, 'SETLL');
    f.cursor = key === 'start' ? { side: 'before', at: 'start' } : { side: 'after', at: 'end' };
    return { found: key === 'start' && f.rows.length > 0, eof: false, equal: false };
  }
  const wanted = searchKey(f, key);
  f.eofReached = undefined;
  reposition(f, 'SETLL');
  const items = ordered(f);
  f.cursor = { side: 'before', at: wanted };
  return {
    found: items.some(it => compare(f, it.key, wanted) >= 0),
    eof: false,
    equal: items.some(it => compare(f, it.key, wanted) === 0),
  };
}

export function setgt(f: NativeFile, key: any[] | FileSpecial): FileResult {
  if (key === 'start' || key === 'end') return setll(f, key);
  const wanted = searchKey(f, key);
  f.eofReached = undefined;
  reposition(f, 'SETGT');
  const items = ordered(f);
  f.cursor = { side: 'after', at: wanted };
  return { found: items.some(it => compare(f, it.key, wanted) > 0), eof: false, equal: false };
}
