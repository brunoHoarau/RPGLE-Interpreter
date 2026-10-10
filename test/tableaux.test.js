const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;

// --- Tableaux simples : DIM(n) ---

test('DIM(n) : éléments à la valeur par défaut, puis lecture et écriture', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s c char(3) dim(2);
    t(2) = 7;
    dsply t(1);
    dsply t(2);
    dsply t(3);
    c(1) = 'ab';
    dsply c(1);
    dsply %trim(c(2)) + '|';
    *inlr = *on;
  `), ['0', '7', '0', 'ab', '|']);
});

test('DIM(n) INZ(x) : la valeur initiale s\'applique à chaque élément', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3) inz(5);
    dsply t(1);
    dsply t(3);
    *inlr = *on;
  `), ['5', '5']);
});

test('élément : coercition vers le type de l\'élément', () => {
  assert.deepEqual(run(`
    dcl-s t packed(5:2) dim(2);
    dcl-s s char(3) dim(2);
    t(1) = 1.239;
    s(1) = 'abcdef';
    dsply t(1);
    dsply s(1);
    *inlr = *on;
  `), ['1.23', 'abc']);
});

test('l\'index est une expression numérique', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(5);
    dcl-s i int(10);
    for i = 1 to 5;
      t(i) = i * 10;
    endfor;
    dsply t(2 + 1);
    dsply t(%elem(t));
    t(i - 5) = t(1) + t(2);
    dsply t(0 + 1);
    *inlr = *on;
  `), ['30', '50', '30']);
});

test('affectation composée sur un élément', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(2) inz(1);
    t(2) += 4;
    dsply t(2);
    *inlr = *on;
  `), ['5']);
});

test('DIM via une constante nommée', () => {
  assert.deepEqual(run(`
    dcl-c MAX 4;
    dcl-s t int(10) dim(MAX);
    dsply %elem(t);
    *inlr = *on;
  `), ['4']);
});

test('tableau de dates', () => {
  assert.deepEqual(run(`
    dcl-s d date dim(2) inz(d'2024-01-15');
    d(2) = d(1) + %days(10);
    dsply %char(d(2) : *iso);
    *inlr = *on;
  `), ['2024-01-25']);
});

// --- Bornes ---

test('index hors bornes : 00121, interceptable par MONITOR', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s x int(10);
    monitor;
      x = t(4);
    on-error 00121;
      dsply 'lecture ' + %char(%status);
    endmon;
    monitor;
      t(0) = 1;
    on-error 00121;
      dsply 'zero';
    endmon;
    monitor;
      t(-1) = 1;
    on-error *program;
      dsply 'neg ' + %char(%status);
    endmon;
    *inlr = *on;
  `), ['lecture 121', 'zero', 'neg 121']);
});

test('index non entier : refusé', () => {
  assert.throws(() => run(`
    dcl-s t int(10) dim(3);
    dcl-s x int(10);
    x = t(1.5);
  `), NOT_SUPPORTED);
});

test('index non numérique : types incompatibles', () => {
  assert.throws(() => run(`
    dcl-s t int(10) dim(3);
    dcl-s x int(10);
    x = t('a');
  `), /types incompatibles/);
});

// --- DIM(*AUTO : n) ---

test('*AUTO : commence à 0 élément, %ELEM suit l\'écriture', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(*auto : 10);
    dsply %elem(t);
    t(1) = 4;
    dsply %elem(t);
    t(3) = 9;
    dsply %elem(t);
    dsply t(2);
    dsply t(3);
    *inlr = *on;
  `), ['0', '1', '3', '0', '9']);
});

test('*AUTO : éléments intermédiaires à la valeur INZ', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(*auto : 10) inz(7);
    t(3) = 1;
    dsply t(1);
    dsply t(2);
    *inlr = *on;
  `), ['7', '7']);
});

test('*AUTO : lecture au-delà du nombre courant : 00121', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(*auto : 10);
    dcl-s x int(10);
    t(1) = 1;
    monitor;
      x = t(2);
    on-error 00121;
      dsply 'lecture';
    endmon;
    monitor;
      t(11) = 1;
    on-error 00121;
      dsply 'ecriture';
    endmon;
    *inlr = *on;
  `), ['lecture', 'ecriture']);
});

