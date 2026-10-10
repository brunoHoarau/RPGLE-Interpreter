// Fichiers écran : image AREA du protocole SPECIAL et chaîne des indicateurs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const area = require(path.join(__dirname, '..', 'out', 'screens', 'area'));

const char = (name, length, usage = 'B') => ({ name, usage, length, type: { type: 'DataType', typeName: 'char', length } });
const zoned = (name, length, decimals, usage = 'B') =>
  ({ name, usage, length, type: { type: 'DataType', typeName: 'zoned', length, decimals } });

test('AREA : char complété à blanc, aller-retour', () => {
  const fields = [char('CODE', 6), char('CLE', 3, 'H')];
  const image = area.encodeArea(fields, new Map([['CODE', 'AB'], ['CLE', 'xyz']]));
  assert.equal(image, 'AB    xyz');
  assert.deepEqual([...area.decodeArea(fields, image)], [['CODE', 'AB    '], ['CLE', 'xyz']]);
});

test('AREA : valeur absente = blancs ou zéros', () => {
  const fields = [char('A', 2), zoned('N', 3, 0)];
  assert.equal(area.encodeArea(fields, new Map()), '  000');
});

test('AREA : zoned positif, zéros de tête, décimales', () => {
  const fields = [zoned('QTE', 5, 0), zoned('PRIX', 5, 2)];
  const image = area.encodeArea(fields, new Map([['QTE', 42], ['PRIX', 12.5]]));
  assert.equal(image, '0004201250');
  assert.deepEqual([...area.decodeArea(fields, image)], [['QTE', 42], ['PRIX', 12.5]]);
});

test('AREA : zoned négatif (dernière position J..R, } pour 0)', () => {
  const f = [zoned('N', 3, 0)];
  assert.equal(area.encodeArea(f, new Map([['N', -12]])), '01K');
  assert.equal(area.decodeArea(f, '01K').get('N'), -12);
  assert.equal(area.encodeArea(f, new Map([['N', -10]])), '01}');
  assert.equal(area.decodeArea(f, '01}').get('N'), -10);
  assert.equal(area.encodeArea(f, new Map([['N', -1]])), '00J');
  assert.equal(area.encodeArea(f, new Map([['N', -9]])), '00R');
  assert.equal(area.decodeArea(f, '00R').get('N'), -9);
});

test('AREA : zoned négatif avec décimales', () => {
  const f = [zoned('N', 5, 2)];
  const image = area.encodeArea(f, new Map([['N', -12.5]]));
  assert.equal(image, '0125}');
  assert.equal(area.decodeArea(f, image).get('N'), -12.5);
});

test('AREA : zéro', () => {
  const f = [zoned('N', 3, 0)];
  assert.equal(area.encodeArea(f, new Map([['N', 0]])), '000');
  assert.equal(area.decodeArea(f, '000').get('N'), 0);
});

test('AREA : valeur numérique trop grande pour la zone = erreur', () => {
  const f = [zoned('N', 3, 0)];
  assert.throws(() => area.encodeArea(f, new Map([['N', 1000]])), /ne tient pas/);
  assert.throws(() => area.encodeArea(f, new Map([['N', -1000]])), /ne tient pas/);
});

test('AREA : char trop long tronqué, image de mauvaise longueur refusée', () => {
  assert.equal(area.encodeArea([char('A', 2)], new Map([['A', 'XYZ']])), 'XY');
  assert.throws(() => area.decodeArea([char('A', 4)], 'AB'), /longueur/);
});

test('indicateurs : chaîne de 99 caractères et lecture inverse', () => {
  const s = area.indicatorsString(n => n === 1 || n === 99);
  assert.equal(s.length, 99);
  assert.equal(s[0], '1');
  assert.equal(s[98], '1');
  assert.equal(s.slice(1, 98), '0'.repeat(97));
  const back = area.parseIndicators(s);
  assert.equal(back[1], true);
  assert.equal(back[2], false);
  assert.equal(back[99], true);
});
