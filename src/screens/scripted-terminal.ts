// Terminal scripté (tests) : rejoue une liste ordonnée de saisies
import type { Screen, ScreenInput, Terminal } from './protocol';

export interface ScriptedEntry {
  format: string;
  file?: string;
  key?: string;                          // ENTER par défaut
  fields?: { [name: string]: string };
  // Saisie sur des lignes du sous-fichier, désignées par leur contenu (égalité sur les zones de where)
  lines?: { where: { [name: string]: string }; fields: { [name: string]: string } }[];
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
    const input: ScreenInput = { key: entry.key ?? 'ENTER', fields: { ...(entry.fields ?? {}) } };
    if (entry.lines) input.lines = this.resolveLines(screen, entry.lines);
    return input;
  }

  // where -> rang, cherché dans toutes les lignes chargées ; une et une seule ligne, visée une seule fois
  private resolveLines(screen: Screen, lines: NonNullable<ScriptedEntry['lines']>): NonNullable<ScreenInput['lines']> {
    const subfile = screen.subfile;
    if (!subfile) throw new Error(`saisie n° ${this.reads} : "lines" sans sous-fichier affiché (SFLDSP) sur le format ${screen.format}`);
    const seen = new Set<number>();
    return lines.map(({ where, fields }) => {
      const names = Object.keys(where);
      const text = names.map(n => `${n} = '${where[n]}'`).join(' et ');
      const known = Object.keys(subfile.loaded[0]?.values ?? {});
      const keyOf = (n: string): string | undefined => known.find(k => k.toUpperCase() === n.toUpperCase());
      const unknown = known.length > 0 ? names.find(n => keyOf(n) === undefined) : undefined;
      if (unknown) throw new Error(`saisie n° ${this.reads} : zone ${unknown} inconnue dans le sous-fichier ${subfile.format}`);
      const found = subfile.loaded.filter(l => names.every(n => l.values[keyOf(n)!].trimEnd() === where[n].trimEnd()));
      if (found.length === 0) {
        throw new Error(`saisie n° ${this.reads} : aucune ligne où ${text} dans le sous-fichier ${subfile.format} (${subfile.loaded.length} lignes chargées)`);
      }
      if (found.length > 1) {
        throw new Error(`saisie n° ${this.reads} : plusieurs lignes où ${text} dans le sous-fichier ${subfile.format} (rangs ${found.map(l => l.rrn).join(', ')})`);
      }
      const rrn = found[0].rrn;
      if (seen.has(rrn)) throw new Error(`saisie n° ${this.reads} : la ligne du rang ${rrn} (${text}) est visée deux fois`);
      seen.add(rrn);
      return { rrn, fields: { ...fields } };
    });
  }
}