test('*AUTO : arr(*next) ajoute un élément, au-delà de DIM : 00121', () => {
  assert.deepEqual(run(`
    dcl-s t char(2) dim(*auto : 2);
    t(*next) = 'a';
    t(*next) = 'b';
    dsply %elem(t);
    dsply t(2);
    monitor;
      t(*next) = 'c';
    on-error 00121;
      dsply 'plein';
    endmon;
    *inlr = *on;
  `), ['2', 'b', 'plein']);
});

test('*next sur un tableau fixe ou en lecture : erreur de compilation', () => {
  assert.throws(() => parse(`dcl-s t int(10) dim(3); t(*next) = 1;`), /\*NEXT/i);
  assert.throws(() => parse(`dcl-s t int(10) dim(*auto : 3); dcl-s x int(10); x = t(*next);`), /\*NEXT/i);
});

// --- %ELEM ---

test('%ELEM : DIM pour un tableau fixe', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(12);
    dsply %elem(t);
    *inlr = *on;
  `), ['12']);
});

test('%ELEM : argument non tableau ou affectation refusés', () => {
  assert.throws(() => parse(`dcl-s x int(10); dcl-s y int(10); y = %elem(x);`), /%ELEM/i);
  assert.throws(() => parse(`dcl-s t int(10) dim(3); %elem(t) = 2;`), err => NOT_SUPPORTED.test(err.message) && /L'affectation de %ELEM/i.test(err.message));
});

// --- Portées et paramètres ---

test('tableau local à une procédure, masquant un tableau global', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(2) inz(1);
    dcl-proc p;
      dcl-s t int(10) dim(3) inz(9);
      dsply %elem(t);
      dsply t(3);
    end-proc;
    p();
    dsply %elem(t);
    dsply t(2);
    *inlr = *on;
  `), ['3', '9', '2', '1']);
});

test('un tableau global est visible dans une procédure', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(2);
    dcl-proc p;
      t(2) = 8;
    end-proc;
    p();
    dsply t(2);
    *inlr = *on;
  `), ['8']);
});

test('élément passé en CONST et en VALUE', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(2) inz(3);
    dcl-proc a;
      dcl-pi *n int(10);
        v int(10) const;
      end-pi;
      return v + 1;
    end-proc;
    dcl-proc b;
      dcl-pi *n int(10);
        v int(10) value;
      end-pi;
      return v * 2;
    end-proc;
    dsply a(t(1));
    dsply b(t(2));
    *inlr = *on;
  `), ['4', '6']);
});

test('élément passé par référence : refusé', () => {
  assert.throws(() => run(`
    dcl-s t int(10) dim(2);
    dcl-proc a;
      dcl-pi *n;
        v int(10);
      end-pi;
      v = 1;
    end-proc;
    a(t(1));
  `), NOT_SUPPORTED);
});

// --- Refus explicites ---

