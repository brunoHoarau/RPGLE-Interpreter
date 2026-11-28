// Sous-fichiers : simulateur d'écran (protocole SW/SC/SU/SR, W du contrôle, overlay, écran composé)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { displaysFrom } = require('./helpers');
const area = require(path.join(__dirname, '..', 'out', 'screens', 'area'));
const { ScreenSimulator } = require(path.join(__dirname, '..', 'out', 'screens', 'simulator'));
const { ScriptedTerminal } = require(path.join(__dirname, '..', 'out', 'screens', 'scripted-terminal'));

const F = (name, type, row, usage = 'B', extra = {}) => ({ name, usage, type, row, col: 3, ...extra });
const none = '0'.repeat(99);
const withInd = (...ns) => { const a = none.split(''); ns.forEach(n => { a[n - 1] = '1'; }); return a.join(''); };
const sflFields = [F('OPT', 'char(1)', 6), F('CODE', 'char(6)', 6, 'O'), F('DESC', 'char(10)', 7, 'O', { fold: true }),
  { name: 'HID', usage: 'H', type: 'char(2)' }, F('CMT', 'char(3)', 6, 'O', { if: '40' })];
const ctl = (extra = {}, end = { if: '90', text: '*MORE' }) => ({
  control: { subfile: 'SFL1', size: 14, page: 3, display: '32', displayControl: 'N31', clear: '31', delete: '33', initialize: '34',
    end, recordNumber: 'RRNTOP', ...extra },
  overlay: true, constants: [{ row: 4, col: 2, text: 'Opt  Code' }],
  fields: [{ name: 'RRNTOP', type: 'zoned(4:0)', usage: 'H' }, F('POSIT', 'char(2)', 3)],
});
const DEFS = (control = ctl()) => displaysFrom({ ECRAN: { keys: { CA03: '03' }, formats: {
  SFL1: { subfile: { nextChanged: '67' }, fields: sflFields },
  CTL1: control,
  BAS1: { overlay: true, constants: [{ row: 23, col: 2, text: 'F3=Sortie' }], fields: [] },
  FMT0: { constants: [{ row: 1, col: 2, text: 'Titre' }], fields: [F('ZONE', 'char(4)', 10)] },
} } }).ECRAN;
const setup = (script = [], control) => {
  const definition = DEFS(control);
  const terminal = new ScriptedTerminal(script);
  return { definition, terminal, sim: new ScreenSimulator('ECRAN', definition, terminal) };
};
const call = (sim, option, over = {}) => {
  const p = { option, status: '0', error: 0, area: '', format: 'SFL1', indicators: none, ...over };
  sim.call(p);
  return p;
};
const sflArea = (d, v) => area.encodeArea(d.formats.SFL1.fields, new Map(Object.entries(v)));
const ctlArea = (d, v = {}) => area.encodeArea(d.formats.CTL1.fields, new Map(Object.entries({ RRNTOP: 0, POSIT: '', ...v })));
const sw = (s, rrn, v, indicators = none) =>
  call(s.sim, 'SW', { rrn, area: sflArea(s.definition, { OPT: '', CODE: `C${rrn}`, DESC: `D${rrn}`, HID: 'h', CMT: 'cm', ...v }), indicators });
const writeCtl = (s, indicators, over = {}) => call(s.sim, 'W', { format: 'CTL1', area: ctlArea(s.definition, over), indicators });
const last = s => s.terminal.shown[s.terminal.shown.length - 1];
const fmt0Area = d => area.encodeArea(d.formats.FMT0.fields, new Map([['ZONE', 'zz']]));

test('SW/SC/SR : SFLNXTCHG vrai -> ligne modifiée ; SC absent et fin de SR -> statut 1', () => {
  const s = setup();
  for (const n of [1, 2, 3]) assert.equal(sw(s, n, {}, n === 2 ? none : withInd(67)).status, '0');
  const c = call(s.sim, 'SC', { rrn: 2 });
  assert.equal(c.status, '0');
  assert.equal(c.rrn, 2);
  assert.match(c.area, /^ C2 {4}D2 {8}h /);
  assert.equal(call(s.sim, 'SC', { rrn: 9 }).status, '1');
  const r1 = call(s.sim, 'SR');
  assert.deepEqual([r1.status, r1.rrn], ['0', 1]);
  assert.match(r1.area, /C1/);
  assert.equal(call(s.sim, 'SR').rrn, 3);
  assert.equal(call(s.sim, 'SR').status, '1');
});

