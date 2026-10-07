import { DataTypeNode, DsLike } from './types';

// Origine d'une DS tirée d'un fichier (LIKEREC, EXTNAME) : table (nom du DCL-F pour LIKEREC, nom de la table
// pour EXTNAME), format (nom du programme, après RENAME, pour LIKEREC) et type d'extraction
export interface DsOrigin {
  table: string;
  format: string;
  usage: DsLike['usage'];
}

// Ce que le runtime retient d'une structure de données déclarée
export interface DsShape {
  fields: { name: string; type: DataTypeNode }[]; // Disposition : sous-zones dans l'ordre déclaré
  initial: { [field: string]: any };              // Valeurs de déclaration (INZ ou défauts), clés en minuscules
  origin?: DsOrigin;                              // Fichier d'origine (LIKEREC, EXTNAME), hérité par LIKEDS
  root: number;                                   // Filiation : deux DS liées par LIKEDS ont la même racine
}
