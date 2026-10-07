const test = require('node:test');
const assert = require('node:assert/strict');
const { run, customersContext } = require('./helpers');

// --- Déclaration et appel ---

test('appel d\'une procédure sans paramètre', () => {
  const out = run(`
    dcl-proc saluer;
      dsply 'bonjour';
    end-proc;
    saluer();
    saluer();
  `);
  assert.deepEqual(out, ['bonjour', 'bonjour']);
});

test('procédure déclarée après le code principal', () => {
  const out = run(`
    ctl-opt dftactgrp(*no);
    saluer();
    return;

    dcl-proc saluer;
      dcl-pi *n end-pi;
      dsply 'bonjour';
    end-proc;
  `);
  assert.deepEqual(out, ['bonjour']);
});

test('fonction avec valeur de retour dans une expression', () => {
  const out = run(`
    dsply %char(add(2: 3) * 10);

    dcl-proc add;
      dcl-pi *n int(10);
        a int(10) value;
        b int(10) value;
      end-pi;
      return a + b;
    end-proc;
  `);
  assert.deepEqual(out, ['50']);
});

test('dcl-pi nommé, mot-clé export et nom insensible à la casse', () => {
  const out = run(`
    dsply %char(DOUBLE(4));

    dcl-proc Double export;
      dcl-pi Double int(10);
        n int(10) const;
      end-pi;
      return n * 2;
    end-proc;
  `);
  assert.deepEqual(out, ['8']);
});

test('CALLP appelle une procédure', () => {
  const out = run(`
    callp afficher('x');

    dcl-proc afficher;
      dcl-pi *n;
        msg char(10) const;
      end-pi;
      dsply msg;
    end-proc;
  `);
  assert.deepEqual(out, ['x']);
});

// --- Passage de paramètres ---

test('un paramètre par référence est modifié chez l\'appelant', () => {
  const out = run(`
    dcl-s x int(10) inz(1);
    incr(x);
    dsply %char(x);

    dcl-proc incr;
      dcl-pi *n;
        n int(10);
      end-pi;
      n = n + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['2']);
});

test('un champ de DS passé par référence est modifié', () => {
  const out = run(`
    dcl-ds c qualified;
      n int(10) inz(5);
    end-ds;
    incr(c.n);
    dsply %char(c.n);

    dcl-proc incr;
      dcl-pi *n;
        n int(10);
      end-pi;
      n = n + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['6']);
});

test('un paramètre VALUE n\'est pas modifié chez l\'appelant', () => {
  const out = run(`
    dcl-s x int(10) inz(1);
    incr(x);
    dsply %char(x);

    dcl-proc incr;
      dcl-pi *n;
        n int(10) value;
      end-pi;
      n = n + 1;
      dsply 'local ' + %char(n);
    end-proc;
  `);
  assert.deepEqual(out, ['local 2', '1']);
});

test('une expression peut être passée à un paramètre CONST', () => {
  const out = run(`
    dcl-s x int(10) inz(1);
    afficher(x + 41);

    dcl-proc afficher;
      dcl-pi *n;
        n int(10) const;
      end-pi;
      dsply %char(n);
    end-proc;
  `);
  assert.deepEqual(out, ['42']);
});

test('un nombre de paramètres incorrect est une erreur', () => {
  assert.throws(() => run(`
    p(1: 2);
    dcl-proc p;
      dcl-pi *n;
        a int(10) value;
      end-pi;
    end-proc;
  `), /paramètre/i);
});

test('OPTIONS(*NOPASS) autorise un paramètre omis', () => {
  const out = run(`
    p(1);
    dcl-proc p;
      dcl-pi *n;
        a int(10) value;
        b int(10) value options(*nopass);
      end-pi;
      dsply %char(a);
    end-proc;
  `);
  assert.deepEqual(out, ['1']);
});

// --- Portée ---

test('une variable locale n\'est pas visible du programme principal', () => {
  assert.throws(() => run(`
    p();
    dsply tmp;
    dcl-proc p;
      dcl-s tmp char(5) inz('loc');
    end-proc;
  `), /tmp/);
});

test('une variable locale masque la globale du même nom', () => {
  const out = run(`
    dcl-s x int(10) inz(1);
    p();
    dsply %char(x);

    dcl-proc p;
      dcl-s x int(10) inz(2);
      x = x + 10;
      dsply %char(x);
    end-proc;
  `);
  assert.deepEqual(out, ['12', '1']);
});

