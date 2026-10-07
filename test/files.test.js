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

// --- Incrément 2 : écriture ---

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

// --- Incrément 3a ---

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

// --- Incrément 3a : corrections de la relecture finale ---

const COLS3 = () => [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'CLNOM', type: 'char(10)' }];

test('EXTDESC sans EXTFILE : lignes lues et écrites dans la table du nom du fichier', () => {
  const withArch = () => {
    const c = ctx3();
    c.tables.ARCH = { format: 'CLIENTF', keys: ['NUMCLI'], unique: true, columns: COLS3(), data: [{ NUMCLI: 5, CLNOM: 'Arch' }] };
    return c;
  };
  assert.deepEqual(run(`dcl-f arch extdesc('CLIENT') rename(clientf:ra) keyed; read arch; dsply clnom;`, withArch()), ['Arch']);
  const c = withArch();
  run(`dcl-f arch extdesc('CLIENT') rename(clientf:ra) usage(*output); numcli = 9; clnom = 'Neuf'; write ra;`, c);
  assert.equal(c.tables.ARCH.data.length, 2);
  assert.equal(c.tables.CLIENT.data.length, 2);
  // EXTFILE(*EXTDESC) : données de la table de description
  assert.deepEqual(run(`dcl-f arch extdesc('CLIENT') extfile(*extdesc) keyed; read arch; dsply clnom;`, withArch()), ['Dupont']);
  // Table de données absente
  assert.throws(() => run(`dcl-f arch extdesc('CLIENT') rename(clientf:ra) keyed;`, ctx3()), /ARCH absent/);
});

test('EXTDESC / EXTFILE : ordre des zones exigé ; clés et unicité comparées seulement avec KEYED', () => {
  const c = ctx3();
  c.tables.NONUNI = { format: 'CLIENTF', keys: ['NUMCLI'], columns: COLS3(), data: [{ NUMCLI: 1, CLNOM: 'a' }, { NUMCLI: 1, CLNOM: 'b' }] };
  c.tables.PARNOM = { format: 'CLIENTF', keys: ['CLNOM'], unique: true, columns: COLS3(), data: [{ NUMCLI: 2, CLNOM: 'b' }, { NUMCLI: 1, CLNOM: 'a' }] };
  c.tables.INVERSE = { format: 'CLIENTF', keys: ['NUMCLI'], unique: true, columns: COLS3().reverse(), data: [] };
  const plain = re => err => !NOT_SUPPORTED.test(err.message) && re.test(err.message);
  // KEYED : chemin d'accès compilé sur EXTDESC, exécuté sur EXTFILE : non simulé
  assert.throws(() => run(`dcl-f client extfile('NONUNI') keyed;`, c), err => NOT_SUPPORTED.test(err.message) && /unicit.*NONUNI/i.test(err.message));
  assert.throws(() => run(`dcl-f client extfile('PARNOM') keyed;`, c), err => NOT_SUPPORTED.test(err.message) && /cl[ée]s.*CLNOM/i.test(err.message));
  // Sans KEYED : clés et unicité de la table de données, pas de contrôle
  assert.deepEqual(run(`dcl-f client extfile('PARNOM'); read client; dsply clnom;`, c), ['b']);
  const w = ctx3();
  w.tables.NONUNI = { format: 'CLIENTF', keys: ['NUMCLI'], columns: COLS3(), data: [{ NUMCLI: 1, CLNOM: 'a' }] };
  w.tables.UNI = { format: 'CLIENTF', keys: ['NUMCLI'], unique: true, columns: COLS3(), data: [{ NUMCLI: 1, CLNOM: 'a' }] };
  run(`dcl-f arch extdesc('CLIENT') extfile('NONUNI') rename(clientf:ra) usage(*output); numcli = 1; write ra;`, w);
  assert.equal(w.tables.NONUNI.data.length, 2);
  assert.deepEqual(run(`dcl-f arch extdesc('ARCHIVE') extfile('UNI') rename(clientf:ra) usage(*output);
    numcli = 1; write(e) ra; dsply %char(%status);`, w), ['1021']);
  assert.throws(() => run(`dcl-f client extfile('INVERSE');`, c), plain(/ordre des zones.*CPF4131/i));
});

