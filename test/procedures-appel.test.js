// Procedures : déclaration, appel, paramètres, portée
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, customersContext } = require('./helpers');

// --- Déclaration et appel ---


test('appel d\'une procédure sans paramètre', () => {
  const out = run(`
    dcl-proc saluer;
      dsply 'bonjour';
    end-proc;
    saluer();
    saluer();
  `);
  assert.deepEqual(out, ['bonjour', 'bonjour']);
});

test('procédure déclarée après le code principal', () => {
  const out = run(`
    ctl-opt dftactgrp(*no);
    saluer();
    return;

    dcl-proc saluer;
      dcl-pi *n end-pi;
      dsply 'bonjour';
    end-proc;
  `);
  assert.deepEqual(out, ['bonjour']);
});

test('fonction avec valeur de retour dans une expression', () => {
  const out = run(`
    dsply %char(add(2: 3) * 10);

    dcl-proc add;
      dcl-pi *n int(10);
        a int(10) value;
        b int(10) value;
      end-pi;
      return a + b;
    end-proc;
  `);
  assert.deepEqual(out, ['50']);
});

test('dcl-pi nommé, mot-clé export et nom insensible à la casse', () => {
  const out = run(`
    dsply %char(DOUBLE(4));

    dcl-proc Double export;
      dcl-pi Double int(10);
        n int(10) const;
      end-pi;
      return n * 2;
    end-proc;
  `);
  assert.deepEqual(out, ['8']);
});

test('CALLP appelle une procédure', () => {
  const out = run(`
    callp afficher('x');

    dcl-proc afficher;
      dcl-pi *n;
        msg char(10) const;
      end-pi;
      dsply msg;
    end-proc;
  `);
  assert.deepEqual(out, ['x']);
});

// --- Passage de paramètres ---


test('un paramètre par référence est modifié chez l\'appelant', () => {
  const out = run(`
    dcl-s x int(10) inz(1);
    incr(x);
    dsply %char(x);

    dcl-proc incr;
      dcl-pi *n;
        n int(10);
      end-pi;
      n = n + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['2']);
});

test('un champ de DS passé par référence est modifié', () => {
  const out = run(`
    dcl-ds c qualified;
      n int(10) inz(5);
    end-ds;
    incr(c.n);
    dsply %char(c.n);

    dcl-proc incr;
      dcl-pi *n;
        n int(10);
      end-pi;
      n = n + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['6']);
});

test('un paramètre VALUE n\'est pas modifié chez l\'appelant', () => {
  const out = run(`
    dcl-s x int(10) inz(1);
    incr(x);
    dsply %char(x);

    dcl-proc incr;
      dcl-pi *n;
        n int(10) value;
      end-pi;
      n = n + 1;
      dsply 'local ' + %char(n);
    end-proc;
  `);
  assert.deepEqual(out, ['local 2', '1']);
});

test('une expression peut être passée à un paramètre CONST', () => {
  const out = run(`
    dcl-s x int(10) inz(1);
    afficher(x + 41);

    dcl-proc afficher;
      dcl-pi *n;
        n int(10) const;
      end-pi;
      dsply %char(n);
    end-proc;
  `);
  assert.deepEqual(out, ['42']);
});

test('un nombre de paramètres incorrect est une erreur', () => {
  assert.throws(() => run(`
    p(1: 2);
    dcl-proc p;
      dcl-pi *n;
        a int(10) value;
      end-pi;
    end-proc;
  `), /paramètre/i);
});

test('OPTIONS(*NOPASS) autorise un paramètre omis', () => {
  const out = run(`
    p(1);
    dcl-proc p;
      dcl-pi *n;
        a int(10) value;
        b int(10) value options(*nopass);
      end-pi;
      dsply %char(a);
    end-proc;
  `);
  assert.deepEqual(out, ['1']);
});

// --- Portée ---


test('une variable locale n\'est pas visible du programme principal', () => {
  assert.throws(() => run(`
    p();
    dsply tmp;
    dcl-proc p;
      dcl-s tmp char(5) inz('loc');
    end-proc;
  `), /tmp/);
});

test('une variable locale masque la globale du même nom', () => {
  const out = run(`
    dcl-s x int(10) inz(1);
    p();
    dsply %char(x);

    dcl-proc p;
      dcl-s x int(10) inz(2);
      x = x + 10;
      dsply %char(x);
    end-proc;
  `);
  assert.deepEqual(out, ['12', '1']);
});

test('une procédure lit et modifie une variable globale', () => {
  const out = run(`
    dcl-s compteur int(10) inz(0);
    p();
    p();
    dsply %char(compteur);

    dcl-proc p;
      compteur = compteur + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['2']);
});

test('constante locale', () => {
  const out = run(`
    p();
    dcl-proc p;
      dcl-c TAUX 20;
      dsply %char(TAUX);
    end-proc;
  `);
  assert.deepEqual(out, ['20']);
});

test('les variables locales sont réinitialisées à chaque appel', () => {
  const out = run(`
    p();
    p();
    dcl-proc p;
      dcl-s n int(10) inz(0);
      n = n + 1;
      dsply %char(n);
    end-proc;
  `);
  assert.deepEqual(out, ['1', '1']);
});

// --- Flux de contrôle ---

