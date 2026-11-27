// Dates : corrections de relecture et arithmétique
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, customersContext } = require('./helpers');
const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;
// 4 octobre 2026, 13 h 45 min 07 s 089 ms, heure locale
const CLOCK = { clock: () => new Date(2026, 9, 4, 13, 45, 7, 89) };
const DT = `dcl-s d date inz(D'2026-10-04'); dcl-s e date inz(D'2026-10-05');`;

// --- Corrections de la relecture finale ---


test('%DEC, %INT, %MAX d\'une date : pas encore supporté', () => {
  assert.throws(() => run(`${DT} dsply %char(%dec(d : 8 : 0));`), NOT_SUPPORTED);
  assert.throws(() => run(`${DT} dsply %char(%int(d));`), NOT_SUPPORTED);
  assert.throws(() => run(`${DT} dsply %char(%max(d : e));`), NOT_SUPPORTED);
});

test('les autres fonctions intégrées refusent une date', () => {
  assert.throws(() => run(`${DT} dsply %trim(d);`), INCOMPATIBLE);
  assert.throws(() => run(`${DT} dsply %subst(d : 1 : 4);`), INCOMPATIBLE);
  assert.throws(() => run(`${DT} dsply %char(%scan('-' : d));`), INCOMPATIBLE);
});

test('%LEN d\'une date, d\'une heure et d\'un timestamp', () => {
  const out = run(`dcl-s d date; dcl-s t time; dcl-s z timestamp;
    dsply %char(%len(d)); dsply %char(%len(t)); dsply %char(%len(z));`);
  assert.deepEqual(out, ['10', '8', '26']);
});

test('une date utilisée comme condition est refusée', () => {
  assert.throws(() => run(`${DT} if d; dsply 'x'; endif;`), INCOMPATIBLE);
  assert.throws(() => run(`${DT} if 1 = 2; dsply 'a'; elseif d; dsply 'x'; endif;`), INCOMPATIBLE);
  assert.throws(() => run(`${DT} select; when d; dsply 'x'; endsl;`), INCOMPATIBLE);
  assert.throws(() => run(`${DT} dow d; dsply 'x'; enddo;`), INCOMPATIBLE);
  assert.throws(() => run(`${DT} dou d; dsply 'x'; enddo;`), INCOMPATIBLE);
});

test('une variable hôte date dans EXEC SQL est refusée dès l\'analyse', () => {
  assert.throws(() => parse(`dcl-s d date; if 1 = 2; exec sql update customers set city = 'X' where date_maj < :d; endif;`), NOT_SUPPORTED);
});

test('%CHAR accepte au plus 2 arguments', () => {
  assert.throws(() => parse(`dcl-s d date; dsply %char(d : *iso : 1);`), /%CHAR accepte au plus 2 arguments/);
});

test('un bouchon qui donne un nombre pour une date est une erreur claire', () => {
  const ctx = { tables: {}, files: {}, programs: { ECHEANCE: { calls: [{ set: { fin: 20261004 } }] } } };
  assert.throws(() => run(`
    dcl-pr echeance extpgm('ECHEANCE');
      fin date;
    end-pr;
    dcl-s fin date;
    echeance(fin);
  `, ctx), /ECHEANCE.*DATE doit être un texte \*ISO, reçu 20261004/);
});

test('un paramètre date d\'un programme appelé reçoit un texte : pas encore supporté', () => {
  const callee = `
    dcl-pi *n;
      p date;
    end-pi;
    dsply %char(p);
  `;
  assert.throws(() => run(`
    dcl-pr suivant extpgm('SUIVANT');
      p char(10);
    end-pr;
    dcl-s texte char(10) inz('2026-10-04');
    suivant(texte);
  `, undefined, { resolveProgram: name => (name === 'SUIVANT' ? { source: callee } : undefined) }), /Paramètre P.*DATE.*pas encore support/i);
});

