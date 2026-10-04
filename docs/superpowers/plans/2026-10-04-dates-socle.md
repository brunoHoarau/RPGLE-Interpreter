# Dates et heures — socle *ISO : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exécuter des programmes RPGLE qui déclarent et manipulent des `DATE`, `TIME` et `TIMESTAMP` au format *ISO, avec le comportement IBM i, et refuser explicitement tout le reste.

**Architecture:** Un module autonome `src/datetime.ts` (classes immuables `RpgDate`, `RpgTime`, `RpgTimestamp`, calendrier, lecture *ISO, comparaisons) ; le lexer reconnaît les littéraux `D'…'`, `T'…'`, `Z'…'` ; le parser valide littéraux, formats et valeurs spéciales (`*SYS`, `*JOB`, `*LOVAL`, `*HIVAL`) dès l'analyse ; `datatypes.ts` contrôle les types à l'affectation ; l'interpréteur compare les dates et refuse les opérations mixtes ; l'horloge est injectable (`options.clock`).

**Tech Stack:** TypeScript 5 (strict, ES2020, CommonJS), tests `node:test` sur le JS compilé dans `out/`.

**Spec:** `docs/superpowers/specs/2026-10-04-dates-heures-design.md` (incrément 1).

## Global Constraints

- Branche `feat/dates-socle` ; fusion dans `main` uniquement quand l'utilisateur dit « fusionne ».
- Ne jamais committer `skills/` ni `fichiers_test/tstpgm.rpgle` (modif locale de l'utilisateur) : toujours `git add` fichier par fichier.
- Tout ce qui n'est pas supporté lève une erreur dont le message contient « pas encore supporté par l'interpréteur ».
- Erreur de type « que le compilateur IBM i refuserait » : `Error` simple (non interceptée par `MONITOR`), message contenant « types incompatibles ».
- Valeur date/heure invalide à l'exécution : `RpgError` statut **112**, message contenant `RNX0112`.
- Format unique : *ISO — date `aaaa-mm-jj`, heure `hh.mm.ss`, timestamp `aaaa-mm-jj-hh.mm.ss.ffffff` (6 chiffres).
- `*JOB` = date du jour (lue sur l'horloge).
- Commandes : compiler + tous les tests = `npm test` ; un seul fichier = `npm run compile && node --test test/<fichier>.test.js`.
- Messages de commit en français, terminés par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Une date passée par référence à un programme appelé dont le source est disponible doit revenir modifiée chez l'appelant → test dans la tâche 2.
2. Un bouchon (`programs.json`) avec un paramètre date : `when`, `set` et `return` en texte *ISO doivent fonctionner, un texte invalide doit donner une erreur claire → tâche 6.
3. Noms et littéraux insensibles à la casse (`d'…'`, `*SYS`, `P.Z = *loval`) → tests des tâches 2 et 4.
4. Une variable locale date ne doit pas autoriser `*LOVAL` sur une globale homonyme d'un autre type → test de la tâche 4.
5. Un texte vide ou blanc passé à `%DATE` doit lever le statut 112, pas planter → test de la tâche 5.

---

## File Structure

| Fichier | Rôle |
|---------|------|
| `src/datetime.ts` (nouveau) | Valeurs date/heure, calendrier, lecture *ISO, bornes, horloge, comparaison |
| `src/errors.ts` | `STATUS_INVALID_DATE`, `incompatibleTypes()` |
| `src/types.ts` | Tokens de littéraux, `valueType: 'datetime'` |
| `src/lexer.ts` | Littéraux `D'…'`, `T'…'`, `Z'…'` |
| `src/parser.ts` | Types débloqués, formats, `CTL-OPT DATFMT/TIMFMT`, littéraux, valeurs spéciales en contexte date, 2ᵉ argument de format, refus SQL |
| `src/datatypes.ts` | Défauts, contrôle de type à l'affectation, `describeValue()` |
| `src/builtins.ts` | `%DATE`, `%TIME`, `%TIMESTAMP`, `BuiltinContext.now()` |
| `src/runtime.ts` | Horloge |
| `src/interpreter.ts` | Option `clock`, `INZ(*SYS/*JOB)`, `*LOVAL/*HIVAL`, comparaisons, `%CHAR(x : *ISO)`, refus SQL, bouchons |
| `test/datetime.test.js` (nouveau) | Tests unitaires du module |
| `test/dates.test.js` (nouveau) | Programmes RPG avec dates |
| `test/unsupported.test.js` | Refus mis à jour |
| `README.md` | Section dates, limites |

---

### Task 1: Module `datetime.ts`

**Files:**
- Create: `src/datetime.ts`
- Test: `test/datetime.test.js`

**Interfaces:**
- Produces (utilisés par toutes les tâches suivantes) :
  - `type DateTimeKind = 'date' | 'time' | 'timestamp'`, `type DateTimeValue = RpgDate | RpgTime | RpgTimestamp`
  - `class RpgDate { kind: 'date'; year; month; day; toString() }`, `class RpgTime { kind: 'time'; hour; minute; second }`, `class RpgTimestamp { kind: 'timestamp'; date: RpgDate; time: RpgTime; microseconds: number }`
  - `class FigurativeValue { name: '*loval' | '*hival' }`
  - `isLeapYear(year): boolean`, `parseIso(kind, text): DateTimeValue | undefined`, `lowValue(kind)`, `highValue(kind)`, `resolveFigurative(value: FigurativeValue, kind): DateTimeValue`, `fromClock(kind, now: Date)`, `isDateTime(value)`, `kindOf(value): DateTimeKind | undefined`, `isDateTimeType(typeName: string)`, `compareDateTime(a, b): number`

- [ ] **Step 1: Write the failing test** — créer `test/datetime.test.js` :

```js
// Valeurs DATE / TIME / TIMESTAMP au format *ISO : calendrier, lecture, bornes, comparaisons
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dt = require(path.join(__dirname, '..', 'out', 'datetime'));

test('années bissextiles grégoriennes', () => {
  assert.equal(dt.isLeapYear(2024), true);
  assert.equal(dt.isLeapYear(2023), false);
  assert.equal(dt.isLeapYear(1900), false);
  assert.equal(dt.isLeapYear(2000), true);
});

test('parseIso date : valides et invalides', () => {
  for (const ok of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) {
    assert.equal(String(dt.parseIso('date', ok)), ok);
  }
  for (const bad of ['2023-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '0000-01-01',
                     '2026-1-01', '2026/10/04', '', '2026-10-04 ']) {
    assert.equal(dt.parseIso('date', bad), undefined, bad);
  }
});

test('parseIso time : 24.00.00 admis seulement tel quel', () => {
  assert.equal(String(dt.parseIso('time', '13.45.00')), '13.45.00');
  assert.equal(String(dt.parseIso('time', '24.00.00')), '24.00.00');
  for (const bad of ['24.00.01', '25.00.00', '12.60.00', '12.00.60', '13:45:00', '1.02.03']) {
    assert.equal(dt.parseIso('time', bad), undefined, bad);
  }
});

test('parseIso timestamp : 6 chiffres de microsecondes', () => {
  const ts = dt.parseIso('timestamp', '2026-10-04-13.45.00.000123');
  assert.equal(String(ts), '2026-10-04-13.45.00.000123');
  assert.equal(ts.microseconds, 123);
  for (const bad of ['2026-10-04-13.45.00', '2026-10-04-13.45.00.12345',
                     '2026-10-04-24.00.00.000001', '2026-02-30-00.00.00.000000']) {
    assert.equal(dt.parseIso('timestamp', bad), undefined, bad);
  }
});

test('valeurs basses et hautes (*LOVAL / *HIVAL)', () => {
  assert.equal(String(dt.lowValue('date')), '0001-01-01');
  assert.equal(String(dt.highValue('date')), '9999-12-31');
  assert.equal(String(dt.lowValue('time')), '00.00.00');
  assert.equal(String(dt.highValue('time')), '24.00.00');
  assert.equal(String(dt.lowValue('timestamp')), '0001-01-01-00.00.00.000000');
  assert.equal(String(dt.highValue('timestamp')), '9999-12-31-24.00.00.000000');
  assert.equal(String(dt.resolveFigurative(new dt.FigurativeValue('*hival'), 'date')), '9999-12-31');
  assert.equal(String(dt.resolveFigurative(new dt.FigurativeValue('*loval'), 'time')), '00.00.00');
});

test('comparaisons', () => {
  const d = s => dt.parseIso('date', s);
  const ts = s => dt.parseIso('timestamp', s);
  assert.equal(dt.compareDateTime(d('2026-10-04'), d('2026-10-04')), 0);
  assert.ok(dt.compareDateTime(d('2026-09-30'), d('2026-10-01')) < 0);
  assert.ok(dt.compareDateTime(ts('2026-10-04-13.45.00.000001'), ts('2026-10-04-13.45.00.000000')) > 0);
  assert.ok(dt.compareDateTime(ts('9999-12-31-24.00.00.000000'), ts('9999-12-31-23.59.59.999999')) > 0);
});

test('fromClock lit l\'heure locale', () => {
  const now = new Date(2026, 9, 4, 13, 45, 7, 89);
  assert.equal(String(dt.fromClock('date', now)), '2026-10-04');
  assert.equal(String(dt.fromClock('time', now)), '13.45.07');
  assert.equal(String(dt.fromClock('timestamp', now)), '2026-10-04-13.45.07.089000');
});

test('isDateTime, kindOf et isDateTimeType', () => {
  assert.equal(dt.isDateTime(dt.lowValue('time')), true);
  assert.equal(dt.isDateTime('2026-10-04'), false);
  assert.equal(dt.kindOf(dt.lowValue('timestamp')), 'timestamp');
  assert.equal(dt.kindOf(12), undefined);
  assert.equal(dt.isDateTimeType('date'), true);
  assert.equal(dt.isDateTimeType('char'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && node --test test/datetime.test.js`
Expected: FAIL — `Cannot find module '…/out/datetime'`.

- [ ] **Step 3: Write minimal implementation** — créer `src/datetime.ts` :

```ts
// Valeurs DATE, TIME et TIMESTAMP au format *ISO. Composantes entières :
// ni fuseau horaire ni flottant, le timestamp garde ses 6 chiffres de microsecondes.

export type DateTimeKind = 'date' | 'time' | 'timestamp';
export type DateTimeValue = RpgDate | RpgTime | RpgTimestamp;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export class RpgDate {
  readonly kind = 'date' as const;
  constructor(readonly year: number, readonly month: number, readonly day: number) {}
  toString(): string {
    return `${pad(this.year, 4)}-${pad(this.month, 2)}-${pad(this.day, 2)}`;
  }
}

export class RpgTime {
  readonly kind = 'time' as const;
  constructor(readonly hour: number, readonly minute: number, readonly second: number) {}
  toString(): string {
    return `${pad(this.hour, 2)}.${pad(this.minute, 2)}.${pad(this.second, 2)}`;
  }
}

export class RpgTimestamp {
  readonly kind = 'timestamp' as const;
  constructor(readonly date: RpgDate, readonly time: RpgTime, readonly microseconds: number) {}
  toString(): string {
    return `${this.date}-${this.time}.${pad(this.microseconds, 6)}`;
  }
}

// *LOVAL / *HIVAL : la valeur dépend du type de la cible, résolue à l'affectation ou à la comparaison
export class FigurativeValue {
  constructor(readonly name: '*loval' | '*hival') {}
}

function makeDate(year: number, month: number, day: number): RpgDate | undefined {
  const valid = year >= 1 && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth(year, month);
  return valid ? new RpgDate(year, month, day) : undefined;
}

// 24.00.00 n'est admis que tel quel (minuit en fin de journée), comme sur IBM i
function makeTime(hour: number, minute: number, second: number): RpgTime | undefined {
  const valid = hour === 24
    ? minute === 0 && second === 0
    : hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
  return valid ? new RpgTime(hour, minute, second) : undefined;
}

const ISO_PATTERNS: { [kind in DateTimeKind]: RegExp } = {
  date: /^(\d{4})-(\d{2})-(\d{2})$/,
  time: /^(\d{2})\.(\d{2})\.(\d{2})$/,
  timestamp: /^(\d{4})-(\d{2})-(\d{2})-(\d{2})\.(\d{2})\.(\d{2})\.(\d{6})$/,
};

// Lecture stricte du format *ISO ; undefined si le texte n'est pas une valeur valide
export function parseIso(kind: DateTimeKind, text: string): DateTimeValue | undefined {
  const match = ISO_PATTERNS[kind].exec(text);
  if (!match) return undefined;
  const n = match.slice(1).map(Number);
  if (kind === 'date') return makeDate(n[0], n[1], n[2]);
  if (kind === 'time') return makeTime(n[0], n[1], n[2]);
  const date = makeDate(n[0], n[1], n[2]);
  const time = makeTime(n[3], n[4], n[5]);
  if (!date || !time || (time.hour === 24 && n[6] !== 0)) return undefined;
  return new RpgTimestamp(date, time, n[6]);
}

const LOW_VALUES = { date: '0001-01-01', time: '00.00.00', timestamp: '0001-01-01-00.00.00.000000' };
const HIGH_VALUES = { date: '9999-12-31', time: '24.00.00', timestamp: '9999-12-31-24.00.00.000000' };

export function lowValue(kind: DateTimeKind): DateTimeValue {
  return parseIso(kind, LOW_VALUES[kind])!;
}

export function highValue(kind: DateTimeKind): DateTimeValue {
  return parseIso(kind, HIGH_VALUES[kind])!;
}

export function resolveFigurative(value: FigurativeValue, kind: DateTimeKind): DateTimeValue {
  return value.name === '*loval' ? lowValue(kind) : highValue(kind);
}

// Instant présent lu en heure locale, comme l'horloge système d'IBM i
export function fromClock(kind: DateTimeKind, now: Date): DateTimeValue {
  const date = new RpgDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const time = new RpgTime(now.getHours(), now.getMinutes(), now.getSeconds());
  if (kind === 'date') return date;
  if (kind === 'time') return time;
  return new RpgTimestamp(date, time, now.getMilliseconds() * 1000);
}

export function isDateTime(value: any): value is DateTimeValue {
  return value instanceof RpgDate || value instanceof RpgTime || value instanceof RpgTimestamp;
}

export function kindOf(value: any): DateTimeKind | undefined {
  return isDateTime(value) ? value.kind : undefined;
}

export function isDateTimeType(typeName: string): typeName is DateTimeKind {
  return typeName === 'date' || typeName === 'time' || typeName === 'timestamp';
}

function sortKey(value: DateTimeValue): number[] {
  if (value instanceof RpgDate) return [value.year, value.month, value.day];
  if (value instanceof RpgTime) return [value.hour, value.minute, value.second];
  return [...sortKey(value.date), ...sortKey(value.time), value.microseconds];
}

// Deux valeurs du même type : négatif, nul ou positif
export function compareDateTime(a: DateTimeValue, b: DateTimeValue): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile && node --test test/datetime.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/datetime.ts test/datetime.test.js
git commit -m "Dates : module des valeurs DATE, TIME et TIMESTAMP *ISO" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Déclarations, littéraux, formats et contrôle de type

**Files:**
- Modify: `src/errors.ts`, `src/types.ts` (enum `TokenType`, `ExpressionNode.valueType`), `src/lexer.ts` (`tokenize`, nouvelle méthode), `src/parser.ts` (`UNSUPPORTED_TYPE_TOKENS`, `parseControlOptions`, `parseDataType`, `parsePrimary`), `src/datatypes.ts` (`defaultValue`, `coerce`), `src/interpreter.ts` (`evaluate`)
- Test: `test/dates.test.js` (nouveau), `test/unsupported.test.js`

**Interfaces:**
- Consumes: `parseIso`, `lowValue`, `isDateTime`, `kindOf`, `isDateTimeType`, `DateTimeKind`, `DateTimeValue` (tâche 1).
- Produces:
  - `errors.ts` : `STATUS_INVALID_DATE = 112`, `incompatibleTypes(what: string): Error`
  - `datatypes.ts` : `describeValue(value: any): string`
  - `types.ts` : `TokenType.DATE_LITERAL | TIME_LITERAL | TIMESTAMP_LITERAL` (valeur du token = texte entre apostrophes), `valueType: 'datetime'` (valeur = instance `DateTimeValue`)
  - `parser.ts` : constante module `DATETIME_LITERALS: Map<TokenType, DateTimeKind>`
  - `DataTypeNode` des types date : `{ type: 'DataType', typeName: 'date' | 'time' | 'timestamp' }` (sans longueur ni format)

- [ ] **Step 1: Write the failing tests**

Créer `test/dates.test.js` :

```js
// Dates, heures et timestamps (socle *ISO) : comportement attendu sur IBM i
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

test('valeurs par défaut sans INZ', () => {
  const out = run(`
    dcl-s d date;
    dcl-s t time;
    dcl-s z timestamp;
    dsply %char(d);
    dsply %char(t);
    dsply %char(z);
  `);
  assert.deepEqual(out, ['0001-01-01', '00.00.00', '0001-01-01-00.00.00.000000']);
});

test('littéraux D, T et Z en INZ et en affectation, casse indifférente', () => {
  const out = run(`
    dcl-s d date inz(D'2026-10-04');
    dcl-s t time inz(t'13.45.00');
    dcl-s z timestamp inz(Z'2026-10-04-13.45.00.000123');
    dsply d;
    dsply t;
    dsply z;
    d = d'2024-02-29';
    dsply d;
  `);
  assert.deepEqual(out, ['2026-10-04', '13.45.00', '2026-10-04-13.45.00.000123', '2024-02-29']);
});

test('un littéral invalide est une erreur d\'analyse', () => {
  assert.throws(() => parse(`dcl-s d date inz(D'2026-02-30');`), /D'2026-02-30'.*invalide.*ligne 1/i);
  assert.throws(() => parse(`dcl-s t time; t = T'25.00.00';`), /invalide/i);
  assert.throws(() => parse(`dcl-s t time; t = T'13:45:00';`), /invalide/i);
});

test('date(*ISO), time(*ISO) et timestamp(6) sont acceptés', () => {
  const out = run(`
    dcl-s d date(*iso) inz(D'2026-10-04');
    dcl-s t time(*ISO);
    dcl-s z timestamp(6);
    dsply d;
  `);
  assert.deepEqual(out, ['2026-10-04']);
});

test('ctl-opt datfmt(*iso) timfmt(*iso) est accepté', () => {
  assert.deepEqual(run(`ctl-opt dftactgrp(*no) datfmt(*iso) timfmt(*iso); dsply 'ok';`), ['ok']);
});

test('dates dans une DS, en paramètre et en retour de procédure', () => {
  const out = run(`
    dcl-ds cmd qualified;
      num int(10);
      livraison date inz(D'2026-12-24');
    end-ds;
    dsply Cmd.Livraison;
    dsply %char(noel(cmd.livraison));
    dcl-proc noel;
      dcl-pi *n date;
        d date const;
      end-pi;
      dsply d;
      return D'2026-12-25';
    end-proc;
  `);
  assert.deepEqual(out, ['2026-12-24', '2026-12-24', '2026-12-25']);
});

test('une date passe par référence à un programme appelé', () => {
  const callee = `dcl-pi *n; d date; end-pi; dsply d; d = D'2027-01-01';`;
  const out = run(`
    dcl-pr suivant extpgm('SUIVANT');
      d date;
    end-pr;
    dcl-s d date inz(D'2026-10-04');
    suivant(d);
    dsply d;
  `, undefined, { resolveProgram: name => (name === 'SUIVANT' ? { source: callee } : undefined) });
  assert.deepEqual(out, ['2026-10-04', '2027-01-01']);
});

test('affecter un texte, un nombre ou un autre type à une date est refusé', () => {
  assert.throws(() => run(`dcl-s d date; d = '2026-10-04';`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; d = 20261004;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; dcl-s z timestamp; d = z;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s c char(10); c = D'2026-10-04';`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s n packed(8:0); n = D'2026-10-04';`), INCOMPATIBLE);
});

test('une erreur de type n\'est pas interceptée par MONITOR', () => {
  assert.throws(() => run(`
    dcl-s d date;
    monitor;
      d = 'x';
    on-error;
      dsply 'intercepté';
    endmon;
  `), INCOMPATIBLE);
});
```

Dans `test/unsupported.test.js`, remplacer le test « les types sans sémantique sont refusés » par :

```js
test('les types sans sémantique sont refusés', () => {
  for (const decl of ['dcl-s f float(8);', 'dcl-s p pointer;']) {
    assert.throws(() => parse(decl), NOT_SUPPORTED, decl);
  }
});

test('les formats de date et d\'heure autres que *ISO sont refusés', () => {
  for (const decl of ['dcl-s d date(*eur);', 'dcl-s d date(*dmy);', 'dcl-s t time(*hms);',
                      'dcl-s d date(*iso0);', 'dcl-s d date(*iso-);']) {
    assert.throws(() => parse(decl), NOT_SUPPORTED, decl);
  }
});

test('CTL-OPT DATFMT ou TIMFMT autre que *ISO est refusé', () => {
  assert.throws(() => parse(`ctl-opt datfmt(*eur);`), err => NOT_SUPPORTED.test(err.message) && /DATFMT/.test(err.message));
  assert.throws(() => parse(`ctl-opt timfmt(*hms);`), err => NOT_SUPPORTED.test(err.message) && /TIMFMT/.test(err.message));
});

test('TIMESTAMP(n) autre que 6 est refusé', () => {
  assert.throws(() => parse(`dcl-s z timestamp(3);`), NOT_SUPPORTED);
  assert.throws(() => parse(`dcl-s z timestamp(12);`), NOT_SUPPORTED);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/dates.test.js test/unsupported.test.js`
Expected: FAIL — `Le type DATE : pas encore supporté` sur les tests de dates ; les refus `date(*eur)`, `ctl-opt datfmt(*eur)`, `timestamp(3)` ne lèvent pas d'erreur « pas encore supporté ».

- [ ] **Step 3: Implement**

`src/errors.ts` — ajouter après `STATUS_CALL_NOT_FOUND` :

```ts
export const STATUS_INVALID_DATE = 112;     // RNX0112 : date, heure ou timestamp invalide

// Instruction que le compilateur IBM i refuserait : ce n'est pas une erreur d'exécution RPG,
// MONITOR ne l'intercepte donc pas
export function incompatibleTypes(what: string): Error {
  return new Error(`${what} : types incompatibles, le compilateur IBM i refuse cette instruction`);
}
```

`src/types.ts` — dans l'enum, section « Littéraux et identifiants », ajouter :

```ts
  DATE_LITERAL = 'DATE_LITERAL',           // D'2026-10-04'
  TIME_LITERAL = 'TIME_LITERAL',           // T'13.45.00'
  TIMESTAMP_LITERAL = 'TIMESTAMP_LITERAL', // Z'2026-10-04-13.45.00.000000'
```

et dans `ExpressionNode` :

```ts
  valueType?: 'number' | 'string' | 'boolean' | 'identifier' | 'builtin' | 'special' | 'call' | 'datetime';
```

`src/lexer.ts` — dans `tokenize`, juste avant `} else if (this.isAlpha(char)) {` :

```ts
      } else if (/[dtz]/i.test(char) && this.peek(1) === "'") {
        // Littéraux D'2026-10-04', T'13.45.00', Z'2026-10-04-13.45.00.000000'
        this.readDateTimeLiteral(char.toLowerCase() as 'd' | 't' | 'z');
```

et la méthode, après `readString` :

```ts
  private readDateTimeLiteral(letter: 'd' | 't' | 'z') {
    const types = { d: TokenType.DATE_LITERAL, t: TokenType.TIME_LITERAL, z: TokenType.TIMESTAMP_LITERAL };
    this.advance(); // La lettre ; readString lit le texte entre apostrophes
    this.readString("'");
    this.tokens[this.tokens.length - 1].type = types[letter];
  }
```

`src/parser.ts` :

1. Imports et constantes en tête de fichier :

```ts
import { DateTimeKind, isDateTimeType, parseIso } from './datetime';
```

```ts
// Types reconnus par la syntaxe mais sans sémantique dans l'interpréteur
const UNSUPPORTED_TYPE_TOKENS = [TokenType.POINTER];

const DATETIME_LITERALS = new Map<TokenType, DateTimeKind>([
  [TokenType.DATE_LITERAL, 'date'], [TokenType.TIME_LITERAL, 'time'], [TokenType.TIMESTAMP_LITERAL, 'timestamp'],
]);
```

2. Remplacer `parseControlOptions` :

```ts
  // Options sans effet ici, sauf DATFMT et TIMFMT : un autre format que *ISO changerait les dates
  private parseControlOptions(): ASTNode {
    this.expect(TokenType.CTL_OPT);
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      const keyword = this.advance().value.toLowerCase();
      if ((keyword === 'datfmt' || keyword === 'timfmt') && this.check(TokenType.LPAREN)) {
        this.advance();
        const format = this.advance();
        if (format.value.toLowerCase() !== '*iso' || !this.check(TokenType.RPAREN)) {
          const text = `${format.value}${this.check(TokenType.RPAREN) ? '' : this.peek().value}`.toUpperCase();
          throw unsupported(`CTL-OPT ${keyword.toUpperCase()}(${text})`, format);
        }
      }
    }
    this.expect(TokenType.SEMICOLON);
    return { type: 'ControlOptions' } as any;
  }
```

3. Dans `parseDataType`, juste après `const typeName = typeToken.value;` :

```ts
    if (isDateTimeType(typeName)) return this.parseDateTimeType(typeName);
```

et la méthode, après `parseDataType` :

```ts
  // date | date(*ISO) | time | time(*ISO) | timestamp | timestamp(6) : seul le format *ISO est supporté
  private parseDateTimeType(typeName: DateTimeKind): DataTypeNode {
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const arg = this.advance();
      if (typeName === 'timestamp') {
        if (arg.type !== TokenType.NUMBER || parseInt(arg.value) !== 6 || !this.check(TokenType.RPAREN)) {
          throw unsupported(`TIMESTAMP(${arg.value})`, arg);
        }
      } else if (arg.value.toLowerCase() !== '*iso' || !this.check(TokenType.RPAREN)) {
        const text = `${arg.value}${this.check(TokenType.RPAREN) ? '' : this.peek().value}`.toUpperCase();
        throw unsupported(`Le format ${text} de ${typeName.toUpperCase()}`, arg);
      }
      this.expect(TokenType.RPAREN);
    }
    return { type: 'DataType', typeName };
  }
```

4. Dans `parsePrimary`, avant le bloc `if (this.check(TokenType.SPECIAL_VALUE)) {` :

```ts
    const literalKind = DATETIME_LITERALS.get(this.peek().type);
    if (literalKind) {
      const token = this.advance();
      const value = parseIso(literalKind, token.value);
      if (!value) {
        const letter = { date: 'D', time: 'T', timestamp: 'Z' }[literalKind];
        throw new Error(`${letter}'${token.value}' : littéral ${literalKind.toUpperCase()} invalide (ligne ${token.line})`);
      }
      return { type: 'Expression', value, valueType: 'datetime' };
    }
```

`src/datatypes.ts` :

1. Imports :

```ts
import { DateTimeKind, isDateTime, isDateTimeType, kindOf, lowValue } from './datetime';
import { RpgError, STATUS_INVALID_NUMERIC, STATUS_OVERFLOW, incompatibleTypes } from './errors';
```

2. Dans `defaultValue`, remplacer `case 'date': return new Date();` par :

```ts
    case 'date': case 'time': case 'timestamp': return lowValue(type.typeName as DateTimeKind);
```

3. Dans `coerce`, juste après `if (!type || value === undefined || value === null) return value;` :

```ts
  if (isDateTimeType(type.typeName)) return coerceDateTime(value, type, target);
  if (isDateTime(value)) throw incompatibleAssignment(value, type, target);
```

4. Ajouter en fin de fichier :

```ts
// Une date, une heure ou un timestamp ne reçoit qu'une valeur du même type
function coerceDateTime(value: any, type: DataTypeNode, target: string): any {
  if (kindOf(value) === type.typeName) return value;
  throw incompatibleAssignment(value, type, target);
}

function incompatibleAssignment(value: any, type: DataTypeNode, target: string): Error {
  return incompatibleTypes(`Affectation de ${describeValue(value)} à ${target} ${describeType(type)}`);
}

// Nature d'une valeur pour les messages d'erreur
export function describeValue(value: any): string {
  const kind = kindOf(value);
  if (kind) return `${kind.toUpperCase()} ${value}`;
  if (typeof value === 'number') return `numérique ${value}`;
  if (typeof value === 'boolean') return 'indicateur';
  return `caractère '${value}'`;
}
```

`src/interpreter.ts` — dans `evaluate`, après le bloc `if (expr.valueType === 'string') { … }` :

```ts
    if (expr.valueType === 'datetime') {
      return expr.value;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — tous les tests, y compris les 9 de `dates.test.js` et les 4 nouveaux/modifiés de `unsupported.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/types.ts src/lexer.ts src/parser.ts src/datatypes.ts src/interpreter.ts test/dates.test.js test/unsupported.test.js
git commit -m "Dates : déclarations DATE/TIME/TIMESTAMP *ISO, littéraux et contrôle de type" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Comparaisons et opérations refusées

**Files:**
- Modify: `src/interpreter.ts` (`executeOperator`, nouvelles fonctions de module)
- Test: `test/dates.test.js`

**Interfaces:**
- Consumes: `isDateTime`, `kindOf`, `compareDateTime`, `FigurativeValue`, `resolveFigurative` (tâche 1) ; `incompatibleTypes` (tâche 2) ; `describeValue` (tâche 2).
- Produces: comparaison de deux dates du même type ; un `FigurativeValue` comparé prend le type de l'autre opérande (exercé en tâche 4).

- [ ] **Step 1: Write the failing tests** — ajouter à `test/dates.test.js` :

```js
test('comparaisons entre dates, heures et timestamps', () => {
  const out = run(`
    dcl-s debut date inz(D'2026-01-31');
    dcl-s fin date inz(D'2026-02-01');
    dcl-s t1 time inz(T'08.00.00');
    dcl-s z1 timestamp inz(Z'2026-10-04-13.45.00.000001');
    if debut < fin;
      dsply 'avant';
    endif;
    if fin >= D'2026-02-01' and fin <> debut;
      dsply 'egal ou apres';
    endif;
    if t1 > T'07.59.59';
      dsply 'plus tard';
    endif;
    if z1 > Z'2026-10-04-13.45.00.000000';
      dsply 'une microseconde';
    endif;
  `);
  assert.deepEqual(out, ['avant', 'egal ou apres', 'plus tard', 'une microseconde']);
});

test('comparer une date à un autre type est refusé', () => {
  assert.throws(() => run(`dcl-s d date; if d = '0001-01-01'; endif;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; if d > 20261004; endif;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; dcl-s z timestamp; if d = z; endif;`), INCOMPATIBLE);
});

test('calculer ou concaténer avec une date est refusé', () => {
  assert.throws(() => run(`dcl-s d date; dsply 'Le ' + d;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; d = d + 1;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s t time; dcl-s n int(5); n = t * 2;`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s d date; if not d; endif;`), INCOMPATIBLE);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/dates.test.js`
Expected: FAIL — les comparaisons d'objets donnent `NaN`/faux (aucun DSPLY), et `'Le ' + d` concatène au lieu de lever « types incompatibles ».

- [ ] **Step 3: Implement** — dans `src/interpreter.ts` :

Imports :

```ts
import { coerce, defaultValue, describeValue, formatChar } from './datatypes';
import { FigurativeValue, compareDateTime, isDateTime, kindOf, resolveFigurative } from './datetime';
import { RpgError, STATUS_CALL_FAILED, STATUS_CALL_NOT_FOUND, STATUS_DIVIDE_BY_ZERO, incompatibleTypes, matchesStatus } from './errors';
```

Après la fonction `compare`, ajouter :

```ts
const COMPARISONS: { [op: string]: (c: number) => boolean } = {
  '=': c => c === 0, '<>': c => c !== 0, '<': c => c < 0, '<=': c => c <= 0, '>': c => c > 0, '>=': c => c >= 0,
};

const involvesDateTime = (value: any) => isDateTime(value) || value instanceof FigurativeValue;

// Avec une date, une heure ou un timestamp, seule la comparaison au même type est permise.
// *LOVAL / *HIVAL prennent le type de l'autre opérande.
function dateTimeOperation(op: string, left: any, right: any): boolean {
  const test = COMPARISONS[op];
  if (left instanceof FigurativeValue && kindOf(right)) left = resolveFigurative(left, kindOf(right)!);
  if (right instanceof FigurativeValue && kindOf(left)) right = resolveFigurative(right, kindOf(left)!);
  if (test && kindOf(left) !== undefined && kindOf(left) === kindOf(right)) {
    return test(compareDateTime(left, right));
  }
  const operands = right === undefined ? describeValue(left) : `${describeValue(left)} et ${describeValue(right)}`;
  throw incompatibleTypes(`Opération ${op.toUpperCase()} avec ${operands}`);
}
```

Dans `executeOperator`, juste après le calcul de `left` et `right` :

```ts
    if (involvesDateTime(left) || involvesDateTime(right)) {
      return dateTimeOperation(expr.operator!, left, right);
    }
```

Dans `src/datatypes.ts`, compléter `describeValue` (première ligne du corps) pour les valeurs spéciales :

```ts
  if (value instanceof FigurativeValue) return value.name.toUpperCase();
```

avec l'import `FigurativeValue` ajouté à la ligne `import { … } from './datetime';`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interpreter.ts src/datatypes.ts test/dates.test.js
git commit -m "Dates : comparaisons, opérations mixtes refusées comme à la compilation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Valeurs spéciales `*SYS`, `*JOB`, `*LOVAL`, `*HIVAL` et horloge

**Files:**
- Modify: `src/parser.ts` (suivi des noms date, `parseVariableDeclaration`, `parseDeclarationKeywords`, `parseDataStructure`, `parseProcedure`, `parseProcedureInterface`, `parseAssignmentOrCall`, `parseComparison`), `src/runtime.ts` (constructeur, `now()`), `src/builtins.ts` (`BuiltinContext`), `src/interpreter.ts` (`InterpreterOptions`, constructeur, déclarations, `evaluate`), `src/datatypes.ts` (`coerceDateTime`)
- Test: `test/dates.test.js`, `test/unsupported.test.js`

**Interfaces:**
- Consumes: `FigurativeValue`, `resolveFigurative`, `fromClock`, `isDateTimeType` (tâche 1).
- Produces:
  - `InterpreterOptions.clock?: () => Date` ; `Runtime` constructeur `(context?, clock?: () => Date)` ; `Runtime.now(): Date` ; `BuiltinContext.now(): Date` (utilisé par la tâche 5).
  - Le parser n'accepte `*LOVAL/*HIVAL` qu'en `INZ` d'un type date, en affectation à un nom déclaré date, ou comparé à un nom déclaré date ; `*SYS` en `INZ` de date/heure/timestamp ; `*JOB` en `INZ` de date. Ailleurs : « La valeur spéciale … : pas encore supporté » (comportement existant de `parsePrimary`).

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/dates.test.js` (après les constantes) :

```js
// 4 octobre 2026, 13 h 45 min 07 s 089 ms, heure locale
const CLOCK = { clock: () => new Date(2026, 9, 4, 13, 45, 7, 89) };
```

et les tests :

```js
test('INZ(*SYS) et INZ(*JOB) lisent l\'horloge', () => {
  const out = run(`
    dcl-s d date inz(*sys);
    dcl-s j date inz(*JOB);
    dcl-s t time inz(*SYS);
    dcl-s z timestamp inz(*sys);
    dsply d;
    dsply j;
    dsply t;
    dsply z;
  `, undefined, CLOCK);
  assert.deepEqual(out, ['2026-10-04', '2026-10-04', '13.45.07', '2026-10-04-13.45.07.089000']);
});

test('*LOVAL et *HIVAL en INZ, affectation et comparaison', () => {
  const out = run(`
    dcl-s d date inz(*hival);
    dcl-s t time;
    dcl-ds p qualified;
      z timestamp inz(*loval);
    end-ds;
    dsply d;
    t = *HIVAL;
    dsply t;
    dsply p.z;
    if P.Z = *loval and d <> *loval;
      dsply 'ok';
    endif;
    d = *loval;
    if d = *loval;
      dsply 'remis';
    endif;
  `);
  assert.deepEqual(out, ['9999-12-31', '24.00.00', '0001-01-01-00.00.00.000000', 'ok', 'remis']);
});

test('*HIVAL sur un champ de DS non qualifiée et sur un paramètre', () => {
  const out = run(`
    dcl-ds infos;
      echeance date;
    end-ds;
    echeance = *hival;
    dsply echeance;
    verifier(echeance);
    dcl-proc verifier;
      dcl-pi *n;
        d date const;
      end-pi;
      if d = *hival;
        dsply 'sans echeance';
      endif;
    end-proc;
  `);
  assert.deepEqual(out, ['9999-12-31', 'sans echeance']);
});
```

Ajouter à `test/unsupported.test.js` (section « Valeurs spéciales ») :

```js
test('*SYS et *JOB ne sont acceptés qu\'en INZ d\'une date ou d\'une heure', () => {
  for (const src of ['dcl-s c char(10) inz(*sys);', 'dcl-s t time inz(*job);', 'dcl-s d date; d = *sys;']) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('*LOVAL et *HIVAL hors date ou heure restent refusés', () => {
  for (const src of [
    'dcl-s n int(5) inz(*loval);',
    'dcl-s d date; dcl-s x int(5); x = *hival;',
    'dcl-proc p; dcl-s d date; end-proc; dcl-s d char(5); d = *loval;',
    'dcl-s d date; if d + 1 = *loval; endif;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/dates.test.js test/unsupported.test.js`
Expected: FAIL — « La valeur spéciale *SYS : pas encore supporté » / « *HIVAL » sur les nouveaux tests de dates.

- [ ] **Step 3: Implement**

`src/parser.ts` :

1. Champ de classe (après `private pos: number = 0;`) :

```ts
  // Noms déclarés DATE / TIME / TIMESTAMP ('var', 'ds.champ', champ de DS non qualifiée) :
  // *LOVAL et *HIVAL ne sont acceptés que pour eux
  private dateTimeNames = new Set<string>();
```

2. Méthodes utilitaires (après `isTypeToken`) :

```ts
  // Une déclaration d'un autre type masque un nom date homonyme (variable locale)
  private rememberDateTime(name: string, dataType: DataTypeNode): void {
    if (isDateTimeType(dataType.typeName)) {
      this.dateTimeNames.add(name.toLowerCase());
    } else {
      this.dateTimeNames.delete(name.toLowerCase());
    }
  }

  // Valeurs spéciales permises dans INZ selon le type déclaré
  private inzSpecials(dataType: DataTypeNode): string[] {
    if (dataType.typeName === 'date') return ['*loval', '*hival', '*sys', '*job'];
    if (isDateTimeType(dataType.typeName)) return ['*loval', '*hival', '*sys'];
    return [];
  }

  // Valeur spéciale propre aux dates à la position courante, si elle est permise ici
  // (et suivie du token de fin attendu, s'il est donné)
  private parseDateTimeSpecial(allowed: string[], end?: TokenType): ExpressionNode | undefined {
    const token = this.peek();
    if (token.type !== TokenType.SPECIAL_VALUE || !allowed.includes(token.value)) return undefined;
    if (end !== undefined && this.peekNext()?.type !== end) return undefined;
    this.advance();
    return { type: 'Expression', value: token.value, valueType: 'special' };
  }
```

3. `parseVariableDeclaration` :

```ts
  private parseVariableDeclaration(): ASTNode {
    this.expect(TokenType.DCL_S);
    const name = this.expect(TokenType.IDENTIFIER).value;
    const dataType = this.parseDataType();
    this.rememberDateTime(name, dataType);
    const initialValue = this.parseDeclarationKeywords('DCL-S', dataType);
    this.expect(TokenType.SEMICOLON);
    return { type: 'VariableDeclaration', name, dataType, initialValue };
  }
```

4. `parseDeclarationKeywords(context: string, dataType: DataTypeNode)` — signature changée, et dans le bloc `INZ(` :

```ts
          initialValue = this.parseDateTimeSpecial(this.inzSpecials(dataType), TokenType.RPAREN) ?? this.parseExpression();
```

5. `parseDataStructure`, boucle des champs :

```ts
      const fieldName = this.expect(TokenType.IDENTIFIER).value;
      const fieldType = this.parseDataType();
      this.rememberDateTime(`${name}.${fieldName}`, fieldType);
      if (!isQualified) this.rememberDateTime(fieldName, fieldType);
      const initialValue = this.parseDeclarationKeywords('champ de DS', fieldType);
```

6. `parseProcedure` : première ligne du corps `const outerNames = new Set(this.dateTimeNames);` et, juste après `this.expect(TokenType.END_PROC);`, `this.dateTimeNames = outerNames; // Les noms locaux disparaissent avec la procédure`.

7. `parseProcedureInterface` : juste avant le `return { returnType, parameters };` final (forme longue) :

```ts
    parameters.forEach(p => this.rememberDateTime(p.name, p.dataType));
```

8. `parseAssignmentOrCall`, branche `if (this.check(TokenType.EQUALS)) {` :

```ts
      this.advance();
      const allowed = this.dateTimeNames.has(name.toLowerCase()) ? ['*loval', '*hival'] : [];
      const value = this.parseDateTimeSpecial(allowed, TokenType.SEMICOLON) ?? this.parseExpression();
```

9. `parseComparison`, après `const op = this.advance().value;` :

```ts
      const allowed = left.valueType === 'identifier' && this.dateTimeNames.has(String(left.value).toLowerCase())
        ? ['*loval', '*hival'] : [];
      const right = this.parseDateTimeSpecial(allowed) ?? this.parseAddition();
```

`src/runtime.ts` :

```ts
  constructor(context?: ExecutionContext, private clock: () => Date = () => new Date()) {
```

et, après `executeBuiltin` :

```ts
  // Instant présent : *SYS, *JOB, %DATE()... (horloge injectable pour les tests)
  now(): Date {
    return this.clock();
  }
```

`src/builtins.ts` — `BuiltinContext` :

```ts
export interface BuiltinContext {
  status: number; // Pour %STATUS
  now(): Date;    // Pour %DATE(), %TIME(), %TIMESTAMP()
}
```

`src/interpreter.ts` :

1. `InterpreterOptions` — ajouter :

```ts
  // Horloge de *SYS, *JOB, %DATE()... ; les tests la figent
  clock?: () => Date;
```

2. Constructeur : `this.runtime = new Runtime(this.context, options.clock);`

3. Imports : ajouter `fromClock`, `isDateTimeType` à l'import de `./datetime`.

4. Remplacer `executeVariableDeclaration` et la valeur des champs dans `executeDataStructure` :

```ts
  private executeVariableDeclaration(node: any): void {
    this.runtime.declareVariable(node.name, this.initialValue(node.initialValue, node.dataType), node.dataType);
  }
```

```ts
      value: this.initialValue(field.initialValue, field.dataType),
```

et ajouter :

```ts
  // Valeur de INZ ; INZ(*SYS) et INZ(*JOB) lisent l'horloge (*JOB : date du jour, faute de travail IBM i)
  private initialValue(expr: ExpressionNode | undefined, type: DataTypeNode): any {
    if (!expr) return defaultValue(type);
    if (expr.valueType === 'special' && (expr.value === '*sys' || expr.value === '*job') && isDateTimeType(type.typeName)) {
      return fromClock(type.typeName, this.runtime.now());
    }
    return this.evaluate(expr);
  }
```

5. `evaluate`, dans le `switch (expr.value)` des valeurs spéciales :

```ts
        case '*loval': case '*hival': return new FigurativeValue(expr.value);
```

`src/datatypes.ts` — `coerceDateTime`, première ligne :

```ts
  if (value instanceof FigurativeValue) return resolveFigurative(value, type.typeName as DateTimeKind);
```

et dans `coerce`, juste après la ligne `if (isDateTimeType(type.typeName)) return coerceDateTime(value, type, target);` (filet de sécurité si le parser laissait passer un cas) :

```ts
  if (value instanceof FigurativeValue) {
    throw new Error(`${value.name.toUpperCase()} affecté à ${target} ${describeType(type)} : pas encore supporté par l'interpréteur`);
  }
```

(import `resolveFigurative` depuis `./datetime`).

Ajouter aussi à `test/unsupported.test.js`, dans le test « *LOVAL et *HIVAL hors date ou heure restent refusés », la source suivante (une variable locale `char` masque la date globale) :

```js
    'dcl-s d date; dcl-proc p; dcl-s d char(5); d = *loval; end-proc;',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, y compris l'ancien test « les valeurs spéciales non supportées sont refusées » (`x char(5); x = *hival;` reste refusé).

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts src/runtime.ts src/builtins.ts src/interpreter.ts src/datatypes.ts test/dates.test.js test/unsupported.test.js
git commit -m "Dates : INZ(*SYS/*JOB), *LOVAL/*HIVAL et horloge injectable" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `%DATE`, `%TIME`, `%TIMESTAMP`, `%CHAR(x : *ISO)` et statut 112

**Files:**
- Modify: `src/builtins.ts`, `src/parser.ts` (`parsePrimary` arguments de BIF, nouvelle méthode), `src/interpreter.ts` (branche `%char` de `evaluate`)
- Test: `test/dates.test.js`, `test/unsupported.test.js`

**Interfaces:**
- Consumes: `BuiltinContext.now()` (tâche 4) ; `parseIso`, `fromClock`, `kindOf`, `RpgDate`, `RpgTime`, `RpgTimestamp`, `DateTimeKind` (tâche 1) ; `STATUS_INVALID_DATE`, `incompatibleTypes` (tâche 2) ; `describeValue` (tâche 2).
- Produces: BIF `%date`, `%time`, `%timestamp` dans `BUILTINS`.

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/dates.test.js` :

```js
test('%DATE, %TIME et %TIMESTAMP sans argument lisent l\'horloge', () => {
  const out = run(`
    dsply %char(%date());
    dsply %char(%time());
    dsply %char(%timestamp());
  `, undefined, CLOCK);
  assert.deepEqual(out, ['2026-10-04', '13.45.07', '2026-10-04-13.45.07.089000']);
});

test('conversions entre date, heure et timestamp', () => {
  const out = run(`
    dcl-s z timestamp inz(Z'2026-10-04-13.45.07.000089');
    dcl-s d date inz(D'2026-12-24');
    dsply %char(%date(z));
    dsply %char(%time(z));
    dsply %char(%timestamp(d));
    dsply %char(%date(d));
  `);
  assert.deepEqual(out, ['2026-10-04', '13.45.07', '2026-12-24-00.00.00.000000', '2026-12-24']);
});

test('%DATE, %TIME et %TIMESTAMP lisent un texte *ISO', () => {
  const out = run(`
    dcl-s texte char(12) inz('2026-10-04');
    dcl-s d date;
    d = %date(texte);
    dsply d;
    dsply %char(%time('08.30.00'));
    dsply %char(%timestamp('2026-10-04-08.30.00.000000'));
  `);
  assert.deepEqual(out, ['2026-10-04', '08.30.00', '2026-10-04-08.30.00.000000']);
});

test('un texte invalide ou vide lève le statut 112, interceptable', () => {
  const out = run(`
    dcl-s d date;
    dcl-s vide char(10);
    monitor;
      d = %date('2026-02-30');
    on-error 112;
      dsply 'statut ' + %char(%status());
    endmon;
    monitor;
      d = %date(vide);
    on-error 00112;
      dsply 'vide';
    endmon;
  `);
  assert.deepEqual(out, ['statut 112', 'vide']);
  assert.throws(() => run(`dcl-s d date; d = %date('04/10/2026');`), /RNX0112/);
});

test('%DATE d\'une heure ou %TIME d\'une date est refusé', () => {
  assert.throws(() => run(`dcl-s t time; dcl-s d date; d = %date(t);`), INCOMPATIBLE);
  assert.throws(() => run(`dcl-s t time; dcl-s d date; t = %time(d);`), INCOMPATIBLE);
});

test('%CHAR(x : *ISO) donne le texte ISO', () => {
  const out = run(`
    dcl-s d date inz(D'2026-10-04');
    dcl-s t time inz(T'13.45.00');
    dsply 'Le ' + %char(d : *iso) + ' a ' + %char(t:*ISO);
  `);
  assert.deepEqual(out, ['Le 2026-10-04 a 13.45.00']);
  assert.throws(() => run(`dcl-s n int(5); dsply %char(n : *iso);`), INCOMPATIBLE);
});
```

Ajouter à `test/unsupported.test.js` (section « Fonctions intégrées ») :

```js
test('les fonctions et formats de dates des incréments suivants sont refusés', () => {
  for (const src of [
    `dcl-s d date; d = d + %days(1);`,
    `dcl-s n int(10); n = %diff(D'2026-10-04' : D'2026-01-01' : *days);`,
    `dcl-s n int(5); n = %subdt(D'2026-10-04' : *years);`,
    `dcl-s d date; d = %date('04/10/2026' : *eur);`,
    `dcl-s c char(10); c = %char(D'2026-10-04' : *eur);`,
    `dcl-s z timestamp; z = %timestamp('x' : 3);`,
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('%DATE d\'un nombre est refusé tant que les conversions numériques manquent', () => {
  assert.throws(() => run(`dcl-s d date; d = %date(20261004);`), NOT_SUPPORTED);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/dates.test.js test/unsupported.test.js`
Expected: FAIL — « La fonction %DATE : pas encore supporté » ; `%char(d : *iso)` refusé par « La valeur spéciale *ISO ».

- [ ] **Step 3: Implement**

`src/builtins.ts` — imports en tête :

```ts
import { DateTimeKind, RpgDate, RpgTime, RpgTimestamp, fromClock, kindOf, parseIso } from './datetime';
import { describeValue } from './datatypes';
import { RpgError, STATUS_INVALID_DATE, incompatibleTypes } from './errors';
```

fonction avant `BUILTINS` :

```ts
// %DATE / %TIME / %TIMESTAMP : instant présent, conversion entre types, ou lecture d'un texte *ISO
// (les blancs de fin d'un char sont ignorés ; texte invalide : statut 00112)
function toDateTime(kind: DateTimeKind, ctx: BuiltinContext, value: any): any {
  const name = `%${kind.toUpperCase()}`;
  if (value === undefined) return fromClock(kind, ctx.now());
  if (typeof value === 'string') {
    const parsed = parseIso(kind, value.trimEnd());
    if (!parsed) throw new RpgError(STATUS_INVALID_DATE, `Valeur '${value.trimEnd()}' invalide pour ${name} (RNX0112)`);
    return parsed;
  }
  if (typeof value === 'number') {
    throw new Error(`${name} d'une valeur numérique : pas encore supporté par l'interpréteur`);
  }
  if (kindOf(value) === kind) return value;
  if (kind === 'date' && value instanceof RpgTimestamp) return value.date;
  if (kind === 'time' && value instanceof RpgTimestamp) return value.time;
  if (kind === 'timestamp' && value instanceof RpgDate) return new RpgTimestamp(value, new RpgTime(0, 0, 0), 0);
  throw incompatibleTypes(`${name}(${describeValue(value)})`);
}
```

entrées dans `BUILTINS` (après `'%status'`) :

```ts
  '%date': (ctx, value?: any) => toDateTime('date', ctx, value),
  '%time': (ctx, value?: any) => toDateTime('time', ctx, value),
  '%timestamp': (ctx, value?: any) => toDateTime('timestamp', ctx, value),
```

`src/parser.ts` :

1. Constante de module :

```ts
// Fonctions dont le 2e argument est un format de date (*ISO, *EUR...)
const FORMAT_BUILTINS = new Set(['%char', '%date', '%time', '%timestamp']);
```

2. Dans `parsePrimary`, boucle des arguments de BIF, remplacer `args.push(this.parseExpression());` par :

```ts
        if (args.length === 1 && FORMAT_BUILTINS.has(name.toLowerCase())) {
          args.push(this.parseFormatArgument(name));
        } else {
          args.push(this.parseExpression());
        }
```

3. Méthode :

```ts
  // 2e argument de %CHAR / %DATE / %TIME / %TIMESTAMP : seul %CHAR(x : *ISO) est supporté
  private parseFormatArgument(builtin: string): ExpressionNode {
    const token = this.peek();
    if (builtin.toLowerCase() === '%char' && token.type === TokenType.SPECIAL_VALUE && token.value === '*iso') {
      this.advance();
      return { type: 'Expression', value: '*iso', valueType: 'special' };
    }
    throw unsupported(`${builtin.toUpperCase()} avec le 2e argument ${token.value.toUpperCase()}`, token);
  }
```

`src/interpreter.ts` — branche `%char` de `evaluate` :

```ts
      if (expr.value.name.toLowerCase() === '%char') {
        // %CHAR(x : *ISO) n'existe que pour une date, une heure ou un timestamp
        if (args.length > 1 && !isDateTime(args[0])) {
          throw incompatibleTypes(`%CHAR(${describeValue(args[0])} : *ISO)`);
        }
        // Le format dépend du type déclaré : variable, ou valeur de retour d'une procédure
        return formatChar(args[0], this.declaredType(expr.value.args[0]));
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/builtins.ts src/parser.ts src/interpreter.ts test/dates.test.js test/unsupported.test.js
git commit -m "Dates : %DATE, %TIME, %TIMESTAMP, %CHAR(x : *ISO) et statut 00112" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: SQL refusé, bouchons, README

**Files:**
- Modify: `src/parser.ts` (`parseSQL`), `src/interpreter.ts` (`executeSQL`, `callExternal`, fonction `fromMock`), `README.md`
- Test: `test/dates.test.js`

**Interfaces:**
- Consumes: `DATETIME_LITERALS` (tâche 2), `isDateTime`, `isDateTimeType`, `parseIso` (tâche 1), `Runtime.getType` (existant).

- [ ] **Step 1: Write the failing tests** — ajouter à `test/dates.test.js` (import : `const { parse, run, customersContext } = require('./helpers');`) :

```js
test('une variable hôte date dans EXEC SQL est refusée', () => {
  assert.throws(() => run(`
    dcl-s d date;
    exec sql select date_creation into :d from customers where id = 1;
  `, customersContext()), NOT_SUPPORTED);
  assert.throws(() => run(`
    dcl-s d date inz(D'2026-10-04');
    exec sql update customers set city = 'X' where date_maj < :d;
  `, customersContext()), NOT_SUPPORTED);
});

test('un littéral date dans EXEC SQL est refusé', () => {
  assert.throws(() => parse(`exec sql update customers set city = 'X' where d < D'2026-10-04';`), NOT_SUPPORTED);
});

test('un bouchon reçoit et renvoie des dates en texte *ISO', () => {
  const ctx = { tables: {}, files: {}, programs: {
    ECHEANCE: { calls: [{ when: { depart: '2026-10-04' }, set: { fin: '2026-11-04' } }] },
    DERNIER: { calls: [{ return: '2026-12-31' }] },
  } };
  const out = run(`
    dcl-pr echeance extpgm('ECHEANCE');
      depart date const;
      fin date;
    end-pr;
    dcl-pr dernier date extproc('DERNIER');
    end-pr;
    dcl-s fin date;
    echeance(D'2026-10-04' : fin);
    dsply fin;
    dsply %char(dernier());
  `, ctx);
  assert.deepEqual(out, ['2026-11-04', '2026-12-31']);
});

test('un bouchon qui renvoie une date invalide est une erreur claire', () => {
  const ctx = { tables: {}, files: {}, programs: { ECHEANCE: { calls: [{ set: { fin: '04/11/2026' } }] } } };
  assert.throws(() => run(`
    dcl-pr echeance extpgm('ECHEANCE');
      fin date;
    end-pr;
    dcl-s fin date;
    echeance(fin);
  `, ctx), /ECHEANCE.*'04\/11\/2026'.*DATE \*ISO/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/dates.test.js`
Expected: FAIL — le SQL renvoie un `SQLCOD` négatif au lieu d'une erreur « pas encore supporté » ; le littéral en SQL passe ; le bouchon lève « types incompatibles ».

- [ ] **Step 3: Implement**

`src/parser.ts` — `parseSQL`, première ligne du corps de la boucle, après `const token = this.advance();` :

```ts
        if (DATETIME_LITERALS.has(token.type)) {
          throw unsupported('Un littéral date ou heure dans EXEC SQL', token);
        }
```

`src/interpreter.ts` :

1. Import : ajouter `parseIso` (et garder `isDateTime`, `isDateTimeType`) à l'import de `./datetime`.

2. Fonction de module (après `dateTimeOperation`) :

```ts
// Un bouchon JSON donne les dates, heures et timestamps en texte *ISO
function fromMock(value: any, type: DataTypeNode | undefined, what: string): any {
  if (!type || !isDateTimeType(type.typeName) || typeof value !== 'string') return value;
  const parsed = parseIso(type.typeName, value);
  if (!parsed) throw new Error(`${what} : '${value}' n'est pas une valeur ${type.typeName.toUpperCase()} *ISO valide`);
  return parsed;
}
```

3. `callExternal` : `sameValue` devient

```ts
    const sameValue = (actual: any, expected: any) =>
      typeof actual === 'string' ? actual.trimEnd() === String(expected).trimEnd()
        : isDateTime(actual) ? String(actual) === String(expected)
        : actual === expected;
```

la ligne d'affectation de `set` devient

```ts
      this.assignTo(arg.value, coerce(fromMock(value, param.dataType, `Bouchon ${target}`), param.dataType, param.name));
```

et le `return` final

```ts
    return coerce(fromMock(matching.return, proto.returnType, `Bouchon ${target}`), proto.returnType, proto.name);
```

4. `executeSQL`, au début :

```ts
    // Variables hôtes date/heure : les dates en SQL font l'objet d'un incrément à venir
    for (const [, name] of node.sql.matchAll(/:([A-Za-z_$#@][\w$#@]*(?:\.[\w$#@]+)?)/g)) {
      const type = this.runtime.getType(name);
      if (type && isDateTimeType(type.typeName)) {
        throw new Error(`Variable hôte :${name} de type ${type.typeName.toUpperCase()} dans EXEC SQL : pas encore supporté par l'interpréteur`);
      }
    }
```

`README.md` :

1. Dans la liste des fonctionnalités, ligne **Types**, ajouter après `ind` : `, `date`, `time`, `timestamp` (voir ci-dessous)` ; ligne **Déclarations** : remplacer `ctl-opt` (ignoré) par `ctl-opt` (options ignorées, sauf `DATFMT`/`TIMFMT` : seul `*ISO` est accepté)` ; ligne **Fonctions intégrées** : ajouter `%date`, `%time`, `%timestamp`.

2. Nouvelle section, juste avant `## Limites connues` :

```markdown
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
```

3. Dans `## Limites connues`, remplacer `de dates ni de `float`` par `ni de `float``, et ajouter la ligne :

```markdown
- Dates : pas encore d'arithmétique (`%DAYS`, `%DIFF`, `%SUBDT`…), de formats autres que *ISO, de conversion numérique ↔ date, ni de dates en SQL
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — tous les tests.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts src/interpreter.ts README.md test/dates.test.js
git commit -m "Dates : refus explicite en SQL, dates des bouchons en texte ISO, README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Vérification finale

- [ ] `npm test` : tout vert, sortie collée dans le rapport.
- [ ] `git status --short` : seuls `fichiers_test/tstpgm.rpgle` (modifié) et `skills/` (non suivi) restent hors commit.
- [ ] Ne pas fusionner : attendre « fusionne » de l'utilisateur.
