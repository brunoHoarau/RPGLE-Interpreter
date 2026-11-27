// Controle-types : %INT/%DEC et SQL
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw, customersContext } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;

// === Lot final 1 : %INT/%DEC, SQL non supporté, variables hôtes de DS, NULL ===


test('%INT / %DEC : grammaire IBM du texte numérique', () => {
  assert.deepEqual(run(`dsply %char(%int(' + 3 '));`), ['3']);
  assert.deepEqual(run(`dsply %char(%int('5-'));`), ['-5']);
  assert.deepEqual(run(`dsply %char(%int(' -5 '));`), ['-5']);
  assert.deepEqual(run(`dsply %char(%dec('1,5' : 5 : 1));`), ['1.5']);
  assert.deepEqual(run(`dsply %char(%dec('1.5' : 5 : 1));`), ['1.5']);
  assert.deepEqual(run(`dsply %char(%dec('5-' : 5 : 0));`), ['-5']);
  for (const text of ['1e3', '0x1F', 'Infinity', '', '1.2.3', '--5', '5-3', '1,2,3', '+', '.']) {
    assert.throws(() => run(`dcl-s n int(10); n = %int('${text}'); dsply 'x';`), /RNX0105/, text);
  }
});

test('%DEC : tronque aux décimales demandées', () => {
  assert.deepEqual(run(`dsply %char(%dec(3.456 : 7 : 2));`), ['3.45']);
  assert.deepEqual(run(`dsply %char(%dec(-3.456 : 7 : 2));`), ['-3.45']);
  assert.deepEqual(run(`dsply %char(%dec(1.15 : 7 : 1));`), ['1.1']);
  assert.deepEqual(run(`dsply %char(%dec('3.999' : 7 : 0));`), ['3']);
});

test('%INT / %DEC : 15 chiffres significatifs au plus', () => {
  assert.throws(() => run(`dcl-s n packed(20:0); n = %dec('1234567890123456' : 20 : 0);`), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-s n int(20); n = %int('1234567890123456');`), NOT_SUPPORTED);
  assert.deepEqual(run(`dsply %char(%int('123456789012345'));`), ['123456789012345']);
});

test('SQL : CURRENT_xxx et mots réservés refusés (pas de colonne inconnue)', () => {
  for (const expr of ['current_timestamp', 'current_date', 'current_time', 'current_user', 'current_server', 'current date', 'user', 'session_user']) {
    assert.throws(() => run(`exec sql update customers set city = ${expr} where id = 1; dsply 'x';`, customersContext()), NOT_SUPPORTED, expr);
  }
  assert.throws(() => run(`exec sql insert into customers (id, name) values (9, current_user); dsply 'x';`, customersContext()), NOT_SUPPORTED);
});

test('SQL : variables hôtes qualifiées :ds.champ', () => {
  const ctx = customersContext();
  run(`
    dcl-ds d qualified;
      m packed(7:2) inz(10);
      n char(20);
    end-ds;
    exec sql update customers set balance = balance + :d.m where id = 2;
    exec sql select name, balance into :d.n, :d.m from customers where id = 1;
    dsply d.n;
    dsply %char(d.m);
  `, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[1].BALANCE, 240);
  const out = run(`
    dcl-ds d qualified;
      m packed(7:2) inz(10);
      n char(20);
    end-ds;
    exec sql select name, balance into :d.n, :d.m from customers where id = 1;
    dsply d.n;
    dsply %char(d.m);
    exec sql update customers set city = 'X' where balance = :d.m;
    dsply %char(sqlcod);
    exec sql update customers set city = 'Y' where id = :d.m;
    dsply %char(sqlcod);
  `, customersContext());
  assert.deepEqual(out, ['Dupont', '1500.50', '0', '100']);
});

test('SQL : NULL ramené sans indicateur = SQLCOD -305, variable inchangée', () => {
  const ctx = customersContext();
  ctx.tables.CUSTOMERS.data[0].BALANCE = null;
  const out = runRaw(`
    dcl-s b packed(9:2) inz(7);
    exec sql select balance into :b from customers where id = 1;
    dsply %char(sqlcod);
    dsply sqlstt;
    dsply %char(b);
  `, ctx);
  assert.ok(out.some(l => /^\[SQL\] Erreur: SQLCOD=-305/.test(l)), out.join('|'));
  const dsply = out.filter(l => l.startsWith('[DSPLY')).map(l => l.replace(/^\[DSPLY[^\]]*\]+ /, ''));
  assert.deepEqual(dsply, ['-305', '22002', '7.00']);
});

test('SQL : instructions non supportées arrêtent le programme', () => {
  for (const sql of [
    'declare c1 cursor for select id from customers',
    'open c1',
    'fetch c1 into :n',
    'close c1',
    'set option commit = *none',
    'set :n = 1',
    'values 1 into :n',
    'commit',
    'rollback',
    'call proc(1)',
    'with t as (select id from customers) select id from t',
    'merge into customers using x on 1 = 1',
    'select count(*) into :n from customers',
    'select upper(name) into :s from customers',
    'select name as x into :s from customers',
    'select distinct name into :s from customers',
    'select name into :s from customers order by name',
    'select name into :s from customers fetch first 1 row only',
    'select name into :s from customers c where c.id = 1',
    'select name into :s from customers where name like \'D%\'',
    'select name into :s from customers where id in (1, 2)',
    'select name into :s from customers where id between 1 and 2',
    'select name into :s from customers where upper(name) = \'DUPONT\'',
    'update customers set city = \'X\' where id in (1, 2)',
    'delete from customers where name like \'D%\'',
    'delete from customers where id = 1 -- commentaire',
    'insert into customers (id) select 1 from customers',
  ]) {
    const ctx = customersContext();
    assert.throws(() => run(`dcl-s n int(10); dcl-s s char(20); exec sql ${sql}; dsply 'continue';`, ctx), NOT_SUPPORTED, sql);
    assert.equal(ctx.tables.CUSTOMERS.data.length, 3, sql);
  }
});

test('SQL : les vraies erreurs SQL restent des SQLCOD négatifs', () => {
  for (const sql of [
    'select name into :s from inconnue',
    'select inconnu into :s from customers where id = 1',
    'select name into :s from customers where inconnu = 1',
    'insert into customers (id, name) values (1)',
    'insert into customers (id, id) values (1, 2)',
  ]) {
    const out = runRaw(`dcl-s s char(20); exec sql ${sql}; dsply 'continue';`, customersContext());
    assert.ok(out.some(l => /^\[SQL\] Erreur: SQLCOD=-/.test(l)), sql);
    assert.ok(out.some(l => /continue/.test(l)), sql);
  }
});

// === Lot final 2 ===

