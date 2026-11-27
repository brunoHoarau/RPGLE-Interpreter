// Tableaux : tableaux simples, bornes, *AUTO, %ELEM, portées, refus
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;

// --- Tableaux simples : DIM(n) ---


test('DIM(n) : éléments à la valeur par défaut, puis lecture et écriture', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s c char(3) dim(2);
    t(2) = 7;
    dsply t(1);
    dsply t(2);
    dsply t(3);
    c(1) = 'ab';
    dsply c(1);
    dsply %trim(c(2)) + '|';
    *inlr = *on;
  `), ['0', '7', '0', 'ab', '|']);
});

test('DIM(n) INZ(x) : la valeur initiale s\'applique à chaque élément', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3) inz(5);
    dsply t(1);
    dsply t(3);
    *inlr = *on;
  `), ['5', '5']);
});

test('élément : coercition vers le type de l\'élément', () => {
  assert.deepEqual(run(`
    dcl-s t packed(5:2) dim(2);
    dcl-s s char(3) dim(2);
    t(1) = 1.239;
    s(1) = 'abcdef';
    dsply t(1);
    dsply s(1);
    *inlr = *on;
  `), ['1.23', 'abc']);
});

test('l\'index est une expression numérique', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(5);
    dcl-s i int(10);
    for i = 1 to 5;
      t(i) = i * 10;
    endfor;
    dsply t(2 + 1);
    dsply t(%elem(t));
    t(i - 5) = t(1) + t(2);
    dsply t(0 + 1);
    *inlr = *on;
  `), ['30', '50', '30']);
});

test('affectation composée sur un élément', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(2) inz(1);
    t(2) += 4;
    dsply t(2);
    *inlr = *on;
  `), ['5']);
});

test('DIM via une constante nommée', () => {
  assert.deepEqual(run(`
    dcl-c MAX 4;
    dcl-s t int(10) dim(MAX);
    dsply %elem(t);
    *inlr = *on;
  `), ['4']);
});

test('tableau de dates', () => {
  assert.deepEqual(run(`
    dcl-s d date dim(2) inz(d'2024-01-15');
    d(2) = d(1) + %days(10);
    dsply %char(d(2) : *iso);
    *inlr = *on;
  `), ['2024-01-25']);
});

// --- Bornes ---


test('index hors bornes : 00121, interceptable par MONITOR', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s x int(10);
    monitor;
      x = t(4);
    on-error 00121;
      dsply 'lecture ' + %char(%status);
    endmon;
    monitor;
      t(0) = 1;
    on-error 00121;
      dsply 'zero';
    endmon;
    monitor;
      t(-1) = 1;
    on-error *program;
      dsply 'neg ' + %char(%status);
    endmon;
    *inlr = *on;
  `), ['lecture 121', 'zero', 'neg 121']);
});

test('index non entier : refusé', () => {
  assert.throws(() => run(`
    dcl-s t int(10) dim(3);
    dcl-s x int(10);
    x = t(1.5);
  `), NOT_SUPPORTED);
});

test('index non numérique : types incompatibles', () => {
  assert.throws(() => run(`
    dcl-s t int(10) dim(3);
    dcl-s x int(10);
    x = t('a');
  `), /types incompatibles/);
});

// --- DIM(*AUTO : n) ---


test('*AUTO : commence à 0 élément, %ELEM suit l\'écriture', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(*auto : 10);
    dsply %elem(t);
    t(1) = 4;
    dsply %elem(t);
    t(3) = 9;
    dsply %elem(t);
    dsply t(2);
    dsply t(3);
    *inlr = *on;
  `), ['0', '1', '3', '0', '9']);
});

test('*AUTO : éléments intermédiaires à la valeur INZ', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(*auto : 10) inz(7);
    t(3) = 1;
    dsply t(1);
    dsply t(2);
    *inlr = *on;
  `), ['7', '7']);
});

test('*AUTO : lecture au-delà du nombre courant : 00121', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(*auto : 10);
    dcl-s x int(10);
    t(1) = 1;
    monitor;
      x = t(2);
    on-error 00121;
      dsply 'lecture';
    endmon;
    monitor;
      t(11) = 1;
    on-error 00121;
      dsply 'ecriture';
    endmon;
    *inlr = *on;
  `), ['lecture', 'ecriture']);
});

test('*AUTO : arr(*next) ajoute un élément, au-delà de DIM : 00121', () => {
  assert.deepEqual(run(`
    dcl-s t char(2) dim(*auto : 2);
    t(*next) = 'a';
    t(*next) = 'b';
    dsply %elem(t);
    dsply t(2);
    monitor;
      t(*next) = 'c';
    on-error 00121;
      dsply 'plein';
    endmon;
    *inlr = *on;
  `), ['2', 'b', 'plein']);
});

