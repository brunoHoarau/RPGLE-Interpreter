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
  assert.deepEqual(result, { tables: {}, files: {}, programs: {} });
  assert.deepEqual(calls, []);
});

test('un dossier inexistant donne un contexte vide', () => {
  const ctx = loadContextFromFolder(path.join(os.tmpdir(), 'rpgle-ctx-inexistant-' + Date.now()));
  assert.deepEqual(ctx, { tables: {}, files: {}, programs: {} });
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