test('refus : DIM(*VAR), CTDATA, ASCEND, DESCEND, FROMFILE, PERRCD, ALT', () => {
  for (const src of [
    'dcl-s t int(10) dim(*var : 5);',
    'dcl-s t char(5) dim(3) ctdata;',
    'dcl-s t char(5) dim(3) ascend;',
    'dcl-s t char(5) dim(3) descend;',
    'dcl-s t char(5) dim(3) fromfile(f);',
    'dcl-s t char(5) dim(3) perrcd(2);',
    'dcl-s t char(5) dim(3) alt(u);',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('refus : DIM sur sous-zone de DS, sur paramètre, sur prototype', () => {
  for (const src of [
    'dcl-ds d qualified; a int(10) dim(3); end-ds;',
    'dcl-proc p; dcl-pi *n; v int(10) dim(3); end-pi; end-proc;',
    'dcl-pr q; v int(10) dim(3); end-pr;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('DIM : valeur invalide', () => {
  for (const src of [
    'dcl-s t int(10) dim(0);',
    'dcl-s t int(10) dim(16773105);',
    'dcl-s t int(10) dim(2.5);',
    'dcl-s t int(10) dim(inconnue);',
    'dcl-s t int(10) dim(*auto);',
  ]) {
    assert.throws(() => parse(src), undefined, src);
  }
});

test('refus : LIKE d\'un tableau', () => {
  assert.throws(() => parse(`dcl-s t int(10) dim(3); dcl-s u like(t);`), NOT_SUPPORTED);
});

test('refus : tableau entier (valeur, affectation, DSPLY, appel, SQL, arr(*))', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10);';
  for (const body of [
    'x = t;',
    't = 1;',
    't = x;',
    'dsply t;',
    'x = t(*);',
    't(*) = 1;',
    'x = %len(t);',
  ]) {
    assert.throws(() => parse(`${decl} ${body}`), NOT_SUPPORTED, body);
  }
  assert.throws(() => run(`${decl} exec sql set :x = :t;`), NOT_SUPPORTED);
});

test('affectation composée : index avec appel de procédure refusé, index sans appel accepté', () => {
  const decl = `dcl-s t int(10) dim(3) inz(1); dcl-s i int(10) inz(1);
    dcl-proc f; dcl-pi *n int(10); end-pi; return 2; end-proc;`;
  assert.throws(() => parse(`${decl} t(f()) += 1;`), err => NOT_SUPPORTED.test(err.message) && /évalué deux fois|appel/i.test(err.message));
  assert.deepEqual(run(`dcl-s t int(10) dim(3) inz(1); dcl-s i int(10) inz(2);
    t(i + 1) += 5;
    dsply t(3);
    *inlr = *on;`), ['6']);
});

// --- Tableaux de DS (T4) ---

const CTX = { tables: { CLIENT: { format: 'CLIENTF', keys: ['NUMCLI'], columns: [{ name: 'NUMCLI', type: 'int(10)' }, { name: 'NOM', type: 'char(10)' }], data: [] } } };

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

// --- %LOOKUP et SORTA ---

test('%LOOKUP : index du premier élément égal, 0 si absent', () => {
  assert.deepEqual(run(`
    dcl-s t char(5) dim(3);
    dcl-s n int(10) dim(3);
    t(1) = 'a';
    t(2) = 'b';
    t(3) = 'b';
    n(1) = 10;
    n(2) = 20;
    n(3) = 20;
    dsply %char(%lookup('b' : t));
    dsply %char(%lookup('z' : t));
    dsply %char(%lookup(20 : n));
    dsply %char(%lookup(20 : n : 3));
    dsply %char(%lookup(20 : n : 1 : 1));
    *inlr = *on;
  `), ['2', '0', '2', '3', '0']);
});

test('%LOOKUP : *AUTO ne cherche que les éléments courants, comparaison avec complétion à blanc', () => {
  assert.deepEqual(run(`
    dcl-s t varchar(5) dim(*auto : 5);
    dcl-s c char(5) dim(2);
    dcl-s x int(10);
    dsply %char(%lookup('a' : t));
    t(*next) = 'a';
    t(*next) = 'b';
    dsply %char(%lookup('b' : t));
    dsply %char(%lookup('c' : t));
    c(1) = 'xy';
    dsply %char(%lookup('xy   ' : c));
    *inlr = *on;
  `), ['0', '2', '0', '1']);
});

test('%LOOKUP sur d(*).champ', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      code char(2);
      qte int(10);
    end-ds;
    d(1).code = 'A1';
    d(2).code = 'B2';
    d(3).code = 'C3';
    d(3).qte = 9;
    dsply %char(%lookup('C3' : d(*).code));
    dsply %char(%lookup(9 : d(*).qte));
    dsply %char(%lookup('B2' : d(*).code : 3));
    *inlr = *on;
  `), ['3', '3', '0']);
});

test('%LOOKUP : début hors bornes ou nombre trop grand : 00121 ; %FOUND inchangé', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s a int(10) dim(*auto : 3);
    monitor;
      dsply %char(%lookup(1 : t : 0));
    on-error 00121;
      dsply 'debut 0';
    endmon;
    monitor;
      dsply %char(%lookup(1 : t : 4));
    on-error 00121;
      dsply 'debut 4';
    endmon;
    monitor;
      dsply %char(%lookup(1 : t : 2 : 3));
    on-error 00121;
      dsply 'nombre';
    endmon;
    dsply %char(%lookup(1 : a));
    dsply %char(%lookup(1 : a : 5));
    *inlr = *on;
  `), ['debut 0', 'debut 4', 'nombre', '0', '0']);
});

test('%LOOKUP : types incompatibles', () => {
  assert.throws(() => run(`dcl-s t int(10) dim(2); dsply %char(%lookup('a' : t));`), /incompatibles/);
  assert.throws(() => run(`dcl-s t char(2) dim(2); dsply %char(%lookup(1 : t));`), /incompatibles/);
});

test('%LOOKUP : refus et erreurs de compilation', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10); dcl-ds d qualified dim(2); a int(10); end-ds;';
  assert.throws(() => parse(`${decl} x = %lookuplt(1 : t);`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %lookupge(1 : t);`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %lookup(1 : x);`), err => !NOT_SUPPORTED.test(err.message) && /tableau/i.test(err.message));
  assert.throws(() => parse(`${decl} x = %lookup(1 : t(*));`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %lookup(1 : %subarr(t : 1 : 2));`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} x = %lookup(1 : d);`), /d/i);
  assert.throws(() => parse(`${decl} x = %lookup(1);`), /LOOKUP/i);
});

