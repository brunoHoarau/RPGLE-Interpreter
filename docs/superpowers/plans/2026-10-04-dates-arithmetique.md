# Dates et heures — arithmétique : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les durées (`%YEARS` … `%MSECONDS`), l'addition/soustraction de durées aux dates, heures et timestamps, `%DIFF` et `%SUBDT`, avec la sémantique IBM i et un refus explicite de tout point incertain.

**Architecture:** Le calcul pur (numéro de jour continu, fin de mois, retenues en microsecondes via `BigInt`, `%DIFF`, `%SUBDT`) va dans `src/datetime.ts`, qui reste autonome et renvoie des motifs d'échec (`'overflow'`, `'wrap'`…) ; l'interpréteur et les fonctions intégrées traduisent ces motifs en erreurs RPG. Une durée est une valeur `RpgDuration` qui n'est admise qu'à droite d'un `+`/`-` dont la gauche est une date.

**Tech Stack:** TypeScript 5 (strict, ES2020 → `BigInt` disponible, CommonJS), tests `node:test` sur le JS compilé dans `out/`.

**Spec:** `docs/superpowers/specs/2026-10-04-dates-heures-design.md` (section « Incrément 2 — Arithmétique »).

## Global Constraints

- Branche `feat/dates-arithmetique` ; fusion dans `main` uniquement quand l'utilisateur dit « fusionne ».
- Ne jamais committer `skills/` ni `fichiers_test/tstpgm.rpgle` : toujours `git add` fichier par fichier. Le README est suivi sous le nom `readme.md`.
- Non supporté / incertain : erreur dont le message contient « pas encore supporté par l'interpréteur ».
- Refusé par le compilateur IBM i : `incompatibleTypes(...)` de `src/errors.ts` (Error simple, message « types incompatibles », non interceptée par `MONITOR`).
- Date ou timestamp hors de `0001-01-01` … `9999-12-31` après calcul : `RpgError` statut **113**, message contenant `RNX0113`.
- `%MSECONDS` = microsecondes (comme sur IBM i).
- Mois/années : jour ramené au dernier jour du mois d'arrivée s'il n'existe pas.
- `%DIFF` : entier tronqué vers zéro ; mois entiers pour `*MONTHS`, mois entiers ÷ 12 tronqué pour `*YEARS`.
- Commandes : un fichier = `npm run compile && node --test test/<fichier>.test.js` ; tout = `npm test`.
- Messages de commit en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Les fichiers mélangent fins de ligne CRLF/LF : préserver celles de chaque fichier.
- Si TypeScript signale « Function lacks ending return statement » (TS2366) sur une fonction terminée par un `switch` exhaustif (`subdt`, `applyDuration`, `diff`), ajouter après le `switch` : `throw new Error(\`Cas imprévu : ${…}\`);` avec la variable du `switch`.

## Review Focus

1. Une durée qui s'échappe de sa seule position légale (`DSPLY %days(1)`, `%char(%days(1))`, `%len(%days(1))`, `if %days(1)`) ne doit jamais s'afficher ni se convertir en silence → test de la tâche 2.
2. Un grand décalage sur un timestamp (`%hours(24 * 146097)`, plus de 2^53 microsecondes) doit rester exact → tests des tâches 1 et 2.
3. Un `%DIFF` négatif ou partiel (`debut` après `fin`, 59 minutes en `*HOURS`) doit tronquer vers zéro sans `-0` → tâche 1.
4. Les abréviations d'unité (`*M` = mois, `*MN` = minutes, `*MS` = microsecondes), en majuscules ou minuscules → tâches 1 et 3.
5. Un `%DIFF` / `%SUBDT` avec le mauvais nombre d'arguments doit donner un message clair, pas une erreur de valeur spéciale → tâche 3.

---

## File Structure

| Fichier | Rôle |
|---------|------|
| `src/datetime.ts` | + durées, unités, numéro de jour, `addDuration`, `diffDateTime`, `subdt` |
| `src/errors.ts` | + `STATUS_DATE_OVERFLOW` |
| `src/builtins.ts` | + `%YEARS` … `%MSECONDS`, `%DIFF`, `%SUBDT` |
| `src/datatypes.ts` | durée non affectable, `describeValue` des durées |
| `src/interpreter.ts` | `+`/`-` date/durée, durée refusée ailleurs (condition, BIF, DSPLY) |
| `src/parser.ts` | unité en argument de `%DIFF`/`%SUBDT`, nombre d'arguments |
| `test/datetime.test.js`, `test/dates.test.js`, `test/unsupported.test.js` | tests |
| `readme.md` | documentation |

---

### Task 1: Calcul pur dans `datetime.ts`

**Files:**
- Modify: `src/datetime.ts` (ajouts en fin de fichier)
- Test: `test/datetime.test.js` (ajouts en fin de fichier)

**Interfaces:**
- Consumes: `RpgDate`, `RpgTime`, `RpgTimestamp`, `DateTimeKind`, `DateTimeValue`, `daysInMonth` (privée, même fichier), `parseIso` (existants).
- Produces:
  - `type DurationUnit = 'years' | 'months' | 'days' | 'hours' | 'minutes' | 'seconds' | 'mseconds'`
  - `class RpgDuration(unit: DurationUnit, amount: number)`, `toString()` → `%DAYS(3)`
  - `isDuration(value): value is RpgDuration`
  - `unitFromName(name: string): DurationUnit | undefined` (`'*days'`, `'*D'`… insensible à la casse)
  - `unitAllowed(kind: DateTimeKind, unit: DurationUnit): boolean`
  - `dayNumber(date: RpgDate): number` (0001-01-01 = 1), `dateFromDayNumber(n: number): RpgDate | undefined`
  - `type ArithmeticFailure = 'overflow' | 'wrap' | 'unit' | '24h'` ; `addDuration(value: DateTimeValue, duration: RpgDuration, sign: 1 | -1): DateTimeValue | ArithmeticFailure`
  - `type DiffFailure = 'kind' | 'unit' | '24h' | 'seconds' | 'precision'` ; `diffDateTime(a: DateTimeValue, b: DateTimeValue, unit: DurationUnit): number | DiffFailure`
  - `subdt(value: DateTimeValue, unit: DurationUnit): number | 'unit'`

