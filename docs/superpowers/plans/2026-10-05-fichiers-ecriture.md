# Fichiers natifs — écriture : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exécuter `WRITE`, `UPDATE`, `DELETE` (courant et par clé) et `UNLOCK` sur les fichiers natifs simulés, avec `USAGE` complète, clés uniques (statut 01021), enregistrement courant (statut 01221) et verrous, comme sur IBM i.

**Architecture:** `NativeFile` (src/files.ts) gagne l'enregistrement courant, les opérations d'écriture (qui renvoient un motif d'échec au lieu de lever une erreur RPG), le contrôle d'unicité sur les clés de la table et un registre de verrous partagé par table ; le parser analyse `USAGE` et les nouvelles opérations ; l'interpréteur construit l'enregistrement depuis les zones, contrôle format et `USAGE`, traduit les échecs en statuts et libère les verrous ; le moteur SQL refuse de modifier un enregistrement verrouillé.

**Tech Stack:** TypeScript 5 (strict, ES2020, CommonJS), tests `node:test` sur le JS compilé dans `out/`.

**Spec:** `docs/superpowers/specs/2026-10-05-fichiers-natifs-design.md` (section « Incrément 2 — Écriture »).

## Global Constraints

- Branche `feat/fichiers-ecriture` ; fusion dans `main` uniquement quand l'utilisateur dit « fusionne ».
- Ne jamais committer `skills/` ni `fichiers_test/tstpgm.rpgle` : toujours `git add` fichier par fichier. Le README est suivi sous le nom `readme.md`.
- Incertain / non supporté : `NotSupportedError` (src/errors.ts). Erreur de compilation : `incompatibleTypes` ou erreur d'analyse avec la ligne.
- Statuts : `RpgError(1221, '… (RNX1221)')` pour `UPDATE`/`DELETE` sans enregistrement courant ; `RpgError(1021, '… (RNX1021)')` pour un doublon de clé unique.
- Valeurs écrites dans les données : nombre, texte sans blancs de fin, date/heure/timestamp en texte ISO, indicateur `'1'`/`'0'`.
- Toute modification native des données incrémente `table.revision` ; une suppression positionne `table.deletedRows = true` (comme le SQL).
- Commandes : un fichier = `npm run compile && node --test test/<fichier>.test.js` ; tout = `npm test` (431 tests au départ).
- Messages de commit en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Fins de ligne CRLF/LF mélangées : préserver celles de chaque fichier ; pas de `sed -i`.

## Review Focus

1. Une boucle `READ` / `UPDATE` qui ne change pas la clé doit relire chaque enregistrement une seule fois → test tâche 3.
2. Un `UPDATE` qui échoue (doublon) ne doit rien modifier et garder l'enregistrement courant → tests tâches 1 et 3.
3. Un `DELETE` de l'enregistrement courant suivi d'un `READ` lit le suivant, sans saut ni répétition → tests tâches 1 et 3.
4. Un programme appelé qui se termine libère ses verrous → test tâche 3.
5. Une zone `date` ou `char` écrite par `WRITE` est relue identique, natif et SQL → test tâche 3.

---

### Task 1: `NativeFile` — enregistrement courant, écriture, unicité, verrous

**Files:**
- Modify: `src/files.ts`
- Test: `test/files-core.test.js` (ajouts)

**Interfaces:**
- Consumes: `NativeFile` existant (constructeur `(name, format, fields, keys, source, options)`), `NotSupportedError`.
- Produces:
  - options du constructeur, en plus de `rowsDeleted` et `revision` : `updatable?: boolean` (les lectures réussies verrouillent et deviennent l'enregistrement courant), `uniqueKeys?: string[]` (clés de la table si `"unique"`, contrôlées même sans accès par clé), `locks?: WeakMap<object, NativeFile>` (registre partagé par table).
  - `write(values: { [zone: string]: any }): { failure?: 'duplicate' }` — ajoute un objet `{ ZONE: valeur }` en fin du tableau source courant ; ne change ni la position ni l'enregistrement courant.
  - `update(values): { failure?: 'noCurrent' | 'duplicate' }` — copie les valeurs dans l'enregistrement courant (en conservant la casse des colonnes existantes) ; succès : plus d'enregistrement courant, verrou libéré, position inchangée ; doublon : rien n'est modifié, l'enregistrement courant reste.
  - `delete(): { failure?: 'noCurrent' }` — retire l'enregistrement courant du tableau source (`splice`), verrou libéré, plus d'enregistrement courant ; le `READ` suivant lit l'enregistrement qui suivait.
  - `deleteByKey(key: any[]): { found: boolean }` — retire le premier enregistrement de cette clé (ordre des clés) ; ne change ni la position ni l'enregistrement courant (sauf s'il s'agit de lui : il n'est alors plus courant et son verrou est libéré).
  - `unlock(): void` — plus d'enregistrement courant, verrou libéré.
  - `release(): void` — libère tous les verrous tenus par ce fichier (fermeture, fin de programme).
  - Lectures (`read`, `readp`, `reade`, `readpe`, `chain`, `chainRrn`) d'un fichier `updatable` : avant de rendre un enregistrement, s'il est verrouillé par **un autre** `NativeFile` du registre → `NotSupportedError` (« enregistrement verrouillé par un autre programme ») ; sinon libère l'éventuel verrou précédent, verrouille et rend l'enregistrement courant. Une lecture en échec (EOF, non trouvé) : plus d'enregistrement courant, verrou libéré. Fichier non `updatable` : aucun verrou.
  - Lecture séquentielle (`read`, `readp`, `reade`, `readpe`) alors que la clé (accès par clé) de l'enregistrement sur lequel le fichier est positionné a changé depuis sa lecture, et que cet enregistrement existe encore → `NotSupportedError` (« clé de l'enregistrement courant modifiée »).

