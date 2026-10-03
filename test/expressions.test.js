const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./helpers');

const show = expr => run(`dsply %char(${expr});`)[0];

// --- Moins / plus unaires ---

test('moins unaire sur une variable', () => {
  const out = run(`
    dcl-s x int(5) inz(5);
    x = -x;
    dsply %char(x);
  `);
  assert.deepEqual(out, ['-5']);
});

test('moins unaire après un opérateur binaire', () => {
  assert.equal(show('5 - -3'), '8');
});

test('moins unaire dans INZ', () => {
  assert.deepEqual(run(`dcl-s x int(5) inz(-7); dsply %char(x);`), ['-7']);
});

test('moins unaire sur une expression parenthésée', () => {
  assert.equal(show('-(2 + 3) * 2'), '-10');
});

test('plus unaire', () => {
  assert.equal(show('+4 + 1'), '5');
});

test('le moins unaire est prioritaire sur **', () => {
  assert.equal(show('-2 ** 2'), '4');
});

// --- Puissance ---

test('** est prioritaire sur *', () => {
  assert.equal(show('2 * 3 ** 2'), '18');
});

test('** est associatif à droite', () => {
  assert.equal(show('2 ** 3 ** 2'), '512');
});

test('exposant négatif', () => {
  assert.equal(show('2 ** -1'), '0.5');
});

// --- NOT ---

test('NOT est moins prioritaire que la comparaison', () => {
  const out = run(`
    dcl-s a int(5) inz(1);
    if not a = 2;
      dsply 'ok';
    endif;
  `);
  assert.deepEqual(out, ['ok']);
});

test('NOT est plus prioritaire que AND', () => {
  const out = run(`
    dcl-s a int(5) inz(1);
    dcl-s b int(5) inz(2);
    if not a = 3 and b = 2;
      dsply 'ok';
    endif;
    if not a = 1 and b = 2;
      dsply 'ko';
    endif;
  `);
  assert.deepEqual(out, ['ok']);
});

test('NOT sur un indicateur et NOT NOT', () => {
  const out = run(`
    dcl-s fin ind inz(*off);
    if not fin;
      dsply 'a';
    endif;
    if not not fin;
      dsply 'b';
    endif;
  `);
  assert.deepEqual(out, ['a']);
});

// --- Chaînes ---

test('quote doublée dans une chaîne', () => {
  assert.deepEqual(run(`dsply 'l''eau';`), ["l'eau"]);
});

test('chaîne vide et quote en fin de chaîne', () => {
  assert.deepEqual(run(`dsply '' + 'a''';`), ["a'"]);
});

test('quote doublée dans un littéral SQL', () => {
  const ctx = {
    tables: { T: { columns: [], data: [{ ID: 1, NAME: "O'Neil" }] } },
    files: {},
    programs: {},
  };
  const out = run(`
    dcl-s v char(10);
    exec sql select id into :v from t where name = 'O''Neil';
    dsply %char(v);
  `, ctx);
  assert.deepEqual(out, ['1']);
});

// --- Tiret : soustraction vs mots-clés composés ---

test('soustraction sans espaces entre identifiants', () => {
  const out = run(`
    dcl-s a int(5) inz(5);
    dcl-s b int(5) inz(2);
    a = a-b;
    dsply %char(a);
  `);
  assert.deepEqual(out, ['3']);
});

test('soustraction sans espaces entre identifiant et nombre', () => {
  assert.deepEqual(run(`dcl-s a int(5) inz(5); a = a-1; dsply %char(a);`), ['4']);
});

test('les mots-clés composés restent reconnus quelle que soit la casse', () => {
  const out = run(`
    CTL-OPT dftactgrp(*no);
    DCL-S a int(5) inz(1);
    DCL-DS ds qualified;
      x int(5) inz(2);
    END-DS;
    monitor;
      a = 1 / 0;
    ON-ERROR;
      dsply 'erreur';
    endmon;
    dsply %char(a + ds.x);
  `);
  assert.deepEqual(out, ['erreur', '3']);
});
