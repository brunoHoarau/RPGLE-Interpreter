# Fichiers natifs — compléments 3a : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter `RENAME`, `PREFIX`, `EXTFILE`/`EXTDESC`, `READE`/`READPE` sans clé et les extenseurs `(N)` et `(E)` (avec `%ERROR`) aux fichiers natifs, comme sur IBM i.

**Architecture:** Le parser enrichit `FileDeclarationNode` et `FileOperationNode` ; `NativeFile` sait relire avec la clé du dernier enregistrement et lire sans verrou ; l'interpréteur résout tables de description et de données, renomme le format, établit la correspondance zone → variable préfixée, et enveloppe les opérations `(E)`.

**Tech Stack:** TypeScript 5 (strict, ES2020, CommonJS), tests `node:test` sur le JS compilé dans `out/`.

**Spec:** `docs/superpowers/specs/2026-10-05-fichiers-natifs-design.md` (section « Incrément 3a »).

## Global Constraints

- Branche `feat/fichiers-complements` ; fusion seulement sur « fusionne ».
- Ne jamais committer `skills/` ni `fichiers_test/tstpgm.rpgle` ; `git add` fichier par fichier ; README = `readme.md`.
- Incertain / non supporté : `NotSupportedError` ; erreur de compilation : erreur d'analyse ou `incompatibleTypes`.
- `(E)` n'intercepte que les `RpgError` des opérations de fichier ; `NotSupportedError` et erreurs de données traversent.
- Commandes : `npm run compile && node --test test/<fichier>.test.js` ; tout : `npm test` (468 au départ).
- Commits en français terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Fins de ligne mélangées : préserver ; pas de `sed -i`.

## Review Focus

1. `PREFIX` appliqué partout où une zone devient variable : lecture, écriture, mise à jour, programme appelé → tests tâche 3.
2. Un `RENAME` doit être pris en compte par le contrôle avant exécution des écritures (l'ancien format refusé avant toute exécution) → test tâche 3.
3. `(E)` remet `%ERROR` à `*OFF` après une opération réussie ; une opération sans `(E)` ne le change pas → test tâche 3.
4. `READE` sans clé après un `READ(N)` (lecture sans verrou) fonctionne → test tâche 2.
5. `CALLP(E)` (extenseur hors fichiers) ne doit pas être ignoré en silence → test tâche 1.

---

### Task 1: Analyse — mots-clés de `DCL-F`, extenseurs, `READE` sans clé, `%ERROR`

**Files:** `src/types.ts`, `src/parser.ts`, `src/builtins.ts` ; tests `test/unsupported.test.js`, `test/parser.test.js`.

**Interfaces (Produces):**
- `FileDeclarationNode` : `rename?: { from: string; to: string }` (majuscules), `prefix?: { text: string; count?: number }` (texte en majuscules, sans apostrophes), `extfile?: string` (nom de table en majuscules, bibliothèque retirée, ou `'*EXTDESC'`), `extdesc?: string` (idem).
- `FileOperationNode.extender?: { error: boolean; noLock: boolean }`.
- `READE f` / `READPE f` sans clé : `key` absent et `lastKey: true`.
- `%ERROR` : fonction sans argument (avec ou sans parenthèses) ; l'interpréteur la traite (tâche 3).

- [ ] **Step 1: Write the failing tests** — `test/unsupported.test.js` (lire le fichier ; retirer de ses listes `prefix(c_)`, `rename(clientf:r)`, `extfile('LIB/CLIENT')` des DCL-F refusés, `reade client;`/`readpe client;` et `read(e) client;` des opérations refusées, en adaptant les tests existants) puis ajouter :

```js
test('3a : DCL-F RENAME, PREFIX, EXTFILE, EXTDESC acceptés à l\'analyse', () => {
  assert.doesNotThrow(() => parse(`
    dcl-f film rename(film:ffilm) keyed;
    dcl-f client prefix(c_) keyed;
    dcl-f cli2 prefix('X':2) extfile('MABIB/CLIENT') extdesc('CLIENT');
    dcl-f cli3 extdesc('MABIB/CLIENT') extfile(*extdesc) usage(*update) keyed;
    read ffilm;
    read(e) client;
    chain(n) 1 client;
    chain(en) 1 cli3;
    reade client;
    readpe(ne) client;
    update(e) cli3f;
    if %error or %error();
    endif;
  `));
});

test('3a : refus', () => {
  for (const src of [
    'dcl-s nomvar char(10); dcl-f client extfile(nomvar);',
    'dcl-f client keyed; read(x) client;',
    'dcl-f client keyed; read(h) client;',
    'dcl-f client rename(clientf);',
    'callp(e) p();',
    'dcl-proc p; end-proc; callp(e) p();',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});
```

`test/parser.test.js` : un test qui vérifie la forme AST de `dcl-f cli2 prefix('X':2) extfile('MABIB/CLIENT') extdesc('CLIENT');` (`prefix: { text: 'X', count: 2 }`, `extfile: 'CLIENT'`, `extdesc: 'CLIENT'`), de `reade client;` (`lastKey: true`) et de `chain(en) 1 cli3;` (`extender: { error: true, noLock: true }`).

- [ ] **Step 2: RED** — `npm run compile && node --test test/unsupported.test.js test/parser.test.js`.
- [ ] **Step 3: Implement** — dans `parser.ts` (DCL-F) : `RENAME(a:b)` (deux noms obligatoires), `PREFIX(nom | 'texte' [: n])`, `EXTFILE('…' | *EXTDESC)` (autre forme → `unsupported('EXTFILE(variable)')`), `EXTDESC('…')`. Opérations de fichier : la parenthèse collée lit des lettres d'extenseur ; `E` et `N` (dans n'importe quel ordre, une fois chacune) sont acceptés, `N` seulement sur les lectures (`READ`, `READP`, `READE`, `READPE`, `CHAIN`) ; toute autre lettre → `unsupported("L'extenseur (X) de OP")`. `READE`/`READPE` avec un seul opérande → `lastKey: true`. `%ERROR` : sans argument, accepté sans parenthèses (comme `%STATUS`). `CALLP(…)` avec une parenthèse d'extenseur → `unsupported("L'extenseur (E) de CALLP")` (aujourd'hui ignoré en silence).
- [ ] **Step 4: GREEN** — mêmes commandes puis `npm test`.
- [ ] **Step 5: Commit** — `git add src/types.ts src/parser.ts src/builtins.ts test/unsupported.test.js test/parser.test.js` ; message « Fichiers natifs 3a : analyse de RENAME, PREFIX, EXTFILE, EXTDESC, extenseurs E/N et READE sans clé ».

