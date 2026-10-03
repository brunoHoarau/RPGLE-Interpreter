const test = require('node:test');
const assert = require('node:assert/strict');
const { run, customersContext } = require('./helpers');

const names = ctx => ctx.tables.CUSTOMERS.data.map(r => r.NAME);

test('une clause WHERE non supportée renvoie une erreur sans rien supprimer', () => {
  const ctx = customersContext();
  const out = run(`
    exec sql delete from customers where name like 'D%';
    dsply %char(sqlcod);
  `, ctx);
  assert.ok(Number(out[0]) < 0, `SQLCOD attendu négatif, reçu ${out[0]}`);
  assert.equal(ctx.tables.CUSTOMERS.data.length, 3);
});

test('UPDATE respecte AND', () => {
  const ctx = customersContext();
  run(`exec sql update customers set city = 'X' where id = 1 and name = 'Personne';`, ctx);
  assert.deepEqual(ctx.tables.CUSTOMERS.data.map(r => r.CITY), ['Paris', 'Lyon', 'Marseille']);
});

test('DELETE respecte OR', () => {
  const ctx = customersContext();
  run(`exec sql delete from customers where id = 1 or name = 'Bernard';`, ctx);
  assert.deepEqual(names(ctx), ['Martin']);
});

test('AND est prioritaire sur OR', () => {
  const ctx = customersContext();
  run(`exec sql delete from customers where id = 3 or id = 1 and name = 'Personne';`, ctx);
  assert.deepEqual(names(ctx), ['Dupont', 'Martin']);
});

test('les parenthèses et NOT sont supportés dans WHERE', () => {
  const ctx = customersContext();
  run(`exec sql delete from customers where not (id = 1 or id = 2);`, ctx);
  assert.deepEqual(names(ctx), ['Dupont', 'Martin']);
});

test('une variable hôte non déclarée dans WHERE est une erreur', () => {
  const ctx = customersContext();
  const out = run(`
    exec sql delete from customers where id = :inconnu;
    dsply %char(sqlcod);
  `, ctx);
  assert.ok(Number(out[0]) < 0);
  assert.equal(ctx.tables.CUSTOMERS.data.length, 3);
});

test('une colonne inconnue dans WHERE est une erreur', () => {
  const ctx = customersContext();
  const out = run(`
    exec sql update customers set city = 'X' where pays = 'FR';
    dsply %char(sqlcod);
  `, ctx);
  assert.ok(Number(out[0]) < 0);
  assert.deepEqual(ctx.tables.CUSTOMERS.data.map(r => r.CITY), ['Paris', 'Lyon', 'Marseille']);
});

test('un nom de colonne dans une chaîne littérale n\'est pas remplacé', () => {
  const ctx = customersContext();
  ctx.tables.CUSTOMERS.data[1].NAME = 'CITY';
  run(`exec sql delete from customers where name = 'CITY';`, ctx);
  assert.deepEqual(names(ctx), ['Dupont', 'Bernard']);
});

test('une variable hôte alpha est comparée à une colonne numérique', () => {
  const out = run(`
    dcl-s vId char(5) inz('2');
    dcl-s vName char(20);
    exec sql select name into :vName from customers where id = :vId;
    dsply vName;
  `, customersContext());
  assert.deepEqual(out, ['Martin']);
});

test('les comparaisons alpha ignorent les blancs de fin', () => {
  const out = run(`
    dcl-s vName char(20);
    exec sql select name into :vName from customers where city = 'Lyon  ';
    dsply vName;
  `, customersContext());
  assert.deepEqual(out, ['Martin']);
});

test('les opérateurs <, >=, <> fonctionnent', () => {
  const ctx = customersContext();
  run(`exec sql delete from customers where balance < 1000 and id <> 3;`, ctx);
  assert.deepEqual(names(ctx), ['Dupont', 'Bernard']);
});

test('INSERT résout les variables hôtes', () => {
  const ctx = customersContext();
  run(`
    dcl-s vId int(10) inz(9);
    dcl-s vName char(20) inz('Zed');
    exec sql insert into customers (id, name) values (:vId, :vName);
  `, ctx);
  assert.deepEqual(ctx.tables.CUSTOMERS.data[3], { ID: 9, NAME: 'Zed' });
});

test('UPDATE SET résout les variables hôtes', () => {
  const ctx = customersContext();
  run(`
    dcl-s vCity char(20) inz('Lille');
    exec sql update customers set city = :vCity where id = 2;
  `, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[1].CITY, 'Lille');
});

test('UPDATE sans ligne trouvée renvoie SQLCOD 100', () => {
  const out = run(`
    exec sql update customers set city = 'X' where id = 999;
    dsply %char(sqlcod);
  `, customersContext());
  assert.deepEqual(out, ['100']);
});

test('DELETE sans ligne trouvée renvoie SQLCOD 100', () => {
  const out = run(`
    exec sql delete from customers where id = 999;
    dsply %char(sqlcod);
  `, customersContext());
  assert.deepEqual(out, ['100']);
});
