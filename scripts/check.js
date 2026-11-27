// Contrôle complet à sortie minimale : compilation, tests, taille des fichiers.
// Tout vert → une ligne de résumé. Sinon → seulement les erreurs, tronquées.
// Usage : npm run --silent check   (ou : node scripts/check.js test/ecrans*.test.js pour un sous-ensemble)
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAX = 40;
// node est lancé directement (son chemin peut contenir des espaces) ; npm passe par le shell (npm.cmd sous Windows)
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
const npm = script => spawnSync(`npm run --silent ${script}`, { cwd: ROOT, encoding: 'utf8', shell: true });
const fail = (title, text) => {
  const lines = text.trim().split('\n');
  console.log(`✗ ${title}\n${lines.slice(0, MAX).join('\n')}${lines.length > MAX ? `\n… (${lines.length - MAX} lignes coupées)` : ''}`);
  process.exit(1);
};

const tsc = npm('compile');
if (tsc.status !== 0) fail('compilation', tsc.stdout + tsc.stderr);

const files = process.argv.slice(2);
const tests = sh(process.execPath, ['--test', '--test-reporter=spec', ...(files.length ? files : ['test/**/*.test.js'])]);
const out = tests.stdout + tests.stderr;
const count = k => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1] ?? '?';
if (tests.status !== 0) {
  const at = out.indexOf('failing tests:');
  fail(`tests : ${count('fail')} en échec sur ${count('tests')}`, at >= 0 ? out.slice(at) : out);
}

const size = sh(process.execPath, ['scripts/check-size.js']);
if (size.status !== 0) fail('taille des fichiers', size.stdout + size.stderr);

console.log(`✓ compilation, ${count('pass')}/${count('tests')} tests, taille des fichiers`);