---

### Task 2: `NativeFile` — clé du dernier enregistrement, lecture sans verrou

**Files:** `src/files.ts` ; test `test/files-core.test.js`.

**Interfaces (Produces):**
- `reade(key: any[] | 'last', options?: { noLock?: boolean })`, `readpe(key: any[] | 'last', options?)` : `'last'` = clé d'accès complète du dernier enregistrement rendu ; aucun enregistrement rendu (ou dernière lecture en échec) → `NotSupportedError` (« READE sans clé sans lecture préalable »).
- `read(options?)`, `readp(options?)`, `chain(key, options?)`, `chainRrn(n, options?)` : `{ noLock: true }` → aucune prise de verrou, aucun enregistrement courant (le dernier enregistrement rendu, lui, est mémorisé pour la position et pour `'last'`).

- [ ] **Step 1: Write the failing tests** — ajouter à `test/files-core.test.js` :

```js
// --- Incrément 3a ---

test('READE sans clé : clé complète du dernier enregistrement lu', () => {
  const F3 = [{ name: 'NUMCLI', type: t('packed', 7, 0) }, { name: 'LIB', type: t('char', 5) }];
  const rows = [{ NUMCLI: 1, LIB: 'a' }, { NUMCLI: 1, LIB: 'b' }, { NUMCLI: 2, LIB: 'c' }];
  const file = new f.NativeFile('CDE', 'CDEF', F3, ['NUMCLI'], rows);
  assert.throws(() => file.reade('last'), NOT_SUPPORTED);
  assert.equal(file.chain([1]).record.LIB, 'a');
  assert.equal(file.reade('last').record.LIB, 'b');
  assert.equal(file.reade('last').eof, true);
  file.setll('end');
  assert.equal(file.readp().record.LIB, 'c');
  assert.equal(file.readpe('last').eof, true);
});

test('lecture sans verrou : pas d\'enregistrement courant, pas de verrou', () => {
  const rows = wrows();
  const locks = new WeakMap();
  const a = wopen(rows, { locks });
  const b = wopen(rows, { locks });
  assert.equal(a.chain([2], { noLock: true }).record.NOM, 'B');
  assert.equal(a.update({ NUMCLI: 2, NOM: 'X' }).failure, 'noCurrent');
  assert.equal(b.chain([2]).record.NOM, 'B');
  assert.equal(a.read({ noLock: true }).record.NOM, 'C');
  assert.equal(a.reade('last', { noLock: true }).eof, true);
});
```