- [ ] **Step 1: Write the failing tests** — ajouter à la fin de `test/datetime.test.js` :

```js
// --- Incrément 2 : arithmétique ---

const D = s => dt.parseIso('date', s);
const T = s => dt.parseIso('time', s);
const Z = s => dt.parseIso('timestamp', s);
const add = (v, unit, n, sign = 1) => String(dt.addDuration(v, new dt.RpgDuration(unit, n), sign));

test('numéro de jour : bornes et aller-retour', () => {
  assert.equal(dt.dayNumber(D('0001-01-01')), 1);
  assert.equal(dt.dayNumber(D('0001-12-31')), 365);
  assert.equal(dt.dayNumber(D('0002-01-01')), 366);
  for (const s of ['1900-02-28', '1900-03-01', '2000-02-29', '2024-12-31', '2026-10-04', '9999-12-31']) {
    assert.equal(String(dt.dateFromDayNumber(dt.dayNumber(D(s)))), s);
  }
  assert.equal(dt.dayNumber(D('2000-03-01')) - dt.dayNumber(D('2000-02-28')), 2);
  assert.equal(dt.dayNumber(D('1900-03-01')) - dt.dayNumber(D('1900-02-28')), 1);
  assert.equal(dt.dateFromDayNumber(0), undefined);
  assert.equal(dt.dateFromDayNumber(dt.dayNumber(D('9999-12-31')) + 1), undefined);
});

test('durée : texte et détection', () => {
  assert.equal(String(new dt.RpgDuration('days', 3)), '%DAYS(3)');
  assert.equal(dt.isDuration(new dt.RpgDuration('mseconds', 1)), true);
  assert.equal(dt.isDuration(3), false);
});

test('dates : jours, mois, années, fin de mois', () => {
  assert.equal(add(D('2026-10-04'), 'days', 1), '2026-10-05');
  assert.equal(add(D('2026-12-31'), 'days', 1), '2027-01-01');
  assert.equal(add(D('2026-03-01'), 'days', -1), '2026-02-28');
  assert.equal(add(D('2026-10-04'), 'days', 30, -1), '2026-09-04');
  assert.equal(add(D('2026-01-31'), 'months', 1), '2026-02-28');
  assert.equal(add(D('2024-01-31'), 'months', 1), '2024-02-29');
  assert.equal(add(D('2026-03-31'), 'months', 1, -1), '2026-02-28');
  assert.equal(add(D('2026-11-15'), 'months', 3), '2027-02-15');
  assert.equal(add(D('2024-02-29'), 'years', 1), '2025-02-28');
  assert.equal(add(D('2024-02-29'), 'years', 4), '2028-02-29');
  assert.equal(add(D('2026-10-04'), 'years', 2, -1), '2024-10-04');
});

test('dates : dépassement et unité non admise', () => {
  assert.equal(add(D('9999-12-31'), 'days', 1), 'overflow');
  assert.equal(add(D('0001-01-01'), 'days', -1), 'overflow');
  assert.equal(add(D('9999-12-15'), 'months', 1), 'overflow');
  assert.equal(add(D('0001-06-01'), 'years', 1, -1), 'overflow');
  assert.equal(add(D('2026-10-04'), 'hours', 1), 'unit');
  assert.equal(add(D('2026-10-04'), 'mseconds', 1), 'unit');
});

test('heures : calcul, passage de minuit, 24.00.00', () => {
  assert.equal(add(T('08.30.00'), 'hours', 2), '10.30.00');
  assert.equal(add(T('08.30.00'), 'minutes', 45), '09.15.00');
  assert.equal(add(T('08.30.00'), 'seconds', 90, -1), '08.28.30');
  assert.equal(add(T('23.00.00'), 'hours', 2), 'wrap');
  assert.equal(add(T('00.30.00'), 'hours', 1, -1), 'wrap');
  assert.equal(add(T('24.00.00'), 'seconds', 0), '24h');
  assert.equal(add(T('08.00.00'), 'days', 1), 'unit');
});

test('timestamps : toutes unités, retenues, grands décalages exacts', () => {
  assert.equal(add(Z('2026-10-04-23.59.59.999999'), 'mseconds', 1), '2026-10-05-00.00.00.000000');
  assert.equal(add(Z('2026-10-05-00.00.00.000000'), 'mseconds', 1, -1), '2026-10-04-23.59.59.999999');
  assert.equal(add(Z('2026-10-04-22.00.00.000000'), 'hours', 3), '2026-10-05-01.00.00.000000');
  assert.equal(add(Z('2026-01-31-12.00.00.000005'), 'months', 1), '2026-02-28-12.00.00.000005');
  // 400 ans grégoriens = 146 097 jours ; en microsecondes, bien au-delà de 2^53
  assert.equal(add(Z('2026-10-04-12.00.00.000001'), 'hours', 24 * 146097), '2426-10-04-12.00.00.000001');
  assert.equal(add(Z('9999-12-31-23.00.00.000000'), 'hours', 1), 'overflow');
  assert.equal(add(Z('2026-10-04-24.00.00.000000'), 'days', 1), '24h');
});

test('%DIFF : jours, mois entiers, années, signe', () => {
  assert.equal(dt.diffDateTime(D('2026-10-04'), D('2026-01-01'), 'days'), 276);
  assert.equal(dt.diffDateTime(D('2026-01-01'), D('2026-10-04'), 'days'), -276);
  assert.equal(dt.diffDateTime(D('2026-02-28'), D('2026-01-31'), 'months'), 0);
  assert.equal(dt.diffDateTime(D('2026-03-31'), D('2026-01-31'), 'months'), 2);
  assert.equal(dt.diffDateTime(D('2026-03-30'), D('2026-01-31'), 'months'), 1);
  assert.equal(dt.diffDateTime(D('2026-01-31'), D('2026-03-30'), 'months'), -1);
  assert.equal(dt.diffDateTime(D('2025-02-28'), D('2024-02-29'), 'years'), 0);
  assert.equal(dt.diffDateTime(D('2024-02-29'), D('2025-02-28'), 'years'), 0);
  assert.equal(Object.is(dt.diffDateTime(D('2024-02-29'), D('2025-02-28'), 'years'), -0), false);
  assert.equal(dt.diffDateTime(D('2026-10-04'), D('2000-10-05'), 'years'), 25);
  assert.equal(dt.diffDateTime(D('2026-10-04'), D('2000-10-04'), 'years'), 26);
});

test('%DIFF : heures et timestamps tronqués vers zéro', () => {
  assert.equal(dt.diffDateTime(T('10.59.00'), T('10.00.00'), 'hours'), 0);
  assert.equal(dt.diffDateTime(T('10.00.00'), T('10.59.00'), 'hours'), 0);
  assert.equal(dt.diffDateTime(T('12.00.00'), T('10.30.00'), 'minutes'), 90);
  assert.equal(dt.diffDateTime(Z('2026-10-05-00.00.00.000000'), Z('2026-10-04-23.59.59.999999'), 'mseconds'), 1);
  assert.equal(dt.diffDateTime(Z('2026-10-05-01.00.00.000000'), Z('2026-10-04-23.30.00.000000'), 'hours'), 1);
  assert.equal(dt.diffDateTime(Z('2026-02-28-09.00.00.000000'), Z('2026-01-28-10.00.00.000000'), 'months'), 0);
  assert.equal(dt.diffDateTime(Z('2026-10-04-00.00.00.000000'), Z('2026-10-01-12.00.00.000000'), 'days'), 2);
});

test('%DIFF : cas refusés', () => {
  assert.equal(dt.diffDateTime(D('2026-10-04'), Z('2026-10-04-00.00.00.000000'), 'days'), 'kind');
  assert.equal(dt.diffDateTime(D('2026-10-04'), D('2026-10-01'), 'hours'), 'unit');
  assert.equal(dt.diffDateTime(Z('2026-10-04-00.00.00.000000'), Z('2026-10-01-00.00.00.000000'), 'seconds'), 'seconds');
  assert.equal(dt.diffDateTime(T('24.00.00'), T('10.00.00'), 'hours'), '24h');
  assert.equal(dt.diffDateTime(Z('9999-12-31-00.00.00.000000'), Z('0001-01-01-00.00.00.000000'), 'mseconds'), 'precision');
});

test('%SUBDT', () => {
  assert.equal(dt.subdt(D('2026-10-04'), 'years'), 2026);
  assert.equal(dt.subdt(D('2026-10-04'), 'months'), 10);
  assert.equal(dt.subdt(D('2026-10-04'), 'days'), 4);
  assert.equal(dt.subdt(T('13.45.07'), 'minutes'), 45);
  assert.equal(dt.subdt(Z('2026-10-04-13.45.07.000089'), 'hours'), 13);
  assert.equal(dt.subdt(Z('2026-10-04-13.45.07.000089'), 'mseconds'), 89);
  assert.equal(dt.subdt(D('2026-10-04'), 'hours'), 'unit');
  assert.equal(dt.subdt(T('13.45.07'), 'mseconds'), 'unit');
});

test('unités et abréviations', () => {
  const cases = [['*YEARS', 'years'], ['*y', 'years'], ['*M', 'months'], ['*months', 'months'], ['*D', 'days'],
                 ['*h', 'hours'], ['*MN', 'minutes'], ['*s', 'seconds'], ['*MS', 'mseconds'], ['*mseconds', 'mseconds']];
  for (const [name, unit] of cases) assert.equal(dt.unitFromName(name), unit, name);
  assert.equal(dt.unitFromName('*weeks'), undefined);
  assert.equal(dt.unitAllowed('date', 'days'), true);
  assert.equal(dt.unitAllowed('date', 'hours'), false);
  assert.equal(dt.unitAllowed('time', 'mseconds'), false);
  assert.equal(dt.unitAllowed('timestamp', 'mseconds'), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/datetime.test.js`
