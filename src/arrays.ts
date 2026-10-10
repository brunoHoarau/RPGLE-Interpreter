import { DataTypeNode } from './types';
import { RpgError, STATUS_ARRAY_INDEX } from './errors';

// Tableau déclaré par DIM : valeurs explicitement écrites (values) ; au-delà, un élément fixe vaut `fresh()`.
// Un tableau fixe a toujours `max` éléments ; un tableau DIM(*AUTO : max) n'a que ceux qui ont été écrits.
export interface ArrayStore {
  values: any[];
  max: number;
  auto: boolean;
  type: DataTypeNode;
  fresh: () => any; // valeur initiale d'un élément (une copie neuve pour un élément de DS)
}

export const elementCount = (a: ArrayStore): number => (a.auto ? a.values.length : a.max);

function outOfRange(name: string, index: number): RpgError {
  return new RpgError(STATUS_ARRAY_INDEX, `Index ${index} hors des limites du tableau ${name.toUpperCase()} (RNX0121)`);
}

// Lecture : 1..%ELEM
export function readElement(a: ArrayStore, name: string, index: number): any {
  if (index < 1 || index > elementCount(a)) throw outOfRange(name, index);
  return index <= a.values.length ? a.values[index - 1] : a.fresh();
}

// Écriture : 1..DIM ; un tableau *AUTO s'étend jusqu'à l'index (éléments intermédiaires à leur valeur initiale)
export function writeElement(a: ArrayStore, name: string, index: number, value: any): void {
  if (index < 1 || index > a.max) throw outOfRange(name, index);
  while (a.values.length < index - 1) a.values.push(a.fresh());
  a.values[index - 1] = value;
}

// Index de arr(*next) : le premier élément après les éléments courants (00121 au-delà de DIM)
export const nextIndex = (a: ArrayStore): number => a.values.length + 1;
