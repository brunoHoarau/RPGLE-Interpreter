const test = require('node:test');
const assert = require('node:assert');
const { run, parse } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;

// Cadre la valeur entre crochets pour voir les blancs
const show = (name) => `dsply '[' + ${name} + ']';`;

// Statut de l'erreur levée par l'instruction
const statusOf = (decl, stmt) => run(`${decl}
monitor;
  ${stmt}
on-error;
  dsply %char(%status);
endmon;`)[0];

test('exemple IBM : EVAL %SUBST(A:3:4) = \'****\'', () => {
  assert.deepEqual(run(`
    dcl-s a char(15) inz('abcdefghijklmno');
    eval %subst(a:3:4) = '****';
    ${show('a')}
  `), ['[ab****ghijklmno]']);
});

test('%SUBST cible sans EVAL, sans longueur (jusqu\'à la fin)', () => {
  assert.deepEqual(run(`
    dcl-s a char(6) inz('abcdef');
    %subst(a:4) = 'XY';
    ${show('a')}
  `), ['[abcXY ]']);
});

test('EVAL %SUBST : valeur trop longue tronquée à droite, trop courte complétée de blancs', () => {
  assert.deepEqual(run(`
    dcl-s a char(6) inz('abcdef');
    %subst(a:2:3) = 'VWXYZ';
    ${show('a')}
    %subst(a:2:3) = 'Q';
    ${show('a')}
  `), ['[aVWXef]', '[aQ  ef]']);
});

test('exemple IBM : EVALR %SUBST(Name:1:12) = \'Richard\'', () => {
  assert.deepEqual(run(`
    dcl-s name char(20);
    evalr name = 'Johann Strauss';
    evalr %subst(name:1:12) = 'Richard';
    ${show('name')}
  `), ['[     Richard Strauss]']);
});

test('EVALR %SUBST : valeur trop longue tronquée à gauche', () => {
  assert.deepEqual(run(`
    dcl-s a char(6) inz('abcdef');
    evalr %subst(a:2:3) = 'VWXYZ';
    ${show('a')}
  `), ['[aXYZef]']);
});

test('%SUBST cible : expressions en début et longueur, *BLANKS', () => {
  assert.deepEqual(run(`
    dcl-s a char(6) inz('abcdef');
    dcl-s i int(10) inz(1);
    %subst(a:i+1:i*2) = *blanks;
    ${show('a')}
  `), ['[a  def]']);
});

test('%SUBST cible : sous-champ de DS et élément de tableau', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified;
      nom char(5) inz('abcde');
    end-ds;
    dcl-s t char(4) dim(2) inz('wxyz');
    %subst(d.nom:2:2) = '--';
    evalr %subst(t(2):1:3) = 'k';
    ${show('d.nom')}
    ${show('t(2)')}
  `), ['[a--de]', '[  kz]']);
});

test('%SUBST cible sur un varchar : contrôle sur la longueur courante, longueur inchangée', () => {
  assert.deepEqual(run(`
    dcl-s v varchar(10) inz('abcd');
    %subst(v:2:2) = 'XY';
    ${show('v')}
    evalr %subst(v:3) = 'Z';
    ${show('v')}
    dsply %char(%len(v));
  `), ['[aXYd]', '[aX Z]', '4']);
  assert.equal(statusOf(`dcl-s v varchar(10) inz('abcd');`, `%subst(v:4:2) = 'x';`), '100');
});

test('%SUBST cible hors de la chaîne → statut 00100', () => {
  const decl = `dcl-s a char(5);`;
  assert.equal(statusOf(decl, `%subst(a:0:1) = 'x';`), '100');
  assert.equal(statusOf(decl, `%subst(a:6) = 'x';`), '100');
  assert.equal(statusOf(decl, `%subst(a:4:3) = 'x';`), '100');
  assert.equal(statusOf(decl, `%subst(a:2:-1) = 'x';`), '100');
});

test('%SUBST cible : cible non caractère ou valeur non caractère en erreur', () => {
  assert.throws(() => run(`dcl-s n int(10); %subst(n:1:1) = 'x';`), /caractère/);
  assert.throws(() => run(`dcl-s a char(5); %subst(a:1:2) = 12;`));
});

test('%SUBST cible : opérateur composé et 4e paramètre refusés', () => {
  assert.throws(() => parse(`dcl-s a char(5); %subst(a:1:2) += 'x';`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-s a char(5); %subst(a:1:2:*natural) = 'x';`), NOT_SUPPORTED);
});

test('%SUBST cible : constante en erreur', () => {
  assert.throws(() => parse(`dcl-c k 'abc'; %subst(k:1:1) = 'x';`), /constante|refusée/);
});
