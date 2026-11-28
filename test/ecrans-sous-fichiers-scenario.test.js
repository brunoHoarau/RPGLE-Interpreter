// Sous-fichiers : saisie sur les lignes (R du contrôle), pagination, touche drop, scénario lines/where
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
const sflFields = [F('OPT', 'char(1)', 6), F('CODE', 'char(6)', 6, 'O'), F('DESC', 'char(10)', 7, 'O', { fold: true })];
const DEFS = ({ drop, keys = { PAGEDOWN: '25', PAGEUP: '26', CA05: '05' } } = {}) => displaysFrom({ ECRAN: { formats: {
  SFL1: { subfile: { nextChanged: '67' }, fields: sflFields },
  CTL1: {
    control: { subfile: 'SFL1', size: 14, page: 3, display: '32', displayControl: 'N31', clear: '31', end: { if: '90', text: '*MORE' }, ...(drop ? { drop } : {}) },
    overlay: true, keys, fields: [F('POSIT', 'char(2)', 3)],
  },
} } }).ECRAN;
const setup = (script, options, rows = 10) => {
  const definition = DEFS(options);
  const terminal = new ScriptedTerminal(script);
  const sim = new ScreenSimulator('ECRAN', definition, terminal);
  const call = (option, over = {}) => {
    const p = { option, status: '0', error: 0, area: '', format: 'SFL1', indicators: none, ...over };
    sim.call(p);
    return p;
  };
  for (let n = 1; n <= rows; n++) {
    call('SW', { rrn: n, area: area.encodeArea(definition.formats.SFL1.fields, new Map([['OPT', ''], ['CODE', `C${n}`], ['DESC', `D${n}`]])) });
  }
  return { definition, terminal, call };
};
const ctlArea = d => area.encodeArea(d.formats.CTL1.fields, new Map([['POSIT', '']]));
const show = (s, ...ind) => s.call('W', { format: 'CTL1', area: ctlArea(s.definition), indicators: withInd(32, ...ind) });
const read = (s, indicators = none) => s.call('R', { format: 'CTL1', area: ctlArea(s.definition), indicators });
const changed = s => { const rrns = []; for (let p = s.call('SR'); p.status === '0'; p = s.call('SR')) rrns.push(p.rrn); return rrns; };
const pages = s => s.terminal.shown.map(x => x.subfile && x.subfile.rows.map(r => r.rrn));
const line = (code, fields = {}) => ({ where: { CODE: code }, fields });

test('R : saisie sur une ligne -> modifiée même avec la même valeur, valeur conservée', () => {
  const s = setup([{ format: 'CTL1', lines: [line('C2', { OPT: '2' }), line('C5', { OPT: '' })] }]);
  show(s);
  assert.equal(read(s).status, '0');
  assert.deepEqual(changed(s), [2, 5]);
  assert.match(s.call('SC', { rrn: 2 }).area, /^2C2/);
});

test('R : la position de READC repart avant le rang 1 à chaque R du contrôle', () => {
  const s = setup([{ format: 'CTL1', lines: [line('C2')] }, { format: 'CTL1', lines: [line('C2')] }]);
  show(s);
  read(s);
  assert.deepEqual(changed(s), [2]);
  read(s);
  assert.deepEqual(changed(s), [2]);
});

test('PAGEDOWN/PAGEUP dans les lignes chargées : pas de retour, saisies conservées, une entrée consommée chacune', () => {
  const s = setup([
    { format: 'CTL1', key: 'PAGEDOWN', fields: { POSIT: 'ab' }, lines: [line('C1', { OPT: '1' })] },
    { format: 'CTL1', key: 'PAGEDOWN', lines: [line('C5', { OPT: '5' })] },
    { format: 'CTL1', key: 'PAGEUP' },
    { format: 'CTL1', lines: [line('C4', { OPT: '4' })] },
  ]);
  show(s);
  const before = s.terminal.shown.length;
  const r = read(s);
  assert.equal(r.status, '0');
  assert.equal(r.indicators, none);
  assert.match(r.area, /^AB/);
  assert.deepEqual(pages(s).slice(before), [[4, 5, 6], [7, 8, 9], [4, 5, 6]]);
  assert.deepEqual(changed(s), [1, 4, 5]);
});

