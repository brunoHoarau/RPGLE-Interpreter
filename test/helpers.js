const path = require('path');
const { spawnSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'out');
const { Lexer } = require(path.join(OUT, 'lexer'));
const { Parser } = require(path.join(OUT, 'parser'));
const { Interpreter } = require(path.join(OUT, 'interpreter'));

function parse(code, options) {
  return new Parser(new Lexer(code, options).tokenize()).parse();
}

// Exécute un programme et renvoie les messages DSPLY (sans le préfixe "[DSPLY] ")
function run(code, context, options) {
  const output = new Interpreter(context, options).execute(parse(code, options));
  return output
    .filter(line => line.startsWith('[DSPLY'))
    .map(line => line.replace(/^\[DSPLY[^\]]*\]+ /, ''));
}

// Exécute un programme et renvoie toute la sortie brute (DSPLY + [SQL])
function runRaw(code, context, options) {
  return new Interpreter(context, options).execute(parse(code, options));
}

// Parse chaque source dans un processus séparé : une boucle infinie
// bloquerait l'event loop, donc seul un timeout externe peut la détecter.
function parseTerminates(sources, timeoutMs = 10000) {
  const script = `
    const { Lexer } = require(${JSON.stringify(path.join(OUT, 'lexer'))});
    const { Parser } = require(${JSON.stringify(path.join(OUT, 'parser'))});
    const sources = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    for (const src of sources) {
      try { new Parser(new Lexer(src).tokenize()).parse(); } catch (e) {}
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    input: JSON.stringify(sources),
    timeout: timeoutMs,
  });
  return result.status === 0;
}

// Contexte SQL frais pour chaque test (le moteur modifie les données en place)
function customersContext() {
  return {
    tables: {
      CUSTOMERS: {
        columns: [],
        data: [
          { ID: 1, NAME: 'Dupont', CITY: 'Paris', BALANCE: 1500.5 },
          { ID: 2, NAME: 'Martin', CITY: 'Lyon', BALANCE: 230 },
          { ID: 3, NAME: 'Bernard', CITY: 'Marseille', BALANCE: 890.75 },
        ],
      },
    },
    programs: {},
  };
}

// Fichiers écran : displays (description normalisée) ; un ScreenSimulator par fichier, tous branchés sur UN
// ScriptedTerminal(inputs) partagé. Renvoie les lignes DSPLY et les écrans affichés.
function runScreens(code, displays, inputs, context) {
  const { ScreenSimulator } = require(path.join(OUT, 'screens', 'simulator'));
  const { ScriptedTerminal } = require(path.join(OUT, 'screens', 'scripted-terminal'));
  const terminal = new ScriptedTerminal(inputs ?? []);
  const base = context ?? { tables: {}, programs: {} };
  const full = { ...base, displays: { ...(base.displays ?? {}), ...displays } };
  const screens = (file, definition) => new ScreenSimulator(file, definition, terminal);
  return { output: run(code, full, { screens }), shown: terminal.shown };
}

// Description de fichiers écran écrite comme displays.json, validée et normalisée
function displaysFrom(raw) {
  return require(path.join(OUT, 'screens', 'definition')).normalizeDisplays(raw, 'displays.json');
}

module.exports = { runScreens, displaysFrom, parse, run, runRaw, parseTerminates, customersContext };
