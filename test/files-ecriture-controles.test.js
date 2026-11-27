// Files : VARCHAR, DELETE par clé, clés uniques, contrôles avant exécution
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
function wctx() {
  return {
    programs: {},
    tables: {
      CLIENT: {
        format: 'CLIENTF', keys: ['NUMCLI'], unique: true,
        columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'NOM', type: 'char(10)' },
                  { name: 'SOLDE', type: 'packed(9:2)' }, { name: 'CREE', type: 'date' }],
        data: [
          { NUMCLI: 1, NOM: 'Dupont', SOLDE: 100, CREE: '2025-01-15' },
          { NUMCLI: 2, NOM: 'Martin', SOLDE: 50, CREE: '2024-12-31' },
        ],
      },
    },
  };
}
function vctx() {
  const c = wctx();
  c.tables.CLIENT.columns.push({ name: 'LIBRE', type: 'varchar(10)' });
  c.tables.CLIENT.data.forEach(row => { row.LIBRE = 'x'; });
  return c;
}

test('VARCHAR : la valeur écrite garde ses blancs de fin (natif et SQL)', () => {
  const c = vctx();
  const out = run(`
    dcl-f client usage(*input : *output) keyed;
    dcl-s v varchar(10);
    numcli = 3;
    nom = 'x  ';
    libre = 'ab  ';
    write clientf;
    libre = '';
    chain 3 client;
    dsply %char(%len(libre));
    exec sql select libre into :v from client where numcli = 3;
    dsply %char(%len(v));
    v = 'cd  ';
    exec sql insert into client (numcli, nom, solde, cree, libre) values (4, 'y', 0, '2026-01-01', :v);
    chain 4 client;
    dsply %char(%len(libre));
  `, c);
  assert.deepEqual(out, ['4', '4', '4']);
  assert.equal(c.tables.CLIENT.data[2].LIBRE, 'ab  ');
  assert.equal(c.tables.CLIENT.data[2].NOM, 'x');
  assert.equal(c.tables.CLIENT.data[3].LIBRE, 'cd  ');
});

test('VARCHAR : donnée de tables.json plus longue que la zone, blancs compris : erreur', () => {
  const c = vctx();
  c.tables.CLIENT.data[0].LIBRE = 'abcdefghij ';
  assert.throws(() => run(`dcl-f client keyed; read client;`, c), /zone LIBRE = 'abcdefghij ' \(ne tient pas dans varchar\(10\)\)/);
});

test('DELETE par clé : plus d\'enregistrement courant, position perdue', () => {
  assert.throws(() => run(`
    dcl-f client usage(*delete) keyed;
    read client;
    delete 2 clientf;
    read client;
  `, wctx()), NOT_SUPPORTED);
  assert.throws(() => run(`
    dcl-f client usage(*delete) keyed;
    chain 1 client;
    delete 2 clientf;
    update clientf;
  `, wctx()), /UPDATE de CLIENTF sans nouvelle lecture.*pas encore supporté/);
  assert.throws(() => run(`
    dcl-f client usage(*delete) keyed;
    chain 1 client;
    delete 2 clientf;
    delete clientf;
  `, wctx()), NOT_SUPPORTED);
  const c = wctx();
  const out = run(`
    dcl-f client usage(*delete) keyed;
    chain 1 client;
    delete 2 clientf;
    exec sql update client set solde = 0 where numcli = 1;
    setll *start client;
    read client;
    dsply nom;
  `, c);
  assert.deepEqual(out, ['Dupont']);
  assert.equal(c.tables.CLIENT.data[0].SOLDE, 0);
});

test('clés uniques en SQL : SQLCOD -803, rien n\'est modifié', () => {
  const c = wctx();
  const out = run(`
    exec sql insert into client (numcli, nom, solde, cree) values (1, 'X', 0, '2026-01-01');
    dsply %char(sqlcod) + ' ' + sqlstt;
    exec sql update client set numcli = 2, nom = 'Y' where numcli = 1;
    dsply %char(sqlcod) + ' ' + sqlstt;
    exec sql update client set numcli = 7;
    dsply %char(sqlcod) + ' ' + sqlstt;
    exec sql update client set numcli = numcli + 10;
    dsply %char(sqlcod);
  `, c);
  assert.deepEqual(out, ['-803 23505', '-803 23505', '-803 23505', '0']);
  assert.deepEqual(c.tables.CLIENT.data.map(r => [r.NUMCLI, r.NOM]), [[11, 'Dupont'], [12, 'Martin']]);
  // Sans "unique" : doublons permis
  const d = wctx();
  delete d.tables.CLIENT.unique;
  run(`exec sql insert into client (numcli, nom, solde, cree) values (1, 'X', 0, '2026-01-01');`, d);
  assert.equal(d.tables.CLIENT.data.length, 3);
});