Expected: FAIL — `dt.dayNumber is not a function`, `dt.RpgDuration is not a constructor`, etc. (les 8 tests existants passent).

- [ ] **Step 3: Implement** — ajouter à la fin de `src/datetime.ts` :

```ts
// --- Arithmétique : durées, %DIFF, %SUBDT ---

export type DurationUnit = 'years' | 'months' | 'days' | 'hours' | 'minutes' | 'seconds' | 'mseconds';

// %YEARS(n) ... %MSECONDS(n) : durée à ajouter ou retrancher (MSECONDS = microsecondes, comme sur IBM i)
export class RpgDuration {
  constructor(readonly unit: DurationUnit, readonly amount: number) {}
  toString(): string {
    return `%${this.unit.toUpperCase()}(${this.amount})`;
  }
}

export function isDuration(value: any): value is RpgDuration {
  return value instanceof RpgDuration;
}

// Unités de %DIFF et %SUBDT, avec leurs abréviations
const UNIT_NAMES: { [name: string]: DurationUnit } = {
  '*years': 'years', '*y': 'years', '*months': 'months', '*m': 'months', '*days': 'days', '*d': 'days',
  '*hours': 'hours', '*h': 'hours', '*minutes': 'minutes', '*mn': 'minutes',
  '*seconds': 'seconds', '*s': 'seconds', '*mseconds': 'mseconds', '*ms': 'mseconds',
};

export function unitFromName(name: string): DurationUnit | undefined {
  return UNIT_NAMES[name.toLowerCase()];
}

const UNITS_BY_KIND: { [kind in DateTimeKind]: DurationUnit[] } = {
  date: ['years', 'months', 'days'],
  time: ['hours', 'minutes', 'seconds'],
  timestamp: ['years', 'months', 'days', 'hours', 'minutes', 'seconds', 'mseconds'],
};

export function unitAllowed(kind: DateTimeKind, unit: DurationUnit): boolean {
  return UNITS_BY_KIND[kind].includes(unit);
}

// Numéro de jour continu (0001-01-01 = 1), calendrier grégorien : ni Date JavaScript ni fuseau horaire
export function dayNumber(date: RpgDate): number {
  const y = date.year - 1;
  let days = y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
  for (let m = 1; m < date.month; m++) days += daysInMonth(date.year, m);
  return days + date.day;
}

const MAX_DAY_NUMBER = dayNumber(new RpgDate(9999, 12, 31));

export function dateFromDayNumber(n: number): RpgDate | undefined {
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAY_NUMBER) return undefined;
  let year = Math.floor((n - 1) / 365.2425) + 1;
  while (dayNumber(new RpgDate(year, 1, 1)) > n) year--;
  while (year < 9999 && dayNumber(new RpgDate(year + 1, 1, 1)) <= n) year++;
  let day = n - dayNumber(new RpgDate(year, 1, 1)) + 1;
  let month = 1;
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month++;
  }
  return new RpgDate(year, month, day);
}

const secondsOfDay = (time: RpgTime) => time.hour * 3600 + time.minute * 60 + time.second;
const timeFromSeconds = (s: number) => new RpgTime(Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60);
const is24h = (value: DateTimeValue) =>
  (value instanceof RpgTime && value.hour === 24) || (value instanceof RpgTimestamp && value.time.hour === 24);

const MICROS_PER_DAY = 86_400_000_000n;
const MICROS_PER_UNIT: { [unit: string]: bigint } = {
  days: MICROS_PER_DAY, hours: 3_600_000_000n, minutes: 60_000_000n, seconds: 1_000_000n, mseconds: 1n,
};

// Mois et années ; jour inexistant dans le mois d'arrivée : dernier jour du mois
function addToDate(date: RpgDate, unit: DurationUnit, amount: number): RpgDate | undefined {
  if (unit === 'days') return dateFromDayNumber(dayNumber(date) + amount);
  const months = date.year * 12 + (date.month - 1) + (unit === 'years' ? amount * 12 : amount);
  const year = Math.floor(months / 12);
  const month = months - year * 12 + 1;
  if (year < 1 || year > 9999) return undefined;
  return new RpgDate(year, month, Math.min(date.day, daysInMonth(year, month)));
}

// Échec d'un calcul : unité non admise pour le type, résultat hors bornes,
// heure qui passe minuit, valeur 24.00.00 (l'appelant choisit l'erreur RPG)
export type ArithmeticFailure = 'overflow' | 'wrap' | 'unit' | '24h';

// valeur ± durée (amount entier)
export function addDuration(value: DateTimeValue, duration: RpgDuration, sign: 1 | -1): DateTimeValue | ArithmeticFailure {
  if (!unitAllowed(value.kind, duration.unit)) return 'unit';
  if (is24h(value)) return '24h';
  const amount = sign * duration.amount;
  if (value instanceof RpgDate) return addToDate(value, duration.unit, amount) ?? 'overflow';
  if (value instanceof RpgTime) {
    const seconds = secondsOfDay(value) + amount * Number(MICROS_PER_UNIT[duration.unit] / 1_000_000n);
    return seconds < 0 || seconds >= 86_400 ? 'wrap' : timeFromSeconds(seconds);
  }
  if (duration.unit === 'years' || duration.unit === 'months' || duration.unit === 'days') {
    const date = addToDate(value.date, duration.unit, amount);
    return date ? new RpgTimestamp(date, value.time, value.microseconds) : 'overflow';
  }
  // Heures, minutes, secondes, microsecondes : en BigInt, un décalage dépasse vite 2^53 microsecondes
  const total = BigInt(secondsOfDay(value.time)) * 1_000_000n + BigInt(value.microseconds)
    + BigInt(amount) * MICROS_PER_UNIT[duration.unit];
  let dayShift = total / MICROS_PER_DAY;
  let micros = total % MICROS_PER_DAY;
  if (micros < 0n) {
    micros += MICROS_PER_DAY;
    dayShift -= 1n;
  }
  const date = dateFromDayNumber(dayNumber(value.date) + Number(dayShift));
  if (!date) return 'overflow';
  const seconds = Number(micros / 1_000_000n);
  return new RpgTimestamp(date, timeFromSeconds(seconds), Number(micros % 1_000_000n));
}

const dateOf = (value: DateTimeValue) => (value instanceof RpgTimestamp ? value.date : value as RpgDate);

// Position dans le temps : numéro de jour (0 pour une heure) et microsecondes dans le jour
function position(value: DateTimeValue): { day: number; micros: number } {
  if (value instanceof RpgDate) return { day: dayNumber(value), micros: 0 };
  if (value instanceof RpgTime) return { day: 0, micros: secondsOfDay(value) * 1_000_000 };
  return { day: dayNumber(value.date), micros: secondsOfDay(value.time) * 1_000_000 + value.microseconds };
}

// Mois entiers écoulés de b à a (négatif si a < b) : un mois n'est compté que s'il est complet
function wholeMonths(a: DateTimeValue, b: DateTimeValue): number {
  const da = dateOf(a);
  const db = dateOf(b);
  const pa = position(a);
  const pb = position(b);
  let months = (da.year * 12 + da.month) - (db.year * 12 + db.month);
  const aEarlierInMonth = da.day < db.day || (da.day === db.day && pa.micros < pb.micros);
  const aLaterInMonth = da.day > db.day || (da.day === db.day && pa.micros > pb.micros);
  if (months > 0 && aEarlierInMonth) months--;
  if (months < 0 && aLaterInMonth) months++;
  return months;
}

// Échec de %DIFF : types différents, unité non admise, valeur 24.00.00,
// timestamps en *SECONDS (fractions possibles sur IBM i), résultat au-delà de 2^53
export type DiffFailure = 'kind' | 'unit' | '24h' | 'seconds' | 'precision';

// %DIFF(a : b : unité) : nombre entier d'unités de a - b, tronqué vers zéro
export function diffDateTime(a: DateTimeValue, b: DateTimeValue, unit: DurationUnit): number | DiffFailure {
  if (a.kind !== b.kind) return 'kind';
  if (!unitAllowed(a.kind, unit)) return 'unit';
  if (is24h(a) || is24h(b)) return '24h';
  if (a.kind === 'timestamp' && unit === 'seconds') return 'seconds';
  if (unit === 'years' || unit === 'months') {
    const months = wholeMonths(a, b);
    return unit === 'years' ? Math.trunc(months / 12) + 0 : months; // + 0 : jamais -0
  }
  const pa = position(a);
  const pb = position(b);
  const micros = BigInt(pa.day - pb.day) * MICROS_PER_DAY + BigInt(pa.micros - pb.micros);
  const result = micros / MICROS_PER_UNIT[unit]; // division BigInt : tronquée vers zéro
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  return result > limit || result < -limit ? 'precision' : Number(result);
}

// %SUBDT(valeur : unité) : composante numérique
export function subdt(value: DateTimeValue, unit: DurationUnit): number | 'unit' {
  if (!unitAllowed(value.kind, unit)) return 'unit';
  const date = value instanceof RpgTime ? undefined : dateOf(value);
  const time = value instanceof RpgTime ? value : value instanceof RpgTimestamp ? value.time : undefined;
  switch (unit) {
    case 'years': return date!.year;
    case 'months': return date!.month;
    case 'days': return date!.day;
    case 'hours': return time!.hour;
    case 'minutes': return time!.minute;
    case 'seconds': return time!.second;
    case 'mseconds': return (value as RpgTimestamp).microseconds;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test test/datetime.test.js` puis `npm test`
