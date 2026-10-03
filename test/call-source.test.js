// Appel d'un programme dont le source est disponible en local (EXTPGM sans bouchon)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, runRaw } = require('./helpers');
const { folderProgramResolver } = require('../out/sources');

// Résolveur en mémoire : nom de programme -> source
const sources = map => ({ resolveProgram: name => (map[name] ? { source: map[name], path: `${name}.rpgle` } : undefined) });

const CALLER = `
  dcl-pr appele extpgm('APPELE');
    entree char(10) const;
    sortie packed(7:2);
  end-pr;
  dcl-s e char(10) inz('A');
  dcl-s s packed(7:2);
`;

const CALLEE = (body) => `
  dcl-pi *n;
    in char(10) const;
    out packed(7:2);
  end-pi;
  ${body}
  *inlr = *on;
  return;
`;

test('le programme appelé est exécuté et renvoie ses paramètres', () => {
  const out = run(`${CALLER} appele(e: s); dsply %char(s);`, undefined,
    sources({ APPELE: CALLEE(`if in = 'A'; out = 12.5; endif;`) }));
  assert.deepEqual(out, ['12.50']);
});

test('un paramètre CONST du prototype n\'est pas renvoyé à l\'appelant', () => {
  const out = run(`
    dcl-pr appele extpgm('APPELE');
      entree char(10) const;
    end-pr;
    dcl-s e char(10) inz('A');
    appele(e);
    dsply e;
  `, undefined, sources({ APPELE: `dcl-pi *n; in char(10); end-pi; in = 'modifie';` }));
  assert.deepEqual(out, ['A']);
});

test('les variables globales du programme appelé sont isolées', () => {
  const out = run(`${CALLER} dcl-s x int(5) inz(1); appele(e: s); dsply %char(x);`, undefined,
    sources({ APPELE: CALLEE(`dcl-s x int(5) inz(99); x = 50;`) }));
  assert.deepEqual(out, ['1']);
});

test('les DSPLY du programme appelé apparaissent à leur place', () => {
  const out = run(`${CALLER} dsply 'avant'; appele(e: s); dsply 'apres';`, undefined,
    sources({ APPELE: CALLEE(`dsply 'dans appele';`) }));
  assert.deepEqual(out, ['avant', 'dans appele', 'apres']);
});

test('une erreur non interceptée dans le programme appelé remonte en 00202', () => {
  const out = run(`${CALLER}
    monitor;
      appele(e: s);
    on-error 00202;
      dsply 'echec ' + %char(%status());
    endmon;
  `, undefined, sources({ APPELE: CALLEE(`dsply 'debut'; out = 10 / out; dsply 'jamais';`) }));
  assert.deepEqual(out, ['debut', 'echec 202']);
});

test('le message d\'échec cite le programme appelé et l\'erreur d\'origine', () => {
  assert.throws(() => run(`${CALLER} appele(e: s);`, undefined, sources({ APPELE: CALLEE(`out = 10 / out;`) })),
    err => /APPELE/.test(err.message) && /RNX0102/.test(err.message));
});

test('un bouchon est prioritaire sur le source', () => {
  const ctx = { tables: {}, files: {}, programs: { APPELE: { calls: [{ set: { sortie: 1 } }] } } };
  const out = run(`${CALLER} appele(e: s); dsply %char(s);`, ctx, sources({ APPELE: CALLEE(`out = 99;`) }));
  assert.deepEqual(out, ['1.00']);
});

test('l\'appel d\'un source est tracé dans la sortie', () => {
  const output = runRaw(`${CALLER} appele(e: s);`, undefined, sources({ APPELE: CALLEE('') }));
  assert.ok(output.some(l => /\[APPEL\] APPELE/.test(l) && /APPELE\.rpgle/.test(l)), output.join('\n'));
});

test('une erreur de syntaxe dans le programme appelé cite le programme', () => {
  assert.throws(() => run(`${CALLER} appele(e: s);`, undefined, sources({ APPELE: `if;` })), /APPELE/);
});

test('une récursion infinie entre programmes est stoppée', () => {
  const boucle = `
    dcl-pr boucle extpgm('BOUCLE');
    end-pr;
    boucle();
  `;
  assert.throws(() => run(boucle, undefined, { ...sources({ BOUCLE: boucle }), maxCallDepth: 20 }), /profondeur/i);
});

test('un programme avec paramètres d\'entrée ne peut pas être lancé directement', () => {
  assert.throws(() => run(CALLEE('')), /paramètres d'entrée/);
});

// --- Recherche des sources dans un dossier ---

test('le résolveur trouve un source .rpgle ou .sqlrpgle sans tenir compte de la casse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgle-src-'));
  fs.writeFileSync(path.join(dir, 'monPgm.rpgle'), 'dsply 1;');
  fs.writeFileSync(path.join(dir, 'AUTRE.SQLRPGLE'), 'dsply 2;');
  fs.writeFileSync(path.join(dir, 'texte.txt'), '');
  const resolve = folderProgramResolver(dir);
  assert.equal(resolve('MONPGM').source, 'dsply 1;');
  assert.equal(resolve('autre').source, 'dsply 2;');
  assert.equal(resolve('TEXTE'), undefined);
  assert.equal(resolve('ABSENT'), undefined);
});

test('le résolveur d\'un dossier inexistant ne trouve rien', () => {
  assert.equal(folderProgramResolver(path.join(os.tmpdir(), 'rpgle-absent-' + Date.now()))('X'), undefined);
});
