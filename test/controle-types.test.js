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

test('mélange caractère / numérique refusé dans les opérateurs', () => {
  for (const src of [
    `dcl-s total packed(7:2) inz(1500.5); dsply 'Total : ' + total;`,
    `dcl-s n int(10) inz(1); dcl-s c char(5) inz('a'); dsply %char(n + c);`,
    `dcl-s c char(5) inz('a'); dcl-s n int(10); n = c * 2;`,
    `dcl-s c char(5) inz('a'); dcl-s n int(10); n = -c;`,
    `dcl-s n int(10) inz(1); if n = '1'; endif;`,
    `dcl-s n int(10) inz(1); if n = *on; endif;`,
    `dcl-s n int(10) inz(1); dcl-s m int(10) inz(2); if n and m; endif;`,
    `dcl-s n int(10) inz(1); if not n; endif;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('conditions : un indicateur est obligatoire', () => {
  for (const src of [
    `dcl-s nb int(10) inz(5); if nb; endif;`,
    `dcl-s c char(1) inz('1'); if c; endif;`,
    `dcl-s nb int(10) inz(5); dow nb; endif;`.replace('endif', 'enddo'),
    `dcl-s nb int(10); select; when nb; endsl;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('formes valides inchangées', () => {
  const out = run(`
    dcl-s n packed(7:2) inz(10);
    dcl-s c varchar(20) inz('a');
    dcl-s b ind inz(*on);
    c = c + 'b' + %char(n);
    n = n * 2 - 1;
    if b and n > 5 and c = 'ab10.00' and *in50 = '0' and b = '1';
      dsply c;
    endif;
    if not (n = 0);
      dsply %char(n);
    endif;
  `);
  assert.deepEqual(out, ['ab10.00', '19.00']);
});

test('indicateur dans une concaténation : pas encore supporté', () => {
  assert.throws(() => run(`dsply 'x' + *in50;`), NOT_SUPPORTED);
});

test('affectation : numérique et caractère ne se mélangent pas', () => {
  for (const src of [
    `dcl-s c char(5); dcl-s n int(10) inz(3); c = n;`,
    `dcl-s n int(10); n = '12';`,
    `dcl-s n int(10); dcl-s b ind; n = b;`,
    `dcl-s b ind; b = 1;`,
    `dcl-s b ind; b = 'x';`,
    `dcl-s c char(5) inz(12);`,
    `dcl-ds d; n int(10) inz('a'); end-ds;`,
    `dcl-s n int(10); n += 'a';`,
    `p('a'); dcl-proc p; dcl-pi *n; n int(10) value; end-pi; end-proc;`,
    `dsply %char(f()); dcl-proc f; dcl-pi *n int(10); end-pi; return 'a'; end-proc;`,
    `dcl-s i int(10); for i = 'a' to 3; endfor;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('affectation : formes valides', () => {
  const out = run(`
    dcl-s c char(3);
    dcl-s b ind;
    dcl-s n int(10);
    b = '1';
    c = b;
    dsply c;
    b = *off;
    n = %int('42') + 1;
    dsply %char(n);
  `);
  assert.deepEqual(out, ['1', '43']);
});

test('*ZEROS et *BLANKS selon la cible', () => {
  const out = run(`
    dcl-s code char(5) inz('abc');
    dcl-s n packed(5:2) inz(3);
    code = *zeros;
    dsply '[' + code + ']';
    if code = *zeros;
      dsply 'que des zeros';
    endif;
    code = *blanks;
    if code = *blanks;
      dsply 'vide';
    endif;
    n = *zeros;
    if n = *zero;
      dsply 'zero';
    endif;
  `);
  assert.deepEqual(out, ['[00000]', 'que des zeros', 'vide', 'zero']);
  assert.throws(() => run(`dcl-s n int(10); n = *blanks;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s n int(10); if n = *blanks; endif;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s v varchar(5); v = *zeros;`), NOT_SUPPORTED);
});

test('les données des bouchons et du SQL restent converties', () => {
  const ctx = customersContext();
  const out = run(`
    dcl-s nom char(20);
    dcl-s solde packed(9:2);
    exec sql select name, balance into :nom, :solde from customers where id = 1;
    dsply %trim(nom) + ' ' + %char(solde);
  `, ctx);
  assert.deepEqual(out, ['Dupont 1500.50']);
});

test('constante globale protégée après une procédure', () => {
  assert.throws(() => parse(`dcl-c N 5; dcl-proc p; dcl-s n int(10); n = 1; end-proc; N = 2;`), READ_ONLY);
});

test('un paramètre CONST ne protège que sa procédure', () => {
  assert.doesNotThrow(() => parse(`dcl-s x int(10); dcl-proc p; dcl-pi *n; x int(10) const; end-pi; end-proc; dcl-proc q; x = 1; end-proc;`));
});

test('un paramètre VALUE reçoit une constante', () => {
  const out = run(`
    dcl-c TAUX 20;
    dsply %char(f(TAUX));
    dcl-proc f;
      dcl-pi *n int(10); t int(10) value; end-pi;
      return t + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['21']);
});

test('variable hôte de SELECT INTO constante : refusée', () => {
  assert.throws(() => parse(`dcl-c K 1; exec sql select id into :K from customers where id = 1;`), /est une constante : affectation refusée par le compilateur IBM i/i);
});

test('FOR : la variable de boucle doit être numérique', () => {
  for (const src of [
    `dcl-s i char(3); for i = 1 to 3; endfor;`,
    `dcl-s i ind; for i = 1 to 3; endfor;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
  assert.deepEqual(run(`dcl-s i int(10); dcl-s s int(10); for i = 1 to 3; s += i; endfor; dsply %char(s);`), ['6']);
});

test('INSERT ... SELECT : une constante en entrée est acceptée', () => {
  assert.doesNotThrow(() => parse(`dcl-c K 1; exec sql insert into customers (id, name) select :K, 'x' from customers where id = 1;`));
});

test('%INT et %DEC : texte décimal seulement', () => {
  for (const src of [`dcl-s n int(10); n = %int('1e3');`, `dcl-s n int(10); n = %int('0x1F');`, `dcl-s n packed(5:0); n = %dec('Infinity' : 5 : 0);`]) {
    assert.throws(() => run(src), /RNX0105/, src);
  }
  assert.deepEqual(run(`dsply %char(%int(' -5 '));`), ['-5']);
});

test('SQL : table vide sans colonnes déclarées refusée à l\'INSERT', () => {
  const ctx = { tables: { T: { columns: [], data: [] } }, files: {}, programs: {} };
  assert.throws(() => run(`exec sql insert into t (id) values (1);`, ctx), /Table T vide sans colonnes déclarées.*pas encore support/i);
  const ok = { tables: { T: { columns: [{ name: 'ID', type: 'INT' }], data: [] } }, files: {}, programs: {} };
  assert.ok(runRaw(`exec sql insert into t (id) values (1);`, ok).some(l => /Succès/.test(l)));
});

test('SQL : colonne en double = erreur SQL', () => {
  const out = runRaw(`exec sql insert into customers (id, id) values (9, 9);`, customersContext());
  assert.ok(out.some(l => /SQLCOD=-1/.test(l)));
  const out2 = runRaw(`exec sql update customers set balance = 1, balance = 2;`, customersContext());
  assert.ok(out2.some(l => /SQLCOD=-1/.test(l)));
});

test('SQL : calcul au-delà de 15 chiffres : pas encore supporté', () => {
  assert.throws(() => run(`exec sql update customers set balance = balance * 1000000000000;`, customersContext()), NOT_SUPPORTED);
});

// === Lot final 1 : %INT/%DEC, SQL non supporté, variables hôtes de DS, NULL ===

test('%INT / %DEC : grammaire IBM du texte numérique', () => {
  assert.deepEqual(run(`dsply %char(%int(' + 3 '));`), ['3']);
  assert.deepEqual(run(`dsply %char(%int('5-'));`), ['-5']);
  assert.deepEqual(run(`dsply %char(%int(' -5 '));`), ['-5']);
  assert.deepEqual(run(`dsply %char(%dec('1,5' : 5 : 1));`), ['1.5']);
  assert.deepEqual(run(`dsply %char(%dec('1.5' : 5 : 1));`), ['1.5']);
  assert.deepEqual(run(`dsply %char(%dec('5-' : 5 : 0));`), ['-5']);
  for (const text of ['1e3', '0x1F', 'Infinity', '', '1.2.3', '--5', '5-3', '1,2,3', '+', '.']) {
    assert.throws(() => run(`dcl-s n int(10); n = %int('${text}'); dsply 'x';`), /RNX0105/, text);
  }
});

test('%DEC : tronque aux décimales demandées', () => {
  assert.deepEqual(run(`dsply %char(%dec(3.456 : 7 : 2));`), ['3.45']);
  assert.deepEqual(run(`dsply %char(%dec(-3.456 : 7 : 2));`), ['-3.45']);
  assert.deepEqual(run(`dsply %char(%dec(1.15 : 7 : 1));`), ['1.1']);
  assert.deepEqual(run(`dsply %char(%dec('3.999' : 7 : 0));`), ['3']);
});

test('%INT / %DEC : 15 chiffres significatifs au plus', () => {
  assert.throws(() => run(`dcl-s n packed(20:0); n = %dec('1234567890123456' : 20 : 0);`), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-s n int(20); n = %int('1234567890123456');`), NOT_SUPPORTED);
  assert.deepEqual(run(`dsply %char(%int('123456789012345'));`), ['123456789012345']);
});

test('SQL : CURRENT_xxx et mots réservés refusés (pas de colonne inconnue)', () => {
  for (const expr of ['current_timestamp', 'current_date', 'current_time', 'current_user', 'current_server', 'current date', 'user', 'session_user']) {
    assert.throws(() => run(`exec sql update customers set city = ${expr} where id = 1; dsply 'x';`, customersContext()), NOT_SUPPORTED, expr);
  }
  assert.throws(() => run(`exec sql insert into customers (id, name) values (9, current_user); dsply 'x';`, customersContext()), NOT_SUPPORTED);
});

test('SQL : variables hôtes qualifiées :ds.champ', () => {
  const ctx = customersContext();
  run(`
    dcl-ds d qualified;
      m packed(7:2) inz(10);
      n char(20);
    end-ds;
    exec sql update customers set balance = balance + :d.m where id = 2;
    exec sql select name, balance into :d.n, :d.m from customers where id = 1;
    dsply d.n;
    dsply %char(d.m);
  `, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[1].BALANCE, 240);
  const out = run(`
    dcl-ds d qualified;
      m packed(7:2) inz(10);
      n char(20);
    end-ds;
    exec sql select name, balance into :d.n, :d.m from customers where id = 1;
    dsply d.n;
    dsply %char(d.m);
    exec sql update customers set city = 'X' where balance = :d.m;
    dsply %char(sqlcod);
    exec sql update customers set city = 'Y' where id = :d.m;
    dsply %char(sqlcod);
  `, customersContext());
  assert.deepEqual(out, ['Dupont', '1500.50', '0', '100']);
});

test('SQL : NULL ramené sans indicateur = SQLCOD -305, variable inchangée', () => {
  const ctx = customersContext();
  ctx.tables.CUSTOMERS.data[0].BALANCE = null;
  const out = runRaw(`
    dcl-s b packed(9:2) inz(7);
    exec sql select balance into :b from customers where id = 1;
    dsply %char(sqlcod);
    dsply sqlstt;
    dsply %char(b);
  `, ctx);
  assert.ok(out.some(l => /^\[SQL\] Erreur: SQLCOD=-305/.test(l)), out.join('|'));
  const dsply = out.filter(l => l.startsWith('[DSPLY')).map(l => l.replace(/^\[DSPLY[^\]]*\]+ /, ''));
  assert.deepEqual(dsply, ['-305', '22002', '7.00']);
});

test('SQL : instructions non supportées arrêtent le programme', () => {
  for (const sql of [
    'declare c1 cursor for select id from customers',
    'open c1',
    'fetch c1 into :n',
    'close c1',
    'set option commit = *none',
    'set :n = 1',
    'values 1 into :n',
    'commit',
    'rollback',
    'call proc(1)',
    'with t as (select id from customers) select id from t',
    'merge into customers using x on 1 = 1',
    'select count(*) into :n from customers',
    'select upper(name) into :s from customers',
    'select name as x into :s from customers',
    'select distinct name into :s from customers',
    'select name into :s from customers order by name',
    'select name into :s from customers fetch first 1 row only',
    'select name into :s from customers c where c.id = 1',
    'select name into :s from customers where name like \'D%\'',
    'select name into :s from customers where id in (1, 2)',
    'select name into :s from customers where id between 1 and 2',
    'select name into :s from customers where upper(name) = \'DUPONT\'',
    'update customers set city = \'X\' where id in (1, 2)',
    'delete from customers where name like \'D%\'',
    'delete from customers where id = 1 -- commentaire',
    'insert into customers (id) select 1 from customers',
  ]) {
    const ctx = customersContext();
    assert.throws(() => run(`dcl-s n int(10); dcl-s s char(20); exec sql ${sql}; dsply 'continue';`, ctx), NOT_SUPPORTED, sql);
    assert.equal(ctx.tables.CUSTOMERS.data.length, 3, sql);
  }
});

test('SQL : les vraies erreurs SQL restent des SQLCOD négatifs', () => {
  for (const sql of [
    'select name into :s from inconnue',
    'select inconnu into :s from customers where id = 1',
    'select name into :s from customers where inconnu = 1',
    'insert into customers (id, name) values (1)',
    'insert into customers (id, id) values (1, 2)',
  ]) {
    const out = runRaw(`dcl-s s char(20); exec sql ${sql}; dsply 'continue';`, customersContext());
    assert.ok(out.some(l => /^\[SQL\] Erreur: SQLCOD=-/.test(l)), sql);
    assert.ok(out.some(l => /continue/.test(l)), sql);
  }
});
