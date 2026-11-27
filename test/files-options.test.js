// Files : RENAME, PREFIX, EXTFILE, (E) et %ERROR
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
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

// --- Incrément 3a ---


test('RENAME : lecture par le nouveau format', () => {
  assert.deepEqual(run(`dcl-f film rename(film:ffilm) keyed; read ffilm; dsply titre;`, ctx3()), ['Alien']);
});

test('RENAME : WRITE sur le nouveau nom, ancien refusé avant exécution, premier argument contrôlé', () => {
  const c = ctx3();
  run(`dcl-f client rename(clientf:rcli) usage(*output); numcli = 9; clnom = 'Neuf'; write rcli;`, c);
  assert.equal(c.tables.CLIENT.data.length, 3);
  // Branche jamais exécutée : seul un contrôle avant exécution peut la refuser
  assert.throws(() => run(`dcl-f client rename(clientf:rcli) usage(*output); if 1 = 0; write clientf; endif;`, ctx3()), /CLIENTF/);
  assert.throws(() => run(`dcl-f client rename(autre:rcli);`, ctx3()), /AUTRE.*format/i);
});

test('PREFIX : zones préfixées en lecture et en écriture', () => {
  const c = ctx3();
  const out = run(`
    dcl-f client prefix(c_) usage(*update) keyed;
    chain 1 client;
    dsply c_clnom;
    c_clnom = 'Modifie';
    update clientf;
  `, c);
  assert.deepEqual(out, ['Dupont']);
  assert.equal(c.tables.CLIENT.data[0].CLNOM, 'Modifie');
  assert.deepEqual(run(`dcl-f client prefix('X':2) keyed; chain 2 client; dsply xnom;`, ctx3()), ['Martin']);
  assert.throws(() => run(`dcl-f client prefix(x:9) keyed;`, ctx3()), NOT_SUPPORTED);
});

test('EXTFILE et EXTDESC', () => {
  assert.deepEqual(run(`dcl-f client extfile('MABIB/ARCHIVE') keyed; read client; dsply clnom;`, ctx3()), ['Ancien']);
  assert.deepEqual(run(`dcl-f arch extdesc('CLIENT') extfile(*extdesc) keyed; read arch; dsply clnom;`, ctx3()), ['Dupont']);
  assert.throws(() => run(`dcl-f client extfile('AUTRE') keyed;`, ctx3()), /zones/i);
});

test('READE sans clé', () => {
  const out = run(`
    dcl-f cde keyed;
    chain 1 cde;
    dow not %eof(cde);
      dsply lib;
      reade cde;
    enddo;
  `, ctx3());
  assert.deepEqual(out, ['a', 'b']);
  assert.throws(() => run(`dcl-f cde keyed; reade cde;`, ctx3()), NOT_SUPPORTED);
});

test('READ(N) : pas d\'enregistrement courant', () => {
  const out = run(`
    dcl-f client usage(*update) keyed;
    read(n) client;
    monitor;
      update clientf;
    on-error 01221;
      dsply 'pas courant';
    endmon;
  `, ctx3());
  assert.deepEqual(out, ['pas courant']);
});

test('(E) et %ERROR', () => {
  const out = run(`
    dcl-f client usropn usage(*output : *input) keyed;
    chain(e) 1 client;
    if %error;
      dsply 'erreur ' + %char(%status);
    endif;
    open client;
    chain 1 client;
    if %error;
      dsply 'inchange';
    endif;
    chain(e) 1 client;
    if not %error and %found(client);
      dsply clnom;
    endif;
    numcli = 1;
    write(e) clientf;
    if %error;
      dsply 'doublon ' + %char(%status);
    endif;
  `, ctx3());
  assert.deepEqual(out, ['erreur 1211', 'inchange', 'Dupont', 'doublon 1021']);
});

test('(E) : %ERROR à *OFF au départ, ligne [JOBLOG], (EN) combinés', () => {
  assert.deepEqual(run(`dcl-f client keyed; if not %error; dsply 'off'; endif;`, ctx3()), ['off']);
  const raw = runRaw(`dcl-f client usropn keyed; read(e) client;`, ctx3());
  assert.ok(raw.some(line => /^\[JOBLOG\].*RNX1211/.test(line)), raw.join('\n'));
  assert.deepEqual(run(`
    dcl-f client usage(*update) keyed;
    chain(ne) 2 client;
    if not %error;
      dsply clnom;
    endif;
    update(e) clientf;
    if %error;
      dsply %char(%status);
    endif;
  `, ctx3()), ['Martin', '1221']);
});

