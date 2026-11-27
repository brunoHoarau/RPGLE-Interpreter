// Files : %KDS, %FIELDS et paramètre DS résultat
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
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

test('DS résultat d une lecture : paramètre CONST refusé à l analyse', () => {
  assert.throws(() => run(CHAIN_DANS_PARAM('const'), context()), /d est un paramètre CONST/i);
  assert.throws(() => run(CHAIN_DANS_PARAM('const', 'read client d;'), context()), /paramètre CONST/i);
});

test('DS résultat d une lecture : paramètre VALUE accepté (copie locale)', () => {
  const out = run(CHAIN_DANS_PARAM('value'), context());
  assert.equal(out.length, 1);
});
