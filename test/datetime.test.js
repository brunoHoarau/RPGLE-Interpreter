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
