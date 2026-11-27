// CLEAR : valeur par défaut du type (INZ ignoré), tableaux, éléments, DS, indicateurs, refus
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
const CTX = { tables: { CLIENT: { format: 'CLIENTF', keys: ['NUMCLI'], columns: [{ name: 'NUMCLI', type: 'int(10)' }, { name: 'NOM', type: 'char(10)' }], data: [] } } };

test('CLEAR char : blancs, longueur conservée, INZ ignoré', () => {
  assert.deepEqual(run(`
    dcl-s c char(5) inz('abc');
    clear c;
    dsply %len(c);
    dsply %len(%trim(c));
    c = 'xy';
    dsply %trim(c);
  `), ['5', '0', 'xy']);
});

test('CLEAR varchar : chaîne vide', () => {
  assert.deepEqual(run(`
    dcl-s v varchar(10) inz('abc');
    clear v;
    dsply %len(v);
  `), ['0']);
});

test('CLEAR numériques : packed, zoned, int, uns remis à 0, INZ ignoré', () => {
  assert.deepEqual(run(`
    dcl-s p packed(7:2) inz(5.5);
    dcl-s z zoned(5:0) inz(12);
    dcl-s i int(10) inz(-3);
    dcl-s u uns(5) inz(9);
    clear p;
    clear z;
    clear i;
    clear u;
    dsply p + z + i + u;
    dsply p = 0;
    dsply u;
  `), ['0', 'true', '0']);
});

test('CLEAR indicateur : *OFF', () => {
  assert.deepEqual(run(`
    dcl-s b ind inz(*on);
    clear b;
    dsply b;
  `), ['false']);
});

test('CLEAR date, heure, timestamp : valeur par défaut du type, INZ ignoré', () => {
  assert.deepEqual(run(`
    dcl-s d date inz(D'2026-10-04');
    dcl-s t time inz(T'12.30.45');
    dcl-s z timestamp inz(Z'2026-10-04-12.30.45.000000');
    clear d;
    clear t;
    clear z;
    dsply %char(d);
    dsply %char(t);
    dsply %char(z);
  `), ['0001-01-01', '00.00.00', '0001-01-01-00.00.00.000000']);
});

test('CLEAR *INnn : indicateur à *OFF', () => {
  assert.deepEqual(run(`
    *in05 = *on;
    clear *in05;
    dsply *in05;
    *inlr = *on;
  `), ['false']);
});

test('CLEAR tableau entier : tous les éléments', () => {
  assert.deepEqual(run(`
    dcl-s n int(10) dim(3) inz(7);
    dcl-s c char(3) dim(2) inz('abc');
    clear n;
    clear c;
    dsply n(1) + n(2) + n(3);
    dsply %len(%trim(c(1))) + %len(%trim(c(2)));
    dsply %len(c(2));
  `), ['0', '0', '3']);
});

test('CLEAR élément de tableau : cet élément seulement', () => {
  assert.deepEqual(run(`
    dcl-s n int(10) dim(3) inz(7);
    clear n(2);
    dsply n(1);
    dsply n(2);
    dsply n(3);
  `), ['7', '0', '7']);
});

test('CLEAR élément avec un index calculé', () => {
  assert.deepEqual(run(`
    dcl-s n int(10) dim(3) inz(7);
    dcl-s i int(10) inz(2);
    clear n(i + 1);
    dsply n(2);
    dsply n(3);
  `), ['7', '0']);
});

test('CLEAR élément hors bornes : erreur RNX0121 comme une affectation', () => {
  assert.throws(() => run(`dcl-s n int(10) dim(3); clear n(4);`), /RNX0121/);
  assert.throws(() => run(`dcl-s n int(10) dim(3); clear n(0);`), /RNX0121/);
});

test('CLEAR DS : chaque sous-zone à la valeur par défaut de son type (pas des blancs partout)', () => {
  assert.deepEqual(run(`
    dcl-ds d;
      nom char(5) inz('abc');
      qte packed(5:2) inz(3.5);
      cree date inz(D'2026-10-04');
      actif ind inz(*on);
      lib varchar(8) inz('x');
    end-ds;
    clear d;
    dsply %len(%trim(nom));
    dsply qte;
    dsply %char(cree);
    dsply actif;
    dsply %len(lib);
  `), ['0', '0', '0001-01-01', 'false', '0']);
});

