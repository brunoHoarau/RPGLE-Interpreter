// Fichiers natifs simulés : types de zones, ordre EBCDIC, curseur, opérations
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const f = require(path.join(__dirname, '..', 'out', 'files'));

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;
const t = (typeName, length, decimals) => ({ type: 'DataType', typeName, length, decimals });

test('parseFieldType : syntaxes RPG et SQL', () => {
  assert.deepEqual(f.parseFieldType('packed(7:0)'), t('packed', 7, 0));
  assert.deepEqual(f.parseFieldType('DECIMAL(9,2)'), t('packed', 9, 2));
  assert.deepEqual(f.parseFieldType('numeric(5)'), t('zoned', 5, 0));
  assert.deepEqual(f.parseFieldType('char(30)'), t('char', 30, undefined));
  assert.deepEqual(f.parseFieldType('VARCHAR(50)'), t('varchar', 50, undefined));
  assert.deepEqual(f.parseFieldType('INTEGER'), t('int', 10, undefined));
  assert.deepEqual(f.parseFieldType('smallint'), t('int', 5, undefined));
  assert.deepEqual(f.parseFieldType('BIGINT'), t('int', 20, undefined));
  assert.deepEqual(f.parseFieldType('int(5)'), t('int', 5, undefined));
  assert.deepEqual(f.parseFieldType('date'), t('date', undefined, undefined));
  assert.deepEqual(f.parseFieldType('ind'), t('ind', undefined, undefined));
  for (const bad of ['AUTO', 'char', 'int(7)', 'float(8)', 'packed', 'blob(10)', '']) {
    assert.equal(f.parseFieldType(bad), undefined, bad);
  }
});

test('ebcdicKey : ordre IBM i (espace < minuscules < majuscules < chiffres)', () => {
  const sorted = ['9', 'A', 'a', ' x', 'Z', '0', 'b'].sort((x, y) => (f.ebcdicKey(x) < f.ebcdicKey(y) ? -1 : 1));
  assert.deepEqual(sorted, [' x', 'a', 'b', 'A', 'Z', '0', '9']);
  assert.throws(() => f.ebcdicKey('é'), NOT_SUPPORTED);
  assert.throws(() => f.ebcdicKey('a#b'), NOT_SUPPORTED);
});

const CLIENT_FIELDS = [
  { name: 'NUMCLI', type: t('packed', 7, 0) },
  { name: 'NOM', type: t('char', 10) },
];
const clients = () => [
  { NUMCLI: 3, NOM: 'Durand' }, { NUMCLI: 1, NOM: 'Dupont' }, { NUMCLI: 2, NOM: 'Martin' },
];

test('READ suit les clés ; READP depuis la fin relit le dernier', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  assert.equal(file.read().record.NOM, 'Dupont');
  assert.equal(file.read().record.NOM, 'Martin');
  assert.equal(file.read().record.NOM, 'Durand');
  assert.deepEqual(file.read(), { found: false, eof: true, equal: false });
  assert.equal(file.readp().record.NOM, 'Durand');
  assert.equal(file.readp().record.NOM, 'Martin');
});

test('sans clé : ordre d\'arrivée, CHAIN par rang', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], clients());
  assert.equal(file.keyed, false);
  assert.equal(file.read().record.NOM, 'Durand');
  assert.equal(file.chainRrn(2).record.NOM, 'Dupont');
  assert.equal(file.read().record.NOM, 'Martin');
  assert.equal(file.chainRrn(9).found, false);
});

test('CHAIN, SETLL, SETGT et indicateurs', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  const c = file.chain([2]);
  assert.equal(c.found, true);
  assert.equal(c.record.NOM, 'Martin');
  assert.equal(file.read().record.NOM, 'Durand');
  assert.equal(file.chain([7]).found, false);
  assert.equal(file.positionLost, true);
  const s = file.setll([2]);
  assert.equal(s.found, true);
  assert.equal(s.equal, true);
  assert.equal(file.positionLost, false);
  assert.equal(file.read().record.NOM, 'Martin');
  assert.deepEqual(file.setll([4]), { found: false, eof: false, equal: false });
  assert.equal(file.setgt([1]).found, true);
  assert.equal(file.read().record.NOM, 'Martin');
  file.setll('end');
  assert.equal(file.readp().record.NOM, 'Durand');
  file.setll('start');
  assert.equal(file.read().record.NOM, 'Dupont');
});

test('clé composée, clé partielle, doublons et READE/READPE', () => {
  const fields = [
    { name: 'NUMCLI', type: t('packed', 7, 0) },
    { name: 'NUMCDE', type: t('packed', 5, 0) },
    { name: 'LIB', type: t('char', 10) },
  ];
  const rows = [
    { NUMCLI: 1, NUMCDE: 10, LIB: 'a' }, { NUMCLI: 2, NUMCDE: 5, LIB: 'b' },
    { NUMCLI: 1, NUMCDE: 7, LIB: 'c' }, { NUMCLI: 2, NUMCDE: 1, LIB: 'd' },
    { NUMCLI: 2, NUMCDE: 5, LIB: 'e' },
  ];
  const file = new f.NativeFile('CDE', 'CDEF', fields, ['NUMCLI', 'NUMCDE'], rows);
  file.setll([2]);
  const libs = [];
  for (let r = file.reade([2]); !r.eof; r = file.reade([2])) libs.push(r.record.LIB);
  assert.deepEqual(libs, ['d', 'b', 'e']);
  assert.equal(file.chain([2, 5]).record.LIB, 'b');
  file.setgt([1]);
  assert.equal(file.readpe([1]).record.LIB, 'a');
  assert.equal(file.readpe([1]).record.LIB, 'c');
  assert.equal(file.readpe([1]).eof, true);
  assert.throws(() => file.chain([1, 2, 3]), /3 valeurs pour 2 zones/);
});

test('clé caractère : EBCDIC et blancs de fin', () => {
  const fields = [{ name: 'CODE', type: t('char', 5) }];
  const file = new f.NativeFile('T', 'TF', fields, ['CODE'], [{ CODE: 'B1' }, { CODE: 'b1' }, { CODE: '01' }]);
  assert.deepEqual([file.read(), file.read(), file.read()].map(r => r.record.CODE), ['b1', 'B1', '01']);
  assert.equal(file.chain(['B1   ']).found, true);
  assert.throws(() => file.chain([12]), INCOMPATIBLE);
});

test('clé numérique : une valeur caractère est refusée', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  assert.throws(() => file.chain(['2']), INCOMPATIBLE);
});

test('un ajout entre deux lectures est vu sans saut ni répétition', () => {
  const rows = clients();
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], rows);
  assert.equal(file.read().record.NUMCLI, 1);
  rows.push({ NUMCLI: 2, NOM: 'Nouveau' });
  rows.splice(0, 1); // suppression de Durand (3)
  assert.deepEqual([file.read(), file.read()].map(r => r.record.NOM), ['Martin', 'Nouveau']);
  assert.equal(file.read().eof, true);
});

test('reset : retour au début', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  file.read(); file.read();
  file.reset();
  assert.equal(file.read().record.NUMCLI, 1);
});
