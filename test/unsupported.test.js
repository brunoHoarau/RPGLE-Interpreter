// Ce que l'interpréteur ne sait pas exécuter doit être refusé dès l'analyse,
// jamais ignoré : un programme qui « passe » doit vraiment avoir été exécuté.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;

// --- Opérations ---

test('CHAIN au niveau principal est refusé, pas ignoré', () => {
  assert.throws(() => parse(`dcl-s cle int(5); chain cle clients;`), err =>
    NOT_SUPPORTED.test(err.message) && /CHAIN/.test(err.message) && /ligne 1/.test(err.message));
});

test('READ, SETLL, WRITE, UPDATE, DELETE sont refusés', () => {
  for (const op of ['read clients;', 'setll *start clients;', 'write fmt;', 'update fmt;', 'delete fmt;']) {
    assert.throws(() => parse(op), NOT_SUPPORTED, op);
  }
});

test('DCL-F est refusé', () => {
  assert.throws(() => parse(`dcl-f clients keyed;`), err => NOT_SUPPORTED.test(err.message) && /DCL-F/.test(err.message));
});

test('EXSR est refusé, y compris dans un bloc', () => {
  assert.throws(() => parse(`exsr calcul;`), err => NOT_SUPPORTED.test(err.message) && /EXSR/.test(err.message));
  assert.throws(() => parse(`if 1 = 1; exsr calcul; endif;`), /EXSR/);
});

test('les autres codes opération non supportés sont refusés', () => {
  for (const op of ['clear ds;', 'reset ds;', 'sorta tab;', 'exfmt ecran;', 'begsr calcul;', 'eval-corr a = b;']) {
    assert.throws(() => parse(op), NOT_SUPPORTED, op);
  }
});

test('une instruction non reconnue est une erreur', () => {
  assert.throws(() => parse(`dcl-s x int(5); bidule x;`), /non reconnue.*bidule/i);
});

test('un mot de fin de bloc isolé est une erreur', () => {
  assert.throws(() => parse(`endif;`), /ENDIF/i);
});

test('un appel de procédure sans parenthèses ni argument reste accepté', () => {
  const out = run(`
    p;
    dcl-proc p;
      dsply 'appel';
    end-proc;
  `);
  assert.deepEqual(out, ['appel']);
});

test('un indice de tableau est refusé', () => {
  assert.throws(() => parse(`dcl-s x int(5); x(1) = 2;`), err => NOT_SUPPORTED.test(err.message) && /tableau/i.test(err.message));
});

// --- Fonctions intégrées ---

test('une fonction intégrée inconnue est refusée à l\'analyse', () => {
  assert.throws(() => parse(`dcl-s x char(10); if 1 = 2; x = %editc(1: 'X'); endif;`),
    err => NOT_SUPPORTED.test(err.message) && /%EDITC/i.test(err.message));
});

// --- Déclarations ---

test('DIM est refusé sur dcl-s et dcl-ds', () => {
  assert.throws(() => parse(`dcl-s t char(10) dim(5);`), /DIM/);
  assert.throws(() => parse(`dcl-ds d qualified dim(3); a int(5); end-ds;`), /DIM/);
});

test('EXTNAME et LIKEDS sont refusés sur dcl-ds', () => {
  assert.throws(() => parse(`dcl-ds d extname('CLIENT') end-ds;`), /EXTNAME/);
  assert.throws(() => parse(`dcl-ds d likeds(autre);`), /LIKEDS/);
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

test('LIKEDS et OPTIONS(*OMIT) sont refusés sur un paramètre', () => {
  assert.throws(() => parse(`dcl-proc p; dcl-pi *n; c likeds(cli) const; end-pi; end-proc;`), /LIKEDS/);
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

// --- Constructions désormais supportées ---

test('*INLR = *ON est accepté', () => {
  assert.deepEqual(run(`dsply 'fin'; *inlr = *on; return;`), ['fin']);
});

test('les indicateurs *IN01 à *IN99 sont des variables', () => {
  const out = run(`
    *in50 = *on;
    if *in50 and not *in51;
      dsply 'ok';
    endif;
  `);
  assert.deepEqual(out, ['ok']);
});

test('EVAL est accepté', () => {
  assert.deepEqual(run(`dcl-s n int(5); eval n = 2 + 3; dsply %char(n);`), ['5']);
});

test('EVAL(H) est refusé tant que l\'arrondi n\'est pas supporté', () => {
  assert.throws(() => parse(`dcl-s n int(5); eval(h) n = 2.5;`), NOT_SUPPORTED);
});

test('DSPLY accepte encore *BLANK et une file d\'attente en paramètres', () => {
  assert.deepEqual(run(`dsply 'Fin' *blank *joblog;`), ['Fin (File: *joblog)']);
});

test('les fonctions et formats de dates des incréments suivants sont refusés', () => {
  for (const src of [
    `dcl-s d date; d = %date('04/10/2026' : *eur);`,
    `dcl-s c char(10); c = %char(D'2026-10-04' : *eur);`,
    `dcl-s z timestamp; z = %timestamp('x' : 3);`,
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('%DATE d\'un nombre est refusé tant que les conversions numériques manquent', () => {
  assert.throws(() => run(`dcl-s d date; d = %date(20261004);`), NOT_SUPPORTED);
});

test('arithmétique de dates incertaine : refusée', () => {
  for (const src of [
    `dcl-s t time inz(T'23.00.00'); t = t + %hours(2);`,
    `dcl-s t time inz(T'00.30.00'); t = t - %hours(1);`,
    `dcl-s t time inz(T'24.00.00'); t = t - %seconds(1);`,
    `dcl-s d date; d = %days(1) + d;`,
    `dcl-s d date; d = d + %days(1.5);`,
  ]) {
    assert.throws(() => run(src), NOT_SUPPORTED, src);
  }
});

test('%DIFF et %SUBDT incertains : refusés', () => {
  for (const src of [
    `dcl-s n int(10); n = %diff(D'2026-10-04' : Z'2026-10-04-00.00.00.000000' : *days);`,
    `dcl-s n int(10); n = %diff(Z'2026-10-04-00.00.00.000000' : Z'2026-10-01-00.00.00.000000' : *seconds);`,
    `dcl-s n int(20); n = %diff(Z'9999-12-31-00.00.00.000000' : Z'0001-01-01-00.00.00.000000' : *ms);`,
    `dcl-s n int(10); n = %diff(T'24.00.00' : T'10.00.00' : *hours);`,
  ]) {
    assert.throws(() => run(src), NOT_SUPPORTED, src);
  }
  assert.throws(() => parse(`dcl-s n int(10); n = %subdt(D'2026-10-04' : *years : 4);`), NOT_SUPPORTED);
});
