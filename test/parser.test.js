const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parse, parseTerminates } = require('./helpers');

const ROOT = path.join(__dirname, '..');

test('le parser termine sur une instruction hors WHEN dans un SELECT', () => {
  assert.ok(parseTerminates(['select;\n  x = 1;']));
});

test('le parser termine sur un ON-ERROR( non fermé', () => {
  assert.ok(parseTerminates(['monitor; x = 1; on-error(']));
});

test('une instruction avant le premier WHEN est une erreur de syntaxe', () => {
  assert.throws(() => parse('select; x = 1; when 1 = 1; endsl;'), /WHEN/);
});

test('un DSPLY avant le premier WHEN est une erreur de syntaxe', () => {
  assert.throws(() => parse("select; dsply 'a'; when 1 = 1; endsl;"), /WHEN/);
});

// Simule la frappe : le diagnostic temps réel parse chaque état intermédiaire du fichier
test('le parser termine sur chaque préfixe des fichiers d\'exemple', () => {
  const files = [
    path.join(ROOT, 'test.rpgle'),
    ...fs.readdirSync(path.join(ROOT, 'fichiers_test')).map(f => path.join(ROOT, 'fichiers_test', f)),
  ];
  const prefixes = [];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    for (let i = 1; i <= code.length; i++) prefixes.push(code.slice(0, i));
  }
  assert.ok(parseTerminates(prefixes, 60000));
});

test('DCL-F et opérations de fichier : nœuds produits', () => {
  const ast = parse(`
    dcl-f Client keyed usropn;
    dcl-s n packed(7:0);
    setll *start client;
    chain (n : 5) client;
    reade n client;
    if %eof(client) and %found;
    endif;
  `);
  assert.deepEqual(ast.files, [{ type: 'FileDeclaration', name: 'Client', keyed: true, usropn: true, usage: { input: true, output: false, update: false, delete: false }, line: 2 }]);
  const ops = ast.body.filter(n => n.type === 'FileOperation');
  assert.equal(ops.length, 3);
  assert.equal(ops[0].operation, 'setll');
  assert.equal(ops[0].special, 'start');
  assert.equal(ops[1].key.length, 2);
  assert.equal(ops[2].key.length, 1);
  const cond = ast.body.find(n => n.type === 'IfStatement').condition;
  assert.deepEqual(cond.left.value.args, [{ type: 'Expression', value: 'client', valueType: 'file' }]);
});

test('open, close, read... restent utilisables comme noms de variable', () => {
  const ast = parse(`dcl-s open int(5); dcl-s read int(5); open = 1; read += 2; close = open + read;`);
  assert.equal(ast.body.filter(n => n.type === 'Assignment').length, 3);
});

test('USAGE : implications et nœuds d\'écriture', () => {
  const ast = parse(`
    dcl-f a usage(*delete) keyed;
    dcl-f b usage(*output);
    write bf;
    delete (1) af;
    delete af;
    unlock a;
  `);
  assert.deepEqual(ast.files[0].usage, { input: true, output: false, update: true, delete: true });
  assert.deepEqual(ast.files[1].usage, { input: false, output: true, update: false, delete: false });
  const ops = ast.body.filter(n => n.type === 'FileOperation');
  assert.deepEqual(ops.map(o => o.operation), ['write', 'delete', 'delete', 'unlock']);
  assert.equal(ops[1].key.length, 1);
  assert.equal(ops[2].key, undefined);
});

test('write, update, delete, unlock restent utilisables comme noms', () => {
  const ast = parse(`dcl-s write int(5); dcl-s update int(5); write = 1; update += 2; delete = write; unlock = 3;`);
  assert.equal(ast.body.filter(n => n.type === 'Assignment').length, 4);
});

test('3a : AST des mots-clés de DCL-F, des extenseurs et de READE sans clé', () => {
  const ast = parse(`
    dcl-f cli2 prefix('X':2) extfile('MABIB/CLIENT') extdesc('CLIENT');
    dcl-f cli3 rename(a:b) keyed;
    reade cli3;
    chain(en) 1 cli3;
  `);
  assert.deepEqual(ast.files[0].prefix, { text: 'X', count: 2 });
  assert.equal(ast.files[0].extfile, 'CLIENT');
  assert.equal(ast.files[0].extdesc, 'CLIENT');
  assert.deepEqual(ast.files[1].rename, { from: 'A', to: 'B' });
  const ops = ast.body.filter(n => n.type === 'FileOperation');
  assert.equal(ops[0].lastKey, true);
  assert.equal(ops[0].key, undefined);
  assert.deepEqual(ops[1].extender, { error: true, noLock: true });
});

