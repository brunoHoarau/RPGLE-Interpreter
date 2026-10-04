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

test('diffDateTime : résultat de plus de 15 chiffres refusé', () => {
  assert.equal(dt.diffDateTime(Z('2026-10-04-00.00.00.000000'), Z('1990-01-01-00.00.00.000000'), 'mseconds'), 'precision');
  assert.equal(dt.diffDateTime(Z('2026-10-05-00.00.00.000000'), Z('2026-10-04-00.00.00.000000'), 'mseconds'), 86400000000);
});
