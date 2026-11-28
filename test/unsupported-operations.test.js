// Unsupported : opérations et fonctions refusées
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
    'dcl-f a usage(*output : *xyz);',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('DCL-F : périphériques et mots-clés non supportés refusés', () => {
  for (const src of [
    'dcl-f etat printer;', 'dcl-f f special;',
    'dcl-f client infds(ds);', 'dcl-f client qualified;', 'dcl-f client alias;', 'dcl-f client block(*no);',
    'dcl-proc p; dcl-f client; end-proc;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('DCL-F WORKSTN : mots-clés refusés sur un fichier écran', () => {
  for (const kw of ['keyed', "extfile('X')", "extdesc('X')", 'rename(a:b)', 'prefix(p_)', 'usropn']) {
    assert.throws(() => parse(`dcl-f ecran workstn ${kw};`), /sur un fichier écran/, kw);
  }
  assert.throws(() => parse('dcl-f client indds(ind);'), /INDDS.*WORKSTN/);
  assert.throws(() => parse('dcl-f e workstn workstn;'), /WORKSTN en double/);
  assert.throws(() => parse('dcl-f e disk workstn;'), /DISK et WORKSTN incompatibles/);
  assert.throws(() => parse('dcl-f e workstn disk;'), /DISK et WORKSTN incompatibles/);
  assert.throws(() => parse('dcl-f e workstn indds(a) indds(b);'), /INDDS en double/);
});

test('opérations de fichier non supportées refusées', () => {
  for (const src of [
    'dcl-f client keyed; setll k client ds;', 'dcl-f client keyed; delete k client ds;',
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

test('*PSSR est refusée (BEGSR et EXSR)', () => {
  assert.throws(() => parse(`begsr *pssr; endsr;`), err => NOT_SUPPORTED.test(err.message) && /PSSR/.test(err.message));
  assert.throws(() => parse(`exsr *pssr;`), err => NOT_SUPPORTED.test(err.message) && /PSSR/.test(err.message));
});

test('ENDSR avec opérande est refusé', () => {
  assert.throws(() => parse(`begsr a; endsr *detc;`), err => NOT_SUPPORTED.test(err.message) && /ENDSR/.test(err.message));
  assert.throws(() => parse(`begsr a; endsr retpt;`), NOT_SUPPORTED);
});

test('un appel récursif de sous-routine est refusé, direct ou indirect', () => {
  assert.throws(() => parse(`begsr a; exsr a; endsr;`), err => NOT_SUPPORTED.test(err.message) && /récursif/.test(err.message));
  assert.throws(() => parse(`begsr a; exsr b; endsr; begsr b; exsr a; endsr;`), /récursif/);
});

test('les autres codes opération non supportés sont refusés', () => {
  for (const op of ['eval-corr a = b;']) {
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
  assert.throws(() => parse(`dcl-s x char(10); if 1 = 2; x = %char(%bitand(1:2)); endif;`),
    err => NOT_SUPPORTED.test(err.message) && /%BITAND/i.test(err.message));
});
