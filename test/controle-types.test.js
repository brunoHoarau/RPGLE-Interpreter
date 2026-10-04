// Lot « contrôle des types et corrections » : comportements alignés sur IBM i
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw, customersContext } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

test('DSPLY : message, file de messages, puis réponse', () => {
  const out = run(`
    dcl-s rep char(1);
    dsply 'Continuer ?' '' rep;
    dsply 'reponse=[' + rep + ']';
  `);
  assert.deepEqual(out, ['Continuer ?', 'reponse=[Y]']);
});

test('DSPLY : file de messages indiquée', () => {
  assert.deepEqual(run(`dsply 'Info' '*EXT';`), ['Info (File: *EXT)']);
  assert.deepEqual(run(`dsply 'Info' *ext;`), ['Info (File: *ext)']);
  assert.deepEqual(run(`dsply 'Info' *blank;`), ['Info']);
});

test('DSPLY : la réponse doit être une variable, 3 opérandes au plus', () => {
  assert.throws(() => parse(`dsply 'Q' '' 'x';`), /réponse de DSPLY doit être une variable/i);
  assert.throws(() => parse(`dcl-s r char(1); dsply 'Q' '' r r;`), /au plus 3 opérandes/i);
});

test('DSPLY : réponse dans un champ de DS', () => {
  const out = run(`
    dcl-ds saisie qualified;
      choix char(1);
    end-ds;
    dsply 'Choix ?' '' saisie.choix;
    dsply saisie.choix;
  `);
  assert.deepEqual(out, ['Choix ?', 'Y']);
});

test('SQL SET : calcul avec colonnes, variables hôtes et priorités', () => {
  const ctx = customersContext();
  run(`
    dcl-s bonus packed(7:2) inz(10);
    exec sql update customers set balance = balance + 100 where id = 2;
    exec sql update customers set balance = (balance - :bonus) * 2 + 1 where id = 3;
  `, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[1].BALANCE, 330);
  assert.equal(ctx.tables.CUSTOMERS.data[2].BALANCE, 1762.5);
});

test('SQL SET : une colonne prend la valeur de la ligne avant mise à jour', () => {
  const ctx = customersContext();
  run(`exec sql update customers set name = city, city = name where id = 1;`, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[0].NAME, 'Paris');
  assert.equal(ctx.tables.CUSTOMERS.data[0].CITY, 'Dupont');
});

test('SQL : virgules et égal dans les littéraux', () => {
  const ctx = customersContext();
  run(`
    exec sql insert into customers (id, name, city, balance) values (4, 'Dupont, Jean', 'Nice', 2 * 50);
    exec sql update customers set city = 'a=b, c' where id = 4;
  `, ctx);
  const row = ctx.tables.CUSTOMERS.data[3];
  assert.equal(row.NAME, 'Dupont, Jean');
  assert.equal(row.CITY, 'a=b, c');
  assert.equal(row.BALANCE, 100);
});

test('SQL : NULL dans un calcul donne NULL', () => {
  const ctx = customersContext();
  run(`exec sql update customers set balance = null + 1 where id = 1;`, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[0].BALANCE, null);
});

test('SQL : expression non supportée, le programme s\'arrête', () => {
  for (const sql of [
    `exec sql update customers set name = upper(name) where id = 1;`,
    `exec sql update customers set name = concat(name, 'x') where id = 1;`,
    `exec sql update customers set balance = name + 1 where id = 1;`,
  ]) {
    assert.throws(() => run(`${sql} dsply 'continue';`, customersContext()), NOT_SUPPORTED, sql);
  }
});

test('SQL : une vraie erreur SQL reste un SQLCOD négatif', () => {
  const out = runRaw(`exec sql update inconnue set a = 1 where b = 2; dsply 'apres';`, customersContext());
  assert.ok(out.some(l => /SQLCOD=-1/.test(l)));
  assert.ok(out.some(l => /apres/.test(l)));
});
