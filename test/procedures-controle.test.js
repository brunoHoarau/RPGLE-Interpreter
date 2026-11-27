// Procedures : flux de contrôle, prototypes et SQL
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, customersContext } = require('./helpers');

test('récursion : factorielle', () => {
  const out = run(`
    dsply %char(fact(5));

    dcl-proc fact;
      dcl-pi *n int(10);
        n int(10) value;
      end-pi;
      if n <= 1;
        return 1;
      endif;
      return n * fact(n - 1);
    end-proc;
  `);
  assert.deepEqual(out, ['120']);
});

test('RETURN dans une boucle sort de la procédure, pas du programme', () => {
  const out = run(`
    dsply %char(premier(7));
    dsply 'suite';

    dcl-proc premier;
      dcl-pi *n int(10);
        max int(10) value;
      end-pi;
      dcl-s i int(10);
      for i = 1 to max;
        if i = 3;
          return i;
        endif;
      endfor;
      return 0;
    end-proc;
  `);
  assert.deepEqual(out, ['3', 'suite']);
});

test('RETURN sans valeur sort seulement de la procédure', () => {
  const out = run(`
    p();
    dsply 'apres';
    dcl-proc p;
      dsply 'debut';
      return;
      dsply 'jamais';
    end-proc;
  `);
  assert.deepEqual(out, ['debut', 'apres']);
});

test('une récursion infinie est stoppée', () => {
  assert.throws(
    () => run(`
      p();
      dcl-proc p;
        p();
      end-proc;
    `, undefined, { maxCallDepth: 50 }),
    /récursion/i
  );
});

test('appel d\'une procédure inconnue', () => {
  assert.throws(() => run(`inconnue();`), /inconnue/);
});

// --- Prototypes et SQL ---


test('les prototypes DCL-PR sont acceptés', () => {
  const out = run(`
    dcl-pr add int(10);
      a int(10) value;
      b int(10) value;
    end-pr;

    dsply %char(add(1: 2));

    dcl-proc add;
      dcl-pi *n int(10);
        a int(10) value;
        b int(10) value;
      end-pi;
      return a + b;
    end-proc;
  `);
  assert.deepEqual(out, ['3']);
});

test('EXEC SQL dans un bloc IF', () => {
  const out = run(`
    dcl-s vName char(20);
    if 1 = 1;
      exec sql select name into :vName from customers where id = 2;
    endif;
    dsply vName;
  `, customersContext());
  assert.deepEqual(out, ['Martin']);
});

test('EXEC SQL dans une procédure avec variable hôte locale', () => {
  const out = run(`
    dsply nomClient(3);

    dcl-proc nomClient;
      dcl-pi *n char(20);
        id int(10) value;
      end-pi;
      dcl-s nom char(20);
      exec sql select name into :nom from customers where id = :id;
      return nom;
    end-proc;
  `, customersContext());
  assert.deepEqual(out, ['Bernard']);
});
