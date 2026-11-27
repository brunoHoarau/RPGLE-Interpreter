// Files : opérations de fichier avec DS
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw } = require('./helpers');
function context() {
  return {
    programs: {},
    tables: {
      CLIENT: {
        format: 'CLIENTF',
        keys: ['NUMCLI'],
        columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'NOM', type: 'char(10)' },
                  { name: 'SOLDE', type: 'DECIMAL(9,2)' }, { name: 'CREE', type: 'date' }, { name: 'ACTIF', type: 'ind' }],
        data: [
          { NUMCLI: 3, NOM: 'Durand', SOLDE: 10, CREE: '2026-03-01', ACTIF: '1' },
          { NUMCLI: 1, NOM: 'Dupont', SOLDE: 1500.5, CREE: '2025-01-15', ACTIF: '1' },
          { NUMCLI: 2, NOM: 'Martin', SOLDE: 230, CREE: '2024-12-31', ACTIF: '0' },
        ],
      },
      CDE: {
        keys: ['NUMCLI', 'NUMCDE'],
        columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'NUMCDE', type: 'packed(5:0)' }, { name: 'LIB', type: 'char(10)' }],
        data: [
          { NUMCLI: 1, NUMCDE: 10, LIB: 'a' }, { NUMCLI: 2, NUMCDE: 5, LIB: 'b' },
          { NUMCLI: 1, NUMCDE: 7, LIB: 'c' }, { NUMCLI: 2, NUMCDE: 1, LIB: 'd' },
        ],
      },
      VRAC: { columns: [{ name: 'X', type: 'AUTO' }], data: [{ X: 1 }] },
    },
  };
}
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
function ctx3() {
  const clientCols = [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'CLNOM', type: 'char(10)' }];
  return {
    programs: {},
    tables: {
      FILM: { format: 'FILM', keys: ['ID'], columns: [{ name: 'ID', type: 'packed(5:0)' }, { name: 'TITRE', type: 'char(20)' }],
              data: [{ ID: 2, TITRE: 'Brazil' }, { ID: 1, TITRE: 'Alien' }] },
      CLIENT: { format: 'CLIENTF', keys: ['NUMCLI'], unique: true, columns: clientCols,
                data: [{ NUMCLI: 1, CLNOM: 'Dupont' }, { NUMCLI: 2, CLNOM: 'Martin' }] },
      ARCHIVE: { format: 'CLIENTF', keys: ['NUMCLI'], unique: true, columns: clientCols, data: [{ NUMCLI: 7, CLNOM: 'Ancien' }] },
      AUTRE: { keys: ['X'], columns: [{ name: 'X', type: 'int(10)' }], data: [] },
      CDE: { keys: ['NUMCLI'], columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'LIB', type: 'char(5)' }],
             data: [{ NUMCLI: 1, LIB: 'a' }, { NUMCLI: 1, LIB: 'b' }, { NUMCLI: 2, LIB: 'c' }] },
    },
  };
}

// --- 3b : opérations de fichier avec DS, %KDS, %FIELDS ---


test('READ dans une DS LIKEREC : les zones du programme ne changent pas', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    nom = 'Avant';
    read client cli;
    dsply %trim(nom) + '|' + %trim(cli.nom) + '|' + %char(cli.numcli) + '|' + %char(cli.cree : *iso);
  `, context()), ['Avant|Dupont|1|2025-01-15']);
});

test('boucle READ avec DS jusqu\'à %EOF, READP avec DS', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    read client cli;
    dow not %eof(client);
      dsply %trim(cli.nom);
      read client cli;
    enddo;
    readp client cli;
    dsply 'fin ' + %trim(cli.nom);
  `, context()), ['Dupont', 'Martin', 'Durand', 'fin Durand']);
});

