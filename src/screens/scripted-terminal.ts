// Terminal scripté (tests) : rejoue une liste ordonnée de saisies
import type { Screen, ScreenInput, Terminal } from './protocol';

export interface ScriptedEntry {
  format: string;
  file?: string;
  key?: string;                          // ENTER par défaut
  fields?: { [name: string]: string };
}

export class ScriptedTerminal implements Terminal {
  readonly shown: Screen[] = [];
  private reads = 0;

  constructor(private readonly script: ScriptedEntry[]) {}

  show(screen: Screen): void {
    this.shown.push(screen);
  }

  input(screen: Screen): ScreenInput {
    this.reads++;
    if (screen.message !== undefined) throw new Error(`saisie refusée par l'écran : ${screen.message}`);
    const entry = this.script[this.reads - 1];
    if (!entry) throw new Error(`aucune saisie prévue pour le format ${screen.format} (lecture n° ${this.reads})`);
    if (entry.format.toUpperCase() !== screen.format.toUpperCase()) {
      throw new Error(`saisie n° ${this.reads} prévue pour le format ${entry.format} mais l'écran affiche ${screen.format}`);
    }
    if (entry.file !== undefined && entry.file.toUpperCase() !== screen.file.toUpperCase()) {
      throw new Error(`saisie n° ${this.reads} prévue pour le fichier ${entry.file} mais l'écran affiche ${screen.file}`);
    }
    return { key: entry.key ?? 'ENTER', fields: { ...(entry.fields ?? {}) } };
  }
}
