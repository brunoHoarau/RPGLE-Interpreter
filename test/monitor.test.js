const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./helpers');

test('seul le premier ON-ERROR correspondant est exécuté', () => {
  const out = run(`
    dcl-s x int(10);
    monitor;
      x = 1 / 0;
    on-error;
      dsply 'a';
    on-error;
      dsply 'b';
    endmon;
  `);
  assert.deepEqual(out, ['a']);
});

test('ON-ERROR choisit le bloc dont le code correspond', () => {
  const out = run(`
    dcl-s x int(10);
    monitor;
      x = 1 / 0;
    on-error 00103;
      dsply 'depassement';
    on-error 00102;
      dsply 'division';
    endmon;
  `);
  assert.deepEqual(out, ['division']);
});

test('ON-ERROR accepte plusieurs codes séparés par :', () => {
  const out = run(`
    dcl-s x int(5);
    monitor;
      x = 40000;
    on-error 00102 : 00103;
      dsply 'calcul';
    endmon;
  `);
  assert.deepEqual(out, ['calcul']);
});

test('*PROGRAM intercepte les erreurs programme, pas *FILE', () => {
  const out = run(`
    dcl-s x int(10);
    monitor;
      x = 1 / 0;
    on-error *file;
      dsply 'fichier';
    on-error *program;
      dsply 'programme';
    endmon;
  `);
  assert.deepEqual(out, ['programme']);
});

test('*ALL intercepte toutes les erreurs', () => {
  const out = run(`
    dcl-s x int(10);
    monitor;
      x = 1 / 0;
    on-error *all;
      dsply 'tout';
    endmon;
  `);
  assert.deepEqual(out, ['tout']);
});

test('sans ON-ERROR correspondant, l\'erreur remonte', () => {
  assert.throws(() => run(`
    dcl-s x int(10);
    monitor;
      x = 1 / 0;
    on-error 00103;
      dsply 'depassement';
    endmon;
  `), /RNX0102/);
});

test('un MONITOR englobant reçoit l\'erreur non traitée par le MONITOR interne', () => {
  const out = run(`
    dcl-s x int(10);
    monitor;
      monitor;
        x = 1 / 0;
      on-error 00103;
        dsply 'interne';
      endmon;
    on-error 00102;
      dsply 'externe';
    endmon;
  `);
  assert.deepEqual(out, ['externe']);
});

test('une erreur dans un bloc ON-ERROR remonte', () => {
  assert.throws(() => run(`
    dcl-s x int(10);
    monitor;
      x = 1 / 0;
    on-error;
      x = 2 / 0;
    endmon;
  `), /RNX0102/);
});

test('%STATUS donne le code de la dernière erreur interceptée', () => {
  const out = run(`
    dcl-s x int(5);
    dsply %char(%status());
    monitor;
      x = 40000;
    on-error;
      dsply %char(%status());
    endmon;
  `);
  assert.deepEqual(out, ['0', '103']);
});

test('une conversion non numérique a le statut 00105', () => {
  const out = run(`
    dcl-s n int(10);
    dcl-s c char(5) inz('abc');
    monitor;
      n = %int(c);
    on-error 00105;
      dsply 'conversion';
    endmon;
  `);
  assert.deepEqual(out, ['conversion']);
});

test('une erreur de l\'interpréteur n\'est pas interceptée par MONITOR', () => {
  assert.throws(() => run(`
    monitor;
      dsply inconnue;
    on-error;
      dsply 'intercepte';
    endmon;
  `), /non déclarée/);
});

test('la limite d\'itérations n\'est pas interceptée par MONITOR', () => {
  assert.throws(() => run(`
    monitor;
      dow 1 = 1;
      enddo;
    on-error;
      dsply 'intercepte';
    endmon;
  `, undefined, { maxIterations: 100 }), /limite/i);
});

test('une erreur interceptée par MONITOR est tracée dans la sortie, comme dans le joblog', () => {
  const { runRaw } = require('./helpers');
  const output = runRaw(`
    dcl-s x int(10);
    monitor;
      x = 1 / 0;
    on-error;
      dsply 'intercepte';
    endmon;
  `);
  assert.deepEqual(output, ['[JOBLOG] Division par zéro (RNX0102) - interceptée par MONITOR', '[DSPLY] intercepte']);
});
