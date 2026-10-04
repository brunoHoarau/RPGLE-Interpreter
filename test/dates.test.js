// Dates, heures et timestamps (socle *ISO) : comportement attendu sur IBM i
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

test('valeurs par défaut sans INZ', () => {
  const out = run(`
    dcl-s d date;
    dcl-s t time;
    dcl-s z timestamp;
    dsply %char(d);
    dsply %char(t);
    dsply %char(z);
  `);
  assert.deepEqual(out, ['0001-01-01', '00.00.00', '0001-01-01-00.00.00.000000']);
});

test('littéraux D, T et Z en INZ et en affectation, casse indifférente', () => {
  const out = run(`
    dcl-s d date inz(D'2026-10-04');
    dcl-s t time inz(t'13.45.00');
    dcl-s z timestamp inz(Z'2026-10-04-13.45.00.000123');
    dsply d;
    dsply t;
    dsply z;
    d = d'2024-02-29';
    dsply d;
  `);
  assert.deepEqual(out, ['2026-10-04', '13.45.00', '2026-10-04-13.45.00.000123', '2024-02-29']);
});

test('un littéral invalide est une erreur d\'analyse', () => {
  assert.throws(() => parse(`dcl-s d date inz(D'2026-02-30');`), /D'2026-02-30'.*invalide.*ligne 1/i);
  assert.throws(() => parse(`dcl-s t time; t = T'25.00.00';`), /invalide/i);
  assert.throws(() => parse(`dcl-s t time; t = T'13:45:00';`), /invalide/i);
});

test('date(*ISO), time(*ISO) et timestamp(6) sont acceptés', () => {
  const out = run(`
    dcl-s d date(*iso) inz(D'2026-10-04');
    dcl-s t time(*ISO);
    dcl-s z timestamp(6);
    dsply d;
  `);
  assert.deepEqual(out, ['2026-10-04']);
});

test('ctl-opt datfmt(*iso) timfmt(*iso) est accepté', () => {
  assert.deepEqual(run(`ctl-opt dftactgrp(*no) datfmt(*iso) timfmt(*iso); dsply 'ok';`), ['ok']);
});

test('dates dans une DS, en paramètre et en retour de procédure', () => {
  const out = run(`
    dcl-ds cmd qualified;
      num int(10);
      livraison date inz(D'2026-12-24');
    end-ds;
    dsply Cmd.Livraison;
    dsply %char(noel(cmd.livraison));
    dcl-proc noel;
      dcl-pi *n date;
        d date const;
      end-pi;
      dsply d;
      return D'2026-12-25';
    end-proc;
  `);
  assert.deepEqual(out, ['2026-12-24', '2026-12-24', '2026-12-25']);
});

test('une date passe par référence à un programme appelé', () => {
  const callee = `dcl-pi *n; d date; end-pi; dsply d; d = D'2027-01-01';`;
  const out = run(`
    dcl-pr suivant extpgm('SUIVANT');
      d date;
    end-pr;
    dcl-s d date inz(D'2026-10-04');
    suivant(d);
    dsply d;
  `, undefined, { resolveProgram: name => (name === 'SUIVANT' ? { source: callee } : undefined) });
  assert.deepEqual(out, ['2026-10-04', '2027-01-01']);
});

test('affecter un texte, un nombre ou un autre type à une date est refusé', () => {
  assert.throws(() => run(`dcl-s d date; d = '2026-10-04';`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; d = 20261004;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; dcl-s z timestamp; d = z;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s c char(10); c = D'2026-10-04';`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s n packed(8:0); n = D'2026-10-04';`), INCOMPATIBLE);
});

test('une erreur de type n\'est pas interceptée par MONITOR', () => {
  assert.throws(() => run(`
    dcl-s d date;
    monitor;
      d = 'x';
    on-error;
      dsply 'intercepté';
    endmon;
  `), INCOMPATIBLE);
});
