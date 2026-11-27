// Ecrans : DCL-F WORKSTN : analyse et déclaration
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const area = require(path.join(__dirname, '..', 'out', 'screens', 'area'));
const char = (name, length, usage = 'B') => ({ name, usage, length, type: { type: 'DataType', typeName: 'char', length } });
const zoned = (name, length, decimals, usage = 'B') =>
  ({ name, usage, length, type: { type: 'DataType', typeName: 'zoned', length, decimals } });
// ---- Simulateur d'écran et terminal scripté ----
const { ScreenSimulator } = require(path.join(__dirname, '..', 'out', 'screens', 'simulator'));
const { ScriptedTerminal } = require(path.join(__dirname, '..', 'out', 'screens', 'scripted-terminal'));
const none = '0'.repeat(99);
const call = (sim, option, over = {}) => {
  const p = { option, status: '0', error: 0, area: '', format: 'FMT01', indicators: none, ...over };
  sim.call(p);
  return p;
};
// --- DCL-F WORKSTN : analyse et déclaration ---
const { parse, run, runScreens, displaysFrom } = require('./helpers');
const field = (name, type, row, usage = 'B') => ({ name, usage, type, row, col: 10 });
const ECRAN = () => displaysFrom({
  ECRAN: {
    keys: { CA03: '03' },
    formats: {
      FMT01: { fields: [field('CODE', 'char(6)', 3), field('QTE', 'zoned(5:2)', 4)] },
      FMT02: { fields: [field('CODE', 'char(6)', 3), field('LIB', 'char(10)', 5, 'O')] },
    },
  },
});

test('DCL-F WORKSTN : analyse (device, INDDS, USAGE par défaut)', () => {
  const [node] = parse('dcl-f ecran workstn indds(ind);').files;
  assert.equal(node.device, 'workstn');
  assert.equal(node.indds, 'IND');
  assert.deepEqual(node.usage, { input: true, output: true, update: false, delete: false });
  assert.equal(parse('dcl-f ecran workstn;').files[0].indds, undefined);
  assert.equal(parse('dcl-f client;').files[0].device, undefined);
});

test('DCL-F WORKSTN : les zones de tous les formats deviennent des variables', () => {
  const { output } = runScreens(`
    dcl-f ecran workstn;
    dsply code;
    dsply qte;
    dsply lib;
  `, ECRAN(), []);
  assert.deepEqual(output, ['', '0', '']);
});

test('DCL-F WORKSTN : fichier absent de displays.json', () => {
  assert.throws(() => runScreens('dcl-f inconnu workstn;', ECRAN(), []), /INCONNU.*displays\.json/);
});

test('DCL-F WORKSTN : sans fabrique, exécution interactive requise', () => {
  assert.throws(() => run('dcl-f ecran workstn;', { tables: {}, programs: {}, displays: ECRAN() }),
    /fichier écran.*exécution interactive requise/i);
});

test('DCL-F WORKSTN : même zone, types différents entre deux formats : erreur', () => {
  const d = displaysFrom({ E: { formats: {
    A: { fields: [field('X', 'char(3)', 1)] }, B: { fields: [field('X', 'char(4)', 1)] } } } });
  assert.throws(() => runScreens('dcl-f e workstn;', d, []), /X.*char/i);
});

test('DCL-F WORKSTN : zone partagée avec un fichier base de même type', () => {
  const d = displaysFrom({ ECRAN: { formats: { F1: { fields: [field('NOM', 'char(10)', 1)] } } } });
  const ctx = () => ({ tables: { CLIENT: { columns: [{ name: 'NOM', type: 'char(10)' }], data: [] } }, programs: {} });
  assert.deepEqual(runScreens('dcl-f client; dcl-f ecran workstn; dsply nom;', d, [], ctx()).output, ['']);
  const bad = displaysFrom({ ECRAN: { formats: { F1: { fields: [field('NOM', 'char(8)', 1)] } } } });
  assert.throws(() => runScreens('dcl-f client; dcl-f ecran workstn;', bad, [], ctx()), /NOM/);
});

test('DCL-F WORKSTN : nom de fichier ou de format déjà utilisé', () => {
  const ctx = () => ({ tables: { CLIENT: { columns: [{ name: 'NOM', type: 'char(10)' }], data: [] } }, programs: {} });
  const d = displaysFrom({ CLIENT: { formats: {} }, E2: { formats: { CLIENTF: { fields: [] } } } });
  assert.throws(() => runScreens('dcl-f client; dcl-f client workstn;', d, [], ctx()), /CLIENT/);
  assert.throws(() => runScreens('dcl-f client; dcl-f e2 workstn;', d, [], ctx()), /CLIENTF/);
  assert.throws(() => runScreens('dcl-f e2 workstn; dcl-f client;', d, [], ctx()), /CLIENTF/);
  assert.throws(() => runScreens('dcl-s fmt01 char(1); dcl-f ecran workstn;', ECRAN(), []), /FMT01/);
});

