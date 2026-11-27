// Files-core : écriture, verrous, lecture sans verrou
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const f = require(path.join(__dirname, '..', 'out', 'files'));
const NOT_SUPPORTED = /pas encore support/i;
const t = (typeName, length, decimals) => ({ type: 'DataType', typeName, length, decimals });
const WF = [{ name: 'NUMCLI', type: t('packed', 7, 0) }, { name: 'NOM', type: t('char', 10) }];
const wrows = () => [{ NUMCLI: 1, NOM: 'A' }, { NUMCLI: 2, NOM: 'B' }, { NUMCLI: 3, NOM: 'C' }];
const wopen = (rows, options = {}) => new f.NativeFile('CL', 'CLF', WF, ['NUMCLI'], rows, { updatable: true, ...options });

// --- Incrément 2 : écriture ---


test('WRITE ajoute sans déplacer la position', () => {
  const rows = wrows();
  const file = wopen(rows);
  assert.equal(file.read().record.NOM, 'A');
  assert.deepEqual(file.write({ NUMCLI: 0, NOM: 'Z' }), {});
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[3], { NUMCLI: 0, NOM: 'Z' });
  assert.equal(file.read().record.NOM, 'B');
});

test('UPDATE réécrit l\'enregistrement courant, une seule fois', () => {
  const rows = wrows();
  const file = wopen(rows);
  assert.equal(file.update({ NUMCLI: 2, NOM: 'X' }).failure, 'noCurrent');
  file.chain([2]);
  assert.deepEqual(file.update({ NUMCLI: 2, NOM: 'X' }), {});
  assert.equal(rows[1].NOM, 'X');
  assert.equal(file.update({ NUMCLI: 2, NOM: 'Y' }).failure, 'noCurrent');
  assert.equal(file.read().record.NOM, 'C');
  file.read();
  assert.equal(file.update({ NUMCLI: 3, NOM: 'Y' }).failure, 'noCurrent'); // lecture en échec (EOF)
});

test('DELETE courant puis READ ; DELETE par clé', () => {
  const rows = wrows();
  const file = wopen(rows);
  file.read();
  file.read();
  assert.deepEqual(file.delete(), {});
  assert.deepEqual(rows.map(r => r.NOM), ['A', 'C']);
  assert.equal(file.delete().failure, 'noCurrent');
  assert.equal(file.read().record.NOM, 'C');
  assert.equal(file.deleteByKey([1]).found, true);
  assert.equal(file.deleteByKey([9]).found, false);
  assert.deepEqual(rows.map(r => r.NOM), ['C']);
});

test('UNLOCK retire l\'enregistrement courant', () => {
  const file = wopen(wrows());
  file.chain([1]);
  file.unlock();
  assert.equal(file.update({ NUMCLI: 1, NOM: 'X' }).failure, 'noCurrent');
});

test('clés uniques contrôlées même sans accès par clé', () => {
  const rows = wrows();
  const file = new f.NativeFile('CL', 'CLF', WF, [], rows, { updatable: true, uniqueKeys: ['NUMCLI'] });
  assert.equal(file.write({ NUMCLI: 2, NOM: 'D' }).failure, 'duplicate');
  assert.equal(rows.length, 3);
  assert.equal(file.read().record.NOM, 'A');
  assert.equal(file.update({ NUMCLI: 3, NOM: 'A' }).failure, 'duplicate');
  assert.equal(rows[0].NUMCLI, 1);
  assert.equal(file.update({ NUMCLI: 1, NOM: 'AA' }).failure, 'repositioned'); // après un échec 01021 : relecture exigée
  file.setll('start');
  assert.equal(file.read().record.NOM, 'A');
  assert.deepEqual(file.update({ NUMCLI: 1, NOM: 'AA' }), {});
  assert.deepEqual(file.write({ NUMCLI: 4, NOM: 'D' }), {});
  assert.equal(rows.length, 4);
});

