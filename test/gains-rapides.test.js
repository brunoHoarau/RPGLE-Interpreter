// Constructions courantes débloquées par le lot « gains rapides »
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

test('+=, -=, *=, /= et **= sur des nombres', () => {
  const out = run(`
    dcl-s n packed(7:2) inz(10);
    n += 5;
    dsply %char(n);
    n -= 2.5;
    dsply %char(n);
    n *= 2 + 2;
    dsply %char(n);
    n /= 5;
    dsply %char(n);
    n **= 2;
    dsply %char(n);
  `);
  assert.deepEqual(out, ['15.00', '12.50', '50.00', '10.00', '100.00']);
});

test('+= concatène du caractère et respecte la longueur déclarée', () => {
  const out = run(`
    dcl-s v varchar(5) inz('ab');
    v += 'cd';
    dsply v;
    v += 'efgh';
    dsply v;
  `);
  assert.deepEqual(out, ['abcd', 'abcde']);
});

test('opérateurs composés sur un champ de DS, avec EVAL, et sur une date', () => {
  const out = run(`
    dcl-ds cpt qualified;
      lignes int(10);
    end-ds;
    dcl-ds totaux;
      montant packed(7:2);
    end-ds;
    dcl-s d date inz(D'2026-10-04');
    cpt.lignes += 1;
    eval cpt.lignes *= 10;
    montant += 1.5;
    d += %days(1);
    dsply %char(cpt.lignes);
    dsply %char(montant);
    dsply d;
  `);
  assert.deepEqual(out, ['10', '1.50', '2026-10-05']);
});

test('opérateur composé : erreurs habituelles', () => {
  assert.throws(() => run(`dcl-s d date; d += 1;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s n int(5) inz(1); n /= 0;`), /RNX0102/);
  assert.throws(() => run(`dcl-s n int(3) inz(100); n += 100;`), /RNX0103/);
  assert.throws(() => run(`inconnu += 1;`), /non déclarée/i);
});

test('les opérateurs ordinaires restent inchangés', () => {
  const out = run(`
    dcl-s n int(10) inz(3);
    dcl-s b ind;
    n = n * 2 ** 2;
    b = *on;
    if n = 12 and b = *on;
      dsply 'ok';
    endif;
    n = -1;
    dsply %char(n);
  `);
  assert.deepEqual(out, ['ok', '-1']);
});

test('paramètres *N dans un prototype', () => {
  const ctx = { tables: {}, files: {}, programs: { CALCUL: { calls: [{ set: { resultat: 7 } }] } } };
  const out = run(`
    dcl-pr calcul extpgm('CALCUL');
      *n char(10) const;
      resultat packed(5:0);
      *N packed(4:0) options(*nopass);
    end-pr;
    dcl-s r packed(5:0);
    calcul('A' : r);
    dsply %char(r);
  `, ctx);
  assert.deepEqual(out, ['7']);
});

test('*N reste interdit comme nom de paramètre de DCL-PI', () => {
  assert.throws(() => parse(`dcl-proc p; dcl-pi *n; *n int(5); end-pi; end-proc;`));
});

test('%STATUS sans parenthèses', () => {
  const out = run(`
    dcl-s n int(5) inz(1);
    monitor;
      n = n / 0;
    on-error;
      if %status = 102;
        dsply 'statut ' + %char(%status);
      endif;
    endmon;
  `);
  assert.deepEqual(out, ['statut 102']);
});

test('%EOF, %FOUND et %ERROR restent refusés', () => {
  for (const src of ['if %eof; endif;', 'if %found(f); endif;', 'if %error; endif;']) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('variables, champs et paramètres nommés comme un type', () => {
  const out = run(`
    dcl-s zoned zoned(4:0);
    dcl-s packed packed(5) inz(9);
    dcl-s date date inz(D'2026-10-04');
    dcl-s pointer int(5) inz(3);
    dcl-ds char qualified;
      int int(10) inz(4);
    end-ds;
    zoned = 8 + 47;
    zoned += 1;
    if packed = 9 or zoned = 0;
      dsply %char(zoned);
    endif;
    char.int += pointer;
    dsply %char(char.int);
    dsply date;
    dsply %char(time(2));
    dcl-proc time;
      dcl-pi *n int(10);
        varchar int(10) value;
      end-pi;
      return varchar * 10;
    end-proc;
  `);
  assert.deepEqual(out, ['56', '7', '2026-10-04', '20']);
});

test('un mot de type reste un type en position de type', () => {
  assert.throws(() => parse(`dcl-s p pointer;`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-s x float(8);`), NOT_SUPPORTED);
});

test('affectation composée sur un élément de tableau : refusée explicitement', () => {
  assert.throws(() => parse(`dcl-s x int(5); x(1) += 2;`), NOT_SUPPORTED);
});

test('DS d\'indicateurs avec POS', () => {
  const out = run(`
    dcl-ds indicateurs;
      Sortie  ind pos(3);
      Annuler ind pos(12);
    end-ds;
    dcl-ds zones qualified;
      code char(2) pos(5) inz('xy');
      montant packed(7:2);
    end-ds;
    Sortie = *on;
    if Sortie and not Annuler;
      dsply 'sortie';
    endif;
    zones.montant = 12.5;
    dsply zones.code + %char(zones.montant);
  `);
  assert.deepEqual(out, ['sortie', 'xy12.50']);
});

test('POS : chevauchement refusé, valeur invalide, POS hors DS', () => {
  assert.throws(() => parse(`dcl-ds d; a char(4) pos(1); b char(2) pos(3); end-ds;`),
    err => NOT_SUPPORTED.test(err.message) && /chevauch/i.test(err.message));
  assert.throws(() => parse(`dcl-ds d; a packed(7:2); b ind pos(4); end-ds;`), /chevauch/i);
  assert.throws(() => parse(`dcl-ds d; a ind pos(0); end-ds;`), /POS/);
  assert.throws(() => parse(`dcl-s x ind pos(3);`), NOT_SUPPORTED);
});

test('POS : champs contigus sans chevauchement acceptés', () => {
  assert.doesNotThrow(() => parse(`dcl-ds d; a char(4) pos(1); b char(2) pos(5); c int(10); end-ds;`));
  assert.doesNotThrow(() => parse(`dcl-ds d; a varchar(3); b date pos(6); end-ds;`));
});
