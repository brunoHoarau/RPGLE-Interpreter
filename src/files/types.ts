// Types communs des fichiers natifs : zones, résultats, curseur de position et clés de tri.
import type { DataTypeNode } from '../types';

export interface FieldDefinition {
  name: string;          // En majuscules
  type: DataTypeNode;
}

export interface FileResult {
  record?: any;
  found: boolean;
  eof: boolean;
  equal: boolean;
}

export type FileSpecial = 'start' | 'end';

export type Cursor =
  | { side: 'before' | 'after'; at: any[] | FileSpecial }   // SETLL, SETGT, *START, *END, fin ou début de fichier
  | { side: 'on'; at: any[] }                               // Sur le dernier enregistrement lu (READx, CHAIN trouvé)
  | { side: 'lost' };                                       // Position IBM i non vérifiée

export interface Item { row: any; key: any[] }
// Clé d'une ligne : colonnes et valeurs dont elle est tirée, génération du dernier tri qui contenait la ligne
export interface KeyEntry { columns: (string | undefined)[]; raw: any[]; key: any[]; sort: number }

export interface ReadOptions { noLock?: boolean }