Expected: PASS (tous les tests).

- [ ] **Step 5: Commit**

```bash
git add src/datetime.ts test/datetime.test.js
git commit -m "Dates : calcul des durées, %DIFF et %SUBDT (module datetime)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Durées et `+`/`-` dans les programmes

**Files:**
- Modify: `src/errors.ts`, `src/builtins.ts`, `src/datatypes.ts` (`coerce`, `describeValue`), `src/interpreter.ts` (imports, `involvesDateTime`, `dateTimeOperation`, `condition`, branche `builtin` de `evaluate`, `executeDsply`)
- Test: `test/dates.test.js`, `test/unsupported.test.js`

**Interfaces:**
- Consumes (tâche 1): `RpgDuration`, `DurationUnit`, `isDuration`, `addDuration`, `DateTimeValue`.
- Produces: `STATUS_DATE_OVERFLOW = 113` (errors.ts) ; BIF `%years`, `%months`, `%days`, `%hours`, `%minutes`, `%seconds`, `%mseconds` dans `BUILTINS`.

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/dates.test.js` :

```js
// --- Incrément 2 : arithmétique ---

test('date + %DAYS + %MONTHS + %YEARS, évalués de gauche à droite', () => {
  const out = run(`
    dcl-s d date inz(D'2026-01-31');
    dcl-s r date;
    r = d + %days(1) + %months(1) + %years(1);
    dsply r;
    r = d + %months(1);
    dsply r;
    r = d - %days(31);
    dsply r;
  `);
  assert.deepEqual(out, ['2027-03-01', '2026-02-28', '2025-12-31']);
});

test('%date() - %years(2) avec l\'horloge figée', () => {
  assert.deepEqual(run(`dcl-s limite date; limite = %date() - %years(2); dsply limite;`, undefined, CLOCK), ['2024-10-04']);
});

test('heures et timestamps', () => {
  const out = run(`
    dcl-s t time inz(T'08.30.00');
    dcl-s z timestamp inz(Z'2026-10-04-23.59.59.999999');
    dsply %char(t + %minutes(45) - %seconds(30));
    dsply %char(z + %mseconds(1));
    dsply %char(z + %hours(1) + %days(1));
    dsply %char(z + %hours(24 * 146097));
  `);
  assert.deepEqual(out, ['09.14.30', '2026-10-05-00.00.00.000000', '2026-10-06-00.59.59.999999',
                         '2426-10-04-23.59.59.999999']);
});

test('date calculée dans une comparaison', () => {
  const out = run(`
    dcl-s echeance date inz(D'2026-10-10');
    if echeance < %date() + %days(7);
      dsply 'bientot';
    endif;
  `, undefined, CLOCK);
  assert.deepEqual(out, ['bientot']);
});

test('date hors limites : statut 00113 interceptable', () => {
  const out = run(`
    dcl-s d date inz(D'9999-12-31');
    monitor;
      d = d + %days(1);
    on-error 00113;
      dsply 'statut ' + %char(%status());
    endmon;
    dsply d;
  `);
  assert.deepEqual(out, ['statut 113', '9999-12-31']);
  assert.throws(() => run(`dcl-s d date inz(D'0001-01-01'); d = d - %years(1);`), /RNX0113/);
});

test('durée mal placée ou d\'un mauvais type : types incompatibles', () => {
  for (const src of [
    `dcl-s d date; d = d + %hours(1);`,
    `dcl-s t time; t = t + %days(1);`,
    `dcl-s d date; dcl-s e date; dcl-s n int(10); n = d - e;`,
    `dcl-s n int(10); n = %days(1);`,
    `dcl-s d date; d = %days(1);`,
    `dsply %days(1);`,
    `if %days(1) = %days(1); endif;`,
    `if %days(2); endif;`,
    `dcl-s d date; d = d + (%days(1) + %days(2));`,
    `dcl-s c char(20); c = %char(%days(1));`,
    `dcl-s n int(10); n = %len(%days(1));`,
    `dcl-s d date; d = d + %days('x');`,
    `dcl-s d date; d = d + %days(d);`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});
```

