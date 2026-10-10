// Fichiers écran : image AREA du protocole SPECIAL et chaîne des indicateurs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const area = require(path.join(__dirname, '..', 'out', 'screens', 'area'));

const char = (name, length, usage = 'B') => ({ name, usage, length, type: { type: 'DataType', typeName: 'char', length } });
const zoned = (name, length, decimals, usage = 'B') =>
  ({ name, usage, length, type: { type: 'DataType', typeName: 'zoned', length, decimals } });

test('AREA : char complété à blanc, aller-retour', () => {
  const fields = [char('CODE', 6), char('CLE', 3, 'H')];
  const image = area.encodeArea(fields, new Map([['CODE', 'AB'], ['CLE', 'xyz']]));
  assert.equal(image, 'AB    xyz');
  assert.deepEqual([...area.decodeArea(fields, image)], [['CODE', 'AB    '], ['CLE', 'xyz']]);
});

test('AREA : valeur absente = blancs ou zéros', () => {
  const fields = [char('A', 2), zoned('N', 3, 0)];
  assert.equal(area.encodeArea(fields, new Map()), '  000');
});

test('AREA : zoned positif, zéros de tête, décimales', () => {
  const fields = [zoned('QTE', 5, 0), zoned('PRIX', 5, 2)];
  const image = area.encodeArea(fields, new Map([['QTE', 42], ['PRIX', 12.5]]));
  assert.equal(image, '0004201250');
  assert.deepEqual([...area.decodeArea(fields, image)], [['QTE', 42], ['PRIX', 12.5]]);
});

test('AREA : zoned négatif (dernière position J..R, } pour 0)', () => {
  const f = [zoned('N', 3, 0)];
  assert.equal(area.encodeArea(f, new Map([['N', -12]])), '01K');
  assert.equal(area.decodeArea(f, '01K').get('N'), -12);
  assert.equal(area.encodeArea(f, new Map([['N', -10]])), '01}');
  assert.equal(area.decodeArea(f, '01}').get('N'), -10);
  assert.equal(area.encodeArea(f, new Map([['N', -1]])), '00J');
  assert.equal(area.encodeArea(f, new Map([['N', -9]])), '00R');
  assert.equal(area.decodeArea(f, '00R').get('N'), -9);
});

test('AREA : zoned négatif avec décimales', () => {
  const f = [zoned('N', 5, 2)];
  const image = area.encodeArea(f, new Map([['N', -12.5]]));
  assert.equal(image, '0125}');
  assert.equal(area.decodeArea(f, image).get('N'), -12.5);
});

test('AREA : zéro', () => {
  const f = [zoned('N', 3, 0)];
  assert.equal(area.encodeArea(f, new Map([['N', 0]])), '000');
  assert.equal(area.decodeArea(f, '000').get('N'), 0);
});

test('AREA : valeur numérique trop grande pour la zone = erreur', () => {
  const f = [zoned('N', 3, 0)];
  assert.throws(() => area.encodeArea(f, new Map([['N', 1000]])), /ne tient pas/);
  assert.throws(() => area.encodeArea(f, new Map([['N', -1000]])), /ne tient pas/);
});

test('AREA : char trop long tronqué, image de mauvaise longueur refusée', () => {
  assert.equal(area.encodeArea([char('A', 2)], new Map([['A', 'XYZ']])), 'XY');
  assert.throws(() => area.decodeArea([char('A', 4)], 'AB'), /longueur/);
});

test('indicateurs : chaîne de 99 caractères et lecture inverse', () => {
  const s = area.indicatorsString(n => n === 1 || n === 99);
  assert.equal(s.length, 99);
  assert.equal(s[0], '1');
  assert.equal(s[98], '1');
  assert.equal(s.slice(1, 98), '0'.repeat(97));
  const back = area.parseIndicators(s);
  assert.equal(back[1], true);
  assert.equal(back[2], false);
  assert.equal(back[99], true);
});

// ---- Simulateur d'écran et terminal scripté ----
const { ScreenSimulator } = require(path.join(__dirname, '..', 'out', 'screens', 'simulator'));
const { ScriptedTerminal } = require(path.join(__dirname, '..', 'out', 'screens', 'scripted-terminal'));
const { parseInput } = require(path.join(__dirname, '..', 'out', 'screens', 'input-values'));

