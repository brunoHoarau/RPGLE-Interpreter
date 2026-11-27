# RPGLE Interpreter — guide de travail

Extension VS Code qui interprète du RPGLE free-form sans compilation, pour tester ses programmes sans AS400.
Fidélité au comportement IBM i ; tout ce qui n'est pas supporté est **refusé explicitement** (jamais approximé).

## Règle d'or : ne lire que ce qu'on modifie

Ne jamais lire un dossier entier. Utiliser la carte ci-dessous, puis `grep -n` pour trouver la ligne, puis lire une tranche.
Aucun fichier de `src/` ni de `test/*.test.js` ne dépasse 400 lignes (contrôlé par `npm run check-size`) : si un fichier grossit au-delà, le découper.

## Carte du code

```
source → src/lexer.ts → src/parser/ (AST, types dans src/types.ts) → src/interpreter/ (exécution)
```

| Dossier / fichier | Rôle |
|---|---|
| `src/lexer.ts` | Tokens ; mots-clés dans la table vers la ligne 290 (`'dsply': TokenType.DSPLY`) |
| `src/types.ts` | Types de tokens et nœuds de l'AST (`XxxNode`) |
| `src/parser/index.ts` | `Parser.parse()` : aiguillage des déclarations de premier niveau |
| `src/parser/state.ts` | `ParserState` : curseur (check/peek/advance/expect) et noms connus |
| `src/parser/constants.ts` | Tables : opcodes refusés, `BUILTIN_ARITY`, BIF sans argument, valeurs spéciales |
| `src/parser/declarations/` | dcl-s, dcl-c, dcl-ds, mots-clés de déclaration, types de données |
| `src/parser/procedures.ts` | dcl-proc, dcl-pr, dcl-pi, paramètres |
| `src/parser/files.ts` | dcl-f, USAGE, opérations fichier (CHAIN, READ…) |
| `src/parser/statements/` | `statement.ts` = aiguillage des instructions ; `control.ts` (if/select/do/for/monitor) ; `assignment.ts` ; `io.ts` (dsply, SQL) |
| `src/parser/expressions/` | `operators.ts` (précédence) ; `primary.ts` (littéraux, noms, appels de BIF) |
| `src/interpreter/index.ts` | `Interpreter` (API publique) ; état dans `state.ts` |
| `src/interpreter/program.ts` | `executeNode` = aiguillage des nœuds vers leur exécution |
| `src/interpreter/control-flow.ts`, `statements.ts`, `declarations.ts`, `calls.ts` | Exécution par famille |
| `src/interpreter/evaluate/` | Évaluation des expressions, opérateurs, dates |
| `src/interpreter/files/` | Déclaration et opérations sur fichiers natifs côté exécution |
| `src/builtins.ts` | Table `BUILTINS` : implémentation des BIF |
| `src/datatypes.ts`, `src/datetime.ts` | Sémantique des types RPG (packed, zoned, char…) et des dates |
| `src/runtime.ts` | Variables, portée, appel des BIF |
| `src/files/` | Fichier natif simulé (`NativeFile`) : clés, lecture, écriture, verrous |
| `src/sql-engine/` | Émulation DB2 pour le SQL embarqué |
| `src/copybooks.ts` | Directives /COPY, /INCLUDE, /EOF (appelées par le lexer) et recherche des membres sur disque |
| `src/context.ts`, `src/sources.ts` | Données de test (tables, fichiers) et sources de programmes appelés |
| `src/extension.ts` | Intégration VS Code |

Le parser et l'interpréteur sont des **fonctions libres** prenant l'état en premier paramètre (`p: ParserState`, `s: InterpreterState`).

## Recettes

**Ajouter une BIF** : test dans le fichier de test du domaine → implémentation dans `BUILTINS` (`src/builtins.ts`) → si arité fixe ou sans argument : `src/parser/constants.ts` → cas particulier d'évaluation éventuel dans `src/interpreter/evaluate/evaluate.ts`.

**Ajouter une instruction / un opcode** : mot-clé dans `src/lexer.ts` → nœud dans `src/types.ts` → analyse dans `src/parser/statements/` (+ branche dans `statement.ts`) → exécution dans `src/interpreter/` (+ `case` dans `program.ts`). Retirer l'opcode de la liste des refus de `constants.ts` s'il y figure.

