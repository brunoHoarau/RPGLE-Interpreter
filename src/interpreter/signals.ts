// Signaux de contrôle : levés comme exceptions pour traverser les blocs imbriqués
// jusqu'à la boucle (LEAVE/ITER) ou la procédure / le programme (RETURN) concerné.
export class LeaveSignal {}
export class IterSignal {}
export class ReturnSignal {
  constructor(public value?: any) {}
}
