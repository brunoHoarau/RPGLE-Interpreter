// Fichiers natifs : programmes RPG lisant les données simulées de tables.json
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

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

test('boucle READ / DOW NOT %EOF dans l\'ordre des clés', () => {
  const out = run(`
    dcl-f client keyed;
    read client;
    dow not %eof(client);
      dsply %char(numcli) + ' ' + %trim(nom) + ' ' + %char(solde);
      read client;
    enddo;
  `, context());
  assert.deepEqual(out, ['1 Dupont 1500.50', '2 Martin 230.00', '3 Durand 10.00']);
});

test('fichier sans KEYED : ordre d\'arrivée ; READ par nom de format', () => {
  const out = run(`
    dcl-f client;
    read clientf;
    dsply nom;
    read client;
    dsply nom;
  `, context());
  assert.deepEqual(out, ['Durand', 'Dupont']);
});

test('CHAIN / %FOUND ; zones inchangées si non trouvé ; types date et ind', () => {
  const out = run(`
    dcl-f client keyed;
    chain 2 client;
    if %found(client);
      dsply %trim(nom) + ' ' + %char(cree);
    endif;
    if not actif;
      dsply 'inactif';
    endif;
    chain 9 client;
    if not %found;
      dsply 'absent ' + %trim(nom);
    endif;
  `, context());
  assert.deepEqual(out, ['Martin 2024-12-31', 'inactif', 'absent Martin']);
});

test('SETLL / READE sur une clé partielle ; %EQUAL', () => {
  const out = run(`
    dcl-f cde keyed;
    dcl-s cli packed(7:0) inz(2);
    setll cli cde;
    if %equal(cde);
      reade cli cde;
      dow not %eof(cde);
        dsply %char(numcde) + lib;
        reade cli cde;
      enddo;
    endif;
    chain (1 : 7) cde;
    dsply lib;
  `, context());
  assert.deepEqual(out, ['1d', '5b', 'c']);
});

test('SETGT / READPE et READP depuis *END', () => {
  const out = run(`
    dcl-f cde keyed;
    dcl-f client keyed;
    setgt 1 cde;
    readpe 1 cde;
    dsply lib;
    setll *end client;
    readp client;
    dsply nom;
    setll *loval client;
    read client;
    dsply nom;
  `, context());
  assert.deepEqual(out, ['a', 'Durand', 'Dupont']);
});

test('USROPN : statut 01211 avant OPEN, 01215 si déjà ouvert, %OPEN', () => {
  const out = run(`
    dcl-f client keyed usropn;
    monitor;
      read client;
    on-error 01211;
      dsply 'ferme ' + %char(%status);
    endmon;
    if not %open(client);
      open client;
    endif;
    read client;
    dsply nom;
    monitor;
      open client;
    on-error 01215;
      dsply 'deja ouvert';
    endmon;
    close client;
    open client;
    read client;
    dsply nom;
  `, context());
  assert.deepEqual(out, ['ferme 1211', 'Dupont', 'deja ouvert', 'Dupont']);
  assert.throws(() => run(`dcl-f client usropn; read client;`, context()), /RNX1211/);
});

test('mêmes données que le SQL', () => {
  const out = run(`
    dcl-f client keyed;
    read client;
    exec sql insert into client (numcli, nom, solde, cree, actif) values (0, 'Avant', 0, '2026-01-01', '1');
    exec sql insert into client (numcli, nom, solde, cree, actif) values (4, 'Apres', 0, '2026-01-01', '1');
    dow not %eof(client);
      dsply nom;
      read client;
    enddo;
  `, context());
  assert.deepEqual(out, ['Dupont', 'Martin', 'Durand', 'Apres']);
});

