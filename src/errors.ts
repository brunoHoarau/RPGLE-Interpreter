// Erreur d'exécution RPG : porte le code de statut renvoyé par %STATUS.
// Seules ces erreurs sont interceptées par MONITOR ; les erreurs de l'interpréteur
// (syntaxe, variable inconnue, limites de sécurité) remontent toujours.
export class RpgError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// Statuts programme utilisés par l'interpréteur
export const STATUS_DIVIDE_BY_ZERO = 102;   // RNX0102
export const STATUS_OVERFLOW = 103;         // RNX0103
export const STATUS_INVALID_NUMERIC = 105;  // RNX0105
export const STATUS_CALL_FAILED = 202;      // Le programme ou la procédure appelé a échoué
export const STATUS_CALL_NOT_FOUND = 211;   // Programme ou procédure appelé introuvable
export const STATUS_INVALID_DATE = 112;     // RNX0112 : date, heure ou timestamp invalide
export const STATUS_DATE_OVERFLOW = 113;    // RNX0113 : date hors limites après calcul

// Instruction que le compilateur IBM i refuserait : ce n'est pas une erreur d'exécution RPG,
// MONITOR ne l'intercepte donc pas
export function incompatibleTypes(what: string): Error {
  return new Error(`${what} : types incompatibles, le compilateur IBM i refuse cette instruction`);
}

// ON-ERROR sans code ou *ALL : tout ; *PROGRAM : 00100-00999 ; *FILE : 01000-09999
export function matchesStatus(codes: string[], status: number): boolean {
  if (codes.length === 0) return true;
  return codes.some(code => {
    switch (code) {
      case '*all': return true;
      case '*program': return status >= 100 && status <= 999;
      case '*file': return status >= 1000 && status <= 9999;
      default: return parseInt(code, 10) === status;
    }
  });
}
