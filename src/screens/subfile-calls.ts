// Simulateur : opérations sur les lignes d'un sous-fichier (SW = WRITE, SC = CHAIN, SU = UPDATE, SR = READC)
import { AreaValue, decodeArea, encodeArea, parseIndicators } from './area';
import { blank, holds } from './composition';
import type { DisplayFileDefinition } from './definition';
import { failCall, SpecialCall } from './protocol';
import type { SubfileRecord, SubfileState } from './subfile';

const NAMES = { SW: 'WRITE', SC: 'CHAIN', SU: 'UPDATE', SR: 'READC' } as const;

export function subfileCall(file: string, definition: DisplayFileDefinition, subfiles: Map<string, SubfileState>, p: SpecialCall): void {
  const op = NAMES[p.option as keyof typeof NAMES];
  const name = Object.keys(definition.formats).find(f => f.toUpperCase() === p.format.toUpperCase());
  if (name === undefined) return failCall(p, `format ${p.format} inconnu dans le fichier écran ${file}`);
  if (!definition.formats[name].subfile) return failCall(p, `${op} ${name} : ${name} n'est pas un format sous-fichier`);
  const state = subfiles.get(name);
  if (!state) return failCall(p, `${op} ${name} : aucun format contrôle (SFLCTL) ne lie le sous-fichier ${name}`);
  const fields = state.format.fields;
  if (p.option === 'SC') {
    const record = state.sf.chain(p.rrn ?? 0);
    if (!record) return void (p.status = '1');
    state.lastRrn = p.rrn;
    p.area = encodeArea(fields, record.values);
  } else if (p.option === 'SR') {
    const next = state.sf.readChanged();
    if (!next) return void (p.status = '1');
    state.lastRrn = next.rrn;
    p.rrn = next.rrn;
    p.area = encodeArea(fields, next.record.values);
  } else if (p.option === 'SW') {
    const message = state.sf.write(p.rrn ?? 0, recordOf(state, p));
    if (message !== undefined) failCall(p, `${op} ${name} : ${message}`);
  } else if (state.lastRrn === undefined) {
    failCall(p, `${op} ${name} : aucune ligne lue : un CHAIN ou un READC réussi doit précéder UPDATE`);
  } else {
    state.sf.update(state.lastRrn, recordOf(state, p));
  }
}

// Valeurs de l'AREA (zones I à blanc), indicateurs du moment ; SFLNXTCHG vrai -> ligne modifiée
function recordOf(state: SubfileState, p: SpecialCall): SubfileRecord {
  const sent = decodeArea(state.format.fields, p.area);
  const values = new Map<string, AreaValue>();
  for (const f of state.format.fields) values.set(f.name, f.usage === 'I' ? blank(f) : sent.get(f.name)!);
  const next = state.format.subfile?.nextChanged;
  return { values, indicators: p.indicators, changed: next !== undefined && holds(next, parseIndicators(p.indicators)) };
}