const fields01 = [
  { ...char('CODE', 6, 'B'), row: 4, col: 20 },
  { ...char('LIBELLE', 10, 'O'), row: 5, col: 20 },
  { ...zoned('QTE', 5, 0, 'I'), row: 6, col: 20 },
  { ...zoned('PRIX', 5, 2, 'I'), row: 7, col: 20 },
  { ...char('CLE', 3, 'H') },
  { ...char('ERR', 4, 'O'), row: 8, col: 20, condition: [{ indicator: 31, negated: false }] },
];
const definition = {
  indara: false,
  keys: new Map([['CA03', 3], ['CA12', null]]),
  formats: {
    FMT01: {
      keys: new Map([['CF05', 5], ['PAGEDOWN', 25]]),
      constants: [
        { row: 1, col: 30, text: 'Saisie' },
        { row: 22, col: 2, text: 'Inconnu', condition: [{ indicator: 31, negated: false }] },
        { row: 23, col: 2, text: 'Normal', condition: [{ indicator: 31, negated: true }] },
      ],
      fields: fields01,
    },
    FMT02: { keys: new Map(), constants: [], fields: [] },
  },
};
const none = '0'.repeat(99);
const withInd = (...ns) => { const a = none.split(''); ns.forEach(n => { a[n - 1] = '1'; }); return a.join(''); };
const call = (sim, option, over = {}) => {
  const p = { option, status: '0', error: 0, area: '', format: 'FMT01', indicators: none, ...over };
  sim.call(p);
  return p;
};
const area01 = (values) => area.encodeArea(fields01, new Map(Object.entries(values)));
const setup = (script) => {
  const terminal = new ScriptedTerminal(script);
  return { terminal, sim: new ScreenSimulator('ECRAN01', definition, terminal) };
};
const initial = { CODE: 'AB', LIBELLE: 'Stylo', QTE: 99, PRIX: 9, CLE: 'xyz', ERR: 'oups' };

test('simulateur : O et C rendent le statut 0', () => {
  const { sim } = setup([]);
  assert.equal(call(sim, 'O').status, '0');
  assert.equal(call(sim, 'C').status, '0');
});

test('simulateur : W montre O/B, vide les zones I, cache H et les zones/constantes dont le if est faux', () => {
  const { sim, terminal } = setup([]);
  const p = call(sim, 'W', { area: area01(initial) });
  assert.equal(p.status, '0');
  const screen = terminal.shown[0];
  assert.equal(screen.file, 'ECRAN01');
  assert.equal(screen.format, 'FMT01');
  assert.deepEqual(screen.fields.map(f => [f.name, f.value, f.usage, f.numeric]), [
    ['CODE', 'AB    ', 'B', false], ['LIBELLE', 'Stylo     ', 'O', false],
    ['QTE', '00000', 'I', true], ['PRIX', '00000', 'I', true],
  ]);
  assert.deepEqual(screen.constants.map(c => c.text), ['Saisie', 'Normal']);
  assert.equal(screen.fields[0].row, 4);
  assert.equal(screen.fields[0].col, 20);
  assert.equal(screen.fields[0].length, 6);
});

test('simulateur : W avec indicateur 31 montre la zone et la constante conditionnées', () => {
  const { sim, terminal } = setup([]);
  call(sim, 'W', { area: area01(initial), indicators: withInd(31) });
  assert.deepEqual(terminal.shown[0].fields.map(f => f.name), ['CODE', 'LIBELLE', 'QTE', 'PRIX', 'ERR']);
  assert.deepEqual(terminal.shown[0].constants.map(c => c.text), ['Saisie', 'Inconnu']);
});

test('simulateur : W numérique négatif affiché avec le signe à droite', () => {
  const terminal = new ScriptedTerminal([]);
  const f = [{ ...zoned('N', 3, 0, 'O'), row: 1, col: 1 }];
  const d = { indara: false, keys: new Map(), formats: { F: { keys: new Map(), constants: [], fields: f } } };
  const s = new ScreenSimulator('E', d, terminal);
  s.call({ option: 'W', status: '0', error: 0, area: area.encodeArea(f, new Map([['N', -12]])), format: 'F', indicators: none });
  assert.equal(terminal.shown[0].fields[0].value, '012-');
});

test('simulateur : W sur un format inconnu = statut 2', () => {
  const { sim } = setup([]);
  const p = call(sim, 'W', { format: 'NOPE', area: '' });
  assert.equal(p.status, '2');
  assert.equal(p.error, 1299);
  assert.match(p.message, /NOPE/);
});

