# Fichiers natifs — conception

Date : 2026-10-05 · Statut : validé en discussion, à relire

## Objectif

Exécuter les programmes RPGLE qui lisent et écrivent les fichiers base de données d'IBM i
(`DCL-F` disque, `READ`, `CHAIN`, `SETLL`, `WRITE`…) avec des données simulées, avec le même
comportement que sur IBM i. Livré en incréments, une branche par incrément, fusion sur demande.

Règle constante : ce qui n'est pas encore livré, ou dont la sémantique IBM i n'est pas vérifiée,
est **refusé explicitement** (« pas encore supporté par l'interpréteur »), jamais ignoré ni deviné.

## Incréments

| # | Incrément | Contenu |
|---|-----------|---------|
| 1 | Lecture | `DCL-F` disque (`USAGE(*INPUT)`, `KEYED`, `USROPN`), zones = variables typées, `READ`, `READP`, `READE`, `READPE`, `CHAIN`, `SETLL`, `SETGT`, `%EOF`, `%FOUND`, `%EQUAL`, `OPEN`, `CLOSE`, `%OPEN` — détaillé ci-dessous |
| 2 | Écriture | `WRITE`, `UPDATE`, `DELETE`, `USAGE(*OUTPUT : *UPDATE : *DELETE)`, `UNLOCK` ; clé en double (statut 01021) ; `UPDATE`/`DELETE` sans lecture préalable (erreur comme sur IBM i) |
| 3 | Compléments | `PREFIX`, `RENAME`, `EXTFILE`, `EXTDESC`, `LIKEREC`, lecture dans une DS (`READ fichier ds`), `%FIELDS` sur `UPDATE`, `%KDS`, `READE`/`READPE` sans clé, extenseur `(E)` et `%ERROR`, `INFDS`, fichiers logiques (autre clé sur les mêmes données), `DCL-F` local à une procédure |

Hors périmètre (refusés) : écrans `WORKSTN` (`EXFMT`, sous-fichiers), impressions `PRINTER`,
contrôle de validation, cycle RPG.

Chaque incrément ultérieur fera l'objet d'une courte conception validée avant implémentation ;
le présent document détaille l'incrément 1.

## Données : `context/tables.json`

Un fichier physique IBM i est aussi une table SQL : **les mêmes données** servent au SQL et aux
opérations natives (un `INSERT` SQL est vu par le `READ` suivant).

```json
{
  "CLIENT": {
    "format": "CLIENTF",
    "schema": { "NUMCLI": "packed(7:0)", "NOM": "char(30)", "SOLDE": "packed(9:2)" },
    "keys": ["NUMCLI"],
    "data": [ { "NUMCLI": 1, "NOM": "Dupont", "SOLDE": 1500.5 } ]
  }
}
```

- `schema` : types en syntaxe RPG (`char(n)`, `varchar(n)`, `packed(p:d)`, `zoned(p:d)`,
  `int(n)`, `uns(n)`, `ind`, `date`, `time`, `timestamp`) ou SQL (`CHAR(n)`, `VARCHAR(n)`,
  `DECIMAL(p,s)` → `packed`, `NUMERIC(p,s)` → `zoned`, `SMALLINT` → `int(5)`, `INTEGER`/`INT` →
  `int(10)`, `BIGINT` → `int(20)`, `DATE`, `TIME`, `TIMESTAMP`). Type inconnu : erreur au chargement.
- `keys` : zones clés, ordre croissant. Doublons de clé permis (lus dans l'ordre d'arrivée).
- `format` : nom du format d'enregistrement ; absent → `<FICHIER>F`.
- Une table sans `schema` (simple tableau de lignes) reste utilisable en SQL mais ne peut pas
  être déclarée par `DCL-F` (erreur claire).
- Le fichier `context/files.json` et le type `FileDefinition` (jamais chargés) sont supprimés.

## Incrément 1 — Lecture

### Comportement attendu (vu du programme RPG)

**`DCL-F`** — `dcl-f CLIENT [disk] [usage(*input)] [keyed] [usropn];`
- Chaque zone du fichier devient une variable globale typée, initialisée à blanc / zéro.
- Une variable (`dcl-s`, sous-champ de DS, paramètre du programme) de même nom et d'un autre
  type → « types incompatibles » (comme à la compilation) ; de même type → « pas encore supporté »
  (valide sur IBM i, non simulé). Une `dcl-c` ou une DS de même nom → « déjà déclaré ».
  Deux fichiers ayant une zone de même nom et de même type la partagent.
- `DISK` et `DISK(*EXT)` acceptés ; tout autre argument de `DISK` refusé.
- Fichier absent de `tables.json`, ou sans `schema` → erreur claire au démarrage.
  `keyed` sur une table sans `keys` → erreur.
- Refusés (« pas encore supporté ») : `WORKSTN`, `PRINTER`, `SPECIAL` ; mots-clés `PREFIX`,
  `RENAME`, `EXTFILE`, `EXTDESC`, `EXTMBR`, `INFDS`, `SFILE`, `INDDS`, `ALIAS`, `QUALIFIED`,
  `TEMPLATE`, `LIKEFILE`, `BLOCK`, `COMMIT`, `OFLIND`… ; toute `USAGE` autre que `*INPUT` ;
  `DCL-F` dans une procédure.

**Lecture**
- `READ f` : enregistrement suivant (ordre des clés si `keyed`, sinon ordre d'arrivée). Fin :
  `%EOF` = `*ON`, zones inchangées. `READ` accepte le nom du fichier ou de son format.
- Après une lecture réussie (`READ`, `READP`, `READE`, `READPE`, `CHAIN` trouvé), le fichier est
  positionné **sur** l'enregistrement lu : `READ` lit celui de clé strictement supérieure, `READP`
  celui de clé strictement inférieure (`read; read; readp` relit le premier). Si l'enregistrement
  lu est supprimé entre-temps, la position reste définie par sa clé.
- `READP f` : enregistrement précédent ; début de fichier → `%EOF` = `*ON`.
- `CHAIN clé f` : lecture directe ; `%FOUND` mis à jour ; non trouvé → zones inchangées.
  Fichier sans `keyed` : `CHAIN n f` lit l'enregistrement de rang `n` (1 = premier) ; rang
  caractère ou liste → « types incompatibles » ; rang non entier, ou toute ligne déjà vue puis
  supprimée (ou un `DELETE` SQL sur la table pendant l'exécution) → « pas encore supporté ».
  `SETLL`/`SETGT`/`READE`/`READPE` par valeur sur un fichier sans clé → « pas encore supporté ».
- `SETLL clé f` : se place avant la première clé ≥ ; `%EQUAL` = clé exacte trouvée ; `%FOUND` =
  une clé ≥ existe. Ne lit rien ; remet `%EOF(f)` à `*OFF` (`%EOF` sans argument inchangé).
- `SETGT clé f` : se place après la dernière clé ≤ ; `%FOUND` = une clé > existe ; remet
  `%EOF(f)` à `*OFF`. `CHAIN` trouvé remet aussi `%EOF(f)` à `*OFF` ; après un `CHAIN` non
  trouvé, `%EOF(f)` est inconnu : le lire avant une nouvelle lecture → « pas encore supporté ».
- `SETLL` / `SETGT` acceptent aussi `*START`, `*END`, `*LOVAL`, `*HIVAL`.
- `READE clé f` / `READPE clé f` : suivant / précédent seulement si sa clé est égale ; sinon
  `%EOF` = `*ON`.
- Clé : une valeur, ou une liste `(k1 : k2 …)` pour une clé composée ; clé partielle (premières
  zones) acceptée. Comparaison selon le type de la zone : numérique comme nombre, caractère avec
  blancs de fin ignorés. Valeur de clé d'un type incompatible avec la zone → « types incompatibles » ;
  valeur qui ne tient pas dans la zone clé (décimales ou chiffres en trop, texte trop long) →
  « pas encore supporté » (conversion IBM i non vérifiée).
- Donnée de `tables.json` qui ne tient pas dans sa zone → erreur « Donnée invalide … (ne tient pas
  dans packed(9:2)) » ; un `INSERT` SQL qui omet des colonnes de type connu leur donne la valeur par
  défaut IBM i (blanc, zéro, `'0'`, date/heure minimales).
- Refusés : `READE`/`READPE` sans clé, `%KDS`, une lecture séquentielle (`READ`, `READP`,
  `READE`, `READPE`) juste après un `CHAIN` non trouvé sans repositionnement (position IBM i non
  vérifiée), l'extenseur `(E)`, `READC`, et toute opération d'écriture (incrément 2).

**Fonctions et ouverture**
- `%EOF`, `%FOUND`, `%EQUAL` : avec un nom de fichier, l'état de ce fichier ; sans nom, l'état
  de la dernière opération concernée ; avec ou sans parenthèses.
- `OPEN f` / `CLOSE f` ; `%OPEN(f)`. Fichier sans `USROPN` : ouvert dès le démarrage.
- Opération sur un fichier fermé : **statut 01211** (`RpgError`, `RNX1211`), interceptable.
  `OPEN` d'un fichier déjà ouvert : **statut 01215** (`RNX1215`).
- `CLOSE` puis `OPEN` : repositionnement au début. `CLOSE` d'un fichier déjà fermé → « pas encore
  supporté » (comportement IBM i non vérifié).
- Performance : clés par ligne et ordre trié mis en cache, invalidés par la version des données
  (`revision`, incrémentée par chaque `INSERT`/`UPDATE`/`DELETE` SQL).

**Programmes appelés** : un programme appelé (source) voit les mêmes données ; ses positions de
lecture sont les siennes.

### Architecture

**`src/files.ts`** (autonome)
- `parseFieldType(text): DataTypeNode` (syntaxes RPG et SQL).
- `class NativeFile` construite sur la liste de lignes de la table SQL (référence partagée),
  la liste des zones typées, les clés et le format :
  - ordre : par clé (comparaison selon le type), puis ordre d'arrivée ; sans clé : ordre d'arrivée ;
  - position mémorisée par l'identité du dernier enregistrement (pas un indice), pour rester
    cohérente si le SQL ajoute ou supprime des lignes ;
  - `read`, `readp`, `reade(key)`, `readpe(key)`, `chain(key)`, `chainRrn(n)`,
    `setll(key | spécial)`, `setgt(key | spécial)` → `{ record?, found, eof, equal }` ; aucune
    erreur RPG levée ici.

**Branchements**

| Fichier | Changement |
|---------|------------|
| `context.ts` | `tables.json` : conserve `schema`, `keys`, `format` ; suppression de `files.json`/`FileDefinition` |
| `lexer.ts`, `types.ts` | mots `READE`, `READP`, `READPE`, `SETGT`, `OPEN`, `CLOSE` ; nœuds `FileDeclaration`, `FileOperation` |
| `parser.ts` | `DCL-F` et mots-clés, opérations de fichier, listes de clés, `%EOF/%FOUND/%EQUAL/%OPEN` avec nom de fichier ; nom de fichier ou de format inconnu → erreur d'analyse |
| `interpreter.ts` | `NativeFile` par `DCL-F`, déclaration des zones, ouverture ; copie des valeurs lues dans les zones (chemin « données », conversion comme le SQL) ; état par fichier et dernière opération ; statuts 01211 / 01215 |
| `runtime.ts` | suppression des fonctions de fichiers factices (`declareFile`, `setll`, `read`, `chain`, `getFileStatus`) |
| `readme.md` | section « Fichiers natifs », limites connues |

### Tests (TDD)
- `test/files-core.test.js` : types RPG/SQL, ordre, clés composées et partielles, doublons,
  comparaisons, positionnement, lecture en arrière, cohérence après ajout SQL.
- `test/files.test.js` : programmes RPG — boucle `READ`/`DOW NOT %EOF`, `CHAIN`/`IF %FOUND`,
  `SETLL`/`READE` sur clé partielle, `READP` depuis `*END`, `USROPN` + 01211/01215, donnée
  partagée avec le SQL, programme appelé.
- `test/unsupported.test.js` : chaque refus.

## Incrément 2 — Écriture

Validé le 2026-10-05. Sans AS400 pour vérifier, tout point incertain est **refusé
explicitement** (« pas encore supporté ») plutôt que deviné.

### Comportement attendu (vu du programme RPG)

**`USAGE`** — `*INPUT` (défaut) ; `*OUTPUT` ; `*UPDATE` (implique `*INPUT`) ; `*DELETE`
(implique `*INPUT` et `*UPDATE`) ; combinaisons usuelles (`usage(*input : *output)`,
`usage(*update : *delete : *output)`).
- Lecture (`READ`, `READP`, `READE`, `READPE`, `CHAIN`, `SETLL`, `SETGT`) sur un fichier sans
  `*INPUT` (ni `*UPDATE`/`*DELETE`) → erreur d'analyse (comme à la compilation). Mot répété
  (`usage(*update : *update)`) → erreur d'analyse « USAGE(*UPDATE) répété ».
- `WRITE` sans `*OUTPUT`, `UPDATE` sans `*UPDATE`, `DELETE` sans `*DELETE` → erreur (comme à la
  compilation ; contrôlée après la déclaration des fichiers, car le nom de format n'est connu qu'avec
  `tables.json`, mais avant toute exécution, sur tout le programme, procédures et branches jamais
  exécutées comprises ; de même le nom de format attendu par `WRITE`/`UPDATE` et le fichier inconnu).

**Opérations**
- `WRITE format` : ajoute un enregistrement avec les valeurs actuelles des zones (variables
  globales : une variable locale de même nom dans une procédure ne les masque pas) ; ne change pas
  la position de lecture. Nommer le fichier au lieu du format → erreur (comme à la compilation).
- `UPDATE format` : réécrit l'enregistrement **lu en dernier** (enregistrement courant).
- `DELETE format` : supprime l'enregistrement courant ; `DELETE clé format` : supprime le premier
  enregistrement de cette clé, `%FOUND` mis à jour (non trouvé → rien n'est supprimé ; trouvé →
  plus d'enregistrement courant, verrou libéré, position perdue). `DELETE` accepte le nom du fichier
  ou du format.
- `UPDATE` / `DELETE` sans enregistrement courant (pas de lecture réussie, ou après `UNLOCK`,
  `UPDATE`, `DELETE`, lecture en échec) → **statut 01221** (`RpgError`, `RNX1221`), interceptable.
- `UNLOCK fichier` : libère l'enregistrement courant (plus d'enregistrement courant) ; fichier sans
  `*UPDATE` → « pas encore supporté ».
- Après `UPDATE`, la position reste sur l'enregistrement ; après `DELETE`, le `READ` suivant lit
  l'enregistrement qui suivait.

**Clés uniques** — option `"unique": true` dans `tables.json` (avec `keys`). `WRITE` ou `UPDATE`
qui créerait un doublon de clé → **statut 01021** (`RNX1021`), rien n'est écrit. L'unicité est
contrôlée sur les clés de la table, même si le `DCL-F` n'a pas `KEYED`. Sans `"unique"` : doublons
permis. En SQL, `INSERT`/`UPDATE` qui créerait un doublon → erreur SQL ordinaire (`SQLCOD` -803,
`SQLSTATE` 23505), rien n'est modifié. Données de `tables.json` contenant déjà un doublon → erreur
au `DCL-F` (« Fichier CLIENT : clé en double dans tables.json (NUMCLI = 1) »).

**Verrous** — une lecture réussie sur un fichier `*UPDATE`/`*DELETE` verrouille l'enregistrement ;
le verrou est libéré par la lecture suivante, `UPDATE`, `DELETE`, `UNLOCK`, `CLOSE` et la fin du
programme. Lecture pour mise à jour d'un enregistrement verrouillé par une autre ouverture du
fichier (autre programme du même travail) → « pas encore supporté » (sur IBM i : attente puis
statut 01218). `UPDATE`/`DELETE` SQL d'un enregistrement verrouillé par un fichier natif → « pas
encore supporté ».

**Données** — les écritures natives sont vues par le SQL et inversement. Valeurs écrites :
nombre, `CHAR` sans blancs de fin, `VARCHAR` tel quel (blancs de fin compris), date/heure/timestamp
en texte ISO, indicateur `'1'`/`'0'`. Une variable hôte SQL `VARCHAR` garde aussi ses blancs de fin.

**Refusés (« pas encore supporté »)**
- lecture séquentielle (`READ`, `READP`, `READE`, `READPE`) quand la clé de l'enregistrement
  courant a changé depuis sa lecture (par `UPDATE` natif ou SQL), ou après un `DELETE` par clé
  réussi ;
- `UPDATE`/`DELETE` sans nouvelle lecture après `SETLL`, `SETGT`, `OPEN`, `DELETE` par clé réussi,
  `WRITE` (avec un enregistrement courant : effet sur le verrou non vérifié) ou `UPDATE` en échec
  01021 ;
- `UNLOCK` d'un fichier sans `*UPDATE` ;
- `%FIELDS`, `WRITE`/`UPDATE` depuis une DS, extenseur `(E)` (incrément 3) ;
- `READ(N)` (lecture sans verrou).

### Architecture

**`src/files.ts` (`NativeFile`)**
- `write(record)`, `update(record)`, `delete()`, `deleteByKey(key)`, `unlock()` → résultat ou
  motif d'échec (`'noCurrent'`, `'duplicate'`, `'locked'`), sans erreur RPG.
- Enregistrement courant mémorisé avec la clé lue ; clé changée avant la lecture séquentielle
  suivante → `NotSupportedError`.
- Unicité contrôlée avec les clés de la table (paramètre distinct des clés d'accès `KEYED`).
- Registre de verrous partagé par table (quel fichier ouvert tient chaque enregistrement).

**Branchements**

| Fichier | Changement |
|---------|------------|
| `context.ts` | option `"unique"` (booléen) |
| `parser.ts`, `types.ts` | `USAGE` complète et implications, `WRITE`, `UPDATE`, `DELETE [clé]`, `UNLOCK` ; lecture sur fichier sans entrée → erreur d'analyse |
| `interpreter.ts` | enregistrement construit depuis les zones (conversion RPG → données), contrôle format/`USAGE` à l'exécution, statuts 01221 et 01021, verrous libérés à `CLOSE` et en fin de programme |
| `sql-engine.ts` | `UPDATE`/`DELETE` d'un enregistrement verrouillé → `NotSupportedError` ; révision et suppressions comptées comme pour le SQL |
| `readme.md` | section « Fichiers natifs » et limites |

### Tests (TDD)
- `test/files-core.test.js` : écriture, mise à jour, suppression (courante et par clé), unicité,
  verrous, clé modifiée sous le curseur.
- `test/files.test.js` : boucle `READ`/`UPDATE`, `WRITE` puis relecture, `DELETE` par clé,
  01021 et 01221 interceptés, SQL voyant les écritures natives, deux programmes et un
  enregistrement verrouillé.
- `test/unsupported.test.js` : chaque refus.

## Incrément 3 — Compléments (découpé)

| # | Sous-incrément | Contenu |
|---|----------------|---------|
| 3a | Noms et options simples | `RENAME`, `PREFIX`, `EXTFILE`/`EXTDESC`, `READE`/`READPE` sans clé, extenseurs `(N)` et `(E)` + `%ERROR` — détaillé ci-dessous |
| 3b | Structures liées aux fichiers | `LIKEREC`, `EXTNAME`, lecture dans une DS, `WRITE`/`UPDATE` depuis une DS, `%KDS`, `%FIELDS` |
| 3c | Le reste | fichiers logiques, `INFDS`, `DCL-F` local, `QUALIFIED`/`LIKEFILE`/`TEMPLATE` |

### Incrément 3a — comportement attendu

Validé le 2026-10-05.

**`RENAME(format_externe : nouveau)`** — le programme utilise le nouveau nom de format
(`READ`, `WRITE`, `UPDATE`, `DELETE`, contrôle avant exécution) ; l'ancien nom n'est plus reconnu.
Le premier argument doit être le format réel (`tables.json`, défaut `<FICHIER>F`), sinon erreur.
Un format qui porte le nom de son fichier (sans `RENAME`, ou `RENAME` vers le nom du fichier) est une
erreur au `DCL-F` (« RENAME nécessaire »), comme pour le compilateur. Le nouveau nom ne doit pas être
déjà utilisé (fichier, format, zone d'un fichier après `PREFIX`, paramètre, variable, constante,
structure de données ou sous-zone d'une structure non qualifiée), sinon erreur.

**`PREFIX(p)` / `PREFIX('p')` / `PREFIX(p : n)`** — chaque zone devient la variable préfixée
(`NOM` → `C_NOM`) ; avec `n`, les `n` premiers caractères du nom sont remplacés (`CLNOM`,
`PREFIX(C_:2)` → `C_NOM`). Lectures, écritures et clés de données passent par ces noms.
`n` supérieur à la longueur d'un nom de zone → « pas encore supporté ». Un nom obtenu qui n'est pas
un nom RPG valide (`PREFIX('9')` → `9NUMCLI`) → erreur.

**`EXTFILE` / `EXTDESC`** — `EXTFILE('BIB/NOM')` ou `EXTFILE('NOM')` : données de la table `NOM`
(bibliothèque ignorée, documenté) ; `EXTDESC('BIB/NOM')` : description de compilation (zones,
types, format) de la table `NOM`. Table de données : celle d'`EXTFILE`, celle d'`EXTDESC` avec
`EXTFILE(*EXTDESC)`, sinon celle du nom du `DCL-F` (même avec `EXTDESC`) ; absente de `tables.json`
→ erreur « absent de context/tables.json ». Lignes, verrous, clés et unicité viennent de la table de
données. Quand les deux tables diffèrent : zones différentes (noms ou types), ordre des zones
différent (vérification de niveau, CPF4131), `keys` (noms et ordre) ou `unique` différents → erreur
au `DCL-F` nommant la différence. `EXTFILE(*EXTDESC)` accepté avec `EXTDESC`.
`EXTFILE(variable)` → « pas encore supporté ». Le littéral est sensible à la casse sur IBM i : un nom
contenant des minuscules → erreur d'analyse (les noms de `tables.json` sont en majuscules) ; nom vide
ou mal formé (`'BIB/'`, `'/NOM'`, `'A/B/C'`) → erreur d'analyse.

**`READE` / `READPE` sans clé** — comparaison avec la clé complète du dernier enregistrement lu.
Sans lecture préalable réussie → « pas encore supporté ».

**Extenseur `(N)`** sur les lectures (`READ`, `READP`, `READE`, `READPE`, `CHAIN`) : lecture sans
verrou ; pas d'enregistrement courant (un `UPDATE`/`DELETE` sans relecture → statut 01221).

**Extenseur `(E)` et `%ERROR`** — sur toute opération de fichier (`READ`…, `CHAIN`, `SETLL`,
`SETGT`, `WRITE`, `UPDATE`, `DELETE`, `UNLOCK`, `OPEN`, `CLOSE`), combinable avec `N`
(`(EN)`, `(NE)`) : une erreur RPG de fichier (`RpgError` : 01211, 01215, 01221, 01021) ne lève
pas d'exception ; `%ERROR` = `*ON` et `%STATUS` = statut, le programme continue. Une opération
avec `(E)` qui réussit met `%ERROR` à `*OFF`. Les opérations sans `(E)` ne changent pas `%ERROR`.
Les refus « pas encore supporté » et les erreurs de données traversent `(E)`, ainsi que les erreurs
levées pendant l'évaluation des opérandes (clé, rang), évalués avant l'opération. `DSPLY(E)` remet
`%ERROR` à `*OFF` et `%STATUS` à 0. Autres extenseurs et `(E)` hors fichiers : inchangés (refusés là
où ils l'étaient). `OPEN`/`CLOSE` avec un nom de format → erreur avant l'exécution.

### Incrément 3a — architecture

| Fichier | Changement |
|---------|------------|
| `parser.ts`, `types.ts` | `FileDeclarationNode` : `rename`, `prefix { text, count? }`, `extfile` (texte ou `*EXTDESC`), `extdesc` ; `FileOperationNode.extender { error, noLock }` ; `READE`/`READPE` sans clé ; `%ERROR` |
| `files.ts` | `reade`/`readpe` avec la clé du dernier enregistrement lu ; option de lecture sans verrou |
| `interpreter.ts` | tables de description et de données, contrôle des zones, format renommé, correspondance zone → variable préfixée, enveloppe `(E)` (`%ERROR`, `%STATUS`) |
| `readme.md` | mots-clés, extenseurs, refus |

### Incrément 3a — tests (TDD)
`test/files.test.js` : `dcl-f film rename(film:ffilm)`, `PREFIX` en lecture et écriture,
`EXTFILE`/`EXTDESC`, boucle `READE` sans clé, `READ(N)` puis `UPDATE` (01221), `CHAIN(E)` sur
fichier fermé (`%ERROR`, `%STATUS` 1211), `WRITE(E)` d'un doublon ; `test/files-core.test.js`
pour le module ; `test/unsupported.test.js` pour chaque refus.
