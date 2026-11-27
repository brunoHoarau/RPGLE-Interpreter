// Controle-types : SELECT INTO, dates et SQL
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw, customersContext } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;
function datedContext() {
  return {
    tables: {
      ACCOUNTS: {
        columns: [{ name: 'ID', type: 'integer' }, { name: 'DATE', type: 'char' }, { name: 'CURRENT_BALANCE', type: 'decimal' }, { name: 'USER', type: 'char' }],
        data: [
          { ID: 1, DATE: '2026-01-01', CURRENT_BALANCE: 10, USER: 'ann' },
          { ID: 2, DATE: '2026-02-02', CURRENT_BALANCE: -3, USER: 'bob' },
        ],
      },
    },
    files: {},
    programs: {},
  };
}

// === Lot 3 ===


test('SQL : colonnes nommées DATE, USER ou CURRENT_xxx traitées comme des colonnes', () => {
  const ctx = datedContext();
  const out = run(`
    dcl-s d char(10) inz('2026-02-02');
    dcl-s n int(10);
    exec sql update accounts set current_balance = current_balance + 1 where date = :d;
    exec sql update accounts set user = date where id = 1;
    exec sql select id into :n from accounts where user = '2026-01-01';
    dsply %char(n);
  `, ctx);
  assert.equal(ctx.tables.ACCOUNTS.data[1].CURRENT_BALANCE, -2);
  assert.equal(ctx.tables.ACCOUNTS.data[0].USER, '2026-01-01');
  assert.deepEqual(out, ['1']);
});

test('SQL : colonne DATE dans SELECT et registres spéciaux toujours refusés', () => {
  const ctx = datedContext();
  const out = run(`
    dcl-s d char(10);
    exec sql select date into :d from accounts where id = 2;
    dsply d;
  `, ctx);
  assert.deepEqual(out, ['2026-02-02']);
  assert.throws(() => run(`exec sql update accounts set user = current_timestamp where id = 1;`, datedContext()), NOT_SUPPORTED);
  assert.throws(() => run(`exec sql update accounts set user = current user where id = 1;`, datedContext()), NOT_SUPPORTED);
  assert.throws(() => run(`exec sql update accounts set current_balance = current_balance(1) where id = 1;`, datedContext()), NOT_SUPPORTED);
  assert.throws(() => run(`exec sql delete from accounts where current_date = '2026-01-01';`, datedContext()), NOT_SUPPORTED);
  assert.throws(() => run(`exec sql delete from accounts where date(date) = '2026-01-01';`, datedContext()), NOT_SUPPORTED);
});

test('SELECT INTO : une colonne inconnue n\'affecte aucune variable', () => {
  const ctx = customersContext();
  const out = runRaw(`
    dcl-s a char(10) inz('avant');
    dcl-s b char(10) inz('avant');
    exec sql select name, nope into :a, :b from customers where id = 1;
    dsply %trim(a) + '/' + %trim(b);
  `, ctx).filter(l => /DSPLY/.test(l));
  assert.match(out[0], /avant\/avant/);
});

test('SELECT INTO : une valeur NULL sans indicateur n\'affecte aucune variable (SQLCOD -305)', () => {
  const ctx = customersContext();
  ctx.tables.CUSTOMERS.data[0].CITY = null;
  const out = run(`
    dcl-s a char(10) inz('avant');
    dcl-s b char(10) inz('avant');
    exec sql select name, city into :a, :b from customers where id = 1;
    dsply %trim(a) + '/' + %trim(b);
    dsply %char(sqlcod) + sqlstt;
  `, ctx);
  assert.deepEqual(out, ['avant/avant', '-30522002']);
});

test('SELECT INTO : une DS entière comme cible est refusée', () => {
  assert.throws(() => run(`
    dcl-ds cli qualified;
      id int(10);
      name char(20);
    end-ds;
    exec sql select id, name into :cli from customers where id = 1;
  `, customersContext()), NOT_SUPPORTED);
});

test('WHERE : littéral numérique négatif et where( sans espace', () => {
  const ctx = customersContext();
  ctx.tables.CUSTOMERS.data[1].BALANCE = -3;
  const out = run(`
    dcl-s n int(10);
    exec sql select id into :n from customers where balance < -5 or balance = -3;
    dsply %char(n);
    exec sql select id into :n from customers where(id = 1);
    dsply %char(n);
    exec sql update customers set balance = 0 where balance > -1.5 and balance < 0.5 and id = 99;
    dsply %char(sqlcod);
  `, ctx);
  assert.deepEqual(out, ['2', '1', '100']);
});

test('%DEC : partie entière trop grande refusée, troncature sans -0', () => {
  assert.throws(() => run(`dsply %char(%dec(12345 : 4 : 0));`), NOT_SUPPORTED);
  assert.throws(() => run(`dsply %char(%dec(123.4 : 5 : 3));`), NOT_SUPPORTED);
  assert.deepEqual(run(`dsply %char(%dec(1234 : 4 : 0)); dsply %char(%dec(-12.34 : 4 : 2));`), ['1234', '-12.34']);
  const out = run(`
    dcl-s z packed(5:0);
    z = %dec(-0.4 : 5 : 0);
    dsply %char(%dec(-0.4 : 5 : 0));
    if %dec(-0.4 : 5 : 0) = 0;
      dsply 'zero';
    endif;
  `);
  assert.deepEqual(out, ['0', 'zero']);
});

test('programme principal : un paramètre CONST ne peut pas être passé par référence', () => {
  const callee = `
    dcl-pi *n;
      p char(5) const;
    end-pi;
    modifie(p);
    dcl-proc modifie;
      dcl-pi *n;
        x char(5);
      end-pi;
      x = 'zzzzz';
    end-proc;
  `;
  assert.throws(() => run(`
    dcl-pr appele extpgm('X');
      p char(5) const;
    end-pr;
    appele('abc');
  `, undefined, { resolveProgram: name => (name === 'X' ? { source: callee } : undefined) }), INCOMPATIBLE);
});
