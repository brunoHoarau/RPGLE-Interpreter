// Tableaux : %LOOKUP et SORTA
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;

// --- %LOOKUP et SORTA ---


test('%LOOKUP : index du premier élément égal, 0 si absent', () => {
  assert.deepEqual(run(`
    dcl-s t char(5) dim(3);
    dcl-s n int(10) dim(3);
    t(1) = 'a';
    t(2) = 'b';
    t(3) = 'b';
    n(1) = 10;
    n(2) = 20;
    n(3) = 20;
    dsply %char(%lookup('b' : t));
    dsply %char(%lookup('z' : t));
    dsply %char(%lookup(20 : n));
    dsply %char(%lookup(20 : n : 3));
    dsply %char(%lookup(20 : n : 1 : 1));
    *inlr = *on;
  `), ['2', '0', '2', '3', '0']);
});

test('%LOOKUP : *AUTO ne cherche que les éléments courants, comparaison avec complétion à blanc', () => {
  assert.deepEqual(run(`
    dcl-s t varchar(5) dim(*auto : 5);
    dcl-s c char(5) dim(2);
    dcl-s x int(10);
    dsply %char(%lookup('a' : t));
    t(*next) = 'a';
    t(*next) = 'b';
    dsply %char(%lookup('b' : t));
    dsply %char(%lookup('c' : t));
    c(1) = 'xy';
    dsply %char(%lookup('xy   ' : c));
    *inlr = *on;
  `), ['0', '2', '0', '1']);
});

test('%LOOKUP sur d(*).champ', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      code char(2);
      qte int(10);
    end-ds;
    d(1).code = 'A1';
    d(2).code = 'B2';
    d(3).code = 'C3';
    d(3).qte = 9;
    dsply %char(%lookup('C3' : d(*).code));
    dsply %char(%lookup(9 : d(*).qte));
    dsply %char(%lookup('B2' : d(*).code : 3));
    *inlr = *on;
  `), ['3', '3', '0']);
});

test('%LOOKUP : début hors bornes ou nombre trop grand : 00121 ; %FOUND inchangé', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s a int(10) dim(*auto : 3);
    monitor;
      dsply %char(%lookup(1 : t : 0));
    on-error 00121;
      dsply 'debut 0';
    endmon;
    monitor;
      dsply %char(%lookup(1 : t : 4));
    on-error 00121;
      dsply 'debut 4';
    endmon;
    monitor;
      dsply %char(%lookup(1 : t : 2 : 3));
    on-error 00121;
      dsply 'nombre';
    endmon;
    dsply %char(%lookup(1 : a));
    dsply %char(%lookup(1 : a : 5));
    *inlr = *on;
  `), ['debut 0', 'debut 4', 'nombre', '0', '0']);
});

test('%LOOKUP : types incompatibles', () => {
  assert.throws(() => run(`dcl-s t int(10) dim(2); dsply %char(%lookup('a' : t));`), /incompatibles/);
  assert.throws(() => run(`dcl-s t char(2) dim(2); dsply %char(%lookup(1 : t));`), /incompatibles/);
});

test('%LOOKUP : refus et erreurs de compilation', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10); dcl-ds d qualified dim(2); a int(10); end-ds;';
  assert.throws(() => parse(`${decl} x = %lookuplt(1 : t);`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %lookupge(1 : t);`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %lookup(1 : x);`), err => !NOT_SUPPORTED.test(err.message) && /tableau/i.test(err.message));
  assert.throws(() => parse(`${decl} x = %lookup(1 : t(*));`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %lookup(1 : %subarr(t : 1 : 2));`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %lookup(1 : d);`), /d/i);
  assert.throws(() => parse(`${decl} x = %lookup(1);`), /LOOKUP/i);
});

test('SORTA : tri croissant, décroissant, nombres', () => {
  assert.deepEqual(run(`
    dcl-s n int(10) dim(4);
    dcl-s i int(10);
    n(1) = 30;
    n(2) = 10;
    n(3) = 40;
    n(4) = 20;
    sorta n;
    for i = 1 to 4;
      dsply %char(n(i));
    endfor;
    sorta(d) n;
    dsply %char(n(1));
    sorta(a) n;
    dsply %char(n(1));
    *inlr = *on;
  `), ['10', '20', '30', '40', '40', '10']);
});

test('SORTA : ordre EBCDIC (minuscules, majuscules, puis chiffres)', () => {
  assert.deepEqual(run(`
    dcl-s t char(3) dim(5);
    dcl-s i int(10);
    t(1) = '1';
    t(2) = 'ABC';
    t(3) = 'Z';
    t(4) = 'abc';
    t(5) = 'B';
    sorta t;
    for i = 1 to 5;
      dsply %trim(t(i));
    endfor;
    *inlr = *on;
  `), ['abc', 'ABC', 'B', 'Z', '1']);
});

test('SORTA : *AUTO sur les éléments courants ; tableau fixe : tous les éléments', () => {
  assert.deepEqual(run(`
    dcl-s a int(10) dim(*auto : 4);
    dcl-s f int(10) dim(3);
    a(*next) = 5;
    a(*next) = 2;
    sorta a;
    dsply %char(%elem(a));
    dsply %char(a(1));
    f(1) = 5;
    f(2) = -1;
    sorta f;
    dsply %char(f(1));
    dsply %char(f(2));
    dsply %char(f(3));
    sorta(d) f;
    dsply %char(f(1));
    *inlr = *on;
  `), ['2', '2', '-1', '0', '5', '5']);
});

test('SORTA d(*).champ déplace les structures entières', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      code char(2);
      qte int(10);
    end-ds;
    d(1).code = 'C';
    d(1).qte = 3;
    d(2).code = 'A';
    d(2).qte = 1;
    d(3).code = 'B';
    d(3).qte = 2;
    sorta d(*).code;
    dsply %trim(d(1).code) + %char(d(1).qte);
    dsply %trim(d(3).code) + %char(d(3).qte);
    sorta(d) d(*).qte;
    dsply %trim(d(1).code) + %char(d(1).qte);
    *inlr = *on;
  `), ['A1', 'C3', 'C3']);
});

test('SORTA : refus et erreurs de compilation', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10); dcl-ds d qualified dim(2); a int(10); end-ds;';
  assert.throws(() => parse(`${decl} sorta %subarr(t : 1 : 2);`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} sorta(e) t;`), /SORTA/i);
  assert.throws(() => parse(`${decl} sorta x;`), err => !NOT_SUPPORTED.test(err.message) && /tableau/i.test(err.message));
  assert.throws(() => parse(`${decl} sorta d;`), /d/i);
  assert.throws(() => parse(`${decl} sorta t(*);`), NOT_SUPPORTED);
});
