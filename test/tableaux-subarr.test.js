// %SUBARR(tableau : début {: nombre}) avec SORTA, FOR-EACH, CLEAR et RESET ; bornes ; refus
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;

test('SORTA %SUBARR : seuls les éléments désignés sont triés', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(5);
    dcl-s i int(10);
    t(1) = 5;
    t(2) = 4;
    t(3) = 3;
    t(4) = 2;
    t(5) = 1;
    sorta %subarr(t : 1 : 4);
    dsply (%char(t(1)) + %char(t(2)) + %char(t(3)) + %char(t(4)) + %char(t(5)));
    sorta(d) %subarr(t : 2);
    dsply (%char(t(1)) + %char(t(2)) + %char(t(3)) + %char(t(4)) + %char(t(5)));
  `), ['23451', '25431']);
});

test('SORTA %SUBARR d une sous-zone de DS tableau : DS déplacées entières', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      k int(10);
      n char(1);
    end-ds;
    d(1).k = 3;
    d(1).n = 'a';
    d(2).k = 2;
    d(2).n = 'b';
    d(3).k = 1;
    d(3).n = 'c';
    sorta %subarr(d(*).k : 2 : 2);
    dsply (d(1).n + d(2).n + d(3).n);
  `), ['acb']);
});

test('FOR-EACH IN %SUBARR : éléments début à début + nombre - 1', () => {
  assert.deepEqual(run(`
    dcl-s t char(1) dim(4);
    dcl-s x char(1);
    dcl-s s varchar(10);
    t(1) = 'a';
    t(2) = 'b';
    t(3) = 'c';
    t(4) = 'd';
    for-each x in %subarr(t : 2 : 2);
      s += x;
    endfor;
    for-each x in %subarr(t : 4);
      s += x;
    endfor;
    dsply s;
  `), ['bcd']);
});

test('CLEAR %SUBARR : ces éléments seulement, y compris d une DS tableau', () => {
  assert.deepEqual(run(`
    dcl-s t packed(3:0) dim(4) inz(7);
    dcl-ds d qualified dim(3);
      a char(2) inz('aa');
    end-ds;
    clear %subarr(t : 2 : 2);
    dsply (%char(t(1)) + %char(t(2)) + %char(t(3)) + %char(t(4)));
    clear %subarr(d : 2);
    dsply (d(1).a + '[' + d(2).a + d(3).a + ']');
  `), ['7007', 'aa[    ]']);
});

test('RESET %SUBARR : ces éléments reprennent leur valeur de fin d initialisation', () => {
  assert.deepEqual(run(`
    dcl-s t packed(3:0) dim(4) inz(7);
    t(1) = 1;
    t(2) = 2;
    t(3) = 3;
    t(4) = 4;
    reset %subarr(t : 2 : 2);
    dsply (%char(t(1)) + %char(t(2)) + %char(t(3)) + %char(t(4)));
    reset %subarr(t : 1);
    dsply (%char(t(1)) + %char(t(4)));
  `), ['1774', '77']);
});

test('%SUBARR sur DIM(*AUTO) : borné par le nombre courant d éléments', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(*auto : 10);
    t(*next) = 3;
    t(*next) = 1;
    t(*next) = 2;
    sorta %subarr(t : 2);
    dsply (%char(%elem(t)) + ':' + %char(t(1)) + %char(t(2)) + %char(t(3)));
  `), ['3:312']);
  assert.throws(() => run(`
    dcl-s t int(10) dim(*auto : 10);
    t(*next) = 3;
    sorta %subarr(t : 2);
  `), /RNX0121/);
});

test('%SUBARR : début ou nombre hors limites, erreur 00121 interceptable', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s n int(10);';
  for (const args of ['0', '4', '1 : 0', '2 : 3', '1 : -1']) {
    assert.throws(() => run(`${decl} sorta %subarr(t : ${args});`), /RNX0121/, args);
  }
  assert.deepEqual(run(`
    ${decl}
    n = 4;
    monitor;
      clear %subarr(t : n);
    on-error 121;
      dsply 'interceptée';
    endmon;
  `), ['interceptée']);
});

test('%SUBARR : erreurs de compilation et refus', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10); dcl-ds d qualified dim(2); a int(10); end-ds;';
  assert.throws(() => parse(`${decl} sorta %subarr(x : 1);`), err => !NOT_SUPPORTED.test(err.message) && /tableau/i.test(err.message));
  assert.throws(() => parse(`${decl} sorta %subarr(t);`), /%SUBARR/);
  assert.throws(() => parse(`${decl} sorta %subarr(t : 1 : 2 : 3);`), /%SUBARR/);
  assert.throws(() => parse(`${decl} x = %lookup(1 : %subarr(t : 1 : 2));`), err => !NOT_SUPPORTED.test(err.message) && /%LOOKUP/.test(err.message));
  assert.throws(() => parse(`${decl} sorta %subarr(d : 1);`), /index est obligatoire/);
  assert.throws(() => parse(`${decl} clear %subarr(d(*).a : 1);`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %subarr(t : 1) + 1;`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-c k 1; ${decl} clear %subarr(k : 1);`), /tableau/i);
});
