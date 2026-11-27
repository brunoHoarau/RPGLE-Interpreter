// Files-core : position, changement de sens, rang, cache
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const f = require(path.join(__dirname, '..', 'out', 'files'));
const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;
const t = (typeName, length, decimals) => ({ type: 'DataType', typeName, length, decimals });
const CLIENT_FIELDS = [
  { name: 'NUMCLI', type: t('packed', 7, 0) },
  { name: 'NOM', type: t('char', 10) },
];
const clients = () => [
  { NUMCLI: 3, NOM: 'Durand' }, { NUMCLI: 1, NOM: 'Dupont' }, { NUMCLI: 2, NOM: 'Martin' },
];

test('READE/READPE sans correspondance : position perdue', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  file.setll([1]);
  assert.equal(file.reade([2]).eof, true);
  assert.equal(file.positionLost, true);
  assert.throws(() => file.read(), NOT_SUPPORTED);
  file.setll('end');
  assert.equal(file.reade([2]).eof, true);
  assert.equal(file.positionLost, true);
});

test('READ après %EOF refusé, READP reste valide (et symétrique)', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  file.setll('end');
  assert.equal(file.read().eof, true);
  assert.throws(() => file.read(), NOT_SUPPORTED);
  assert.equal(file.readp().record.NOM, 'Durand');
  file.setll('start');
  assert.equal(file.readp().eof, true);
  assert.throws(() => file.readp(), NOT_SUPPORTED);
  assert.equal(file.read().record.NOM, 'Dupont');
});

test('CHAIN par rang : refusé si clé ou après suppression', () => {
  const keyed = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  assert.throws(() => keyed.chainRrn(1), /avec clé/);
  const rows = clients();
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], rows);
  rows.splice(0, 1);
  assert.throws(() => file.chainRrn(1), NOT_SUPPORTED);
  // Sur IBM i l'enregistrement supprimé garde son numéro, même après réouverture
  file.reset();
  assert.throws(() => file.chainRrn(1), NOT_SUPPORTED);
});

test('CHAIN par rang : toute ligne déjà vue puis disparue est détectée', () => {
  let rows = clients();
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], () => rows);
  const c = { NUMCLI: 4, NOM: 'c' };
  const d = { NUMCLI: 5, NOM: 'd' };
  rows.push(c);
  rows.push(d);
  rows = rows.filter(r => r !== c); // DELETE du moteur SQL : nouveau tableau
  assert.throws(() => file.chainRrn(3), NOT_SUPPORTED);
  // Ligne vue par une lecture puis supprimée en place
  const rows2 = clients();
  const file2 = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], rows2);
  const e = { NUMCLI: 6, NOM: 'e' };
  rows2.push(e);
  file2.read();
  rows2.pop();
  assert.throws(() => file2.chainRrn(1), NOT_SUPPORTED);
  // Suppression signalée par la source (DELETE SQL avant la déclaration du fichier)
  const file3 = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], clients(), { rowsDeleted: () => true });
  assert.throws(() => file3.chainRrn(1), NOT_SUPPORTED);
});

test('CHAIN par rang : valeur non numérique ou non entière', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], clients());
  assert.throws(() => file.chainRrn('1'), INCOMPATIBLE);
  assert.throws(() => file.chainRrn(true), INCOMPATIBLE);
  assert.throws(() => file.chainRrn(1.5), NOT_SUPPORTED);
  assert.throws(() => file.chainRrn(0), NOT_SUPPORTED);
  assert.equal(file.chainRrn(3).record.NOM, 'Martin');
});

test('fichier sans clé : positionnement par valeur refusé', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], clients());
  assert.throws(() => file.setll([1]), NOT_SUPPORTED);
  assert.throws(() => file.setgt([1]), NOT_SUPPORTED);
  assert.throws(() => file.reade([1]), NOT_SUPPORTED);
  assert.throws(() => file.readpe([1]), NOT_SUPPORTED);
  file.setll('end');
  assert.equal(file.readp().record.NOM, 'Martin');
});

