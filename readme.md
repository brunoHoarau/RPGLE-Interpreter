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

## Langage supporté

- **Déclarations** : `ctl-opt` (ignoré), `dcl-s`, `dcl-c`, `dcl-ds` qualifiées (champs insensibles à la casse)
- **Types** : `char(n)` à longueur fixe, `varchar(n)`, `int`/`uns(3|5|10|20)`, `packed`/`zoned(p:d)`, `ind`. Troncature à l'affectation et dépassement de capacité (RNX0103) comme en RPG
- **Expressions** : priorités RPG (`OR` < `AND` < `NOT` < comparaisons < `+ -` < `* /` < `**` < signe), comparaison des chaînes sans tenir compte des blancs de fin
- **Contrôle** : `IF`/`ELSEIF`/`ELSE`, `SELECT`/`WHEN`/`OTHER`, `DOW`, `DOU`, `FOR … TO|DOWNTO … BY`, `LEAVE`, `ITER`, `RETURN`, `MONITOR`/`ON-ERROR`
- **Procédures** : `dcl-proc`/`dcl-pi`, paramètres par référence, `VALUE`, `CONST`, `OPTIONS(*NOPASS)`, variables locales, récursion, appel dans une expression, `CALLP`, prototypes `dcl-pr` (ignorés)
- **SQL embarqué** : `SELECT … INTO`, `INSERT`, `UPDATE`, `DELETE` ; clause `WHERE` avec `AND`/`OR`/`NOT`, parenthèses, `IS [NOT] NULL` ; variables hôtes ; `SQLCOD` et `SQLSTT`. Une clause non reconnue renvoie une erreur (`SQLCOD` négatif) et ne modifie aucune ligne
- **Fonctions intégrées** : `%len`, `%trim`, `%triml`, `%trimr`, `%subst`, `%scan`, `%replace`, `%check`, `%upper`, `%lower`, `%char`, `%int`, `%dec`, `%abs`, `%max`, `%min`, `%rem`, `%div`
- **`DSPLY`** : message, variable de réponse (la réponse `Y` est simulée), file d'attente

Pour se protéger d'une boucle ou d'une récursion infinie, l'exécution s'arrête au-delà de 1 000 000 d'itérations ou de 256 appels imbriqués.

## Limites connues

- Pas de fichiers natifs (`dcl-f`, `read`, `chain`, `setll`…), de tableaux (`dim`), de dates ni de `float`
- SQL : pas de curseurs, de jointures, de `ORDER BY` ni de `LIKE`
- `%char` ne connaît les décimales que d'une variable passée directement : `%char(total + 1)` affiche `16`, pas `16.00`
- Calculs en virgule flottante JavaScript (environ 15 chiffres significatifs)

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
| `context/` | Données SQL simulées pour les exemples |

Les tests sont lancés par GitHub Actions à chaque push sur `main` et à chaque pull request.