test('une procédure lit et modifie une variable globale', () => {
  const out = run(`
    dcl-s compteur int(10) inz(0);
    p();
    p();
    dsply %char(compteur);

    dcl-proc p;
      compteur = compteur + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['2']);
});

test('constante locale', () => {
  const out = run(`
    p();
    dcl-proc p;
      dcl-c TAUX 20;
      dsply %char(TAUX);
    end-proc;
  `);
  assert.deepEqual(out, ['20']);
});

test('les variables locales sont réinitialisées à chaque appel', () => {
  const out = run(`
    p();
    p();
    dcl-proc p;
      dcl-s n int(10) inz(0);
      n = n + 1;
      dsply %char(n);
    end-proc;
  `);
  assert.deepEqual(out, ['1', '1']);
});

// --- Flux de contrôle ---

test('récursion : factorielle', () => {
  const out = run(`
    dsply %char(fact(5));

    dcl-proc fact;
      dcl-pi *n int(10);
        n int(10) value;
      end-pi;
      if n <= 1;
        return 1;
      endif;
      return n * fact(n - 1);
    end-proc;
  `);
  assert.deepEqual(out, ['120']);
});

test('RETURN dans une boucle sort de la procédure, pas du programme', () => {
  const out = run(`
    dsply %char(premier(7));
    dsply 'suite';

    dcl-proc premier;
      dcl-pi *n int(10);
        max int(10) value;
      end-pi;
      dcl-s i int(10);
      for i = 1 to max;
        if i = 3;
          return i;
        endif;
      endfor;
      return 0;
    end-proc;
  `);
  assert.deepEqual(out, ['3', 'suite']);
});

test('RETURN sans valeur sort seulement de la procédure', () => {
  const out = run(`
    p();
    dsply 'apres';
    dcl-proc p;
      dsply 'debut';
      return;
      dsply 'jamais';
    end-proc;
  `);
  assert.deepEqual(out, ['debut', 'apres']);
});

test('une récursion infinie est stoppée', () => {
  assert.throws(
    () => run(`
      p();
      dcl-proc p;
        p();
      end-proc;
    `, undefined, { maxCallDepth: 50 }),
    /récursion/i
  );
});

test('appel d\'une procédure inconnue', () => {
  assert.throws(() => run(`inconnue();`), /inconnue/);
});

// --- Prototypes et SQL ---

test('les prototypes DCL-PR sont acceptés', () => {
  const out = run(`
    dcl-pr add int(10);
      a int(10) value;
      b int(10) value;
    end-pr;

    dsply %char(add(1: 2));

    dcl-proc add;
      dcl-pi *n int(10);
        a int(10) value;
        b int(10) value;
      end-pi;
      return a + b;
    end-proc;
  `);
  assert.deepEqual(out, ['3']);
});

test('EXEC SQL dans un bloc IF', () => {
  const out = run(`
    dcl-s vName char(20);
    if 1 = 1;
      exec sql select name into :vName from customers where id = 2;
    endif;
    dsply vName;
  `, customersContext());
  assert.deepEqual(out, ['Martin']);
});

test('EXEC SQL dans une procédure avec variable hôte locale', () => {
  const out = run(`
    dsply nomClient(3);

    dcl-proc nomClient;
      dcl-pi *n char(20);
        id int(10) value;
      end-pi;
      dcl-s nom char(20);
      exec sql select name into :nom from customers where id = :id;
      return nom;
    end-proc;
  `, customersContext());
  assert.deepEqual(out, ['Bernard']);
});

// --- Paramètres structure de données (LIKEDS) ---

const DS_MODELE = `
    dcl-ds modele qualified;
      nom char(5);
      qte int(10);
    end-ds;
`;

test('paramètre LIKEDS par référence : les modifications reviennent à l\'appelant', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    a.nom = 'abc';
    a.qte = 1;
    maj(a);
    dsply %trim(a.nom);
    dsply %char(a.qte);
    dcl-proc maj;
      dcl-pi *n;
        p likeds(modele);
      end-pi;
      dsply %trim(p.nom);
      p.nom = 'xyz';
      p.qte = p.qte + 1;
    end-proc;
  `);
  assert.deepEqual(out, ['abc', 'xyz', '2']);
});

test('paramètre LIKEDS par référence : retour anticipé par RETURN, modifications conservées', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    maj(a);
    dsply %char(a.qte);
    dcl-proc maj;
      dcl-pi *n;
        p likeds(modele);
      end-pi;
      p.qte = 7;
      return;
    end-proc;
  `);
  assert.deepEqual(out, ['7']);
});

test('paramètre LIKEDS : la DS modèle elle-même est acceptée', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    maj(modele);
    dsply %char(modele.qte);
    dcl-proc maj;
      dcl-pi *n;
        p likeds(modele);
      end-pi;
      p.qte = 9;
    end-proc;
  `);
  assert.deepEqual(out, ['9']);
});

