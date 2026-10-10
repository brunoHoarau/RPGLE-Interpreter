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
  assert.deepEqual(result, { tables: {}, programs: {}, displays: {} });
  assert.deepEqual(calls, []);
});

test('un dossier inexistant donne un contexte vide', () => {
  const ctx = loadContextFromFolder(path.join(os.tmpdir(), 'rpgle-ctx-inexistant-' + Date.now()));
  assert.deepEqual(ctx, { tables: {}, programs: {}, displays: {} });
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

// --- displays.json (fichiers écran) ---

const DISPLAYS_OK = {
  ECRAN01: {
    indara: true,
    keys: { CA03: '03', CA12: null, ROLLDOWN: '07' },
    formats: {
      FMT01: {
        keys: { CF05: '05', ROLLUP: '25' },
        constants: [
          { row: 1, col: 30, text: 'Saisie commande' },
          { row: 22, col: 2, text: 'Code article inconnu', if: '31 N32' },
        ],
        fields: [
          { name: 'CODE', type: 'char(6)', usage: 'B', row: 4, col: 20 },
          { name: 'QTE', type: 'NUMERIC(5,2)', usage: 'I', row: 6, col: 20, if: 'N10' },
          { name: 'CLE', type: 'zoned(7:0)', usage: 'H' },
        ],
      },
    },
  },
};

function displaysContext(raw) {
  return loadContextFromFolder(folderWith({ 'displays.json': JSON.stringify(raw) }));
}

function withDisplay(patch) {
  const raw = JSON.parse(JSON.stringify(DISPLAYS_OK));
  patch(raw.ECRAN01, raw.ECRAN01.formats.FMT01);
  return raw;
}

test('displays.json : un fichier écran valide est normalisé', () => {
  const file = displaysContext(DISPLAYS_OK).displays.ECRAN01;
  assert.equal(file.indara, true);
  assert.deepEqual([...file.keys], [['CA03', 3], ['CA12', null], ['PAGEUP', 7]]);
  const fmt = file.formats.FMT01;
  assert.deepEqual([...fmt.keys], [['CF05', 5], ['PAGEDOWN', 25]]);
  assert.deepEqual(fmt.constants.map(c => [c.row, c.col, c.text, c.condition]), [
    [1, 30, 'Saisie commande', undefined],
    [22, 2, 'Code article inconnu', [{ indicator: 31, negated: false }, { indicator: 32, negated: true }]],
  ]);
  assert.deepEqual(fmt.fields.map(f => [f.name, f.type.typeName, f.type.length, f.type.decimals, f.usage, f.row, f.col, f.length]), [
    ['CODE', 'char', 6, undefined, 'B', 4, 20, 6],
    ['QTE', 'zoned', 5, 2, 'I', 6, 20, 5],
    ['CLE', 'zoned', 7, 0, 'H', undefined, undefined, 7],
  ]);
  assert.deepEqual(fmt.fields[1].condition, [{ indicator: 10, negated: true }]);
});

test('displays.json absent : aucun fichier écran', () => {
  assert.deepEqual(loadContextFromFolder(folderWith({})).displays, {});
});

test('displays.json : indara absent vaut faux', () => {
  const ctx = displaysContext({ E: { keys: {}, formats: {} } });
  assert.equal(ctx.displays.E.indara, false);
});

test('displays.json : chaque erreur de validation cite le chemin', () => {
  const cases = [
    [{ ecran01: DISPLAYS_OK.ECRAN01 }, /displays\.json.*'ecran01'.*majuscules/],
    [withDisplay((f, m) => { f.formats = { fmt01: m }; }), /displays\.json.*format 'fmt01'.*majuscules/],
    [withDisplay((f, m) => { m.fields[0].name = 'code'; }), /displays\.json.*zone 'code'.*majuscules/],
    [withDisplay((f, m) => { m.fields[0].usage = 'X'; }), /displays\.json.*zone 'CODE'.*usage 'X'/],
    [withDisplay((f, m) => { delete m.fields[0].row; }), /displays\.json.*zone 'CODE'.*"row" et "col"/],
    [withDisplay((f, m) => { m.fields[0].col = 78; }), /displays\.json.*zone 'CODE'.*24 lignes/],
    [withDisplay((f, m) => { m.fields[0].row = 25; }), /displays\.json.*zone 'CODE'.*24 lignes/],
    [withDisplay((f, m) => { m.constants[0].col = 70; }), /displays\.json.*constante.*24 lignes/],
    [withDisplay((f, m) => { m.fields[0].type = 'varchar(6)'; }), /displays\.json.*zone 'CODE'.*char\(n\) ou zoned/],
    [withDisplay((f, m) => { m.fields[0].type = 'packed(5:0)'; }), /displays\.json.*zone 'CODE'.*char\(n\) ou zoned/],
    [withDisplay((f, m) => { m.fields[0].type = 'n'; }), /displays\.json.*zone 'CODE'.*type/],
    [withDisplay((f, m) => { f.keys.CA25 = null; }), /displays\.json.*touche 'CA25'/],
    [withDisplay((f, m) => { f.keys.F3 = null; }), /displays\.json.*touche 'F3'/],
    [withDisplay((f, m) => { f.keys.CA03 = '00'; }), /displays\.json.*touche 'CA03'.*01.*99/],
    [withDisplay((f, m) => { f.keys.CA03 = '100'; }), /displays\.json.*touche 'CA03'.*01.*99/],
    [withDisplay((f, m) => { m.keys.CA03 = '04'; }), /displays\.json.*touche 'CA03'.*fichier et au format/],
    [withDisplay((f, m) => { m.keys.PAGEUP = '04'; }), /displays\.json.*touche 'PAGEUP'.*fichier et au format/],
    [withDisplay((f, m) => { m.constants[1].if = 'X1'; }), /displays\.json.*constante.*"if"/],
    [withDisplay((f, m) => { m.constants[1].if = ''; }), /displays\.json.*constante.*"if"/],
    [withDisplay((f, m) => { m.constants[1].if = 5; }), /displays\.json.*constante.*"if"/],
    [withDisplay((f, m) => { m.fields[0].if = '31 N'; }), /displays\.json.*zone 'CODE'.*"if"/],
    [withDisplay((f, m) => { m.constants[1].if = '00'; }), /displays\.json.*constante.*indicateur.*01.*99/],
    [withDisplay((f, m) => { m.fields[0].if = '100'; }), /displays\.json.*zone 'CODE'.*indicateur.*01.*99/],
    [withDisplay((f, m) => { m.fields.push({ name: 'CODE', type: 'char(2)', usage: 'O', row: 9, col: 1 }); }), /displays\.json.*zone 'CODE'.*en double/],
  ];
  for (const [raw, pattern] of cases) {
    assert.throws(() => displaysContext(raw), pattern, pattern.source);
  }
});
