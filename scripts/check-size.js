// Contrôle mécanique : aucun fichier source ne dépasse MAX_LINES lignes
const fs = require('fs');
const path = require('path');

const MAX_LINES = 400;
const ROOT = path.join(__dirname, '..', 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
}

const tooLong = walk(ROOT)
  .map(f => ({ f: path.relative(path.join(__dirname, '..'), f), n: fs.readFileSync(f, 'utf8').split('\n').length }))
  .filter(x => x.n > MAX_LINES);

for (const x of tooLong) console.error(`${x.f} : ${x.n} lignes (max ${MAX_LINES})`);
process.exit(tooLong.length > 0 ? 1 : 0);