test('DSPLY(E) : %ERROR à *OFF et %STATUS à 0, sortie inchangée', () => {
  const raw = runRaw(`dcl-f client usropn keyed; chain(e) 1 client; dsply(e) 'x'; dsply %char(%error) + ' ' + %char(%status);`, ctx3());
  assert.deepEqual(raw.filter(line => line.startsWith('[DSPLY')), ['[DSPLY] x', '[DSPLY] 0 0']);
});

test('format portant le nom du fichier : RENAME nécessaire', () => {
  assert.throws(() => run(`dcl-f film keyed;`, ctx3()), /FILM.*RENAME n[ée]cessaire/);
  assert.throws(() => run(`dcl-f client rename(clientf:client);`, ctx3()), /CLIENT.*RENAME n[ée]cessaire/);
  const c = ctx3();
  c.tables.CLIENTF = { format: 'CLIENTF', keys: ['NUMCLI'], unique: true, columns: COLS3(), data: [] };
  assert.throws(() => run(`dcl-f clientf extdesc('CLIENT');`, c), /CLIENTF.*RENAME n[ée]cessaire/);
});

test('RENAME vers un nom déjà utilisé : refusé', () => {
  assert.throws(() => run(`dcl-f film rename(film:ffilm); dcl-f client rename(clientf:film);`, ctx3()), /FILM/);
  assert.throws(() => run(`dcl-f film rename(film:ffilm); dcl-f client rename(clientf:ffilm);`, ctx3()), /FFILM/);
  assert.throws(() => run(`dcl-f client rename(clientf:clnom);`, ctx3()), /CLNOM.*zone/);
  assert.throws(() => run(`dcl-f client prefix(p_) rename(clientf:p_clnom);`, ctx3()), /P_CLNOM.*zone/);
  assert.deepEqual(run(`dcl-f client prefix(p_) rename(clientf:clnom); dsply 'ok';`, ctx3()), ['ok']);
  assert.throws(() => run(`dcl-f client rename(clientf:lib); dcl-f cde;`, ctx3()), /LIB.*zone/);
  assert.throws(() => run(`dcl-f client rename(clientf:rcli); dcl-s rcli char(1);`, ctx3()), /RCLI/);
  assert.throws(() => run(`dcl-f client rename(clientf:rcli); dcl-c rcli 1;`, ctx3()), /RCLI/);
  assert.throws(() => run(`dcl-f client rename(clientf:rcli); dcl-ds rcli; a char(1); end-ds;`, ctx3()), /RCLI/);
  assert.throws(() => run(`dcl-f client rename(clientf:rcli); dcl-ds ds; rcli char(1); end-ds;`, ctx3()), /RCLI/);
});

