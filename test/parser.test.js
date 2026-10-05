const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parse, parseTerminates } = require('./helpers');

const ROOT = path.join(__dirname, '..');

test('le parser termine sur une instruction hors WHEN dans un SELECT', () => {
  assert.ok(parseTerminates(['select;\n  x = 1;']));
});

test('le parser termine sur un ON-ERROR( non fermé', () => {
  assert.ok(parseTerminates(['monitor; x = 1; on-error(']));
});

test('une instruction avant le premier WHEN est une erreur de syntaxe', () => {
  assert.throws(() => parse('select; x = 1; when 1 = 1; endsl;'), /WHEN/);
});

test('un DSPLY avant le premier WHEN est une erreur de syntaxe', () => {
  assert.throws(() => parse("select; dsply 'a'; when 1 = 1; endsl;"), /WHEN/);
});

// Simule la frappe : le diagnostic temps réel parse chaque état intermédiaire du fichier
test('le parser termine sur chaque préfixe des fichiers d\'exemple', () => {
  const files = [
    path.join(ROOT, 'test.rpgle'),
    ...fs.readdirSync(path.join(ROOT, 'fichiers_test')).map(f => path.join(ROOT, 'fichiers_test', f)),
  ];
  const prefixes = [];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    for (let i = 1; i <= code.length; i++) prefixes.push(code.slice(0, i));
  }
  assert.ok(parseTerminates(prefixes, 60000));
});

test('DCL-F et opérations de fichier : nœuds produits', () => {
  const ast = parse(`
    dcl-f Client keyed usropn;
    dcl-s n packed(7:0);
    setll *start client;
    chain (n : 5) client;
    reade n client;
    if %eof(client) and %found;
    endif;
  `);
  assert.deepEqual(ast.files, [{ type: 'FileDeclaration', name: 'Client', keyed: true, usropn: true, usage: { input: true, output: false, update: false, delete: false }, line: 2 }]);
  const ops = ast.body.filter(n => n.type === 'FileOperation');
  assert.equal(ops.length, 3);
  assert.equal(ops[0].operation, 'setll');
  assert.equal(ops[0].special, 'start');
  assert.equal(ops[1].key.length, 2);
  assert.equal(ops[2].key.length, 1);
  const cond = ast.body.find(n => n.type === 'IfStatement').condition;
  assert.deepEqual(cond.left.value.args, [{ type: 'Expression', value: 'client', valueType: 'file' }]);
});

test('open, close, read... restent utilisables comme noms de variable', () => {
  const ast = parse(`dcl-s open int(5); dcl-s read int(5); open = 1; read += 2; close = open + read;`);
  assert.equal(ast.body.filter(n => n.type === 'Assignment').length, 3);
});

test('USAGE : implications et nœuds d\'écriture', () => {
  const ast = parse(`
    dcl-f a usage(*delete) keyed;
    dcl-f b usage(*output);
    write bf;
    delete (1) af;
    delete af;
    unlock a;
  `);
  assert.deepEqual(ast.files[0].usage, { input: true, output: false, update: true, delete: true });
  assert.deepEqual(ast.files[1].usage, { input: false, output: true, update: false, delete: false });
  const ops = ast.body.filter(n => n.type === 'FileOperation');
  assert.deepEqual(ops.map(o => o.operation), ['write', 'delete', 'delete', 'unlock']);
  assert.equal(ops[1].key.length, 1);
  assert.equal(ops[2].key, undefined);
});

test('write, update, delete, unlock restent utilisables comme noms', () => {
  const ast = parse(`dcl-s write int(5); dcl-s update int(5); write = 1; update += 2; delete = write; unlock = 3;`);
  assert.equal(ast.body.filter(n => n.type === 'Assignment').length, 4);
});