test('%DATE, %TIME et %TIMESTAMP sans parenthèses', () => {
  const out = run(`dsply %char(%date); dsply %char(%time); dsply %char(%timestamp);`, undefined, CLOCK);
  assert.deepEqual(out, ['2026-10-04', '13.45.07', '2026-10-04-13.45.07.089000']);
});

// --- Incrément 2 : arithmétique ---


test('date + %DAYS + %MONTHS + %YEARS, évalués de gauche à droite', () => {
  const out = run(`
    dcl-s d date inz(D'2026-01-31');
    dcl-s r date;
    r = d + %days(1) + %months(1) + %years(1);
    dsply r;
    r = d + %months(1);
    dsply r;
    r = d - %days(31);
    dsply r;
  `);
  assert.deepEqual(out, ['2027-03-01', '2026-02-28', '2025-12-31']);
});

test('%date() - %years(2) avec l\'horloge figée', () => {
  assert.deepEqual(run(`dcl-s limite date; limite = %date() - %years(2); dsply limite;`, undefined, CLOCK), ['2024-10-04']);
});

test('heures et timestamps', () => {
  const out = run(`
    dcl-s t time inz(T'08.30.00');
    dcl-s z timestamp inz(Z'2026-10-04-23.59.59.999999');
    dsply %char(t + %minutes(45) - %seconds(30));
    dsply %char(z + %mseconds(1));
    dsply %char(z + %hours(1) + %days(1));
    dsply %char(z + %hours(24 * 146097));
  `);
  assert.deepEqual(out, ['09.14.30', '2026-10-05-00.00.00.000000', '2026-10-06-00.59.59.999999',
                         '2426-10-04-23.59.59.999999']);
});

test('date calculée dans une comparaison', () => {
  const out = run(`
    dcl-s echeance date inz(D'2026-10-10');
    if echeance < %date() + %days(7);
      dsply 'bientot';
    endif;
  `, undefined, CLOCK);
  assert.deepEqual(out, ['bientot']);
});

test('date hors limites : statut 00113 interceptable', () => {
  const out = run(`
    dcl-s d date inz(D'9999-12-31');
    monitor;
      d = d + %days(1);
    on-error 00113;
      dsply 'statut ' + %char(%status());
    endmon;
    dsply d;
  `);
  assert.deepEqual(out, ['statut 113', '9999-12-31']);
  assert.throws(() => run(`dcl-s d date inz(D'0001-01-01'); d = d - %years(1);`), /RNX0113/);
});