test('verrous : une autre ouverture ne lit pas pour mise à jour un enregistrement tenu', () => {
  const rows = wrows();
  const locks = new WeakMap();
  const a = wopen(rows, { locks });
  const b = wopen(rows, { locks });
  a.chain([2]);
  assert.throws(() => b.chain([2]), NOT_SUPPORTED);
  assert.equal(b.chain([1]).record.NOM, 'A');
  a.unlock();
  assert.equal(b.chain([2]).record.NOM, 'B');
  const lecture = new f.NativeFile('CL', 'CLF', WF, ['NUMCLI'], rows, { locks });
  assert.equal(lecture.chain([2]).record.NOM, 'B');
  b.release();
  assert.equal(a.chain([2]).found, true);
});

test('clé de l\'enregistrement courant modifiée : lecture séquentielle refusée', () => {
  const rows = wrows();
  const file = wopen(rows);
  file.read();
  file.update({ NUMCLI: 7, NOM: 'A' });
  assert.throws(() => file.read(), NOT_SUPPORTED);
  file.setll('start');
  assert.equal(file.read().record.NOM, 'B');
  rows[1].NUMCLI = 9; // comme un UPDATE SQL de la clé
  assert.throws(() => file.read(), NOT_SUPPORTED);
});

test('écritures : les autres ouvertures de la table voient les changements (revision)', () => {
  const rows = wrows();
  let counter = 0;
  const options = { locks: new WeakMap(), revision: () => counter, changed: () => counter++ };
  const a = wopen(rows, options);
  const b = wopen(rows, options);
  assert.equal(b.read().record.NOM, 'A');
  b.unlock();
  a.chain([3]);
  assert.deepEqual(a.update({ NUMCLI: 0, NOM: 'C' }), {});
  b.setll('start');
  assert.equal(b.read().record.NOM, 'C');
  b.unlock();
  a.chain([2]);
  assert.deepEqual(a.delete(), {});
  assert.deepEqual(a.write({ NUMCLI: 5, NOM: 'E' }), {});
  assert.equal(rows.length, 3);
  b.setll('end');
  assert.equal(b.readp().record.NOM, 'E');
  assert.equal(b.readp().record.NOM, 'A');
  assert.equal(counter, 3);
});

test('UPDATE/DELETE après SETLL, SETGT ou réouverture sans nouvelle lecture : refusés', () => {
  const rows = wrows();
  const locks = new WeakMap();
  const file = wopen(rows, { locks });
  file.chain([2]);
  file.setll([3]);
  assert.equal(file.update({ NUMCLI: 2, NOM: 'X' }).failure, 'repositioned');
  assert.equal(file.delete().failure, 'repositioned');
  assert.equal(rows[1].NOM, 'B');
  const other = wopen(rows, { locks });
  assert.equal(other.chain([2]).record.NOM, 'B'); // verrou libéré par le SETLL
  other.unlock();
  file.chain([2]);
  file.setgt([2]);
  assert.equal(file.delete().failure, 'repositioned');
  assert.equal(file.read().record.NOM, 'C');
  assert.deepEqual(file.update({ NUMCLI: 3, NOM: 'Y' }), {});
  assert.equal(file.update({ NUMCLI: 3, NOM: 'Z' }).failure, 'noCurrent');
  file.chain([1]);
  file.reset();
  assert.equal(file.update({ NUMCLI: 1, NOM: 'X' }).failure, 'repositioned');
  assert.equal(rows[0].NOM, 'A');
});

test('WRITE refuse une clé invalide sans modifier la table', () => {
  const rows = wrows();
  const file = wopen(rows);
  assert.throws(() => file.write({ NUMCLI: 'abc', NOM: 'Z' }), /Donnée invalide/);
  assert.throws(() => file.write({ NUMCLI: 12345678, NOM: 'Z' }), /Donnée invalide/);
  assert.throws(() => file.write({ NOM: 'Z' }), /Donnée invalide/);
  assert.equal(rows.length, 3);
  assert.equal(file.read().record.NOM, 'A');
});

