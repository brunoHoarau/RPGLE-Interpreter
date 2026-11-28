// Simulateur : saisie sur les lignes du sous-fichier (R du contrôle), validée puis appliquée au retour
import type { AreaValue } from './area';
import { parseIndicators } from './area';
import { holds } from './composition';
import { parseInput } from './input-values';
import type { ScreenInput } from './protocol';
import type { SubfileState } from './subfile';

export type PendingLines = Map<number, Map<string, AreaValue>>;   // rang -> zones saisies

// Valide les lignes d'une entrée et les ajoute à pending ; renvoie le message de refus, ou undefined
export function collectLines(state: SubfileState | undefined, lines: NonNullable<ScreenInput['lines']>, pending: PendingLines): string | undefined {
  if (!state) return 'lines : aucun sous-fichier affiché (SFLDSP)';
  for (const { rrn, fields } of lines) {
    const record = state.sf.chain(rrn);
    if (!record) return `Ligne ${rrn} absente du sous-fichier ${state.name}`;
    if (pending.has(rrn)) return `Ligne ${rrn} saisie deux fois`;
    const typed = new Map<string, AreaValue>();
    const flags = parseIndicators(record.indicators);
    for (const name of Object.keys(fields)) {
      const field = state.format.fields.find(f => f.name.toUpperCase() === name.toUpperCase());
      if (!field || field.usage === 'H' || !holds(field.condition, flags) || (state.folded && field.fold)) {
        return `Zone ${name} inconnue ou non affichée (ligne ${rrn})`;
      }
      if (field.usage === 'O') return `Zone ${field.name} non saisissable`;
      const parsed = parseInput(field, fields[name]);
      if ('message' in parsed) return parsed.message;
      typed.set(field.name, parsed.value);
    }
    pending.set(rrn, typed);
  }
  return undefined;
}

// Au retour au programme : valeurs saisies, ligne marquée modifiée (comme le MDT, même valeur ressaisie)
export function commitLines(state: SubfileState, pending: PendingLines): void {
  for (const [rrn, typed] of pending) {
    const record = state.sf.chain(rrn)!;
    for (const [name, value] of typed) record.values.set(name, value);
    record.changed = true;
  }
}
