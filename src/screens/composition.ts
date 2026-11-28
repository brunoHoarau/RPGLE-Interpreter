// Composition de l'écran : zones et constantes montrées, lignes occupées par un format (overlay), page du sous-fichier
import type { AreaValue } from './area';
import { parseIndicators } from './area';
import type { Condition } from './conditions';
import type { DisplayField, DisplayFormat } from './definition';
import { recordHeight } from './definition-subfile';
import type { Screen, ScreenSubfile } from './protocol';
import type { SubfileState } from './subfile';

export const blank = (f: DisplayField): AreaValue => (f.type.typeName === 'zoned' ? 0 : '');

export function holds(condition: Condition | undefined, flags: boolean[]): boolean {
  return (condition ?? []).every(c => flags[c.indicator] !== c.negated);
}

// Mot-clé de contrôle : absent = faux, null = toujours, sinon condition
export function active(condition: Condition | null | undefined, flags: boolean[]): boolean {
  return condition === undefined ? false : condition === null ? true : holds(condition, flags);
}

// char : complété à blanc ; numérique sans édition : zéros de tête, signe '-' à droite si négatif
export function display(f: DisplayField, value: AreaValue): string {
  if (f.type.typeName !== 'zoned') return String(value).padEnd(f.length, ' ');
  const n = Number(value);
  const digits = Math.round(Math.abs(n) * 10 ** (f.type.decimals ?? 0)).toString().padStart(f.length, '0');
  return n < 0 ? `${digits}-` : digits;
}

// Zones montrées (ni H, ni "if" faux) ; rowOf décale la ligne d'écran (lignes du sous-fichier), skip masque une zone
export function shownFields(definition: DisplayFormat, values: Map<string, AreaValue>, flags: boolean[],
                            rowOf: (f: DisplayField) => number = f => f.row!, skip: (f: DisplayField) => boolean = () => false): Screen['fields'] {
  return definition.fields.filter(f => f.usage !== 'H' && holds(f.condition, flags) && !skip(f)).map(f => ({
    name: f.name, row: rowOf(f), col: f.col!, length: f.length, usage: f.usage as 'I' | 'O' | 'B',
    numeric: f.type.typeName === 'zoned', value: display(f, values.get(f.name)!),
  }));
}

export function shownConstants(definition: DisplayFormat, flags: boolean[]): Screen['constants'] {
  return definition.constants.filter(c => holds(c.condition, flags)).map(c => ({ row: c.row, col: c.col, text: c.text }));
}

// Première ligne d'écran d'un enregistrement sous-fichier
export function firstRow(format: DisplayFormat): number {
  const rows = format.fields.filter(f => f.usage !== 'H').map(f => f.row!);
  return rows.length === 0 ? 1 : Math.min(...rows);
}

const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);

// Lignes d'écran occupées par les zones et constantes d'un format (déclarées, quel que soit leur "if")
export function ownRows(definition: DisplayFormat): Set<number> {
  const rows = new Set<number>();
  for (const f of definition.fields) if (f.usage !== 'H') rows.add(f.row!);
  for (const c of definition.constants) rows.add(c.row);
  return rows;
}

// Lignes de la page d'un sous-fichier : page × hauteur lignes à partir de la première ligne des enregistrements
export function pageRows(state: SubfileState): Set<number> {
  return new Set(range(firstRow(state.format), state.control.page * recordHeight(state.format)));
}

export const sharesRow = (a: Set<number>, b: Set<number>): boolean => [...a].some(row => b.has(row));

// Enregistrements par page : page lignes de hauteur h ; en forme tronquée, une ligne chacun sur la même zone d'écran
export const perPage = (state: SubfileState): number =>
  state.folded ? state.control.page * recordHeight(state.format) : state.control.page;

export const pageOfRrn = (state: SubfileState, rrn: number): number => Math.ceil(rrn / perPage(state));

// Page affichée du sous-fichier (rangs, zones décalées par ligne, texte de SFLEND)
export function subfileScreen(state: SubfileState, endActive: boolean): ScreenSubfile {
  const height = recordHeight(state.format);
  const top = firstRow(state.format);
  const size = perPage(state);
  const first = (state.page - 1) * size + 1;
  const rrns = range(first, size).filter(rrn => state.sf.chain(rrn) !== undefined);
  const rows = rrns.map((rrn, k) => {
    const record = state.sf.chain(rrn)!;
    const flags = parseIndicators(record.indicators);
    const fields = state.folded
      ? shownFields(state.format, record.values, flags, () => top + k, f => f.fold)
      : shownFields(state.format, record.values, flags, f => f.row! + k * height);
    return { rrn, fields };
  });
  const loaded = [...Array(state.sf.count)].map((_, i) => {
    const values: { [name: string]: string } = {};
    for (const f of state.format.fields) values[f.name] = display(f, state.sf.chain(i + 1)!.values.get(f.name)!);
    return { rrn: i + 1, values };
  });
  const result: ScreenSubfile = { format: state.name, rows, folded: state.folded, loaded };
  const more = (rrns[rrns.length - 1] ?? 0) < state.sf.count;
  if (endActive && state.control.end) {
    const text = state.control.end.text === '*MORE' ? (more ? 'A suivre...' : 'Fin') : more ? '+' : undefined;
    if (text !== undefined) result.end = text;
  }
  return result;
}
