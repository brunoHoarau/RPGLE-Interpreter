// Dates, heures et timestamps (socle *ISO) : comportement attendu sur IBM i
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, customersContext } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

// 4 octobre 2026, 13 h 45 min 07 s 089 ms, heure locale
const CLOCK = { clock: () => new Date(2026, 9, 4, 13, 45, 7, 89) };

test('valeurs par défaut sans INZ', () => {
  const out = run(`
    dcl-s d date;
    dcl-s t time;
    dcl-s z timestamp;
    dsply %char(d);
    dsply %char(t);
    dsply %char(z);
  `);
  assert.deepEqual(out, ['0001-01-01', '00.00.00', '0001-01-01-00.00.00.000000']);
});

test('littéraux D, T et Z en INZ et en affectation, casse indifférente', () => {
  const out = run(`
    dcl-s d date inz(D'2026-10-04');
    dcl-s t time inz(t'13.45.00');
    dcl-s z timestamp inz(Z'2026-10-04-13.45.00.000123');
    dsply d;
    dsply t;
    dsply z;
    d = d'2024-02-29';
    dsply d;
  `);
  assert.deepEqual(out, ['2026-10-04', '13.45.00', '2026-10-04-13.45.00.000123', '2024-02-29']);
});

test('un littéral invalide est une erreur d\'analyse', () => {
  assert.throws(() => parse(`dcl-s d date inz(D'2026-02-30');`), /D'2026-02-30'.*invalide.*ligne 1/i);
  assert.throws(() => parse(`dcl-s t time; t = T'25.00.00';`), /invalide/i);
  assert.throws(() => parse(`dcl-s t time; t = T'13:45:00';`), /invalide/i);
});

test('date(*ISO), time(*ISO) et timestamp(6) sont acceptés', () => {
  const out = run(`
    dcl-s d date(*iso) inz(D'2026-10-04');
    dcl-s t time(*ISO);
    dcl-s z timestamp(6);
    dsply d;
  `);
  assert.deepEqual(out, ['2026-10-04']);
});

test('ctl-opt datfmt(*iso) timfmt(*iso) est accepté', () => {
  assert.deepEqual(run(`ctl-opt dftactgrp(*no) datfmt(*iso) timfmt(*iso); dsply 'ok';`), ['ok']);
});

test('dates dans une DS, en paramètre et en retour de procédure', () => {
  const out = run(`
    dcl-ds cmd qualified;
      num int(10);
      livraison date inz(D'2026-12-24');
    end-ds;
    dsply Cmd.Livraison;
    dsply %char(noel(cmd.livraison));
    dcl-proc noel;
      dcl-pi *n date;
        d date const;
      end-pi;
      dsply d;
      return D'2026-12-25';
    end-proc;
  `);
  assert.deepEqual(out, ['2026-12-24', '2026-12-24', '2026-12-25']);
});

test('une date passe par référence à un programme appelé', () => {
  const callee = `dcl-pi *n; d date; end-pi; dsply d; d = D'2027-01-01';`;
  const out = run(`
    dcl-pr suivant extpgm('SUIVANT');
      d date;
    end-pr;
    dcl-s d date inz(D'2026-10-04');
    suivant(d);
    dsply d;
  `, undefined, { resolveProgram: name => (name === 'SUIVANT' ? { source: callee } : undefined) });
  assert.deepEqual(out, ['2026-10-04', '2027-01-01']);
});

test('affecter un texte, un nombre ou un autre type à une date est refusé', () => {
  assert.throws(() => run(`dcl-s d date; d = '2026-10-04';`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; d = 20261004;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; dcl-s z timestamp; d = z;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s c char(10); c = D'2026-10-04';`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s n packed(8:0); n = D'2026-10-04';`), INCOMPATIBLE);
});

test('une erreur de type n\'est pas interceptée par MONITOR', () => {
  assert.throws(() => run(`
    dcl-s d date;
    monitor;
      d = 'x';
    on-error;
      dsply 'intercepté';
    endmon;
  `), INCOMPATIBLE);
});