test('changement de sens : le fichier est positionné sur le dernier enregistrement lu', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  file.read(); file.read();
  assert.equal(file.readp().record.NUMCLI, 1);
  assert.equal(file.read().record.NUMCLI, 2);
  file.chain([2]);
  assert.equal(file.readp().record.NUMCLI, 1);
  file.chain([2]);
  assert.equal(file.read().record.NUMCLI, 3);
  file.setll('end');
  assert.equal(file.readp().record.NUMCLI, 3);
  assert.equal(file.readp().record.NUMCLI, 2);
  assert.equal(file.read().record.NUMCLI, 3);
  // Sans clé : même règle sur l'ordre d'arrivée
  const rrn = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], clients());
  rrn.read(); rrn.read();
  assert.equal(rrn.readp().record.NOM, 'Durand');
});

test('changement de sens après suppression de l\'enregistrement courant', () => {
  const rows = clients();
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], rows);
  assert.equal(file.read().record.NUMCLI, 1);
  assert.equal(file.read().record.NUMCLI, 2);
  rows.splice(rows.findIndex(r => r.NUMCLI === 2), 1);
  assert.equal(file.read().record.NUMCLI, 3);
  assert.equal(file.readp().record.NUMCLI, 1);
});

test('READE puis READPE : positionné sur l\'enregistrement lu', () => {
  const fields = [
    { name: 'NUMCLI', type: t('packed', 7, 0) },
    { name: 'NUMCDE', type: t('packed', 5, 0) },
    { name: 'LIB', type: t('char', 10) },
  ];
  const rows = [
    { NUMCLI: 1, NUMCDE: 10, LIB: 'a' }, { NUMCLI: 2, NUMCDE: 5, LIB: 'b' },
    { NUMCLI: 1, NUMCDE: 7, LIB: 'c' }, { NUMCLI: 2, NUMCDE: 1, LIB: 'd' },
  ];
  const file = new f.NativeFile('CDE', 'CDEF', fields, ['NUMCLI', 'NUMCDE'], rows);
  file.setll([2]);
  assert.equal(file.reade([2]).record.LIB, 'd');
  assert.equal(file.reade([2]).record.LIB, 'b');
  assert.equal(file.readpe([2]).record.LIB, 'd');
  assert.equal(file.readpe([2]).eof, true);
  const simple = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  simple.setll([2]);
  assert.equal(simple.reade([2]).record.NUMCLI, 2);
  assert.equal(simple.readpe([2]).eof, true);
});

test('clé du programme qui ne tient pas dans la zone clé : refusée', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  assert.throws(() => file.chain([2.5]), NOT_SUPPORTED);
  assert.throws(() => file.chain([100000002]), NOT_SUPPORTED);
  assert.throws(() => file.setll([-10000000]), NOT_SUPPORTED);
  assert.equal(file.chain([-9999999]).found, false);
  const dec = new f.NativeFile('T', 'TF', [{ name: 'M', type: t('packed', 5, 2) }], ['M'], [{ M: 1.5 }]);
  assert.equal(dec.chain([1.5]).found, true);
  assert.throws(() => dec.chain([1.505]), NOT_SUPPORTED);
  assert.throws(() => dec.chain([1000]), NOT_SUPPORTED);
  const int = new f.NativeFile('T', 'TF', [{ name: 'I', type: t('int', 5) }], ['I'], [{ I: 1 }]);
  assert.throws(() => int.chain([32768]), NOT_SUPPORTED);
  assert.throws(() => int.chain([1.5]), NOT_SUPPORTED);
  const chr = new f.NativeFile('T', 'TF', [{ name: 'CODE', type: t('char', 5) }], ['CODE'], [{ CODE: 'ABCDE' }]);
  assert.throws(() => chr.chain(['ABCDEF']), NOT_SUPPORTED);
  assert.equal(chr.chain(['ABCDE   ']).found, true);
});

