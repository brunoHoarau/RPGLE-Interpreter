const test = require('node:test');
const assert = require('node:assert/strict');
const { run, customersContext } = require('./helpers');

// --- CHAR / VARCHAR ---

test('%len d\'un char est sa longueur déclarée', () => {
  assert.deepEqual(run(`dcl-s n char(10) inz('ab'); dsply %char(%len(n));`), ['10']);
});

test('un char non initialisé contient des blancs', () => {
  assert.deepEqual(run(`dcl-s n char(5); dsply %char(%len(n)) + '[' + n + ']';`), ['5[     ]']);
});

test('affecter *BLANK à un char le remplit de blancs', () => {
  assert.deepEqual(run(`dcl-s n char(3) inz('abc'); n = *blank; dsply '[' + n + ']';`), ['[   ]']);
});

test('un char est tronqué à sa longueur', () => {
  assert.deepEqual(run(`dcl-s n char(3); n = 'abcdef'; dsply n;`), ['abc']);
});

test('la concaténation conserve les blancs d\'un char', () => {
  assert.deepEqual(run(`dcl-s c char(4) inz('ab'); dsply '[' + c + ']';`), ['[ab  ]']);
});

test('les comparaisons de char ignorent les blancs de fin', () => {
  const out = run(`
    dcl-s nom char(10) inz('Dupont');
    if nom = 'Dupont';
      dsply 'egal';
    endif;
    if nom < 'Dupontz';
      dsply 'inferieur';
    endif;
  `);
  assert.deepEqual(out, ['egal', 'inferieur']);
});

test('DSPLY n\'affiche pas les blancs de fin', () => {
  assert.deepEqual(run(`dcl-s c char(10) inz('ab'); dsply c;`), ['ab']);
});

test('%len d\'un varchar est sa longueur courante', () => {
  assert.deepEqual(run(`dcl-s v varchar(10) inz('ab'); dsply %char(%len(v));`), ['2']);
});

test('un varchar est tronqué à sa longueur maximale', () => {
  assert.deepEqual(run(`dcl-s v varchar(3); v = 'abcdef'; dsply '[' + v + ']';`), ['[abc]']);
});

// --- INT / UNS ---

test('une division affectée à un int est tronquée', () => {
  const out = run(`
    dcl-s n int(10);
    n = 7 / 2;
    dsply %char(n);
    n = -7 / 2;
    dsply %char(n);
  `);
  assert.deepEqual(out, ['3', '-3']);
});

test('dépassement de capacité d\'un int(5)', () => {
  assert.throws(() => run(`dcl-s n int(5); n = 40000;`), /RNX0103/);
});

test('un dépassement de capacité est intercepté par MONITOR', () => {
  const out = run(`
    dcl-s n int(5);
    monitor;
      n = 40000;
    on-error;
      dsply 'erreur';
    endmon;
  `);
  assert.deepEqual(out, ['erreur']);
});

test('un uns ne peut pas être négatif', () => {
  assert.throws(() => run(`dcl-s n uns(5); n = -1;`), /RNX0103/);
});

// --- PACKED / ZONED ---

test('une affectation packed est tronquée aux décimales déclarées', () => {
  const out = run(`
    dcl-s p packed(7:2);
    p = 1.239;
    dsply %char(p);
    p = -1.239;
    dsply %char(p);
    p = 1.15 * 100;
    dsply %char(p);
  `);
  assert.deepEqual(out, ['1.23', '-1.23', '115.00']);
});

test('%char d\'un packed affiche ses décimales sans zéros de tête', () => {
  const out = run(`
    dcl-s a packed(9:2) inz(1500.5);
    dcl-s b zoned(5:2) inz(0.5);
    dcl-s c packed(5:0) inz(42);
    dsply %char(a);
    dsply %char(b);
    dsply %char(c);
  `);
  assert.deepEqual(out, ['1500.50', '.50', '42']);
});

test('dépassement de capacité d\'un packed(5:2)', () => {
  assert.throws(() => run(`dcl-s p packed(5:2); p = 1000;`), /RNX0103/);
});

test('%char d\'un champ packed de DS', () => {
  const out = run(`
    dcl-ds c qualified;
      solde packed(9:2) inz(1500.5);
    end-ds;
    c.solde = c.solde + 0.255;
    dsply %char(c.solde);
  `);
  assert.deepEqual(out, ['1500.75']);
});

// --- IND ---

test('un indicateur s\'affiche 1 ou 0 et accepte \'1\' / \'0\'', () => {
  const out = run(`
    dcl-s fin ind inz(*on);
    dsply %char(fin);
    fin = '0';
    if not fin;
      dsply 'off';
    endif;
  `);
  assert.deepEqual(out, ['1', 'off']);
});

// --- DS : insensibilité à la casse ---

test('les champs de DS sont insensibles à la casse', () => {
  const out = run(`
    dcl-ds client qualified;
      id int(10) inz(1);
    end-ds;
    CLIENT.Id = CLIENT.ID + 1;
    dsply %char(client.id);
  `);
  assert.deepEqual(out, ['2']);
});

// --- Procédures ---

test('la valeur de retour est convertie au type déclaré', () => {
  const out = run(`
    dsply %char(moitie(7));
    dcl-proc moitie;
      dcl-pi *n int(10);
        n int(10) value;
      end-pi;
      return n / 2;
    end-proc;
  `);
  assert.deepEqual(out, ['3']);
});

test('un paramètre char est complété à sa longueur', () => {
  const out = run(`
    p('ab');
    dcl-proc p;
      dcl-pi *n;
        s char(5) const;
      end-pi;
      dsply %char(%len(s));
    end-proc;
  `);
  assert.deepEqual(out, ['5']);
});

// --- SQL ---

test('SELECT INTO applique le type de la variable hôte', () => {
  const out = run(`
    dcl-s vName char(20);
    dcl-s vBalance packed(9:2);
    exec sql select name, balance into :vName, :vBalance from customers where id = 1;
    dsply %char(%len(vName));
    dsply %char(vBalance);
  `, customersContext());
  assert.deepEqual(out, ['20', '1500.50']);
});

test('INSERT n\'enregistre pas les blancs de fin d\'une variable char', () => {
  const ctx = customersContext();
  run(`
    dcl-s vName char(20) inz('Zed');
    exec sql insert into customers (id, name) values (9, :vName);
  `, ctx);
  assert.equal(ctx.tables.CUSTOMERS.data[3].NAME, 'Zed');
});