test('PAGEDOWN au-delà de la dernière ligne : SFLEND actif -> erreur du scénario ; sinon indicateur de la touche', () => {
  const down = n => Array.from({ length: n }, () => ({ format: 'CTL1', key: 'PAGEDOWN' }));
  const s = setup([...down(4)]);
  show(s, 90);
  assert.throws(() => read(s), /saisie refusée par l'écran.*fin du sous-fichier/);
  const t = setup([...down(4)]);
  show(t);
  const r = read(t);
  assert.equal(r.indicators[24], '1');
  assert.deepEqual(pages(t).slice(-1), [[10]]);
  const u = setup([{ format: 'CTL1', key: 'PAGEDOWN' }, { format: 'CTL1', key: 'PAGEDOWN' }, { format: 'CTL1', key: 'PAGEDOWN' }, { format: 'CTL1', key: 'PAGEDOWN' }], { keys: {} });
  show(u);
  assert.throws(() => read(u), /saisie refusée par l'écran.*PAGEDOWN non autorisée/);
});

test('PAGEUP avant la première ligne : même règle', () => {
  const s = setup([{ format: 'CTL1', key: 'PAGEUP' }]);
  show(s, 90);
  assert.throws(() => read(s), /saisie refusée par l'écran/);
  const t = setup([{ format: 'CTL1', key: 'PAGEUP' }]);
  show(t);
  assert.equal(read(t).indicators[25], '1');
});

test('Touche drop : bascule tronquée/dépliée, réaffiche, ne rend pas la main', () => {
  const s = setup([{ format: 'CTL1', key: 'F11' }, { format: 'CTL1', key: 'F11' }, { format: 'CTL1' }], { drop: 'CF11' });
  show(s);
  assert.equal(s.terminal.shown[s.terminal.shown.length - 1].subfile.folded, true);
  const r = read(s);
  assert.equal(r.status, '0');
  assert.deepEqual(s.terminal.shown.slice(-2).map(x => x.subfile.folded), [false, true]);
  assert.deepEqual(s.terminal.shown[s.terminal.shown.length - 2].subfile.rows.map(x => x.rrn), [1, 2, 3]);
});

test('CA : saisies du contrôle et des lignes non transmises', () => {
  const s = setup([{ format: 'CTL1', key: 'F5', fields: { POSIT: 'zz' }, lines: [line('C2', { OPT: '9' })] }]);
  show(s);
  const area0 = ctlArea(s.definition);
  const r = read(s);
  assert.equal(r.area, area0);
  assert.equal(r.indicators[4], '1');
  assert.deepEqual(changed(s), []);
  assert.match(s.call('SC', { rrn: 2 }).area, /^ C2/);
});

test('Scénario : where absent, multiple, ligne visée deux fois, lines sans SFLDSP', () => {
  const run = (lines, ind = [32]) => {
    const s = setup([{ format: 'CTL1', lines }]);
    s.call('W', { format: 'CTL1', area: ctlArea(s.definition), indicators: withInd(...ind) });
    return () => read(s);
  };
  assert.throws(run([line('ZZ')]), /aucune ligne où CODE = 'ZZ' dans le sous-fichier SFL1 \(10 lignes chargées\)/);
  assert.throws(run([{ where: { OPT: '' }, fields: {} }]), /plusieurs lignes où OPT = '' dans le sous-fichier SFL1 \(rangs 1, 2, 3/);
  assert.throws(run([line('C2'), line('C2')]), /visée deux fois/);
  assert.throws(run([{ where: { NOPE: 'x' }, fields: {} }]), /NOPE/);
  assert.throws(run([line('C2', { CODE: 'x' })]), /CODE.*non saisissable/);
  assert.throws(run([line('C2')], []), /SFLDSP/);   // ni SFLDSP ni page : contrôle seul affiché
});

test('Saisie sur une ligne d\'une autre page : la page affichée au retour est celle de la dernière ligne saisie', () => {
  const s = setup([{ format: 'CTL1', lines: [line('C8', { OPT: 'x' }), line('C2', { OPT: 'y' })] }]);
  show(s);
  const before = s.terminal.shown.length;
  read(s);
  assert.deepEqual(pages(s).slice(before), [[7, 8, 9], [1, 2, 3]]);
  assert.deepEqual(changed(s), [2, 8]);
});
