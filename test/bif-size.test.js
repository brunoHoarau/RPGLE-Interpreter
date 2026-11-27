const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./helpers');

const sizes = (decls, names) => run(`${decls}\n${names.map(n => `dsply %char(%size(${n}));`).join('\n')}`);

test('%SIZE des types élémentaires, en octets', () => {
  assert.deepEqual(sizes(`dcl-s c char(12);
dcl-s v varchar(20);
dcl-s p packed(7:2);
dcl-s z zoned(5:0);
dcl-s i int(10);
dcl-s b int(5);
dcl-s u uns(20);
dcl-s n ind;`, ['c', 'v', 'p', 'z', 'i', 'b', 'u', 'n']), ['12', '22', '4', '5', '4', '2', '8', '1']);
});

test('%SIZE d\'un littéral caractère', () => {
  assert.deepEqual(run(`dsply %char(%size('abcd'));`), ['4']);
});

test('%SIZE d\'une DS et de ses sous-zones', () => {
  assert.deepEqual(sizes(`dcl-ds d qualified;
  a char(3);
  b packed(5:0);
  c int(10);
end-ds;`, ['d', 'd.a', 'd.b']), ['10', '3', '3']);
});

test('%SIZE d\'une DS avec POS : fin de la sous-zone la plus loin', () => {
  assert.deepEqual(sizes(`dcl-ds d;
  a char(2) pos(9);
  b char(4) pos(1);
end-ds;`, ['d']), ['10']);
});

test('%SIZE d\'un tableau : un élément ; avec *ALL : tous', () => {
  assert.deepEqual(sizes(`dcl-s t char(5) dim(4);
dcl-s a int(10) dim(*auto : 6);`, ['t', 't(2)', 't : *all', 'a : *all']), ['5', '5', '20', '24']);
});

test('%SIZE d\'une DS tableau', () => {
  assert.deepEqual(sizes(`dcl-ds e qualified dim(3);
  x char(2);
  y char(1);
end-ds;`, ['e', 'e : *all', 'e(1).x']), ['3', '9', '2']);
});

test('%SIZE(x : *ALL) d\'une zone qui n\'est pas un tableau est refusé', () => {
  assert.throws(() => run(`dcl-s c char(3);\ndsply %char(%size(c : *all));`), /SIZE/);
});

test('%SIZE encore refusé : dates, littéraux numériques, constantes', () => {
  assert.throws(() => run(`dcl-s d date;\ndsply %char(%size(d));`), /pas encore supporté/);
  assert.throws(() => run(`dsply %char(%size(12.5));`), /pas encore supporté/);
  assert.throws(() => run(`dcl-c k 'abc';\ndsply %char(%size(k));`), /pas encore supporté/);
});
