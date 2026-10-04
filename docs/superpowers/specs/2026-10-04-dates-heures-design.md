# Dates et heures — conception

Date : 2026-10-04 · Statut : validé en discussion, à relire

## Objectif

Permettre d'exécuter dans l'interpréteur des programmes RPGLE qui manipulent des
dates, heures et horodatages (`DATE`, `TIME`, `TIMESTAMP`), avec le même
comportement que sur IBM i. La cible finale est la couverture complète ; elle est
livrée en incréments, une branche par incrément, fusionnée sur demande.

Règle constante : tout ce qui n'est pas encore livré est **refusé explicitement**
(« pas encore supporté par l'interpréteur »), jamais ignoré ni approximé.

## Incréments

| # | Incrément | Contenu |
|---|-----------|---------|
| 1 | Socle *ISO | Déclarations, littéraux, `INZ(*SYS/*JOB)`, `*LOVAL/*HIVAL`, affectation, comparaisons, `%DATE/%TIME/%TIMESTAMP`, `%CHAR`, `DSPLY` — détaillé ci-dessous |
| 2 | Arithmétique | `+`/`-` avec `%DAYS %MONTHS %YEARS %HOURS %MINUTES %SECONDS %MSECONDS`, `%DIFF`, `%SUBDT` (et `%SUBDT(…:*DAYS)` etc.), statut d'erreur en cas de dépassement de bornes |
| 3 | Formats | `DATFMT`/`TIMFMT` en déclaration et en `CTL-OPT`, formats `*MDY *DMY *YMD *JUL *EUR *USA *JIS *ISO *HMS *CYMD *CMDY *CDMY *LONGJUL`, séparateurs explicites, variantes sans séparateur (`*ISO0`…), `%CHAR(x : format)`, `timestamp(n)` |
| 4 | Conversions numérique ↔ date | `%DATE(num : fmt)`, `%TIME(num : fmt)`, `%TIMESTAMP(num)`, `%DEC(date : fmt)`, `%DATE(texte : fmt)` |
| 5 | SQL | Variables hôtes date/heure dans `EXEC SQL`, colonnes date dans les données simulées, `CURRENT DATE` / `CURRENT TIMESTAMP` |

Chaque incrément ultérieur fera l'objet d'une courte conception validée avant
implémentation ; le présent document détaille l'incrément 1.

## Incrément 1 — Socle *ISO

### Comportement attendu (vu du programme RPG)

**Déclarations** — `dcl-s d date;`, `dcl-s t time;`, `dcl-s z timestamp;` partout
où un type est accepté : variables, sous-champs de DS, paramètres, valeurs de
retour de procédures et de prototypes.

Valeurs par défaut sans `INZ` :

| Type | Défaut |
|------|--------|
| date | `0001-01-01` |
| time | `00.00.00` |
| timestamp | `0001-01-01-00.00.00.000000` |

(Corrige le comportement actuel qui donnait la date du jour à une date sans `INZ`.)

**Initialisation**
- `INZ(D'2026-10-04')`, `INZ(T'13.45.00')`, `INZ(Z'2026-10-04-13.45.00.000000')`.
- `INZ(*SYS)` : instant présent au moment de la déclaration (démarrage du programme).
- `INZ(*JOB)` : date du jour (pas de travail IBM i à simuler ; documenté dans le README).
- Littéral invalide (`D'2026-02-30'`, `T'25.00.00'`) : **erreur d'analyse**, comme à la compilation.

**Littéraux** — `D'aaaa-mm-jj'`, `T'hh.mm.ss'`, `Z'aaaa-mm-jj-hh.mm.ss.ffffff'`.
La lettre doit être collée à l'apostrophe ; minuscules acceptées. En incrément 1,
seule la forme *ISO est reconnue (`T'13:45:00'` est refusé comme invalide jusqu'à
l'incrément 3, où les séparateurs alternatifs seront traités).

**Valeurs spéciales**
- `*LOVAL` / `*HIVAL` affectées ou comparées à une date/heure/timestamp :
  `0001-01-01` / `9999-12-31`, `00.00.00` / `24.00.00`,
  `0001-01-01-00.00.00.000000` / `9999-12-31-24.00.00.000000`.
- `*LOVAL` / `*HIVAL` vers un autre type : « pas encore supporté ».
- `*SYS` / `*JOB` n'ont de sens qu'en `INZ` d'une date/heure/timestamp.

**Expressions**
- Affectation entre valeurs de même type.
- Comparaisons `= <> < <= > >=` entre valeurs de même type.
- Mélange de types (`date = 'texte'`, `date = timestamp`, `'Le ' + date`,
  `date + 1`, `date > 20261004`) : erreur explicite précisant que le compilateur
  IBM i le refuserait. Ce n'est pas une erreur d'exécution RPG : `MONITOR` ne
  l'intercepte pas.
- `%DATE()`, `%TIME()`, `%TIMESTAMP()` sans argument : instant présent.
- `%DATE(timestamp)`, `%TIME(timestamp)`, `%TIMESTAMP(date)` (minuit),
  `%DATE(date)`, `%TIME(time)`, `%TIMESTAMP(timestamp)` (identité).
- `%DATE(texte)`, `%TIME(texte)`, `%TIMESTAMP(texte)` : texte au format *ISO,
  espaces de fin ignorés. Texte invalide : **statut 112** (RNX0112), interceptable
  par `MONITOR` / `ON-ERROR 112`, visible par `%STATUS`.
- `%DATE`/`%TIME`/`%TIMESTAMP` avec un argument numérique ou un 2ᵉ argument de
  format : « pas encore supporté » (incréments 3 et 4).
- `%CHAR(x)` : `2026-10-04`, `13.45.00`, `2026-10-04-13.45.00.000000`.
- `%CHAR(x : *ISO)` : même résultat (usage courant). Tout autre format en 2ᵉ
  argument de `%CHAR` : « pas encore supporté » (incrément 3).
- `DSPLY x` avec une variable date/heure/timestamp : affiche le même texte.

**Refus explicites maintenus** (« pas encore supporté »)
- Format autre que *ISO en déclaration : `date(*EUR)`, `time(*HMS)`…
  (`date(*ISO)` et `time(*ISO)` sont acceptés).
- `CTL-OPT DATFMT(…)` / `TIMFMT(…)` autre que `*ISO` (ces deux options ne sont
  plus ignorées ; les autres options de `CTL-OPT` restent ignorées comme aujourd'hui).
- `timestamp(n)` avec n ≠ 6.
- `%DAYS %MONTHS %YEARS %HOURS %MINUTES %SECONDS %MSECONDS %DIFF %SUBDT`
  (déjà refusées car absentes de la table des BIF ; un test le vérifie).
- Variable hôte date/heure/timestamp dans `EXEC SQL`.

### Architecture

**Nouveau module `src/datetime.ts`** — sans dépendance au reste de l'interpréteur.
- Classes immuables `RpgDate(year, month, day)`, `RpgTime(hour, minute, second)`,
  `RpgTimestamp(date, time, microseconds)` ; microsecondes en entier.
- Calendrier : bissextiles grégoriennes, jours par mois, bornes années 1–9999,
  `24.00.00` admis uniquement comme valeur exacte (comme IBM i).
- `parseIso(kind, text)` : lecture stricte, renvoie la valeur ou `undefined`.
- `toString()` : texte *ISO (sert à `%CHAR`, `DSPLY`, messages).
- `compareDateTime(a, b)`, `lowValue(kind)`, `highValue(kind)`,
  `fromClock(kind, jsDate)` (composantes en heure locale, millisecondes × 1000).
- `isDateTime(value)` et `kindOf(value)` pour les contrôles de type.

**Branchements**

| Fichier | Changement |
|---------|------------|
| `lexer.ts` | Token `DATETIME_LITERAL` pour `D'…'`, `T'…'`, `Z'…'` (valeur : genre + texte) |
| `parser.ts` | Validation des littéraux (erreur d'analyse), types date/time/timestamp débloqués, refus des formats non *ISO, de `timestamp(n≠6)` et de `CTL-OPT DATFMT/TIMFMT` non *ISO ; `*SYS *JOB *LOVAL *HIVAL` acceptées |
| `datatypes.ts` | `defaultValue` corrigé ; `coerce` contrôle le type des dates (erreur de type « compilation ») ; `formatChar` via `toString()` |
| `builtins.ts` | `%DATE`, `%TIME`, `%TIMESTAMP` ; `BuiltinContext.now()` |
| `interpreter.ts` / `runtime.ts` | `compare()` sait comparer les dates ; opérateurs arithmétiques et concaténation refusés avec une date ; horloge `options.clock` (défaut `() => new Date()`) transmise au runtime |
| `sql-engine.ts` | Variable hôte date/heure refusée explicitement |
| `README.md` | Section « Dates et heures », mise à jour des limites connues |

Les erreurs de type « compilation » utilisent `Error` simple (non interceptable
par `MONITOR`) ; les valeurs invalides à l'exécution utilisent `RpgError` avec un
nouveau statut `STATUS_INVALID_DATE = 112`.

### Tests (TDD)

- `test/datetime.test.js` : calendrier (29/02/2024 valide, 29/02/2023 et
  29/02/1900 invalides, 29/02/2000 valide, 31/04 invalide, bornes 0001 et 9999,
  `24.00.00`, microsecondes sur 6 chiffres), `toString`, comparaisons.
- `test/dates.test.js` : programmes RPG exécutés avec une horloge figée —
  défauts, littéraux, `INZ(*SYS/*JOB)`, `*LOVAL/*HIVAL`, comparaisons,
  conversions, `%CHAR`, `DSPLY`, statut 112 intercepté par `MONITOR`, dates en
  DS, paramètres et retour de procédure, erreurs de type non interceptées.
- `test/unsupported.test.js` : retrait du refus de `date/time/timestamp` ; ajout
  des refus `date(*EUR)`, `ctl-opt datfmt(*eur)`, `timestamp(3)`, `%days`,
  `%diff`, variable hôte date en SQL, `*LOVAL` vers un `char`.
