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

const dt = require(path.join(__dirname, '..', 'out', 'datetime'));
const INVALID = /Donnée invalide dans le fichier CLIENT : zone NUMCLI = /;

test('données invalides : erreur claire, jamais de NaN dans le tri', () => {
  for (const bad of [undefined, null, '', 'x', '1e3', NaN]) {
    const rows = [{ NUMCLI: 1, NOM: 'a' }, { NUMCLI: bad, NOM: 'b' }];
    const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], rows);
    assert.throws(() => file.read(), INVALID, String(bad));
  }
  const ok = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], [{ NUMCLI: '12', NOM: 'a' }, { NUMCLI: '-3', NOM: 'b' }]);
  assert.equal(ok.read().record.NOM, 'b');
  assert.throws(() => new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['INCONNU'], []), /INCONNU.*CLIENT/);
});

test('clés date : ISO côté données, valeur de date côté programme', () => {
  const fields = [{ name: 'D', type: t('date') }];
  const file = new f.NativeFile('T', 'TF', fields, ['D'], [{ D: '2024-05-02' }, { D: '2023-12-31' }]);
  assert.equal(file.chain([dt.parseIso('date', '2024-05-02')]).found, true);
  assert.throws(() => file.chain(['2024-05-02']), INCOMPATIBLE);
  assert.throws(() => file.chain([dt.parseIso('time', '10.00.00')]), INCOMPATIBLE);
  const bad = new f.NativeFile('T', 'TF', fields, ['D'], [{ D: '2024-02-30' }]);
  assert.throws(() => bad.read(), /Donnée invalide dans le fichier T : zone D = '2024-02-30'/);
  const ind = new f.NativeFile('T', 'TF', [{ name: 'I', type: t('ind') }], ['I'], [{ I: true }]);
  assert.equal(ind.chain([true]).found, true);
  assert.throws(() => ind.chain(['1']), INCOMPATIBLE);
});

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

// --- Incrément 2 : écriture ---

const WF = [{ name: 'NUMCLI', type: t('packed', 7, 0) }, { name: 'NOM', type: t('char', 10) }];
const wrows = () => [{ NUMCLI: 1, NOM: 'A' }, { NUMCLI: 2, NOM: 'B' }, { NUMCLI: 3, NOM: 'C' }];
const wopen = (rows, options = {}) => new f.NativeFile('CL', 'CLF', WF, ['NUMCLI'], rows, { updatable: true, ...options });

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
