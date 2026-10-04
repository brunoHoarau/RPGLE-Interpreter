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


Tout ce qui n'est pas listé ici est **refusé dès l'analyse**, avec la ligne et un message « pas encore supporté par l'interpréteur » (soulignement rouge dans l'éditeur) : un programme qui s'exécute ici n'a rien sauté en silence.


- **Déclarations** : `ctl-opt` (options ignorées, sauf `DATFMT`/`TIMFMT` : seul `*ISO` est accepté), `dcl-s`, `dcl-c`, `dcl-ds` qualifiées (`ds.champ`) ou non qualifiées (champs utilisables directement), champs insensibles à la casse
- **Types** : `char(n)` à longueur fixe, `varchar(n)`, `int`/`uns(3|5|10|20)`, `packed`/`zoned(p:d)`, `ind`, `date`, `time`, `timestamp` (voir ci-dessous). Troncature à l'affectation et dépassement de capacité (RNX0103) comme en RPG
- **Expressions** : priorités RPG (`OR` < `AND` < `NOT` < comparaisons < `+ -` < `* /` < `**` < signe), comparaison des chaînes sans tenir compte des blancs de fin
- **Affectation** : `x = …`, `EVAL x = …` (sans extenseur), indicateurs `*INLR` et `*IN01` à `*IN99`, valeurs `*ON`, `*OFF`, `*BLANK(S)`, `*ZERO(S)`
- **Contrôle** : `IF`/`ELSEIF`/`ELSE`, `SELECT`/`WHEN`/`OTHER`, `DOW`, `DOU`, `FOR … TO|DOWNTO … BY`, `LEAVE`, `ITER`, `RETURN`, `MONITOR`/`ON-ERROR` avec codes de statut (`on-error 00102 : 00103;`, `*PROGRAM`, `*FILE`, `*ALL`). Seules les erreurs d'exécution RPG (division par zéro 00102, dépassement 00103, conversion 00105) sont interceptées
- **Procédures** : `dcl-proc`/`dcl-pi`, paramètres par référence, `VALUE`, `CONST`, `OPTIONS(*NOPASS)`, variables locales, récursion, appel dans une expression, `CALLP`, prototypes `dcl-pr` (`EXTPGM`, `EXTPROC`, voir les bouchons ci-dessus)
- **SQL embarqué** : `SELECT … INTO`, `INSERT`, `UPDATE`, `DELETE` ; clause `WHERE` avec `AND`/`OR`/`NOT`, parenthèses, `IS [NOT] NULL` ; variables hôtes ; `SQLCOD` et `SQLSTT`. Une clause non reconnue renvoie une erreur (`SQLCOD` négatif) et ne modifie aucune ligne
- **Fonctions intégrées** : `%len`, `%trim`, `%triml`, `%trimr`, `%subst`, `%scan`, `%replace`, `%check`, `%upper`, `%lower`, `%char`, `%int`, `%dec`, `%abs`, `%max`, `%min`, `%rem`, `%div`, `%status`, `%date`, `%time`, `%timestamp`
- **`DSPLY`** : message, variable de réponse (la réponse `Y` est simulée), file d'attente

Pour se protéger d'une boucle ou d'une récursion infinie, l'exécution s'arrête au-delà de 1 000 000 d'itérations ou de 256 appels imbriqués.

## Dates et heures

Format *ISO uniquement : date `2026-10-04`, heure `13.45.00`, timestamp `2026-10-04-13.45.00.000000`.

- Déclarations `date`, `time`, `timestamp` (aussi `date(*ISO)`, `time(*ISO)`, `timestamp(6)`) ; sans `INZ` : `0001-01-01`, `00.00.00`, `0001-01-01-00.00.00.000000`
- Littéraux `D'2026-10-04'`, `T'13.45.00'`, `Z'2026-10-04-13.45.00.000000'` ; un littéral invalide est refusé à l'analyse
- `INZ(*SYS)` : instant présent ; `INZ(*JOB)` : date du jour (il n'y a pas de travail IBM i à simuler)
- `*LOVAL` / `*HIVAL` en `INZ`, en affectation et en comparaison
- Comparaisons entre valeurs du même type ; mélanger les types (`date = 'texte'`, `'Le ' + date`, `date + 1`) est refusé comme à la compilation
- `%DATE()`, `%TIME()`, `%TIMESTAMP()` : instant présent ; avec un argument : conversion entre types ou lecture d'un texte *ISO. Texte invalide : statut **00112** (RNX0112), interceptable par `MONITOR`
- `%CHAR(x)` et `%CHAR(x : *ISO)`, `DSPLY` d'une variable date
- Bouchons : les dates s'écrivent en texte *ISO dans `programs.json` (`"fin": "2026-11-04"`)

## Limites connues

- Pas de fichiers natifs (`dcl-f`, `read`, `chain`, `setll`…), de tableaux (`dim`), ni de `float`
- Pas de sous-routines (`BEGSR`/`EXSR`), de `LIKE`/`LIKEDS`/`EXTNAME`, de `/COPY`, ni de paramètres pour le programme principal
- `ctl-opt` est accepté mais ses options sont ignorées
- Un programme appelé repart toujours de zéro, comme s'il s'était terminé avec `*INLR = *ON` : ses variables ne sont pas conservées d'un appel à l'autre
- Seul le dossier du programme exécuté est cherché pour les sources appelés
- SQL : pas de curseurs, de jointures, de `ORDER BY` ni de `LIKE`
- `%char` ne connaît les décimales que d'une variable passée directement : `%char(total + 1)` affiche `16`, pas `16.00`
- Calculs en virgule flottante JavaScript (environ 15 chiffres significatifs)
- Dates : pas encore d'arithmétique (`%DAYS`, `%DIFF`, `%SUBDT`…), de formats autres que *ISO, de conversion numérique ↔ date, ni de dates en SQL

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
