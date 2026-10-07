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

// === Lot final 2 ===

test('paramètre par référence : littéral et expression refusés', () => {
  for (const arg of [`5`, `a + 1`, `%trim(c)`, `'x'`, `*zeros`, `f()`]) {
    const src = `dcl-s a packed(5:0) inz(1); dcl-s c char(5) inz('x');
      q(${arg});
      dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;
      dcl-proc f; dcl-pi *n packed(5:0); end-pi; return 1; end-proc;`;
    assert.throws(() => run(src), INCOMPATIBLE, arg);
  }
});

test('paramètre par référence : prototype de programme, procédure externe et bouchon', () => {
  const ctx = { tables: {}, files: {}, programs: { PGM: { calls: [{ set: { p: 3 } }] } } };
  for (const kind of [`extpgm('PGM')`, `extproc('PGM')`]) {
    const src = `dcl-pr x ${kind}; p packed(5:0); end-pr; x(5);`;
    assert.throws(() => run(src, ctx), INCOMPATIBLE, kind);
  }
});

test('paramètre par référence : paramètre CONST de la procédure courante refusé', () => {
  const src = `
    dcl-s a packed(5:0);
    outer(a);
    dcl-proc outer; dcl-pi *n; k packed(5:0) const; end-pi; q(k); end-proc;
    dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`;
  assert.throws(() => run(src), INCOMPATIBLE);
  // un paramètre CONST passé à un paramètre CONST ou VALUE reste valide
  const out = run(`
    outer(4);
    dcl-proc outer; dcl-pi *n; k packed(5:0) const; end-pi; r(k); s(k + 1); end-proc;
    dcl-proc r; dcl-pi *n; p packed(5:0) const; end-pi; dsply %char(p); end-proc;
    dcl-proc s; dcl-pi *n; p packed(5:0) value; end-pi; dsply %char(p); end-proc;`);
  assert.deepEqual(out, ['4', '5']);
});

test('paramètre par référence : le type déclaré doit être identique', () => {
  for (const src of [
    `dcl-s a int(10); q(a); dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`,
    `dcl-s a char(5); q(a); dcl-proc q; dcl-pi *n; p char(10); end-pi; end-proc;`,
    `dcl-s a packed(5:2); q(a); dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`,
    `dcl-ds d qualified; x int(10); end-ds; q(d.x); dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`,
    `dcl-ds d; x int(10); end-ds; q(x); dcl-proc q; dcl-pi *n; p packed(5:0); end-pi; end-proc;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('paramètre par référence : variable de même type, valeur renvoyée à l\'appelant', () => {
  const out = run(`
    dcl-s a char(10) inz('x');
    dcl-s n int(10) inz(1);
    dcl-ds d qualified; x packed(5:0) inz(7); end-ds;
    dcl-s ind1 ind;
    dcl-s v int;
    q(a); r(n); t(d.x); u(ind1); w(v);
    dsply %trim(a) + ' ' + %char(n) + ' ' + %char(d.x) + ' ' + %char(ind1) + ' ' + %char(v);
    dcl-proc q; dcl-pi *n; p char(10); end-pi; p = 'mod'; end-proc;
    dcl-proc r; dcl-pi *n; p int(10); end-pi; p = p + 1; end-proc;
    dcl-proc t; dcl-pi *n; p packed(5:0); end-pi; p = p + 1; end-proc;
    dcl-proc u; dcl-pi *n; p ind; end-pi; p = *on; end-proc;
    dcl-proc w; dcl-pi *n; p int(10); end-pi; p = 9; end-proc;
  `);
  assert.deepEqual(out, ['mod 2 8 1 9']);
});

test('CONST et VALUE acceptent littéraux et expressions', () => {
  const out = run(`
    dcl-s a packed(5:0) inz(1);
    k(5); k(a + 1); l(a + 2); l(7); m('abc'); m(%trim('  x '));
    dcl-proc k; dcl-pi *n; p packed(5:0) const; end-pi; dsply %char(p); end-proc;
    dcl-proc l; dcl-pi *n; p int(10) value; end-pi; dsply %char(p); end-proc;
    dcl-proc m; dcl-pi *n; p char(10) const; end-pi; dsply %trim(p); end-proc;
  `);
  assert.deepEqual(out, ['5', '2', '3', '7', 'abc', 'x']);
});

const DS_DECL = `dcl-ds d qualified; x char(3) inz('abc'); end-ds; dcl-ds e qualified; x char(3); end-ds; dcl-s s char(3);`;

test('structure de données utilisée comme valeur : pas encore supporté', () => {
  for (const stmt of [
    `d = 'abc';`, `d = *blanks;`, `s = d;`, `if d = *blanks; endif;`, `s = d + 'x';`,
    `dsply d;`, `dsply 'x' + d;`, `p(d);`, `s = %trim(d);`,
  ]) {
    assert.throws(() => run(`${DS_DECL} ${stmt} dcl-proc p; dcl-pi *n; k char(3) const; end-pi; end-proc;`), NOT_SUPPORTED, stmt);
  }
  assert.throws(() => run(`dcl-ds d qualified; x char(3); end-ds; dsply 'q' '' d;`), NOT_SUPPORTED);
});

test('structure de données : les champs restent utilisables', () => {
  const out = run(`${DS_DECL} e.x = d.x; dsply e.x; dcl-ds u; ch char(2) inz('ab'); end-ds; dsply ch; ch = 'zz'; dsply u.ch;`);
  assert.deepEqual(out, ['abc', 'ab', 'zz']);
});

test('réponse de DSPLY : seulement dans une variable caractère', () => {
  for (const decl of [`dcl-s r int(10);`, `dcl-s r packed(5:0);`, `dcl-s r ind;`, `dcl-s r date;`]) {
    assert.throws(() => run(`${decl} dsply 'Q' '' r;`), /réponse de DSPLY dans une variable de type .*pas encore support/i, decl);
  }
  assert.deepEqual(run(`dcl-s r varchar(5); dsply 'Q' '' r; dsply r;`), ['Q', 'Y']);
});

test('indicateur recevant un caractère', () => {
  assert.deepEqual(run(`dcl-s c char(1) inz('1'); dcl-s b ind; b = c; dsply %char(b); c = '0'; b = c; dsply %char(b);`), ['1', '0']);
  assert.throws(() => run(`dcl-s c char(1) inz('x'); dcl-s b ind; b = c;`), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-s b ind; b = 'x';`), INCOMPATIBLE);
});