test('clé en double dans tables.json sur une table unique : erreur au DCL-F', () => {
  const c = wctx();
  c.tables.CLIENT.data[1].NUMCLI = 1;
  assert.throws(() => run(`dcl-f client keyed;`, c), /Fichier CLIENT : clé en double dans tables\.json \(NUMCLI = 1\)/);
  assert.throws(() => run(`dcl-f client;`, c), /clé en double/);
  delete c.tables.CLIENT.unique;
  assert.deepEqual(run(`dcl-f client keyed; dsply 'ok';`, c), ['ok']);
});

test('WRITE, UPDATE, DELETE, UNLOCK contrôlés avant l\'exécution, même jamais exécutés', () => {
  const { Interpreter } = require('../out/interpreter');
  const cases = [
    [`dcl-f client keyed; dsply 'avant'; if 1 = 2; write clientf; endif;`, /USAGE/],
    [`dcl-f client usage(*output); dsply 'avant'; if 1 = 2; write client; endif;`, /format CLIENTF/],
    [`dcl-f client usage(*update) keyed; dsply 'avant'; if 1 = 2; delete clientf; endif;`, /USAGE/],
    [`dcl-f client keyed; dsply 'avant'; dcl-proc p; update clientf; end-proc;`, /USAGE/],
    [`dcl-f client usage(*update) keyed; dsply 'avant'; if 1 = 2; update zzz; endif;`, /ZZZ inconnu/],
    [`dcl-f client usage(*update) keyed; dsply 'avant'; if 1 = 2; unlock zzz; endif;`, /ZZZ/],
  ];
  for (const [src, expected] of cases) {
    const interpreter = new Interpreter(wctx());
    assert.throws(() => interpreter.execute(parse(src)), expected, src);
    assert.deepEqual(interpreter.runtime.getOutput(), [], src);
  }
});

test('UNLOCK sans *UPDATE, UPDATE/DELETE après WRITE ou UPDATE en échec : pas encore supporté', () => {
  assert.throws(() => run(`dcl-f client keyed; read client; unlock client;`, wctx()), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-f client usage(*output); unlock client;`, wctx()), NOT_SUPPORTED);
  assert.throws(() => run(`
    dcl-f client usage(*update : *output) keyed;
    chain 1 client;
    numcli = 3;
    write clientf;
    update clientf;
  `, wctx()), NOT_SUPPORTED);
  assert.throws(() => run(`
    dcl-f client usage(*delete : *output) keyed;
    chain 1 client;
    numcli = 3;
    write clientf;
    delete clientf;
  `, wctx()), NOT_SUPPORTED);
  assert.throws(() => run(`
    dcl-f client usage(*update) keyed;
    chain 1 client;
    numcli = 2;
    monitor;
      update clientf;
    on-error 01021;
      dsply 'doublon';
    endmon;
    numcli = 1;
    update clientf;
  `, wctx()), NOT_SUPPORTED);
  // Après une nouvelle lecture : de nouveau permis
  const c = wctx();
  const out = run(`
    dcl-f client usage(*update : *output) keyed;
    chain 1 client;
    numcli = 3;
    write clientf;
    chain 1 client;
    nom = 'Relu';
    update clientf;
    chain 1 client;
    numcli = 2;
    monitor;
      update clientf;
    on-error 01021;
      dsply 'doublon';
    endmon;
    chain 1 client;
    nom = 'Relu2';
    update clientf;
  `, c);
  assert.deepEqual(out, ['doublon']);
  assert.equal(c.tables.CLIENT.data[0].NOM, 'Relu2');
  assert.equal(c.tables.CLIENT.data.length, 3);
});