test('(E) : une erreur pendant l\'évaluation de la clé n\'est pas interceptée', () => {
  assert.throws(() => run(`
    dcl-f client keyed;
    dcl-f cde usropn keyed;
    chain(e) k() client;
    dsply 'suite';
    dcl-proc k;
      dcl-pi *n packed(7:0);
      end-pi;
      read cde;
      return 1;
    end-proc;
  `, ctx3()), /1211/);
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-f cde usropn keyed;
    monitor;
      chain(e) k() client;
    on-error 01211;
      dsply 'monitor';
    endmon;
    dcl-proc k;
      dcl-pi *n packed(7:0);
      end-pi;
      read cde;
      return 1;
    end-proc;
  `, ctx3()), ['monitor']);
});

test('PREFIX donnant un nom RPG invalide : refusé', () => {
  assert.throws(() => run(`dcl-f client prefix('9') keyed;`, ctx3()), err => !NOT_SUPPORTED.test(err.message) && /9NUMCLI/.test(err.message));
});

test('OPEN / CLOSE avec un nom de format : refusé avant exécution', () => {
  assert.throws(() => run(`dcl-f client usropn keyed; if 1 = 0; open clientf; endif; dsply 'ok';`, ctx3()), /OPEN.*CLIENT/);
  assert.throws(() => run(`dcl-f client keyed; if 1 = 0; close clientf; endif; dsply 'ok';`, ctx3()), /CLOSE.*CLIENT/);
});

test('EXTFILE / EXTDESC : nom en minuscules, vide ou mal formé refusé à l\'analyse', () => {
  for (const source of [`dcl-f client extfile('client');`, `dcl-f client extdesc('Client');`, `dcl-f client extfile('mabib/CLIENT');`]) {
    assert.throws(() => parse(source), err => !NOT_SUPPORTED.test(err.message) && /majuscules/.test(err.message), source);
  }
  for (const source of [`dcl-f client extfile('MABIB/');`, `dcl-f client extfile('');`, `dcl-f client extdesc('/CLIENT');`,
    `dcl-f client extfile('A/B/CLIENT');`]) {
    assert.throws(() => parse(source), err => !NOT_SUPPORTED.test(err.message) && /nom/i.test(err.message), source);
  }
  assert.doesNotThrow(() => parse(`dcl-f client extfile('*LIBL/CLIENT');`));
});

test('EXTDESC / EXTFILE : noms de format différents refusés (vérification de niveau)', () => {
  const c = ctx3();
  c.tables.ARCH = { keys: ['NUMCLI'], unique: true, columns: COLS3(), data: [] };
  assert.throws(() => run(`dcl-f arch extdesc('CLIENT') rename(clientf:ra);`, c),
    err => !NOT_SUPPORTED.test(err.message) && /format.*ARCHF.*CLIENTF.*CPF4131/i.test(err.message));
});

test('format non renommé portant le nom d\'une variable, constante, structure ou zone : refusé', () => {
  assert.throws(() => run(`dcl-f client; dcl-s clientf char(1);`, ctx3()), /CLIENTF/);
  assert.throws(() => run(`dcl-f client; dcl-c clientf 1;`, ctx3()), /CLIENTF/);
  assert.throws(() => run(`dcl-f client; dcl-ds clientf; a char(1); end-ds;`, ctx3()), /CLIENTF/);
  const c = ctx3();
  c.tables.AUTRE = { keys: ['CLIENTF'], columns: [{ name: 'CLIENTF', type: 'int(10)' }], data: [] };
  assert.throws(() => run(`dcl-f client; dcl-f autre;`, c), /CLIENTF.*zone/);
});

// --- DS LIKEREC / EXTNAME (3b, tâche 2) ---

function ctxCle() {
  const c = ctx3();
  c.tables.ORDRE = { format: 'ORDREF', keys: ['C', 'A'], columns: [{ name: 'A', type: 'int(10)' }, { name: 'B', type: 'char(4)' }, { name: 'C', type: 'char(3)' }], data: [] };
  c.tables.SANSCLE = { columns: [{ name: 'A', type: 'int(10)' }], data: [] };
  return c;
}

test('LIKEREC : sous-zones du format avec leurs types, valeurs par défaut', () => {
  const out = run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    dsply %char(cli.numcli) + '|' + %char(%len(cli.nom));
    cli.solde = 1.239;
    dsply %char(cli.solde);
    dsply %char(cli.cree: *iso);
  `, context());
  assert.deepEqual(out, ['0|10', '1.23', '0001-01-01']);
});