- [ ] **Step 1: Write the failing tests** — ajouter à la fin de `test/files-core.test.js` :

```js
// --- Incrément 2 : écriture ---

const WF = [{ name: 'NUMCLI', type: t('packed', 7, 0) }, { name: 'NOM', type: t('char', 10) }];
const wrows = () => [{ NUMCLI: 1, NOM: 'A' }, { NUMCLI: 2, NOM: 'B' }, { NUMCLI: 3, NOM: 'C' }];
const wopen = (rows, options = {}) => new f.NativeFile('CL', 'CLF', WF, ['NUMCLI'], rows, { updatable: true, ...options });

test('WRITE ajoute sans déplacer la position', () => {
  const rows = wrows();
  const file = wopen(rows);
  assert.equal(file.read().record.NOM, 'A');
  assert.deepEqual(file.write({ NUMCLI: 0, NOM: 'Z' }), {});
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[3], { NUMCLI: 0, NOM: 'Z' });
  assert.equal(file.read().record.NOM, 'B');
});

test('UPDATE réécrit l\'enregistrement courant, une seule fois', () => {
  const rows = wrows();
  const file = wopen(rows);
  assert.equal(file.update({ NUMCLI: 2, NOM: 'X' }).failure, 'noCurrent');
  file.chain([2]);
  assert.deepEqual(file.update({ NUMCLI: 2, NOM: 'X' }), {});
  assert.equal(rows[1].NOM, 'X');
  assert.equal(file.update({ NUMCLI: 2, NOM: 'Y' }).failure, 'noCurrent');
  assert.equal(file.read().record.NOM, 'C');
  file.read();
  assert.equal(file.update({ NUMCLI: 3, NOM: 'Y' }).failure, 'noCurrent'); // lecture en échec (EOF)
});

test('DELETE courant puis READ ; DELETE par clé', () => {
  const rows = wrows();
  const file = wopen(rows);
  file.read();
  file.read();
  assert.deepEqual(file.delete(), {});
  assert.deepEqual(rows.map(r => r.NOM), ['A', 'C']);
  assert.equal(file.delete().failure, 'noCurrent');
  assert.equal(file.read().record.NOM, 'C');
  assert.equal(file.deleteByKey([1]).found, true);
  assert.equal(file.deleteByKey([9]).found, false);
  assert.deepEqual(rows.map(r => r.NOM), ['C']);
});

test('UNLOCK retire l\'enregistrement courant', () => {
  const file = wopen(wrows());
  file.chain([1]);
  file.unlock();
  assert.equal(file.update({ NUMCLI: 1, NOM: 'X' }).failure, 'noCurrent');
});

test('clés uniques contrôlées même sans accès par clé', () => {
  const rows = wrows();
  const file = new f.NativeFile('CL', 'CLF', WF, [], rows, { updatable: true, uniqueKeys: ['NUMCLI'] });
  assert.equal(file.write({ NUMCLI: 2, NOM: 'D' }).failure, 'duplicate');
  assert.equal(rows.length, 3);
  assert.equal(file.read().record.NOM, 'A');
  assert.equal(file.update({ NUMCLI: 3, NOM: 'A' }).failure, 'duplicate');
  assert.equal(rows[0].NUMCLI, 1);
  assert.deepEqual(file.update({ NUMCLI: 1, NOM: 'AA' }), {});
  assert.deepEqual(file.write({ NUMCLI: 4, NOM: 'D' }), {});
  assert.equal(rows.length, 4);
});

test('verrous : une autre ouverture ne lit pas pour mise à jour un enregistrement tenu', () => {
  const rows = wrows();
  const locks = new WeakMap();
  const a = wopen(rows, { locks });
  const b = wopen(rows, { locks });
  a.chain([2]);
  assert.throws(() => b.chain([2]), NOT_SUPPORTED);
  assert.equal(b.chain([1]).record.NOM, 'A');
  a.unlock();
  assert.equal(b.chain([2]).record.NOM, 'B');
  const lecture = new f.NativeFile('CL', 'CLF', WF, ['NUMCLI'], rows, { locks });
  assert.equal(lecture.chain([2]).record.NOM, 'B');
  b.release();
  assert.equal(a.chain([2]).found, true);
});

test('clé de l\'enregistrement courant modifiée : lecture séquentielle refusée', () => {
  const rows = wrows();
  const file = wopen(rows);
  file.read();
  file.update({ NUMCLI: 7, NOM: 'A' });
  assert.throws(() => file.read(), NOT_SUPPORTED);
  file.setll('start');
  assert.equal(file.read().record.NOM, 'B');
  rows[1].NUMCLI = 9; // comme un UPDATE SQL de la clé
  assert.throws(() => file.read(), NOT_SUPPORTED);
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npm run compile && node --test test/files-core.test.js` → FAIL (`file.write is not a function`…).

