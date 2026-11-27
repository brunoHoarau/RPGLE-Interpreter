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
    assert.deepEqual(new Interpreter(undefined, { readableDsply: true }).execute(ast).filter(l => l.startsWith('[DSPLY')), ['[DSPLY] 10']);
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

test('une erreur de syntaxe dans un membre cite la ligne du /COPY, le membre et sa ligne', () => {
  assert.throws(() => parse('dcl-s a int(10);\n\n/copy protos\n', copies({ PROTOS: 'dcl-s x int(10);\ndcl-s y int(10) # ;' })),
    /ligne 3 \(membre PROTOS, ligne 2\)/);
});

test('une erreur du parser dans un membre cite la ligne du /COPY et le membre', () => {
  assert.throws(() => parse('dcl-s a int(10);\n/copy protos\ndsply a;\n', copies({ PROTOS: '\n\ndcl-s y int(10) inz(;' })),
    /ligne 2 \(membre PROTOS, ligne 3\)/);
});

test('une erreur dans un membre imbriqué cite le membre le plus interne et la ligne du premier /COPY', () => {
  assert.throws(() => parse('\n/copy a\n', copies({ A: '\n\n/copy b', B: '/copy absent' })),
    /ABSENT introuvable.*ligne 2 \(membre B, ligne 1\)/);
});

const SQL_MEMBER = { SQLINC: 'dcl-s n int(10);\nexec sql set :n = 1;' };

test('RPGPPOPT(*NONE) par défaut : un EXEC SQL dans un membre /INCLUDE est refusé', () => {
  assert.throws(() => parse('\n/include sqlinc\n', copies(SQL_MEMBER)),
    /EXEC SQL.*\/INCLUDE SQLINC.*RPGPPOPT\(\*NONE\).*ligne 2/);
});

test('RPGPPOPT(*LVL1) : un EXEC SQL dans un membre /INCLUDE est refusé', () => {
  assert.throws(() => parse('/include sqlinc\n', { ...copies(SQL_MEMBER), rpgppopt: '*LVL1' }), /RPGPPOPT\(\*LVL1\)/);
});

test('un EXEC SQL dans un membre inclus par un /COPY imbriqué sous /INCLUDE est refusé', () => {
  assert.throws(() => parse('/include a\n', copies({ A: '/copy sqlinc', ...SQL_MEMBER })), /EXEC SQL.*\/INCLUDE A/);
});

test('RPGPPOPT(*LVL2) : le membre /INCLUDE est développé avant le précompilateur SQL', () => {
  assert.doesNotThrow(() => parse('/include sqlinc\n', { ...copies(SQL_MEMBER), rpgppopt: '*LVL2' }));
});

test('un EXEC SQL dans un membre /COPY est toujours accepté', () => {
  assert.doesNotThrow(() => parse('/copy sqlinc\n', copies(SQL_MEMBER)));
});

test('une valeur de RPGPPOPT inconnue est refusée', () => {
  assert.throws(() => parse('/include sqlinc\n', { ...copies(SQL_MEMBER), rpgppopt: '*LVL3' }), /RPGPPOPT.*\*LVL3/);
});
