// Files : EXTDESC, EXTFILE, RENAME et PREFIX : refus et corrections
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
const COLS3 = () => [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'CLNOM', type: 'char(10)' }];

// --- Incrément 3a : corrections de la relecture finale ---


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