test('paramètre LIKEDS : une DS LIKEDS d\'une LIKEDS est acceptée (filiation transitive)', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    dcl-ds b likeds(a);
    maj(b);
    dsply %char(b.qte);
    dcl-proc maj;
      dcl-pi *n;
        p likeds(modele);
      end-pi;
      p.qte = 4;
    end-proc;
  `);
  assert.deepEqual(out, ['4']);
});

test('paramètre LIKEDS CONST : lecture possible, affectation d\'une sous-zone refusée', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    a.nom = 'abc';
    lire(a);
    dcl-proc lire;
      dcl-pi *n;
        p likeds(modele) const;
      end-pi;
      dsply %trim(p.nom);
    end-proc;
  `);
  assert.deepEqual(out, ['abc']);
  assert.throws(() => run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    ecrire(a);
    dcl-proc ecrire;
      dcl-pi *n;
        p likeds(modele) const;
      end-pi;
      p.nom = 'x';
    end-proc;
  `), /paramètre CONST.*affectation refusée par le compilateur IBM i/i);
});

test('paramètre LIKEDS CONST : la modification n\'est pas renvoyée, une variable locale copiée reste possible', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    a.qte = 3;
    lire(a);
    dsply %char(a.qte);
    dcl-proc lire;
      dcl-pi *n;
        p likeds(modele) const;
      end-pi;
      dcl-ds loc likeds(modele);
      loc = p;
      loc.qte = 50;
      dsply %char(p.qte);
    end-proc;
  `);
  assert.deepEqual(out, ['3', '3']);
});

test('paramètre LIKEDS VALUE : copie, aucune modification ne revient', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    a.qte = 3;
    maj(a);
    dsply %char(a.qte);
    dcl-proc maj;
      dcl-pi *n;
        p likeds(modele) value;
      end-pi;
      p.qte = 99;
      dsply %char(p.qte);
    end-proc;
  `);
  assert.deepEqual(out, ['99', '3']);
});

test('paramètre LIKEDS par référence : DS sans filiation (même disposition) refusée', () => {
  assert.throws(() => run(`${DS_MODELE}
    dcl-ds autre qualified;
      nom char(5);
      qte int(10);
    end-ds;
    maj(autre);
    dcl-proc maj;
      dcl-pi *n;
        p likeds(modele);
      end-pi;
      p.qte = 1;
    end-proc;
  `), /types incompatibles.*compilateur IBM i|filiation/is);
});

test('paramètre LIKEDS CONST : DS sans filiation, pas encore supporté', () => {
  assert.throws(() => run(`${DS_MODELE}
    dcl-ds autre qualified;
      nom char(5);
      qte int(10);
    end-ds;
    lire(autre);
    dcl-proc lire;
      dcl-pi *n;
        p likeds(modele) const;
      end-pi;
      dsply %trim(p.nom);
    end-proc;
  `), /pas encore supporté/i);
});

test('paramètre LIKEDS : littéral, variable non DS et sous-zone refusés', () => {
  for (const arg of ["'abc'", 'x', 'a.nom', '1 + 2']) {
    for (const mode of ['', ' const', ' value']) {
      assert.throws(() => run(`${DS_MODELE}
        dcl-ds a likeds(modele);
        dcl-s x char(5);
        lire(${arg});
        dcl-proc lire;
          dcl-pi *n;
            p likeds(modele)${mode};
          end-pi;
        end-proc;
      `), /structure de données|types incompatibles/i, `${arg}${mode}`);
    }
  }
});

test('paramètre LIKEDS : une DS paramètre peut être transmise à une autre procédure', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    ext(a);
    dsply %char(a.qte);
    dcl-proc ext;
      dcl-pi *n;
        p likeds(modele);
      end-pi;
      inte(p);
    end-proc;
    dcl-proc inte;
      dcl-pi *n;
        q likeds(modele);
      end-pi;
      q.qte = 12;
    end-proc;
  `);
  assert.deepEqual(out, ['12']);
});

test('paramètre LIKEDS : la procédure ne partage pas l\'objet de l\'appelant (exception : rien ne revient)', () => {
  const out = run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    a.qte = 1;
    monitor;
      maj(a);
    on-error;
      dsply 'erreur';
    endmon;
    dsply %char(a.qte);
    dcl-proc maj;
      dcl-pi *n;
        p likeds(modele);
      end-pi;
      dcl-s z int(10);
      p.qte = 5;
      z = 1 / 0;
    end-proc;
  `);
  assert.deepEqual(out, ['erreur', '1']);
});

test('paramètre LIKEDS *NOPASS : pas encore supporté', () => {
  assert.throws(() => run(`${DS_MODELE}
    dcl-ds a likeds(modele);
    maj(a);
    dcl-proc maj;
      dcl-pi *n;
        p likeds(modele) options(*nopass);
      end-pi;
    end-proc;
  `), /pas encore supporté/i);
});
