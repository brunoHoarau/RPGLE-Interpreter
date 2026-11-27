// Procedures : paramètres structure de données (LIKEDS)
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, customersContext } = require('./helpers');
const DS_MODELE = `
    dcl-ds modele qualified;
      nom char(5);
      qte int(10);
    end-ds;
`;
const DEUX_PARAMS = (decl1, decl2, args, corps) => `${DS_MODELE}
    dcl-s x int(10);
    dcl-ds a likeds(modele);
    maj(${args});
    dcl-proc maj;
      dcl-pi *n;
        ${decl1};
        ${decl2};
      end-pi;
      ${corps}
    end-proc;
  `;

// --- Paramètres structure de données (LIKEDS) ---


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

test('même DS passée deux fois par référence : pas encore supporté', () => {
  assert.throws(() => run(DEUX_PARAMS('p likeds(modele)', 'q likeds(modele)', 'a : a', "p.nom = 'A';\n dsply q.nom;")), /deux fois par référence.*pas encore supporté/i);
});

test('même scalaire passé deux fois par référence : pas encore supporté', () => {
  assert.throws(() => run(DEUX_PARAMS('p int(10)', 'q int(10)', 'x : x', 'p = 5;\n dsply %char(q);')), /deux fois par référence.*pas encore supporté/i);
});

test('une DS et sa sous-zone passées par référence : pas encore supporté', () => {
  assert.throws(() => run(DEUX_PARAMS('p likeds(modele)', 'q char(5)', 'a : a.nom', "p.nom = 'A';\n dsply q;")), /deux fois par référence/i);
});

test('même variable par référence et CONST : pas encore supporté', () => {
  assert.throws(() => run(DEUX_PARAMS('p int(10)', 'q int(10) const', 'x : x', 'p = 5;\n dsply %char(q);')), /deux fois par référence/i);
});

test('même variable par référence et VALUE, ou deux fois CONST : accepté', () => {
  assert.deepEqual(run(DEUX_PARAMS('p int(10)', 'q int(10) value', 'x : x', 'p = 5;\n dsply %char(q);')), ['0']);
  assert.deepEqual(run(DEUX_PARAMS('p int(10) const', 'q int(10) const', 'x : x', 'dsply %char(p + q);')), ['0']);
});
