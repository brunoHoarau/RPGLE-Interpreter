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

test('%HIVAL et %LOVAL d\'une zone packée ou zonée', () => {
  assert.deepEqual(run(`dcl-s p packed(5:2);
dcl-s z zoned(3:0);
dsply %char(%hival(p));
dsply %char(%loval(p));
dsply %char(%hival(z));
dsply %char(%loval(z));`), ['999.99', '-999.99', '999', '-999']);
});

test('%HIVAL et %LOVAL d\'un entier signé ou non signé', () => {
  assert.deepEqual(run(`dcl-s i int(5);
dcl-s b int(3);
dcl-s u uns(10);
dsply %char(%hival(i));
dsply %char(%loval(i));
dsply %char(%loval(b));
dsply %char(%hival(u));
dsply %char(%loval(u));`), ['32767', '-32768', '-128', '4294967295', '0']);
});

test('%HIVAL et %LOVAL d\'une date, d\'une sous-zone, d\'un élément', () => {
  assert.deepEqual(run(`dcl-s d date;
dcl-ds s qualified;
  n packed(3:1);
end-ds;
dcl-s t int(10) dim(2);
dsply %char(%hival(d));
dsply %char(%loval(s.n));
dsply %char(%hival(t(1)));`), ['9999-12-31', '-99.9', '2147483647']);
});

test('%HIVAL et %LOVAL encore refusés : caractère, entier de 20 chiffres, expression', () => {
  assert.throws(() => run(`dcl-s c char(3);\ndsply %char(%hival(c));`), /pas encore supporté/);
  assert.throws(() => run(`dcl-s i int(20);\ndsply %char(%hival(i));`), /pas encore supporté/);
  assert.throws(() => run(`dsply %char(%loval(1 + 2));`), /pas encore supporté/);
});
