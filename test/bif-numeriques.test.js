const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./helpers');

const show = expr => run(`dsply %char(${expr});`)[0];

test('%INTH arrondit à l\'entier, demi vers l\'extérieur', () => {
  assert.equal(show('%inth(2.5)'), '3');
  assert.equal(show('%inth(2.49)'), '2');
  assert.equal(show('%inth(-2.5)'), '-3');
  assert.equal(show('%inth(-0.4)'), '0');
});

test('%INTH d\'une variable décimale et d\'une chaîne', () => {
  assert.deepEqual(run(`dcl-s p packed(7:2) inz(1234.50);
dsply %char(%inth(p));
dsply %char(%inth(' 7.5 '));`), ['1235', '8']);
});

test('%DECH arrondit au nombre de décimales demandé', () => {
  assert.equal(show('%dech(1.15:5:1)'), '1.2');
  assert.equal(show('%dech(1.005:5:2)'), '1.01');
  assert.equal(show('%dech(-1.25:5:1)'), '-1.3');
  assert.equal(show('%dech(9.996:5:2)'), '10.00');
});

test('%DECH d\'une variable et affectation', () => {
  assert.deepEqual(run(`dcl-s a packed(9:4) inz(12.3456);
dcl-s b packed(7:2);
b = %dech(a:7:2);
dsply %char(b);`), ['12.35']);
});

test('%DECH exige précision et décimales', () => {
  assert.throws(() => run(`dsply %char(%dech(1.5));`));
});

test('DSPLY de %INTH et %DECH : format de leur résultat', () => {
  assert.deepEqual(run(`dsply %inth(2.5);
dsply %dech(1.15:5:1);`), [run('dcl-s i int(20) inz(3);\ndsply i;')[0], run('dcl-s d packed(5:1) inz(1.2);\ndsply d;')[0]]);
});

test('%CHAR de %DEC(x : p : d) garde les décimales du type packed(p : d)', () => {
  assert.equal(show('%dec(10:5:2)'), '10.00');
  assert.equal(show('%dec(-0.5:5:2)'), '-.50');
});
