// Unsupported : déclarations et valeurs spéciales refusées
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;

// --- Déclarations ---


test('DIM est refusé sur une sous-zone de dcl-ds', () => {
  assert.throws(() => parse(`dcl-ds d qualified; a int(5) dim(3); end-ds;`), /DIM/);
});

test('DCL-DS : EXT, *NULL, PREFIX, TEMPLATE, LIKEDS d un tableau et sous-zones d\'une DS EXTNAME sont refusés', () => {
  for (const src of [
    'dcl-ds d ext end-ds;',
    "dcl-ds d extname(*null) end-ds;",
    "dcl-ds d extname('CLIENT') prefix(c_); end-ds;",
    "dcl-ds d extname('CLIENT'); a char(5); end-ds;",
    'dcl-ds d template; a char(5); end-ds;',
    'dcl-ds m; a char(5); end-ds; dcl-ds d likeds(m) template;',
    'dcl-ds m; a char(5); end-ds; dcl-ds d likeds(m) prefix(c_);',
    'dcl-ds m qualified dim(3); a char(5); end-ds; dcl-ds d likeds(m);',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('DCL-DS : LIKEDS, LIKEREC et EXTNAME mal formés ou incohérents : erreur d\'analyse', () => {
  for (const [src, message] of [
    ['dcl-ds d likeds(autre);', /AUTRE.*structure de données/i],
    ['dcl-s x char(5); dcl-ds d likeds(x);', /X.*structure de données/i],
    ['dcl-ds d extname(client) end-ds;', /EXTNAME.*littéral/i],
    ["dcl-ds d extname('client') end-ds;", /sensible à la casse/i],
    ["dcl-ds d extname('') end-ds;", /EXTNAME.*mal formé/i],
    ["dcl-ds d extname('A/B/C') end-ds;", /EXTNAME.*mal formé/i],
    ["dcl-ds d extname('CLIENT' : fmt) end-ds;", /EXTNAME.*littéral/i],
    ["dcl-ds d extname('CLIENT' : 'fmt') end-ds;", /sensible à la casse/i],
    ["dcl-ds m; a char(5); end-ds; dcl-ds d extname('CLIENT') likeds(m) end-ds;", /EXTNAME.*LIKEDS/i],
    ["dcl-ds d extname('CLIENT') likerec(fmt) end-ds;", /EXTNAME.*LIKEREC/i],
    ['dcl-ds m; a char(5); end-ds; dcl-ds d likeds(m) likerec(fmt);', /LIKEDS.*LIKEREC/i],
    ['dcl-ds d likerec(fmt : *xyz);', /LIKEREC.*\*XYZ/i],
    ["dcl-ds d extname('F' : *xyz) end-ds;", /EXTNAME.*\*XYZ/i],
    ['dcl-ds d inz(*likeds);', /INZ\(\*LIKEDS\)/i],
  ]) {
    assert.throws(() => parse(src), message, src);
  }
});

test('paramètre LIKEDS / LIKEREC : mal formé refusé', () => {
  assert.throws(() => parse(`dcl-proc p; dcl-pi *n; c likeds(inconnue) const; end-pi; end-proc;`), /INCONNUE.*structure de données/i);
  assert.throws(() => parse(`dcl-proc p; dcl-pi *n; c likerec(f : *xyz) const; end-pi; end-proc;`), /LIKEREC.*\*XYZ/i);
});

test('les mots-clés de champ non supportés sont refusés', () => {
  assert.throws(() => parse(`dcl-ds d; a char(5); b char(2) overlay(a); end-ds;`), /OVERLAY/);
});

test('LIKE est refusé sur dcl-s', () => {
  assert.throws(() => parse(`dcl-s a int(5); dcl-s b like(a);`), /LIKE/);
});

test('les types sans sémantique sont refusés', () => {
  for (const decl of ['dcl-s f float(8);', 'dcl-s p pointer;']) {
    assert.throws(() => parse(decl), NOT_SUPPORTED, decl);
  }
});

test('les formats de date et d\'heure autres que *ISO sont refusés', () => {
  for (const decl of ['dcl-s d date(*eur);', 'dcl-s d date(*dmy);', 'dcl-s t time(*hms);',
                      'dcl-s d date(*iso0);', 'dcl-s d date(*iso-);']) {
    assert.throws(() => parse(decl), NOT_SUPPORTED, decl);
  }
});

test('CTL-OPT DATFMT ou TIMFMT autre que *ISO est refusé', () => {
  assert.throws(() => parse(`ctl-opt datfmt(*eur);`), err => NOT_SUPPORTED.test(err.message) && /DATFMT/.test(err.message));
  assert.throws(() => parse(`ctl-opt timfmt(*hms);`), err => NOT_SUPPORTED.test(err.message) && /TIMFMT/.test(err.message));
});

test('TIMESTAMP(n) autre que 6 est refusé', () => {
  assert.throws(() => parse(`dcl-s z timestamp(3);`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-s z timestamp(12);`), NOT_SUPPORTED);
});

test('valeur de retour LIKEDS / LIKEREC et OPTIONS(*OMIT) sont refusés', () => {
  assert.throws(() => parse(`dcl-ds m; a char(5); end-ds; dcl-proc p; dcl-pi *n likeds(m); end-pi; end-proc;`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-proc p; dcl-pi *n likerec(f); end-pi; end-proc;`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-pr q likeds(m); end-pr;`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-proc p; dcl-pi *n; c int(5) options(*omit); end-pi; end-proc;`), /\*OMIT/i);
});

test('les paramètres du programme principal sont acceptés à l\'analyse', () => {
  assert.doesNotThrow(() => parse(`dcl-pi *n; client int(10); end-pi;`));
});

test('un DCL-PI principal sans paramètre reste accepté', () => {
  assert.deepEqual(run(`dcl-pi *n end-pi; dsply 'ok';`), ['ok']);
});

test('INZ sans valeur reste accepté', () => {
  assert.deepEqual(run(`dcl-s n int(5) inz; dsply %char(n);`), ['0']);
});

// --- Valeurs spéciales ---


test('les valeurs spéciales non supportées sont refusées', () => {
  for (const decl of ['x = *hival;', 'x = *loval;', "x = *all'-';"]) {
    assert.throws(() => parse(`dcl-s x char(5); ${decl}`), NOT_SUPPORTED, decl);
  }
});

test('*SYS et *JOB ne sont acceptés qu\'en INZ d\'une date ou d\'une heure', () => {
  for (const src of ['dcl-s c char(10) inz(*sys);', 'dcl-s t time inz(*job);', 'dcl-s d date; d = *sys;']) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('*LOVAL et *HIVAL hors date ou heure restent refusés', () => {
  for (const src of [
    'dcl-s n int(5) inz(*loval);',
    'dcl-s d date; dcl-s x int(5); x = *hival;',
    'dcl-proc p; dcl-s d date; end-proc; dcl-s d char(5); d = *loval;',
    'dcl-s d date; if d + 1 = *loval; endif;',
    'dcl-s d date; dcl-proc p; dcl-s d char(5); d = *loval; end-proc;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('*BLANKS et *ZEROS sont acceptés', () => {
  const out = run(`
    dcl-s c char(3) inz('abc');
    dcl-s n int(5) inz(4);
    c = *blanks;
    n = *zeros;
    dsply '[' + c + ']' + %char(n);
  `);
  assert.deepEqual(out, ['[   ]0']);
});
