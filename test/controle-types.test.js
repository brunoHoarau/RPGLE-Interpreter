// Lot « contrôle des types et corrections » : comportements alignés sur IBM i
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw, customersContext } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

test('DSPLY : message, file de messages, puis réponse', () => {
  const out = run(`
    dcl-s rep char(1);
    dsply 'Continuer ?' '' rep;
    dsply 'reponse=[' + rep + ']';
  `);
  assert.deepEqual(out, ['Continuer ?', 'reponse=[Y]']);
});

test('DSPLY : file de messages indiquée', () => {
  assert.deepEqual(run(`dsply 'Info' '*EXT';`), ['Info (File: *EXT)']);
  assert.deepEqual(run(`dsply 'Info' *ext;`), ['Info (File: *ext)']);
  assert.deepEqual(run(`dsply 'Info' *blank;`), ['Info']);
});

test('DSPLY : la réponse doit être une variable, 3 opérandes au plus', () => {
  assert.throws(() => parse(`dsply 'Q' '' 'x';`), /réponse de DSPLY doit être une variable/i);
  assert.throws(() => parse(`dcl-s r char(1); dsply 'Q' '' r r;`), /au plus 3 opérandes/i);
});

test('DSPLY : réponse dans un champ de DS', () => {
  const out = run(`
    dcl-ds saisie qualified;
      choix char(1);
    end-ds;
    dsply 'Choix ?' '' saisie.choix;
    dsply saisie.choix;
  `);
  assert.deepEqual(out, ['Choix ?', 'Y']);
});

test('SQL SET : calcul avec colonnes, variables hôtes et priorités', () => {
  const ctx = customersContext();
  run(`
    dcl-s bonus packed(7:2) inz(10);
    exec sql update customers set balance = balance + 100 where id = 2;
    exec sql update customers set balance = (balance - :bonus) * 2 + 1 where id = 3;
  `, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[1].BALANCE, 330);
  assert.equal(ctx.tables.CUSTOMERS.data[2].BALANCE, 1762.5);
});

test('SQL SET : une colonne prend la valeur de la ligne avant mise à jour', () => {
  const ctx = customersContext();
  run(`exec sql update customers set name = city, city = name where id = 1;`, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[0].NAME, 'Paris');
  assert.equal(ctx.tables.CUSTOMERS.data[0].CITY, 'Dupont');
});

test('SQL : virgules et égal dans les littéraux', () => {
  const ctx = customersContext();
  run(`
    exec sql insert into customers (id, name, city, balance) values (4, 'Dupont, Jean', 'Nice', 2 * 50);
    exec sql update customers set city = 'a=b, c' where id = 4;
  `, ctx);
  const row = ctx.tables.CUSTOMERS.data[3];
  assert.equal(row.NAME, 'Dupont, Jean');
  assert.equal(row.CITY, 'a=b, c');
  assert.equal(row.BALANCE, 100);
});

test('SQL : NULL dans un calcul donne NULL', () => {
  const ctx = customersContext();
  run(`exec sql update customers set balance = null + 1 where id = 1;`, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[0].BALANCE, null);
});

test('SQL : expression non supportée, le programme s\'arrête', () => {
  for (const sql of [
    `exec sql update customers set name = upper(name) where id = 1;`,
    `exec sql update customers set name = concat(name, 'x') where id = 1;`,
    `exec sql update customers set balance = name + 1 where id = 1;`,
  ]) {
    assert.throws(() => run(`${sql} dsply 'continue';`, customersContext()), NOT_SUPPORTED, sql);
  }
});

test('SQL : une vraie erreur SQL reste un SQLCOD négatif', () => {
  const out = runRaw(`exec sql update inconnue set a = 1 where b = 2; dsply 'apres';`, customersContext());
  assert.ok(out.some(l => /SQLCOD=-1/.test(l)));
  assert.ok(out.some(l => /apres/.test(l)));
});

const READ_ONLY = /affectation refusée par le compilateur IBM i/i;

test('affectation à une constante dcl-c refusée à l\'analyse', () => {
  for (const src of [
    `dcl-c TAUX 20; TAUX = 99;`,
    `dcl-c TAUX 20; taux += 1;`,
    `dcl-c TAUX 20; eval TAUX = 1;`,
    `dcl-c I 1; for i = 1 to 3; endfor;`,
    `dcl-c REP 'x'; dsply 'Q' '' rep;`,
  ]) {
    assert.throws(() => parse(src), READ_ONLY, src);
  }
});