test('LIKEREC : les zones du programme ne sont pas modifiées par la DS', () => {
  const out = run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    cli.nom = 'Zoe';
    nom = 'Programme';
    dsply %trim(cli.nom) + ' ' + %trim(nom);
  `, context());
  assert.deepEqual(out, ['Zoe Programme']);
});

test('LIKEREC *KEY : zones de clé dans l\'ordre de la clé', () => {
  const src = `
    dcl-f ordre keyed;
    dcl-ds k likerec(ordref : *key);
    dcl-ds m qualified;
      x char(3);
      y int(10);
    end-ds;
    m = k;
    dsply 'ok';
  `;
  assert.deepEqual(run(src, ctxCle()), ['ok']);
  assert.throws(() => run(`dcl-f ordre keyed; dcl-ds k likerec(ordref : *key); k.b = 'x';`, ctxCle()), /b/i);
});

test('LIKEREC *KEY sur un fichier sans KEYED, format inconnu, nom de fichier au lieu du format : erreurs', () => {
  assert.throws(() => run(`dcl-f ordre; dcl-ds k likerec(ordref : *key);`, ctxCle()), /KEYED|clé/i);
  assert.throws(() => run(`dcl-f client keyed; dcl-ds k likerec(inconnu);`, context()), /INCONNU/);
  assert.throws(() => run(`dcl-f film rename(film:ffilm) keyed; dcl-ds k likerec(film);`, ctx3()), /FILM/);
});

test('LIKEREC sur un fichier RENAME', () => {
  assert.deepEqual(run(`
    dcl-f film rename(film:ffilm) keyed;
    dcl-ds f likerec(ffilm);
    f.titre = 'Alien';
    dsply %trim(f.titre);
  `, ctx3()), ['Alien']);
});

test('LIKEREC sur un fichier PREFIX : sous-zones préfixées', () => {
  assert.deepEqual(run(`
    dcl-f client prefix(c_) keyed;
    dcl-ds cli likerec(clientf);
    cli.c_clnom = 'Zoe';
    dsply %trim(cli.c_clnom);
  `, ctx3()), ['Zoe']);
  assert.throws(() => run(`
    dcl-f client prefix(c_) keyed;
    dcl-ds cli likerec(clientf);
    cli.clnom = 'Zoe';
  `, ctx3()), /clnom/i);
});

test('EXTNAME qualifiée : sous-zones de la table', () => {
  assert.deepEqual(run(`
    dcl-ds cli extname('CLIENT') qualified end-ds;
    cli.nom = 'Zoe';
    dsply %trim(cli.nom) + '|' + %char(cli.numcli);
  `, context()), ['Zoe|0']);
});

test('EXTNAME non qualifiée : sous-zones accessibles directement', () => {
  assert.deepEqual(run(`
    dcl-ds cli extname('CLIENT');
    end-ds;
    nom = 'Zoe';
    dsply %trim(cli.nom) + '|' + %trim(nom);
  `, context()), ['Zoe|Zoe']);
});

test('EXTNAME avec format et type d\'extraction', () => {
  assert.deepEqual(run(`
    dcl-ds k extname('ORDRE' : 'ORDREF' : *key) qualified end-ds;
    k.c = 'abc';
    dsply k.c;
  `, ctxCle()), ['abc']);
  assert.deepEqual(run(`dcl-ds a extname('AUTRE':'AUTREF') qualified end-ds; dsply %char(a.x);`, ctx3()), ['0']);
});

test('EXTNAME non qualifiée dont une sous-zone porte le nom d\'une zone de DCL-F : pas encore supporté', () => {
  assert.throws(() => run(`
    dcl-f client keyed;
    dcl-ds cli extname('CLIENT') end-ds;
  `, context()), NOT_SUPPORTED);
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli extname('CLIENT') qualified end-ds;
    dsply 'ok';
  `, context()), ['ok']);
});

test('EXTNAME : table absente, format faux, *KEY sur table sans clé : erreurs', () => {
  assert.throws(() => run(`dcl-ds x extname('ABSENT') qualified end-ds;`, context()), /absent de context\/tables\.json/);
  assert.throws(() => run(`dcl-ds x extname('CLIENT':'FAUX') qualified end-ds;`, context()), /format.*FAUX|FAUX.*format/i);
  assert.throws(() => run(`dcl-ds x extname('SANSCLE' : *key) qualified end-ds;`, ctxCle()), /clé|keys/i);
});

test('LIKEDS d\'une DS LIKEREC ou EXTNAME : mêmes sous-zones, copie a = b', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    dcl-ds c2 likeds(cli);
    cli.nom = 'Zoe';
    c2 = cli;
    dsply %trim(c2.nom);
  `, context()), ['Zoe']);
});

test('DS LIKEREC : *LOVAL sur une zone date acceptée, sur une zone non date refusée', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    cli.cree = *hival;
    dsply %char(cli.cree: *iso);
    if cli.cree = *hival;
      dsply 'egal';
    endif;
  `, context()), ['9999-12-31', 'egal']);
  assert.throws(() => run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    cli.nom = *loval;
  `, context()), NOT_SUPPORTED);
});

test('DS EXTNAME et LIKEDS : *LOVAL sur une zone date', () => {
  assert.deepEqual(run(`
    dcl-ds cli extname('CLIENT') qualified end-ds;
    dcl-ds c2 likeds(cli);
    c2.cree = *hival;
    dsply %char(c2.cree: *iso);
  `, context()), ['9999-12-31']);
});

test('paramètre LIKEREC CONST : argument de même format et même usage accepté, sous-zones lisibles', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    cli.nom = 'Zoe';
    lire(cli);
    dcl-proc lire;
      dcl-pi *n;
        p likerec(clientf) const;
      end-pi;
      dsply %trim(p.nom);
    end-proc;
  `, context()), ['Zoe']);
});

