const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadContextFromFolder } = require('../out/context');

function folderWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgle-ctx-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

// Le chargement ne doit rien écrire dans la console de l'extension
function silently(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const calls = [];
  console.log = console.warn = console.error = (...args) => calls.push(args);
  try {
    return { result: fn(), calls };
  } finally {
    Object.assign(console, original);
  }
}

test('charge tables.json au format tableau de lignes', () => {
  const dir = folderWith({ 'tables.json': '{ "customers": [ { "id": 1, "name": "Dupont" } ] }' });
  const { result, calls } = silently(() => loadContextFromFolder(dir));
  assert.deepEqual(result.tables.CUSTOMERS.data, [{ id: 1, name: 'Dupont' }]);
  assert.deepEqual(result.tables.CUSTOMERS.columns.map(c => c.name), ['ID', 'NAME']);
  assert.deepEqual(calls, []);
});

test('charge tables.json au format schema + data', () => {
  const dir = folderWith({
    'tables.json': '{ "T": { "schema": { "id": "INT" }, "data": [ { "id": 1 } ] } }',
  });
  const ctx = loadContextFromFolder(dir);
  assert.deepEqual(ctx.tables.T.columns, [{ name: 'ID', type: 'INT' }]);
  assert.deepEqual(ctx.tables.T.data, [{ id: 1 }]);
});

test('un dossier sans tables.json donne un contexte vide', () => {
  const dir = folderWith({});
  const { result, calls } = silently(() => loadContextFromFolder(dir));
  assert.deepEqual(result, { tables: {}, programs: {} });
  assert.deepEqual(calls, []);
});

test('un dossier inexistant donne un contexte vide', () => {
  const ctx = loadContextFromFolder(path.join(os.tmpdir(), 'rpgle-ctx-inexistant-' + Date.now()));
  assert.deepEqual(ctx, { tables: {}, programs: {} });
});

test('un tables.json invalide est une erreur qui nomme le fichier', () => {
  const dir = folderWith({ 'tables.json': '{ "customers": [ ' });
  assert.throws(() => loadContextFromFolder(dir), err => {
    assert.match(err.message, /tables\.json/);
    return true;
  });
});

test('une table qui n\'est ni un tableau ni schema + data est une erreur', () => {
  const dir = folderWith({ 'tables.json': '{ "customers": 42 }' });
  assert.throws(() => loadContextFromFolder(dir), /customers/i);
});

test('tables.json : clés, format et types', () => {
  const dir = folderWith({
    'tables.json': JSON.stringify({ client: {
      format: 'clientf',
      schema: { numcli: 'packed(7:0)', nom: 'CHAR(30)' },
      keys: ['numcli'],
      data: [{ numcli: 1, nom: 'Dupont' }],
    } }),
  });
  const ctx = loadContextFromFolder(dir);
  assert.deepEqual(ctx.tables.CLIENT.keys, ['NUMCLI']);
  assert.equal(ctx.tables.CLIENT.format, 'CLIENTF');
  assert.deepEqual(ctx.tables.CLIENT.columns, [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'NOM', type: 'CHAR(30)' }]);
});

test('tables.json : clé absente du schéma refusée', () => {
  const badKey = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "int(10)" }, "keys": ["b"], "data": [] } }' });
  assert.throws(() => loadContextFromFolder(badKey), /clé 'B'.*schéma/i);
});

test('tables.json : les types du schéma sont conservés tels quels', () => {
  const dir = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "VARCHAR", "b": "DOUBLE", "c": "CLOB" }, "data": [] } }' });
  const ctx = loadContextFromFolder(dir);
  assert.deepEqual(ctx.tables.T.columns, [{ name: 'A', type: 'VARCHAR' }, { name: 'B', type: 'DOUBLE' }, { name: 'C', type: 'CLOB' }]);
});

test('tables.json : keys et format mal formés refusés', () => {
  const badKeys = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "INT" }, "keys": "a", "data": [] } }' });
  assert.throws(() => loadContextFromFolder(badKeys), /Table 'T'.*"keys" doit être une liste de noms de colonnes/);
  const badKeys2 = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "INT" }, "keys": [1], "data": [] } }' });
  assert.throws(() => loadContextFromFolder(badKeys2), /"keys" doit être une liste/);
  const badFormat = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "INT" }, "format": "", "data": [] } }' });
  assert.throws(() => loadContextFromFolder(badFormat), /Table 'T'.*"format" doit être un nom/);
  const badFormat2 = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "INT" }, "format": 5, "data": [] } }' });
  assert.throws(() => loadContextFromFolder(badFormat2), /"format" doit être un nom/);
});

test('tables.json : option unique', () => {
  const ok = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "int(10)" }, "keys": ["a"], "unique": true, "data": [] } }' });
  assert.equal(loadContextFromFolder(ok).tables.T.unique, true);
  const bad = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "int(10)" }, "keys": ["a"], "unique": "oui", "data": [] } }' });
  assert.throws(() => loadContextFromFolder(bad), /"unique" doit être vrai ou faux/);
});
