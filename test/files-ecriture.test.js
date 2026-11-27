// Files : WRITE, UPDATE, DELETE, verrous
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

// --- Incrément 2 : écriture ---


test('boucle READ / UPDATE puis relecture', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*update) keyed;
    read client;
    dow not %eof(client);
      solde += 10;
      update clientf;
      read client;
    enddo;
    setll *start client;
    read client;
    dow not %eof(client);
      dsply %trim(nom) + ' ' + %char(solde);
      read client;
    enddo;
  `, c);
  assert.deepEqual(out, ['Dupont 110.00', 'Martin 60.00']);
  assert.equal(c.tables.CLIENT.data[0].SOLDE, 110);
});

test('WRITE puis relecture native et SQL', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*input : *output) keyed;
    dcl-s n packed(9:2);
    numcli = 3;
    nom = 'Durand';
    solde = 5;
    cree = D'2026-10-05';
    write clientf;
    clear_zones();
    chain 3 client;
    dsply %trim(nom) + ' ' + %char(cree);
    exec sql select solde into :n from client where numcli = 3;
    dsply %char(n);
    dcl-proc clear_zones;
      nom = *blanks;
      cree = D'0001-01-01';
    end-proc;
  `, c);
  assert.deepEqual(out, ['Durand 2026-10-05', '5.00']);
  assert.deepEqual(c.tables.CLIENT.data[2], { NUMCLI: 3, NOM: 'Durand', SOLDE: 5, CREE: '2026-10-05' });
});

test('DELETE courant, DELETE par clé, %FOUND', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*delete) keyed;
    chain 1 client;
    delete clientf;
    delete 9 clientf;
    if not %found(client);
      dsply 'absent';
    endif;
    read client;
    dsply nom;
  `, c);
  assert.deepEqual(out, ['absent', 'Martin']);
  assert.equal(c.tables.CLIENT.data.length, 1);
});

test('statuts 01221 et 01021 interceptés', () => {
  const out = run(`
    dcl-f client usage(*update : *output) keyed;
    monitor;
      update clientf;
    on-error 01221;
      dsply 'pas de lecture ' + %char(%status);
    endmon;
    numcli = 2;
    nom = 'Doublon';
    monitor;
      write clientf;
    on-error 01021;
      dsply 'doublon ' + %char(%status);
    endmon;
    chain 1 client;
    update clientf;
    monitor;
      update clientf;
    on-error 01221;
      dsply 'deja mis a jour';
    endmon;
  `, wctx());
  assert.deepEqual(out, ['pas de lecture 1221', 'doublon 1021', 'deja mis a jour']);
});

test('format, USAGE et clé modifiée : erreurs', () => {
  assert.throws(() => run(`dcl-f client usage(*output); write client;`, wctx()), /format CLIENTF/i);
  assert.throws(() => run(`dcl-f client keyed; read client; update clientf;`, wctx()), /USAGE/i);
  assert.throws(() => run(`dcl-f client usage(*update) keyed; read client; delete clientf;`, wctx()), /USAGE/i);
  assert.throws(() => run(`dcl-f client keyed; write clientf;`, wctx()), /USAGE/i);
  assert.throws(() => run(`dcl-f client usage(*update) keyed; read client; numcli = 5; update clientf; read client;`, wctx()), NOT_SUPPORTED);
});

test('SQL sur un enregistrement verrouillé : pas encore supporté', () => {
  assert.throws(() => run(`
    dcl-f client usage(*update) keyed;
    chain 1 client;
    exec sql update client set solde = 0 where numcli = 1;
  `, wctx()), NOT_SUPPORTED);
  const c = wctx();
  run(`dcl-f client keyed; chain 1 client; exec sql update client set solde = 0 where numcli = 1;`, c);
  assert.equal(c.tables.CLIENT.data[0].SOLDE, 0);
});

test('deux programmes et un enregistrement verrouillé', () => {
  const callee = `dcl-f client usage(*update) keyed; chain 1 client; dsply 'lu';`;
  const options = { resolveProgram: name => (name === 'AUTRE' ? { source: callee } : undefined) };
  assert.throws(() => run(`
    dcl-pr autre extpgm('AUTRE') end-pr;
    dcl-f client usage(*update) keyed;
    chain 1 client;
    autre();
  `, wctx(), options), NOT_SUPPORTED);
  const out = run(`
    dcl-pr autre extpgm('AUTRE') end-pr;
    dcl-f client usage(*update) keyed;
    chain 1 client;
    unlock client;
    autre();
    autre();
    chain 1 client;
    dsply 'appelant';
  `, wctx(), options);
  assert.deepEqual(out, ['lu', 'lu', 'appelant']);
});

// --- Corrections après relecture finale ---


test('WRITE/UPDATE depuis une procédure : zones globales, pas les variables locales de même nom', () => {
  const c = wctx();
  run(`
    dcl-f client usage(*update : *output) keyed;
    numcli = 3;
    nom = 'Global';
    solde = 1;
    cree = D'2026-01-01';
    ajoute();
    chain 1 client;
    nom = 'Maj';
    maj();
    numcli = 4;
    nom = 'Global4';
    ajoute_int();
    dcl-proc ajoute;
      dcl-s nom char(10) inz('Local');
      write clientf;
    end-proc;
    dcl-proc maj;
      dcl-s nom char(10) inz('Local');
      update clientf;
    end-proc;
    dcl-proc ajoute_int;
      dcl-s nom int(10) inz(5);
      write clientf;
    end-proc;
  `, c);
  assert.equal(c.tables.CLIENT.data[0].NOM, 'Maj');
  assert.deepEqual(c.tables.CLIENT.data.slice(2).map(r => r.NOM), ['Global', 'Global4']);
});