test('paramètre LIKEREC par référence : les modifications reviennent, une DS LIKEDS de la source est acceptée', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    dcl-ds c2 likeds(cli);
    maj(c2);
    dsply %trim(c2.nom);
    dcl-proc maj;
      dcl-pi *n;
        p likerec(clientf);
      end-pi;
      p.nom = 'Rendu';
    end-proc;
  `, context()), ['Rendu']);
});

test('paramètre LIKEREC : usage différent sans filiation (refus par référence, pas encore supporté en CONST)', () => {
  const src = mode => `
    dcl-f client keyed;
    dcl-ds cli likerec(clientf : *all);
    lire(cli);
    dcl-proc lire;
      dcl-pi *n;
        p likerec(clientf)${mode};
      end-pi;
    end-proc;
  `;
  assert.throws(() => run(src(''), context()), INCOMPATIBLE);
  assert.throws(() => run(src(' const'), context()), NOT_SUPPORTED);
});

test('paramètre LIKEREC : DS sans lien avec le format : sans filiation', () => {
  assert.throws(() => run(`
    dcl-f client keyed;
    dcl-ds x qualified;
      a char(1);
    end-ds;
    lire(x);
    dcl-proc lire;
      dcl-pi *n;
        p likerec(clientf) const;
      end-pi;
    end-proc;
  `, context()), NOT_SUPPORTED);
});

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

test('%KDS : clé complète, partielle, DS quelconque et nombre trop grand', () => {
  assert.deepEqual(run(`
    dcl-f cde keyed;
    dcl-ds cle qualified;
      a packed(7:0);
      b packed(5:0);
    end-ds;
    dcl-ds c likerec(cdef);
    cle.a = 1;
    cle.b = 7;
    chain %kds(cle) cde c;
    dsply %trim(c.lib);
    chain %kds(cle : 1) cde c;
    dsply %trim(c.lib) + '|' + %char(c.numcde);
    cle.a = 2;
    setll %kds(cle : 1) cde;
    read cde c;
    dsply %trim(c.lib);
  `, context()), ['c', 'c|7', 'd']);
  assert.throws(() => run(`
    dcl-f cde keyed;
    dcl-ds cle qualified;
      a packed(7:0);
    end-ds;
    chain %kds(cle : 2) cde;
  `, context()), /%KDS/);
});

test('%KDS sur une DS LIKEREC *KEY, SETLL puis READE avec %KDS, trop de valeurs refusé', () => {
  assert.deepEqual(run(`
    dcl-f cde keyed;
    dcl-ds k likerec(cdef : *key);
    dcl-ds c likerec(cdef);
    k.numcli = 2;
    setll %kds(k : 1) cde;
    reade %kds(k : 1) cde c;
    dsply %trim(c.lib);
    reade %kds(k : 1) cde c;
    dsply %trim(c.lib);
    reade %kds(k : 1) cde c;
    dsply %char(%eof(cde));
  `, context()), ['d', 'b', '1']);
  assert.throws(() => run(`
    dcl-f client keyed;
    dcl-ds k qualified;
      a packed(7:0);
      b packed(7:0);
    end-ds;
    chain %kds(k) client;
  `, context()), /clé/i);
});

test('DELETE avec %KDS', () => {
  const c = wctx();
  run(`
    dcl-f client usage(*delete) keyed;
    dcl-ds k qualified;
      n packed(7:0);
    end-ds;
    k.n = 2;
    delete %kds(k) client;
  `, c);
  assert.equal(c.tables.CLIENT.data.length, 1);
});

test('%FIELDS sans DS : seules les zones citées sont réécrites', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*update) keyed;
    chain 1 client;
    nom = 'Modifie';
    solde = 999;
    update clientf %fields(solde);
    chain 1 client;
    dsply %trim(nom) + '|' + %char(solde);
  `, c);
  assert.deepEqual(out, ['Dupont|999.00']);
});

