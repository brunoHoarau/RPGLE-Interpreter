// Ecrans : exemple de bout en bout et relecture finale
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const area = require(path.join(__dirname, '..', 'out', 'screens', 'area'));
const char = (name, length, usage = 'B') => ({ name, usage, length, type: { type: 'DataType', typeName: 'char', length } });
const zoned = (name, length, decimals, usage = 'B') =>
  ({ name, usage, length, type: { type: 'DataType', typeName: 'zoned', length, decimals } });
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
// --- WRITE, READ, EXFMT ---
const SAISIE = () => displaysFrom({
  ECRAN: {
    keys: { CA03: '03' },
    formats: {
      FMT01: {
        keys: { CF05: '05' },
        constants: [
          { row: 20, col: 2, text: 'Rafraichi', if: '31' },
          { row: 21, col: 2, text: 'Normal', if: 'N31' },
          { row: 22, col: 2, text: 'Cinq', if: '05' },
        ],
        fields: [field('CODE', 'char(6)', 3), field('QTE', 'zoned(5:2)', 4), field('LIB', 'char(10)', 5, 'O')],
      },
      FMT02: { fields: [field('NOTE', 'char(4)', 3)] },
    },
  },
});
const journal = (log, over = {}) => () => ({ call(p) { log.push(p.option); over.call?.(p); } });
const deuxEcrans = () => displaysFrom({
  E1: { formats: { F1: { fields: [] } } },
  E2: { formats: { F2: { fields: [] } } },
});

// --- Exemple de bout en bout : fichiers_test/ecran_commande.rpgle avec context/ ---


test('exemple ecran_commande.rpgle : 4 saisies (article, code inconnu, F5, F3)', () => {
  const fs = require('fs');
  const { loadContextFromFolder } = require(path.join(__dirname, '..', 'out', 'context'));
  const root = path.join(__dirname, '..');
  const context = loadContextFromFolder(path.join(root, 'context'));
  const source = fs.readFileSync(path.join(root, 'fichiers_test', 'ecran_commande.rpgle'), 'utf8');
  const { output, shown } = runScreens(source, {}, [
    { format: 'SAISIE', fields: { CODE: 'A100', QTE: '12' } },
    { format: 'SAISIE', fields: { CODE: 'Z999', QTE: '1' } },
    { format: 'SAISIE', key: 'F5' },
    { format: 'SAISIE', key: 'F3' },
  ], context);
  assert.deepEqual(output, ['Commande A100 : Vis inox x 12', 'Lignes saisies : 1']);
  assert.equal(shown.length, 4);
  const inconnu = s => s.constants.some(c => c.text === 'Code article inconnu');
  assert.deepEqual(shown.map(inconnu), [false, false, true, false]);
  assert.equal(shown[1].fields.find(f => f.name === 'LIBELLE').value.trim(), 'Vis inox');
  assert.equal(shown[2].fields.find(f => f.name === 'LIBELLE').value.trim(), '');
  assert.equal(shown[3].fields.find(f => f.name === 'CODE').value.trim(), '');
});

test('EXFMT FMT02 puis READ FMT01 : le format affiché est FMT02', () => {
  assert.throws(() => runScreens('dcl-f ecran workstn; exfmt fmt02; read fmt01;', SAISIE(), [{ format: 'FMT02' }]),
    err => err.message === 'fichier écran ECRAN : READ FMT01 : le format affiché est FMT02 (erreur 01299)');
});

// --- Relecture finale : READ séparé, majuscules, USAGE, appel C, OPEN/CLOSE ---


test('WRITE puis READ : *IN et zone O modifiés entre-temps ne sont pas écrasés par le READ', () => {
  const { output } = runScreens(`
    dcl-f ecran workstn;
    lib = 'AVANT';
    write fmt01;
    *in50 = *on;
    lib = 'APRES';
    read fmt01;
    if *in50;
      dsply 'ON';
    endif;
    dsply lib;
  `, SAISIE(), [{ format: 'FMT01' }]);
  assert.deepEqual(output, ['ON', 'APRES']);
});

test('EXFMT : la zone O n est jamais recopiée de l AREA rendue', () => {
  const { output } = runScreens(`
    dcl-f ecran workstn;
    lib = 'PROG';
    exfmt fmt01;
    dsply lib;
  `, SAISIE(), [{ format: 'FMT01', fields: { CODE: 'X' } }]);
  assert.deepEqual(output, ['PROG']);
});

