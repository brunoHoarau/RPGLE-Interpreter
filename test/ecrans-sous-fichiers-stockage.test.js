// Sous-fichiers : stockage des lignes (rangs, drapeau « modifié », position de READC)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Subfile } = require(path.join(__dirname, '..', 'out', 'screens', 'subfile'));

const rec = (code, changed = false) => ({ values: new Map([['CODE', code]]), indicators: '', changed });

test('Subfile : write refuse rang hors 1-9999, doublon, trou, dépassement non extensible', () => {
  const sf = new Subfile(7, 7, false);
  assert.equal(sf.write(1, rec('A')), undefined);
  assert.match(sf.write(0, rec('X')), /rang 0.*1 à 9999/);
  assert.match(sf.write(10000, rec('X')), /rang 10000.*1 à 9999/);
  assert.match(sf.write(1, rec('X')), /rang 1 déjà présent/);
  assert.match(sf.write(3, rec('X')), /rang 3.*trou/);
  for (let i = 2; i <= 7; i++) assert.equal(sf.write(i, rec(`R${i}`)), undefined);
  assert.match(sf.write(8, rec('X')), /rang 8.*taille 7/);
  assert.equal(sf.count, 7);
});

test('Subfile : extensible, le rang dépasse la taille', () => {
  const sf = new Subfile(14, 7, true);
  for (let i = 1; i <= 20; i++) assert.equal(sf.write(i, rec(`R${i}`)), undefined);
  assert.equal(sf.count, 20);
});

test('Subfile : chain et update', () => {
  const sf = new Subfile(7, 7, false);
  sf.write(1, rec('A'));
  assert.equal(sf.chain(2), undefined);
  assert.equal(sf.chain(1).values.get('CODE'), 'A');
  sf.update(1, rec('B', true));
  assert.equal(sf.chain(1).values.get('CODE'), 'B');
  assert.equal(sf.chain(1).changed, true);
});

test('Subfile : readChanged en ordre de rang, position conservée jusqu\'à resetPosition', () => {
  const sf = new Subfile(7, 7, false);
  sf.write(1, rec('A'));
  sf.write(2, rec('B', true));
  sf.write(3, rec('C'));
  sf.write(4, rec('D', true));
  assert.equal(sf.readChanged().rrn, 2);
  assert.equal(sf.chain(2).changed, false);
  sf.update(2, rec('B', true));            // remarquée derrière la position : pas relue avant resetPosition
  assert.equal(sf.readChanged().rrn, 4);
  assert.equal(sf.readChanged(), undefined);
  sf.resetPosition();
  assert.equal(sf.readChanged().rrn, 2);
  assert.equal(sf.readChanged(), undefined);
});

test('Subfile : initialize crée size lignes non modifiées', () => {
  const sf = new Subfile(5, 5, false);
  sf.initialize(() => new Map([['CODE', '']]));
  assert.equal(sf.count, 5);
  assert.equal(sf.chain(5).changed, false);
  assert.equal(sf.chain(5).values.get('CODE'), '');
  assert.equal(sf.readChanged(), undefined);
  assert.match(sf.write(3, rec('X')), /déjà présent/);
});

test('Subfile : clear et delete vident ; page à page : drapeaux et position repartent de zéro', () => {
  const sf = new Subfile(7, 7, false);
  sf.write(1, rec('A', true));
  sf.write(2, rec('B', true));
  assert.equal(sf.readChanged().rrn, 1);
  sf.clear();
  assert.equal(sf.count, 0);
  sf.write(1, rec('C', true));
  sf.write(2, rec('D'));
  assert.equal(sf.readChanged().rrn, 1);   // la position est repartie de zéro
  assert.equal(sf.readChanged(), undefined);
  sf.delete();
  assert.equal(sf.count, 0);
  assert.equal(sf.chain(1), undefined);
});

test('Subfile : pageOf et rows', () => {
  const sf = new Subfile(20, 7, true);
  for (let i = 1; i <= 20; i++) sf.write(i, rec(`R${i}`));
  assert.equal(sf.pageOf(1), 1);
  assert.equal(sf.pageOf(7), 1);
  assert.equal(sf.pageOf(8), 2);
  assert.deepEqual(sf.rows(1), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(sf.rows(3), [15, 16, 17, 18, 19, 20]);
  assert.deepEqual(sf.rows(4), []);
});