test('%FIELDS avec DS : sous-zones qualifiées de la DS résultat', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*update) keyed;
    dcl-ds ent likerec(clientf);
    chain 2 client ent;
    ent.nom = 'Perdu';
    ent.solde = 12;
    update clientf ent %fields(ent.solde);
    chain 2 client;
    dsply %trim(nom) + '|' + %char(solde);
  `, c);
  assert.deepEqual(out, ['Martin|12.00']);
});

test('%FIELDS : zone inconnue refusée, mélanges pas encore supportés', () => {
  const head = `dcl-f client usage(*update) keyed;
    dcl-ds ent likerec(clientf);
    dcl-ds autre likerec(clientf);
    chain 1 client ent;\n`;
  assert.throws(() => run(head + 'update clientf %fields(inconnue);', wctx()), /INCONNUE/);
  assert.throws(() => run(head + 'update clientf ent %fields(ent.inconnue);', wctx()), /INCONNUE/);
  assert.throws(() => run(head + 'update clientf %fields(ent.solde);', wctx()), NOT_SUPPORTED);
  assert.throws(() => run(head + 'update clientf ent %fields(solde);', wctx()), NOT_SUPPORTED);
  assert.throws(() => run(head + 'update clientf ent %fields(autre.solde);', wctx()), NOT_SUPPORTED);
});

test('bout en bout : lecture dans une DS LIKEREC, procédure à paramètre LIKEREC CONST, DS LIKEDS globale', () => {
  const ctx = {
    programs: {},
    tables: {
      FILM: {
        format: 'FILM',
        columns: [{ name: 'CATEGORIE', type: 'char(15)' }, { name: 'LIBELLE', type: 'char(30)' },
                  { name: 'VUES', type: 'packed(10:0)' }],
        data: [
          { CATEGORIE: 'Action', LIBELLE: 'Film A', VUES: 120 },
          { CATEGORIE: 'Comedie', LIBELLE: 'Film B', VUES: 4500 },
          { CATEGORIE: 'Drame', LIBELLE: 'Film C', VUES: 900 },
        ],
      },
    },
  };
  const out = run(`
    dcl-f film rename(film:ffilm);
    dcl-ds curFilm likerec(ffilm);
    dcl-ds meilleur likeds(curFilm);
    read film curFilm;
    dow not %eof;
      garder(curFilm);
      read film curFilm;
    enddo;
    dsply meilleur.categorie;
    dsply meilleur.libelle;
    dsply %char(meilleur.vues);
    dsply %char(vues);
    dsply %trim(categorie) + '|';
    dcl-proc garder;
      dcl-pi *n;
        p_film likerec(ffilm) const;
      end-pi;
      if p_film.vues > meilleur.vues;
        meilleur = p_film;
      endif;
    end-proc;
  `, ctx);
  assert.deepEqual(out, ['Comedie', 'Film B', '4500', '0', '|']);
});

const CHAIN_DANS_PARAM = (option, corps = 'chain 1 client d;\n    dsply d.nom;') => `
    dcl-f client keyed;
    dcl-ds cli likerec(clientf);
    dcl-proc p;
      dcl-pi *n;
        d likeds(cli) ${option};
      end-pi;
      ${corps}
    end-proc;
    p(cli);
  `;

test('DS résultat d une lecture : paramètre CONST refusé à l analyse', () => {
  assert.throws(() => run(CHAIN_DANS_PARAM('const'), context()), /d est un paramètre CONST/i);
  assert.throws(() => run(CHAIN_DANS_PARAM('const', 'read client d;'), context()), /paramètre CONST/i);
});

test('DS résultat d une lecture : paramètre VALUE accepté (copie locale)', () => {
  const out = run(CHAIN_DANS_PARAM('value'), context());
  assert.equal(out.length, 1);
});
