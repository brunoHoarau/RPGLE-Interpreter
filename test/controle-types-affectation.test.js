// Controle-types : opérateurs, conditions et affectations typées
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw, customersContext } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;
const READ_ONLY = /affectation refusée par le compilateur IBM i/i;

test('mélange caractère / numérique refusé dans les opérateurs', () => {
  for (const src of [
    `dcl-s total packed(7:2) inz(1500.5); dsply 'Total : ' + total;`,
    `dcl-s n int(10) inz(1); dcl-s c char(5) inz('a'); dsply %char(n + c);`,
    `dcl-s c char(5) inz('a'); dcl-s n int(10); n = c * 2;`,
    `dcl-s c char(5) inz('a'); dcl-s n int(10); n = -c;`,
    `dcl-s n int(10) inz(1); if n = '1'; endif;`,
    `dcl-s n int(10) inz(1); if n = *on; endif;`,
    `dcl-s n int(10) inz(1); dcl-s m int(10) inz(2); if n and m; endif;`,
    `dcl-s n int(10) inz(1); if not n; endif;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('conditions : un indicateur est obligatoire', () => {
  for (const src of [
    `dcl-s nb int(10) inz(5); if nb; endif;`,
    `dcl-s c char(1) inz('1'); if c; endif;`,
    `dcl-s nb int(10) inz(5); dow nb; endif;`.replace('endif', 'enddo'),
    `dcl-s nb int(10); select; when nb; endsl;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('formes valides inchangées', () => {
  const out = run(`
    dcl-s n packed(7:2) inz(10);
    dcl-s c varchar(20) inz('a');
    dcl-s b ind inz(*on);
    c = c + 'b' + %char(n);
    n = n * 2 - 1;
    if b and n > 5 and c = 'ab10.00' and *in50 = '0' and b = '1';
      dsply c;
    endif;
    if not (n = 0);
      dsply %char(n);
    endif;
  `);
  assert.deepEqual(out, ['ab10.00', '19.00']);
});

test('indicateur dans une concaténation : pas encore supporté', () => {
  assert.throws(() => run(`dsply 'x' + *in50;`), NOT_SUPPORTED);
});

test('affectation : numérique et caractère ne se mélangent pas', () => {
  for (const src of [
    `dcl-s c char(5); dcl-s n int(10) inz(3); c = n;`,
    `dcl-s n int(10); n = '12';`,
    `dcl-s n int(10); dcl-s b ind; n = b;`,
    `dcl-s b ind; b = 1;`,
    `dcl-s b ind; b = 'x';`,
    `dcl-s c char(5) inz(12);`,
    `dcl-ds d; n int(10) inz('a'); end-ds;`,
    `dcl-s n int(10); n += 'a';`,
    `p('a'); dcl-proc p; dcl-pi *n; n int(10) value; end-pi; end-proc;`,
    `dsply %char(f()); dcl-proc f; dcl-pi *n int(10); end-pi; return 'a'; end-proc;`,
    `dcl-s i int(10); for i = 'a' to 3; endfor;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('affectation : formes valides', () => {
  const out = run(`
    dcl-s c char(3);
    dcl-s b ind;
    dcl-s n int(10);
    b = '1';
    c = b;
    dsply c;
    b = *off;
    n = %int('42') + 1;
    dsply %char(n);
  `);
  assert.deepEqual(out, ['1', '43']);
});

test('*ZEROS et *BLANKS selon la cible', () => {
  const out = run(`
    dcl-s code char(5) inz('abc');
    dcl-s n packed(5:2) inz(3);
    code = *zeros;
    dsply '[' + code + ']';
    if code = *zeros;
      dsply 'que des zeros';
    endif;
    code = *blanks;
    if code = *blanks;
      dsply 'vide';
    endif;
    n = *zeros;
    if n = *zero;
      dsply 'zero';
    endif;
  `);
  assert.deepEqual(out, ['[00000]', 'que des zeros', 'vide', 'zero']);
  assert.throws(() => run(`dcl-s n int(10); n = *blanks;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s n int(10); if n = *blanks; endif;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s v varchar(5); v = *zeros;`), NOT_SUPPORTED);
});

test('les données des bouchons et du SQL restent converties', () => {
  const ctx = customersContext();
  const out = run(`
    dcl-s nom char(20);
    dcl-s solde packed(9:2);
    exec sql select name, balance into :nom, :solde from customers where id = 1;
    dsply %trim(nom) + ' ' + %char(solde);
  `, ctx);
  assert.deepEqual(out, ['Dupont 1500.50']);
});

test('constante globale protégée après une procédure', () => {
  assert.throws(() => parse(`dcl-c N 5; dcl-proc p; dcl-s n int(10); n = 1; end-proc; N = 2;`), READ_ONLY);
});

test('un paramètre CONST ne protège que sa procédure', () => {
  assert.doesNotThrow(() => parse(`dcl-s x int(10); dcl-proc p; dcl-pi *n; x int(10) const; end-pi; end-proc; dcl-proc q; x = 1; end-proc;`));
});

test('un paramètre VALUE reçoit une constante', () => {
  const out = run(`
    dcl-c TAUX 20;
    dsply %char(f(TAUX));
    dcl-proc f;
      dcl-pi *n int(10); t int(10) value; end-pi;
      return t + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['21']);
});

test('variable hôte de SELECT INTO constante : refusée', () => {
  assert.throws(() => parse(`dcl-c K 1; exec sql select id into :K from customers where id = 1;`), /est une constante : affectation refusée par le compilateur IBM i/i);
});

test('FOR : la variable de boucle doit être numérique', () => {
  for (const src of [
    `dcl-s i char(3); for i = 1 to 3; endfor;`,
    `dcl-s i ind; for i = 1 to 3; endfor;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
  assert.deepEqual(run(`dcl-s i int(10); dcl-s s int(10); for i = 1 to 3; s += i; endfor; dsply %char(s);`), ['6']);
});

test('INSERT ... SELECT : une constante en entrée est acceptée', () => {
  assert.doesNotThrow(() => parse(`dcl-c K 1; exec sql insert into customers (id, name) select :K, 'x' from customers where id = 1;`));
});

test('%INT et %DEC : texte décimal seulement', () => {
  for (const src of [`dcl-s n int(10); n = %int('1e3');`, `dcl-s n int(10); n = %int('0x1F');`, `dcl-s n packed(5:0); n = %dec('Infinity' : 5 : 0);`]) {
    assert.throws(() => run(src), /RNX0105/, src);
  }
  assert.deepEqual(run(`dsply %char(%int(' -5 '));`), ['-5']);
});

test('SQL : table vide sans colonnes déclarées refusée à l\'INSERT', () => {
  const ctx = { tables: { T: { columns: [], data: [] } }, files: {}, programs: {} };
  assert.throws(() => run(`exec sql insert into t (id) values (1);`, ctx), /Table T vide sans colonnes déclarées.*pas encore support/i);
  const ok = { tables: { T: { columns: [{ name: 'ID', type: 'INT' }], data: [] } }, files: {}, programs: {} };
  assert.ok(runRaw(`exec sql insert into t (id) values (1);`, ok).some(l => /Succès/.test(l)));
});

test('SQL : colonne en double = erreur SQL', () => {
  const out = runRaw(`exec sql insert into customers (id, id) values (9, 9);`, customersContext());
  assert.ok(out.some(l => /SQLCOD=-1/.test(l)));
  const out2 = runRaw(`exec sql update customers set balance = 1, balance = 2;`, customersContext());
  assert.ok(out2.some(l => /SQLCOD=-1/.test(l)));
});

test('SQL : calcul au-delà de 15 chiffres : pas encore supporté', () => {
  assert.throws(() => run(`exec sql update customers set balance = balance * 1000000000000;`, customersContext()), NOT_SUPPORTED);
});
