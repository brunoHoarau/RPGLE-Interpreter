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

// --- LIKEDS et affectation de DS entière ---

test('LIKEDS : mêmes sous-zones et mêmes types, valeurs par défaut (INZ non hérité)', () => {
  const out = run(`
    dcl-ds base qualified;
      id int(10) inz(5);
      nom char(10) inz('abc');
    end-ds;
    dcl-ds copie likeds(base);
    dsply %char(copie.id) + '|' + %trim(copie.nom);
    copie.nom = 'ab';
    dsply %char(%len(copie.nom));
  `);
  assert.deepEqual(out, ['0|', '10']);
});

test('LIKEDS avec INZ(*LIKEDS) : valeurs INZ de la déclaration de la source, pas ses valeurs courantes', () => {
  const out = run(`
    dcl-ds base qualified;
      id int(10) inz(5);
      nom char(10) inz('abc');
    end-ds;
    dcl-ds copie likeds(base) inz(*likeds);
    base.id = 9;
    dsply %char(copie.id) + '|' + %trim(copie.nom);
  `);
  assert.deepEqual(out, ['5|abc']);
});

test('LIKEDS d\'une DS non qualifiée : la nouvelle DS est qualifiée, les noms nus restent ceux de la source', () => {
  const out = run(`
    dcl-ds base;
      id int(10) inz(5);
    end-ds;
    dcl-ds copie likeds(base);
    copie.id = 8;
    dsply %char(id) + ' ' + %char(copie.id);
  `);
  assert.deepEqual(out, ['5 8']);
});

test('LIKEDS dans une procédure d\'une DS globale', () => {
  const out = run(`
    dcl-ds base qualified;
      id int(10) inz(5);
    end-ds;
    p();
    dcl-proc p;
      dcl-ds loc likeds(base) inz(*likeds);
      loc.id = loc.id + 1;
      dsply %char(loc.id) + ' ' + %char(base.id);
    end-proc;
  `);
  assert.deepEqual(out, ['6 5']);
});

test('a = b entre DS de même disposition : copie sous-zone par sous-zone, sans partage', () => {
  const out = run(`
    dcl-ds a qualified;
      x int(10);
      y char(3);
    end-ds;
    dcl-ds b qualified;
      p int(10) inz(4);
      q char(3) inz('xyz');
    end-ds;
    a = b;
    b.p = 99;
    dsply %char(a.x) + a.y + ' ' + %char(b.p);
  `);
  assert.deepEqual(out, ['4xyz 99']);
});

test('a = b entre une DS et sa DS LIKEDS, et DS non qualifiée vers qualifiée', () => {
  const out = run(`
    dcl-ds base;
      id int(10) inz(3);
    end-ds;
    dcl-ds copie likeds(base);
    copie = base;
    dsply %char(copie.id);
  `);
  assert.deepEqual(out, ['3']);
});

test('a = b entre dispositions différentes : pas encore supporté', () => {
  assert.throws(() => run(`
    dcl-ds a qualified;
      x int(10);
      y char(3);
    end-ds;
    dcl-ds c qualified;
      x int(5);
      y char(3);
    end-ds;
    a = c;
  `), /copie d'octets/i);
  assert.throws(() => run(`
    dcl-ds a qualified;
      x int(10);
    end-ds;
    dcl-ds c qualified;
      x int(10);
      y char(3);
    end-ds;
    a = c;
  `), /pas encore support/i);
});

test('DS affectée depuis une valeur non DS, ou DS affectée à une variable : pas encore supporté', () => {
  for (const body of ['a = 5;', "a = 'abc';", 'v = a;', 'a = v;']) {
    assert.throws(() => run(`
      dcl-ds a qualified;
        x int(10);
      end-ds;
      dcl-s v char(10);
      ${body}
    `), /pas encore support/i, body);
  }
});
