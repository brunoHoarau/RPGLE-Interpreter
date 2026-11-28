// Simulateur d'écran : routine SPECIAL qui joue le rôle du poste 5250 (spec §3 ; sous-fichiers : spec sous-fichiers)
import type { DisplayFileDefinition, DisplayFormat } from './definition';
import { failCall } from './protocol';
import type { Screen, ScreenInput, SpecialCall, SpecialRoutine, Terminal } from './protocol';
import { AreaValue, decodeArea, encodeArea, indicatorsString, parseIndicators } from './area';
import { parseInput } from './input-values';
import { active, blank, ownRows, pageOfRrn, pageRows, sharesRow, shownConstants, shownFields, subfileScreen } from './composition';
import { Subfile } from './subfile';
import type { SubfileState } from './subfile';
import { subfileCall } from './subfile-calls';

interface Displayed {
  format: string;
  definition: DisplayFormat;
  values: Map<string, AreaValue>;      // toutes les zones (H, I à blanc et non affichées comprises)
  indicators: string;                  // indicateurs reçus au W
  fields: Screen['fields'];            // zones du format montrées
  constants: Screen['constants'];
  lines: Set<number>;                  // lignes d'écran occupées (overlay)
  subfile?: { state: SubfileState; endActive: boolean };   // contrôle : page du sous-fichier montrée
}

type Accepted = { key?: string; values: Map<string, AreaValue> } | { message: string };

export class ScreenSimulator implements SpecialRoutine {
  private displayed: Displayed[] = [];     // formats affichés, du plus ancien au dernier écrit
  private readonly subfiles = new Map<string, SubfileState>();

  constructor(private readonly file: string, private readonly definition: DisplayFileDefinition,
              private readonly terminal: Terminal) {
    for (const format of Object.values(definition.formats)) {
      const control = format.control;
      if (!control) continue;
      this.subfiles.set(control.subfile, {
        name: control.subfile, format: definition.formats[control.subfile], control,
        sf: new Subfile(control.size, control.page, control.size > control.page), page: 1, folded: control.drop !== undefined,
      });
    }
  }

  call(p: SpecialCall): void {
    p.status = '0';
    p.error = 0;
    p.message = undefined;
    if (p.option === 'C') this.close();
    else if (p.option === 'W') this.write(p);
    else if (p.option === 'R') this.read(p);
    else if (p.option !== 'O') subfileCall(this.file, this.definition, this.subfiles, p);
  }

  private close(): void {
    this.displayed = [];
    for (const state of this.subfiles.values()) {
      state.sf.delete();
      state.lastRrn = undefined;
    }
  }

  private findFormat(name: string): [string, DisplayFormat] | undefined {
    const key = Object.keys(this.definition.formats).find(f => f.toUpperCase() === name.toUpperCase());
    return key === undefined ? undefined : [key, this.definition.formats[key]];
  }

  private refuseSubfileFormat(p: SpecialCall, op: string): boolean {
    const found = this.findFormat(p.format);
    if (!found?.[1].subfile) return false;
    failCall(p, `${op} ${found[0]} : ${found[0]} est un format sous-fichier : seuls WRITE, CHAIN, UPDATE et READC s'y appliquent`);
    return true;
  }

  private write(p: SpecialCall): void {
    const found = this.findFormat(p.format);
    if (!found) return failCall(p, `format ${p.format} inconnu dans le fichier écran ${this.file}`);
    if (this.refuseSubfileFormat(p, 'WRITE')) return;
    const [format, definition] = found;
    const sent = decodeArea(definition.fields, p.area);
    const flags = parseIndicators(p.indicators);
    const values = new Map<string, AreaValue>();
    for (const f of definition.fields) values.set(f.name, f.usage === 'I' ? blank(f) : sent.get(f.name)!);
    const entry: Displayed = {
      format, definition, values, indicators: p.indicators,
      fields: shownFields(definition, values, flags), constants: shownConstants(definition, flags), lines: ownRows(definition),
    };
    if (definition.control && !this.writeControl(p, entry, flags)) return;
    this.displayed = definition.overlay
      ? this.displayed.filter(d => d.format !== format && !sharesRow(d.lines, entry.lines))
      : [];
    this.displayed.push(entry);
    this.terminal.show(this.compose());
  }

  // WRITE du contrôle : SFLDLT, SFLCLR, SFLINZ, puis affichage (SFLDSPCTL : le contrôle ; SFLDSP : la page). false : rien à montrer
  private writeControl(p: SpecialCall, entry: Displayed, flags: boolean[]): boolean {
    const control = entry.definition.control!;
    const state = this.subfiles.get(control.subfile)!;
    if (active(control.delete, flags)) state.sf.delete();
    if (active(control.clear, flags)) state.sf.clear();
    if (active(control.initialize, flags)) state.sf.initialize(() => new Map(state.format.fields.map(f => [f.name, blank(f)])));
    if (active(control.delete, flags) || active(control.clear, flags) || active(control.initialize, flags)) state.lastRrn = undefined;
    const showControl = active(control.displayControl, flags);
    const showPage = active(control.display, flags);
    if (!showControl && !showPage) return false;
    if (showPage && state.sf.count === 0) {
      failCall(p, `SFLDSP du format ${entry.format} : le sous-fichier ${state.name} est vide`);
      return false;
    }
    if (!showControl) {
      entry.fields = [];
      entry.constants = [];
      entry.lines = new Set();
    }
    if (showPage) {
      const rrn = control.recordNumber === undefined ? 0 : Number(entry.values.get(control.recordNumber));
      state.page = rrn >= 1 && rrn <= state.sf.count ? pageOfRrn(state, rrn) : 1;
      entry.subfile = { state, endActive: control.end !== undefined && active(control.end.condition, flags) };
      for (const row of pageRows(state)) entry.lines.add(row);
    }
    return true;
  }

  // Composition des formats affichés ; format = dernier écrit
  private compose(): Screen {
    const last = this.displayed[this.displayed.length - 1];
    const screen: Screen = {
      file: this.file, format: last.format, formats: this.displayed.map(d => d.format),
      fields: this.displayed.flatMap(d => d.fields), constants: this.displayed.flatMap(d => d.constants),
    };
    const shown = this.displayed.find(d => d.subfile)?.subfile;
    if (shown) screen.subfile = subfileScreen(shown.state, shown.endActive);
    return screen;
  }

  private read(p: SpecialCall): void {
    if (this.refuseSubfileFormat(p, 'READ')) return;
    const last = this.displayed[this.displayed.length - 1];
    if (!last) return failCall(p, `READ ${p.format} : aucun écran affiché`);
    const shown = this.displayed.find(d => d.format.toUpperCase() === p.format.toUpperCase());
    if (!shown) return failCall(p, `READ ${p.format} : le format affiché est ${this.displayed.map(d => d.format).join(', ')}`);
    const control = shown.definition.control;
    if (control) this.subfiles.get(control.subfile)!.sf.resetPosition();   // READC repart avant le rang 1
    let screen = this.compose();
    for (;;) {
      const accepted = this.accept(shown, this.terminal.input(screen));
      if ('message' in accepted) {   // refus : réaffichage avec message, puis nouvelle saisie
        screen = { ...this.compose(), message: accepted.message };
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
      const field = shown.fields.find(f => f.name.toUpperCase() === name.toUpperCase());
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
