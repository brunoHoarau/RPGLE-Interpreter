# Fichiers natifs — 3b : structures liées aux fichiers (+ LIKEDS)

**Branche :** `feat/fichiers-ds`. **Spec :** `docs/superpowers/specs/2026-10-05-fichiers-natifs-design.md` (3b).
**Hors périmètre :** `DIM` et tout tableau (incrément suivant), `TEMPLATE`, `QUALIFIED`/`LIKEFILE` de `DCL-F`,
`EVAL-CORR`, `INZ(*LIKEDS)` sur paramètre. Tout cela reste refusé (« pas encore supporté »).

## Comportement attendu

**`LIKEDS(ds)`** sur `DCL-DS` (sans sous-zones ni `END-DS`) : nouvelle DS, toujours qualifiée, mêmes
sous-zones (noms, types, ordre). Les valeurs `INZ` de la DS d'origine ne sont pas reprises (valeurs par
défaut) ; `INZ(*LIKEDS)` les reprend. `ds` inconnue ou pas une DS → erreur d'analyse/déclaration.

**`LIKEREC(format {: *ALL | *INPUT | *OUTPUT | *KEY})`** sur `DCL-DS` (sans `END-DS`) : DS qualifiée dont
les sous-zones sont les zones du format d'un `DCL-F` du programme (nom après `RENAME`), défaut `*INPUT`.
Pour un fichier physique, `*ALL` = `*INPUT` = `*OUTPUT` = toutes les zones ; `*KEY` = zones de clé dans
l'ordre de la clé (fichier sans `KEYED` → erreur). Format inconnu → erreur. Fichier avec `PREFIX` :
les sous-zones portent les noms préfixés (`prefix(c_)` → `cli.c_nom`), confirmé par l'utilisateur.

**`EXTNAME('fichier' {: 'format'} {: *ALL | *INPUT | *OUTPUT | *KEY})`** sur `DCL-DS` (doc IBM fournie
par l'utilisateur) : en free-form, fichier et format sont des **littéraux** (ou constantes nommées
déclarées avant) ; un nom non cité → erreur d'analyse. Littéral sensible à la casse (minuscules → erreur,
comme `EXTFILE`) ; formes `'FICHIER'`, `'BIB/FICHIER'`, `'*LIBL/FICHIER'` (bibliothèque ignorée). Sans
format : premier format de la table. Sous-zones = zones de la table de `tables.json` (absente → erreur
« absent de context/tables.json »). Sans type d'extraction : zones du tampon d'entrée (= toutes pour un
fichier physique), mais **la DS ne peut pas servir à une opération d'E/S** → erreur de compilation.
`*NULL` et `EXT` sans `EXTNAME` → « pas encore supporté ». Qualifiée seulement avec `QUALIFIED`. Forme
`dcl-ds x extname('F') end-ds;` et `dcl-ds x extname('F'); end-ds;`. Sous-zones déclarées dans la DS,
`PREFIX` de DS → « pas encore supporté ». DS non qualifiée dont une sous-zone porte le nom d'une zone d'un
`DCL-F` (mémoire partagée sur IBM i) → « pas encore supporté ». Format donné ≠ format de la table → erreur.

**Origine.** Une DS `LIKEREC`/`EXTNAME` retient son origine `{ table, format, usage }` ; une DS `LIKEDS`
hérite de l'origine de sa DS source.