test('DCL-F WORKSTN : INDDS sans indara refusé ; avec indara, DS de 99 octets au moins', () => {
  const sans = ECRAN();
  assert.throws(() => runScreens('dcl-ds ind qualified; f char(99); end-ds; dcl-f ecran workstn indds(ind);', sans, []),
    /INDDS.*indara/);
  const avec = displaysFrom({ E: { indara: true, formats: {} } });
  assert.throws(() => runScreens('dcl-f e workstn indds(ind);', avec, []), /IND.*non déclarée/);
  // DS de moins de 99 octets acceptée : indicateurs nommés à POS clairsemés
  assert.deepEqual(runScreens(`dcl-ds ind qualified; exit ind pos(3); refresh ind pos(5); end-ds;
    dcl-f e workstn indds(ind); dsply 'ok';`, avec, []).output, ['ok']);
  assert.deepEqual(runScreens('dcl-ds ind qualified; f char(99); end-ds; dcl-f e workstn indds(ind); dsply \'ok\';',
    avec, []).output, ['ok']);
});

test('DCL-F WORKSTN : appel O à la déclaration, C en fin de programme', () => {
  const log = [];
  const screens = () => ({ call(p) { log.push(`${p.option}:${p.area}:${p.format}:${p.indicators}`); } });
  const ctx = { tables: {}, programs: {}, displays: ECRAN() };
  run(`dcl-f ecran workstn; dsply 'x';`, ctx, { screens });
  assert.deepEqual(log, ['O:::', 'C:::']);
  log.length = 0;
  run(`dcl-f ecran workstn; *inlr = *on; return;`, ctx, { screens });
  assert.deepEqual(log, ['O:::', 'C:::']);
});

test('DCL-F WORKSTN : statut 2 à l\'appel O : erreur', () => {
  const screens = () => ({ call(p) { p.status = '2'; p.error = 1299; p.message = 'écran indisponible'; } });
  assert.throws(() => run('dcl-f ecran workstn;', { tables: {}, programs: {}, displays: ECRAN() }, { screens }),
    /fichier écran ECRAN : écran indisponible \(erreur 01299\)/);
});

test('DCL-F WORKSTN : positions des sous-zones ind de la DS INDDS', () => {
  const path = require('path');
  const out = path.join(__dirname, '..', 'out', 'interpreter');
  const { InterpreterState } = require(path.join(out, 'state'));
  const { runProgram } = require(path.join(out, 'program'));
  const { inddsPositions } = require(path.join(out, 'screens', 'declare'));
  const { ScreenSimulator } = require(path.join(__dirname, '..', 'out', 'screens', 'simulator'));
  const { ScriptedTerminal } = require(path.join(__dirname, '..', 'out', 'screens', 'scripted-terminal'));
  const ctx = { tables: {}, programs: {}, displays: displaysFrom({ E: { indara: true, formats: {} } }) };
  const state = new InterpreterState(ctx, { screens: (f, d) => new ScreenSimulator(f, d, new ScriptedTerminal([])) });
  runProgram(state, parse(`dcl-ds ind qualified;
      exit ind pos(3);
      refresh ind pos(5);
      suite ind;
      autre char(2) pos(40);
      tard ind pos(99);
    end-ds;
    dcl-f e workstn indds(ind);`), []);
  assert.deepEqual([...inddsPositions(state, state.displays.get('E'))],
    [[3, 'exit'], [5, 'refresh'], [6, 'suite'], [99, 'tard']]);
});

test('DCL-F WORKSTN : statut 2 à l appel C : erreur', () => {
  const screens = () => ({ call(p) { if (p.option === 'C') { p.status = '2'; p.error = 7; p.message = 'fermeture refusée'; } } });
  assert.throws(() => run('dcl-f ecran workstn;', { tables: {}, programs: {}, displays: ECRAN() }, { screens }),
    /fichier écran ECRAN : fermeture refusée \(erreur 00007\)/);
});

test('DCL-F WORKSTN : pas d appel O si un contrôle de déclaration échoue', () => {
  const log = [];
  const screens = () => ({ call(p) { log.push(p.option); } });
  const d = displaysFrom({ E: { indara: true, formats: {} } });
  assert.throws(() => run('dcl-f e workstn indds(ind);', { tables: {}, programs: {}, displays: d }, { screens }), /non déclarée/);
  assert.deepEqual(log, []);
});