test('messages : valeur nulle et structure de données', () => {
  const { describeValue } = require('../out/datatypes');
  assert.equal(describeValue(null), 'valeur nulle');
  assert.equal(describeValue(undefined), 'valeur nulle');
  assert.equal(describeValue({ a: 1 }), 'structure de données');
  assert.equal(describeValue('ab'), "caractère 'ab'");
});

test('SELECT INTO : plusieurs lignes = SQLCOD -811, variables inchangées', () => {
  const out = runRaw(`
    dcl-s s char(20) inz('avant');
    exec sql select name into :s from customers;
    dsply %char(sqlcod);
    dsply sqlstt;
    dsply s;
  `, customersContext());
  assert.ok(out.some(l => /^\[SQL\] Erreur: SQLCOD=-811/.test(l)), out.join('|'));
  const dsply = out.filter(l => l.startsWith('[DSPLY')).map(l => l.replace(/^\[DSPLY[^\]]*\]+ /, ''));
  assert.deepEqual(dsply, ['-811', '21000', 'avant']);
});

test('SELECT INTO : nombre de colonnes différent du nombre de variables', () => {
  for (const sql of [
    'select name, city into :s from customers where id = 1',
    'select name into :s, :t from customers where id = 1',
  ]) {
    const out = runRaw(`dcl-s s char(20) inz('avant'); dcl-s t char(20) inz('avant'); exec sql ${sql}; dsply s; dsply t;`, customersContext());
    assert.ok(out.some(l => /^\[SQL\] Erreur: SQLCOD=-\d+/.test(l)), sql + out.join('|'));
    assert.ok(!out.some(l => /Dupont|Paris/.test(l)), sql);
  }
});

// === Lot 3 ===

function datedContext() {
  return {
    tables: {
      ACCOUNTS: {
        columns: [{ name: 'ID', type: 'integer' }, { name: 'DATE', type: 'char' }, { name: 'CURRENT_BALANCE', type: 'decimal' }, { name: 'USER', type: 'char' }],
        data: [
          { ID: 1, DATE: '2026-01-01', CURRENT_BALANCE: 10, USER: 'ann' },
          { ID: 2, DATE: '2026-02-02', CURRENT_BALANCE: -3, USER: 'bob' },
        ],
      },
    },
    files: {},
    programs: {},
  };
}

test('SQL : colonnes nommées DATE, USER ou CURRENT_xxx traitées comme des colonnes', () => {
  const ctx = datedContext();
  const out = run(`
    dcl-s d char(10) inz('2026-02-02');
    dcl-s n int(10);
    exec sql update accounts set current_balance = current_balance + 1 where date = :d;
    exec sql update accounts set user = date where id = 1;
    exec sql select id into :n from accounts where user = '2026-01-01';
    dsply %char(n);
  `, ctx);
  assert.equal(ctx.tables.ACCOUNTS.data[1].CURRENT_BALANCE, -2);
  assert.equal(ctx.tables.ACCOUNTS.data[0].USER, '2026-01-01');
  assert.deepEqual(out, ['1']);
});

