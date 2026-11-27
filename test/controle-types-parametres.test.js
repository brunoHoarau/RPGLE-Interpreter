// Controle-types : paramètres par référence, CONST et VALUE
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw, customersContext } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;
const DS_DECL = `dcl-ds d qualified; x char(3) inz('abc'); end-ds; dcl-ds e qualified; x char(3); end-ds; dcl-s s char(3);`;

test('paramètre par référence : littéral et expression refusés', () => {
  for (const arg of [`5`, `a + 1`, `%trim(c)`, `'x'`, `*zeros`, `f()`]) {
    const src = `dcl-s a packed(5:0) inz(1); dcl-s c char(5) inz('x');
      q(${arg});
      dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;
      dcl-proc f; dcl-pi *n packed(5:0); end-pi; return 1; end-proc;`;
    assert.throws(() => run(src), INCOMPATIBLE, arg);
  }
});

test('paramètre par référence : prototype de programme, procédure externe et bouchon', () => {
  const ctx = { tables: {}, files: {}, programs: { PGM: { calls: [{ set: { p: 3 } }] } } };
  for (const kind of [`extpgm('PGM')`, `extproc('PGM')`]) {
    const src = `dcl-pr x ${kind}; p packed(5:0); end-pr; x(5);`;
    assert.throws(() => run(src, ctx), INCOMPATIBLE, kind);
  }
});

test('paramètre par référence : paramètre CONST de la procédure courante refusé', () => {
  const src = `
    dcl-s a packed(5:0);
    outer(a);
    dcl-proc outer; dcl-pi *n; k packed(5:0) const; end-pi; q(k); end-proc;
    dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`;
  assert.throws(() => run(src), INCOMPATIBLE);
  // un paramètre CONST passé à un paramètre CONST ou VALUE reste valide
  const out = run(`
    outer(4);
    dcl-proc outer; dcl-pi *n; k packed(5:0) const; end-pi; r(k); s(k + 1); end-proc;
    dcl-proc r; dcl-pi *n; p packed(5:0) const; end-pi; dsply %char(p); end-proc;
    dcl-proc s; dcl-pi *n; p packed(5:0) value; end-pi; dsply %char(p); end-proc;`);
  assert.deepEqual(out, ['4', '5']);
});