test('UPDATE/DELETE d\'un enregistrement retiré de la table : refusés', () => {
  let rows = wrows();
  const file = wopen(() => rows);
  const b = file.chain([2]).record;
  rows = rows.filter(r => r !== b); // DELETE SQL : nouveau tableau
  assert.equal(file.update({ NUMCLI: 2, NOM: 'X' }).failure, 'gone');
  assert.equal(b.NOM, 'B');
  assert.equal(file.delete().failure, 'noCurrent');
  file.chain([1]);
  rows = rows.slice(); // nouveau tableau, mêmes lignes
  assert.deepEqual(file.update({ NUMCLI: 1, NOM: 'X' }), {});
  assert.equal(rows[0].NOM, 'X');
  file.chain([3]);
  rows = [rows[0]];
  assert.equal(file.delete().failure, 'gone');
  assert.deepEqual(rows.map(r => r.NOM), ['X']);
});

test('DELETE par clé partielle : refusé', () => {
  const rows = wrows();
  const file = new f.NativeFile('CL', 'CLF', WF, ['NUMCLI', 'NOM'], rows, { updatable: true });
  assert.throws(() => file.deleteByKey([1]), NOT_SUPPORTED);
  assert.equal(rows.length, 3);
  assert.equal(file.deleteByKey([1, 'A']).found, true);
  assert.equal(rows.length, 2);
});

test('DELETE par clé réussi : plus d\'enregistrement courant, position perdue', () => {
  const rows = wrows();
  const locks = new WeakMap();
  const file = wopen(rows, { locks });
  file.chain([1]);
  assert.equal(file.deleteByKey([2]).found, true);
  assert.equal(file.update({ NUMCLI: 1, NOM: 'X' }).failure, 'repositioned');
  assert.equal(file.delete().failure, 'repositioned');
  assert.throws(() => file.read(), NOT_SUPPORTED);
  const other = wopen(rows, { locks });
  assert.equal(other.chain([1]).record.NOM, 'A'); // verrou libéré
  other.unlock();
  file.setll('start');
  assert.equal(file.read().record.NOM, 'A');
});

test('WRITE ou UPDATE en double avec un enregistrement courant : UPDATE/DELETE refusés sans relecture', () => {
  const rows = wrows();
  const file = new f.NativeFile('CL', 'CLF', WF, ['NUMCLI'], rows, { updatable: true, uniqueKeys: ['NUMCLI'] });
  file.chain([1]);
  assert.deepEqual(file.write({ NUMCLI: 4, NOM: 'D' }), {});
  assert.equal(file.update({ NUMCLI: 1, NOM: 'X' }).failure, 'repositioned');
  assert.equal(file.delete().failure, 'repositioned');
  file.chain([1]);
  assert.equal(file.update({ NUMCLI: 2, NOM: 'X' }).failure, 'duplicate');
  assert.equal(file.update({ NUMCLI: 1, NOM: 'X' }).failure, 'repositioned');
  file.chain([1]);
  assert.deepEqual(file.update({ NUMCLI: 1, NOM: 'X' }), {});
  // Sans enregistrement courant, WRITE ne change rien
  assert.deepEqual(file.write({ NUMCLI: 5, NOM: 'E' }), {});
  assert.equal(file.update({ NUMCLI: 1, NOM: 'Y' }).failure, 'noCurrent');
});

test('duplicateKey : première clé unique en double dans les données', () => {
  const rows = wrows();
  rows[2].NUMCLI = 1;
  const file = new f.NativeFile('CL', 'CLF', WF, [], rows, { uniqueKeys: ['NUMCLI'] });
  assert.deepEqual(file.duplicateKey(), { NUMCLI: 1 });
  assert.equal(new f.NativeFile('CL', 'CLF', WF, [], wrows(), { uniqueKeys: ['NUMCLI'] }).duplicateKey(), undefined);
});

// --- Incrément 3a ---


