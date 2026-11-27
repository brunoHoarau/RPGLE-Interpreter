// Tableaux : tableaux de DS
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
const CTX = { tables: { CLIENT: { format: 'CLIENTF', keys: ['NUMCLI'], columns: [{ name: 'NUMCLI', type: 'int(10)' }, { name: 'NOM', type: 'char(10)' }], data: [] } } };

// --- Tableaux de DS (T4) ---


test('DS tableau : d(i).champ en lecture et écriture', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      a int(10);
      b char(5) inz('xx');
    end-ds;
    d(2).a = 7;
    d(2).b = 'abcdefgh';
    dsply d(1).a;
    dsply d(2).a;
    dsply d(2).b;
    dsply %trim(d(3).b);
    d(2).a += 3;
    dsply d(2).a;
    *inlr = *on;
  `), ['0', '7', 'abcde', 'xx', '10']);
});

test('DS tableau : INZ des sous-zones pour chaque élément, coercition par champ', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(2);
      p packed(5:2) inz(1.5);
    end-ds;
    dsply d(1).p;
    dsply d(2).p;
    d(1).p = 1.239;
    dsply d(1).p;
    *inlr = *on;
  `), ['1.5', '1.5', '1.23']);
});

test('DS tableau : hors bornes 00121 et MONITOR', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(2);
      a int(10);
    end-ds;
    monitor;
      d(3).a = 1;
    on-error 121;
      dsply 'hors';
    endmon;
    *inlr = *on;
  `), ['hors']);
});

test('DS tableau DIM(*AUTO : n) : *next, %elem et extension', () => {
  assert.deepEqual(run(`
    dcl-ds m qualified;
      a int(10);
    end-ds;
    dcl-ds d likeds(m) dim(*auto : 5);
    dsply %elem(d);
    m.a = 4;
    d(*next) = m;
    m.a = 8;
    d(*next) = m;
    dsply %elem(d);
    dsply d(1).a;
    dsply d(2).a;
    d(4).a = 1;
    dsply %elem(d);
    *inlr = *on;
  `), ['0', '2', '4', '8', '4']);
});

test('DS tableau : d(i) = autreDs, autreDs = d(i), d(i) = d(j)', () => {
  assert.deepEqual(run(`
    dcl-ds m qualified;
      a int(10);
      b char(3);
    end-ds;
    dcl-ds n qualified;
      x int(10);
      y char(3);
    end-ds;
    dcl-ds d likeds(m) dim(3);
    m.a = 5;
    m.b = 'ab';
    d(1) = m;
    dsply d(1).a;
    d(2) = d(1);
    dsply d(2).b;
    d(2).a = 9;
    n = d(2);
    dsply n.x;
    dsply d(1).a;
    d(3) = n;
    dsply d(3).b;
    *inlr = *on;
  `), ['5', 'ab', '9', '5', 'ab']);
});

test('DS tableau : disposition différente refusée', () => {
  assert.throws(() => run(`
    dcl-ds m qualified;
      a char(5);
    end-ds;
    dcl-ds d qualified dim(2);
      a int(10);
    end-ds;
    d(1) = m;
  `), err => NOT_SUPPORTED.test(err.message) && /disposition/i.test(err.message));
});

test('DS tableau : LIKEREC et EXTNAME avec DIM', () => {
  assert.deepEqual(run(`
    dcl-f client keyed;
    dcl-ds d likerec(clientf) dim(2);
    dcl-ds e extname('CLIENT') qualified dim(2) end-ds;
    d(2).nom = 'Zoe';
    e(1).numcli = 3;
    dsply %trim(d(2).nom);
    dsply e(1).numcli;
    *inlr = *on;
  `, CTX), ['Zoe', '3']);
});

test('DS tableau locale à une procédure et paramètre likeds const', () => {
  assert.deepEqual(run(`
    dcl-ds m qualified;
      a int(10);
    end-ds;
    dcl-proc p;
      dcl-pi *n;
        src likeds(m) const;
      end-pi;
      dcl-ds d likeds(m) dim(2);
      d(2) = src;
      dsply d(2).a;
    end-proc;
    m.a = 42;
    p(m);
    *inlr = *on;
  `), ['42']);
});

test('DS tableau : erreurs de compilation', () => {
  const decl = 'dcl-ds d qualified dim(2); a int(10); end-ds; dcl-s x int(10);';
  assert.throws(() => parse('dcl-ds d dim(2); a int(10); end-ds;'), /QUALIFIED/i);
  assert.throws(() => parse(`dcl-ds d extname('CLIENT') dim(2) end-ds;`), /QUALIFIED/i);
  for (const body of ['x = d.a;', 'x = d;', 'd.a = 1;']) {
    assert.throws(() => parse(`${decl} ${body}`), err => !NOT_SUPPORTED.test(err.message) && /d/i.test(err.message), body);
  }
});

test('DS tableau : refus explicites', () => {
  const decl = 'dcl-ds d qualified dim(2); a int(10); end-ds; dcl-s x int(10);';
  assert.throws(() => parse(`${decl} dcl-ds e likeds(d);`), err => NOT_SUPPORTED.test(err.message) && /LIKEDS de la DS tableau/.test(err.message));
  assert.throws(() => parse(`${decl} d(*next).a = 1;`), /\*NEXT/);
  assert.throws(() => parse(`${decl} dcl-f client keyed; read client d;`), err => NOT_SUPPORTED.test(err.message) && /opération de fichier/.test(err.message));
  assert.throws(() => parse(`dcl-f client keyed; ${decl} read client d(1);`), err => NOT_SUPPORTED.test(err.message) && /opération de fichier/.test(err.message));
  assert.throws(() => run(`${decl} dsply d(1);`), err => NOT_SUPPORTED.test(err.message) && /utilisée comme valeur/.test(err.message));
  assert.throws(() => run(`${decl} d(1) = 5;`), err => NOT_SUPPORTED.test(err.message) && /pas une structure de données/.test(err.message));
});
