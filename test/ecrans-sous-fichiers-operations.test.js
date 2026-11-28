// Sous-fichiers : WRITE, CHAIN, UPDATE, READC côté programme RPG, de bout en bout avec le terminal scripté
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { runScreens, displaysFrom, run } = require('./helpers');

const F = (name, type, row, col, usage = 'B') => ({ name, usage, type, row, col });
const ECRANS = (size = 7) => displaysFrom({ ECRAN: { formats: {
  SFL1: { subfile: { nextChanged: '67' }, fields: [F('OPT', 'char(1)', 6, 3), F('LIB', 'char(10)', 6, 7, 'O'), { name: 'CODE', type: 'char(6)', usage: 'H' }] },
  CTL1: {
    control: { subfile: 'SFL1', size, page: 7, display: '32', displayControl: 'N31', clear: '31', end: { if: '90', text: '*MORE' } },
    overlay: true, constants: [{ row: 4, col: 2, text: 'Opt Libelle' }], fields: [],
  },
  BAS1: { overlay: true, constants: [{ row: 23, col: 2, text: 'F3=Sortie' }], fields: [] },
} } });
const HEAD = 'dcl-f ecran workstn sfile(sfl1:rrn1);\ndcl-s i int(10);\n';
const load = n => `
*in31 = *on;
write ctl1;
*in31 = *off;
for i = 1 to ${n};
  rrn1 = i;
  code = 'A' + %char(i);
  lib = 'Libelle';
  opt = '';
  write sfl1;
endfor;
`;
const where = (code, opt) => ({ where: { CODE: code }, fields: { OPT: opt } });
const pages = shown => shown.map(x => x.subfile && x.subfile.rows.map(r => r.rrn));

test('Page à page : chargement, WRITE BAS1, EXFMT, option par where, boucle READC / UPDATE', () => {
  const { output, shown } = runScreens(HEAD + load(7) + `
*in32 = *on;
write bas1;
exfmt ctl1;
readc sfl1;
dow not %eof(ecran);
  dsply code;
  dsply opt;
  dsply rrn1;
  opt = 'X';
  update sfl1;
  readc sfl1;
enddo;
chain 3 sfl1;
dsply opt;
`, ECRANS(), [{ format: 'CTL1', lines: [where('A3', '2'), where('A6', '5')] }]);
  assert.deepEqual(output, ['A3', '2', '3', 'A6', '5', '6', 'X']);
  assert.deepEqual(pages(shown), [undefined, [1, 2, 3, 4, 5, 6, 7]]);
  assert.deepEqual(shown[1].formats, ['BAS1', 'CTL1']);
});

test('Tout chargé (20 lignes, page de 7) : PAGEDOWN interne, saisie sur une ligne de la page 3', () => {
  const { output, shown } = runScreens(HEAD + load(20) + `
*in32 = *on;
exfmt ctl1;
readc sfl1;
dsply code;
dsply opt;
readc sfl1;
dsply %char(%eof(ecran));
`, ECRANS(20), [
    { format: 'CTL1', key: 'PAGEDOWN' },
    { format: 'CTL1', key: 'PAGEDOWN' },
    { format: 'CTL1', lines: [where('A15', '1')] },
  ]);
  assert.deepEqual(output, ['A15', '1', '1']);
  assert.deepEqual(pages(shown), [[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20]]);
});

test('CHAIN : trouvé charge les zones et le rang ; absent sans erreur, variables inchangées', () => {
  const { output } = runScreens(HEAD + load(3) + `
code = 'ZZZ';
opt = 'Q';
chain 2 sfl1;
dsply code;
dsply %char(%found(ecran));
code = 'KEEP';
chain 9 sfl1;
dsply %char(%found(ecran));
dsply code;
dsply rrn1;
`, ECRANS(), []);
  assert.deepEqual(output, ['A2', '1', '0', 'KEEP', '2']);
});

test('UPDATE : réécrit la ligne du dernier CHAIN ; SFLNXTCHG (indicateur 67) la remet modifiée', () => {
  const { output } = runScreens(HEAD + load(3) + `
chain 2 sfl1;
opt = 'U';
*in67 = *on;
update sfl1;
*in67 = *off;
readc sfl1;
dsply code;
dsply opt;
`, ECRANS(), []);
  assert.deepEqual(output, ['A2', 'U']);
});

test('UPDATE sans CHAIN ni READC : erreur ; WRITE d\'un rang en double : erreur', () => {
  assert.throws(() => runScreens(HEAD + load(1) + 'update sfl1;', ECRANS(), []), /UPDATE.*CHAIN.*READC/);
  assert.throws(() => runScreens(HEAD + load(1) + 'rrn1 = 1;\nwrite sfl1;', ECRANS(), []), /déjà présent/);
});

test('READ, EXFMT, WRITE de contrôle mal utilisés : erreurs', () => {
  assert.throws(() => runScreens(HEAD + 'read sfl1;', ECRANS(), []), /SFL1.*sous-fichier/);
  assert.throws(() => runScreens(HEAD + 'exfmt sfl1;', ECRANS(), []), /SFL1.*sous-fichier/);
  assert.throws(() => runScreens(HEAD + 'readc ctl1;', ECRANS(), []), /CTL1.*pas un format sous-fichier/);
  assert.throws(() => runScreens(HEAD + 'chain 1 ctl1;', ECRANS(), []), /pas encore support/i);
  const disque = { programs: {}, tables: { CLIENT: { keys: ['NUMCLI'], columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }], data: [{ NUMCLI: 1 }] } } };
  assert.throws(() => run('dcl-f client keyed; readc client;', disque), /READC.*sous-fichier/);
});

test('Extenseurs, structure de données résultat, clés multiples : refusés', () => {
  for (const op of ['readc(e) sfl1;', 'chain(e) 1 sfl1;', 'write(e) sfl1;', 'update(n) sfl1;']) {
    assert.throws(() => runScreens(HEAD + load(1) + op, ECRANS(), []), /pas encore support/i, op);
  }
  assert.throws(() => runScreens(HEAD + 'dcl-ds d qualified;\n  opt char(1);\nend-ds;\nreadc sfl1 d;', ECRANS(), []), /pas encore support/i);
  assert.throws(() => runScreens(HEAD + load(1) + 'chain (1 : 2) sfl1;', ECRANS(), []), /clé|rang/i);
});
