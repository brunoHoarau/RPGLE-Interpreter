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
// timestamps en *SECONDS (fractions possibles sur IBM i), résultat de plus de 15 chiffres (limite incertaine)
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
  const limit = 999999999999999n;
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