(`wrows`, `wopen`, `t`, `f`, `NOT_SUPPORTED` existent déjà dans le fichier.)

- [ ] **Step 2: RED** — `npm run compile && node --test test/files-core.test.js`.
- [ ] **Step 3: Implement** in `src/files.ts` (lire d'abord `take`, `drop`, `readOn`, `reade`, `readpe`, `searchKey`).
- [ ] **Step 4: GREEN** — puis `npm test`.
- [ ] **Step 5: Commit** — `git add src/files.ts test/files-core.test.js` ; « Fichiers natifs 3a : READE sans clé et lecture sans verrou (module) ».

---

### Task 3: Exécution — tables, `RENAME`, `PREFIX`, extenseurs, `%ERROR`, README

**Files:** `src/interpreter.ts`, `readme.md` ; test `test/files.test.js`.

**Interfaces (Consumes):** tâches 1 et 2.

- [ ] **Step 1: Write the failing tests** — ajouter à `test/files.test.js` :

```js
// --- Incrément 3a ---

function ctx3() {
  const clientCols = [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'CLNOM', type: 'char(10)' }];
  return {
    programs: {},
    tables: {
      FILM: { format: 'FILM', keys: ['ID'], columns: [{ name: 'ID', type: 'packed(5:0)' }, { name: 'TITRE', type: 'char(20)' }],
              data: [{ ID: 2, TITRE: 'Brazil' }, { ID: 1, TITRE: 'Alien' }] },
      CLIENT: { format: 'CLIENTF', keys: ['NUMCLI'], unique: true, columns: clientCols,
                data: [{ NUMCLI: 1, CLNOM: 'Dupont' }, { NUMCLI: 2, CLNOM: 'Martin' }] },
      ARCHIVE: { format: 'CLIENTF', keys: ['NUMCLI'], columns: clientCols, data: [{ NUMCLI: 7, CLNOM: 'Ancien' }] },
      AUTRE: { keys: ['X'], columns: [{ name: 'X', type: 'int(10)' }], data: [] },
      CDE: { keys: ['NUMCLI'], columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'LIB', type: 'char(5)' }],
             data: [{ NUMCLI: 1, LIB: 'a' }, { NUMCLI: 1, LIB: 'b' }, { NUMCLI: 2, LIB: 'c' }] },
    },
  };
}

test('RENAME : lecture par le nouveau format', () => {
  assert.deepEqual(run(`dcl-f film rename(film:ffilm) keyed; read ffilm; dsply titre;`, ctx3()), ['Alien']);
});

test('RENAME : WRITE sur le nouveau nom, ancien refusé avant exécution, premier argument contrôlé', () => {
  const c = ctx3();
  run(`dcl-f client rename(clientf:rcli) usage(*output); numcli = 9; clnom = 'Neuf'; write rcli;`, c);
  assert.equal(c.tables.CLIENT.data.length, 3);
  assert.throws(() => run(`dcl-f client rename(clientf:rcli) usage(*output); dsply 'avant'; write clientf;`, ctx3()), /CLIENTF/);
  assert.throws(() => run(`dcl-f client rename(autre:rcli);`, ctx3()), /AUTRE.*format/i);
});

test('PREFIX : zones préfixées en lecture et en écriture', () => {
  const c = ctx3();
  const out = run(`
    dcl-f client prefix(c_) usage(*update) keyed;
    chain 1 client;
    dsply c_clnom;
    c_clnom = 'Modifie';
    update clientf;
  `, c);
  assert.deepEqual(out, ['Dupont']);
  assert.equal(c.tables.CLIENT.data[0].CLNOM, 'Modifie');
  assert.deepEqual(run(`dcl-f client prefix('X':2) keyed; chain 2 client; dsply xnom;`, ctx3()), ['Martin']);
  assert.throws(() => run(`dcl-f client prefix(x:9) keyed;`, ctx3()), NOT_SUPPORTED);
});

test('EXTFILE et EXTDESC', () => {
  assert.deepEqual(run(`dcl-f client extfile('MABIB/ARCHIVE') keyed; read client; dsply clnom;`, ctx3()), ['Ancien']);
  assert.deepEqual(run(`dcl-f arch extdesc('CLIENT') extfile(*extdesc) keyed; read arch; dsply clnom;`, ctx3()), ['Dupont']);
  assert.throws(() => run(`dcl-f client extfile('AUTRE') keyed;`, ctx3()), /zones/i);
});

test('READE sans clé', () => {
  const out = run(`
    dcl-f cde keyed;
    chain 1 cde;
    dow not %eof(cde);
      dsply lib;
      reade cde;
    enddo;
  `, ctx3());
  assert.deepEqual(out, ['a', 'b']);
  assert.throws(() => run(`dcl-f cde keyed; reade cde;`, ctx3()), NOT_SUPPORTED);
});

test('READ(N) : pas d\'enregistrement courant', () => {
  const out = run(`
    dcl-f client usage(*update) keyed;
    read(n) client;
    monitor;
      update clientf;
    on-error 01221;
      dsply 'pas courant';
    endmon;
  `, ctx3());
  assert.deepEqual(out, ['pas courant']);
});

test('(E) et %ERROR', () => {
  const out = run(`
    dcl-f client usropn usage(*output : *input) keyed;
    chain(e) 1 client;
    if %error;
      dsply 'erreur ' + %char(%status);
    endif;
    open client;
    chain 1 client;
    if %error;
      dsply 'inchange';
    endif;
    chain(e) 1 client;
    if not %error and %found(client);
      dsply clnom;
    endif;
    numcli = 1;
    write(e) clientf;
    if %error;
      dsply 'doublon ' + %char(%status);
    endif;
  `, ctx3());
  assert.deepEqual(out, ['erreur 1211', 'inchange', 'Dupont', 'doublon 1021']);
});
```

- [ ] **Step 2: RED** — `npm run compile && node --test test/files.test.js`.
- [ ] **Step 3: Implement** in `src/interpreter.ts` (lire d'abord `declareFile`, l'état des fichiers par nom de fichier et de format, `copyRecord`, `recordValues`, `checkFileChanges`, l'exécution des `FileOperation`, `fileBuiltin`) :
  - Déclaration : table de description = `extdesc` ?? nom du fichier ; table de données = `extfile` (si `'*EXTDESC'` → table de description) ?? table de description ; tables absentes → erreur existante ; si les deux tables diffèrent, mêmes zones (noms et types texte, ordre indifférent) sinon `Error("Fichier CLIENT : les zones de AUTRE diffèrent de celles de CLIENT")`. Clés, format, unicité : de la description ; lignes, verrous, révision : de la table de données.
  - `RENAME` : `from` doit égaler le format de la description, sinon `Error("Fichier CLIENT : RENAME(AUTRE) ne désigne pas le format CLIENTF")` ; le format enregistré devient `to` (l'ancien n'est plus reconnu nulle part, y compris par `checkFileChanges`).
  - `PREFIX` : nom de variable = `text + nom.slice(count ?? 0)` ; `count` > longueur d'un nom de zone → `NotSupportedError` ; correspondance zone → variable utilisée par la déclaration des variables, `copyRecord`, `recordValues` et les contrôles de noms.
  - Extenseurs : `noLock` → passer `{ noLock: true }` aux lectures ; `lastKey` → `'last'`. `error` : exécuter l'opération dans un `try` ; une `RpgError` → `%ERROR` = vrai, `runtime.status` = statut, ligne `[JOBLOG]` comme `MONITOR` ; réussite → `%ERROR` = faux ; autres erreurs relancées. `%ERROR` (sans argument) renvoie la dernière valeur (faux au départ).
  - `readme.md` : section « Fichiers natifs » complétée (RENAME, PREFIX, EXTFILE/EXTDESC avec bibliothèque ignorée, READE/READPE sans clé, `(N)`, `(E)`/`%ERROR`), refus (`EXTFILE(variable)`, `PREFIX` trop long, `READE` sans clé ni lecture, `CALLP(E)`), « Limites connues » mises à jour.
- [ ] **Step 4: GREEN** — puis `npm test`.
- [ ] **Step 5: Commit** — `git add src/interpreter.ts readme.md test/files.test.js` ; « Fichiers natifs 3a : RENAME, PREFIX, EXTFILE/EXTDESC, extenseurs N et E, %ERROR ».

---

## Vérification finale

- [ ] `npm test` vert ; relancer la mesure (script `mesure3.js` du dossier temporaire) sur `skills/rpg-ile/scripts`.
- [ ] `git status --short` : seuls `fichiers_test/tstpgm.rpgle` et `skills/` hors commit.
- [ ] Ne pas fusionner avant « fusionne ».