test('SU : réécrit la ligne du dernier SC/SR ; sans lecture préalable -> statut 2', () => {
  const s = setup();
  sw(s, 1, {});
  const blank = { OPT: '', CODE: 'X', DESC: '', HID: '', CMT: '' };
  const bad = call(s.sim, 'SU', { rrn: 1, area: sflArea(s.definition, blank) });
  assert.equal(bad.status, '2');
  assert.match(bad.message, /UPDATE.*CHAIN.*READC/);
  call(s.sim, 'SC', { rrn: 1 });
  const ok = call(s.sim, 'SU', { rrn: 1, indicators: withInd(67), area: sflArea(s.definition, { ...blank, OPT: '2', CODE: 'NEW' }) });
  assert.equal(ok.status, '0');
  assert.match(call(s.sim, 'SC', { rrn: 1 }).area, /^2NEW/);
  assert.equal(call(s.sim, 'SR').rrn, 1);    // SFLNXTCHG vrai : de nouveau modifiée
});

test('SW : rang invalide, doublon, trou -> statut 2 ; opérations sur un format hors sous-fichier ; W/R sur le sous-fichier', () => {
  const s = setup();
  assert.equal(sw(s, 0, {}).status, '2');
  assert.equal(sw(s, 1, {}).status, '0');
  assert.match(sw(s, 1, {}).message, /déjà présent/);
  assert.match(sw(s, 5, {}).message, /trou/);
  for (const o of ['SW', 'SC', 'SU', 'SR']) {
    const p = call(s.sim, o, { format: 'CTL1', rrn: 1 });
    assert.equal(p.status, '2', o);
    assert.match(p.message, /CTL1.*pas un format sous-fichier/);
  }
  for (const o of ['W', 'R']) {
    const p = call(s.sim, o, { format: 'SFL1' });
    assert.equal(p.status, '2', o);
    assert.match(p.message, /SFL1.*format sous-fichier/);
  }
});

test('W du contrôle : SFLDLT, SFLCLR puis SFLINZ, dans cet ordre, avant l\'affichage', () => {
  const s = setup();
  sw(s, 1, {});
  writeCtl(s, withInd(31));                       // SFLCLR : vide ; ni SFLDSP ni SFLDSPCTL : rien n'est affiché
  assert.equal(call(s.sim, 'SC', { rrn: 1 }).status, '1');
  assert.equal(s.terminal.shown.length, 0);
  assert.equal(writeCtl(s, withInd(33, 34, 32)).status, '0');   // SFLDLT, SFLINZ, SFLDSP
  assert.equal(call(s.sim, 'SC', { rrn: 14 }).status, '0');
  assert.equal(call(s.sim, 'SC', { rrn: 15 }).status, '1');
  assert.equal(call(s.sim, 'SR').status, '1');    // lignes d'initialisation non modifiées
});

test('W du contrôle : SFLDSP sur sous-fichier vide -> statut 2', () => {
  const s = setup();
  const p = writeCtl(s, withInd(32));
  assert.equal(p.status, '2');
  assert.match(p.message, /SFLDSP.*vide/);
});

test('Ecran composé : page, zones H non montrées, conditions if par ligne', () => {
  const s = setup();
  for (let n = 1; n <= 10; n++) sw(s, n, {}, n === 1 ? withInd(40) : none);
  writeCtl(s, withInd(32));
  const screen = last(s);
  assert.deepEqual(screen.subfile.rows.map(r => r.rrn), [1, 2, 3]);
  assert.equal(screen.subfile.folded, false);
  assert.deepEqual(screen.subfile.rows[0].fields.map(f => f.name), ['OPT', 'CODE', 'DESC', 'CMT']);
  assert.deepEqual(screen.subfile.rows[1].fields.map(f => f.name), ['OPT', 'CODE', 'DESC']);
  assert.deepEqual(screen.subfile.rows[1].fields.map(f => f.row), [8, 8, 9]);   // 2e ligne : décalage de la hauteur (2)
  assert.deepEqual(screen.formats, ['CTL1']);
  assert.equal(screen.format, 'CTL1');
  assert.deepEqual(screen.constants.map(c => c.text), ['Opt  Code']);
});

