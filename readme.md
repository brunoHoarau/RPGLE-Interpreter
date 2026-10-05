# RPGLE Interpreter pour VS Code

Extension VS Code qui analyse et exécute du **RPGLE free form** directement dans l'éditeur, sans compilation ni accès à un IBM i. Les données SQL sont simulées à partir de fichiers JSON.

## Utilisation

Ouvrez un fichier `.rpgle`, puis :

| Action | Comment |
|---|---|
| Exécuter le programme | `Ctrl+Shift+R`, ou clic droit → **RPGLE: Exécuter le code** |
| Valider la syntaxe | Clic droit → **RPGLE: Valider la syntaxe** |
| Voir les erreurs de syntaxe | Soulignées en rouge pendant la frappe |

Le résultat (messages `DSPLY`, statut des requêtes SQL, erreurs) s'affiche dans le canal de sortie **RPGLE Output**.

```rpgle
**free
dcl-s total packed(7:2) inz(0);
dcl-s i int(5);

for i = 1 to 5;
  total = total + i;
endfor;

dsply 'Total : ' + %char(total);   // Total : 15.00
return;
```

## Données SQL simulées

Les requêtes `exec sql` travaillent sur des tables décrites dans `context/tables.json`. Le dossier `context/` est cherché :

1. à la racine du dossier de workspace qui contient le fichier exécuté ;
2. sinon, à côté du dossier parent du fichier (par exemple `fichiers_test/../context`).

Deux formats sont acceptés pour chaque table :

```json
{
  "CUSTOMERS": [
    { "ID": 1, "NAME": "Dupont", "CITY": "Paris", "BALANCE": 1500.50 }
  ],
  "ORDERS": {
    "schema": { "ID": "INT", "AMOUNT": "DECIMAL(9,2)" },
    "data": [ { "ID": 1, "AMOUNT": 99.90 } ]
  }
}
```

Les données sont rechargées depuis le fichier à chaque exécution : les `INSERT`, `UPDATE` et `DELETE` ne modifient pas `tables.json`.

## Programmes appelés

Un appel de programme déclaré par `dcl-pr … extpgm('NOM')` est résolu dans cet ordre :

1. **Bouchon** de `NOM` dans `context/programs.json` (voir ci-dessous) : il est prioritaire, pour isoler le programme testé ;
2. **Source local** `NOM.rpgle` ou `NOM.sqlrpgle`, cherché dans le dossier du programme exécuté (sans tenir compte de la casse) : il est exécuté réellement ;
3. sinon, échec comme un programme introuvable sur IBM i (statut **00211**).

Quand le source est exécuté :

- ses paramètres d'entrée (`dcl-pi` principal) reçoivent les valeurs de l'appelant, **par référence** : ce que le programme appelé y écrit revient chez l'appelant, sauf pour un paramètre `CONST` ou `VALUE` du prototype ;
- il a ses propres variables globales et ses `DSPLY` apparaissent dans la sortie à leur place ;
- une erreur RPG qu'il n'intercepte pas remonte chez l'appelant avec le statut **00202**, interceptable par `MONITOR`.

Un programme qui attend des paramètres ne peut pas être lancé directement : exécutez le programme qui l'appelle.

### Bouchons

Un programme ou une procédure externe (`extproc('NOM')`) peut être simulé dans `context/programs.json`, en nommant les paramètres comme dans le `dcl-pr` :

```json
{
  "VOTRE_PGM": {
    "calls": [
      { "when": { "Entree_Param1": "VALIDE" }, "set": { "Sortie_Resultat": 1500.50 } },
      { "error": "Paramètre invalide" }
    ]
  }
}
```

- Le **premier cas** dont toutes les conditions `when` correspondent s'applique (un cas sans `when` correspond toujours).
- `set` renvoie des paramètres à l'appelant (pas les paramètres `CONST` ou `VALUE`), convertis à leur type.
- `return` donne la valeur de retour d'une procédure externe.
- `error` simule un échec du programme appelé : erreur de statut **00202**, interceptable par `MONITOR`.
- Sans bouchon, l'appel échoue comme un programme introuvable sur IBM i : statut **00211**.
- Chaque appel est tracé dans la sortie, avec les valeurs envoyées : `[APPEL] VOTRE_PGM(Entree_Param1='VALIDE', Sortie_Resultat=0) (bouchon)`.