test('donnée de clé qui ne tient pas dans sa zone : erreur', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], [{ NUMCLI: 2.5, NOM: 'a' }]);
  assert.throws(() => file.read(), /Donnée invalide dans le fichier CLIENT : zone NUMCLI = '2.5' \(ne tient pas dans packed\(7:0\)\)/);
  const big = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], [{ NUMCLI: '12345678', NOM: 'a' }]);
  assert.throws(() => big.read(), /zone NUMCLI = '12345678' \(ne tient pas dans packed\(7:0\)\)/);
  const chr = new f.NativeFile('T', 'TF', [{ name: 'CODE', type: t('char', 3) }], ['CODE'], [{ CODE: 'ABCD' }]);
  assert.throws(() => chr.read(), /zone CODE = 'ABCD' \(ne tient pas dans char\(3\)\)/);
  const ok = new f.NativeFile('T', 'TF', [{ name: 'CODE', type: t('char', 3) }], ['CODE'], [{ CODE: 'ABC  ' }]);
  assert.equal(ok.read().found, true);
});

test('fitsField : la valeur tient-elle dans la zone', () => {
  assert.equal(f.fitsField(1500.5, t('packed', 9, 2)), true);
  assert.equal(f.fitsField(1.234, t('packed', 9, 2)), false);
  assert.equal(f.fitsField(9999999, t('packed', 7, 0)), true);
  assert.equal(f.fitsField(10000000, t('packed', 7, 0)), false);
  assert.equal(f.fitsField(-128, t('int', 3)), true);
  assert.equal(f.fitsField(-1, t('uns', 3)), false);
  assert.equal(f.fitsField('abc  ', t('char', 3)), true);
  assert.equal(f.fitsField('abcd', t('varchar', 3)), false);
});

test('performance : ordre trié en cache tant que la version des données est inchangée', () => {
  const rows = [];
  for (let i = 3000; i >= 1; i--) rows.push({ NUMCLI: i, NOM: 'n' + i });
  let revision = 0;
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], rows, { revision: () => revision });
  const started = Date.now();
  let count = 0;
  for (let r = file.read(); !r.eof; r = file.read()) count++;
  assert.equal(count, 3000);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  file.setll('start');
  rows.find(r => r.NUMCLI === 1).NUMCLI = 5000; // UPDATE SQL de la zone clé
  revision++;
  assert.equal(file.read().record.NUMCLI, 2);
  file.setll('end');
  assert.equal(file.readp().record.NUMCLI, 5000);
});

test('sans version des données : une zone clé modifiée ou une ligne remplacée est revue', () => {
  const rows = clients();
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], rows);
  assert.equal(file.read().record.NUMCLI, 1);
  rows.find(r => r.NUMCLI === 1).NUMCLI = 5;
  file.setll('start');
  assert.equal(file.read().record.NUMCLI, 2);
  rows[0] = { NUMCLI: 0, NOM: 'Remplace' };
  file.setll('start');
  assert.equal(file.read().record.NOM, 'Remplace');
});

test('tableau partagé remplacé : source fonction relue à chaque opération', () => {
  let rows = clients();
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], () => rows);
  assert.equal(file.read().record.NUMCLI, 1);
  rows = rows.filter(r => r.NUMCLI !== 2);
  assert.equal(file.read().record.NUMCLI, 3);
});

test('clé caractère : seuls les espaces de fin sont ôtés, clé plus longue que la zone refusée', () => {
  assert.throws(() => f.ebcdicKey('a\t'), NOT_SUPPORTED);
  assert.equal(f.ebcdicKey('a  '), f.ebcdicKey('a'));
  const file = new f.NativeFile('T', 'TF', [{ name: 'CODE', type: t('char', 3) }], ['CODE'], [{ CODE: 'ABC' }]);
  assert.throws(() => file.chain(['ABCDEF']), NOT_SUPPORTED);
});