test('CHAIN non trouvé laisse la DS inchangée, trouvé la remplit', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    cli.nom = 'Reste';
    chain 99 client cli;
    dsply %trim(cli.nom) + '|' + %char(%found(client));
    chain 2 client cli;
    dsply %trim(cli.nom) + '|' + %trim(nom);
  `, context()), ['Reste|0', 'Martin|']);
});

test('READE et READPE avec DS', () => {
  assert.deepEqual(run(`
    dcl-f cde keyed;
    dcl-ds c likerec(cdef);
    reade 1 cde c;
    dsply %trim(c.lib);
    setll 2 cde;
    readpe 1 cde c;
    dsply %trim(c.lib);
    reade 2 cde c;
    dsply %char(%eof(cde));
  `, context()), ['c', 'a', '0']);
});

test('WRITE depuis une DS *OUTPUT puis relecture, UPDATE depuis une DS *INPUT', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*update : *output) keyed;
    dcl-ds sortie likerec(clientf : *output);
    dcl-ds entree likerec(clientf : *input);
    numcli = 77;
    sortie.numcli = 3;
    sortie.nom = 'Nouveau';
    sortie.solde = 5;
    sortie.cree = d'2026-01-01';
    write clientf sortie;
    chain 3 client entree;
    dsply %trim(entree.nom) + '|' + %char(numcli);
    entree.nom = 'Change';
    entree.solde = 9.5;
    update clientf entree;
    chain 3 client;
    dsply %trim(nom) + '|' + %char(solde);
  `, c);
  assert.deepEqual(out, ['Nouveau|77', 'Change|9.50']);
  assert.equal(c.tables.CLIENT.data.length, 3);
});

test('DS *ALL acceptée pour READ, WRITE et UPDATE', () => {
  const c = wctx();
  assert.deepEqual(run(`
    dcl-f client usage(*update : *output) keyed;
    dcl-ds t likerec(clientf : *all);
    t.numcli = 8;
    t.nom = 'Tout';
    t.cree = d'2026-01-01';
    write clientf t;
    chain 8 client t;
    t.nom = 'Tout2';
    update clientf t;
    chain 8 client t;
    dsply %trim(t.nom);
  `, c), ['Tout2']);
});

test('LIKEDS d\'une DS LIKEREC *INPUT acceptée en lecture', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    dcl-ds c2 likeds(cli);
    chain 1 client c2;
    dsply %trim(c2.nom);
  `, context()), ['Dupont']);
});

test('EXTNAME avec type d\'extraction *INPUT accepté, sans type refusé, ordinaire refusé', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds e extname('CLIENT' : *input) qualified end-ds;
    chain 1 client e;
    dsply %trim(e.nom);
  `, context()), ['Dupont']);
  assert.throws(() => run(`
    dcl-f client keyed;
    dcl-ds e extname('CLIENT') qualified end-ds;
    chain 1 client e;
  `, context()), /compilateur/i);
  assert.throws(() => run(`
    dcl-f client keyed;
    dcl-ds d qualified;
      numcli packed(7:0);
      nom char(10);
    end-ds;
    chain 1 client d;
  `, context()), /compilateur/i);
});

test('EXTNAME sur un fichier RENAME : le format réel est reconnu', () => {
  assert.deepEqual(run(`
    dcl-f film rename(film:ffilm) keyed;
    dcl-ds e extname('FILM' : *input) qualified end-ds;
    read film e;
    dsply 'ok';
  `, ctx3()), ['ok']);
});

test('usage ou fichier incompatible avec l\'opération : erreur de compilation avant tout accès', () => {
  const head = `dcl-f client usage(*update : *output) keyed;
    dcl-ds o likerec(clientf : *output);
    dcl-ds i likerec(clientf : *input);
    dcl-ds k likerec(clientf : *key);\n`;
  assert.throws(() => run(head + 'read client o;', wctx()), /compilateur/i);
  assert.throws(() => run(head + 'chain 1 client k;', wctx()), /compilateur/i);
  assert.throws(() => run(head + 'write clientf i;', wctx()), /compilateur/i);
  assert.throws(() => run(head + 'chain 1 client i; update clientf o;', wctx()), /compilateur/i);
  assert.throws(() => run(head + 'write clientf k;', wctx()), /compilateur/i);
  // DS d'un autre fichier
  assert.throws(() => run(`dcl-f client keyed;
    dcl-f cde keyed;
    dcl-ds c likerec(cdef);
    read client c;`, context()), /compilateur/i);
});

test('UPDATE(E) avec DS sans lecture préalable : %ERROR et statut 01221', () => {
  assert.deepEqual(run(`
    dcl-f client usage(*update) keyed;
    dcl-ds e likerec(clientf);
    update(e) clientf e;
    dsply %char(%error) + ' ' + %char(%status);
  `, wctx()), ['1 1221']);
});
