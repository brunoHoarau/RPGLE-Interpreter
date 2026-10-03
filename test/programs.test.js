// Appels de programmes et procédures externes (dcl-pr EXTPGM / EXTPROC)
// simulés par des bouchons décrits dans context/programs.json
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { run, runRaw } = require('./helpers');
const { loadContextFromFolder } = require('../out/context');

const withPrograms = programs => ({ tables: {}, files: {}, programs });

const PROTO = `
  dcl-pr verifier extpgm('VERIF');
    code char(10) const;
    resultat packed(10:2);
  end-pr;
  dcl-s c char(10) inz('A1');
  dcl-s r packed(10:2);
`;

test('DSPLY accepte un message entre parenthèses', () => {
  assert.deepEqual(run(`dsply ('a' + 'b');`), ['ab']);
});

test('sans bouchon, l\'appel échoue avec le statut 00211 interceptable', () => {
  const out = run(`${PROTO}
    monitor;
      verifier(c: r);
      dsply 'appel reussi';
    on-error 00211;
      dsply 'introuvable ' + %char(%status());
    endmon;
  `);
  assert.deepEqual(out, ['introuvable 211']);
});

test('sans bouchon ni MONITOR, l\'erreur nomme le programme et programs.json', () => {
  assert.throws(() => run(`${PROTO} verifier(c: r);`), err =>
    /VERIF/.test(err.message) && /programs\.json/.test(err.message));
});

test('un bouchon renvoie un paramètre de sortie', () => {
  const out = run(`${PROTO}
    verifier(c: r);
    dsply %char(r);
  `, withPrograms({ VERIF: { calls: [{ set: { resultat: 12.5 } }] } }));
  assert.deepEqual(out, ['12.50']);
});

test('le nom du bouchon est insensible à la casse, comme les noms de paramètres', () => {
  const out = run(`${PROTO} verifier(c: r); dsply %char(r);`,
    withPrograms({ verif: { calls: [{ set: { RESULTAT: 3 } }] } }));
  assert.deepEqual(out, ['3.00']);
});

test('la valeur renvoyée est convertie au type du paramètre', () => {
  const out = run(`${PROTO} verifier(c: r); dsply %char(r);`,
    withPrograms({ VERIF: { calls: [{ set: { resultat: 1500.456 } }] } }));
  assert.deepEqual(out, ['1500.45']);
});

test('le premier cas dont les conditions correspondent est appliqué', () => {
  const programs = {
    VERIF: {
      calls: [
        { when: { code: 'ZZ' }, set: { resultat: 1 } },
        { when: { code: 'A1' }, set: { resultat: 2 } },
        { set: { resultat: 3 } },
      ],
    },
  };
  assert.deepEqual(run(`${PROTO} verifier(c: r); dsply %char(r);`, withPrograms(programs)), ['2.00']);
  assert.deepEqual(run(`${PROTO} c = 'B2'; verifier(c: r); dsply %char(r);`, withPrograms(programs)), ['3.00']);
});

test('aucun cas correspondant est une erreur de configuration explicite', () => {
  assert.throws(
    () => run(`${PROTO} verifier(c: r);`, withPrograms({ VERIF: { calls: [{ when: { code: 'ZZ' } }] } })),
    err => /VERIF/.test(err.message) && /aucun cas/i.test(err.message) && /A1/.test(err.message));
});

test('un bouchon peut simuler une erreur du programme appelé (statut 00202)', () => {
  const out = run(`${PROTO}
    monitor;
      verifier(c: r);
    on-error 00202;
      dsply 'echec ' + %char(%status());
    endmon;
  `, withPrograms({ VERIF: { calls: [{ error: 'code inconnu' }] } }));
  assert.deepEqual(out, ['echec 202']);
});

test('un bouchon ne peut pas renvoyer un paramètre CONST', () => {
  assert.throws(
    () => run(`${PROTO} verifier(c: r);`, withPrograms({ VERIF: { calls: [{ set: { code: 'X' } }] } })),
    /CONST/);
});

test('un paramètre inconnu dans le bouchon est une erreur', () => {
  assert.throws(
    () => run(`${PROTO} verifier(c: r);`, withPrograms({ VERIF: { calls: [{ set: { inconnu: 1 } }] } })),
    /inconnu/);
});

test('le nombre de paramètres est vérifié selon le prototype', () => {
  assert.throws(() => run(`${PROTO} verifier(c);`, withPrograms({ VERIF: { calls: [{}] } })), /paramètre/i);
});

test('EXTPGM sans nom désigne le programme du même nom que le prototype', () => {
  const out = run(`
    dcl-pr calcul extpgm;
      n packed(5:0);
    end-pr;
    dcl-s x packed(5:0);
    calcul(x);
    dsply %char(x);
  `, withPrograms({ CALCUL: { calls: [{ set: { n: 7 } }] } }));
  assert.deepEqual(out, ['7']);
});

test('une procédure externe (EXTPROC) renvoie une valeur', () => {
  const out = run(`
    dcl-pr calcTva packed(9:2) extproc('CALCTVA');
      montant packed(9:2) const;
    end-pr;
    dsply %char(calcTva(100));
  `, withPrograms({ CALCTVA: { calls: [{ when: { montant: 100 }, return: 20 }] } }));
  assert.deepEqual(out, ['20.00']);
});

test('un prototype sans EXTPGM ni EXTPROC appelle la procédure interne si elle existe', () => {
  const out = run(`
    dcl-pr double int(10);
      n int(10) value;
    end-pr;
    dsply %char(double(4));
    dcl-proc double;
      dcl-pi *n int(10);
        n int(10) value;
      end-pi;
      return n * 2;
    end-proc;
  `);
  assert.deepEqual(out, ['8']);
});

test('chaque appel bouchonné est tracé dans la sortie', () => {
  const output = runRaw(`${PROTO} verifier(c: r);`, withPrograms({ VERIF: { calls: [{ set: { resultat: 1 } }] } }));
  assert.ok(output.some(line => /VERIF/.test(line) && /code/i.test(line) && /A1/.test(line)), output.join('\n'));
});

// --- Chargement de context/programs.json ---

test('programs.json est chargé avec tables.json', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rpgle-prg-'));
  fs.writeFileSync(path.join(dir, 'programs.json'), '{ "verif": { "calls": [ { "set": { "x": 1 } } ] } }');
  const ctx = loadContextFromFolder(dir);
  assert.deepEqual(ctx.programs.VERIF, { calls: [{ set: { x: 1 } }] });
});

test('un bouchon sans liste "calls" est une erreur qui nomme le programme', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rpgle-prg-'));
  fs.writeFileSync(path.join(dir, 'programs.json'), '{ "VERIF": { "set": {} } }');
  assert.throws(() => loadContextFromFolder(dir), err => /VERIF/.test(err.message) && /calls/.test(err.message));
});
