// Ecrans : WRITE, READ, EXFMT
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
const INDARA = () => {
  const d = SAISIE();
  d.ECRAN.indara = true;
  return d;
};

test('EXFMT : ENTER affecte les zones saisies', () => {
  const { output, shown } = runScreens(`
    dcl-f ecran workstn;
    code = 'A1';
    lib = 'LIBELLE';
    exfmt fmt01;
    dsply code;
    dsply qte;
    dsply lib;
  `, SAISIE(), [{ format: 'FMT01', fields: { CODE: 'ZZ9', QTE: '1,5' } }]);
  assert.deepEqual(output, ['ZZ9', '1.5', 'LIBELLE']);
  assert.equal(shown[0].fields.find(f => f.name === 'LIB').value.trim(), 'LIBELLE');
});

test('EXFMT : nom de format en minuscules, déclaré en majuscules', () => {
  const { output } = runScreens(`dcl-f ecran workstn; exfmt FmT01; dsply 'ok';`, SAISIE(), [{ format: 'FMT01' }]);
  assert.deepEqual(output, ['ok']);
});

test('EXFMT : CF05 positionne *IN05, saisies transmises', () => {
  const { output } = runScreens(`
    dcl-f ecran workstn;
    exfmt fmt01;
    if *in05;
      dsply 'F5';
    endif;
    dsply code;
  `, SAISIE(), [{ format: 'FMT01', key: 'F5', fields: { CODE: 'XX' } }]);
  assert.deepEqual(output, ['F5', 'XX']);
});

test('EXFMT : CA03 laisse les variables inchangées et positionne *IN03', () => {
  const { output } = runScreens(`
    dcl-f ecran workstn;
    code = 'AVANT';
    exfmt fmt01;
    dsply code;
    if *in03;
      dsply 'F3';
    endif;
  `, SAISIE(), [{ format: 'FMT01', key: 'F3', fields: { CODE: 'NOUVEAU' } }]);
  assert.deepEqual(output, ['AVANT', 'F3']);
});

test('WRITE puis READ : deux appels séparés', () => {
  const { output, shown } = runScreens(`
    dcl-f ecran workstn;
    code = 'C1';
    write fmt01;
    dsply 'écrit';
    read fmt01;
    dsply code;
  `, SAISIE(), [{ format: 'FMT01', fields: { CODE: 'C2' } }]);
  assert.deepEqual(output, ['écrit', 'C2']);
  assert.equal(shown.length, 1);
});

test('EXFMT : constante conditionnée par un indicateur positionné par la touche précédente', () => {
  const { shown } = runScreens(`
    dcl-f ecran workstn;
    dow '1' = '1';
      exfmt fmt01;
      if not *in05;
        leave;
      endif;
    enddo;
  `, SAISIE(), [{ format: 'FMT01', key: 'F5' }, { format: 'FMT01' }]);
  assert.deepEqual(shown[0].constants.map(c => c.text), ['Normal']);
  assert.deepEqual(shown[1].constants.map(c => c.text), ['Normal', 'Cinq']);
});

test('EXFMT : *IN31 écrit par le programme conditionne l\'affichage', () => {
  const { shown } = runScreens(`
    dcl-f ecran workstn;
    *in31 = *on;
    exfmt fmt01;
  `, SAISIE(), [{ format: 'FMT01' }]);
  assert.deepEqual(shown[0].constants.map(c => c.text), ['Rafraichi']);
});

test('EXFMT avec INDDS : indicateurs par position, positions sans sous-zone conservées', () => {
  const { output, shown } = runScreens(`
    dcl-ds ind qualified;
      exit ind pos(3);
      refresh ind pos(5);
      erreur ind pos(31);
    end-ds;
    dcl-f ecran workstn indds(ind);
    ind.erreur = *on;
    exfmt fmt01;
    if ind.refresh;
      dsply 'refresh';
    endif;
    if *in05;
      dsply 'in05';
    endif;
    if ind.erreur;
      dsply 'erreur';
    endif;
  `, INDARA(), [{ format: 'FMT01', key: 'F5' }]);
  assert.deepEqual(shown[0].constants.map(c => c.text), ['Rafraichi']);
  assert.deepEqual(output, ['refresh', 'erreur']);
});

