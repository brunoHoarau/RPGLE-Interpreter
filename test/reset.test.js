// RESET : valeur de fin d'initialisation (INZ, puis *INZSR) ; tableaux, éléments, DS, indicateurs, procédures, refus
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
const CTX = { tables: { CLIENT: { format: 'CLIENTF', keys: ['NUMCLI'], columns: [{ name: 'NUMCLI', type: 'int(10)' }, { name: 'NOM', type: 'char(10)' }], data: [] } } };

test('RESET d une variable : valeur INZ ; sans INZ, valeur par défaut du type', () => {
  assert.deepEqual(run(`
    dcl-s c char(5) inz('abc');
    dcl-s n packed(7:2) inz(5.5);
    dcl-s v varchar(10);
    dcl-s i ind inz(*on);
    c = 'xy';
    n = 1;
    v = 'zz';
    i = *off;
    reset c;
    reset n;
    reset v;
    reset i;
    dsply c;
    dsply %char(n);
    dsply %char(%len(v));
    dsply i;
  `), ['abc', '5.50', '0', 'true']);
});

test('RESET : valeur à la fin de *INZSR, pas la valeur INZ', () => {
  assert.deepEqual(run(`
    dcl-s x int(10) inz(1);
    dcl-s y int(10) inz(2);
    x = 99;
    y = 99;
    reset x;
    reset y;
    dsply %char(x);
    dsply %char(y);
    *inlr = *on;
    begsr *inzsr;
      x = 10;
    endsr;
  `), ['10', '2']);
});

test('RESET pendant *INZSR : erreur 00109', () => {
  assert.throws(() => run(`
    dcl-s x int(10) inz(1);
    *inlr = *on;
    begsr *inzsr;
      reset x;
    endsr;
  `), /RNX0109|00109/);
  assert.deepEqual(run(`
    dcl-s x int(10) inz(1);
    *inlr = *on;
    begsr *inzsr;
      monitor;
        reset x;
      on-error 109;
        dsply 'interceptée';
      endmon;
    endsr;
  `), ['interceptée']);
});

test('RESET pendant *INZSR, appel indirect : sous-routine, procédure ; permis après', () => {
  assert.throws(() => run(`
    dcl-s x int(10) inz(1);
    *inlr = *on;
    begsr *inzsr;
      exsr init;
    endsr;
    begsr init;
      reset x;
    endsr;
  `), /RNX0109/);
  assert.throws(() => run(`
    dcl-s x int(10) inz(1);
    *inlr = *on;
    begsr *inzsr;
      p();
    endsr;
    dcl-proc p;
      reset x;
    end-proc;
  `), /RNX0109/);
  assert.deepEqual(run(`
    dcl-s x int(10) inz(1);
    x = 5;
    exsr init;
    dsply %char(x);
    *inlr = *on;
    begsr *inzsr;
      x = 2;
    endsr;
    begsr init;
      reset x;
    endsr;
  `), ['2']);
});

test('RESET *INnn : indicateur à sa valeur de fin d initialisation', () => {
  assert.deepEqual(run(`
    *in05 = *on;
    reset *in05;
    dsply *in05;
    reset *in06;
    dsply *in06;
    begsr *inzsr;
      *in06 = *on;
    endsr;
  `), ['false', 'true']);
});

test('RESET tableau entier et élément de tableau', () => {
  assert.deepEqual(run(`
    dcl-s tab packed(3:0) dim(3) inz(7);
    dcl-s i int(10) inz(2);
    tab(1) = 1;
    tab(2) = 2;
    tab(3) = 3;
    reset tab(i);
    dsply (%char(tab(1)) + ' ' + %char(tab(2)) + ' ' + %char(tab(3)));
    reset tab;
    dsply (%char(tab(1)) + ' ' + %char(tab(3)));
  `), ['1 7 3', '7 7']);
});

test('RESET tableau DIM(*AUTO) : retrouve ses éléments de fin d initialisation', () => {
  assert.deepEqual(run(`
    dcl-s tab char(5) dim(*auto : 10);
    tab(*next) = 'C';
    reset tab;
    dsply %char(%elem(tab));
    dsply tab(1);
    begsr *inzsr;
      tab(*next) = 'A';
      tab(*next) = 'B';
    endsr;
  `), ['2', 'A']);
});

test('RESET DS : sous-zones à leurs valeurs INZ ; sous-zone seule', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified;
      a char(3) inz('aaa');
      b int(10) inz(4);
    end-ds;
    dcl-ds e;
      f char(2) inz('ff');
      g char(2) inz('gg');
    end-ds;
    d.a = 'x';
    d.b = 9;
    reset d.b;
    dsply (d.a + %char(d.b));
    reset d;
    dsply (d.a + %char(d.b));
    f = 'x';
    g = 'y';
    reset f;
    dsply (f + g);
    reset e;
    dsply (f + g);
  `), ['x  4', 'aaa4', 'ffy', 'ffgg']);
});

test('RESET DS tableau : élément, sous-zone d un élément, tableau entier', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(2);
      a char(2) inz('aa');
      b int(10) inz(1);
    end-ds;
    d(1).a = 'x';
    d(1).b = 5;
    d(2).a = 'y';
    d(2).b = 6;
    reset d(1).b;
    dsply (d(1).a + %char(d(1).b));
    reset d(1);
    dsply (d(1).a + %char(d(1).b));
    reset d;
    dsply (d(2).a + %char(d(2).b));
  `), ['x 1', 'aa1', 'aa1']);
});

test('RESET dans une procédure : variable locale à sa valeur INZ, variable globale', () => {
  assert.deepEqual(run(`
    dcl-s g int(10) inz(3);
    g = 0;
    p();
    dsply %char(g);
    dcl-proc p;
      dcl-s l char(4) inz('loc');
      l = 'x';
      reset l;
      dsply l;
      reset g;
    end-proc;
  `), ['loc', '3']);
});

test('RESET d un paramètre de procédure est refusé', () => {
  assert.throws(() => run(`
    dcl-s v int(10);
    p(v);
    dcl-proc p;
      dcl-pi *n;
        x int(10);
      end-pi;
      reset x;
    end-proc;
  `), err => NOT_SUPPORTED.test(err.message) && /param/i.test(err.message));
});

test('reset reste utilisable comme nom de variable', () => {
  assert.deepEqual(run(`
    dcl-s reset int(10);
    reset = 2;
    dsply %char(reset);
  `), ['2']);
});

test('RESET *NOKEY, *ALL, fichier et format sont refusés', () => {
  assert.throws(() => parse(`dcl-f client; reset *nokey clientf;`), err => NOT_SUPPORTED.test(err.message) && /RESET \*NOKEY/.test(err.message));
  assert.throws(() => parse(`dcl-f client; reset *all clientf;`), err => NOT_SUPPORTED.test(err.message) && /\*ALL/.test(err.message));
  assert.throws(() => parse(`dcl-f client; reset client;`), err => NOT_SUPPORTED.test(err.message) && /RESET du fichier/.test(err.message));
  assert.throws(() => run(`dcl-f client; reset clientf;`, CTX), err => NOT_SUPPORTED.test(err.message) && /RESET du format/.test(err.message));
});

test('RESET d une cible non déclarée, d une constante, sans opérande : erreurs', () => {
  assert.throws(() => run(`reset inconnu;`), /non déclarée.*inconnu/i);
  assert.throws(() => parse(`dcl-c k 5; reset k;`), /k est/i);
  assert.throws(() => parse(`dcl-s a char(1); reset;`), /RESET attend/);
});