test('READE sans clé : clé complète du dernier enregistrement lu', () => {
  const F3 = [{ name: 'NUMCLI', type: t('packed', 7, 0) }, { name: 'LIB', type: t('char', 5) }];
  const rows = [{ NUMCLI: 1, LIB: 'a' }, { NUMCLI: 1, LIB: 'b' }, { NUMCLI: 2, LIB: 'c' }];
  const file = new f.NativeFile('CDE', 'CDEF', F3, ['NUMCLI'], rows);
  assert.throws(() => file.reade('last'), NOT_SUPPORTED);
  assert.equal(file.chain([1]).record.LIB, 'a');
  assert.equal(file.reade('last').record.LIB, 'b');
  assert.equal(file.reade('last').eof, true);
  file.setll('end');
  assert.equal(file.readp().record.LIB, 'c');
  assert.equal(file.readpe('last').eof, true);
});

test('lecture sans verrou : pas d\'enregistrement courant, pas de verrou', () => {
  const rows = wrows();
  const locks = new WeakMap();
  const a = wopen(rows, { locks });
  const b = wopen(rows, { locks });
  assert.equal(a.chain([2], { noLock: true }).record.NOM, 'B');
  assert.equal(a.update({ NUMCLI: 2, NOM: 'X' }).failure, 'noCurrent');
  assert.equal(b.chain([2]).record.NOM, 'B');
  assert.equal(a.read({ noLock: true }).record.NOM, 'C');
  assert.equal(a.reade('last', { noLock: true }).eof, true);
});

test('READE/READPE sans clé : refusé sur fichier sans clé, après SETLL/SETGT, DELETE ou lecture en échec', () => {
  const nokey = new f.NativeFile('SK', 'SKF', WF, [], wrows());
  nokey.read();
  assert.throws(() => nokey.reade('last'), NOT_SUPPORTED);
  for (const reposition of [x => x.setll([5]), x => x.setll('start'), x => x.setll('end'), x => x.setgt([1])]) {
    const file = wopen(wrows());
    file.chain([1]);
    reposition(file);
    assert.throws(() => file.reade('last'), NOT_SUPPORTED);
    assert.throws(() => file.readpe('last'), NOT_SUPPORTED);
  }
  const d = wopen(wrows());
  d.chain([1]);
  assert.deepEqual(d.delete(), {});
  assert.throws(() => d.reade('last'), NOT_SUPPORTED);
  const k = wopen(wrows());
  k.chain([1]);
  k.deleteByKey([2]);
  assert.throws(() => k.reade('last'), NOT_SUPPORTED);
  const m = wopen(wrows());
  m.chain([1]);
  assert.equal(m.chain([9]).found, false);
  assert.throws(() => m.reade('last'), NOT_SUPPORTED);
  const e = wopen(wrows());
  e.setll([3]);
  assert.equal(e.read().record.NOM, 'C');
  assert.equal(e.read().eof, true);
  assert.throws(() => e.reade('last'), NOT_SUPPORTED);
});

test('lecture sans verrou : libère le verrou précédent ; readp, readpe, chainRrn', () => {
  const rows = wrows();
  const locks = new WeakMap();
  const a = wopen(rows, { locks });
  const b = wopen(rows, { locks });
  a.chain([2]);
  assert.throws(() => b.chain([2]), NOT_SUPPORTED);
  assert.equal(a.chain([3], { noLock: true }).record.NOM, 'C');
  assert.equal(b.chain([2]).record.NOM, 'B');
  assert.equal(a.readp({ noLock: true }).record.NOM, 'B');
  assert.equal(a.update({ NUMCLI: 2, NOM: 'X' }).failure, 'noCurrent');
  assert.equal(a.readpe('last', { noLock: true }).eof, true);
  assert.equal(a.update({ NUMCLI: 2, NOM: 'X' }).failure, 'noCurrent');
  const n = new f.NativeFile('SK', 'SKF', WF, [], rows, { updatable: true, locks });
  assert.equal(n.chainRrn(1, { noLock: true }).record.NOM, 'A');
  assert.equal(n.update({ NUMCLI: 1, NOM: 'X' }).failure, 'noCurrent');
});