test('*next sur un tableau fixe ou en lecture : erreur de compilation', () => {
  assert.throws(() => parse(`dcl-s t int(10) dim(3); t(*next) = 1;`), /\*NEXT/i);
  assert.throws(() => parse(`dcl-s t int(10) dim(*auto : 3); dcl-s x int(10); x = t(*next);`), /\*NEXT/i);
});

// --- %ELEM ---


test('%ELEM : DIM pour un tableau fixe', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(12);
    dsply %elem(t);
    *inlr = *on;
  `), ['12']);
});

test('%ELEM : argument non tableau ou affectation refusés', () => {
  assert.throws(() => parse(`dcl-s x int(10); dcl-s y int(10); y = %elem(x);`), /%ELEM/i);
  assert.throws(() => parse(`dcl-s t int(10) dim(3); %elem(t) = 2;`), err => NOT_SUPPORTED.test(err.message) && /L'affectation de %ELEM/i.test(err.message));
});

// --- Portées et paramètres ---


test('tableau local à une procédure, masquant un tableau global', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(2) inz(1);
    dcl-proc p;
      dcl-s t int(10) dim(3) inz(9);
      dsply %elem(t);
      dsply t(3);
    end-proc;
    p();
    dsply %elem(t);
    dsply t(2);
    *inlr = *on;
  `), ['3', '9', '2', '1']);
});

test('un tableau global est visible dans une procédure', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(2);
    dcl-proc p;
      t(2) = 8;
    end-proc;
    p();
    dsply t(2);
    *inlr = *on;
  `), ['8']);
});

test('élément passé en CONST et en VALUE', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(2) inz(3);
    dcl-proc a;
      dcl-pi *n int(10);
        v int(10) const;
      end-pi;
      return v + 1;
    end-proc;
    dcl-proc b;
      dcl-pi *n int(10);
        v int(10) value;
      end-pi;
      return v * 2;
    end-proc;
    dsply a(t(1));
    dsply b(t(2));
    *inlr = *on;
  `), ['4', '6']);
});

test('élément passé par référence : refusé', () => {
  assert.throws(() => run(`
    dcl-s t int(10) dim(2);
    dcl-proc a;
      dcl-pi *n;
        v int(10);
      end-pi;
      v = 1;
    end-proc;
    a(t(1));
  `), NOT_SUPPORTED);
});

// --- Refus explicites ---


test('refus : DIM(*VAR), CTDATA, ASCEND, DESCEND, FROMFILE, PERRCD, ALT', () => {
  for (const src of [
    'dcl-s t int(10) dim(*var : 5);',
    'dcl-s t char(5) dim(3) ctdata;',
    'dcl-s t char(5) dim(3) ascend;',
    'dcl-s t char(5) dim(3) descend;',
    'dcl-s t char(5) dim(3) fromfile(f);',
    'dcl-s t char(5) dim(3) perrcd(2);',
    'dcl-s t char(5) dim(3) alt(u);',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('refus : DIM sur sous-zone de DS, sur paramètre, sur prototype', () => {
  for (const src of [
    'dcl-ds d qualified; a int(10) dim(3); end-ds;',
    'dcl-proc p; dcl-pi *n; v int(10) dim(3); end-pi; end-proc;',
    'dcl-pr q; v int(10) dim(3); end-pr;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('DIM : valeur invalide', () => {
  for (const src of [
    'dcl-s t int(10) dim(0);',
    'dcl-s t int(10) dim(16773105);',
    'dcl-s t int(10) dim(2.5);',
    'dcl-s t int(10) dim(inconnue);',
    'dcl-s t int(10) dim(*auto);',
  ]) {
    assert.throws(() => parse(src), undefined, src);
  }
});

test('refus : LIKE d\'un tableau', () => {
  assert.throws(() => parse(`dcl-s t int(10) dim(3); dcl-s u like(t);`), NOT_SUPPORTED);
});

test('refus : tableau entier (valeur, affectation, DSPLY, appel, SQL, arr(*))', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10);';
  for (const body of [
    'x = t;',
    't = 1;',
    't = x;',
    'dsply t;',
    'x = t(*);',
    't(*) = 1;',
    'x = %len(t);',
  ]) {
    assert.throws(() => parse(`${decl} ${body}`), NOT_SUPPORTED, body);
  }
  assert.throws(() => run(`${decl} exec sql set :x = :t;`), NOT_SUPPORTED);
});

test('affectation composée : index avec appel de procédure refusé, index sans appel accepté', () => {
  const decl = `dcl-s t int(10) dim(3) inz(1); dcl-s i int(10) inz(1);
    dcl-proc f; dcl-pi *n int(10); end-pi; return 2; end-proc;`;
  assert.throws(() => parse(`${decl} t(f()) += 1;`), err => NOT_SUPPORTED.test(err.message) && /évalué deux fois|appel/i.test(err.message));
  assert.deepEqual(run(`dcl-s t int(10) dim(3) inz(1); dcl-s i int(10) inz(2);
    t(i + 1) += 5;
    dsply t(3);
    *inlr = *on;`), ['6']);
});