test('SORTA : tri croissant, décroissant, nombres', () => {
  assert.deepEqual(run(`
    dcl-s n int(10) dim(4);
    dcl-s i int(10);
    n(1) = 30;
    n(2) = 10;
    n(3) = 40;
    n(4) = 20;
    sorta n;
    for i = 1 to 4;
      dsply %char(n(i));
    endfor;
    sorta(d) n;
    dsply %char(n(1));
    sorta(a) n;
    dsply %char(n(1));
    *inlr = *on;
  `), ['10', '20', '30', '40', '40', '10']);
});

test('SORTA : ordre EBCDIC (minuscules, majuscules, puis chiffres)', () => {
  assert.deepEqual(run(`
    dcl-s t char(3) dim(5);
    dcl-s i int(10);
    t(1) = '1';
    t(2) = 'ABC';
    t(3) = 'Z';
    t(4) = 'abc';
    t(5) = 'B';
    sorta t;
    for i = 1 to 5;
      dsply %trim(t(i));
    endfor;
    *inlr = *on;
  `), ['abc', 'ABC', 'B', 'Z', '1']);
});

test('SORTA : *AUTO sur les éléments courants ; tableau fixe : tous les éléments', () => {
  assert.deepEqual(run(`
    dcl-s a int(10) dim(*auto : 4);
    dcl-s f int(10) dim(3);
    a(*next) = 5;
    a(*next) = 2;
    sorta a;
    dsply %char(%elem(a));
    dsply %char(a(1));
    f(1) = 5;
    f(2) = -1;
    sorta f;
    dsply %char(f(1));
    dsply %char(f(2));
    dsply %char(f(3));
    sorta(d) f;
    dsply %char(f(1));
    *inlr = *on;
  `), ['2', '2', '-1', '0', '5', '5']);
});

test('SORTA d(*).champ déplace les structures entières', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      code char(2);
      qte int(10);
    end-ds;
    d(1).code = 'C';
    d(1).qte = 3;
    d(2).code = 'A';
    d(2).qte = 1;
    d(3).code = 'B';
    d(3).qte = 2;
    sorta d(*).code;
    dsply %trim(d(1).code) + %char(d(1).qte);
    dsply %trim(d(3).code) + %char(d(3).qte);
    sorta(d) d(*).qte;
    dsply %trim(d(1).code) + %char(d(1).qte);
    *inlr = *on;
  `), ['A1', 'C3', 'C3']);
});

test('SORTA : refus et erreurs de compilation', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10); dcl-ds d qualified dim(2); a int(10); end-ds;';
  assert.throws(() => parse(`${decl} sorta %subarr(t : 1 : 2);`), NOT_SUPPORTED);
  assert.throws(() => parse(`${decl} sorta(e) t;`), /SORTA/i);
  assert.throws(() => parse(`${decl} sorta x;`), err => !NOT_SUPPORTED.test(err.message) && /tableau/i.test(err.message));
  assert.throws(() => parse(`${decl} sorta d;`), /d/i);
  assert.throws(() => parse(`${decl} sorta t(*);`), NOT_SUPPORTED);
});

// --- FOR-EACH ---

test('FOR-EACH : parcourt les éléments d\'un tableau simple', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s x int(10);
    dcl-s total int(10);
    t(1) = 4;
    t(2) = 5;
    t(3) = 6;
    for-each x in t;
      total += x;
      dsply %char(x);
    endfor;
    dsply %char(total);
    *inlr = *on;
  `), ['4', '5', '6', '15']);
});

test('FOR-EACH : tableau fixe = tous les DIM éléments, *AUTO = éléments courants', () => {
  assert.deepEqual(run(`
    dcl-s f int(10) dim(3) inz(1);
    dcl-s a char(2) dim(*auto : 5);
    dcl-s x int(10);
    dcl-s c char(2);
    dcl-s n int(10);
    for-each x in f;
      n += 1;
    endfor;
    dsply %char(n);
    for-each c in a;
      dsply 'jamais';
    endfor;
    a(*next) = 'p';
    a(*next) = 'q';
    for-each c in a;
      dsply %trim(c);
    endfor;
    *inlr = *on;
  `), ['3', 'p', 'q']);
});