test('simulateur : R ENTER rend les zones I et B saisies, les autres inchangées, indicateurs de réponse à 0', () => {
  const { sim } = setup([{ format: 'FMT01', fields: { CODE: 'ZZ', QTE: '12', PRIX: '1,5' } }]);
  call(sim, 'W', { area: area01(initial), indicators: withInd(5, 7, 25) });
  const p = call(sim, 'R', { indicators: none });
  assert.equal(p.status, '0');
  assert.deepEqual([...area.decodeArea(fields01, p.area)], [
    ['CODE', 'ZZ    '], ['LIBELLE', 'Stylo     '], ['QTE', 12], ['PRIX', 1.5], ['CLE', 'xyz'], ['ERR', 'oups']]);
  assert.equal(p.indicators, withInd(7));
});

test('simulateur : R sans saisie rend la valeur affichée (zones I à zéro)', () => {
  const { sim } = setup([{ format: 'FMT01' }]);
  call(sim, 'W', { area: area01(initial) });
  const back = area.decodeArea(fields01, call(sim, 'R').area);
  assert.equal(back.get('QTE'), 0);
  assert.equal(back.get('CODE'), 'AB    ');
});

test('simulateur : R CF05 met l indicateur de la touche à 1 et transmet les saisies', () => {
  const { sim } = setup([{ format: 'FMT01', key: 'F5', fields: { QTE: '7' } }]);
  call(sim, 'W', { area: area01(initial), indicators: withInd(25) });
  const p = call(sim, 'R');
  assert.equal(area.decodeArea(fields01, p.area).get('QTE'), 7);
  assert.equal(p.indicators, withInd(5));
});

test('simulateur : R PAGEDOWN avec indicateur 25', () => {
  const { sim } = setup([{ format: 'FMT01', key: 'PAGEDOWN' }]);
  call(sim, 'W', { area: area01(initial) });
  assert.equal(call(sim, 'R').indicators, withInd(25));
});

test('simulateur : R CA03 rend AREA inchangée (saisies non transmises) et l indicateur 03', () => {
  const { sim } = setup([{ format: 'FMT01', key: 'F3', fields: { QTE: '7' } }]);
  call(sim, 'W', { area: area01(initial) });
  const sent = area01({ ...initial, QTE: 5 });
  const p = call(sim, 'R', { area: sent });
  assert.equal(p.area, sent);
  assert.equal(p.indicators, withInd(3));
});

test('simulateur : CA sans indicateur (CA12 = null) : indicateurs de réponse à 0', () => {
  const { sim } = setup([{ format: 'FMT01', key: 'F12' }]);
  call(sim, 'W', { area: area01(initial), indicators: withInd(3) });
  assert.equal(call(sim, 'R').indicators, none);
});

