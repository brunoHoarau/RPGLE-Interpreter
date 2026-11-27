// Tableaux : FOR-EACH
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;

// --- FOR-EACH ---


test('FOR-EACH : parcourt les éléments d\'un tableau simple', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s x int(10);
    dcl-s total int(10);
    t(1) = 4;
    t(2) = 5;
    t(3) = 6;
    for-each x in t;
      total += x;
      dsply %char(x);
    endfor;
    dsply %char(total);
    *inlr = *on;
  `), ['4', '5', '6', '15']);
});

test('FOR-EACH : tableau fixe = tous les DIM éléments, *AUTO = éléments courants', () => {
  assert.deepEqual(run(`
    dcl-s f int(10) dim(3) inz(1);
    dcl-s a char(2) dim(*auto : 5);
    dcl-s x int(10);
    dcl-s c char(2);
    dcl-s n int(10);
    for-each x in f;
      n += 1;
    endfor;
    dsply %char(n);
    for-each c in a;
      dsply 'jamais';
    endfor;
    a(*next) = 'p';
    a(*next) = 'q';
    for-each c in a;
      dsply %trim(c);
    endfor;
    *inlr = *on;
  `), ['3', 'p', 'q']);
});

test('FOR-EACH : l\'élément est copié, coercition vers le type de l\'item, item garde le dernier élément', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s p packed(5:1);
    dcl-s big int(20);
    t(1) = 7;
    t(2) = 8;
    t(3) = 9;
    for-each p in t;
      p += 1;
    endfor;
    dsply %char(p);
    dsply %char(t(3));
    *inlr = *on;
  `), ['10.0', '9']);
});

test('FOR-EACH : le nombre d\'éléments est évalué au départ', () => {
  assert.deepEqual(run(`
    dcl-s a int(10) dim(*auto : 10);
    dcl-s x int(10);
    dcl-s n int(10);
    a(*next) = 1;
    a(*next) = 2;
    for-each x in a;
      n += 1;
      if n < 5;
        a(*next) = 9;
      endif;
    endfor;
    dsply %char(n);
    dsply %char(%elem(a));
    *inlr = *on;
  `), ['2', '4']);
});

test('FOR-EACH : LEAVE et ITER', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(5);
    dcl-s x int(10);
    t(1) = 1;
    t(2) = 2;
    t(3) = 3;
    t(4) = 4;
    t(5) = 5;
    for-each x in t;
      if x = 2;
        iter;
      endif;
      if x = 4;
        leave;
      endif;
      dsply %char(x);
    endfor;
    dsply 'fin ' + %char(x);
    *inlr = *on;
  `), ['1', '3', 'fin 4']);
});

test('FOR-EACH sur un tableau de DS : copie dans une DS de même disposition', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      code char(2);
      qte int(10);
    end-ds;
    dcl-ds cur qualified;
      c char(2);
      q int(10);
    end-ds;
    d(1).code = 'A';
    d(1).qte = 1;
    d(2).code = 'B';
    d(2).qte = 2;
    for-each cur in d;
      dsply %trim(cur.c) + '/' + %char(cur.q);
      cur.q = 99;
    endfor;
    dsply %char(d(2).qte);
    *inlr = *on;
  `), ['A/1', 'B/2', '/0', '2']);
});

test('FOR-EACH : catégorie incompatible, disposition différente', () => {
  assert.throws(() => run(`
    dcl-s t char(2) dim(2);
    dcl-s x int(10);
    for-each x in t;
    endfor;
  `), /incompatibles/);
  assert.throws(() => run(`
    dcl-s t int(10) dim(2);
    dcl-s c char(2);
    for-each c in t;
    endfor;
  `), /incompatibles/);
  assert.throws(() => run(`
    dcl-ds d qualified dim(2);
      a int(10);
    end-ds;
    dcl-ds cur qualified;
      c char(2);
    end-ds;
    for-each cur in d;
    endfor;
  `), err => NOT_SUPPORTED.test(err.message) && /disposition/.test(err.message));
  assert.throws(() => run(`
    dcl-ds d qualified dim(2);
      a int(10);
    end-ds;
    dcl-s x int(10);
    for-each x in d;
    endfor;
  `), err => /incompatibles|structure de données/i.test(err.message));
});

test('FOR-EACH : refus et erreurs de compilation', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10); dcl-s s char(5);';
  assert.throws(() => parse(`${decl} for-each(h) x in t; endfor;`), NOT_SUPPORTED);
  for (const src of ['%list(1 : 2)', "%split('a b')", '%range(1 : 3)']) {
    assert.throws(() => parse(`${decl} for-each x in ${src}; endfor;`), NOT_SUPPORTED, src);
  }
  assert.throws(() => parse(`${decl} for-each x in s; endfor;`), err => !NOT_SUPPORTED.test(err.message) && /tableau/i.test(err.message));
  assert.throws(() => parse(`${decl} for-each x in t; x = 1;`), /ENDFOR/i);
  assert.throws(() => parse(`${decl} for-each x t; endfor;`), /IN/i);
  assert.throws(() => parse(`${decl} for-each t in t; endfor;`), NOT_SUPPORTED);
});
