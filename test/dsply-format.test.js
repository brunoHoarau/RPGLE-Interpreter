// DSPLY d'une valeur numérique : présentation IBM i (chiffres sans point décimal, zéros de tête
// supprimés, cadrage à droite sur la longueur du type, signe moins en fin). Constaté sur IBM i.
// Les autres tests utilisent run() / runRaw(), qui gardent la valeur lisible (option readableDsply).
const test = require('node:test');
const assert = require('node:assert/strict');
const { runRaw } = require('./helpers');

// Lignes DSPLY telles qu'IBM i les affiche
const shown = code => runRaw(code, undefined, { readableDsply: false })
  .filter(l => l.startsWith('[DSPLY]'))
  .map(l => l.slice('[DSPLY] '.length));

test('packed : chiffres sans point décimal, cadrés sur la longueur, signe en fin', () => {
  assert.deepEqual(shown(`
dcl-s p packed(7:2) inz(100);
dsply p;
p = -1.5;
dsply p;
p = 0;
dsply p;
`), ['  10000', '    150-', '      0']);
});

test('zoned et int : longueur du type', () => {
  assert.deepEqual(shown(`
dcl-s z zoned(5:2) inz(1.5);
dcl-s i int(10) inz(-42);
dcl-s j int(5) inz(7);
dsply z;
dsply i;
dsply j;
`), ['  150', '        42-', '    7']);
});

test('constante numérique : longueur du littéral', () => {
  assert.deepEqual(shown(`
dcl-c C 20;
dcl-c D 1.50;
dsply C;
dsply D;
dsply 345;
`), ['20', '150', '345']);
});

test('expression entière sur des int : int(20)', () => {
  assert.deepEqual(shown(`
dcl-s i int(10) inz(-42);
dsply (i + 1);
`), ['                  41-']);
});

test('élément de tableau, sous-zone de DS et retour de procédure : type déclaré', () => {
  assert.deepEqual(shown(`
dcl-s t packed(5:1) dim(2);
dcl-ds d;
  n zoned(3:0) inz(-5);
end-ds;
t(2) = 12.3;
dsply t(2);
dsply n;
dsply f();
dcl-proc f;
  dcl-pi *n int(3);
  end-pi;
  return 9;
end-proc;
`), ['  123', '  5-', '  9']);
});

test('les valeurs non numériques ne changent pas', () => {
  assert.deepEqual(shown(`
dcl-s p packed(7:2) inz(0);
dsply ('<' + %char(p) + '>');
`), ['<.00>']);
});

test('expressions décimales : précision IBM i de * et de +', () => {
  assert.deepEqual(shown(`
dcl-s p packed(7:2) inz(1.5);
dsply (p * 2);
dsply (p + 1);
`), ['     300', '     250']);
});

test('expressions constantes calculées à la compilation : chiffres du résultat', () => {
  assert.deepEqual(shown(`
dcl-s t char(1) dim(3);
dcl-c C 20;
dsply (1 + 2);
dsply (C + 1);
dsply %elem(t);
dsply %len('abc');
`), ['3', '21', '3', '3']);
});

test('uns comme int ; -int et %INT en int(20)', () => {
  assert.deepEqual(shown(`
dcl-s u uns(5) inz(7);
dcl-s i int(10) inz(42);
dcl-s p packed(7:2) inz(1.5);
dsply u;
dsply (-i);
dsply %int(p);
`), ['    7', '                  42-', '                   1']);
});

test('DSPLY d une division : longueur d affichage supérieure au maximum (RNF7030)', () => {
  assert.throws(() => shown(`
dcl-s p packed(7:2) inz(1.5);
dsply (p / 2);
`), /RNF7030/);
});

test('entier mêlé à un décimal : int(10) compte pour 10 chiffres ; -décimal, %ABS, %DEC, %LEN d un varchar', () => {
  assert.deepEqual(shown(`
dcl-s p packed(7:2) inz(1.5);
dcl-s i int(10) inz(42);
dcl-s v varchar(10) inz('ab');
dsply (p + i);
dsply (-p);
dsply %len(v);
dsply %dec(p:5:1);
dsply %abs(p);
`), ['         4350', '    150-', '         2', '   15', '    150']);
});

test('DSPLY d une expression numérique dont la précision n est pas connue est refusé', () => {
  assert.throws(() => shown(`
dcl-s p packed(7:2) inz(1);
dsply %scan('b':'abc');
`), /DSPLY.*expression numérique.*%CHAR/);
});