- [ ] **Step 3: Implement** in `src/files.ts` (lire d'abord le fichier : curseur `{ side: 'on' | 'before' | 'after', at }`, `lost`, `eofReached`, cache `sorted`/`revision`, `observe()`, `seen`, `arrays`, `dataKey`, `programKey`, `searchKey`, `readOn()`) :
  - champs privés : `current?: { row: object; key: any[] }` (`key` = tuple d'accès au moment de la lecture), options `updatable`, `uniqueKeys`, `locks`.
  - fonction privée `take(row)` appelée par chaque lecture réussie : si `updatable` → contrôle du registre (`locks.get(row)` défini et différent de `this` → `NotSupportedError`), libération du verrou précédent, `locks.set(row, this)` ; `current = { row, key: tuple(row) }` (même si non `updatable`, pour la détection de clé modifiée). Lecture en échec : `current` effacé et verrou libéré.
  - détection « clé modifiée » : au début de `read`/`readp`/`reade`/`readpe`, si le curseur est `on` un enregistrement mémorisé (`current` ou le dernier rendu) **encore présent** dans la source et dont le tuple actuel diffère de celui mémorisé → `NotSupportedError`. Conserver une référence au dernier enregistrement rendu même après `update`/`unlock` (la position reste sur lui).
  - `write` : unicité (si `uniqueKeys`) = aucune ligne avec les mêmes valeurs normalisées (`dataKey`) sur ces zones ; push dans le tableau source actuel ; invalider le cache (`sorted = undefined`).
  - `update` : sans `current` → `noCurrent` ; unicité sur les nouvelles valeurs en excluant la ligne courante → `duplicate` ; sinon copie des valeurs (colonne existante de même nom en majuscules, sinon nouvelle colonne), cache invalidé, `current` effacé, verrou libéré.
  - `delete` : sans `current` → `noCurrent` ; `splice` dans le tableau source actuel ; cache invalidé ; verrou libéré ; `current` effacé.
  - `deleteByKey` : premier enregistrement (ordre des clés) de prefix égal ; `splice` ; si c'était `current`, l'effacer et libérer le verrou.
  - `unlock`, `release` comme décrits ; `reset()` libère aussi (fermeture).

- [ ] **Step 4: Run tests** — `npm run compile && node --test test/files-core.test.js` puis `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/files.ts test/files-core.test.js
git commit -m "Fichiers natifs : enregistrement courant, écriture, clés uniques et verrous (module)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `USAGE`, `"unique"` et analyse des opérations d'écriture

**Files:**
- Modify: `src/context.ts`, `src/types.ts`, `src/lexer.ts` (si besoin), `src/parser.ts`
- Test: `test/context.test.js`, `test/unsupported.test.js`, `test/parser.test.js`

**Interfaces:**
- Produces:
  - `TableDefinition.unique?: boolean`.
  - `FileDeclarationNode.usage: { input: boolean; output: boolean; update: boolean; delete: boolean }` (implications appliquées : `*UPDATE` ⇒ input ; `*DELETE` ⇒ input + update ; défaut `*INPUT`).
  - `FileOperationNode.operation` étendu à `'write' | 'update' | 'delete' | 'unlock'` ; pour `write`/`update`/`delete`, `file` = nom écrit (format attendu, vérifié à l'exécution) ; `delete` peut avoir `key` (liste) ; `unlock` : `file` = nom de fichier déclaré (vérifié à l'analyse).

- [ ] **Step 1: Write the failing tests**

`test/context.test.js` :

```js
test('tables.json : option unique', () => {
  const ok = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "int(10)" }, "keys": ["a"], "unique": true, "data": [] } }' });
  assert.equal(loadContextFromFolder(ok).tables.T.unique, true);
  const bad = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "int(10)" }, "keys": ["a"], "unique": "oui", "data": [] } }' });
  assert.throws(() => loadContextFromFolder(bad), /"unique" doit être vrai ou faux/);
});
```

`test/unsupported.test.js` — lire le fichier ; retirer `'dcl-f client usage(*update);'` et `'dcl-f client usage(*input:*output);'` de la liste des DCL-F refusés, et les trois cas `write clientf;`, `update clientf;`, `delete clientf;` du test « opérations de fichier non supportées refusées » ; ajouter :

```js
test('USAGE : combinaisons acceptées à l\'analyse', () => {
  assert.doesNotThrow(() => parse(`
    dcl-f a usage(*output);
    dcl-f b usage(*update);
    dcl-f c usage(*update : *delete : *output) keyed;
    dcl-f d usage(*input : *output);
    dcl-f e usage(*delete);
    write af;
    read b; update bf; unlock b;
    chain 1 c; delete cf; delete (1) cf; delete 2 cf; write cf;
    read e; delete ef;
  `));
});