Toute erreur interceptée par `MONITOR` est aussi tracée, comme dans l'historique du travail : `[JOBLOG] Division par zéro (RNX0102) - interceptée par MONITOR`.

Un prototype sans `extpgm` ni `extproc` appelle la procédure `dcl-proc` du même nom si elle existe dans le source, sinon le bouchon portant son nom.


Tout ce qui n'est pas listé ici est **refusé dès l'analyse**, avec la ligne et un message « pas encore supporté par l'interpréteur » (soulignement rouge dans l'éditeur) : un programme qui s'exécute ici n'a rien sauté en silence. Exception : les types incompatibles (texte + nombre sans `%CHAR`, condition qui n'est pas un indicateur, nombre affecté à un texte…) ne sont détectés qu'à l'exécution de la ligne, avec le message « types incompatibles », comme le compilateur IBM i les refuserait.


- **Déclarations** : `ctl-opt` (options ignorées, sauf `DATFMT`/`TIMFMT` : seul `*ISO` est accepté), `dcl-s`, `dcl-c`, `dcl-ds` qualifiées (`ds.champ`) ou non qualifiées (champs utilisables directement), champs insensibles à la casse ; `POS(n)` sur un champ de DS (des champs qui se chevauchent sont refusés) ; un nom peut être un mot de type (`dcl-s zoned zoned(4:0);`)
- **Types** : `char(n)` à longueur fixe, `varchar(n)`, `int`/`uns(3|5|10|20)`, `packed`/`zoned(p:d)`, `ind`, `date`, `time`, `timestamp` (voir ci-dessous). Troncature à l'affectation et dépassement de capacité (RNX0103) comme en RPG
- **Expressions** : priorités RPG (`OR` < `AND` < `NOT` < comparaisons < `+ -` < `* /` < `**` < signe), comparaison des chaînes sans tenir compte des blancs de fin
- **Affectation** : `x = …`, `EVAL x = …` (sans extenseur), opérateurs composés `+=`, `-=`, `*=`, `/=`, `**=` (`total += montant;`, `texte += 'x';`, `d += %days(1);`), indicateurs `*INLR` et `*IN01` à `*IN99`, valeurs `*ON`, `*OFF`, `*BLANK(S)`, `*ZERO(S)` (`*BLANK(S)`/`*ZERO(S)` vers un `varchar` ou un indicateur : pas encore supporté) ; types contrôlés comme par le compilateur (un texte ne reçoit pas un nombre, utilisez `%CHAR` ; un nombre ne reçoit pas un texte, utilisez `%INT`/`%DEC`) ; `*ZEROS` remplit un `char` de zéros ; affecter une constante `dcl-c` ou un paramètre `CONST` est refusé
- **Contrôle** : `IF`/`ELSEIF`/`ELSE`, `SELECT`/`WHEN`/`OTHER`, `DOW`, `DOU`, `FOR … TO|DOWNTO … BY`, `LEAVE`, `ITER`, `RETURN`, `MONITOR`/`ON-ERROR` avec codes de statut (`on-error 00102 : 00103;`, `*PROGRAM`, `*FILE`, `*ALL`). Seules les erreurs d'exécution RPG (division par zéro 00102, dépassement 00103, conversion 00105, date/heure invalide 00112, date hors limites 00113) sont interceptées
- **Procédures** : `dcl-proc`/`dcl-pi`, paramètres par référence (une variable du même type exact est exigée, sinon refus comme le compilateur : ni littéral, ni expression, ni constante, ni paramètre `CONST`), `VALUE`, `CONST`, `OPTIONS(*NOPASS)`, variables locales, récursion, appel dans une expression, `CALLP`, prototypes `dcl-pr` (`EXTPGM`, `EXTPROC`, paramètres sans nom `*N`, voir les bouchons ci-dessus)
- **SQL embarqué** : `SELECT … INTO`, `INSERT … VALUES`, `UPDATE`, `DELETE` ; clause `WHERE` avec `AND`/`OR`/`NOT`, parenthèses, `IS [NOT] NULL` ; variables hôtes, y compris un champ de structure de données (`:ds.champ`) ; valeurs calculées dans `SET` et `VALUES` (`set solde = solde + :montant`, avec `+ - *`, parenthèses, `NULL`, colonnes de la ligne) ; `UPDATE` sans `WHERE` ; `SQLCOD` et `SQLSTT`. Les vraies erreurs SQL donnent un `SQLCOD` négatif et le programme continue : table inconnue, colonne inconnue, colonne en double, nombre de valeurs différent du nombre de colonnes, valeur NULL ramenée dans une variable hôte sans indicateur (`SQLCOD` -305, `SQLSTT` 22002 : aucune variable n'est affectée), `INSERT` ou `UPDATE` qui créerait une clé en double dans une table `"unique"` (`SQLCOD` -803, `SQLSTT` 23505 : rien n'est modifié). Une variable hôte `varchar` garde ses blancs de fin, ceux d'une variable `char` sont retirés. Tout le reste est « pas encore supporté » et arrête le programme : instructions `DECLARE … CURSOR`, `OPEN`, `FETCH`, `CLOSE`, `SET`, `VALUES … INTO`, `COMMIT`, `ROLLBACK`, `CALL`, `WITH`, `INSERT … SELECT` ; `ORDER BY`, `GROUP BY`, `FETCH FIRST`, jointures, alias, `DISTINCT` ; dans `WHERE` et dans la liste du `SELECT`, `IN`, `BETWEEN`, `LIKE`, fonctions (`COUNT(*)`, `UPPER`…), `CURRENT_DATE` et autres registres spéciaux ; commentaires SQL ; division, fonctions SQL, sous-requêtes dans `SET` ; résultat de calcul de 15 chiffres ou plus ; `%DEC(x : p : d)` dont la partie entière dépasse `p - d` chiffres ; littéraux `.5` ; `SELECT … INTO` d'une structure de données entière (nommez les champs) ; `UPDATE`/`INSERT` sur une table vide sans colonnes déclarées (déclarez `columns` dans `context/tables.json`)
- **Fonctions intégrées** : `%len`, `%trim`, `%triml`, `%trimr`, `%subst`, `%scan`, `%replace`, `%check`, `%upper`, `%lower`, `%char`, `%int`, `%dec`, `%abs`, `%max`, `%min`, `%rem`, `%div`, `%status` (aussi sans parenthèses : `if %status = 1211;`), `%date`, `%time`, `%timestamp`, `%years`, `%months`, `%days`, `%hours`, `%minutes`, `%seconds`, `%mseconds`, `%diff`, `%subdt`
- **`DSPLY`** : `dsply message [file-de-messages [réponse]]` — la réponse `Y` est simulée

Pour se protéger d'une boucle ou d'une récursion infinie, l'exécution s'arrête au-delà de 1 000 000 d'itérations ou de 256 appels imbriqués.

## Dates et heures

Format *ISO uniquement : date `2026-10-04`, heure `13.45.00`, timestamp `2026-10-04-13.45.00.000000`.

- Déclarations `date`, `time`, `timestamp` (aussi `date(*ISO)`, `time(*ISO)`, `timestamp(6)`) ; sans `INZ` : `0001-01-01`, `00.00.00`, `0001-01-01-00.00.00.000000`
- Littéraux `D'2026-10-04'`, `T'13.45.00'`, `Z'2026-10-04-13.45.00.000000'` ; un littéral invalide est refusé à l'analyse
- `INZ(*SYS)` : instant présent ; `INZ(*JOB)` : date du jour (il n'y a pas de travail IBM i à simuler)
- `*LOVAL` / `*HIVAL` en `INZ`, en affectation et en comparaison (ils doivent être à droite de la comparaison : `d = *loval`)
- Comparaisons entre valeurs du même type ; mélanger les types (`date = 'texte'`, `'Le ' + date`, `date + 1`, `date - date`) est refusé comme à la compilation
- Durées `%YEARS`, `%MONTHS`, `%DAYS` (date), `%HOURS`, `%MINUTES`, `%SECONDS` (heure), toutes plus `%MSECONDS` (microsecondes) pour un timestamp, à droite d'un `+` ou d'un `-` : `fin = debut + %days(30) + %months(1);`. Mois ou année vers un jour inexistant : dernier jour du mois (`D'2026-01-31' + %months(1)` = `2026-02-28`). Résultat hors de `0001-01-01` … `9999-12-31` : statut **00113** (RNX0113)
- `%DIFF(a : b : *DAYS)` : nombre entier d'unités, tronqué vers zéro (mois entiers pour `*MONTHS`) ; `%SUBDT(d : *MONTHS)` : composante. Unités `*YEARS`/`*Y`, `*MONTHS`/`*M`, `*DAYS`/`*D`, `*HOURS`/`*H`, `*MINUTES`/`*MN`, `*SECONDS`/`*S`, `*MSECONDS`/`*MS`
- Refusés tant qu'ils ne sont pas vérifiés sur IBM i : heure qui passe minuit (`T'23.00.00' + %hours(2)`), durée à gauche (`%days(1) + d`), durée non entière, `%DIFF` entre types différents ou de deux timestamps en `*SECONDS`, calcul sur `24.00.00`, `%SUBDT` à 3 ou 4 arguments
- `%DATE()`, `%TIME()`, `%TIMESTAMP()` : instant présent ; avec un argument : conversion entre types ou lecture d'un texte *ISO. Texte invalide : statut **00112** (RNX0112), interceptable par `MONITOR`
- `%CHAR(x)` et `%CHAR(x : *ISO)`, `DSPLY` d'une variable date
- Bouchons : les dates s'écrivent en texte *ISO dans `programs.json` (`"fin": "2026-11-04"`)

## Fichiers natifs

`dcl-f` lit et écrit les mêmes données simulées que le SQL : la table de `context/tables.json` portant le nom du fichier. Pour un fichier natif, décrivez la table avec `schema` (les zones, dans l'ordre), et au besoin `keys` et `format` :

```json
{
  "CLIENT": {
    "format": "CLIENTF",
    "keys": ["NUMCLI"],
    "unique": true,
    "schema": { "NUMCLI": "packed(7:0)", "NOM": "char(10)", "SOLDE": "DECIMAL(9,2)", "CREE": "date", "ACTIF": "ind" },
    "data": [ { "NUMCLI": 1, "NOM": "Dupont", "SOLDE": 1500.50, "CREE": "2025-01-15", "ACTIF": "1" } ]
  }
}
```

- **Déclaration** : `dcl-f client;` (ordre d'arrivée des lignes), `dcl-f client keyed;` (ordre des `keys`), `usropn` (le fichier reste fermé jusqu'à `open`) ; `disk` et `disk(*ext)` sont acceptés. Les zones deviennent des variables globales du programme (une lecture dans une procédure les met à jour même si la procédure a une variable locale de même nom ; un `dcl-s`, une zone de `dcl-ds` ou un paramètre du programme de même nom et d'un autre type est refusé comme par le compilateur, de même type il est « pas encore supporté » ; une `dcl-c` ou une `dcl-ds` de même nom est un doublon), au type de leur colonne ; `format` vaut `<FICHIER>F` par défaut et peut remplacer le nom du fichier dans `read`, `readp`, `reade`, `readpe`.
- **Types de zones** : `char(n)`, `varchar(n)`, `packed`/`decimal`, `zoned`/`numeric`, `int`, `uns`, `smallint`, `bigint`, `ind`, `date`, `time`, `timestamp` ; les dates et heures s'écrivent en texte *ISO dans `data`, les indicateurs `"1"`/`"0"`.
- **Opérations** : `read`, `readp`, `reade`, `readpe`, `chain`, `setll`, `setgt` (clé simple ou liste `(a : b)`, clé partielle acceptée, `*start`/`*loval`/`*end`/`*hival`), `open`, `close`. `chain` sur un fichier sans clé lit par numéro d'enregistrement (valeur numérique entière). Après une lecture (`read`, `readp`, `reade`, `readpe`, `chain` trouvé), le fichier est positionné sur l'enregistrement lu : `read` lit le suivant, `readp` le précédent.
- **Fonctions** : `%eof`, `%found`, `%equal`, `%open`, avec un nom de fichier ou de format, ou sans argument (dernière opération qui a positionné cet indicateur). `setll`, `setgt` et `chain` trouvé remettent `%eof(fichier)` à `*OFF` (`%eof` sans argument est inchangé) ; après un `chain` non trouvé, lire `%eof(fichier)` avant une nouvelle lecture est « pas encore supporté ».
- **USAGE** : `usage(*input)` (défaut), `usage(*output)`, `usage(*update)` (avec lecture), `usage(*delete)` (avec mise à jour et lecture), combinables avec `:` (un même mot répété est une erreur). Une opération non permise par l'`USAGE` est une erreur de l'interpréteur (`WRITE` sans `*OUTPUT`, `UPDATE` sans `*UPDATE`, `DELETE` sans `*DELETE`), signalée avant l'exécution du programme, même dans une branche ou une procédure jamais exécutée (comme le nom de fichier au lieu du format pour `write`/`update`, ou un fichier inconnu). Un fichier en `*UPDATE` ou `*DELETE` verrouille chaque enregistrement lu.
- **Écriture** : `write`, `update` prennent le nom du **format** (`write clientf;`, pas `write client;`) et utilisent les zones du fichier, variables globales du programme (dans une procédure, une variable locale de même nom ne les masque pas) ; `delete` accepte le nom du fichier ou du format : `delete clientf;` supprime l'enregistrement courant, `delete cle clientf;` supprime par clé complète (`%FOUND` indique si elle existait ; trouvée, il n'y a plus d'enregistrement courant et la position est perdue : relire ou repositionner avant `read`, `update` ou `delete`). `unlock fichier;` (fichier en `*UPDATE`) libère l'enregistrement courant. `write` ajoute en fin de table sans changer la position de lecture ; `update` réécrit l'enregistrement lu en dernier (un `chain` ou un `read` réussi) ; ils sont vus aussitôt par le SQL et par les autres ouvertures du fichier. Une zone `char` est écrite sans ses blancs de fin, une zone `varchar` telle quelle.
- **Clé unique** : avec `"unique": true` dans la table, un `write` ou un `update` qui crée une clé déjà présente échoue en statut **01021** (RNX1021), interceptable par `MONITOR`/`ON-ERROR 01021` ; en SQL, `INSERT` ou `UPDATE` donne `SQLCOD` -803. Des données de `tables.json` qui contiennent déjà une clé en double sont une erreur au `dcl-f`. `update` ou `delete` sans enregistrement lu (ou déjà mis à jour ou supprimé) : statut **01221** (RNX1221). Une zone clé modifiée avant `update` est acceptée ; la lecture séquentielle suivante, dont la position IBM i n'est pas vérifiée, est refusée.
- **Verrous** : l'enregistrement lu par un fichier en mise à jour est verrouillé jusqu'à l'`update`, le `delete`, l'`unlock`, une autre lecture, un `setll`/`setgt`, la fermeture du fichier ou la fin du programme. Lire un enregistrement tenu par une autre ouverture (par exemple dans un programme appelé), ou le modifier ou le supprimer en SQL, est « pas encore supporté » (l'attente de verrou n'est pas simulée).
- **Ordre des clés caractère** : l'ordre EBCDIC d'IBM i (minuscules avant majuscules avant chiffres). Un caractère hors du jeu invariant dans une clé est refusé.
- **Données** : une zone absente ou `null` dans une ligne de `tables.json`, ou une valeur qui ne tient pas dans sa zone (texte trop long, trop de chiffres ou de décimales) est une erreur. Un `INSERT` SQL qui omet des colonnes d'une table décrite par `schema` leur donne la valeur par défaut IBM i (blanc, zéro, `'0'`, `0001-01-01`, `00.00.00`, `0001-01-01-00.00.00.000000`).
- **Statuts** : opération sur un fichier `usropn` non ouvert : 01211 (RNX1211) ; `open` d'un fichier déjà ouvert : 01215 (RNX1215). `open` remet `%EOF`, `%FOUND` et `%EQUAL` du fichier à `*OFF` et repositionne au début. Ils sont interceptables par `MONITOR`/`ON-ERROR 01211` ou `*FILE`.
- **Données partagées avec le SQL** : un `INSERT`, `UPDATE` ou `DELETE` est vu par les lectures suivantes. Un programme appelé a sa propre position dans le fichier.
- **Refusé** (« pas encore supporté ») : `PREFIX`, `RENAME` et autres mots-clés de `dcl-f`, `%KDS`, `READE`/`READPE` sans clé, extenseurs d'opération (`chain(e)`), `delete` par clé partielle, `update` ou `delete` sans nouvelle lecture après `setll`/`setgt`, un `delete` par clé, un `write` (effet sur le verrou de l'enregistrement courant non vérifié) ou un `update` en échec 01021, `unlock` d'un fichier sans `*UPDATE`, `update` ou `delete` d'un enregistrement supprimé entre-temps, `%FIELDS`, écriture depuis une structure de données, lecture séquentielle après un `CHAIN` non trouvé, après une fin de fichier, après un `READE`/`READPE` sans correspondance ou après un `delete` par clé, `CHAIN` par numéro d'enregistrement après une suppression (y compris par un programme appelant) ou avec un rang non entier, `setll`/`setgt`/`reade`/`readpe` par valeur sur un fichier sans clé, valeur de clé qui ne tient pas dans la zone clé, `close` d'un fichier déjà fermé, `disk(…)` autre que `*ext`, fichiers écran et impression.

## Limites connues

- Fichiers natifs : pas d'écrans ni d'impressions ; pas encore de `%FIELDS`, d'écriture depuis une structure de données, ni d'extenseurs `(E)`/`(N)`
- Pas de tableaux (`dim`), ni de `float`
- Pas de sous-routines (`BEGSR`/`EXSR`), de `LIKE`/`LIKEDS`/`EXTNAME`, de `/COPY`, ni de paramètres pour le programme principal
- `ctl-opt` est accepté mais ses options sont ignorées, sauf `DATFMT`/`TIMFMT` (seul `*ISO` est accepté)
- Un programme appelé repart toujours de zéro, comme s'il s'était terminé avec `*INLR = *ON` : ses variables ne sont pas conservées d'un appel à l'autre
- Seul le dossier du programme exécuté est cherché pour les sources appelés
- SQL : pas de curseurs, de jointures, de `ORDER BY` ni de `LIKE`
- `%char` ne connaît les décimales que d'une variable passée directement : `%char(total + 1)` affiche `16`, pas `16.00`
- Calculs en virgule flottante JavaScript (environ 15 chiffres significatifs)
- Dates : pas encore de formats autres que *ISO, de conversion numérique ↔ date, ni de dates en SQL

## Développement

```bash
npm install
npm test          # compile puis lance les tests (node:test)
npm run watch     # recompile à chaque modification
npm run package   # crée le paquet .vsix installable (Extensions → … → Installer depuis un VSIX)
```

Dans VS Code, **F5** lance une fenêtre de développement avec l'extension chargée, ouverte sur ce dépôt : les exemples de `fichiers_test/` et le contexte `context/` y sont directement utilisables.

| Dossier | Contenu |
|---|---|
| `src/` | Lexer, parser, interpréteur, runtime, moteur SQL, types RPG |
| `test/` | Tests unitaires et de non-régression |
| `fichiers_test/`, `test.rpgle` | Programmes d'exemple |
| `context/` | Données SQL et bouchons de programmes pour les exemples |

Les tests sont lancés par GitHub Actions à chaque push sur `main` et à chaque pull request.
