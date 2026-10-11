// Simulateur d'écran : routine SPECIAL qui joue le rôle du poste 5250 (spec §3)
import type { Condition, DisplayField, DisplayFileDefinition, DisplayFormat } from './definition';
import type { Screen, ScreenInput, SpecialCall, SpecialRoutine, Terminal } from './protocol';
import { AreaValue, decodeArea, encodeArea, indicatorsString, parseIndicators } from './area';
import { parseInput } from './input-values';

// 01299 : statut RPG « autre erreur d'E/S », code rendu par le simulateur pour tous ses statuts 2
const ERROR_CODE = 1299;

interface Displayed {
  format: string;
  definition: DisplayFormat;
  screen: Screen;
  values: Map<string, AreaValue>;      // toutes les zones (H, I à blanc et non affichées comprises)
  indicators: string;                  // indicateurs reçus au W
}

type Accepted = { key?: string; values: Map<string, AreaValue> } | { message: string };

export class ScreenSimulator implements SpecialRoutine {
  private displayed?: Displayed;

  constructor(private readonly file: string, private readonly definition: DisplayFileDefinition,
              private readonly terminal: Terminal) {}

  call(p: SpecialCall): void {
    p.status = '0';
    p.error = 0;
    p.message = undefined;
    if (p.option === 'C') this.displayed = undefined;
    else if (p.option === 'W') this.write(p);
    else if (p.option === 'R') this.read(p);
  }

  private fail(p: SpecialCall, message: string): void {
    p.status = '2';
    p.error = ERROR_CODE;
    p.message = message;
  }

  private findFormat(name: string): [string, DisplayFormat] | undefined {
    const key = Object.keys(this.definition.formats).find(f => f.toUpperCase() === name.toUpperCase());
    return key === undefined ? undefined : [key, this.definition.formats[key]];
  }

  private write(p: SpecialCall): void {
    const found = this.findFormat(p.format);
    if (!found) return this.fail(p, `format ${p.format} inconnu dans le fichier écran ${this.file}`);
    const [format, definition] = found;
    const sent = decodeArea(definition.fields, p.area);
    const flags = parseIndicators(p.indicators);
    const values = new Map<string, AreaValue>();
    for (const f of definition.fields) values.set(f.name, f.usage === 'I' ? blank(f) : sent.get(f.name)!);
    const screen: Screen = {
      file: this.file, format,
      fields: definition.fields.filter(f => f.usage !== 'H' && holds(f.condition, flags)).map(f => ({
        name: f.name, row: f.row!, col: f.col!, length: f.length, usage: f.usage as 'I' | 'O' | 'B',
        numeric: f.type.typeName === 'zoned', value: display(f, values.get(f.name)!),
      })),
      constants: definition.constants.filter(c => holds(c.condition, flags))
        .map(c => ({ row: c.row, col: c.col, text: c.text })),
    };
    this.displayed = { format, definition, screen, values, indicators: p.indicators };
    this.terminal.show(screen);
  }

  private read(p: SpecialCall): void {
    const shown = this.displayed;
    if (!shown) return this.fail(p, `READ ${p.format} : aucun écran affiché`);
    if (p.format.toUpperCase() !== shown.format.toUpperCase()) {
      return this.fail(p, `READ ${p.format} : le format affiché est ${shown.format}`);
    }
    let screen = shown.screen;
    for (;;) {
      const accepted = this.accept(shown, this.terminal.input(screen));
      if ('message' in accepted) {   // refus : réaffichage avec message, puis nouvelle saisie
        screen = { ...shown.screen, message: accepted.message };
        this.terminal.show(screen);
        continue;
      }
      if (accepted.key === undefined || !accepted.key.startsWith('CA')) {
        p.area = encodeArea(shown.definition.fields, accepted.values);   // CA : AREA inchangée
      }
      p.indicators = this.responseIndicators(p.indicators, shown, accepted.key);
      return;
    }
  }

  private accept(shown: Displayed, input: ScreenInput): Accepted {
    const key = this.declaredKey(shown.definition, input.key);
    if (key === null) return { message: `Touche ${input.key} non autorisée` };
    const values = new Map(shown.values);
    if (key?.startsWith('CA')) return { key, values };   // CA : aucune saisie transmise, aucun contrôle de zone
    for (const name of Object.keys(input.fields)) {
      const field = shown.screen.fields.find(f => f.name.toUpperCase() === name.toUpperCase());
      if (!field) return { message: `Zone ${name} inconnue ou non affichée` };
      if (field.usage === 'O') return { message: `Zone ${field.name} non saisissable` };
      const parsed = parseInput(shown.definition.fields.find(f => f.name === field.name)!, input.fields[name]);
      if ('message' in parsed) return parsed;
      values.set(field.name, parsed.value);
    }
    return { key, values };
  }

  // ENTER -> undefined ; touche déclarée (CA03, CF05, PAGEUP...) ; null si non autorisée.
  // CAnn et CFnn ne coexistent pas pour un même nn (refusé au chargement de displays.json).
  private declaredKey(format: DisplayFormat, written: string): string | undefined | null {
    const key = written.toUpperCase();
    if (key === 'ENTER') return undefined;
    const m = /^F(\d{1,2})$/.exec(key);
    const nn = m ? m[1].padStart(2, '0') : '';
    const candidates = m ? [`CA${nn}`, `CF${nn}`] : key === 'PAGEUP' || key === 'PAGEDOWN' ? [key] : [];
    return candidates.find(c => format.keys.has(c) || this.definition.keys.has(c)) ?? null;
  }

  // Indicateurs reçus au R (valeurs du programme à cet instant), réponse à 0, puis celui de la touche à 1
  private responseIndicators(received: string, shown: Displayed, key: string | undefined): string {
    const flags = parseIndicators(received);
    const maps = [shown.definition.keys, this.definition.keys];
    for (const map of maps) for (const n of map.values()) if (n !== null) flags[n] = false;
    const pressed = key === undefined ? undefined : maps.map(m => m.get(key)).find(n => n !== undefined);
    if (typeof pressed === 'number') flags[pressed] = true;
    return indicatorsString(n => flags[n]);
  }
}

const blank = (f: DisplayField): AreaValue => (f.type.typeName === 'zoned' ? 0 : '');

function holds(condition: Condition | undefined, flags: boolean[]): boolean {
  return (condition ?? []).every(c => flags[c.indicator] !== c.negated);
}

// char : complété à blanc ; numérique sans édition : zéros de tête, signe '-' à droite si négatif
function display(f: DisplayField, value: AreaValue): string {
  if (f.type.typeName !== 'zoned') return String(value).padEnd(f.length, ' ');
  const n = Number(value);
  const digits = Math.round(Math.abs(n) * 10 ** (f.type.decimals ?? 0)).toString().padStart(f.length, '0');
  return n < 0 ? `${digits}-` : digits;
}
