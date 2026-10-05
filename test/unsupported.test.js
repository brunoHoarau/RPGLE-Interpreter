// Ce que l'interpréteur ne sait pas exécuter doit être refusé dès l'analyse,
// jamais ignoré : un programme qui « passe » doit vraiment avoir été exécuté.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;

// --- Opérations ---

test('USAGE : combinaisons acceptées à l\'analyse', () => {
  assert.doesNotThrow(() => parse(`
    dcl-f a usage(*output);
    dcl-f b usage(*update);
    dcl-f c usage(*update : *delete : *output) keyed;
    dcl-f d usage(*input : *output);
    dcl-f e usage(*delete);
    write af;
    read b; update bf; unlock b;
    chain 1 c; delete cf; delete (1) cf; delete 2 cf; write cf;
    read e; delete ef;
  `));
});

test('lecture sur un fichier en sortie seule : erreur d\'analyse', () => {
  assert.throws(() => parse(`dcl-f a usage(*output); read a;`), /A.*sortie/i);
  assert.throws(() => parse(`dcl-f a usage(*output) keyed; chain 1 a;`), /A.*sortie/i);
  assert.throws(() => parse(`dcl-f a usage(*output); unlock zz;`), /ZZ.*non déclaré/i);
});

test('écriture : constructions non supportées refusées', () => {
  for (const src of [
    'dcl-f b usage(*update); read b; update bf %fields(nom);',
    'dcl-f b usage(*update); read b; update bf ds;',
    'dcl-f a usage(*output); write af ds;',
    'dcl-f a usage(*output : *xyz);',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('DCL-F : périphériques et mots-clés non supportés refusés', () => {
  for (const src of [
    'dcl-f ecran workstn;', 'dcl-f etat printer;', 'dcl-f f special;',
    'dcl-f client infds(ds);', 'dcl-f client qualified;', 'dcl-f client alias;', 'dcl-f client block(*no);',
    'dcl-proc p; dcl-f client; end-proc;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('opérations de fichier non supportées refusées', () => {
  for (const src of [
    'dcl-f client keyed; chain %kds(k) client;',
    'dcl-f client keyed; readc client;', 'dcl-f client keyed; read client ds;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('opération sur un fichier non déclaré : erreur d\'analyse', () => {
  assert.throws(() => parse('read client;'), /CLIENT.*non déclaré/i);
  assert.throws(() => parse('dcl-f client; if %eof(autre); endif;'), /AUTRE.*non déclaré/i);
});

test('opérations de lecture acceptées à l\'analyse', () => {
  assert.doesNotThrow(() => parse(`
    dcl-f client keyed usropn;
    dcl-f cde disk usage(*input) keyed;
    dcl-s n packed(7:0);
    open client;
    read client;
    read clientf;
    readp client;
    chain n client;
    chain (n : 5) cde;
    setll *start client;
    setll *hival client;
    setgt (n) cde;
    reade (n) cde;
    readpe n cde;
    if %eof(client) or %found or %equal(cde) or %open(client) or %eof;
    endif;
    close client;
  `));
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

test('DSPLY accepte une file de messages en 2e opérande', () => {
  assert.deepEqual(run(`dsply 'Fin' *joblog;`), ['Fin (File: *joblog)']);
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

test('durée dont l\'argument peut avoir des décimales : refusée', () => {
  for (const src of [
    `dcl-s p packed(5:2) inz(2); dcl-s d date; d = d + %days(p);`,
    `dcl-s d date; d = d + %days(10 / 5);`,
    `dcl-s d date; d = d + %days(1.0);`,
    `dcl-c DEUX 2; dcl-s d date; d = d + %days(DEUX);`,
  ]) {
    assert.throws(() => run(src), NOT_SUPPORTED, src);
  }
});

test("extenseur d'opération de fichier : refusé, y compris collé à CHAIN", () => {
  for (const src of ['chain(h) k f;', 'setll(n) k f;', 'read(x) client;', 'write(n) f;']) {
    assert.throws(() => parse('dcl-f f keyed; dcl-f client keyed; dcl-s k int(5); ' + src),
      err => NOT_SUPPORTED.test(err.message) && /extenseur/i.test(err.message), src);
  }
  assert.doesNotThrow(() => parse('dcl-f client keyed; dcl-f cde keyed; dcl-s n int(5); chain (n) client; chain (n : 5) cde;'));
});

test('%EOF() sans argument accepté, %OPEN() refusé clairement', () => {
  assert.doesNotThrow(() => parse('dcl-f client; if %eof(); endif;'));
  assert.throws(() => parse('dcl-f client; if %open(); endif;'), /%OPEN attend un nom de fichier \(ligne 1\)/);
});

test("extenseur de UNLOCK : (E) accepté, les autres refusés avec le message de l'extenseur", () => {
  const node = parse('dcl-f f usage(*update) keyed; unlock(e) f;').body.find(n => n.type === 'FileOperation');
  assert.deepEqual(node.extender, { error: true, noLock: false });
  for (const [src, shown] of [['unlock(n) f;', 'N'], ['unlock(en) f;', 'EN'], ['unlock(x) f;', 'X']]) {
    assert.throws(() => parse('dcl-f f usage(*update) keyed; ' + src),
      err => NOT_SUPPORTED.test(err.message) && new RegExp(`L'extenseur \\(${shown}\\) de UNLOCK`).test(err.message), src);
  }
});

test('USAGE : mot répété refusé à l\'analyse', () => {
  assert.throws(() => parse(`dcl-f a usage(*update : *update);`), /USAGE\(\*UPDATE\) répété/);
  assert.throws(() => parse(`dcl-f a usage(*input : *output : *input);`), /USAGE\(\*INPUT\) répété/);
  assert.doesNotThrow(() => parse(`dcl-f a usage(*input : *update);`));
});

test('3a : DCL-F RENAME, PREFIX, EXTFILE, EXTDESC acceptés à l\'analyse', () => {
  assert.doesNotThrow(() => parse(`
    dcl-f film rename(film:ffilm) keyed;
    dcl-f client prefix(c_) keyed;
    dcl-f cli2 prefix('X':2) extfile('MABIB/CLIENT') extdesc('CLIENT');
    dcl-f cli3 extdesc('MABIB/CLIENT') extfile(*extdesc) usage(*update) keyed;
    read ffilm;
    read(e) client;
    chain(n) 1 client;
    chain(en) 1 cli3;
    reade client;
    readpe(ne) client;
    update(e) cli3f;
    if %error or %error();
    endif;
  `));
});

test('3a : refus', () => {
  for (const src of [
    'dcl-s nomvar char(10); dcl-f client extfile(nomvar);',
    'dcl-f client keyed; read(x) client;',
    'dcl-f client keyed; read(h) client;',
    'callp(e) p();',
    'dcl-proc p; end-proc; callp(e) p();',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
  // RENAME avec un seul argument : erreur de compilation, pas une limite de l'interpréteur
  assert.throws(() => parse('dcl-f client rename(clientf);'));
});

test('3a : PREFIX de structure qualifiée refusé', () => {
  assert.throws(() => parse(`dcl-f client prefix('DS.');`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-f client prefix('DS.' : 2);`), NOT_SUPPORTED);
});

test('3a : EXTFILE(*EXTDESC) sans EXTDESC refusé à l\'analyse', () => {
  assert.throws(() => parse(`dcl-f client extfile(*extdesc);`),
    err => !NOT_SUPPORTED.test(err.message) && /EXTFILE\(\*EXTDESC\).*EXTDESC/.test(err.message));
  assert.doesNotThrow(() => parse(`dcl-f client extfile(*extdesc) extdesc('CLIENT');`));
});