Dans `test/unsupported.test.js` :
1. Dans le test « les fonctions et formats de dates des incréments suivants sont refusés », supprimer la ligne
   `` `dcl-s d date; d = d + %days(1);`, `` (désormais supportée).
2. Ajouter :

```js
test('arithmétique de dates incertaine : refusée', () => {
  for (const src of [
    `dcl-s t time inz(T'23.00.00'); t = t + %hours(2);`,
    `dcl-s t time inz(T'00.30.00'); t = t - %hours(1);`,
    `dcl-s t time inz(T'24.00.00'); t = t - %seconds(1);`,
    `dcl-s d date; d = %days(1) + d;`,
    `dcl-s d date; d = d + %days(1.5);`,
  ]) {
    assert.throws(() => run(src), NOT_SUPPORTED, src);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/dates.test.js test/unsupported.test.js`
Expected: FAIL — « La fonction %DAYS : pas encore supporté » sur les nouveaux tests.

- [ ] **Step 3: Implement**

`src/errors.ts` — après `STATUS_INVALID_DATE` :

```ts
export const STATUS_DATE_OVERFLOW = 113;    // RNX0113 : date hors limites après calcul
```

`src/builtins.ts` :

1. Import depuis `./datetime` : ajouter `DurationUnit`, `RpgDuration`.
2. Fonction avant `BUILTINS` :

