// Directives /COPY et /INCLUDE : inclusion d'un membre source au moment de la compilation
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parse } = require('./helpers');
const { folderProgramResolver } = require('../out/sources');

// Résolveur en mémoire : nom de membre -> source ; les demandes reçues sont notées dans `seen`
const copies = (map, seen = []) => ({
  resolveCopy: spec => {
    seen.push(spec);
    const name = (spec.member ?? spec.path).toUpperCase();
    return map[name] !== undefined ? { source: map[name], path: name } : undefined;
  },
});

const PROTOS = `
dcl-c TAUX 20;
dcl-s total int(10) inz(100);
`;

test('/COPY insère les déclarations du membre', () => {
  const out = run(`
/copy protos
dsply TAUX;
dsply total;
`, undefined, copies({ PROTOS }));
  assert.deepEqual(out, ['20', '100']);
});

test('/INCLUDE se comporte comme /COPY', () => {
  const out = run(`
/include protos
dsply TAUX;
`, undefined, copies({ PROTOS }));
  assert.deepEqual(out, ['20']);
});

test('la directive est insensible à la casse et peut être indentée', () => {
  const out = run(`
    /COPY PROTOS
dsply TAUX;
`, undefined, copies({ PROTOS }));
  assert.deepEqual(out, ['20']);
});

test('le membre est inséré à la place de la directive, y compris dans une procédure', () => {
  const out = run(`
dsply 'avant';
calcul();
dsply 'après';
dcl-proc calcul;
  /copy corps
end-proc;
`, undefined, copies({ CORPS: `
  dcl-s x int(10) inz(7);
  dsply x;
` }));
  assert.deepEqual(out, ['avant', '7', 'après']);
});

test('fichier source et bibliothèque sont transmis au résolveur', () => {
  const seen = [];
  run(`
/copy QRPGLESRC,PROTOS
/copy MABIB/QCPYSRC,PROTOS
dsply TAUX;
`, undefined, copies({ PROTOS: 'dcl-c TAUX 20;' }, seen));
  assert.deepEqual(seen.map(s => [s.library, s.file, s.member]),
    [[undefined, 'QRPGLESRC', 'PROTOS'], ['MABIB', 'QCPYSRC', 'PROTOS']]);
});

test('un chemin IFS entre apostrophes est transmis tel quel', () => {
  const seen = [];
  run(`
/include 'inc/Protos.rpgleinc'
dsply TAUX;
`, undefined, copies({ 'INC/PROTOS.RPGLEINC': 'dcl-c TAUX 20;' }, seen));
  assert.equal(seen[0].path, 'inc/Protos.rpgleinc');
});

test('le texte après le nom du membre est un commentaire', () => {
  const out = run(`
/copy protos     prototypes communs
/copy protos2 // autre commentaire
dsply TAUX;
`, undefined, copies({ PROTOS, PROTOS2: '' }));
  assert.deepEqual(out, ['20']);
});

test('un membre peut lui-même contenir un /COPY', () => {
  const out = run(`
/copy niveau1
dsply TAUX;
dsply y;
`, undefined, copies({ NIVEAU1: '/copy niveau2\ndcl-s y int(10) inz(3);', NIVEAU2: 'dcl-c TAUX 20;' }));
  assert.deepEqual(out, ['20', '3']);
});

test('un /COPY récursif est refusé', () => {
  assert.throws(() => parse('/copy a\n', copies({ A: '/copy b\n', B: '/copy a\n' })),
    /\/COPY A.*récursi/i);
});

test('un membre introuvable est signalé avec la ligne de la directive', () => {
  assert.throws(() => parse('dcl-s x int(10);\n/copy QRPGLESRC,ABSENT\n', copies({})),
    /QRPGLESRC,ABSENT.*introuvable.*ligne 2/);
});

test('/COPY sans nom de membre est refusé', () => {
  assert.throws(() => parse('/copy\n', copies({})), /\/COPY.*nom/i);
});

test('/EOF termine le membre copié, la suite du programme est lue', () => {
  const out = run(`
/copy protos
dsply TAUX;
`, undefined, copies({ PROTOS: 'dcl-c TAUX 20;\n/eof\nceci n est pas du RPG' }));
  assert.deepEqual(out, ['20']);
});

test('/EOF dans le programme ignore la fin du source', () => {
  assert.deepEqual(run(`
dsply 'lu';
/eof
dsply 'ignoré'
`), ['lu']);
});

test('une division en début de ligne n est pas une directive', () => {
  assert.deepEqual(run(`
dcl-s x int(10);
x = 10
  / 2;
dsply x;
`), ['5']);
});

test('les autres directives sont refusées explicitement', () => {
  assert.throws(() => parse('/define DEBUG\n'), /directive \/DEFINE.*non support/i);
  assert.throws(() => parse('/if defined(DEBUG)\n'), /directive \/IF.*non support/i);
});

test('dossier : membre voisin, sous-dossier du fichier source et chemin IFS relatif', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-copy-'));
  try {
    fs.mkdirSync(path.join(dir, 'qrpgleref'));
    fs.mkdirSync(path.join(dir, 'inc'));
    fs.writeFileSync(path.join(dir, 'Voisin.rpgleinc'), 'dcl-c A 1;');
    fs.writeFileSync(path.join(dir, 'qrpgleref', 'protos.rpgleinc'), 'dcl-c B 2;\n/copy suite');
    fs.writeFileSync(path.join(dir, 'qrpgleref', 'suite.rpgle'), 'dcl-c C 3;');
    fs.writeFileSync(path.join(dir, 'inc', 'defs.rpgleinc'), 'dcl-c D 4;');
    const main = path.join(dir, 'MAIN.rpgle');
    fs.writeFileSync(main, '/copy voisin\n/copy QRPGLEREF,PROTOS\n/include \'inc/defs.rpgleinc\'\ndsply (A + B + C + D);\n');
    const { Lexer } = require('../out/lexer');
    const { Parser } = require('../out/parser');
    const { Interpreter } = require('../out/interpreter');
    const ast = new Parser(new Lexer(fs.readFileSync(main, 'utf8'), { path: main }).tokenize()).parse();
    assert.deepEqual(new Interpreter().execute(ast).filter(l => l.startsWith('[DSPLY')), ['[DSPLY] 10']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('les /COPY d un programme appelé sont cherchés à côté de son source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-copy-'));
  try {
    fs.writeFileSync(path.join(dir, 'msg.rpgleinc'), "dcl-c MSG 'depuis le membre';");
    fs.writeFileSync(path.join(dir, 'APPELE.rpgle'), '/copy msg\ndsply MSG;\n');
    const out = run(`
dcl-pr appele extpgm('APPELE');
end-pr;
appele();
`, undefined, { resolveProgram: folderProgramResolver(dir) });
    assert.deepEqual(out, ['depuis le membre']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