test('erreurs de déclaration et de clé', () => {
  assert.throws(() => run(`dcl-f absent;`, context()), /ABSENT.*tables\.json/i);
  assert.throws(() => run(`dcl-f vrac;`, context()), /VRAC.*schema/i);
  assert.throws(() => run(`dcl-f vrac keyed;`, context()), /VRAC/i);
  assert.throws(() => run(`dcl-s nom packed(5:0); dcl-f client;`, context()), INCOMPATIBLE);
  assert.throws(() => run(`dcl-f client keyed; chain 'x' client;`, context()), INCOMPATIBLE);
  assert.throws(() => run(`dcl-f client keyed; chain 9 client; read client;`, context()), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-f client keyed; read autref;`, context()), /AUTREF.*inconnu/i);
});

test('un programme appelé lit les mêmes données avec sa propre position', () => {
  const callee = `dcl-f client keyed; read client; dsply 'appele ' + nom;`;
  const out = run(`
    dcl-pr suivant extpgm('SUIVANT') end-pr;
    dcl-f client keyed;
    read client;
    read client;
    suivant();
    dsply 'appelant ' + nom;
  `, context(), { resolveProgram: name => (name === 'SUIVANT' ? { source: callee } : undefined) });
  assert.deepEqual(out, ['appele Dupont', 'appelant Martin']);
});

test('décisions complémentaires : type inconnu, %EOF sans fichier, erreurs propagées', () => {
  const ctx = context();
  ctx.tables.BIZARRE = { columns: [{ name: 'NOM', type: 'blob' }], data: [] };
  assert.throws(() => run(`dcl-f bizarre;`, ctx), /BIZARRE.*'blob'.*NOM.*inconnu/i);
  assert.throws(() => run(`dow not %eof(); enddo;`, context()), /%EOF sans fichier déclaré/);
  assert.throws(() => run(`dcl-f client keyed; read client; read client; read client; read client; read client;`, context()), NOT_SUPPORTED);
});

test('lecture dans une procédure : les zones du fichier sont globales', () => {
  const out = run(`
    dcl-f client keyed;
    dcl-proc lire;
      dcl-s nom char(5) inz('loc');
      read client;
      dsply 'local ' + nom;
    end-proc;
    dcl-proc lire2;
      read client;
    end-proc;
    lire();
    dsply 'global ' + nom;
    lire2();
    dsply 'global ' + nom;
  `, context());
  assert.deepEqual(out, ['local loc', 'global Dupont', 'global Martin']);
});

test('zone de fichier portant le nom d\'un paramètre ou d\'une variable du programme', () => {
  const ctx = context();
  const callee = `dcl-pi *n; nom char(10); end-pi; dcl-f client keyed; dsply nom;`;
  assert.throws(() => run(`
    dcl-pr sp extpgm('SP'); nom char(10); end-pr;
    dcl-s x char(10) inz('a');
    sp(x);
  `, ctx, { resolveProgram: n => (n === 'SP' ? { source: callee } : undefined) }),
  /NOM porte le nom d'une zone du fichier CLIENT : pas encore supporté/);
  assert.throws(() => run(`dcl-f client; dcl-s nom char(10);`, context()), /NOM porte le nom d'une zone du fichier CLIENT : pas encore supporté/);
  assert.throws(() => run(`dcl-f client; dcl-ds d; nom char(10); end-ds;`, context()), /NOM porte le nom d'une zone du fichier CLIENT : pas encore supporté/);
});

test('OPEN remet %EOF à faux', () => {
  const out = run(`
    dcl-f client keyed;
    setll *end client;
    readp client;
    readp client;
    readp client;
    readp client;
    if %eof(client);
      dsply 'eof';
    endif;
    close client;
    open client;
    if not %eof(client);
      dsply 'plus eof';
    endif;
  `, context());
  assert.deepEqual(out, ['eof', 'plus eof']);
});

test('changement de sens : READP après deux READ relit le premier', () => {
  const out = run(`
    dcl-f client keyed;
    read client;
    read client;
    readp client;
    dsply nom;
    chain 2 client;
    read client;
    dsply nom;
    chain 2 client;
    readp client;
    dsply nom;
  `, context());
  assert.deepEqual(out, ['Dupont', 'Durand', 'Dupont']);
});

test('changement de sens après suppression SQL de l\'enregistrement lu', () => {
  const out = run(`
    dcl-f client keyed;
    read client;
    read client;
    exec sql delete from client where numcli = 2;
    read client;
    dsply nom;
    readp client;
    dsply nom;
  `, context());
  assert.deepEqual(out, ['Durand', 'Dupont']);
});

test('UPDATE SQL d\'une zone clé : nouvel ordre vu par la lecture suivante', () => {
  const out = run(`
    dcl-f client keyed;
    read client;
    exec sql update client set numcli = 0 where numcli = 3;
    exec sql update client set numcli = 9 where numcli = 2;
    read client;
    dsply %char(numcli) + ' ' + nom;
    readp client;
    readp client;
    dsply %char(numcli) + ' ' + nom;
  `, context());
  assert.deepEqual(out, ['9 Martin', '0 Durand']);
});

test('SETLL, SETGT et CHAIN trouvé remettent %EOF(fichier) à faux, pas %EOF', () => {
  const out = run(`
    dcl-f client keyed;
    read client;
    dow not %eof(client);
      read client;
    enddo;
    setll *loval client;
    if not %eof(client) and %eof;
      dsply 'setll';
    endif;
    read client;
    dow not %eof(client);
      dsply nom;
      read client;
    enddo;
    setgt 0 client;
    if not %eof(client);
      dsply 'setgt';
    endif;
    setll *end client;
    readp client;
    readp client;
    readp client;
    readp client;
    chain 2 client;
    if not %eof(client) and %eof;
      dsply 'chain';
    endif;
  `, context());
  assert.deepEqual(out, ['setll', 'Dupont', 'Martin', 'Durand', 'setgt', 'chain']);
});

test('CHAIN non trouvé : %EOF(fichier) inconnu jusqu\'à la prochaine lecture', () => {
  assert.throws(() => run(`
    dcl-f client keyed;
    chain 9 client;
    if %eof(client);
    endif;
  `, context()), /%EOF\(CLIENT\) après un CHAIN non trouvé : pas encore supporté/);
  const out = run(`
    dcl-f client keyed;
    chain 9 client;
    if not %eof;
      dsply 'eof sans argument inchangé';
    endif;
    setll 1 client;
    if not %eof(client);
      dsply 'connu';
    endif;
  `, context());
  assert.deepEqual(out, ['eof sans argument inchangé', 'connu']);
});

test('clé du programme qui ne tient pas dans la zone clé', () => {
  assert.throws(() => run(`dcl-f client keyed; chain 2.5 client;`, context()), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-f client keyed; chain 100000002 client;`, context()), NOT_SUPPORTED);
  const ctx = context();
  ctx.tables.CODES = { keys: ['CODE'], columns: [{ name: 'CODE', type: 'char(5)' }], data: [{ CODE: 'ABCDE' }] };
  assert.throws(() => run(`dcl-f codes keyed; chain 'ABCDEF' codes;`, ctx), NOT_SUPPORTED);
});

