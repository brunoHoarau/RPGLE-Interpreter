// Unsupported : constructions supportées, garde-fous, fichiers écran
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;

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

// --- Garde-fous d'exécution : analysé mais pas encore exécutable ---


test('exécution : paramètre DS de programme externe refusé tant que non exécuté', () => {
  const context = { programs: {}, tables: { CLIENT: { format: 'CLIENTF', keys: ['ID'], columns: [{ name: 'ID', type: 'packed(5:0)' }, { name: 'NOM', type: 'char(5)' }], data: [{ ID: 1, NOM: 'abc' }] } } };
  for (const src of [
    'dcl-ds m qualified;\n a char(5);\nend-ds;\ndcl-pr p extpgm(\'P\');\n c likeds(m) const;\nend-pr;\np(m);',
  ]) {
    assert.throws(() => run(src, context), NOT_SUPPORTED, src);
  }
});

test('%EDITC : 3e argument refusé', () => {
  assert.throws(() => parse(`dcl-s n zoned(5:0); dsply %editc(n : 'J' : *astfill);`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-s n zoned(5:0); dsply %editc(n : 'J' : *cursym);`), NOT_SUPPORTED);
});

test('EXFMT : clé, extenseur et opérande de plus refusés', () => {
  for (const op of ['exfmt(e) f;', 'exfmt 1 f;', 'exfmt f d;']) {
    assert.throws(() => parse(op), NOT_SUPPORTED, op);
  }
});

// --- Fichiers écran : LIKEREC et EXTNAME ---


test('fichier écran : LIKEREC et EXTNAME d\'un format ou d\'un fichier écran refusés', () => {
  const { runScreens, displaysFrom } = require('./helpers');
  const displays = () => displaysFrom({
    ECRAN: { formats: { FMT01: { fields: [{ name: 'CODE', usage: 'B', type: 'char(6)', row: 3, col: 10 }] } } },
  });
  const refuse = code => assert.throws(() => runScreens(`dcl-f ecran workstn; ${code}`, displays(), []),
    /fichier écran.*pas encore support/, code);
  refuse('dcl-ds d likerec(fmt01);');
  refuse('dcl-ds d likerec(fmt01 : *all);');
  refuse(`dcl-ds d extname('ECRAN') end-ds;`);
  refuse(`dcl-ds d extname('ECRAN' : 'FMT01') end-ds;`);
  refuse(`dcl-ds d extname('ECRAN') qualified; end-ds;`);
  refuse(`
    dcl-ds a qualified; x char(1); end-ds;
    lire(a);
    dcl-proc lire;
      dcl-pi *n;
        p likerec(fmt01);
      end-pi;
    end-proc;
  `);
});
