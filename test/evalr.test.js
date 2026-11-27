const test = require('node:test');
const assert = require('node:assert');
const { run, parse } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;

// Cadre la valeur entre crochets pour voir les blancs de tête
const show = (name) => `dsply '[' + ${name} + ']';`;

test('EVALR cadre à droite une valeur plus courte que la cible', () => {
  assert.deepEqual(run(`
    dcl-s c char(6);
    evalr c = 'ab';
    ${show('c')}
  `), ['[    ab]']);
});

test('EVALR tronque à gauche une valeur plus longue que la cible', () => {
  assert.deepEqual(run(`
    dcl-s c char(4);
    evalr c = 'abcdef';
    ${show('c')}
  `), ['[cdef]']);
});

test('EVALR garde les blancs de fin de l\'expression', () => {
  assert.deepEqual(run(`
    dcl-s c char(6);
    dcl-s v char(4) inz('ab');
    evalr c = v;
    ${show('c')}
    evalr c = %trimr(v) + '.';
    ${show('c')}
  `), ['[  ab  ]', '[   ab.]']);
});

test('EVALR sur un sous-champ de DS et un élément de tableau', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified;
      nom char(5);
    end-ds;
    dcl-s t char(3) dim(2);
    evalr d.nom = 'x';
    evalr t(2) = 'yz';
    ${show('d.nom')}
    ${show('t(2)')}
  `), ['[    x]', '[ yz]']);
});

test('EVALR avec *BLANKS', () => {
  assert.deepEqual(run(`
    dcl-s c char(3) inz('abc');
    evalr c = *blanks;
    ${show('c')}
  `), ['[   ]']);
});

test('EVALR vers une cible non caractère est refusé', () => {
  assert.throws(() => run(`dcl-s n int(10); evalr n = 5;`), /EVALR/);
});

test('EVALR vers un varchar est une erreur (cible de longueur fixe exigée)', () => {
  assert.throws(() => run(`dcl-s v varchar(5); evalr v = 'a';`), /longueur fixe/);
});

test('EVALR(M) et EVALR(R) sont sans effet sur un résultat caractère', () => {
  assert.deepEqual(run(`
    dcl-s c char(4);
    evalr(m) c = 'a';
    ${show('c')}
    evalr(r) c = 'bc';
    ${show('c')}
  `), ['[   a]', '[  bc]']);
});

test('EVALR(H) et les opérateurs composés sont des erreurs', () => {
  assert.throws(() => parse(`dcl-s c char(5); evalr(h) c = 'a';`), /M et R/);
  assert.throws(() => parse(`dcl-s c char(5); evalr c += 'a';`), /affectation simple/);
});

test('exemple IBM : EVALR de Johann Strauss et de Mozart dans un char(20)', () => {
  assert.deepEqual(run(`
    dcl-s name char(20);
    evalr name = 'Johann Strauss';
    ${show('name')}
    evalr name = 'Wolfgang Amadeus Mozart';
    ${show('name')}
  `), ['[      Johann Strauss]', '[fgang Amadeus Mozart]']);
});

test('evalr reste utilisable comme nom de variable', () => {
  assert.deepEqual(run(`dcl-s evalr char(2); evalr = 'ok'; dsply evalr;`), ['ok']);
});