**DS entière comme valeur.** `a = b;` entre deux DS de même disposition (mêmes types de sous-zones dans le
même ordre ; les noms ne comptent pas, c'est une copie d'octets) → copie champ par champ. Disposition
différente ou DS affectée depuis une valeur non DS → « pas encore supporté » (copie d'octets non simulée).
Partout ailleurs une DS utilisée comme valeur reste refusée comme aujourd'hui.

**Paramètres `LIKEDS(ds)` / `LIKEREC(fmt…)`** dans `DCL-PI` / `DCL-PR` : par référence (défaut), `CONST`
ou `VALUE`. Filiation exigée (confirmé) : l'argument est la DS citée par `LIKEDS` ou une DS `LIKEDS` de
celle-ci (pour `LIKEREC` : même format et même usage) ; par référence, une DS sans filiation même de
disposition identique → erreur de compilation ; en `CONST`/`VALUE`, DS sans filiation → « pas encore
supporté » (non vérifié sur IBM i). Littéral ou expression → erreur. Par référence, les modifications reviennent à l'appelant ; `CONST` :
sous-zones en lecture seule. Valeur de retour `LIKEDS` → « pas encore supporté ».

**Lecture dans une DS** — `READ`, `READP`, `READE`, `READPE`, `CHAIN` avec une DS résultat
(`read f ds;`, `chain k f ds;`) : l'enregistrement va dans la DS, **les zones du programme ne changent
pas**. La DS doit avoir pour origine le format du fichier, usage `*INPUT` ; autre DS ou autre usage
(`*OUTPUT`, `*KEY`) → erreur de compilation (avant exécution), même si les zones sont identiques.
Fin de fichier / non trouvé : DS inchangée.

**Écriture depuis une DS** — `write fmt ds;` (usage `*OUTPUT`), `update fmt ds;` (usage `*INPUT`) :
valeurs prises dans la DS, pas dans les zones. Autre usage ou autre origine → erreur de compilation
(confirmé par l'utilisateur : le compilateur contrôle le sens de l'opération). Mêmes statuts et verrous.
Usage `*ALL` : accepté par la lecture, `WRITE` et `UPDATE` (confirmé). Même contrôle pour `EXTNAME`
(sans format : premier format de la table) ; une DS `EXTNAME` sans type d'extraction → erreur.

**`%KDS(ds {: n})`** comme clé de `CHAIN`, `SETLL`, `SETGT`, `READE`, `READPE`, `DELETE` : les `n` (défaut
toutes) premières sous-zones de la DS forment la liste de clés, comme `(a : b)`. `n` doit être un entier
littéral ou une constante, 1 ≤ n ≤ nombre de sous-zones, sinon erreur. Plus de sous-zones que de zones de
clé → erreur (comme une liste trop longue aujourd'hui).

**`%FIELDS(z1 : z2 …)`** (doc IBM fournie) dernier opérande de `UPDATE` seulement (ailleurs → erreur
d'analyse) : seules les zones citées sont réécrites, les autres gardent la valeur de l'enregistrement en base
(même modifiées dans le programme). Sans DS : noms internes des zones (après `PREFIX`). Avec DS
(`update fmt ent %fields(ent.solde)`) : sous-zones de la DS résultat (`*INPUT`, ou `LIKEDS` d'une telle DS),
nom qualifié simple. Zone hors du format → erreur. Mélange (sous-zones sans DS résultat, zones simples avec
DS résultat, sous-zones d'une autre DS) → « pas encore supporté ».

## Architecture

- `DataStructureNode` gagne `like?: { kind: 'likeds' | 'likerec' | 'extname'; name: string;
  format?: string; usage: 'all' | 'input' | 'output' | 'key'; inzLike?: boolean }` ; `fields` vide alors.
- `ParameterNode.dataType` peut être `{ type: 'DataType', typeName: 'ds', like: … }` (même objet `like`).
- Exécution : les sous-zones sont résolues à la déclaration (`src/interpreter/declarations.ts`), depuis la
  description de la DS source ou de la table (`src/interpreter/files/declare.ts` expose une fonction
  « zones d'un format / d'une table »). Le runtime mémorise pour chaque DS sa disposition et son origine
  (`runtime.ts` : `dsShapes: Map<nom, { fields: {name,type}[]; origin? }>` par portée).
- `FileOperationNode` gagne `resultDs?: string`, `kds?: { ds: string; count?: ExpressionNode }`,
  `fields?: string[]`.
- `recordValues` / `copyRecord` prennent une cible : zones du programme (actuel) ou DS.
- Le parser ne connaît pas les sous-zones d'une DS `LIKEREC`/`EXTNAME` : vérifier que rien à l'analyse
  n'en dépend (`rememberDateTime`, contrôle des noms qualifiés). Si oui, résoudre à l'analyse via le nom de
  format connu, ou refuser explicitement — ne jamais deviner.

## Tâches (chaque tâche : test rouge → code → vert → `npm run check` → commit en français)

### Tâche 1 — Analyse (sonnet)
`src/parser/declarations/data-structure.ts`, `keywords.ts`, `src/parser/procedures.ts`, `src/parser/files.ts`,
`src/types.ts`. Tests : `test/unsupported.test.js` (retirer les refus de LIKEDS/LIKEREC/`%KDS`/DS résultat,
garder DIM, TEMPLATE, PREFIX de DS, sous-zones dans EXTNAME, retour LIKEDS), `test/parser.test.js`
(formes acceptées et nœuds produits, `%FIELDS` hors `UPDATE` refusé, `%KDS` avec `n` non constant refusé).

### Tâche 2 — DS LIKEDS / LIKEREC / EXTNAME et affectation de DS (sonnet)
`src/interpreter/declarations.ts`, `src/runtime.ts`, `src/interpreter/files/declare.ts`,
`src/interpreter/statements.ts`. Tests : `test/ds.test.js` (ou le fichier DS existant) et `test/files.test.js` :
sous-zones et types, `*KEY` dans l'ordre de clé, `INZ` non hérité / `INZ(*LIKEDS)`, EXTNAME qualifiée et non
qualifiée, conflit avec zone de `DCL-F`, LIKEREC sur fichier PREFIX refusé, `a = b` même disposition et
disposition différente refusée.

### Tâche 3 — Paramètres DS (sonnet)
`src/interpreter/calls.ts`. Tests dans le fichier des procédures : référence (retour des modifications),
`CONST` (affectation d'une sous-zone refusée), `VALUE` (pas de retour), DS de disposition différente → erreur,
littéral → erreur.

### Tâche 4 — Opérations de fichier avec DS, `%KDS`, `%FIELDS` (sonnet)
`src/interpreter/files/operations.ts`, `changes.ts`. Tests `test/files.test.js` / `files-core.test.js` :
lecture dans une DS sans toucher aux zones, `CHAIN` non trouvé laisse la DS, `WRITE`/`UPDATE` depuis DS,
usages refusés, DS d'une autre origine → erreur, `%KDS` complet et partiel, `%FIELDS` ne réécrit que les zones
citées (une autre zone modifiée dans le programme n'est pas écrite), `(E)` combiné.

### Tâche 5 — Bout en bout (haiku pour lancer, revue sonnet de fidélité RPG)
Test `test/files.test.js` inspiré de `agregation_par_categorie` sans tableau : `dcl-f film rename(film:ffilm)`,
`dcl-ds curFilm likerec(ffilm)`, boucle `read film curFilm`, appel d'une procédure `p likerec(ffilm) const`
qui garde le film le plus vu dans une DS globale `LIKEDS`, puis `DSPLY`. Mise à jour de la spec (section 3b
« Validé le … ») et de `readme.md`.

## Points de relecture
1. Lecture dans une DS : les zones du programme ne bougent pas (test tâche 4).
2. `%FIELDS` : une zone non citée mais modifiée dans le programme n'est pas écrite (test tâche 4).
3. Paramètre `CONST` vraiment en lecture seule, y compris pour les sous-zones (test tâche 3).
4. Aucun cas incertain approximé : copie entre
   dispositions différentes → « pas encore supporté ».
