const path = require('path');
const { spawnSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'out');
const { Lexer } = require(path.join(OUT, 'lexer'));
const { Parser } = require(path.join(OUT, 'parser'));
const { Interpreter } = require(path.join(OUT, 'interpreter'));

function parse(code) {
  return new Parser(new Lexer(code).tokenize()).parse();
}

// Exécute un programme et renvoie les messages DSPLY (sans le préfixe "[DSPLY] ")
function run(code, context, options) {
  const output = new Interpreter(context, options).execute(parse(code));
  return output
    .filter(line => line.startsWith('[DSPLY'))
    .map(line => line.replace(/^\[DSPLY[^\]]*\]+ /, ''));
}

// Exécute un programme et renvoie toute la sortie brute (DSPLY + [SQL])
function runRaw(code, context, options) {
  return new Interpreter(context, options).execute(parse(code));
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
    files: {},
    programs: {},
  };
}

module.exports = { parse, run, runRaw, parseTerminates, customersContext };