test('même nom qu\'une zone de fichier : même type non supporté, autre type refusé', () => {
  assert.throws(() => run(`dcl-f client; dcl-s nom char(10);`, context()),
    /NOM porte le nom d'une zone du fichier CLIENT : pas encore supporté/);
  assert.throws(() => run(`dcl-f client; dcl-ds d; nom char(10); end-ds;`, context()),
    /NOM porte le nom d'une zone du fichier CLIENT : pas encore supporté/);
  assert.throws(() => run(`dcl-f client; dcl-ds d; nom char(12); end-ds;`, context()), INCOMPATIBLE);
  assert.throws(() => run(`dcl-f client; dcl-s nom char(12);`, context()), INCOMPATIBLE);
  assert.throws(() => run(`dcl-f client; dcl-ds nom; x char(1); end-ds;`, context()), /NOM est déjà déclaré \(zone du fichier CLIENT\)/);
  assert.throws(() => run(`dcl-f client; dcl-c nom 'x';`, context()), /NOM est déjà déclaré \(zone du fichier CLIENT\)/);
  const call = (pi) => run(`
    dcl-pr sp extpgm('SP'); nom char(10); end-pr;
    dcl-s x char(10) inz('a');
    sp(x);
  `, context(), { resolveProgram: n => (n === 'SP' ? { source: `dcl-pi *n; ${pi}; end-pi; dcl-f client keyed; dsply nom;` } : undefined) });
  assert.throws(() => call('nom char(10)'), /NOM porte le nom d'une zone du fichier CLIENT : pas encore supporté/);
  assert.throws(() => call('nom char(12)'), INCOMPATIBLE);
});

test('CHAIN sur un fichier sans clé : numéro d\'enregistrement', () => {
  assert.deepEqual(run(`dcl-f client; chain 2 client; dsply nom;`, context()), ['Dupont']);
  assert.throws(() => run(`dcl-f client; chain 'x' client;`, context()), INCOMPATIBLE);
  assert.throws(() => run(`dcl-f client; chain (1 : 2) client;`, context()), INCOMPATIBLE);
  assert.throws(() => run(`dcl-f client; chain 1.5 client;`, context()), NOT_SUPPORTED);
  for (const op of ['setll 1 client;', 'setgt 1 client;', 'reade 1 client;', 'readpe 1 client;']) {
    assert.throws(() => run(`dcl-f client; ${op}`, context()), NOT_SUPPORTED, op);
  }
});

test('CHAIN par rang après insertion puis suppression SQL : refusé', () => {
  assert.throws(() => run(`
    dcl-f client;
    exec sql insert into client (numcli, nom, solde, cree, actif) values (4, 'c', 0, '2026-01-01', '1');
    exec sql insert into client (numcli, nom, solde, cree, actif) values (5, 'd', 0, '2026-01-01', '1');
    exec sql delete from client where numcli = 4;
    chain 3 client;
  `, context()), NOT_SUPPORTED);
  // Suppression faite avant la déclaration du fichier (programme appelant)
  const callee = `dcl-f client; chain 1 client; dsply nom;`;
  assert.throws(() => run(`
    dcl-pr sp extpgm('SP') end-pr;
    exec sql delete from client where numcli = 1;
    sp();
  `, context(), { resolveProgram: n => (n === 'SP' ? { source: callee } : undefined) }), NOT_SUPPORTED);
});

test('INSERT SQL sans toutes les colonnes : valeurs par défaut IBM i', () => {
  const ctx = context();
  ctx.tables.CLIENT.columns.push({ name: 'TEMPS', type: 'time' }, { name: 'HORO', type: 'timestamp' },
    { name: 'LIBRE', type: 'varchar(20)' });
  ctx.tables.CLIENT.data.forEach(row => Object.assign(row, { TEMPS: '10.00.00', HORO: '2026-01-01-10.00.00.000000', LIBRE: 'x' }));
  const out = run(`
    dcl-f client keyed;
    exec sql insert into client (numcli, nom) values (4, 'D');
    chain 4 client;
    dsply %char(solde) + ' ' + %char(cree) + ' ' + %char(temps) + ' ' + %char(horo) + ' [' + libre + ']';
    if not actif;
      dsply 'inactif';
    endif;
  `, ctx);
  assert.deepEqual(out, ['.00 0001-01-01 00.00.00 0001-01-01-00.00.00.000000 []', 'inactif']);
  const row = ctx.tables.CLIENT.data.find(r => r.NUMCLI === 4);
  assert.equal(row.NOM, 'D');
  assert.equal(row.ACTIF, '0');
  assert.equal(row.SOLDE, 0);
});

test('donnée de tables.json qui ne tient pas dans sa zone : erreur', () => {
  const tooManyDecimals = context();
  tooManyDecimals.tables.CLIENT.data[1].SOLDE = 1.234;
  assert.throws(() => run(`dcl-f client keyed; read client;`, tooManyDecimals),
    /Donnée invalide dans le fichier CLIENT : zone SOLDE = '1.234' \(ne tient pas dans packed\(9:2\)\)/);
  const tooBig = context();
  tooBig.tables.CLIENT.data[1].SOLDE = '12345678.5';
  assert.throws(() => run(`dcl-f client keyed; read client;`, tooBig), /zone SOLDE = '12345678.5' \(ne tient pas dans packed\(9:2\)\)/);
  const tooLong = context();
  tooLong.tables.CLIENT.data[1].NOM = 'Dupont-Durand';
  assert.throws(() => run(`dcl-f client keyed; read client;`, tooLong), /zone NOM = 'Dupont-Durand' \(ne tient pas dans char\(10\)\)/);
});

test('CLOSE d\'un fichier déjà fermé : non supporté', () => {
  assert.throws(() => run(`dcl-f client usropn; close client;`, context()), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-f client; close client; close client;`, context()), NOT_SUPPORTED);
});

test('DISK(*EXT) accepté, autre argument de DISK refusé', () => {
  assert.deepEqual(run(`dcl-f client disk(*ext) keyed; read client; dsply nom;`, context()), ['Dupont']);
  assert.throws(() => parse(`dcl-f client disk(100);`), /DISK\(100\) de DCL-F : pas encore supporté/);
});

test('performance : boucle de lecture sur 3 000 enregistrements', () => {
  const ctx = context();
  ctx.tables.CLIENT.data = [];
  for (let i = 3000; i >= 1; i--) ctx.tables.CLIENT.data.push({ NUMCLI: i, NOM: 'n', SOLDE: 0, CREE: '2026-01-01', ACTIF: '1' });
  const started = Date.now();
  const out = run(`
    dcl-f client keyed;
    dcl-s n int(10);
    read client;
    dow not %eof(client);
      n += 1;
      read client;
    enddo;
    dsply %char(n);
  `, ctx);
  assert.deepEqual(out, ['3000']);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
});
