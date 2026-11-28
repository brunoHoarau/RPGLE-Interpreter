// Sous-fichiers : displays.json (sous-fichier, contrôle, overlay, fold) et déclaration SFILE
const test = require('node:test');
const assert = require('node:assert/strict');
const { displaysFrom } = require('./helpers');

const F = (name, type, row, usage = 'B', extra = {}) => ({ name, usage, type, row, col: 3, ...extra });
const SFL = () => ({ subfile: { nextChanged: '67' }, fields: [F('OPT', 'char(1)', 6), F('CODE', 'char(6)', 6, 'O'), F('DESC', 'char(40)', 7, 'O', { fold: true })] });
const CTL = () => ({
  control: { subfile: 'SFL1', size: 9999, page: 7, display: '32', displayControl: 'N31', clear: '31', delete: null, initialize: null,
    end: { if: '90', text: '*MORE' }, recordNumber: 'RRNTOP', drop: 'CF11' },
  overlay: true, keys: { PAGEDOWN: '25' }, constants: [{ row: 4, col: 2, text: 'Opt  Code' }],
  fields: [{ name: 'RRNTOP', type: 'zoned(4:0)', usage: 'H' }],
});
const make = (patchSfl, patchCtl) => {
  const sfl = SFL();
  const ctl = CTL();
  if (patchSfl) patchSfl(sfl);
  if (patchCtl) patchCtl(ctl);
  return () => displaysFrom({ ECRAN: { formats: { SFL1: sfl, CTL1: ctl, BAS1: { overlay: true, fields: [] } } } });
};

test('displays.json : sous-fichier, contrôle et overlay de la spec acceptés', () => {
  const formats = make()().ECRAN.formats;
  assert.deepEqual(formats.SFL1.subfile, { nextChanged: [{ indicator: 67, negated: false }] });
  const c = formats.CTL1.control;
  assert.equal(c.subfile, 'SFL1');
  assert.equal(c.size, 9999);
  assert.equal(c.page, 7);
  assert.deepEqual(c.display, [{ indicator: 32, negated: false }]);
  assert.deepEqual(c.displayControl, [{ indicator: 31, negated: true }]);
  assert.equal(c.delete, null);
  assert.equal(c.initialize, null);
  assert.equal(c.drop, 'CF11');
  assert.equal(c.recordNumber, 'RRNTOP');
  assert.deepEqual(c.end, { condition: [{ indicator: 90, negated: false }], text: '*MORE' });
  assert.equal(formats.CTL1.overlay, true);
  assert.equal(formats.BAS1.overlay, true);
  assert.equal(formats.SFL1.overlay, false);
  assert.equal(formats.SFL1.fields[2].fold, true);
  assert.equal(formats.SFL1.fields[0].fold, false);
});

test('displays.json : mots-clés absents du contrôle restent absents', () => {
  const c = make(null, ctl => { ctl.control = { subfile: 'SFL1', size: 14, page: 7 }; })().ECRAN.formats.CTL1.control;
  assert.equal(c.display, undefined);
  assert.equal(c.clear, undefined);
  assert.equal(c.end, undefined);
  assert.equal(c.recordNumber, undefined);
});

test('displays.json : contrôle mal formé refusé avec le chemin', () => {
  const refus = (patch, message) => assert.throws(make(null, patch), message);
  refus(c => { c.control.subfile = 'NOPE'; }, /CTL1.*sous-fichier 'NOPE'.*inconnu/);
  refus(c => { c.control.subfile = 'BAS1'; }, /CTL1.*'BAS1' n'est pas un format sous-fichier/);
  refus(c => { c.control.size = 0; }, /CTL1.*"size".*1 à 9999/);
  refus(c => { c.control.size = 10000; }, /CTL1.*"size".*1 à 9999/);
  refus(c => { c.control.page = 0; }, /CTL1.*"page"/);
  refus(c => { c.control.size = 5; }, /CTL1.*"page".*ne peut dépasser "size"/);
  refus(c => { c.control.page = 13; c.control.size = 20; }, /CTL1.*24 lignes/);
  refus(c => { c.control.recordNumber = 'AUTRE'; }, /CTL1.*"recordNumber".*zone numérique du contrôle/);
  refus(c => { c.fields[0].type = 'char(4)'; }, /CTL1.*"recordNumber".*zone numérique du contrôle/);
  refus(c => { c.control.drop = 'F11'; }, /CTL1.*"drop".*CA.*CF/);
  refus(c => { c.control.drop = 'PAGEUP'; }, /CTL1.*"drop".*CA.*CF/);
  refus(c => { c.control.SFLLIN = 5; }, /CTL1.*clé 'SFLLIN' inconnue/);
  refus(c => { c.control.messages = []; }, /CTL1.*clé 'messages' inconnue/);
  refus(c => { c.control.end = { if: '90', text: '*AUTRE' }; }, /CTL1.*"end".*\*MORE.*\*PLUS/);
  refus(c => { c.control.clear = 31; }, /CTL1.*"clear"/);
});

test('displays.json : sous-fichier mal formé, deux contrôles, fold hors sous-fichier', () => {
  assert.throws(make(s => { s.subfile.SFLRNA = 1; }), /SFL1.*clé 'SFLRNA' inconnue/);
  assert.throws(make(s => { s.subfile.nextChanged = 'x'; }), /SFL1.*"if" mal formé|SFL1.*nextChanged/);
  assert.throws(() => displaysFrom({ ECRAN: { formats: { SFL1: SFL(), CTL1: CTL(), CTL2: CTL() } } }),
    /CTL2.*SFL1.*déjà.*CTL1/);
  assert.throws(make(null, c => { c.fields.push(F('X', 'char(1)', 9, 'B', { fold: true })); }), /CTL1.*zone 'X'.*"fold".*sous-fichier/);
  assert.throws(make(s => { s.fields[2].fold = 'oui'; }), /SFL1.*zone 'DESC'.*"fold" doit être vrai ou faux/);
  assert.throws(make(null, c => { c.overlay = 'oui'; }), /CTL1.*"overlay" doit être vrai ou faux/);
  assert.throws(make(null, c => { c.subfile = {}; }), /CTL1.*à la fois sous-fichier et contrôle/);
});
