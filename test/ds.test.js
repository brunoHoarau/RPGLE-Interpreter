const test = require('node:test');
const assert = require('node:assert/strict');
const { run, customersContext } = require('./helpers');

test('les champs d\'une DS non qualifiée s\'utilisent comme des variables', () => {
  const out = run(`
    dcl-ds info;
      nom char(10) inz('Dupont');
      age int(5) inz(40);
    end-ds;
    age = age + 1;
    dsply %trim(nom) + ' ' + %char(age);
  `);
  assert.deepEqual(out, ['Dupont 41']);
});

test('le type d\'un champ de DS non qualifiée s\'applique à l\'affectation directe', () => {
  const out = run(`
    dcl-ds info;
      nom char(10);
      age int(5);
    end-ds;
    nom = 'ab';
    age = 7 / 2;
    dsply %char(%len(nom)) + ' ' + %char(age);
  `);
  assert.deepEqual(out, ['10 3']);
});

test('les champs d\'une DS qualifiée ne sont pas accessibles directement', () => {
  assert.throws(() => run(`
    dcl-ds client qualified;
      id int(10) inz(1);
    end-ds;
    dsply %char(id);
  `), /non déclarée/);
});

test('un champ de DS non qualifiée ne peut pas porter le nom d\'une variable existante', () => {
  assert.throws(() => run(`
    dcl-s nom char(10);
    dcl-ds info;
      nom char(10);
    end-ds;
  `), /déjà déclaré/);
});

test('un champ de DS non qualifiée sert de variable hôte SQL', () => {
  const out = run(`
    dcl-ds cli;
      vId int(10) inz(2);
      vName char(20);
    end-ds;
    exec sql select name into :vName from customers where id = :vId;
    dsply vName;
  `, customersContext());
  assert.deepEqual(out, ['Martin']);
});

test('un champ de DS non qualifiée passé par référence est modifié', () => {
  const out = run(`
    dcl-ds compteurs;
      total int(10) inz(1);
    end-ds;
    incr(total);
    dsply %char(total);

    dcl-proc incr;
      dcl-pi *n;
        n int(10);
      end-pi;
      n = n + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['2']);
});

test('une procédure voit les champs d\'une DS non qualifiée globale', () => {
  const out = run(`
    dcl-ds cfg;
      taux int(5) inz(20);
    end-ds;
    p();

    dcl-proc p;
      dsply %char(taux);
    end-proc;
  `);
  assert.deepEqual(out, ['20']);
});

test('les champs d\'une DS locale ne sont pas visibles hors de la procédure', () => {
  assert.throws(() => run(`
    p();
    dsply %char(local);

    dcl-proc p;
      dcl-ds tmp;
        local int(5) inz(1);
      end-ds;
    end-proc;
  `), /non déclarée/);
});

test('une DS est déclarée avant l\'exécution du code, comme dcl-s', () => {
  const out = run(`
    p();

    dcl-proc p;
      dsply %char(client.id);
    end-proc;

    dcl-ds client qualified;
      id int(10) inz(7);
    end-ds;
  `);
  assert.deepEqual(out, ['7']);
});