test('paramètre par référence : le type déclaré doit être identique', () => {
  for (const src of [
    `dcl-s a int(10); q(a); dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`,
    `dcl-s a char(5); q(a); dcl-proc q; dcl-pi *n; p char(10); end-pi; end-proc;`,
    `dcl-s a packed(5:2); q(a); dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`,
    `dcl-ds d qualified; x int(10); end-ds; q(d.x); dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`,
    `dcl-ds d; x int(10); end-ds; q(x); dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('paramètre par référence : variable de même type, valeur renvoyée à l\'appelant', () => {
  const out = run(`
    dcl-s a char(10) inz('x');
    dcl-s n int(10) inz(1);
    dcl-ds d qualified; x packed(5:0) inz(7); end-ds;
    dcl-s ind1 ind;
    dcl-s v int;
    q(a); r(n); t(d.x); u(ind1); w(v);
    dsply %trim(a) + ' ' + %char(n) + ' ' + %char(d.x) + ' ' + %char(ind1) + ' ' + %char(v);
    dcl-proc q; dcl-pi *n; p char(10); end-pi; p = 'mod'; end-proc;
    dcl-proc r; dcl-pi *n; p int(10); end-pi; p = p + 1; end-proc;
    dcl-proc t; dcl-pi *n; p packed(5:0); end-pi; p = p + 1; end-proc;
    dcl-proc u; dcl-pi *n; p ind; end-pi; p = *on; end-proc;
    dcl-proc w; dcl-pi *n; p int(10); end-pi; p = 9; end-proc;
  `);
  assert.deepEqual(out, ['mod 2 8 1 9']);
});

test('CONST et VALUE acceptent littéraux et expressions', () => {
  const out = run(`
    dcl-s a packed(5:0) inz(1);
    k(5); k(a + 1); l(a + 2); l(7); m('abc'); m(%trim('  x '));
    dcl-proc k; dcl-pi *n; p packed(5:0) const; end-pi; dsply %char(p); end-proc;
    dcl-proc l; dcl-pi *n; p int(10) value; end-pi; dsply %char(p); end-proc;
    dcl-proc m; dcl-pi *n; p char(10) const; end-pi; dsply %trim(p); end-proc;
  `);
  assert.deepEqual(out, ['5', '2', '3', '7', 'abc', 'x']);
});

test('structure de données utilisée comme valeur : pas encore supporté', () => {
  for (const stmt of [
    `d = 'abc';`, `d = *blanks;`, `s = d;`, `if d = *blanks; endif;`, `s = d + 'x';`,
    `dsply d;`, `dsply 'x' + d;`, `p(d);`, `s = %trim(d);`,
  ]) {
    assert.throws(() => run(`${DS_DECL} ${stmt} dcl-proc p; dcl-pi *n; k char(3) const; end-pi; end-proc;`), NOT_SUPPORTED, stmt);
  }
  assert.throws(() => run(`dcl-ds d qualified; x char(3); end-ds; dsply 'q' '' d;`), NOT_SUPPORTED);
});

test('structure de données : les champs restent utilisables', () => {
  const out = run(`${DS_DECL} e.x = d.x; dsply e.x; dcl-ds u; ch char(2) inz('ab'); end-ds; dsply ch; ch = 'zz'; dsply u.ch;`);
  assert.deepEqual(out, ['abc', 'ab', 'zz']);
});

test('réponse de DSPLY : seulement dans une variable caractère', () => {
  for (const decl of [`dcl-s r int(10);`, `dcl-s r packed(5:0);`, `dcl-s r ind;`, `dcl-s r date;`]) {
    assert.throws(() => run(`${decl} dsply 'Q' '' r;`), /réponse de DSPLY dans une variable de type .*pas encore support/i, decl);
  }
  assert.deepEqual(run(`dcl-s r varchar(5); dsply 'Q' '' r; dsply r;`), ['Q', 'Y']);
});

test('indicateur recevant un caractère', () => {
  assert.deepEqual(run(`dcl-s c char(1) inz('1'); dcl-s b ind; b = c; dsply %char(b); c = '0'; b = c; dsply %char(b);`), ['1', '0']);
  assert.throws(() => run(`dcl-s c char(1) inz('x'); dcl-s b ind; b = c;`), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-s b ind; b = 'x';`), INCOMPATIBLE);
});

test('messages : valeur nulle et structure de données', () => {
  const { describeValue } = require('../out/datatypes');
  assert.equal(describeValue(null), 'valeur nulle');
  assert.equal(describeValue(undefined), 'valeur nulle');
  assert.equal(describeValue({ a: 1 }), 'structure de données');
  assert.equal(describeValue('ab'), "caractère 'ab'");
});

test('SELECT INTO : plusieurs lignes = SQLCOD -811, variables inchangées', () => {
  const out = runRaw(`
    dcl-s s char(20) inz('avant');
    exec sql select name into :s from customers;
    dsply %char(sqlcod);
    dsply sqlstt;
    dsply s;
  `, customersContext());
  assert.ok(out.some(l => /^\[SQL\] Erreur: SQLCOD=-811/.test(l)), out.join('|'));
  const dsply = out.filter(l => l.startsWith('[DSPLY')).map(l => l.replace(/^\[DSPLY[^\]]*\]+ /, ''));
  assert.deepEqual(dsply, ['-811', '21000', 'avant']);
});

test('SELECT INTO : nombre de colonnes différent du nombre de variables', () => {
  for (const sql of [
    'select name, city into :s from customers where id = 1',
    'select name into :s, :t from customers where id = 1',
  ]) {
    const out = runRaw(`dcl-s s char(20) inz('avant'); dcl-s t char(20) inz('avant'); exec sql ${sql}; dsply s; dsply t;`, customersContext());
    assert.ok(out.some(l => /^\[SQL\] Erreur: SQLCOD=-\d+/.test(l)), sql + out.join('|'));
    assert.ok(!out.some(l => /Dupont|Paris/.test(l)), sql);
  }
});