test('comparaisons entre dates, heures et timestamps', () => {
  const out = run(`
    dcl-s debut date inz(D'2026-01-31');
    dcl-s fin date inz(D'2026-02-01');
    dcl-s t1 time inz(T'08.00.00');
    dcl-s z1 timestamp inz(Z'2026-10-04-13.45.00.000001');
    if debut < fin;
      dsply 'avant';
    endif;
    if fin >= D'2026-02-01' and fin <> debut;
      dsply 'egal ou apres';
    endif;
    if t1 > T'07.59.59';
      dsply 'plus tard';
    endif;
    if z1 > Z'2026-10-04-13.45.00.000000';
      dsply 'une microseconde';
    endif;
  `);
  assert.deepEqual(out, ['avant', 'egal ou apres', 'plus tard', 'une microseconde']);
});

test('comparer une date à un autre type est refusé', () => {
  assert.throws(() => run(`dcl-s d date; if d = '0001-01-01'; endif;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; if d > 20261004; endif;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; dcl-s z timestamp; if d = z; endif;`), INCOMPATIBLE);
});

test('calculer ou concaténer avec une date est refusé', () => {
  assert.throws(() => run(`dcl-s d date; dsply 'Le ' + d;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; d = d + 1;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s t time; dcl-s n int(5); n = t * 2;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; if not d; endif;`), INCOMPATIBLE);
});

test('INZ(*SYS) et INZ(*JOB) lisent l\'horloge', () => {
  const out = run(`
    dcl-s d date inz(*sys);
    dcl-s j date inz(*JOB);
    dcl-s t time inz(*SYS);
    dcl-s z timestamp inz(*sys);
    dsply d;
    dsply j;
    dsply t;
    dsply z;
  `, undefined, CLOCK);
  assert.deepEqual(out, ['2026-10-04', '2026-10-04', '13.45.07', '2026-10-04-13.45.07.089000']);
});

test('*LOVAL et *HIVAL en INZ, affectation et comparaison', () => {
  const out = run(`
    dcl-s d date inz(*hival);
    dcl-s t time;
    dcl-ds p qualified;
      z timestamp inz(*loval);
    end-ds;
    dsply d;
    t = *HIVAL;
    dsply t;
    dsply p.z;
    if P.Z = *loval and d <> *loval;
      dsply 'ok';
    endif;
    d = *loval;
    if d = *loval;
      dsply 'remis';
    endif;
  `);
  assert.deepEqual(out, ['9999-12-31', '24.00.00', '0001-01-01-00.00.00.000000', 'ok', 'remis']);
});

test('*HIVAL sur un champ de DS non qualifiée et sur un paramètre', () => {
  const out = run(`
    dcl-ds infos;
      echeance date;
    end-ds;
    echeance = *hival;
    dsply echeance;
    verifier(echeance);
    dcl-proc verifier;
      dcl-pi *n;
        d date const;
      end-pi;
      if d = *hival;
        dsply 'sans echeance';
      endif;
    end-proc;
  `);
  assert.deepEqual(out, ['9999-12-31', 'sans echeance']);
});

test('%DATE, %TIME et %TIMESTAMP sans argument lisent l\'horloge', () => {
  const out = run(`
    dsply %char(%date());
    dsply %char(%time());
    dsply %char(%timestamp());
  `, undefined, CLOCK);
  assert.deepEqual(out, ['2026-10-04', '13.45.07', '2026-10-04-13.45.07.089000']);
});

test('conversions entre date, heure et timestamp', () => {
  const out = run(`
    dcl-s z timestamp inz(Z'2026-10-04-13.45.07.000089');
    dcl-s d date inz(D'2026-12-24');
    dsply %char(%date(z));
    dsply %char(%time(z));
    dsply %char(%timestamp(d));
    dsply %char(%date(d));
  `);
  assert.deepEqual(out, ['2026-10-04', '13.45.07', '2026-12-24-00.00.00.000000', '2026-12-24']);
});