test('saisie char : majuscules sauf "lc": true', () => {
  const d = (lc) => displaysFrom({ E: { formats: { F: { fields: [
    { name: 'CODE', usage: 'B', type: 'char(6)', row: 3, col: 10, ...(lc ? { lc: true } : {}) }] } } } });
  const prog = `dcl-f e workstn; exfmt f; dsply code;`;
  assert.deepEqual(runScreens(prog, d(false), [{ format: 'F', fields: { CODE: 'abc d' } }]).output, ['ABC D']);
  assert.deepEqual(runScreens(prog, d(true), [{ format: 'F', fields: { CODE: 'abc d' } }]).output, ['abc d']);
});

test('displays.json : "lc" booléen, refusé sur un zoned', () => {
  const f = (extra) => () => displaysFrom({ E: { formats: { F: { fields: [{ name: 'N', usage: 'B', row: 1, col: 1, ...extra }] } } } });
  assert.throws(f({ type: 'char(3)', lc: 'oui' }), /"lc" doit être vrai ou faux/);
  assert.throws(f({ type: 'zoned(3:0)', lc: true }), /"lc" n'est permis que sur une zone char/);
  assert.doesNotThrow(f({ type: 'char(3)', lc: true }));
});

test('WORKSTN : USAGE incompatible avec l opération refusé', () => {
  const ref = (usage, op, msg) => assert.throws(
    () => runScreens(`dcl-f ecran workstn usage(${usage}); ${op}`, SAISIE(), [{ format: 'FMT01' }]), msg, `${usage} ${op}`);
  assert.throws(() => parse('dcl-f ecran workstn usage(*update);'), /\*UPDATE.*fichier écran/);
  assert.throws(() => parse('dcl-f ecran workstn usage(*input : *output : *delete);'), /\*DELETE.*fichier écran/);
  ref('*input', 'write fmt01;', /WRITE.*sans USAGE\(\*OUTPUT\)/);
  ref('*input', 'exfmt fmt01;', /EXFMT.*sans USAGE\(\*OUTPUT\)/);
  ref('*output', 'read fmt01;', /READ.*sans USAGE\(\*INPUT\)/);
  ref('*output', 'exfmt fmt01;', /EXFMT.*sans USAGE\(\*INPUT\)/);
  assert.deepEqual(runScreens('dcl-f ecran workstn usage(*output); write fmt01; dsply 1;', SAISIE(), []).output, ['1']);
  assert.deepEqual(runScreens('dcl-f ecran workstn usage(*input:*output); exfmt fmt01; dsply 1;', SAISIE(), [{ format: 'FMT01' }]).output, ['1']);
});

test('appel C : fin en erreur, fichiers ouverts seulement', () => {
  const log = [];
  const ctx = { tables: {}, programs: {}, displays: deuxEcrans() };
  assert.throws(() => run('dcl-f e1 workstn; dcl-s a int(10); dcl-s b int(10); b = 1 / a;', ctx, { screens: journal(log) }), /zéro|division/i);
  assert.deepEqual(log, ['O', 'C']);
  log.length = 0;
  run('dcl-f e1 workstn; dcl-f e2 workstn; dsply 1;', ctx, { screens: journal(log) });
  assert.deepEqual(log, ['O', 'O', 'C', 'C']);
});

test('appel C : échec de O du 2e écran, le 1er est fermé', () => {
  const log = [];
  let n = 0;
  const screens = () => { const id = ++n; return { call(p) { log.push(`${id}${p.option}`); if (id === 2 && p.option === 'O') { p.status = '2'; p.message = 'KO'; } } }; };
  assert.throws(() => run('dcl-f e1 workstn; dcl-f e2 workstn;', { tables: {}, programs: {}, displays: deuxEcrans() }, { screens }), /KO/);
  assert.deepEqual(log, ['1O', '2O', '1C']);
});

test('appel C : l erreur d origine l emporte sur un échec de C', () => {
  const screens = () => ({ call(p) { if (p.option === 'C') { p.status = '2'; p.message = 'C KO'; } } });
  const ctx = { tables: {}, programs: {}, displays: deuxEcrans() };
  assert.throws(() => run('dcl-f e1 workstn; dcl-s a int(10); dcl-s b int(10); b = 1 / a;', ctx, { screens }), err => !/C KO/.test(err.message));
});

test('OPEN, CLOSE et %OPEN sur un fichier écran : refus explicite', () => {
  for (const code of ['open ecran;', 'close ecran;', 'dsply %open(ecran);']) {
    assert.throws(() => runScreens(`dcl-f ecran workstn; ${code}`, SAISIE(), []),
      /sur un fichier écran \(ECRAN\)( : pas encore supporté)?/i, code);
  }
});