// --- Incrément 3b : LIKEDS, LIKEREC, EXTNAME, DS résultat, %KDS, %FIELDS ---

test('DCL-DS LIKEDS : nœud, qualifié, avec INZ(*LIKEDS)', () => {
  const ast = parse(`
    dcl-ds modele qualified;
      a char(5);
    end-ds;
    dcl-ds copie likeds(modele);
    dcl-ds copie2 likeds(MODELE) inz(*likeds);
  `);
  const [, c1, c2] = ast.body;
  assert.equal(c1.isQualified, true);
  assert.deepEqual(c1.fields, []);
  assert.deepEqual(c1.like, { kind: 'likeds', name: 'modele', usage: 'none' });
  assert.deepEqual(c2.like, { kind: 'likeds', name: 'MODELE', usage: 'none', inzLike: true });
});

test('DCL-DS LIKEREC : usage par défaut *INPUT, noms en majuscules', () => {
  const ast = parse(`
    dcl-f client keyed;
    dcl-ds a likerec(clientf);
    dcl-ds b likerec(clientf : *all);
    dcl-ds c likerec(clientf : *Output);
    dcl-ds d likerec(clientf : *key) qualified;
  `);
  const [a, b, c, d] = ast.body;
  assert.deepEqual(a.like, { kind: 'likerec', name: 'CLIENTF', format: 'CLIENTF', usage: 'input' });
  assert.equal(a.isQualified, true);
  assert.equal(b.like.usage, 'all');
  assert.equal(c.like.usage, 'output');
  assert.equal(d.like.usage, 'key');
});

test('DCL-DS EXTNAME : formes acceptées', () => {
  const ast = parse(`
    dcl-c f 'CLIENT';
    dcl-ds a extname('CLIENT') end-ds;
    dcl-ds b extname('BIB/CLIENT' : 'CLIENTF' : *input) qualified;
    end-ds;
    dcl-ds c extname('*LIBL/CLIENT' : *all) qualified end-ds;
    dcl-ds d extname(f) qualified;
    end-ds;
    dcl-ds e extname('CLIENT');
    end-ds;
  `);
  const [, a, b, c, d, e] = ast.body;
  assert.deepEqual(a.like, { kind: 'extname', name: 'CLIENT', usage: 'none' });
  assert.equal(a.isQualified, false);
  assert.deepEqual(a.fields, []);
  assert.deepEqual(b.like, { kind: 'extname', name: 'CLIENT', format: 'CLIENTF', usage: 'input' });
  assert.equal(b.isQualified, true);
  assert.deepEqual(c.like, { kind: 'extname', name: 'CLIENT', usage: 'all' });
  assert.equal(d.like.name, 'CLIENT');
  assert.equal(e.isQualified, false);
});

test('une DS LIKEREC / EXTNAME : ses sous-zones ne sont pas rejetées à l\'analyse', () => {
  assert.doesNotThrow(() => parse(`
    dcl-f client keyed;
    dcl-ds cur likerec(clientf);
    dcl-ds e extname('CLIENT') qualified end-ds;
    cur.nom = 'x';
    e.nom = cur.nom;
  `));
});

test('paramètres LIKEDS / LIKEREC : dataType ds', () => {
  const ast = parse(`
    dcl-ds m qualified;
      a char(5);
    end-ds;
    dcl-proc p;
      dcl-pi *n;
        x likeds(m) const;
        y likerec(clientf : *all) value;
        z likeds(m);
      end-pi;
    end-proc;
    dcl-pr q extpgm('Q');
      w likeds(m);
    end-pr;
  `);
  const proc = ast.body.find(n => n.type === 'Procedure');
  assert.deepEqual(proc.parameters[0].dataType, { type: 'DataType', typeName: 'ds', like: { kind: 'likeds', name: 'm', usage: 'none' } });
  assert.equal(proc.parameters[0].isConst, true);
  assert.deepEqual(proc.parameters[1].dataType.like, { kind: 'likerec', name: 'CLIENTF', format: 'CLIENTF', usage: 'all' });
  assert.equal(proc.parameters[1].byValue, true);
  assert.equal(proc.parameters[2].dataType.like.name, 'm');
  const proto = ast.body.find(n => n.type === 'Prototype');
  assert.equal(proto.parameters[0].dataType.typeName, 'ds');
});

