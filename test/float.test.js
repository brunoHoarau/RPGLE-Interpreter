const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./helpers');

const show = (decl, expr) => run(`${decl}\ndsply %char(${expr});`)[0];

test('déclaration FLOAT(4) et FLOAT(8) ; défaut à zéro', () => {
  assert.deepEqual(run(`dcl-s f float(8);
dsply f;`), ['+0.000000000000000E+000']);
  assert.deepEqual(run(`dcl-s f float(4);
dsply f;`), ['+0.0000000E+00']);
});

test('FLOAT sans longueur ou de longueur autre que 4 et 8 est refusé', () => {
  assert.throws(() => run('dcl-s f float(5);'));
  assert.throws(() => run('dcl-s f float;'));
  assert.throws(() => run('dcl-s f float(16);'));
});

test('DSPLY d\'un flottant : signe, mantisse normalisée, exposant à 3 chiffres', () => {
  assert.deepEqual(run(`dcl-s f float(8) inz(1);
dsply f;`), ['+1.000000000000000E+000']);
  assert.deepEqual(run(`dcl-s f float(8) inz(-1234.5);
dsply f;`), ['-1.234500000000000E+003']);
  assert.deepEqual(run(`dcl-s f float(4) inz(0.1);
dsply f;`), ['+1.0000000E-01']);
});

test('littéraux flottants', () => {
  assert.equal(show('dcl-s x char(1);', '1.5E3'), '+1.500000000000000E+003');
  assert.equal(show('dcl-s x char(1);', '4E4'), '+4.000000000000000E+004');
  assert.equal(show('dcl-s x char(1);', '1.2e-3'), '+1.200000000000000E-003');
  assert.equal(show('dcl-s x char(1);', '5E+2'), '+5.000000000000000E+002');
});

test('INZ d\'un flottant, %CHAR sur 23 caractères (8 octets) ou 14 (4 octets)', () => {
  assert.equal(show('dcl-s f float(8) inz(1.125E20);', 'f'), '+1.125000000000000E+020');
  const f4 = show('dcl-s f float(4) inz(1.5E3);', 'f');
  assert.equal(f4, '+1.5000000E+03');
  assert.equal(f4.length, 14);
  assert.equal(show('dcl-s f float(4) inz(-1234.5);', 'f'), '-1.2345000E+03');
  assert.equal(show('dcl-s f float(8) inz(1.5);', 'f * 2'), '+3.000000000000000E+000');
  assert.equal(show('dcl-s f float(4) inz(1.5);', 'f * 2').length, 23);
  assert.equal(show('dcl-s x char(1);', '%float(1)'), '+1.000000000000000E+000');
});

test('%EDITFLT : exemple IBM, décimal converti, longueur selon le type', () => {
  assert.equal(run(`dcl-s f8 float(8) inz(50000);
dsply %editflt(f8 - 4E4);`)[0], '+1.000000000000000E+004');
  assert.equal(run(`dcl-s p packed(5:2) inz(1.5);
dsply %editflt(p);`)[0].length, 23);
  assert.equal(run(`dcl-s f float(4) inz(1.5);
dsply %editflt(f);`)[0].length, 14);
});

test('%FLOAT : exemples IBM', () => {
  assert.deepEqual(run(`dcl-s p1 packed(15:0) inz(1);
dcl-s p2 packed(25:13) inz(3);
dcl-s r packed(15:5);
r = %float(p1) / p2;
dsply %char(r);`), ['.33333']);
  assert.equal(show('dcl-s x char(1);', "%float('-5.2e-1')"), '-5.200000000000000E-001');
  assert.equal(show('dcl-s x char(1);', "%float(' + 5 . 2 ')"), '+5.200000000000000E+000');
});

test('%FLOAT d\'un texte invalide : statut 00105', () => {
  assert.deepEqual(run(`dcl-s f float(8);
monitor;
  f = %float('abc');
  dsply 'non';
on-error 00105;
  dsply 'erreur';
endmon;`), ['erreur']);
});

