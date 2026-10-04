// Constructions courantes débloquées par le lot « gains rapides »
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

test('+=, -=, *=, /= et **= sur des nombres', () => {
  const out = run(`
    dcl-s n packed(7:2) inz(10);
    n += 5;
    dsply %char(n);
    n -= 2.5;
    dsply %char(n);
    n *= 2 + 2;
    dsply %char(n);
    n /= 5;
    dsply %char(n);
    n **= 2;
    dsply %char(n);
  `);
  assert.deepEqual(out, ['15.00', '12.50', '50.00', '10.00', '100.00']);
});

test('+= concatène du caractère et respecte la longueur déclarée', () => {
  const out = run(`
    dcl-s v varchar(5) inz('ab');
    v += 'cd';
    dsply v;
    v += 'efgh';
    dsply v;
  `);
  assert.deepEqual(out, ['abcd', 'abcde']);
});

test('opérateurs composés sur un champ de DS, avec EVAL, et sur une date', () => {
  const out = run(`
    dcl-ds cpt qualified;
      lignes int(10);
    end-ds;
    dcl-ds totaux;
      montant packed(7:2);
    end-ds;
    dcl-s d date inz(D'2026-10-04');
    cpt.lignes += 1;
    eval cpt.lignes *= 10;
    montant += 1.5;
    d += %days(1);
    dsply %char(cpt.lignes);
    dsply %char(montant);
    dsply d;
  `);
  assert.deepEqual(out, ['10', '1.50', '2026-10-05']);
});

test('opérateur composé : erreurs habituelles', () => {
  assert.throws(() => run(`dcl-s d date; d += 1;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s n int(5) inz(1); n /= 0;`), /RNX0102/);
  assert.throws(() => run(`dcl-s n int(3) inz(100); n += 100;`), /RNX0103/);
  assert.throws(() => run(`inconnu += 1;`), /non déclarée/i);
});

test('les opérateurs ordinaires restent inchangés', () => {
  const out = run(`
    dcl-s n int(10) inz(3);
    dcl-s b ind;
    n = n * 2 ** 2;
    b = *on;
    if n = 12 and b = *on;
      dsply 'ok';
    endif;
    n = -1;
    dsply %char(n);
  `);
  assert.deepEqual(out, ['ok', '-1']);
});