test('FOR-EACH : l\'élément est copié, coercition vers le type de l\'item, item garde le dernier élément', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(3);
    dcl-s p packed(5:1);
    dcl-s big int(20);
    t(1) = 7;
    t(2) = 8;
    t(3) = 9;
    for-each p in t;
      p += 1;
    endfor;
    dsply %char(p);
    dsply %char(t(3));
    *inlr = *on;
  `), ['10.0', '9']);
});

test('FOR-EACH : le nombre d\'éléments est évalué au départ', () => {
  assert.deepEqual(run(`
    dcl-s a int(10) dim(*auto : 10);
    dcl-s x int(10);
    dcl-s n int(10);
    a(*next) = 1;
    a(*next) = 2;
    for-each x in a;
      n += 1;
      if n < 5;
        a(*next) = 9;
      endif;
    endfor;
    dsply %char(n);
    dsply %char(%elem(a));
    *inlr = *on;
  `), ['2', '4']);
});

test('FOR-EACH : LEAVE et ITER', () => {
  assert.deepEqual(run(`
    dcl-s t int(10) dim(5);
    dcl-s x int(10);
    t(1) = 1;
    t(2) = 2;
    t(3) = 3;
    t(4) = 4;
    t(5) = 5;
    for-each x in t;
      if x = 2;
        iter;
      endif;
      if x = 4;
        leave;
      endif;
      dsply %char(x);
    endfor;
    dsply 'fin ' + %char(x);
    *inlr = *on;
  `), ['1', '3', 'fin 4']);
});

test('FOR-EACH sur un tableau de DS : copie dans une DS de même disposition', () => {
  assert.deepEqual(run(`
    dcl-ds d qualified dim(3);
      code char(2);
      qte int(10);
    end-ds;
    dcl-ds cur qualified;
      c char(2);
      q int(10);
    end-ds;
    d(1).code = 'A';
    d(1).qte = 1;
    d(2).code = 'B';
    d(2).qte = 2;
    for-each cur in d;
      dsply %trim(cur.c) + '/' + %char(cur.q);
      cur.q = 99;
    endfor;
    dsply %char(d(2).qte);
    *inlr = *on;
  `), ['A/1', 'B/2', '/0', '2']);
});

test('FOR-EACH : catégorie incompatible, disposition différente', () => {
  assert.throws(() => run(`
    dcl-s t char(2) dim(2);
    dcl-s x int(10);
    for-each x in t;
    endfor;
  `), /incompatibles/);
  assert.throws(() => run(`
    dcl-s t int(10) dim(2);
    dcl-s c char(2);
    for-each c in t;
    endfor;
  `), /incompatibles/);
  assert.throws(() => run(`
    dcl-ds d qualified dim(2);
      a int(10);
    end-ds;
    dcl-ds cur qualified;
      c char(2);
    end-ds;
    for-each cur in d;
    endfor;
  `), err => NOT_SUPPORTED.test(err.message) && /disposition/.test(err.message));
  assert.throws(() => run(`
    dcl-ds d qualified dim(2);
      a int(10);
    end-ds;
    dcl-s x int(10);
    for-each x in d;
    endfor;
  `), err => /incompatibles|structure de données/i.test(err.message));
});

test('FOR-EACH : refus et erreurs de compilation', () => {
  const decl = 'dcl-s t int(10) dim(3); dcl-s x int(10); dcl-s s char(5);';
  assert.throws(() => parse(`${decl} for-each(h) x in t; endfor;`), NOT_SUPPORTED);
  for (const src of ['%subarr(t : 1 : 2)', '%list(1 : 2)', "%split('a b')", '%range(1 : 3)']) {
    assert.throws(() => parse(`${decl} for-each x in ${src}; endfor;`), NOT_SUPPORTED, src);
  }
  assert.throws(() => parse(`${decl} for-each x in s; endfor;`), err => !NOT_SUPPORTED.test(err.message) && /tableau/i.test(err.message));
  assert.throws(() => parse(`${decl} for-each x in t; x = 1;`), /ENDFOR/i);
  assert.throws(() => parse(`${decl} for-each x t; endfor;`), /IN/i);
  assert.throws(() => parse(`${decl} for-each t in t; endfor;`), NOT_SUPPORTED);
});