test('durée mal placée ou d\'un mauvais type : types incompatibles', () => {
  for (const src of [
    `dcl-s d date; d = d + %hours(1);`,
    `dcl-s t time; t = t + %days(1);`,
    `dcl-s d date; dcl-s e date; dcl-s n int(10); n = d - e;`,
    `dcl-s n int(10); n = %days(1);`,
    `dcl-s d date; d = %days(1);`,
    `dsply %days(1);`,
    `if %days(1) = %days(1); endif;`,
    `if %days(2); endif;`,
    `dcl-s d date; d = d + (%days(1) + %days(2));`,
    `dcl-s c char(20); c = %char(%days(1));`,
    `dcl-s n int(10); n = %len(%days(1));`,
    `dcl-s d date; d = d + %days('x');`,
    `dcl-s d date; d = d + %days(d);`,
    `dcl-s d date; d = %days(1) - d;`,
    `dcl-s i int(10); for i = 1 to %days(3); endfor;`,
    `dcl-s i int(10); for i = 1 to 3 by %days(1); endfor;`,
    `dcl-s i int(10); for i = 1 to D'2026-01-01'; endfor;`,
    `dcl-s i int(10); for i = %days(1) to 3; endfor;`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('%DIFF et %SUBDT', () => {
  const out = run(`
    dcl-s debut date inz(D'2026-01-31');
    dcl-s fin date inz(D'2026-10-04');
    dcl-s n int(10);
    n = %diff(fin : debut : *days);
    dsply %char(n);
    dsply %char(%diff(fin : debut : *MONTHS));
    dsply %char(%diff(debut : fin : *m));
    dsply %char(%diff(T'12.00.00' : T'10.30.00' : *mn));
    dsply %char(%subdt(fin : *years) * 100 + %subdt(fin : *months));
    dsply %char(%subdt(Z'2026-10-04-13.45.07.000089' : *ms));
  `);
  assert.deepEqual(out, ['246', '8', '-8', '90', '202610', '89']);
});

test('%DIFF et %SUBDT : unité non admise ou valeur non date', () => {
  for (const src of [
    `dcl-s n int(10); n = %diff(D'2026-10-04' : D'2026-01-01' : *hours);`,
    `dcl-s n int(10); n = %diff(T'10.00.00' : T'09.00.00' : *days);`,
    `dcl-s n int(10); n = %diff(20261004 : 20260101 : *days);`,
    `dcl-s n int(10); n = %subdt(D'2026-10-04' : *ms);`,
    `dcl-s n int(10); n = %subdt('2026-10-04' : *years);`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('%DIFF et %SUBDT : unité inconnue ou nombre d\'arguments, erreur d\'analyse', () => {
  assert.throws(() => parse(`dcl-s n int(10); n = %diff(D'2026-10-04' : D'2026-01-01' : *weeks);`),
    /unité \*WEEKS inconnue.*ligne 1/i);
  assert.throws(() => parse(`dcl-s n int(10); n = %subdt(D'2026-10-04' : 'x');`), /unité.*inconnue/i);
  assert.throws(() => parse(`dcl-s n int(10); n = %diff(D'2026-10-04' : D'2026-01-01');`), /%DIFF attend 3 arguments/);
  assert.throws(() => parse(`dcl-s n int(10); n = %subdt(D'2026-10-04');`), /%SUBDT attend 2 arguments/);
  assert.throws(() => parse(`dcl-s d date; d = d + %days();`), /%DAYS attend 1 argument/);
});

test('durées : argument entier garanti accepté', () => {
  const out = run(`
    dcl-s n int(10) inz(3);
    dcl-s p packed(5:0) inz(2);
    dcl-s d date inz(D'2026-10-04');
    dcl-s fin date inz(D'2026-10-10');
    dcl-s debut date inz(D'2026-10-04');
    dsply %char(d + %days(n));
    dsply %char(d + %days(p));
    dsply %char(d + %days(n * 2 + 1));
    dsply %char(d + %days(%diff(fin : debut : *days)));
    dsply %char(d + %months(-3));
  `);
  assert.deepEqual(out, ['2026-10-07', '2026-10-06', '2026-10-11', '2026-10-10', '2026-07-04']);
});

test('%SUBDT d\'une heure en *DAYS, %DIFF *MS d\'un jour, grand décalage de timestamp', () => {
  assert.throws(() => run(`dcl-s n int(10); n = %subdt(T'13.45.07' : *days);`), INCOMPATIBLE);
  const out = run(`
    dcl-s n int(20);
    dcl-s z timestamp inz(Z'2026-10-04-12.00.00.000001');
    n = %diff(Z'2026-10-05-00.00.00.000000' : Z'2026-10-04-00.00.00.000000' : *ms);
    dsply %char(n);
    dsply %char(z - %hours(24 * 146097));
  `);
  assert.deepEqual(out, ['86400000000', '1626-10-04-12.00.00.000001']);
});

test('durée en argument de procédure ou en RETURN : types incompatibles', () => {
  assert.throws(() => run(`
    dcl-s r int(10);
    r = p(%days(1));
    dcl-proc p;
      dcl-pi *n int(10); x int(10) value; end-pi;
      return x;
    end-proc;
  `), INCOMPATIBLE);
  assert.throws(() => run(`
    dcl-s d date;
    d = q();
    dcl-proc q;
      dcl-pi *n date; end-pi;
      return %days(1);
    end-proc;
  `), INCOMPATIBLE);
});

test('%DIFF avec une unité seule : message d\'arité', () => {
  assert.throws(() => parse(`dcl-s n int(10); n = %diff(D'2026-10-04' : *days);`), /%DIFF attend 3 arguments/);
});