test('INDDS : indicateur de réponse hors DS gardé pour le W suivant', () => {
  // CF05 -> indicateur 05 sans sous-zone ; renvoyé au W suivant, la constante if 05 reste cohérente
  const d = displaysFrom({ ECRAN: { indara: true, keys: { CA03: '03' }, formats: {
    F1: { keys: { CF05: '05' }, fields: [] },
    F2: { constants: [{ row: 1, col: 1, text: 'Cinq', if: '05' }], fields: [] },
  } } });
  const { shown } = runScreens(`
    dcl-ds ind qualified; exit ind pos(3); end-ds;
    dcl-f ecran workstn indds(ind);
    exfmt f1;
    exfmt f2;
  `, d, [{ format: 'F1', key: 'F5' }, { format: 'F2' }]);
  assert.deepEqual(shown[1].constants.map(c => c.text), ['Cinq']);
});

test('EXFMT : valeur négative aller-retour', () => {
  const { output } = runScreens(`
    dcl-f ecran workstn;
    qte = -12.5;
    exfmt fmt01;
    dsply qte;
  `, SAISIE(), [{ format: 'FMT01' }]);
  assert.deepEqual(output, ['-12.5']);
});

test('écran : statut 2 à W ou R : erreur d\'exécution', () => {
  const screens = () => ({ call(p) {
    if (p.option === 'W') { p.status = '2'; p.error = 1299; p.message = 'ça casse'; }
  } });
  assert.throws(() => run('dcl-f ecran workstn; write fmt01;', { tables: {}, programs: {}, displays: SAISIE() }, { screens }),
    /fichier écran ECRAN : ça casse \(erreur 01299\)/);
  const screensR = () => ({ call(p) { if (p.option === 'R') { p.status = '2'; p.error = 5; p.message = 'lecture'; } } });
  assert.throws(() => run('dcl-f ecran workstn; read fmt01;', { tables: {}, programs: {}, displays: SAISIE() }, { screens: screensR }),
    /fichier écran ECRAN : lecture \(erreur 00005\)/);
});

test('écran : READ sans WRITE : erreur du simulateur', () => {
  assert.throws(() => runScreens('dcl-f ecran workstn; read fmt01;', SAISIE(), []), /aucun écran affiché/);
});

test('écran : opérations refusées', () => {
  const NS = " : pas encore supporté par l'interpréteur";
  const refuse = (code, message) => assert.throws(() => runScreens(`dcl-f ecran workstn; dcl-ds d qualified; x char(1); end-ds; ${code}`, SAISIE(), [{ format: 'FMT01' }]),
    err => err.message === message + NS || err.message === message + NS + ' (ligne 1)', code);
  const nom = 'sur le fichier écran ECRAN : un nom de format est attendu';
  refuse('write ecran;', 'WRITE ' + nom);
  refuse('read ecran;', 'READ ' + nom);
  refuse('exfmt ecran;', 'EXFMT ' + nom);
  refuse('chain 1 fmt01;', 'CHAIN sur le format écran FMT01');
  refuse('update fmt01;', 'UPDATE sur le format écran FMT01');
  refuse('delete fmt01;', 'DELETE sur le format écran FMT01');
  refuse('setll 1 fmt01;', 'SETLL sur le format écran FMT01');
  const plus = 'sur le format écran FMT01 avec un extenseur, une clé ou une structure de données';
  refuse('read(e) fmt01;', 'READ ' + plus);
  refuse('write fmt01 d;', 'WRITE ' + plus);
  refuse('open ecran;', 'OPEN sur un fichier écran (ECRAN)');
  refuse('close ecran;', 'CLOSE sur un fichier écran (ECRAN)');
  const exfmt = 'EXFMT avec une clé, un extenseur ou un opérande de plus (seul EXFMT format; est supporté)';
  refuse('exfmt fmt01 d;', exfmt);
  refuse('exfmt(e) fmt01;', exfmt);
  refuse('exfmt 1 fmt01;', exfmt);
});

test('EXFMT sur un fichier base : erreur', () => {
  const ctx = { tables: { CLIENT: { columns: [{ name: 'NOM', type: 'char(10)' }], data: [] } }, programs: {} };
  assert.throws(() => runScreens('dcl-f client; dcl-f ecran workstn; exfmt client;', SAISIE(), [], ctx), /EXFMT.*fichier écran/i);
});