```ts
// %YEARS(n) ... %MSECONDS(n) : durée entière, seulement utilisable à droite d'un + ou - avec une date
function duration(unit: DurationUnit, amount: any): RpgDuration {
  const name = `%${unit.toUpperCase()}`;
  if (typeof amount !== 'number') throw incompatibleTypes(`${name}(${describeValue(amount)})`);
  if (!Number.isInteger(amount)) {
    throw new Error(`${name} d'une valeur non entière (${amount}) : pas encore supporté par l'interpréteur`);
  }
  return new RpgDuration(unit, amount);
}
```

3. Entrées de `BUILTINS`, après `'%timestamp'` :

```ts
  '%years': (_, n: any) => duration('years', n),
  '%months': (_, n: any) => duration('months', n),
  '%days': (_, n: any) => duration('days', n),
  '%hours': (_, n: any) => duration('hours', n),
  '%minutes': (_, n: any) => duration('minutes', n),
  '%seconds': (_, n: any) => duration('seconds', n),
  '%mseconds': (_, n: any) => duration('mseconds', n),
```

`src/datatypes.ts` :

1. Import depuis `./datetime` : ajouter `isDuration`.
2. Dans `coerce`, remplacer `if (isDateTime(value)) throw incompatibleAssignment(value, type, target);` par :

```ts
  if (isDateTime(value) || isDuration(value)) throw incompatibleAssignment(value, type, target);
```

3. Dans `describeValue`, après la ligne `FigurativeValue` :

```ts
  if (isDuration(value)) return `durée ${value}`;
```

(Une durée affectée à une date passe par `coerceDateTime`, où `kindOf(durée)` est `undefined` : déjà refusée.)

`src/interpreter.ts` :

1. Imports : ajouter `RpgDuration`, `DateTimeValue`, `isDuration`, `addDuration` à l'import de `./datetime` ; ajouter `STATUS_DATE_OVERFLOW` à l'import de `./errors`.

2. Remplacer `involvesDateTime` et `dateTimeOperation` par :

