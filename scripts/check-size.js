// Contrôle mécanique : aucun fichier source ne dépasse MAX_LINES lignes
const fs = require('fs');
const path = require('path');

const MAX_LINES = 400;
const BASE = path.join(__dirname, '..');

function walk(dir, suffix) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name), suffix) : e.name.endsWith(suffix) ? [path.join(dir, e.name)] : []);
}

// src/*.ts et test/*.test.js : un fichier court se lit par tranche sans coût
const tooLong = [...walk(path.join(BASE, 'src'), '.ts'), ...walk(path.join(BASE, 'test'), '.test.js')]
  .map(f => ({ f: path.relative(BASE, f), n: fs.readFileSync(f, 'utf8').split('\n').length }))
  .filter(x => x.n > MAX_LINES);

for (const x of tooLong) console.error(`${x.f} : ${x.n} lignes (max ${MAX_LINES})`);
process.exit(tooLong.length > 0 ? 1 : 0);