test('flottant vers décimal : troncature de la valeur binaire exacte', () => {
  assert.equal(run(`dcl-s f float(8) inz(0.29);
dcl-s p packed(5:2);
p = f;
dsply %char(p);`)[0], '.28');
  assert.equal(show('dcl-s f float(8) inz(0.29);', '%dech(f:5:2)'), '.29');
  assert.equal(show('dcl-s f float(8) inz(0.29);', '%dec(f:5:2)'), '.28');
  assert.equal(show('dcl-s x char(1);', '%int(-2.7E0)'), '-2');
  assert.equal(show('dcl-s x char(1);', '%inth(2.5E0)'), '3');
  assert.equal(run(`dcl-s f float(8) inz(7.9);
dcl-s i int(10);
i = f;
dsply %char(i);`)[0], '7');
});

test('flottant vers packed trop petit : dépassement 00103', () => {
  assert.deepEqual(run(`dcl-s f float(8) inz(1E5);
dcl-s p packed(3:0);
monitor;
  p = f;
on-error 00103;
  dsply 'dépassement';
endmon;`), ['dépassement']);
});

test('FLOAT(4) stocke la valeur à simple précision', () => {
  assert.deepEqual(run(`dcl-s f4 float(4);
dcl-s f8 float(8);
f4 = 0.1;
f8 = f4;
dsply f8;`), ['+1.000000014901161E-001']);
});

test('%SIZE d\'un flottant, sous-zone de DS', () => {
  assert.equal(show('dcl-s f float(4); dcl-s g float(8);', '%size(f)'), '4');
  assert.equal(show('dcl-s g float(8);', '%size(g)'), '8');
  assert.equal(show('dcl-ds d qualified;\n  a char(1);\n  g float(8);\nend-ds;', '%size(d)'), '9');
});

test('paramètre FLOAT(8) VALUE recevant un packed, procédure retournant FLOAT(8)', () => {
  assert.deepEqual(run(`dcl-proc half;
  dcl-pi *n float(8);
    x float(8) value;
  end-pi;
  return x / 2;
end-proc;
dcl-s p packed(5:1) inz(3);
dsply half(p);
dsply %char(half(p));`), ['+1.500000000000000E+000', '+1.500000000000000E+000']);
});

test('refus : %EDITC, %HIVAL, %DEC sans précision, char <-> float', () => {
  const f = 'dcl-s f float(8) inz(1);\n';
  assert.throws(() => run(`${f}dsply %editc(f:'1');`));
  assert.throws(() => run(`${f}dsply %char(%hival(f));`));
  assert.throws(() => run(`${f}dsply %char(%dec(f));`));
  assert.throws(() => run(`${f}dcl-s c char(10);\nc = f;`));
  assert.throws(() => run(`${f}f = 'abc';`));
});

test('refus : division flottante par zéro, débordement', () => {
  assert.throws(() => run(`dcl-s f float(8) inz(1);\ndcl-s z float(8);\nf = f / z;`));
  assert.throws(() => run(`dcl-s f float(8) inz(1E308);\nf = f * 10;`));
});

test('-x, %ABS, élément de tableau et sous-zone de DS sont flottants', () => {
  assert.deepEqual(run(`dcl-s f float(4) inz(2);
dcl-s a float(8) dim(2);
dcl-ds d qualified;
  g float(4);
end-ds;
a(1) = 0.5;
d.g = 1.5;
dsply %char(-f);
dsply %char(%abs(-f));
dsply a(1);
dsply d.g;`), ['-2.000000000000000E+000', '+2.000000000000000E+000', '+5.000000000000000E-001', '+1.5000000E+00']);
});

test('comparaison flottant et décimal, identifiant FLOAT dans un nom : numérique', () => {
  assert.deepEqual(run(`dcl-s f float(8) inz(1.5);
dcl-s p packed(3:1) inz(1.5);
if f = p;
  dsply 'egal';
endif;`), ['egal']);
});