test('CLEAR DS qualifiée, puis sous-zone seule d.champ', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified;
      a int(10) inz(4);
      b char(3) inz('abc');
    end-ds;
    clear d.a;
    dsply d.a;
    dsply d.b;
    clear d;
    dsply %len(%trim(d.b));
  `), ['0', 'abc', '0']);
});

test('CLEAR sous-zone d une DS non qualifiée par son nom seul', () => {
  assert.deepEqual(run(`
    dcl-ds d;
      a int(10) inz(4);
      b int(10) inz(5);
    end-ds;
    clear a;
    dsply a;
    dsply b;
  `), ['0', '5']);
});

test('CLEAR DS LIKEDS : sous-zones à la valeur par défaut de leur type, INZ(*LIKEDS) ignoré', () => {
  assert.deepEqual(run(`
    dcl-ds base qualified;
      q packed(5:2) inz(9.5);
      d date inz(D'2026-10-04');
    end-ds;
    dcl-ds copie likeds(base) inz(*likeds);
    dsply copie.q;
    clear copie;
    dsply copie.q;
    dsply %char(copie.d);
  `), ['9.5', '0', '0001-01-01']);
});

test('CLEAR d(i) sur une DS tableau : cet élément seulement', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      a int(10) inz(4);
      b char(3) inz('abc');
    end-ds;
    clear d(2);
    dsply d(1).a;
    dsply d(2).a;
    dsply %len(%trim(d(2).b));
    dsply d(3).b;
  `), ['4', '0', '0', 'abc']);
});

test('CLEAR DS tableau entière : tous les éléments', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(2);
      a int(10) inz(4);
    end-ds;
    clear d;
    dsply d(1).a + d(2).a;
  `), ['0']);
});

test('CLEAR d(i).champ : cette sous-zone de cet élément seulement', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(2);
      a int(10) inz(4);
      b int(10) inz(5);
    end-ds;
    clear d(2).a;
    dsply d(2).a;
    dsply d(2).b;
    dsply d(1).a;
  `), ['0', '5', '4']);
});

test('CLEAR dans une procédure : variable locale et globale', () => {
  assert.deepEqual(run(`
    dcl-s g int(10) inz(8);
    raz();
    dsply g;
    dcl-proc raz;
      dcl-s l int(10) inz(3);
      clear l;
      clear g;
      dsply l;
    end-proc;
  `), ['0', '0']);
});

test('clear reste utilisable comme nom de variable', () => {
  assert.deepEqual(run(`
    dcl-s clear int(10);
    clear = 5;
    dsply clear;
    clear clear;
    dsply clear;
  `), ['5', '0']);
});

test('CLEAR *NOKEY et *ALL sont refusés', () => {
  assert.throws(() => parse(`dcl-f client; clear *nokey clientf;`), err => NOT_SUPPORTED.test(err.message) && /\*NOKEY/.test(err.message));
  assert.throws(() => parse(`dcl-f client; clear *all clientf;`), err => NOT_SUPPORTED.test(err.message) && /\*ALL/.test(err.message));
});

test('CLEAR d un nom de fichier ou de format est refusé', () => {
  assert.throws(() => parse(`dcl-f client; clear client;`), err => NOT_SUPPORTED.test(err.message) && /fichier/.test(err.message));
  assert.throws(() => run(`dcl-f client; clear clientf;`, CTX), err => NOT_SUPPORTED.test(err.message) && /format/.test(err.message));
});

test('CLEAR d une cible non déclarée est une erreur', () => {
  assert.throws(() => run(`clear inconnu;`), /non déclarée.*inconnu/i);
});

test('CLEAR d une constante est refusé', () => {
  assert.throws(() => parse(`dcl-c k 5; clear k;`), /k est/i);
});

test('CLEAR sans opérande ou avec un opérande invalide est une erreur', () => {
  assert.throws(() => parse(`dcl-s a char(1); clear;`));
  assert.throws(() => parse(`dcl-s a char(1); clear 'x';`));
  assert.throws(() => parse(`dcl-s a char(1); clear *on;`));
});
