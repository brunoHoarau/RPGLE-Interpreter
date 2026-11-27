// Affiche l'AST produit par le parser pour un extrait ou un fichier, sans les positions.
// Usage : npm run --silent ast -- "<source RPGLE>"   ou   npm run --silent ast -- --file <fichier.rpgle>
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'out');
const { Lexer } = require(path.join(OUT, 'lexer'));
const { Parser } = require(path.join(OUT, 'parser'));

const args = process.argv.slice(2);
const file = args[0] === '--file' ? path.resolve(args[1]) : undefined;
const source = file ? fs.readFileSync(file, 'utf8') : args.join(' ');
if (!source) {
  console.error('Usage : npm run --silent ast -- "<source>"  |  --file <fichier>');
  process.exit(2);
}

const NOISE = new Set(['line', 'column', 'position', 'loc']);
try {
  const ast = new Parser(new Lexer(source, { path: file }).tokenize()).parse();
  console.log(JSON.stringify(ast, (k, v) => (NOISE.has(k) ? undefined : v), 1));
} catch (e) {
  console.error(`Erreur : ${e.message}`);
  process.exit(1);
}