```ts
const involvesDateTime = (value: any) => isDateTime(value) || isDuration(value) || value instanceof FigurativeValue;

// Avec une date, une heure ou un timestamp : comparaison au même type, ou + / - d'une durée à droite.
// *LOVAL / *HIVAL prennent le type de l'autre opérande.
function dateTimeOperation(op: string, left: any, right: any): any {
  if ((op === '+' || op === '-') && isDateTime(left) && isDuration(right)) {
    return applyDuration(left, right, op === '+' ? 1 : -1);
  }
  if (op === '+' && isDuration(left) && isDateTime(right)) {
    throw new Error(`Durée à gauche d'une date (${left} + ${describeValue(right)}) : pas encore supporté par l'interpréteur`);
  }
  const test = COMPARISONS[op];
  if (left instanceof FigurativeValue && kindOf(right)) left = resolveFigurative(left, kindOf(right)!);
  if (right instanceof FigurativeValue && kindOf(left)) right = resolveFigurative(right, kindOf(left)!);
  if (test && kindOf(left) !== undefined && kindOf(left) === kindOf(right)) {
    return test(compareDateTime(left, right));
  }
  const operands = right === undefined ? describeValue(left) : `${describeValue(left)} et ${describeValue(right)}`;
  throw incompatibleTypes(`Opération ${op.toUpperCase()} avec ${operands}`);
}

// Traduit un échec du calcul en erreur RPG
function applyDuration(value: DateTimeValue, duration: RpgDuration, sign: 1 | -1): DateTimeValue {
  const result = addDuration(value, duration, sign);
  if (typeof result !== 'string') return result;
  const what = `${describeValue(value)} ${sign > 0 ? '+' : '-'} ${duration}`;
  switch (result) {
    case 'unit': throw incompatibleTypes(what);
    case 'overflow': throw new RpgError(STATUS_DATE_OVERFLOW, `Résultat hors limites pour ${what} (RNX0113)`);
    case 'wrap': throw new Error(`${what} passe minuit : pas encore supporté par l'interpréteur`);
    case '24h': throw new Error(`Calcul sur la valeur 24.00.00 (${what}) : pas encore supporté par l'interpréteur`);
  }
}
```

3. `condition` — remplacer la condition du `if` par :

```ts
    if (isDateTime(value) || isDuration(value) || value instanceof FigurativeValue) {
```

4. Branche `builtin` de `evaluate`, juste après la ligne `const args = (isChar ? … ).map(…);` :

```ts
      // Aucune fonction intégrée ne prend une durée en argument
      const duration = args.find(isDuration);
      if (duration) throw incompatibleTypes(`${expr.value.name.toUpperCase()}(${describeValue(duration)})`);
```

5. `executeDsply` — remplacer `msg = String(this.evaluate(node.message)).trimEnd();` par :

```ts
      const value = this.evaluate(node.message);
      if (isDuration(value)) throw incompatibleTypes(`DSPLY ${describeValue(value)}`);
      msg = String(value).trimEnd();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test test/dates.test.js test/unsupported.test.js` puis `npm test`
Expected: PASS (tous les tests).

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/builtins.ts src/datatypes.ts src/interpreter.ts test/dates.test.js test/unsupported.test.js
git commit -m "Dates : durées %YEARS à %MSECONDS, addition et soustraction, statut 00113" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `%DIFF`, `%SUBDT` et README

**Files:**
- Modify: `src/parser.ts` (constantes, boucle des arguments de BIF dans `parsePrimary`, nouvelle méthode `parseUnitArgument`), `src/builtins.ts`, `src/interpreter.ts` (`DATE_AWARE_BUILTINS`), `readme.md`
- Test: `test/dates.test.js`, `test/unsupported.test.js`

**Interfaces:**
- Consumes (tâche 1): `unitFromName`, `diffDateTime`, `subdt`, `DurationUnit` ; (existant) `isDateTime`, `describeValue`, `incompatibleTypes`.
- Produces: BIF `%diff(a, b, '*unité')` et `%subdt(v, '*unité')` ; l'unité arrive à l'exécution comme chaîne en minuscules (`'*days'`), car le parser produit une expression `special` dont `evaluate` renvoie la valeur telle quelle.

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/dates.test.js` :

```js
test('%DIFF et %SUBDT', () => {
  const out = run(`
    dcl-s debut date inz(D'2026-01-31');
    dcl-s fin date inz(D'2026-10-04');
    dcl-s n int(10);
    n = %diff(fin : debut : *days);
    dsply %char(n);
    dsply %char(%diff(fin : debut : *MONTHS));
    dsply %char(%diff(debut : fin : *m));
    dsply %char(%diff(T'12.00.00' : T'10.30.00' : *mn));
    dsply %char(%subdt(fin : *years) * 100 + %subdt(fin : *months));
    dsply %char(%subdt(Z'2026-10-04-13.45.07.000089' : *ms));
  `);
  assert.deepEqual(out, ['246', '8', '-8', '90', '202610', '89']);
});

test('%DIFF et %SUBDT : unité non admise ou valeur non date', () => {
  for (const src of [
    `dcl-s n int(10); n = %diff(D'2026-10-04' : D'2026-01-01' : *hours);`,
    `dcl-s n int(10); n = %diff(T'10.00.00' : T'09.00.00' : *days);`,
    `dcl-s n int(10); n = %diff(20261004 : 20260101 : *days);`,
    `dcl-s n int(10); n = %subdt(D'2026-10-04' : *ms);`,
    `dcl-s n int(10); n = %subdt('2026-10-04' : *years);`,
  ]) {
    assert.throws(() => run(src), INCOMPATIBLE, src);
  }
});

test('%DIFF et %SUBDT : unité inconnue ou nombre d\'arguments, erreur d\'analyse', () => {
  assert.throws(() => parse(`dcl-s n int(10); n = %diff(D'2026-10-04' : D'2026-01-01' : *weeks);`),
    /unité \*WEEKS inconnue.*ligne 1/i);
  assert.throws(() => parse(`dcl-s n int(10); n = %subdt(D'2026-10-04' : 'x');`), /unité.*inconnue/i);
  assert.throws(() => parse(`dcl-s n int(10); n = %diff(D'2026-10-04' : D'2026-01-01');`), /%DIFF attend 3 arguments/);
  assert.throws(() => parse(`dcl-s n int(10); n = %subdt(D'2026-10-04');`), /%SUBDT attend 2 arguments/);
  assert.throws(() => parse(`dcl-s d date; d = d + %days();`), /%DAYS attend 1 argument/);
});
```

Dans `test/unsupported.test.js` :
1. Dans le test « les fonctions et formats de dates des incréments suivants sont refusés », supprimer les deux lignes
   `` `dcl-s n int(10); n = %diff(D'2026-10-04' : D'2026-01-01' : *days);`, `` et
   `` `dcl-s n int(5); n = %subdt(D'2026-10-04' : *years);`, ``.
2. Ajouter :

```js
test('%DIFF et %SUBDT incertains : refusés', () => {
  for (const src of [
    `dcl-s n int(10); n = %diff(D'2026-10-04' : Z'2026-10-04-00.00.00.000000' : *days);`,
    `dcl-s n int(10); n = %diff(Z'2026-10-04-00.00.00.000000' : Z'2026-10-01-00.00.00.000000' : *seconds);`,
    `dcl-s n int(20); n = %diff(Z'9999-12-31-00.00.00.000000' : Z'0001-01-01-00.00.00.000000' : *ms);`,
    `dcl-s n int(10); n = %diff(T'24.00.00' : T'10.00.00' : *hours);`,
  ]) {
    assert.throws(() => run(src), NOT_SUPPORTED, src);
  }
  assert.throws(() => parse(`dcl-s n int(10); n = %subdt(D'2026-10-04' : *years : 4);`), NOT_SUPPORTED);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/dates.test.js test/unsupported.test.js`
Expected: FAIL — « La fonction %DIFF : pas encore supporté ».

- [ ] **Step 3: Implement**

`src/parser.ts` :

1. Import depuis `./datetime` : ajouter `unitFromName`.
2. Constantes, après `FORMAT_BUILTINS` :

```ts
// Position (0 = 1er argument) de l'unité de date (*DAYS, *M...) dans %DIFF et %SUBDT
const UNIT_ARGUMENT = new Map([['%diff', 2], ['%subdt', 1]]);

// Nombre exact d'arguments des fonctions de dates
const BUILTIN_ARITY: { [name: string]: number } = {
  '%diff': 3, '%subdt': 2, '%years': 1, '%months': 1, '%days': 1,
  '%hours': 1, '%minutes': 1, '%seconds': 1, '%mseconds': 1,
};
```

3. Méthode, après `parseFormatArgument` :

```ts
  // Unité de %DIFF / %SUBDT : *YEARS, *Y, *MONTHS, *M... ; inconnue : erreur, comme à la compilation
  private parseUnitArgument(builtin: string): ExpressionNode {
    const token = this.peek();
    if (token.type !== TokenType.SPECIAL_VALUE || !unitFromName(token.value)) {
      throw new Error(`${builtin.toUpperCase()} : unité ${token.value.toUpperCase()} inconnue (ligne ${token.line})`);
    }
    this.advance();
    return { type: 'Expression', value: token.value.toLowerCase(), valueType: 'special' };
  }
```

4. Dans `parsePrimary`, branche BUILTIN, remplacer la boucle `while (!this.check(TokenType.RPAREN)) { … }` et le `this.expect(TokenType.RPAREN);` qui la suit par :

```ts
      const lower = name.toLowerCase();
      while (!this.check(TokenType.RPAREN)) {
        if (args.length === 2 && lower === '%char') {
          throw new Error(`%CHAR accepte au plus 2 arguments (ligne ${token.line})`);
        }
        if (args.length === 2 && lower === '%subdt') {
          throw unsupported('%SUBDT avec plus de 2 arguments', this.peek());
        }
        if (args.length === 1 && FORMAT_BUILTINS.has(lower)) {
          args.push(this.parseFormatArgument(name));
        } else if (UNIT_ARGUMENT.get(lower) === args.length) {
          args.push(this.parseUnitArgument(name));
        } else {
          args.push(this.parseExpression());
        }
        if (this.check(TokenType.COLON) || this.check(TokenType.COMMA)) {
          this.advance();
        }
      }

      this.expect(TokenType.RPAREN);
      const arity = BUILTIN_ARITY[lower];
      if (arity !== undefined && args.length !== arity) {
        throw new Error(`${name.toUpperCase()} attend ${arity} argument${arity > 1 ? 's' : ''} (ligne ${token.line})`);
      }
```

(Garder la ligne `return { type: 'Expression', value: { name, args }, valueType: 'builtin' };` qui suit.)

`src/builtins.ts` :

1. Import depuis `./datetime` : ajouter `diffDateTime`, `isDateTime`, `subdt`, `unitFromName`.
2. Fonctions avant `BUILTINS` :

```ts
// %DIFF(a : b : unité) : unités entières de a - b ; l'unité arrive en minuscules ('*days')
function diff(a: any, b: any, unitName: string): number {
  if (!isDateTime(a) || !isDateTime(b)) throw incompatibleTypes(`%DIFF(${describeValue(a)} : ${describeValue(b)})`);
  const result = diffDateTime(a, b, unitFromName(unitName)!);
  if (typeof result === 'number') return result;
  const unit = unitName.toUpperCase();
  switch (result) {
    case 'unit': throw incompatibleTypes(`%DIFF de deux valeurs ${a.kind.toUpperCase()} en ${unit}`);
    case 'kind': throw new Error(`%DIFF entre ${a.kind.toUpperCase()} et ${b.kind.toUpperCase()} : pas encore supporté par l'interpréteur`);
    case '24h': throw new Error(`%DIFF d'une valeur 24.00.00 : pas encore supporté par l'interpréteur`);
    case 'seconds': throw new Error(`%DIFF de deux TIMESTAMP en ${unit} : pas encore supporté par l'interpréteur`);
    case 'precision': throw new Error(`%DIFF en ${unit} trop grand pour être exact : pas encore supporté par l'interpréteur`);
  }
}