test('opérations de fichier avec DS résultat', () => {
  const ast = parse(`
    dcl-f client keyed usage(*update : *output);
    dcl-ds ent likerec(clientf);
    read client ent;
    readp client ent;
    reade (1) client ent;
    readpe (1) client ent;
    chain (1) client ent;
    chain(e) 1 client ent;
    write clientf ent;
    update clientf ent;
  `);
  const ops = ast.body.filter(n => n.type === 'FileOperation');
  assert.deepEqual(ops.map(o => o.operation), ['read', 'readp', 'reade', 'readpe', 'chain', 'chain', 'write', 'update']);
  assert.ok(ops.every(o => o.resultDs === 'ent'));
  assert.equal(ops[0].file, 'client');
  assert.equal(ops[6].file, 'clientf');
  assert.deepEqual(ops[5].extender, { error: true, noLock: false });
});

test('%KDS : clé complète ou partielle', () => {
  const ast = parse(`
    dcl-f client keyed usage(*update : *delete);
    dcl-c n 2;
    dcl-ds cle qualified;
      a int(10);
      b int(10);
    end-ds;
    chain %kds(cle) client;
    setll %kds(cle : 1) client;
    setgt %kds(cle : n) client;
    reade %kds(cle) client;
    readpe %kds(cle : 2) client;
    delete %kds(cle) client;
  `);
  const ops = ast.body.filter(n => n.type === 'FileOperation');
  assert.equal(ops.length, 6);
  assert.deepEqual(ops[0].kds, { ds: 'cle' });
  assert.equal(ops[0].key, undefined);
  assert.equal(ops[1].kds.count.value, 1);
  assert.deepEqual(ops[2].kds.count, { type: 'Expression', value: 'n', valueType: 'identifier' });
  assert.equal(ops[4].kds.count.value, 2);
  assert.equal(ops[5].kds.ds, 'cle');
});

test('%KDS : DS inconnue, nombre non constant ou hors bornes refusés', () => {
  const head = 'dcl-f client keyed; dcl-ds cle qualified; a int(10); end-ds; dcl-s v int(5);\n';
  assert.throws(() => parse('dcl-f client keyed; chain %kds(inconnue) client;'), /INCONNUE.*structure de données/i);
  assert.throws(() => parse(head + 'chain %kds(cle : v) client;'), /%KDS.*constante/i);
  assert.throws(() => parse(head + 'chain %kds(cle : 0) client;'), /%KDS/);
  assert.throws(() => parse(head + 'chain %kds(cle : 1.5) client;'), /%KDS/);
  assert.throws(() => parse(head + 'chain %kds(cle : 1 + 1) client;'), /%KDS/);
});

test('%FIELDS : UPDATE seulement, avec ou sans DS résultat', () => {
  const ast = parse(`
    dcl-f client usage(*update);
    dcl-ds ent likerec(clientf);
    read client;
    update clientf %fields(Nom : Solde);
    update clientf ent %fields(ent.solde);
  `);
  const ops = ast.body.filter(n => n.type === 'FileOperation' && n.operation === 'update');
  assert.deepEqual(ops[0].fields, ['nom', 'solde']);
  assert.equal(ops[0].resultDs, undefined);
  assert.deepEqual(ops[1].fields, ['ent.solde']);
  assert.equal(ops[1].resultDs, 'ent');
  assert.throws(() => parse('dcl-f client; read client %fields(a);'), /%FIELDS.*UPDATE/i);
  assert.throws(() => parse('dcl-f client usage(*output); write clientf %fields(a);'), /%FIELDS.*UPDATE/i);
  assert.throws(() => parse('dcl-f client usage(*update); read client; update clientf %fields();'), /%FIELDS/);
});
