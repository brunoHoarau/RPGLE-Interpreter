// Fichiers natifs (DCL-F) simulés sur les tables de context/tables.json.
// Les opérations renvoient l'enregistrement et les indicateurs ; elles ne lèvent
// aucune erreur d'exécution RPG (statuts gérés par l'interpréteur).
// Cette classe porte l'état d'un fichier ouvert ; les opérations sont dans reading.ts,
// writing.ts, position.ts et keys.ts (fonctions prenant le fichier en premier paramètre).
import { FieldDefinition, FileResult, FileSpecial, Cursor, Item, KeyEntry, ReadOptions } from './types';
import { read, readp, reade, readpe, chain, chainRrn, setll, setgt } from './reading';
import { write, update, deleteCurrent, deleteByKey, duplicateKey } from './writing';
import { observe, reposition, drop } from './position';
import { sequenceOf } from './keys';

export class NativeFile {
  sequence = new WeakMap<object, number>();
  nextSequence = 0;
  cursor: Cursor = { side: 'before', at: 'start' };
  eofReached: 'read' | 'readp' | undefined;   // dernière lecture ayant donné %EOF, sans repositionnement
  // Numéros d'enregistrement : toutes les lignes déjà vues, et les tableaux sources déjà vus
  // (le moteur SQL crée un tableau à chaque DELETE : l'ancien garde les lignes insérées puis supprimées)
  seen = new Set<object>();
  arrays: any[][] = [];
  // Cache : clé de tri par ligne (recalculée si une zone clé change), ordre trié par tableau source
  keys_ = new WeakMap<object, KeyEntry>();
  recomputed = false;
  sorted: { source: any[]; length: number; revision: number | undefined; items: Item[] } | undefined;
  generation = 0;
  // Dernier enregistrement rendu (la position reste sur lui) et sa clé d'accès au moment de la lecture
  last: Item | undefined;
  // Clé d'accès complète du dernier enregistrement rendu (READE/READPE sans clé) ; effacée par une lecture en échec
  lastKey: any[] | undefined;
  // Enregistrement courant (UPDATE, DELETE) : dernière lecture réussie, ni mise à jour ni supprimée ni déverrouillée
  current: object | undefined;
  // Opération depuis la dernière lecture après laquelle UPDATE/DELETE ont un comportement IBM i non vérifié
  // (SETLL, SETGT, OPEN, DELETE par clé, WRITE ou UPDATE en double avec un enregistrement courant)
  blockedBy: string | undefined;
  // Enregistrement verrouillé par ce fichier dans le registre partagé
  held: object | undefined;
  locks: WeakMap<object, NativeFile>;

  // source : tableau, ou fonction le renvoyant (relue à chaque opération : le moteur SQL peut remplacer le tableau)
  // options.rowsDeleted : des lignes ont-elles été supprimées avant la déclaration du fichier (numéros d'enregistrement décalés) ?
  // options.revision : numéro de version des données (change à chaque modification) ; sans lui, toutes les lignes
  // sont revérifiées à chaque opération
  // options.updatable : fichier ouvert en mise à jour (les lectures réussies verrouillent l'enregistrement)
  // options.uniqueKeys : zones de la clé unique de la table, contrôlées à l'écriture même sans accès par clé
  // options.locks : registre des verrous, partagé par toutes les ouvertures d'une même table
  // options.changed : appelé après chaque WRITE, UPDATE ou DELETE réussi (fait avancer la revision des autres ouvertures)
  constructor(readonly name: string, readonly format: string, readonly fields: FieldDefinition[],
              readonly keys: string[], readonly source: any[] | (() => any[]),
              readonly options: { rowsDeleted?: () => boolean; revision?: () => number; updatable?: boolean;
                                 uniqueKeys?: string[]; locks?: WeakMap<object, NativeFile>;
                                 changed?: () => void } = {}) {
    for (const key of [...keys, ...(options.uniqueKeys ?? [])]) {
      if (!fields.some(f => f.name === key)) {
        throw new Error(`Zone clé ${key} absente des zones du fichier ${name}`);
      }
    }
    this.locks = options.locks ?? new WeakMap();
    for (const row of observe(this)) {
      this.seen.add(row);
      sequenceOf(this, row);
    }
  }

  get rows(): any[] {
    return typeof this.source === 'function' ? this.source() : this.source;
  }

  get keyed(): boolean {
    return this.keys.length > 0;
  }

  // Position perdue après un CHAIN non trouvé (position IBM i non vérifiée)
  get positionLost(): boolean {
    return this.cursor.side === 'lost';
  }

  // Opération qui empêche UPDATE/DELETE jusqu'à la prochaine lecture (motif d'échec 'repositioned')
  get blockedReason(): string | undefined {
    return this.blockedBy;
  }

  // OPEN : retour au début ; les lignes déjà vues restent connues (un enregistrement supprimé garde son numéro)
  reset(): void {
    reposition(this, 'OPEN');
    this.cursor = { side: 'before', at: 'start' };
    this.eofReached = undefined;
    this.last = undefined;
    this.lastKey = undefined;
  }

  read(options: ReadOptions = {}): FileResult { return read(this, options); }
  readp(options: ReadOptions = {}): FileResult { return readp(this, options); }
  reade(key: any[] | 'last', options: ReadOptions = {}): FileResult { return reade(this, key, options); }
  readpe(key: any[] | 'last', options: ReadOptions = {}): FileResult { return readpe(this, key, options); }
  chain(key: any[], options: ReadOptions = {}): FileResult { return chain(this, key, options); }
  chainRrn(n: any, options: ReadOptions = {}): FileResult { return chainRrn(this, n, options); }
  setll(key: any[] | FileSpecial): FileResult { return setll(this, key); }
  setgt(key: any[] | FileSpecial): FileResult { return setgt(this, key); }
  write(values: { [zone: string]: any }): { failure?: 'duplicate' } { return write(this, values); }
  update(values: { [zone: string]: any }): { failure?: 'noCurrent' | 'repositioned' | 'gone' | 'duplicate' } {
    return update(this, values);
  }
  delete(): { failure?: 'noCurrent' | 'repositioned' | 'gone' } { return deleteCurrent(this); }
  deleteByKey(key: any[]): { found: boolean } { return deleteByKey(this, key); }
  duplicateKey(): { [zone: string]: any } | undefined { return duplicateKey(this); }

  // UNLOCK : plus d'enregistrement courant, verrou libéré
  unlock(): void {
    drop(this);
  }

  // Fermeture, fin de programme : libère les verrous tenus par ce fichier
  release(): void {
    drop(this);
  }

}