test('%DATE, %TIME et %TIMESTAMP lisent un texte *ISO', () => {
  const out = run(`
    dcl-s texte char(12) inz('2026-10-04');
    dcl-s d date;
    d = %date(texte);
    dsply d;
    dsply %char(%time('08.30.00'));
    dsply %char(%timestamp('2026-10-04-08.30.00.000000'));
  `);
  assert.deepEqual(out, ['2026-10-04', '08.30.00', '2026-10-04-08.30.00.000000']);
});

test('un texte invalide ou vide lève le statut 112, interceptable', () => {
  const out = run(`
    dcl-s d date;
    dcl-s vide char(10);
    monitor;
      d = %date('2026-02-30');
    on-error 112;
      dsply 'statut ' + %char(%status());
    endmon;
    monitor;
      d = %date(vide);
    on-error 00112;
      dsply 'vide';
    endmon;
  `);
  assert.deepEqual(out, ['statut 112', 'vide']);
  assert.throws(() => run(`dcl-s d date; d = %date('04/10/2026');`), /RNX0112/);
});

test('%DATE d\'une heure ou %TIME d\'une date est refusé', () => {
  assert.throws(() => run(`dcl-s t time; dcl-s d date; d = %date(t);`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s t time; dcl-s d date; t = %time(d);`), INCOMPATIBLE);
});

test('%CHAR(x : *ISO) donne le texte ISO', () => {
  const out = run(`
    dcl-s d date inz(D'2026-10-04');
    dcl-s t time inz(T'13.45.00');
    dsply 'Le ' + %char(d : *iso) + ' a ' + %char(t:*ISO);
  `);
  assert.deepEqual(out, ['Le 2026-10-04 a 13.45.00']);
  assert.throws(() => run(`dcl-s n int(5); dsply %char(n : *iso);`), INCOMPATIBLE);
});

test('une variable hôte date dans EXEC SQL est refusée', () => {
  assert.throws(() => run(`
    dcl-s d date;
    exec sql select date_creation into :d from customers where id = 1;
  `, customersContext()), NOT_SUPPORTED);
  assert.throws(() => run(`
    dcl-s d date inz(D'2026-10-04');
    exec sql update customers set city = 'X' where date_maj < :d;
  `, customersContext()), NOT_SUPPORTED);
});

test('un littéral date dans EXEC SQL est refusé', () => {
  assert.throws(() => parse(`exec sql update customers set city = 'X' where d < D'2026-10-04';`), NOT_SUPPORTED);
});

test('un bouchon reçoit et renvoie des dates en texte *ISO', () => {
  const ctx = { tables: {}, files: {}, programs: {
    ECHEANCE: { calls: [{ when: { depart: '2026-10-04' }, set: { fin: '2026-11-04' } }] },
    DERNIER: { calls: [{ return: '2026-12-31' }] },
  } };
  const out = run(`
    dcl-pr echeance extpgm('ECHEANCE');
      depart date const;
      fin date;
    end-pr;
    dcl-pr dernier date extproc('DERNIER');
    end-pr;
    dcl-s fin date;
    echeance(D'2026-10-04' : fin);
    dsply fin;
    dsply %char(dernier());
  `, ctx);
  assert.deepEqual(out, ['2026-11-04', '2026-12-31']);
});

test('un bouchon qui renvoie une date invalide est une erreur claire', () => {
  const ctx = { tables: {}, files: {}, programs: { ECHEANCE: { calls: [{ set: { fin: '04/11/2026' } }] } } };
  assert.throws(() => run(`
    dcl-pr echeance extpgm('ECHEANCE');
      fin date;
    end-pr;
    dcl-s fin date;
    echeance(fin);
  `, ctx), /ECHEANCE.*'04\/11\/2026'.*DATE \*ISO/);
});

// --- Corrections de la relecture finale ---

const DT = `dcl-s d date inz(D'2026-10-04'); dcl-s e date inz(D'2026-10-05');`;

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