**Ajouter un mot-clé de déclaration** : `src/parser/declarations/keywords.ts` → prise en compte à l'exécution dans `src/interpreter/declarations.ts`.

**Refuser une construction non supportée** : `unsupported(...)` (`src/parser/constants.ts`) avec un message en français ; test dans `test/unsupported-*.test.js`.

## Tests (TDD obligatoire)

- Helpers : `const { run, runRaw, parse } = require('./helpers')` ; `run(source)` renvoie les lignes affichées par DSPLY.
- Fichiers `test/<domaine>[-<sous-domaine>].test.js` ; ajouter au fichier du thème (en créer un si > 380 lignes).
- Le test rouge d'abord, puis le code, puis le vert.
- **Ne jamais lire un fichier de test en entier** (sauf réécriture) : `grep -n "^test(" fichier` pour la structure, lire UN test voisin comme modèle, ajouter.
- Pendant le développement, ne lancer que ce qui est concerné :
  - `node scripts/check.js test/ecrans*.test.js` — compile + ces fichiers seulement, sortie minimale ;
  - `node --test --test-name-pattern="EXFMT" test/ecrans-operations.test.js` — un seul test (après compilation).
- Vérifier un comportement sans lire de code : `npm run --silent rpg -- fichier.rpgle [--context dossier]` (sortie DSPLY ou erreur) ;
  voir ce que produit le parser : `npm run --silent ast -- "dcl-s x int(10);"` (ou `--file f.rpgle`).

## Contrôles mécaniques (avant tout commit de code)

```
npm run --silent check   # compile, tous les tests, taille — 1 ligne si vert, sinon le 1er échec tronqué
```

Commit sans code (doc, config) : pas de contrôle.

Ces contrôles remplacent une relecture par un modèle pour tout ce qu'ils couvrent. Une relecture humaine/modèle ne porte que sur la fidélité au comportement RPG.

## Économie de tokens

- **Une session par incrément** ; `/clear` entre deux incréments. La longueur de la conversation principale est le premier poste de coût (mesuré : 472k tokens de contexte médian par appel sur une session de 15 h).
- La session principale orchestre ; le travail lourd va aux sous-agents, chacun dans son contexte.
- Modèle par tâche :

| Tâche | Modèle |
|---|---|
| Recherche dans le code, lancer les tests, tâches mécaniques | `haiku` |
| Implémentation d'une tâche spécifiée, refactoring | `sonnet` |
| Relecture de fidélité RPG ciblée | `sonnet` |
| Conception, débogage difficile, arbitrage de sémantique IBM i | `opus` (session principale) |

- Processus proportionné : plan court (≤ 150 lignes) pour un incrément ; pas de plan pour une BIF ou un petit opcode.
- Références RPG locales : `skills/INDEX.md` (jamais committé) ; grep avant de lire.
- Sous-agent seulement pour une implémentation longue et spécifiée ; quelques appels d'outils → les faire soi-même.
  Pour une session d'implémentation, préférer `/model sonnet` dans la session principale ; `/compact` dès qu'elle s'allonge.
- Pas de relecture finale par un modèle ; relecture ciblée seulement sur un point de sémantique IBM i douteux.

### Sorties et lectures

- Filtrer toute commande bavarde : `git diff --stat`, `git log --oneline -5`, `npm run --silent`, `| tail -n 20`.
  Filet : `.claude/settings.json` plafonne la sortie des commandes (`bashOutputMaxChars`).
- `grep` en deux temps : fichiers ou nombre de correspondances d'abord, lignes ensuite (avec limite).
- Ne jamais relire un fichier qu'on vient de modifier ni un fichier déjà lu dans la conversation.
- Specs et plans : grep de la section utile, pas de lecture complète.
- Ne pas recopier dans le chat le code écrit dans les fichiers.

### Réponses

- Courtes par défaut (10 à 15 lignes en discussion) ; pas de tableaux ni d'exemples de code non demandés ;
  pas de reformulation de la demande ; questions groupées en une fois.

## Git

- Une branche par incrément ; fusion dans `main` **uniquement sur demande**.
- Ne jamais committer `skills/` ni `repomix-output.xml`.
- Messages de commit en français.
