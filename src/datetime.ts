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