test('SQL : colonne DATE dans SELECT et registres spéciaux toujours refusés', () => {
  const ctx = datedContext();
  const out = run(`
    dcl-s d char(10);
    exec sql select date into :d from accounts where id = 2;
    dsply d;
  `, ctx);
  assert.deepEqual(out, ['2026-02-02']);
  assert.throws(() => run(`exec sql update accounts set user = current_timestamp where id = 1;`, datedContext()), NOT_SUPPORTED);
  assert.throws(() => run(`exec sql update accounts set user = current user where id = 1;`, datedContext()), NOT_SUPPORTED);
  assert.throws(() => run(`exec sql update accounts set current_balance = current_balance(1) where id = 1;`, datedContext()), NOT_SUPPORTED);
  assert.throws(() => run(`exec sql delete from accounts where current_date = '2026-01-01';`, datedContext()), NOT_SUPPORTED);
  assert.throws(() => run(`exec sql delete from accounts where date(date) = '2026-01-01';`, datedContext()), NOT_SUPPORTED);
});

test('SELECT INTO : une colonne inconnue n\'affecte aucune variable', () => {
  const ctx = customersContext();
  const out = runRaw(`
    dcl-s a char(10) inz('avant');
    dcl-s b char(10) inz('avant');
    exec sql select name, nope into :a, :b from customers where id = 1;
    dsply %trim(a) + '/' + %trim(b);
  `, ctx).filter(l => /DSPLY/.test(l));
  assert.match(out[0], /avant\/avant/);
});

test('SELECT INTO : une valeur NULL sans indicateur n\'affecte aucune variable (SQLCOD -305)', () => {
  const ctx = customersContext();
  ctx.tables.CUSTOMERS.data[0].CITY = null;
  const out = run(`
    dcl-s a char(10) inz('avant');
    dcl-s b char(10) inz('avant');
    exec sql select name, city into :a, :b from customers where id = 1;
    dsply %trim(a) + '/' + %trim(b);
    dsply %char(sqlcod) + sqlstt;
  `, ctx);
  assert.deepEqual(out, ['avant/avant', '-30522002']);
});

test('SELECT INTO : une DS entière comme cible est refusée', () => {
  assert.throws(() => run(`
    dcl-ds cli qualified;
      id int(10);
      name char(20);
    end-ds;
    exec sql select id, name into :cli from customers where id = 1;
  `, customersContext()), NOT_SUPPORTED);
});

test('WHERE : littéral numérique négatif et where( sans espace', () => {
  const ctx = customersContext();
  ctx.tables.CUSTOMERS.data[1].BALANCE = -3;
  const out = run(`
    dcl-s n int(10);
    exec sql select id into :n from customers where balance < -5 or balance = -3;
    dsply %char(n);
    exec sql select id into :n from customers where(id = 1);
    dsply %char(n);
    exec sql update customers set balance = 0 where balance > -1.5 and balance < 0.5 and id = 99;
    dsply %char(sqlcod);
  `, ctx);
  assert.deepEqual(out, ['2', '1', '100']);
});

test('%DEC : partie entière trop grande refusée, troncature sans -0', () => {
  assert.throws(() => run(`dsply %char(%dec(12345 : 4 : 0));`), NOT_SUPPORTED);
  assert.throws(() => run(`dsply %char(%dec(123.4 : 5 : 3));`), NOT_SUPPORTED);
  assert.deepEqual(run(`dsply %char(%dec(1234 : 4 : 0)); dsply %char(%dec(-12.34 : 4 : 2));`), ['1234', '-12.34']);
  const out = run(`
    dcl-s z packed(5:0);
    z = %dec(-0.4 : 5 : 0);
    dsply %char(%dec(-0.4 : 5 : 0));
    if %dec(-0.4 : 5 : 0) = 0;
      dsply 'zero';
    endif;
  `);
  assert.deepEqual(out, ['0', 'zero']);
});

test('programme principal : un paramètre CONST ne peut pas être passé par référence', () => {
  const callee = `
    dcl-pi *n;
      p char(5) const;
    end-pi;
    modifie(p);
    dcl-proc modifie;
      dcl-pi *n;
        x char(5);
      end-pi;
      x = 'zzzzz';
    end-proc;
  `;
  assert.throws(() => run(`
    dcl-pr appele extpgm('X');
      p char(5) const;
    end-pr;
    appele('abc');
  `, undefined, { resolveProgram: name => (name === 'X' ? { source: callee } : undefined) }), INCOMPATIBLE);
});