test('affectation à un paramètre CONST refusée à l\'analyse', () => {
  assert.throws(() => parse(`
    dcl-proc p;
      dcl-pi *n;
        montant packed(7:2) const;
      end-pi;
      montant = 0;
    end-proc;`), READ_ONLY);
});

test('portée : une variable locale masque la constante, et le paramètre CONST est local', () => {
  const out = run(`
    dcl-c N 5;
    p(3);
    dsply %char(N);
    dcl-proc p;
      dcl-pi *n;
        x int(10) const;
      end-pi;
      dcl-s n int(10);
      n = x * 2;
      dsply %char(n);
    end-proc;
    dcl-proc q;
      dcl-s x int(10);
      x = 1;
    end-proc;
  `);
  assert.deepEqual(out, ['6', '5']);
});

test('une constante passée à un paramètre modifiable est refusée', () => {
  assert.throws(() => run(`
    dcl-c TAUX 20;
    p(TAUX);
    dcl-proc p;
      dcl-pi *n;
        t int(10);
      end-pi;
      t = 1;
    end-proc;`), INCOMPATIBLE);
  // CONST et VALUE restent acceptés
  const out = run(`
    dcl-c TAUX 20;
    dsply %char(double(TAUX));
    dcl-proc double;
      dcl-pi *n int(10);
        t int(10) const;
      end-pi;
      return t * 2;
    end-proc;`);
  assert.deepEqual(out, ['40']);
});

test('DSPLY : une réponse nommée comme un type est une variable', () => {
  assert.deepEqual(run(`dcl-s date char(1); dsply 'Q' '' date; dsply date;`), ['Q', 'Y']);
});

test('DSPLY : une valeur spéciale ne peut pas être la réponse', () => {
  assert.throws(() => parse(`dsply 'a' '' *ext;`), /réponse de DSPLY doit être une variable/i);
});

test('SQL : colonne inconnue dans SET ou INSERT = erreur SQL, rien n\'est créé', () => {
  const ctx = customersContext();
  const out = runRaw(`exec sql update customers set blance = 5 where id = 2;`, ctx);
  assert.ok(out.some(l => /SQLCOD=-1/.test(l) && /BLANCE/.test(l)));
  assert.deepEqual(Object.keys(ctx.tables.CUSTOMERS.data[1]), ['ID', 'NAME', 'CITY', 'BALANCE']);
  const ctx2 = customersContext();
  const out2 = runRaw(`exec sql insert into customers (id, nom) values (4, 'x');`, ctx2);
  assert.ok(out2.some(l => /SQLCOD=-1/.test(l)));
  assert.equal(ctx2.tables.CUSTOMERS.data.length, 3);
});

test('SQL INSERT : nombre de valeurs différent du nombre de colonnes', () => {
  const ctx = customersContext();
  const out = runRaw(`exec sql insert into customers (id, name, city) values (4, 'x');`, ctx);
  assert.ok(out.some(l => /SQLCOD=-1/.test(l) && /3 colonnes pour 2 valeurs/.test(l)));
  assert.equal(ctx.tables.CUSTOMERS.data.length, 3);
});

test('SQL SET : arithmétique décimale exacte, division refusée', () => {
  const ctx = customersContext();
  run(`exec sql update customers set balance = balance + 0.1 where id = 2;`, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[1].BALANCE, 230.1);
  assert.throws(() => run(`exec sql update customers set balance = balance / 2 where id = 2; dsply 'x';`, customersContext()), NOT_SUPPORTED);
});

test('SQL UPDATE sans WHERE : toutes les lignes', () => {
  const ctx = customersContext();
  const out = runRaw(`exec sql update customers set city = 'X';`, ctx);
  assert.deepEqual(ctx.tables.CUSTOMERS.data.map(r => r.CITY), ['X', 'X', 'X']);
  assert.ok(out.some(l => /3 ligne/.test(l)));
});

test('SQL SET : liste de colonnes et sous-requête refusées', () => {
  for (const sql of [
    `exec sql update customers set (name, city) = ('a', 'b') where id = 1;`,
    `exec sql update customers set balance = (select max(balance) from customers) where id = 1;`,
  ]) {
    assert.throws(() => run(`${sql} dsply 'continue';`, customersContext()), NOT_SUPPORTED, sql);
  }
});

test('SQL UPDATE : WHERE cherché hors littéraux', () => {
  const ctx = customersContext();
  run(`exec sql update customers set city = 'x where y' where id = 1;`, ctx);
  assert.deepEqual(ctx.tables.CUSTOMERS.data.map(r => r.CITY), ['x where y', 'Lyon', 'Marseille']);
});
