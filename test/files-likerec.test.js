// Files : DS LIKEREC / EXTNAME et paramètres LIKEREC
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
function ctxCle() {
  const c = ctx3();
  c.tables.ORDRE = { format: 'ORDREF', keys: ['C', 'A'], columns: [{ name: 'A', type: 'int(10)' }, { name: 'B', type: 'char(4)' }, { name: 'C', type: 'char(3)' }], data: [] };
  c.tables.SANSCLE = { columns: [{ name: 'A', type: 'int(10)' }], data: [] };
  return c;
}

// --- DS LIKEREC / EXTNAME (3b, tâche 2) ---


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
