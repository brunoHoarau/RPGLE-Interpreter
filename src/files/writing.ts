// Écritures d'un fichier natif (WRITE, UPDATE, DELETE) et contrôle des clés uniques.
import { NotSupportedError } from '../errors';
import { compare, dataKey, ordered, searchKey } from './keys';
import type { NativeFile } from './native-file';
import { checkLock, drop, observe } from './position';

// WRITE : nouvel enregistrement en fin de table ; la position ne change pas
// (clés contrôlées avant l'ajout : une donnée invalide lève l'erreur sans modifier la table).
// Effet sur l'enregistrement courant et son verrou non vérifié : UPDATE/DELETE refusés jusqu'à la prochaine lecture
export function write(f: NativeFile, values: { [zone: string]: any }): { failure?: 'duplicate' } {
  const rows = observe(f);
  const row = { ...values };
  for (const key of f.keys) dataKey(f, key, valueOfRow(f, row, key));
  if (f.current !== undefined) f.blockedBy = 'WRITE';
  if (duplicates(f, rows, values, undefined)) return { failure: 'duplicate' };
  rows.push(row);
  f.sorted = undefined;
  f.options.changed?.();
  return {};
}

// UPDATE : réécrit l'enregistrement courant, qui cesse de l'être (verrou libéré, position inchangée)
export function update(f: NativeFile, values: { [zone: string]: any }): { failure?: 'noCurrent' | 'repositioned' | 'gone' | 'duplicate' } {
  if (f.blockedBy !== undefined) return { failure: 'repositioned' };
  const row: any = f.current;
  if (!row) return { failure: 'noCurrent' };
  const rows = observe(f);
  if (!rows.includes(row)) {
    drop(f);
    return { failure: 'gone' };
  }
  const column = (zone: string) => columnOf(f, row, zone) ?? zone;
  const updated = (key: string) => {
    const given = columnOf(f, values, key);
    return given === undefined ? valueOfRow(f, row, key) : values[given];
  };
  for (const key of f.keys) dataKey(f, key, updated(key));
  // Échec 01021 : état de l'enregistrement courant et de son verrou non vérifié
  if (duplicates(f, rows, values, row)) {
    f.blockedBy = 'UPDATE en double';
    return { failure: 'duplicate' };
  }
  const keyChanged = f.keys.some(key => updated(key) !== valueOfRow(f, row, key));
  const revision = f.options.revision?.();
  const fresh = f.sorted !== undefined && revision !== undefined && f.sorted.revision === revision;
  for (const [zone, value] of Object.entries(values)) row[column(zone)] = value;
  f.options.changed?.();
  // Ordre de ce fichier inchangé si ses zones clés le sont : le tri reste valable à la nouvelle revision
  if (keyChanged) f.sorted = undefined;
  else if (fresh) f.sorted!.revision = f.options.revision?.();
  drop(f);
  return {};
}

// DELETE sans clé : supprime l'enregistrement courant (le READ suivant lit celui qui le suivait)
export function deleteCurrent(f: NativeFile): { failure?: 'noCurrent' | 'repositioned' | 'gone' } {
  if (f.blockedBy !== undefined) return { failure: 'repositioned' };
  const row = f.current;
  if (!row) return { failure: 'noCurrent' };
  const rows = observe(f);
  const index = rows.indexOf(row);
  if (index < 0) {
    drop(f);
    return { failure: 'gone' };
  }
  rows.splice(index, 1);
  f.sorted = undefined;
  f.options.changed?.();
  drop(f);
  f.lastKey = undefined;
  return {};
}

// DELETE par clé complète : premier enregistrement de cette clé. Trouvé : position IBM i non vérifiée (perdue),
// plus d'enregistrement courant (verrou libéré), UPDATE/DELETE refusés jusqu'à la prochaine lecture
export function deleteByKey(f: NativeFile, key: any[]): { found: boolean } {
  const wanted = searchKey(f, key);
  if (key.length < f.keys.length) {
    throw new NotSupportedError(`DELETE de ${f.name} par clé partielle (enregistrement supprimé par IBM i non vérifié)`);
  }
  const item = ordered(f).find(it => compare(f, it.key, wanted) === 0);
  if (!item) return { found: false };
  checkLock(f, item.row);
  const rows = observe(f);
  rows.splice(rows.indexOf(item.row), 1);
  f.sorted = undefined;
  f.options.changed?.();
  drop(f);
  f.lastKey = undefined;
  f.blockedBy = 'DELETE par clé';
  f.cursor = { side: 'lost' };
  f.eofReached = undefined;
  return { found: true };
}

// Première clé unique en double dans les données ({ zone: valeur }), undefined sinon
export function duplicateKey(f: NativeFile): { [zone: string]: any } | undefined {
  const unique = f.options.uniqueKeys;
  if (!unique || unique.length === 0) return undefined;
  const seen = new Set<string>();
  for (const row of observe(f)) {
    const key = JSON.stringify(unique.map(zone => dataKey(f, zone, valueOfRow(f, row, zone))));
    if (seen.has(key)) return Object.fromEntries(unique.map(zone => [zone, valueOfRow(f, row, zone)]));
    seen.add(key);
  }
  return undefined;
}

// Une autre ligne a-t-elle les mêmes valeurs sur les zones de la clé unique ?
export function duplicates(f: NativeFile, rows: any[], values: { [zone: string]: any }, except: any): boolean {
  const unique = f.options.uniqueKeys;
  if (!unique || unique.length === 0) return false;
  const valueOf = (row: any, zone: string) => valueOfRow(f, row, zone);
  const wanted = unique.map(zone => {
    const column = columnOf(f, values, zone);
    return dataKey(f, zone, column !== undefined ? values[column] : except !== undefined ? valueOf(except, zone) : undefined);
  });
  return rows.some(row => row !== except && unique.every((zone, i) => dataKey(f, zone, valueOf(row, zone)) === wanted[i]));
}

// Colonne d'une ligne correspondant à une zone (casse ignorée)
export function columnOf(f: NativeFile, row: any, zone: string): string | undefined {
  return Object.keys(row).find(c => c.toUpperCase() === zone.toUpperCase());
}

export function valueOfRow(f: NativeFile, row: any, zone: string): any {
  const column = columnOf(f, row, zone);
  return column === undefined ? undefined : row[column];
}