test('simulateur : touche non autorisée = écran réaffiché avec message', () => {
  const { sim, terminal } = setup([{ format: 'FMT01', key: 'F6' }]);
  call(sim, 'W', { area: area01(initial) });
  assert.throws(() => call(sim, 'R'), /saisie refusée par l'écran : Touche F6 non autorisée/);
  assert.equal(terminal.shown.length, 2);
  assert.equal(terminal.shown[1].message, 'Touche F6 non autorisée');
  assert.equal(terminal.shown[0].message, undefined);
});

test('simulateur : après un refus, la saisie suivante est prise en compte', () => {
  const terminal = {
    shown: [], calls: 0,
    show(s) { this.shown.push(s); },
    input() { return this.calls++ === 0 ? { key: 'F6', fields: {} } : { key: 'ENTER', fields: { QTE: '3' } }; },
  };
  const sim = new ScreenSimulator('ECRAN01', definition, terminal);
  call(sim, 'W', { area: area01(initial) });
  const p = call(sim, 'R');
  assert.equal(area.decodeArea(fields01, p.area).get('QTE'), 3);
  assert.equal(terminal.shown[1].message, 'Touche F6 non autorisée');
});

test('simulateur : zone inconnue, non saisissable ou masquée, valeur invalide = refus', () => {
  for (const [fields, re] of [
    [{ NOPE: 'x' }, /Zone NOPE inconnue/],
    [{ LIBELLE: 'x' }, /Zone LIBELLE non saisissable/],
    [{ ERR: 'x' }, /Zone ERR inconnue ou non affichée/],
    [{ CODE: 'TROPLONG' }, /Zone CODE : valeur trop longue/],
    [{ QTE: 'abc' }, /Zone QTE : valeur numérique invalide/],
    [{ QTE: '123456' }, /Zone QTE : valeur trop grande/],
  ]) {
    const { sim } = setup([{ format: 'FMT01', fields }]);
    call(sim, 'W', { area: area01(initial) });
    assert.throws(() => call(sim, 'R'), re);
  }
});

test('simulateur : R sur un autre format ou sans écran = statut 2', () => {
  const { sim } = setup([]);
  assert.equal(call(sim, 'R').status, '2');
  call(sim, 'W', { area: area01(initial) });
  const p = call(sim, 'R', { format: 'FMT02' });
  assert.equal(p.status, '2');
  assert.equal(p.error, 1299);
  assert.match(p.message, /READ FMT02 : le format affiché est FMT01/);
});

test('terminal scripté : scénario épuisé, désordonné, mauvais fichier', () => {
  const { sim } = setup([]);
  call(sim, 'W', { area: area01(initial) });
  assert.throws(() => call(sim, 'R'), /aucune saisie prévue pour le format FMT01 \(lecture n° 1\)/);
  const wrong = setup([{ format: 'FMT02' }]);
  call(wrong.sim, 'W', { area: area01(initial) });
  assert.throws(() => call(wrong.sim, 'R'), /prévue pour le format FMT02 mais l'écran affiche FMT01/);
  const file = setup([{ format: 'FMT01', file: 'AUTRE' }]);
  call(file.sim, 'W', { area: area01(initial) });
  assert.throws(() => call(file.sim, 'R'), /fichier AUTRE/);
});

test('saisie numérique : vide ou "-" = zéro, virgule, signe, bornes', () => {
  const z52 = zoned('P', 5, 2);
  const z30 = zoned('Q', 3, 0);
  assert.deepEqual(parseInput(z52, ''), { value: 0 });
  assert.deepEqual(parseInput(z52, '-'), { value: 0 });
  assert.deepEqual(parseInput(z52, '1,5'), { value: 1.5 });
  assert.deepEqual(parseInput(z52, '1.50'), { value: 1.5 });
  assert.deepEqual(parseInput(z52, '-1,5'), { value: -1.5 });
  assert.deepEqual(parseInput(z52, '12-'), { value: -12 });
  assert.deepEqual(parseInput(z30, '007'), { value: 7 });
  assert.ok('message' in parseInput(z52, '12345'));
  assert.ok('message' in parseInput(z52, '1,555'));
  assert.ok('message' in parseInput(z52, '1,5,5'));
  assert.ok('message' in parseInput(z52, '--1'));
  assert.ok('message' in parseInput(z30, '1,5'));
  assert.deepEqual(parseInput(char('C', 3), 'ab  '), { value: 'ab' });
  assert.ok('message' in parseInput(char('C', 3), 'abcd'));
});

test('simulateur : CA03 avec zone invalide : aucun contrôle, AREA inchangée, indicateur 03, pas de message', () => {
  const { sim, terminal } = setup([{ format: 'FMT01', key: 'F3', fields: { QTE: 'abc', NOPE: 'x', CODE: 'TROPLONG' } }]);
  call(sim, 'W', { area: area01(initial) });
  const sent = area01(initial);
  const p = call(sim, 'R', { area: sent });
  assert.equal(p.status, '0');
  assert.equal(p.area, sent);
  assert.equal(p.indicators, withInd(3));
  assert.equal(terminal.shown.length, 1);
});

test('simulateur : PAGEUP autorisé par le fichier ou le format, sinon refusé', () => {
  const up = { ...definition, keys: new Map([['PAGEUP', 8]]) };
  const terminal = new ScriptedTerminal([{ format: 'FMT01', key: 'PAGEUP' }]);
  const sim = new ScreenSimulator('ECRAN01', up, terminal);
  call(sim, 'W', { area: area01(initial) });
  assert.equal(call(sim, 'R').indicators, withInd(8));
  const refused = setup([{ format: 'FMT01', key: 'PAGEUP' }]);
  call(refused.sim, 'W', { area: area01(initial) });
  assert.throws(() => call(refused.sim, 'R'), /Touche PAGEUP non autorisée/);
});

test('simulateur : CF déclarée au niveau du fichier, CF03 seul sans CA03', () => {
  const def = { ...definition, keys: new Map([['CF03', 3], ['CF10', 10]]) };
  const terminal = new ScriptedTerminal([{ format: 'FMT01', key: 'F3', fields: { QTE: '4' } }]);
  const sim = new ScreenSimulator('ECRAN01', def, terminal);
  call(sim, 'W', { area: area01(initial) });
  const p = call(sim, 'R');
  assert.equal(p.indicators, withInd(3));
  assert.equal(area.decodeArea(fields01, p.area).get('QTE'), 4);   // CF : saisies transmises
});

test('simulateur : un négatif saisi revient dans l AREA via R ENTER', () => {
  const { sim } = setup([{ format: 'FMT01', fields: { QTE: '-12', PRIX: '3,5-' } }]);
  call(sim, 'W', { area: area01(initial) });
  const p = call(sim, 'R');
  assert.equal(p.area.slice(16, 21), '0001K');
  const back = area.decodeArea(fields01, p.area);
  assert.equal(back.get('QTE'), -12);
  assert.equal(back.get('PRIX'), -3.5);
});

// --- DCL-F WORKSTN : analyse et déclaration ---
const { parse, run, runScreens, displaysFrom } = require('./helpers');

const field = (name, type, row, usage = 'B') => ({ name, usage, type, row, col: 10 });
const ECRAN = () => displaysFrom({
  ECRAN: {
    keys: { CA03: '03' },
    formats: {
      FMT01: { fields: [field('CODE', 'char(6)', 3), field('QTE', 'zoned(5:2)', 4)] },
      FMT02: { fields: [field('CODE', 'char(6)', 3), field('LIB', 'char(10)', 5, 'O')] },
    },
  },
});

test('DCL-F WORKSTN : analyse (device, INDDS, USAGE par défaut)', () => {
  const [node] = parse('dcl-f ecran workstn indds(ind);').files;
  assert.equal(node.device, 'workstn');
  assert.equal(node.indds, 'IND');
  assert.deepEqual(node.usage, { input: true, output: true, update: false, delete: false });
  assert.equal(parse('dcl-f ecran workstn;').files[0].indds, undefined);
  assert.equal(parse('dcl-f client;').files[0].device, undefined);
});

test('DCL-F WORKSTN : les zones de tous les formats deviennent des variables', () => {
  const { output } = runScreens(`
    dcl-f ecran workstn;
    dsply code;
    dsply qte;
    dsply lib;
  `, ECRAN(), []);
  assert.deepEqual(output, ['', '0', '']);
});

test('DCL-F WORKSTN : fichier absent de displays.json', () => {
  assert.throws(() => runScreens('dcl-f inconnu workstn;', ECRAN(), []), /INCONNU.*displays\.json/);
});

test('DCL-F WORKSTN : sans fabrique, exécution interactive requise', () => {
  assert.throws(() => run('dcl-f ecran workstn;', { tables: {}, programs: {}, displays: ECRAN() }),
    /fichier écran.*exécution interactive requise/i);
});

test('DCL-F WORKSTN : même zone, types différents entre deux formats : erreur', () => {
  const d = displaysFrom({ E: { formats: {
    A: { fields: [field('X', 'char(3)', 1)] }, B: { fields: [field('X', 'char(4)', 1)] } } } });
  assert.throws(() => runScreens('dcl-f e workstn;', d, []), /X.*char/i);
});

test('DCL-F WORKSTN : zone partagée avec un fichier base de même type', () => {
  const d = displaysFrom({ ECRAN: { formats: { F1: { fields: [field('NOM', 'char(10)', 1)] } } } });
  const ctx = () => ({ tables: { CLIENT: { columns: [{ name: 'NOM', type: 'char(10)' }], data: [] } }, programs: {} });
  assert.deepEqual(runScreens('dcl-f client; dcl-f ecran workstn; dsply nom;', d, [], ctx()).output, ['']);
  const bad = displaysFrom({ ECRAN: { formats: { F1: { fields: [field('NOM', 'char(8)', 1)] } } } });
  assert.throws(() => runScreens('dcl-f client; dcl-f ecran workstn;', bad, [], ctx()), /NOM/);
});

test('DCL-F WORKSTN : nom de fichier ou de format déjà utilisé', () => {
  const ctx = () => ({ tables: { CLIENT: { columns: [{ name: 'NOM', type: 'char(10)' }], data: [] } }, programs: {} });
  const d = displaysFrom({ CLIENT: { formats: {} }, E2: { formats: { CLIENTF: { fields: [] } } } });
  assert.throws(() => runScreens('dcl-f client; dcl-f client workstn;', d, [], ctx()), /CLIENT/);
  assert.throws(() => runScreens('dcl-f client; dcl-f e2 workstn;', d, [], ctx()), /CLIENTF/);
  assert.throws(() => runScreens('dcl-f e2 workstn; dcl-f client;', d, [], ctx()), /CLIENTF/);
  assert.throws(() => runScreens('dcl-s fmt01 char(1); dcl-f ecran workstn;', ECRAN(), []), /FMT01/);
});

test('DCL-F WORKSTN : INDDS sans indara refusé ; avec indara, DS de 99 octets au moins', () => {
  const sans = ECRAN();
  assert.throws(() => runScreens('dcl-ds ind qualified; f char(99); end-ds; dcl-f ecran workstn indds(ind);', sans, []),
    /INDDS.*indara/);
  const avec = displaysFrom({ E: { indara: true, formats: {} } });
  assert.throws(() => runScreens('dcl-f e workstn indds(ind);', avec, []), /IND.*non déclarée/);
  // DS de moins de 99 octets acceptée : indicateurs nommés à POS clairsemés
  assert.deepEqual(runScreens(`dcl-ds ind qualified; exit ind pos(3); refresh ind pos(5); end-ds;
    dcl-f e workstn indds(ind); dsply 'ok';`, avec, []).output, ['ok']);
  assert.deepEqual(runScreens('dcl-ds ind qualified; f char(99); end-ds; dcl-f e workstn indds(ind); dsply \'ok\';',
    avec, []).output, ['ok']);
});

test('DCL-F WORKSTN : appel O à la déclaration, C en fin de programme', () => {
  const log = [];
  const screens = () => ({ call(p) { log.push(`${p.option}:${p.area}:${p.format}:${p.indicators}`); } });
  const ctx = { tables: {}, programs: {}, displays: ECRAN() };
  run(`dcl-f ecran workstn; dsply 'x';`, ctx, { screens });
  assert.deepEqual(log, ['O:::', 'C:::']);
  log.length = 0;
  run(`dcl-f ecran workstn; *inlr = *on; return;`, ctx, { screens });
  assert.deepEqual(log, ['O:::', 'C:::']);
});

test('DCL-F WORKSTN : statut 2 à l\'appel O : erreur', () => {
  const screens = () => ({ call(p) { p.status = '2'; p.error = 1299; p.message = 'écran indisponible'; } });
  assert.throws(() => run('dcl-f ecran workstn;', { tables: {}, programs: {}, displays: ECRAN() }, { screens }),
    /fichier écran ECRAN : écran indisponible \(erreur 01299\)/);
});

test('DCL-F WORKSTN : positions des sous-zones ind de la DS INDDS', () => {
  const path = require('path');
  const out = path.join(__dirname, '..', 'out', 'interpreter');
  const { InterpreterState } = require(path.join(out, 'state'));
  const { runProgram } = require(path.join(out, 'program'));
  const { inddsPositions } = require(path.join(out, 'screens', 'declare'));
  const { ScreenSimulator } = require(path.join(__dirname, '..', 'out', 'screens', 'simulator'));
  const { ScriptedTerminal } = require(path.join(__dirname, '..', 'out', 'screens', 'scripted-terminal'));
  const ctx = { tables: {}, programs: {}, displays: displaysFrom({ E: { indara: true, formats: {} } }) };
  const state = new InterpreterState(ctx, { screens: (f, d) => new ScreenSimulator(f, d, new ScriptedTerminal([])) });
  runProgram(state, parse(`dcl-ds ind qualified;
      exit ind pos(3);
      refresh ind pos(5);
      suite ind;
      autre char(2) pos(40);
      tard ind pos(99);
    end-ds;
    dcl-f e workstn indds(ind);`), []);
  assert.deepEqual([...inddsPositions(state, state.displays.get('E'))],
    [[3, 'exit'], [5, 'refresh'], [6, 'suite'], [99, 'tard']]);
});

test('DCL-F WORKSTN : statut 2 à l appel C : erreur', () => {
  const screens = () => ({ call(p) { if (p.option === 'C') { p.status = '2'; p.error = 7; p.message = 'fermeture refusée'; } } });
  assert.throws(() => run('dcl-f ecran workstn;', { tables: {}, programs: {}, displays: ECRAN() }, { screens }),
    /fichier écran ECRAN : fermeture refusée \(erreur 00007\)/);
});

test('DCL-F WORKSTN : pas d appel O si un contrôle de déclaration échoue', () => {
  const log = [];
  const screens = () => ({ call(p) { log.push(p.option); } });
  const d = displaysFrom({ E: { indara: true, formats: {} } });
  assert.throws(() => run('dcl-f e workstn indds(ind);', { tables: {}, programs: {}, displays: d }, { screens }), /non déclarée/);
  assert.deepEqual(log, []);
});