// %SUBDT(valeur : unité) : composante numérique (année, mois, ..., microsecondes)
function subdtBuiltin(value: any, unitName: string): number {
  if (!isDateTime(value)) throw incompatibleTypes(`%SUBDT(${describeValue(value)})`);
  const result = subdt(value, unitFromName(unitName)!);
  if (result === 'unit') throw incompatibleTypes(`%SUBDT d'une valeur ${value.kind.toUpperCase()} en ${unitName.toUpperCase()}`);
  return result;
}
```

3. Entrées de `BUILTINS`, après `'%mseconds'` :

```ts
  '%diff': (_, a: any, b: any, unit: string) => diff(a, b, unit),
  '%subdt': (_, value: any, unit: string) => subdtBuiltin(value, unit),
```

`src/interpreter.ts` — `DATE_AWARE_BUILTINS` devient :

```ts
const DATE_AWARE_BUILTINS = new Set(['%date', '%time', '%timestamp', '%len', '%diff', '%subdt']);
```

`readme.md` :

1. Ligne **Fonctions intégrées** : ajouter à la fin `, `%years`, `%months`, `%days`, `%hours`, `%minutes`, `%seconds`, `%mseconds`, `%diff`, `%subdt``.
2. Ligne **Contrôle** : dans la parenthèse des statuts interceptés, remplacer `date/heure invalide 00112` par `date/heure invalide 00112, date hors limites 00113`.
3. Section **Dates et heures** — remplacer la puce « Comparaisons entre valeurs du même type ; mélanger les types (`date = 'texte'`, `'Le ' + date`, `date + 1`) est refusé comme à la compilation » par :

```markdown
- Comparaisons entre valeurs du même type ; mélanger les types (`date = 'texte'`, `'Le ' + date`, `date + 1`, `date - date`) est refusé comme à la compilation
- Durées `%YEARS`, `%MONTHS`, `%DAYS` (date), `%HOURS`, `%MINUTES`, `%SECONDS` (heure), toutes plus `%MSECONDS` (microsecondes) pour un timestamp, à droite d'un `+` ou d'un `-` : `fin = debut + %days(30) + %months(1);`. Mois ou année vers un jour inexistant : dernier jour du mois (`D'2026-01-31' + %months(1)` = `2026-02-28`). Résultat hors de `0001-01-01` … `9999-12-31` : statut **00113** (RNX0113)
- `%DIFF(a : b : *DAYS)` : nombre entier d'unités, tronqué vers zéro (mois entiers pour `*MONTHS`) ; `%SUBDT(d : *MONTHS)` : composante. Unités `*YEARS`/`*Y`, `*MONTHS`/`*M`, `*DAYS`/`*D`, `*HOURS`/`*H`, `*MINUTES`/`*MN`, `*SECONDS`/`*S`, `*MSECONDS`/`*MS`
- Refusés tant qu'ils ne sont pas vérifiés sur IBM i : heure qui passe minuit (`T'23.00.00' + %hours(2)`), durée à gauche (`%days(1) + d`), durée non entière, `%DIFF` entre types différents ou de deux timestamps en `*SECONDS`, calcul sur `24.00.00`, `%SUBDT` à 3 ou 4 arguments
```

4. **Limites connues** : remplacer la ligne « - Dates : pas encore d'arithmétique (`%DAYS`, `%DIFF`, `%SUBDT`…), de formats autres que *ISO, de conversion numérique ↔ date, ni de dates en SQL » par :

```markdown
- Dates : pas encore de formats autres que *ISO, de conversion numérique ↔ date, ni de dates en SQL
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test test/dates.test.js test/unsupported.test.js` puis `npm test`
Expected: PASS (tous les tests).

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts src/builtins.ts src/interpreter.ts readme.md test/dates.test.js test/unsupported.test.js
git commit -m "Dates : %DIFF, %SUBDT et README de l'arithmétique" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Vérification finale

- [ ] `npm test` : tout vert.
- [ ] `git status --short` : seuls `fichiers_test/tstpgm.rpgle` (modifié) et `skills/` (non suivi) restent hors commit.
- [ ] Ne pas fusionner : attendre « fusionne ».
