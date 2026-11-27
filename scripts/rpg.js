// Exécute un programme RPGLE sans VS Code et n'affiche que sa sortie (ou l'erreur).
// Usage : npm run --silent rpg -- <fichier.rpgle> [--context <dossier>]
// Sans --context : dossier context/ voisin du dossier parent du fichier, comme l'extension (vide s'il n'existe pas).
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'out');
const { Lexer } = require(path.join(OUT, 'lexer'));
const { Parser } = require(path.join(OUT, 'parser'));
const { Interpreter } = require(path.join(OUT, 'interpreter'));
const { loadContextFromFolder, emptyContext } = require(path.join(OUT, 'context'));
const { folderProgramResolver } = require(path.join(OUT, 'sources'));

const args = process.argv.slice(2);
const i = args.indexOf('--context');
const contextDir = i >= 0 ? args.splice(i, 2)[1] : undefined;
const file = args[0];
if (!file) {
  console.error('Usage : npm run --silent rpg -- <fichier.rpgle> [--context <dossier>]');
  process.exit(2);
}

const full = path.resolve(file);
const dir = contextDir ? path.resolve(contextDir) : path.join(path.dirname(path.dirname(full)), 'context');
try {
  const context = fs.existsSync(dir) ? loadContextFromFolder(dir) : emptyContext();
  const ast = new Parser(new Lexer(fs.readFileSync(full, 'utf8'), { path: full }).tokenize()).parse();
  const lines = new Interpreter(context, { resolveProgram: folderProgramResolver(path.dirname(full)) }).execute(ast);
  lines.forEach(l => console.log(l));
} catch (e) {
  console.error(`Erreur : ${e.message}`);
  process.exit(1);
}
