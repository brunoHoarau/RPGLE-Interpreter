// Types communs du moteur SQL : résultat, variables hôtes et erreur SQL ordinaire.
import type { DataTypeNode } from '../types';

export interface SQLResult {
  rows: any[];
  rowCount: number;
  sqlCode: number;   // 0 = succès, 100 = pas de ligne, négatif = erreur
  sqlState: string;  // '00000', '02000', etc.
  message?: string;  // Détail de l'erreur quand sqlCode < 0
}

// Accès aux variables RPG utilisées comme variables hôtes (:nom)
export interface HostVariables {
  get(name: string): any;
  set(name: string, value: any): void;
  type?(name: string): DataTypeNode | undefined;   // Type déclaré (un VARCHAR garde ses blancs de fin)
}

// Erreur SQL ordinaire avec son SQLCOD et son SQLSTATE (le programme continue)
export class SqlError extends Error {
  constructor(message: string, public readonly sqlCode: number, public readonly sqlState: string) {
    super(message);
  }
}
