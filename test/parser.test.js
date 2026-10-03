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