test('(E) : les refus « pas encore supporté » et les autres erreurs traversent', () => {
  assert.throws(() => run(`dcl-f cde keyed; reade(e) cde;`, ctx3()), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-f client usage(*update) keyed; close(e) client; close(e) client;`, ctx3()), NOT_SUPPORTED);
});

test('UNLOCK(E) : erreur interceptée, réussite remet %ERROR à *OFF', () => {
  const out = run(`
    dcl-f client usropn usage(*update) keyed;
    unlock(e) client;
    if %error;
      dsply 'erreur ' + %char(%status);
    endif;
    open client;
    chain 1 client;
    unlock(e) client;
    if not %error;
      dsply 'ok';
    endif;
  `, ctx3());
  assert.deepEqual(out, ['erreur 1211', 'ok']);
});

test('%ERROR : indicateur global, le même dans les procédures', () => {
  const out = run(`
    dcl-f client usropn keyed;
    chain(e) 1 client;
    dsply lit();
    open client;
    marque();
    if not %error;
      dsply 'remis';
    endif;
    dcl-proc lit;
      dcl-pi *n char(3);
      end-pi;
      if %error;
        return 'oui';
      endif;
      return 'non';
    end-proc;
    dcl-proc marque;
      chain(e) 2 client;
    end-proc;
  `, ctx3());
  assert.deepEqual(out, ['oui', 'remis']);
});

// --- Incrément 3a : corrections de relecture ---


test('(E) : %STATUS remis à 0 au début de l\'opération', () => {
  assert.deepEqual(run(`
    dcl-f client usropn keyed;
    chain(e) 1 client;
    dsply %char(%status);
    open client;
    chain(e) 1 client;
    dsply %char(%status);
  `, ctx3()), ['1211', '0']);
});

test('format inconnu ou renommé : refusé avant exécution pour toute opération', () => {
  for (const op of ['read clientf;', 'readp clientf;', 'reade 1 clientf;', 'readpe 1 clientf;', 'chain 1 clientf;',
    'setll 1 clientf;', 'setgt 1 clientf;', 'open clientf;', 'close clientf;']) {
    assert.throws(() => run(`dcl-f client rename(clientf:rcli) keyed usropn; if 1 = 0; ${op} endif; dsply 'ok';`, ctx3()),
      /CLIENTF/, op);
  }
  assert.throws(() => run(`dcl-f client keyed; if 1 = 0; chain 1 inconnu; endif; dsply 'ok';`, ctx3()), /INCONNU/);
  assert.deepEqual(run(`dcl-f client rename(clientf:rcli) keyed; if 1 = 0; read rcli; endif; dsply 'ok';`, ctx3()), ['ok']);
});

test('deux DCL-F avec le même nom de format : RENAME nécessaire', () => {
  assert.throws(() => run(`dcl-f client usage(*output); dcl-f arch extdesc('CLIENT') extfile('ARCHIVE') usage(*output);`, ctx3()),
    /CLIENTF.*RENAME/);
  assert.throws(() => run(`dcl-f film rename(film:ffilm); dcl-f client rename(clientf:film);`, ctx3()), /FILM.*RENAME/);
  const c = ctx3();
  run(`dcl-f client usage(*output);
       dcl-f arch extdesc('CLIENT') extfile('ARCHIVE') rename(clientf:rarch) usage(*output);
       numcli = 8; clnom = 'Archive'; write rarch;`, c);
  assert.equal(c.tables.ARCHIVE.data.length, 2);
  assert.equal(c.tables.CLIENT.data.length, 2);
});

test('PREFIX : deux zones du même fichier avec le même nom de variable refusées', () => {
  const c = ctx3();
  c.tables.DUO = { keys: ['ABC'], columns: [{ name: 'ABC', type: 'char(1)' }, { name: 'XBC', type: 'char(1)' }], data: [] };
  assert.throws(() => run(`dcl-f duo prefix(y:1);`, c), /YBC.*ABC.*XBC/);
});

test('EXTFILE / EXTDESC : le message nomme la première zone différente et les deux types', () => {
  const c = ctx3();
  c.tables.ARCH2 = { columns: [{ name: 'NUMCLI', type: 'DECIMAL(7,0)' }, { name: 'CLNOM', type: 'char(10)' }], data: [] };
  assert.throws(() => run(`dcl-f client extfile('ARCH2');`, c), err => /NUMCLI/.test(err.message)
    && /DECIMAL\(7,0\)/.test(err.message) && /packed\(7:0\)/.test(err.message));
  assert.throws(() => run(`dcl-f client extfile('AUTRE');`, ctx3()), /NUMCLI/);
});

test('(E) dans MONITOR : l\'erreur est traitée par (E), MONITOR non déclenché', () => {
  assert.deepEqual(run(`
    dcl-f client usropn keyed;
    monitor;
      chain(e) 1 client;
      dsply 'apres';
    on-error 01211;
      dsply 'monitor';
    endmon;
  `, ctx3()), ['apres']);
});