test('lecture sur un fichier en sortie seule : erreur d\'analyse', () => {
  assert.throws(() => parse(`dcl-f a usage(*output); read a;`), /A.*sortie/i);
  assert.throws(() => parse(`dcl-f a usage(*output) keyed; chain 1 a;`), /A.*sortie/i);
  assert.throws(() => parse(`dcl-f a usage(*output); unlock zz;`), /ZZ.*non déclaré/i);
});

test('écriture : constructions non supportées refusées', () => {
  for (const src of [
    'dcl-f b usage(*update); read b; update bf %fields(nom);',
    'dcl-f b usage(*update); read b; update bf ds;',
    'dcl-f a usage(*output); write af ds;',
    'dcl-f a usage(*output); write(e) af;',
    'dcl-f b usage(*update); read(n) b;',
    'dcl-f a usage(*output : *xyz);',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npm run compile && node --test test/context.test.js test/unsupported.test.js`.

- [ ] **Step 3: Implement**
  - `src/context.ts` : `unique` optionnel ; présent et non booléen → `Error("Table 'T' de <chemin> : \"unique\" doit être vrai ou faux")`.
  - `src/parser.ts` : `USAGE(…)` accepte `*INPUT`, `*OUTPUT`, `*UPDATE`, `*DELETE` (séparés par `:`), autre valeur → `unsupported('USAGE(*XYZ) de DCL-F')` ; implications. Lecture (`READ`, `READP`, `READE`, `READPE`, `CHAIN`, `SETLL`, `SETGT`) sur un fichier sans `input` → erreur d'analyse `Fichier A ouvert en sortie seule : READ impossible (ligne n)`. `WRITE nom`, `UPDATE nom`, `DELETE [clé] nom`, `UNLOCK fichier` : `UNLOCK` exige un fichier déclaré ; `WRITE`/`UPDATE` avec un 2e opérande (DS) ou `%FIELDS` → `unsupported` ; extenseurs (parenthèse collée) → `unsupported` (règle existante) ; `READ(N)` → `unsupported`. Les mots `write`, `update`, `delete`, `unlock` restent utilisables comme noms (règle `isNameUse` existante) et `exec sql update/delete` n'est pas affecté.

- [ ] **Step 4: Run tests** — `npm run compile && node --test test/context.test.js test/unsupported.test.js test/parser.test.js` puis `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/context.ts src/types.ts src/lexer.ts src/parser.ts test/context.test.js test/unsupported.test.js test/parser.test.js
git commit -m "Fichiers natifs : USAGE, option unique et analyse de WRITE, UPDATE, DELETE, UNLOCK" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Exécution de l'écriture, statuts, verrous, SQL, README

**Files:**
- Modify: `src/interpreter.ts`, `src/sql-engine.ts`, `src/context.ts` (champ d'exécution `locks`), `readme.md`
- Test: `test/files.test.js` (ajouts)

**Interfaces:**
- Consumes: tâches 1 et 2.
- Produces: `TableDefinition.locks?: WeakMap<object, unknown>` (registre partagé, créé à la première ouverture).

- [ ] **Step 1: Write the failing tests** — ajouter à `test/files.test.js` :

```js
// --- Incrément 2 : écriture ---

function wctx() {
  return {
    programs: {},
    tables: {
      CLIENT: {
        format: 'CLIENTF', keys: ['NUMCLI'], unique: true,
        columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'NOM', type: 'char(10)' },
                  { name: 'SOLDE', type: 'packed(9:2)' }, { name: 'CREE', type: 'date' }],
        data: [
          { NUMCLI: 1, NOM: 'Dupont', SOLDE: 100, CREE: '2025-01-15' },
          { NUMCLI: 2, NOM: 'Martin', SOLDE: 50, CREE: '2024-12-31' },
        ],
      },
    },
  };
}

test('boucle READ / UPDATE puis relecture', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*update) keyed;
    read client;
    dow not %eof(client);
      solde += 10;
      update clientf;
      read client;
    enddo;
    setll *start client;
    read client;
    dow not %eof(client);
      dsply %trim(nom) + ' ' + %char(solde);
      read client;
    enddo;
  `, c);
  assert.deepEqual(out, ['Dupont 110.00', 'Martin 60.00']);
  assert.equal(c.tables.CLIENT.data[0].SOLDE, 110);
});

test('WRITE puis relecture native et SQL', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*input : *output) keyed;
    dcl-s n packed(9:2);
    numcli = 3;
    nom = 'Durand';
    solde = 5;
    cree = D'2026-10-05';
    write clientf;
    clear_zones();
    chain 3 client;
    dsply %trim(nom) + ' ' + %char(cree);
    exec sql select solde into :n from client where numcli = 3;
    dsply %char(n);
    dcl-proc clear_zones;
      nom = *blanks;
      cree = D'0001-01-01';
    end-proc;
  `, c);
  assert.deepEqual(out, ['Durand 2026-10-05', '5.00']);
  assert.deepEqual(c.tables.CLIENT.data[2], { NUMCLI: 3, NOM: 'Durand', SOLDE: 5, CREE: '2026-10-05' });
});

test('DELETE courant, DELETE par clé, %FOUND', () => {
  const c = wctx();
  const out = run(`
    dcl-f client usage(*delete) keyed;
    chain 1 client;
    delete clientf;
    delete 9 clientf;
    if not %found(client);
      dsply 'absent';
    endif;
    read client;
    dsply nom;
  `, c);
  assert.deepEqual(out, ['absent', 'Martin']);
  assert.equal(c.tables.CLIENT.data.length, 1);
});

test('statuts 01221 et 01021 interceptés', () => {
  const out = run(`
    dcl-f client usage(*update : *output) keyed;
    monitor;
      update clientf;
    on-error 01221;
      dsply 'pas de lecture ' + %char(%status);
    endmon;
    numcli = 2;
    nom = 'Doublon';
    monitor;
      write clientf;
    on-error 01021;
      dsply 'doublon ' + %char(%status);
    endmon;
    chain 1 client;
    update clientf;
    monitor;
      update clientf;
    on-error 01221;
      dsply 'deja mis a jour';
    endmon;
  `, wctx());
  assert.deepEqual(out, ['pas de lecture 1221', 'doublon 1021', 'deja mis a jour']);
});

test('format, USAGE et clé modifiée : erreurs', () => {
  assert.throws(() => run(`dcl-f client usage(*output); write client;`, wctx()), /format CLIENTF/i);
  assert.throws(() => run(`dcl-f client keyed; read client; update clientf;`, wctx()), /USAGE/i);
  assert.throws(() => run(`dcl-f client usage(*update) keyed; read client; delete clientf;`, wctx()), /USAGE/i);
  assert.throws(() => run(`dcl-f client keyed; write clientf;`, wctx()), /USAGE/i);
  assert.throws(() => run(`dcl-f client usage(*update) keyed; read client; numcli = 5; update clientf; read client;`, wctx()), NOT_SUPPORTED);
});

test('SQL sur un enregistrement verrouillé : pas encore supporté', () => {
  assert.throws(() => run(`
    dcl-f client usage(*update) keyed;
    chain 1 client;
    exec sql update client set solde = 0 where numcli = 1;
  `, wctx()), NOT_SUPPORTED);
  const c = wctx();
  run(`dcl-f client keyed; chain 1 client; exec sql update client set solde = 0 where numcli = 1;`, c);
  assert.equal(c.tables.CLIENT.data[0].SOLDE, 0);
});

test('deux programmes et un enregistrement verrouillé', () => {
  const callee = `dcl-f client usage(*update) keyed; chain 1 client; dsply 'lu';`;
  const options = { resolveProgram: name => (name === 'AUTRE' ? { source: callee } : undefined) };
  assert.throws(() => run(`
    dcl-pr autre extpgm('AUTRE') end-pr;
    dcl-f client usage(*update) keyed;
    chain 1 client;
    autre();
  `, wctx(), options), NOT_SUPPORTED);
  const out = run(`
    dcl-pr autre extpgm('AUTRE') end-pr;
    dcl-f client usage(*update) keyed;
    chain 1 client;
    unlock client;
    autre();
    autre();
    chain 1 client;
    dsply 'appelant';
  `, wctx(), options);
  assert.deepEqual(out, ['lu', 'lu', 'appelant']);
});
```

(Le dernier test vérifie aussi qu'un programme appelé qui se termine libère ses verrous : le second `autre()` et le `chain` final réussissent.)

- [ ] **Step 2: Run tests to verify they fail** — `npm run compile && node --test test/files.test.js`.

- [ ] **Step 3: Implement**
  - `src/context.ts` : champ d'exécution `locks?: WeakMap<object, unknown>` dans `TableDefinition` (non chargé depuis JSON, comme `revision`).
  - `src/interpreter.ts` (déclaration des fichiers) : créer `table.locks` s'il n'existe pas ; passer au `NativeFile` les options `updatable: usage.update || usage.delete`, `uniqueKeys: table.unique ? table.keys : undefined`, `locks: table.locks` ; mémoriser la `usage` et le format dans l'état du fichier.
  - Exécution de `write`/`update`/`delete` : retrouver l'état par **format** ; si le nom désigne un fichier (et pas son format) → `Error("WRITE attend le nom du format CLIENTF du fichier CLIENT")` ; `USAGE` insuffisante → `Error("Le fichier CLIENT n'est pas déclaré avec USAGE(*OUTPUT) : WRITE impossible")` (resp. `*UPDATE`, `*DELETE`) ; fichier fermé → statut 1211 (règle existante). Construire les valeurs depuis les zones globales du fichier : nombre tel quel, texte sans blancs de fin, date/heure/timestamp → `String(valeur)` (ISO), indicateur → `'1'`/`'0'`. Appeler `NativeFile` ; `noCurrent` → `RpgError(1221, "UPDATE de CLIENTF sans enregistrement lu (RNX1221)")` ; `duplicate` → `RpgError(1021, "Clé en double dans le fichier CLIENT (RNX1021)")` ; succès → `table.revision++`, et pour une suppression `table.deletedRows = true`. `delete clé` met à jour `%FOUND` du fichier et la dernière valeur de `%FOUND`.
  - `unlock` : `file.unlock()`. `close` : `file.release()` en plus de la remise à zéro existante. Fin de `runProgram` (bloc `finally`) : `release()` de tous les fichiers du programme.
  - `src/sql-engine.ts` : dans `UPDATE` et `DELETE`, avant toute modification, si une ligne visée a `table.locks?.has(ligne)` → `NotSupportedError("UPDATE SQL d'un enregistrement verrouillé par une lecture native")` (resp. DELETE).
  - `readme.md`, section « Fichiers natifs » : `USAGE` et implications, `WRITE`/`UPDATE`/`DELETE`/`UNLOCK` (format obligatoire), option `"unique"`, statuts 01221 et 01021, verrous (et refus d'un enregistrement tenu par un autre programme ou modifié par le SQL), refus de la lecture séquentielle après changement de clé ; « Limites connues » : retirer « lecture seulement », garder « pas d'écrans ni d'impressions » et ajouter « `%FIELDS`, écriture depuis une DS, extenseurs `(E)`/`(N)` : pas encore ».

- [ ] **Step 4: Run tests** — `npm run compile && node --test test/files.test.js` puis `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/interpreter.ts src/sql-engine.ts src/context.ts readme.md test/files.test.js
git commit -m "Fichiers natifs : exécution de WRITE, UPDATE, DELETE, UNLOCK, statuts 01221/01021, verrous" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Vérification finale

- [ ] `npm test` : tout vert.
- [ ] `git status --short` : seuls `fichiers_test/tstpgm.rpgle` (modifié) et `skills/` (non suivi) hors commit.
- [ ] Ne pas fusionner : attendre « fusionne ».
