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
- Une variable déjà déclarée avec le même nom et un autre type → erreur (comme à la compilation).
  Deux fichiers ayant une zone de même nom et de même type la partagent.
- Fichier absent de `tables.json`, ou sans `schema` → erreur claire au démarrage.
  `keyed` sur une table sans `keys` → erreur.
- Refusés (« pas encore supporté ») : `WORKSTN`, `PRINTER`, `SPECIAL` ; mots-clés `PREFIX`,
  `RENAME`, `EXTFILE`, `EXTDESC`, `EXTMBR`, `INFDS`, `SFILE`, `INDDS`, `ALIAS`, `QUALIFIED`,
  `TEMPLATE`, `LIKEFILE`, `BLOCK`, `COMMIT`, `OFLIND`… ; toute `USAGE` autre que `*INPUT` ;
  `DCL-F` dans une procédure.

**Lecture**
- `READ f` : enregistrement suivant (ordre des clés si `keyed`, sinon ordre d'arrivée). Fin :
  `%EOF` = `*ON`, zones inchangées. `READ` accepte le nom du fichier ou de son format.
- `READP f` : enregistrement précédent ; début de fichier → `%EOF` = `*ON`.
- `CHAIN clé f` : lecture directe ; `%FOUND` mis à jour ; non trouvé → zones inchangées.
  Fichier sans `keyed` : `CHAIN n f` lit l'enregistrement de rang `n` (1 = premier).
- `SETLL clé f` : se place avant la première clé ≥ ; `%EQUAL` = clé exacte trouvée ; `%FOUND` =
  une clé ≥ existe. Ne lit rien et ne modifie pas `%EOF`.
- `SETGT clé f` : se place après la dernière clé ≤ ; `%FOUND` = une clé > existe.
- `SETLL` / `SETGT` acceptent aussi `*START`, `*END`, `*LOVAL`, `*HIVAL`.
- `READE clé f` / `READPE clé f` : suivant / précédent seulement si sa clé est égale ; sinon
  `%EOF` = `*ON`.
- Clé : une valeur, ou une liste `(k1 : k2 …)` pour une clé composée ; clé partielle (premières
  zones) acceptée. Comparaison selon le type de la zone : numérique comme nombre, caractère avec
  blancs de fin ignorés. Valeur de clé d'un type incompatible avec la zone → « types incompatibles ».
- Refusés : `READE`/`READPE` sans clé, `%KDS`, une lecture séquentielle (`READ`, `READP`,
  `READE`, `READPE`) juste après un `CHAIN` non trouvé sans repositionnement (position IBM i non
  vérifiée), l'extenseur `(E)`, `READC`, et toute opération d'écriture (incrément 2).

**Fonctions et ouverture**
- `%EOF`, `%FOUND`, `%EQUAL` : avec un nom de fichier, l'état de ce fichier ; sans nom, l'état
  de la dernière opération concernée ; avec ou sans parenthèses.
- `OPEN f` / `CLOSE f` ; `%OPEN(f)`. Fichier sans `USROPN` : ouvert dès le démarrage.
- Opération sur un fichier fermé : **statut 01211** (`RpgError`, `RNX1211`), interceptable.
  `OPEN` d'un fichier déjà ouvert : **statut 01215** (`RNX1215`).
- `CLOSE` puis `OPEN` : repositionnement au début.

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