test('Ecran composé : forme tronquée (SFLDROP), une ligne par enregistrement, page × hauteur enregistrements', () => {
  const s = setup([], ctl({ drop: 'CF11' }));
  for (let n = 1; n <= 10; n++) sw(s, n, {});
  writeCtl(s, withInd(32));
  const f = last(s).subfile;
  assert.equal(f.folded, true);
  assert.deepEqual(f.rows.map(r => r.rrn), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(f.rows[1].fields.map(x => x.name), ['OPT', 'CODE']);
  assert.deepEqual(f.rows.map(r => r.fields[0].row), [6, 7, 8, 9, 10, 11]);
});

test('Ecran composé : page de SFLRCDNBR', () => {
  const s = setup();
  for (let n = 1; n <= 10; n++) sw(s, n, {});
  writeCtl(s, withInd(32), { RRNTOP: 5 });
  assert.deepEqual(last(s).subfile.rows.map(r => r.rrn), [4, 5, 6]);
  writeCtl(s, withInd(32), { RRNTOP: 99 });
  assert.deepEqual(last(s).subfile.rows.map(r => r.rrn), [1, 2, 3]);
  writeCtl(s, withInd(32), { RRNTOP: 10 });
  assert.deepEqual(last(s).subfile.rows.map(r => r.rrn), [10]);
});

test('SFLEND : *MORE (A suivre... / Fin), *PLUS, absent si l\'indicateur est faux', () => {
  const s = setup();
  for (let n = 1; n <= 5; n++) sw(s, n, {});
  writeCtl(s, withInd(32, 90));
  assert.equal(last(s).subfile.end, 'A suivre...');
  writeCtl(s, withInd(32, 90), { RRNTOP: 5 });
  assert.equal(last(s).subfile.end, 'Fin');
  writeCtl(s, withInd(32));
  assert.equal(last(s).subfile.end, undefined);
  const plus = setup([], ctl({}, { if: '90', text: '*PLUS' }));
  for (let n = 1; n <= 5; n++) sw(plus, n, {});
  writeCtl(plus, withInd(32, 90));
  assert.equal(last(plus).subfile.end, '+');
  writeCtl(plus, withInd(32, 90), { RRNTOP: 5 });
  assert.equal(last(plus).subfile.end, undefined);
});

test('OVERLAY : retire les formats qui partagent une ligne, garde les autres ; sans overlay l\'écran est vidé', () => {
  const s = setup();
  sw(s, 1, {});
  call(s.sim, 'W', { format: 'FMT0', area: fmt0Area(s.definition) });
  call(s.sim, 'W', { format: 'BAS1' });
  assert.deepEqual(last(s).formats, ['FMT0', 'BAS1']);
  writeCtl(s, withInd(32));          // page : lignes 6 à 11, partage la ligne 10 avec FMT0 ; BAS1 (ligne 23) reste
  assert.deepEqual(last(s).formats, ['BAS1', 'CTL1']);
  assert.ok(last(s).constants.some(c => c.text === 'F3=Sortie'));
  assert.equal(last(s).format, 'CTL1');
  call(s.sim, 'W', { format: 'FMT0', area: fmt0Area(s.definition) });
  assert.deepEqual(last(s).formats, ['FMT0']);
  assert.equal(last(s).subfile, undefined);
});

test('R : le format doit être affiché ; seules ses zones sont rendues', () => {
  const s = setup([{ format: 'CTL1', fields: { POSIT: 'ab' } }]);
  sw(s, 1, {});
  call(s.sim, 'W', { format: 'BAS1' });
  writeCtl(s, withInd(32));
  const bad = call(s.sim, 'R', { format: 'FMT0' });
  assert.equal(bad.status, '2');
  const r = call(s.sim, 'R', { format: 'CTL1', indicators: none });
  assert.equal(r.status, '0');
  assert.equal(r.area, ctlArea(s.definition, { POSIT: 'AB' }));
});
