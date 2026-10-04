# Fichiers natifs — lecture : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exécuter les programmes RPGLE qui déclarent des fichiers disque (`DCL-F`) et les lisent (`READ`, `READP`, `READE`, `READPE`, `CHAIN`, `SETLL`, `SETGT`, `OPEN`, `CLOSE`, `%EOF`, `%FOUND`, `%EQUAL`, `%OPEN`) sur les données simulées de `context/tables.json`, comme sur IBM i.

**Architecture:** Un module autonome `src/files.ts` (types de zones, ordre par clé avec collation EBCDIC, curseur indépendant des indices, opérations qui renvoient `{ record, found, eof, equal }`) construit sur la même liste de lignes que la table SQL ; le parser analyse `DCL-F` et les opérations ; l'interpréteur crée un `NativeFile` par `DCL-F`, déclare les zones comme variables, copie les enregistrements lus et tient l'état `%EOF/%FOUND/%EQUAL` et les statuts 01211/01215.

**Tech Stack:** TypeScript 5 (strict, ES2020, CommonJS), tests `node:test` sur le JS compilé dans `out/`.

**Spec:** `docs/superpowers/specs/2026-10-05-fichiers-natifs-design.md` (incrément 1).

## Global Constraints

- Branche `feat/fichiers-lecture` ; fusion dans `main` uniquement quand l'utilisateur dit « fusionne ».
- Ne jamais committer `skills/` ni `fichiers_test/tstpgm.rpgle` : toujours `git add` fichier par fichier. Le README est suivi sous le nom `readme.md`.
- Non supporté / incertain : `NotSupportedError` de `src/errors.ts` (message « … : pas encore supporté par l'interpréteur », arrête le programme, non interceptée par MONITOR).
- Refusé par le compilateur IBM i : `incompatibleTypes(...)` de `src/errors.ts` (« types incompatibles ») ou erreur d'analyse avec la ligne.
- Erreurs d'exécution RPG : `RpgError(statut, message)` — fichier fermé `1211` (message contenant `RNX1211`), fichier déjà ouvert `1215` (`RNX1215`).
- Les valeurs lues d'un fichier sont des **données** : converties comme les résultats SQL (pas de contrôle de type RPG), une date en texte ISO devient une date (`parseIso`).
- Ordre des clés caractère : **collation EBCDIC** (espace < ponctuation invariante < minuscules < majuscules < chiffres) ; un caractère hors du jeu invariant dans une clé caractère comparée → `NotSupportedError`.
- Commandes : un fichier = `npm run compile && node --test test/<fichier>.test.js` ; tout = `npm test`.
- Messages de commit en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Les fichiers mélangent fins de ligne CRLF/LF : préserver celles de chaque fichier ; pas de `sed -i`.

## Review Focus

1. Clés caractère mêlant minuscules, majuscules et chiffres : l'ordre de lecture doit être celui d'IBM i (EBCDIC), pas l'ordre ASCII → tests tâche 1.
2. Un `INSERT` SQL entre deux `READ` : la lecture continue sans sauter ni répéter d'enregistrement → tests tâches 1 et 4.
3. Clé partielle d'une clé composée avec `SETLL` / `READE` : seuls les enregistrements de même début de clé sont lus → tests tâches 1 et 4.
4. Fin de fichier puis `READP` : relit le dernier enregistrement → test tâche 1.
5. Zone de fichier date ou indicateur dans les données JSON : convertie en vraie date / indicateur dans la variable → test tâche 4.

---

## File Structure

| Fichier | Rôle |
|---------|------|
| `src/files.ts` (nouveau) | `parseFieldType`, collation EBCDIC, `NativeFile` |
| `src/context.ts` | `tables.json` : `keys`, `format`, types ; suppression de `files`/`FileDefinition` |
| `src/types.ts`, `src/lexer.ts`, `src/parser.ts` | `DCL-F`, opérations de fichier, fonctions d'état |
| `src/interpreter.ts`, `src/runtime.ts` | exécution, état des fichiers ; suppression des fonctions factices |
| `test/files-core.test.js` (nouveau), `test/files.test.js` (nouveau), `test/context.test.js`, `test/unsupported.test.js`, `test/helpers.js` | tests |
| `readme.md`, `context/files.json` (supprimé) | documentation, nettoyage |

---

### Task 1: Module `src/files.ts`

**Files:**
- Create: `src/files.ts`
- Test: `test/files-core.test.js`

**Interfaces:**
- Consumes: `DataTypeNode` (src/types.ts), `NotSupportedError`, `incompatibleTypes` (src/errors.ts), `isDateTime` (src/datetime.ts).
- Produces:
  - `interface FieldDefinition { name: string; type: DataTypeNode }` (nom en majuscules)
  - `parseFieldType(text: string): DataTypeNode | undefined`
  - `ebcdicKey(text: string): string` (lève `NotSupportedError` sur un caractère non invariant)
  - `interface FileResult { record?: any; found: boolean; eof: boolean; equal: boolean }`
  - `type FileSpecial = 'start' | 'end'`
  - `class NativeFile(name: string, format: string, fields: FieldDefinition[], keys: string[], rows: any[])` (`keys` vide = fichier non `KEYED`), méthodes `read()`, `readp()`, `reade(key: any[])`, `readpe(key: any[])`, `chain(key: any[])`, `chainRrn(n: number)`, `setll(key: any[] | FileSpecial)`, `setgt(key: any[] | FileSpecial)`, `reset()`, propriétés `keyed: boolean`, `positionLost: boolean`.

- [ ] **Step 1: Write the failing tests** — créer `test/files-core.test.js` :

```js
// Fichiers natifs simulés : types de zones, ordre EBCDIC, curseur, opérations
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const f = require(path.join(__dirname, '..', 'out', 'files'));

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;
const t = (typeName, length, decimals) => ({ type: 'DataType', typeName, length, decimals });

test('parseFieldType : syntaxes RPG et SQL', () => {
  assert.deepEqual(f.parseFieldType('packed(7:0)'), t('packed', 7, 0));
  assert.deepEqual(f.parseFieldType('DECIMAL(9,2)'), t('packed', 9, 2));
  assert.deepEqual(f.parseFieldType('numeric(5)'), t('zoned', 5, 0));
  assert.deepEqual(f.parseFieldType('char(30)'), t('char', 30, undefined));
  assert.deepEqual(f.parseFieldType('VARCHAR(50)'), t('varchar', 50, undefined));
  assert.deepEqual(f.parseFieldType('INTEGER'), t('int', 10, undefined));
  assert.deepEqual(f.parseFieldType('smallint'), t('int', 5, undefined));
  assert.deepEqual(f.parseFieldType('BIGINT'), t('int', 20, undefined));
  assert.deepEqual(f.parseFieldType('int(5)'), t('int', 5, undefined));
  assert.deepEqual(f.parseFieldType('date'), t('date', undefined, undefined));
  assert.deepEqual(f.parseFieldType('ind'), t('ind', undefined, undefined));
  for (const bad of ['AUTO', 'char', 'int(7)', 'float(8)', 'packed', 'blob(10)', '']) {
    assert.equal(f.parseFieldType(bad), undefined, bad);
  }
});

test('ebcdicKey : ordre IBM i (espace < minuscules < majuscules < chiffres)', () => {
  const sorted = ['9', 'A', 'a', ' x', 'Z', '0', 'b'].sort((x, y) => (f.ebcdicKey(x) < f.ebcdicKey(y) ? -1 : 1));
  assert.deepEqual(sorted, [' x', 'a', 'b', 'A', 'Z', '0', '9']);
  assert.throws(() => f.ebcdicKey('é'), NOT_SUPPORTED);
  assert.throws(() => f.ebcdicKey('a#b'), NOT_SUPPORTED);
});

const CLIENT_FIELDS = [
  { name: 'NUMCLI', type: t('packed', 7, 0) },
  { name: 'NOM', type: t('char', 10) },
];
const clients = () => [
  { NUMCLI: 3, NOM: 'Durand' }, { NUMCLI: 1, NOM: 'Dupont' }, { NUMCLI: 2, NOM: 'Martin' },
];

test('READ suit les clés ; READP depuis la fin relit le dernier', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  assert.equal(file.read().record.NOM, 'Dupont');
  assert.equal(file.read().record.NOM, 'Martin');
  assert.equal(file.read().record.NOM, 'Durand');
  assert.deepEqual(file.read(), { found: false, eof: true, equal: false });
  assert.equal(file.readp().record.NOM, 'Durand');
  assert.equal(file.readp().record.NOM, 'Martin');
});

test('sans clé : ordre d\'arrivée, CHAIN par rang', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, [], clients());
  assert.equal(file.keyed, false);
  assert.equal(file.read().record.NOM, 'Durand');
  assert.equal(file.chainRrn(2).record.NOM, 'Dupont');
  assert.equal(file.read().record.NOM, 'Martin');
  assert.equal(file.chainRrn(9).found, false);
});

test('CHAIN, SETLL, SETGT et indicateurs', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  const c = file.chain([2]);
  assert.equal(c.found, true);
  assert.equal(c.record.NOM, 'Martin');
  assert.equal(file.read().record.NOM, 'Durand');
  assert.equal(file.chain([7]).found, false);
  assert.equal(file.positionLost, true);
  const s = file.setll([2]);
  assert.equal(s.found, true);
  assert.equal(s.equal, true);
  assert.equal(file.positionLost, false);
  assert.equal(file.read().record.NOM, 'Martin');
  assert.deepEqual(file.setll([4]), { found: false, eof: false, equal: false });
  assert.equal(file.setgt([1]).found, true);
  assert.equal(file.read().record.NOM, 'Martin');
  file.setll('end');
  assert.equal(file.readp().record.NOM, 'Durand');
  file.setll('start');
  assert.equal(file.read().record.NOM, 'Dupont');
});

test('clé composée, clé partielle, doublons et READE/READPE', () => {
  const fields = [
    { name: 'NUMCLI', type: t('packed', 7, 0) },
    { name: 'NUMCDE', type: t('packed', 5, 0) },
    { name: 'LIB', type: t('char', 10) },
  ];
  const rows = [
    { NUMCLI: 1, NUMCDE: 10, LIB: 'a' }, { NUMCLI: 2, NUMCDE: 5, LIB: 'b' },
    { NUMCLI: 1, NUMCDE: 7, LIB: 'c' }, { NUMCLI: 2, NUMCDE: 1, LIB: 'd' },
    { NUMCLI: 2, NUMCDE: 5, LIB: 'e' },
  ];
  const file = new f.NativeFile('CDE', 'CDEF', fields, ['NUMCLI', 'NUMCDE'], rows);
  file.setll([2]);
  const libs = [];
  for (let r = file.reade([2]); !r.eof; r = file.reade([2])) libs.push(r.record.LIB);
  assert.deepEqual(libs, ['d', 'b', 'e']);
  assert.equal(file.chain([2, 5]).record.LIB, 'b');
  file.setgt([1]);
  assert.equal(file.readpe([1]).record.LIB, 'a');
  assert.equal(file.readpe([1]).record.LIB, 'c');
  assert.equal(file.readpe([1]).eof, true);
  assert.throws(() => file.chain([1, 2, 3]), /3 valeurs pour 2 zones/);
});

test('clé caractère : EBCDIC et blancs de fin', () => {
  const fields = [{ name: 'CODE', type: t('char', 5) }];
  const file = new f.NativeFile('T', 'TF', fields, ['CODE'], [{ CODE: 'B1' }, { CODE: 'b1' }, { CODE: '01' }]);
  assert.deepEqual([file.read(), file.read(), file.read()].map(r => r.record.CODE), ['b1', 'B1', '01']);
  assert.equal(file.chain(['B1   ']).found, true);
  assert.throws(() => file.chain([12]), INCOMPATIBLE);
});

test('clé numérique : une valeur caractère est refusée', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  assert.throws(() => file.chain(['2']), INCOMPATIBLE);
});

test('un ajout entre deux lectures est vu sans saut ni répétition', () => {
  const rows = clients();
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], rows);
  assert.equal(file.read().record.NUMCLI, 1);
  rows.push({ NUMCLI: 2, NOM: 'Nouveau' });
  rows.splice(0, 1); // suppression de Durand (3)
  assert.deepEqual([file.read(), file.read()].map(r => r.record.NOM), ['Martin', 'Nouveau']);
  assert.equal(file.read().eof, true);
});

test('reset : retour au début', () => {
  const file = new f.NativeFile('CLIENT', 'CLIENTF', CLIENT_FIELDS, ['NUMCLI'], clients());
  file.read(); file.read();
  file.reset();
  assert.equal(file.read().record.NUMCLI, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/files-core.test.js`
Expected: FAIL — `Cannot find module '…/out/files'`.

- [ ] **Step 3: Implement** — créer `src/files.ts` :

```ts
// Fichiers natifs (DCL-F) simulés sur les tables de context/tables.json.
// Les opérations renvoient l'enregistrement et les indicateurs ; elles ne lèvent
// aucune erreur d'exécution RPG (statuts gérés par l'interpréteur).
import { DataTypeNode } from './types';
import { isDateTime } from './datetime';
import { NotSupportedError, incompatibleTypes } from './errors';

export interface FieldDefinition {
  name: string;          // En majuscules
  type: DataTypeNode;
}

export interface FileResult {
  record?: any;
  found: boolean;
  eof: boolean;
  equal: boolean;
}

export type FileSpecial = 'start' | 'end';

const NUMERIC = new Set(['int', 'uns', 'packed', 'zoned']);
const dataType = (typeName: string, length?: number, decimals?: number): DataTypeNode =>
  ({ type: 'DataType', typeName, length, decimals });

// Type d'une zone, écrit en RPG (packed(7:0)) ou en SQL (DECIMAL(9,2)) ; undefined si inconnu
export function parseFieldType(text: string): DataTypeNode | undefined {
  const m = /^([a-z]+)(?:\((\d+)(?:[:,](\d+))?\))?$/.exec(String(text).toLowerCase().replace(/\s+/g, ''));
  if (!m) return undefined;
  const [, name, a, b] = m;
  const length = a === undefined ? undefined : Number(a);
  const decimals = b === undefined ? undefined : Number(b);
  switch (name) {
    case 'char': case 'varchar':
      return length !== undefined && decimals === undefined ? dataType(name, length) : undefined;
    case 'packed': case 'decimal': case 'dec':
      return length !== undefined ? dataType('packed', length, decimals ?? 0) : undefined;
    case 'zoned': case 'numeric':
      return length !== undefined ? dataType('zoned', length, decimals ?? 0) : undefined;
    case 'int': case 'uns':
      return [3, 5, 10, 20].includes(length ?? 10) && decimals === undefined ? dataType(name, length ?? 10) : undefined;
    case 'integer': return a === undefined ? dataType('int', 10) : undefined;
    case 'smallint': return a === undefined ? dataType('int', 5) : undefined;
    case 'bigint': return a === undefined ? dataType('int', 20) : undefined;
    case 'ind': case 'date': case 'time': case 'timestamp':
      return a === undefined ? dataType(name) : undefined;
    default: return undefined;
  }
}

// Collation EBCDIC des caractères invariants (identiques dans tous les CCSID EBCDIC latins)
const EBCDIC: { [ch: string]: number } = (() => {
  const map: { [ch: string]: number } = { ' ': 0x40, '.': 0x4b, '<': 0x4c, '(': 0x4d, '+': 0x4e, '&': 0x50,
    '*': 0x5c, ')': 0x5d, ';': 0x5e, '-': 0x60, '/': 0x61, ',': 0x6b, '%': 0x6c, '_': 0x6d, '>': 0x6e,
    '?': 0x6f, ':': 0x7a, "'": 0x7d, '=': 0x7e, '"': 0x7f };
  const range = (from: string, to: string, start: number) => {
    for (let c = from.charCodeAt(0), i = 0; c <= to.charCodeAt(0); c++, i++) map[String.fromCharCode(c)] = start + i;
  };
  range('a', 'i', 0x81); range('j', 'r', 0x91); range('s', 'z', 0xa2);
  range('A', 'I', 0xc1); range('J', 'R', 0xd1); range('S', 'Z', 0xe2);
  range('0', '9', 0xf0);
  return map;
})();

// Texte comparable dans l'ordre EBCDIC d'IBM i (blancs de fin ignorés)
export function ebcdicKey(text: string): string {
  let result = '';
  for (const ch of text.trimEnd()) {
    const code = EBCDIC[ch];
    if (code === undefined) throw new NotSupportedError(`Clé contenant le caractère '${ch}' (ordre EBCDIC non simulé)`);
    result += String.fromCharCode(code);
  }
  return result;
}

type Cursor = { side: 'before' | 'after'; at: any[] | FileSpecial } | { side: 'lost' };

export class NativeFile {
  private sequence = new WeakMap<object, number>();
  private nextSequence = 0;
  private cursor: Cursor = { side: 'before', at: 'start' };

  constructor(readonly name: string, readonly format: string, readonly fields: FieldDefinition[],
              readonly keys: string[], private rows: any[]) {
    rows.forEach(row => this.sequenceOf(row));
  }

  get keyed(): boolean {
    return this.keys.length > 0;
  }

  // Position perdue après un CHAIN non trouvé (position IBM i non vérifiée)
  get positionLost(): boolean {
    return this.cursor.side === 'lost';
  }

  reset(): void {
    this.cursor = { side: 'before', at: 'start' };
  }

  read(): FileResult {
    const row = this.ordered().find(r => this.ahead(r));
    if (!row) {
      this.cursor = { side: 'after', at: 'end' };
      return { found: false, eof: true, equal: false };
    }
    this.cursor = { side: 'after', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  readp(): FileResult {
    const behind = this.ordered().filter(r => !this.ahead(r));
    const row = behind[behind.length - 1];
    if (!row) {
      this.cursor = { side: 'before', at: 'start' };
      return { found: false, eof: true, equal: false };
    }
    this.cursor = { side: 'before', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  reade(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    const row = this.ordered().find(r => this.ahead(r));
    if (!row || this.compare(this.tuple(row), wanted) !== 0) return { found: false, eof: true, equal: false };
    this.cursor = { side: 'after', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  readpe(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    const behind = this.ordered().filter(r => !this.ahead(r));
    const row = behind[behind.length - 1];
    if (!row || this.compare(this.tuple(row), wanted) !== 0) return { found: false, eof: true, equal: false };
    this.cursor = { side: 'before', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  chain(key: any[]): FileResult {
    const wanted = this.searchKey(key);
    const row = this.ordered().find(r => this.compare(this.tuple(r), wanted) === 0);
    if (!row) {
      this.cursor = { side: 'lost' };
      return { found: false, eof: false, equal: false };
    }
    this.cursor = { side: 'after', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  // Fichier sans clé : lecture par rang d'arrivée (1 = premier)
  chainRrn(n: number): FileResult {
    const row = Number.isInteger(n) && n >= 1 ? this.rows[n - 1] : undefined;
    if (!row) {
      this.cursor = { side: 'lost' };
      return { found: false, eof: false, equal: false };
    }
    this.cursor = { side: 'after', at: this.tuple(row) };
    return { record: row, found: true, eof: false, equal: false };
  }

  setll(key: any[] | FileSpecial): FileResult {
    if (key === 'start' || key === 'end') {
      this.cursor = key === 'start' ? { side: 'before', at: 'start' } : { side: 'after', at: 'end' };
      return { found: key === 'start' && this.rows.length > 0, eof: false, equal: false };
    }
    const wanted = this.searchKey(key);
    this.cursor = { side: 'before', at: wanted };
    const tuples = this.rows.map(r => this.tuple(r));
    return {
      found: tuples.some(tp => this.compare(tp, wanted) >= 0),
      eof: false,
      equal: tuples.some(tp => this.compare(tp, wanted) === 0),
    };
  }

  setgt(key: any[] | FileSpecial): FileResult {
    if (key === 'start' || key === 'end') return this.setll(key);
    const wanted = this.searchKey(key);
    this.cursor = { side: 'after', at: wanted };
    return { found: this.rows.some(r => this.compare(this.tuple(r), wanted) > 0), eof: false, equal: false };
  }

  // --- Interne ---

  private sequenceOf(row: object): number {
    let s = this.sequence.get(row);
    if (s === undefined) {
      s = this.nextSequence++;
      this.sequence.set(row, s);
    }
    return s;
  }

  private field(name: string): FieldDefinition {
    return this.fields.find(f => f.name === name)!;
  }

  private valueOf(row: any, name: string): any {
    const column = Object.keys(row).find(c => c.toUpperCase() === name);
    return column === undefined ? undefined : row[column];
  }

  // Valeur de clé comparable : nombre pour une zone numérique, texte EBCDIC sinon
  private keyValue(value: any, type: DataTypeNode, fromProgram: boolean): any {
    if (NUMERIC.has(type.typeName)) {
      if (typeof value === 'number') return value;
      if (fromProgram) throw incompatibleTypes(`Clé '${value}' pour une zone numérique`);
      return Number(value);
    }
    if (fromProgram && typeof value === 'number') throw incompatibleTypes(`Clé numérique ${value} pour une zone ${type.typeName}`);
    if (typeof value === 'boolean') return value ? '1' : '0';
    const text = isDateTime(value) ? String(value) : String(value ?? '');
    return ebcdicKey(text);
  }

  // Clé de tri d'un enregistrement : zones clés puis numéro d'arrivée
  private tuple(row: any): any[] {
    const values = this.keys.map(k => this.keyValue(this.valueOf(row, k), this.field(k).type, false));
    values.push(this.sequenceOf(row));
    return values;
  }

  private searchKey(key: any[]): any[] {
    if (!this.keyed) throw new Error(`Fichier ${this.name} sans clé : opération par clé impossible`);
    if (key.length > this.keys.length) {
      throw new Error(`Clé de ${key.length} valeurs pour ${this.keys.length} zones clés du fichier ${this.name}`);
    }
    return key.map((v, i) => this.keyValue(v, this.field(this.keys[i]).type, true));
  }

  // Comparaison sur la partie commune (clé partielle)
  private compare(a: any[], b: any[]): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  private ordered(): any[] {
    return this.rows.map(row => ({ row, key: this.tuple(row) }))
      .sort((x, y) => this.compare(x.key, y.key))
      .map(item => item.row);
  }

  // L'enregistrement est-il devant le curseur (lu par le prochain READ) ?
  private ahead(row: any): boolean {
    const c = this.cursor;
    if (c.side === 'lost') throw new NotSupportedError(`Lecture séquentielle de ${this.name} après un CHAIN non trouvé`);
    if (c.at === 'start') return true;
    if (c.at === 'end') return false;
    const cmp = this.compare(this.tuple(row), c.at);
    return c.side === 'before' ? cmp >= 0 : cmp > 0;
  }
}
```

Note : dans un fichier sans clé, `tuple` ne contient que le numéro d'arrivée ; `searchKey` refuse les opérations par clé.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test test/files-core.test.js` puis `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/files.ts test/files-core.test.js
git commit -m "Fichiers natifs : module de lecture (types, ordre EBCDIC, curseur)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Contexte `tables.json` (clés, format, types) et nettoyage

**Files:**
- Modify: `src/context.ts`, `src/runtime.ts` (suppression des fonctions de fichiers factices), `test/helpers.js`, `test/context.test.js`
- Delete: `context/files.json`

**Interfaces:**
- Consumes: `parseFieldType` (tâche 1).
- Produces: `TableDefinition { columns: ColumnDefinition[]; data: any[]; keys?: string[]; format?: string }` ; `ExecutionContext { tables; programs }` (plus de `files`) ; `emptyContext()` = `{ tables: {}, programs: {} }`.

- [ ] **Step 1: Write the failing tests** — dans `test/context.test.js` : remplacer les deux attentes `{ tables: {}, files: {}, programs: {} }` par `{ tables: {}, programs: {} }`, et ajouter :

```js
test('tables.json : clés, format et types', () => {
  const dir = folderWith({
    'tables.json': JSON.stringify({ client: {
      format: 'clientf',
      schema: { numcli: 'packed(7:0)', nom: 'CHAR(30)' },
      keys: ['numcli'],
      data: [{ numcli: 1, nom: 'Dupont' }],
    } }),
  });
  const ctx = loadContextFromFolder(dir);
  assert.deepEqual(ctx.tables.CLIENT.keys, ['NUMCLI']);
  assert.equal(ctx.tables.CLIENT.format, 'CLIENTF');
  assert.deepEqual(ctx.tables.CLIENT.columns, [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'NOM', type: 'CHAR(30)' }]);
});

test('tables.json : clé absente du schéma ou type inconnu refusés', () => {
  const badKey = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "int(10)" }, "keys": ["b"], "data": [] } }' });
  assert.throws(() => loadContextFromFolder(badKey), /clé 'B'.*schéma/i);
  const badType = folderWith({ 'tables.json': '{ "T": { "schema": { "a": "blob(10)" }, "data": [] } }' });
  assert.throws(() => loadContextFromFolder(badType), /type 'blob\(10\)'.*inconnu/i);
});
```

`test/helpers.js` : supprimer la ligne `files: {},` de `customersContext()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/context.test.js`
Expected: FAIL (clés/format non conservés, `files` encore présent).

- [ ] **Step 3: Implement**
- `src/context.ts` :
  - supprimer `FileDefinition` et la propriété `files` d'`ExecutionContext` ; `emptyContext()` renvoie `{ tables: {}, programs: {} }` ;
  - `TableDefinition` : ajouter `keys?: string[]; format?: string;` ;
  - `normalizeTables`, branche `schema` : pour chaque colonne, vérifier `parseFieldType(type) !== undefined` (type SQL accepté par le moteur SQL existant ou RPG), sinon `throw new Error(\`Table '${tableName}' de ${sourcePath} : type '${type}' de la colonne ${col} inconnu\`)` ; conserver `keys` (en majuscules ; chaque clé doit être une colonne du schéma, sinon `throw new Error(\`Table '${tableName}' de ${sourcePath} : clé '${KEY}' absente du schéma\`)`) et `format` (en majuscules). La forme « tableau de lignes » reste inchangée (types `AUTO`).
  - importer `parseFieldType` depuis `./files`.
- `src/runtime.ts` : supprimer `files`, `filePointers`, `fileStatus`, `declareFile`, `setll`, `read`, `chain`, `getFileStatus` et leurs remises à zéro dans `reset()` (code mort).
- `git rm context/files.json`.
- Corriger toute autre référence à `context.files` / `FileDefinition` signalée par `npm run compile`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test test/context.test.js` puis `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context.ts src/runtime.ts test/context.test.js test/helpers.js   # la suppression de context/files.json est déjà indexée par git rm
git commit -m "Contexte : clés, format et types des tables ; suppression des fichiers factices" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Analyse de `DCL-F` et des opérations de fichier

**Files:**
- Modify: `src/types.ts`, `src/lexer.ts`, `src/parser.ts`
- Test: `test/unsupported.test.js`, `test/parser.test.js`

**Interfaces:**
- Produces (AST) :
  - `FileDeclarationNode { type: 'FileDeclaration'; name: string; keyed: boolean; usropn: boolean; line: number }` (nom tel qu'écrit)
  - `FileOperationNode { type: 'FileOperation'; operation: 'read'|'readp'|'reade'|'readpe'|'chain'|'setll'|'setgt'|'open'|'close'; file: string; key?: ExpressionNode[]; special?: 'start'|'end'; line: number }` (`key` = liste de valeurs ; `*START`/`*LOVAL` → `special: 'start'`, `*END`/`*HIVAL` → `'end'`)
  - `ProgramNode.files?: FileDeclarationNode[]`
  - Fonctions `%eof`, `%found`, `%equal`, `%open` : nœud builtin dont l'argument éventuel est `{ type: 'Expression', valueType: 'file', value: '<NOM>' }` (nom de fichier non évalué).

- [ ] **Step 1: Write the failing tests** — ajouter à `test/unsupported.test.js` (et retirer de ce fichier les attentes devenues fausses : « DCL-F est refusé », « CHAIN au niveau principal est refusé », et `read clients;` / `setll *start clients;` dans « READ, SETLL, WRITE, UPDATE, DELETE sont refusés » — garder `write fmt;`, `update fmt;`, `delete fmt;` ; garder `readc`, `setgt`→ non : retirer `setgt` et `open`/`close` des listes de codes refusés s'ils y figurent) :

```js
test('DCL-F : périphériques et mots-clés non supportés refusés', () => {
  for (const src of [
    'dcl-f ecran workstn;', 'dcl-f etat printer;', 'dcl-f f special;',
    'dcl-f client usage(*update);', 'dcl-f client usage(*input:*output);',
    'dcl-f client prefix(c_);', 'dcl-f client rename(clientf:r);', "dcl-f client extfile('LIB/CLIENT');",
    'dcl-f client infds(ds);', 'dcl-f client qualified;', 'dcl-f client alias;', 'dcl-f client block(*no);',
    'dcl-proc p; dcl-f client; end-proc;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('opérations de fichier non supportées refusées', () => {
  for (const src of [
    'dcl-f client keyed; reade client;', 'dcl-f client keyed; readpe client;',
    'dcl-f client keyed; chain %kds(k) client;', 'dcl-f client keyed; read(e) client;',
    'dcl-f client keyed; write clientf;', 'dcl-f client keyed; update clientf;', 'dcl-f client keyed; delete clientf;',
    'dcl-f client keyed; readc client;', 'dcl-f client keyed; read client ds;',
  ]) {
    assert.throws(() => parse(src), NOT_SUPPORTED, src);
  }
});

test('opération sur un fichier non déclaré : erreur d\'analyse', () => {
  assert.throws(() => parse('read client;'), /CLIENT.*non déclaré/i);
  assert.throws(() => parse('dcl-f client; if %eof(autre); endif;'), /AUTRE.*non déclaré/i);
});

test('opérations de lecture acceptées à l\'analyse', () => {
  assert.doesNotThrow(() => parse(`
    dcl-f client keyed usropn;
    dcl-f cde disk usage(*input) keyed;
    dcl-s n packed(7:0);
    open client;
    read client;
    read clientf;
    readp client;
    chain n client;
    chain (n : 5) cde;
    setll *start client;
    setll *hival client;
    setgt (n) cde;
    reade (n) cde;
    readpe n cde;
    if %eof(client) or %found or %equal(cde) or %open(client) or %eof;
    endif;
    close client;
  `));
});
```

Lire d'abord `test/unsupported.test.js` pour repérer exactement les tests à adapter (DCL-F, CHAIN, READ/SETLL, codes opération).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/unsupported.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**
- `src/types.ts` : `TokenType.READE`, `READP`, `READPE`, `SETGT`, `OPEN`, `CLOSE` ; interfaces `FileDeclarationNode`, `FileOperationNode` (remplacer l'ancienne) ; `ProgramNode.files?` ; ajouter `'file'` à `ExpressionNode.valueType`.
- `src/lexer.ts` : mots-clés `reade`, `readp`, `readpe`, `setgt`, `open`, `close` → nouveaux tokens. Attention : ces mots peuvent aussi être des noms de variables (`open = 1;`) : dans `parseStatement`, un token d'opération de fichier suivi de `=` / opérateur composé / `.` / `(`… n'est **pas** une opération ; réutiliser la logique `isNameUse` de `parseAssignmentOrCall` (les retirer de `UNSUPPORTED_OPCODES`).
- `src/parser.ts` :
  - `DCL-F nom` au niveau principal → `FileDeclarationNode` ajouté à `ProgramNode.files` (pas dans `body`). Mots-clés acceptés : `DISK` (facultatif), `USAGE(*INPUT)` seul, `KEYED`, `USROPN`. `WORKSTN`, `PRINTER`, `SPECIAL`, toute autre `USAGE`, et tout autre mot-clé → `unsupported(\`Le mot-clé X de DCL-F\`)` / `unsupported(\`DCL-F WORKSTN\`)`. `DCL-F` dans une procédure → `unsupported('DCL-F dans une procédure')`.
  - Les noms de fichiers déclarés sont mémorisés (majuscules) ; le format n'est connu qu'à l'exécution, donc l'opérande d'une opération est accepté s'il est un nom ; la vérification « fichier ou format inconnu » se fait à l'exécution (tâche 4) **sauf** quand aucun `DCL-F` n'a été vu : alors `read x` → erreur d'analyse « Fichier X non déclaré (ligne n) ». Pour `%EOF(x)`, `%FOUND(x)`, `%EQUAL(x)`, `%OPEN(x)` : `x` doit être un nom de fichier déclaré, sinon « Fichier X non déclaré (ligne n) ». (Un `DCL-F` doit précéder les opérations, comme en RPG free.)
  - Opérations : `READ f`, `READP f`, `READE clé f`, `READPE clé f`, `CHAIN clé f`, `SETLL clé f`, `SETGT clé f`, `OPEN f`, `CLOSE f`. Clé : `*START`, `*END`, `*LOVAL`, `*HIVAL` (SETLL/SETGT seulement), une liste parenthésée `(e1 : e2 …)` (séparateur `:`), ou une expression simple (`n`, `ds.champ`, littéral). `%KDS(...)` → unsupported. Extenseur `(E)` / `(N)` → unsupported. `READE`/`READPE` sans clé (un seul opérande) → unsupported. Un 3e opérande (`read client ds`, `chain k f ds`) → unsupported (incrément 3). `READC`, `WRITE`, `UPDATE`, `DELETE` restent refusés (`WRITE`/`UPDATE`/`DELETE` → unsupported « … (incrément écriture) »).
  - Fonctions `%EOF`, `%FOUND`, `%EQUAL`, `%OPEN` : ajouter à la table des fonctions admises (src/builtins.ts : entrées qui lèvent une erreur si appelées directement, l'interpréteur les traite) ; argument facultatif = nom de fichier (`valueType: 'file'`) ; sans parenthèses accepté (comme `%STATUS`) ; `%OPEN` exige un argument.
- Ne pas exécuter encore : l'interpréteur (tâche 4) traitera les nœuds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test test/unsupported.test.js test/parser.test.js` puis `npm test`
Expected: PASS (les tests d'exécution de fichiers n'existent pas encore).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lexer.ts src/parser.ts src/builtins.ts test/unsupported.test.js
git commit -m "Fichiers natifs : analyse de DCL-F et des opérations de lecture" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Exécution des fichiers, état, statuts, README

**Files:**
- Modify: `src/interpreter.ts` (et `src/runtime.ts` si besoin d'un accès aux tables), `readme.md`
- Test: `test/files.test.js` (nouveau)

**Interfaces:**
- Consumes: `NativeFile`, `parseFieldType`, `FileResult` (tâche 1) ; `TableDefinition.keys/format/columns` (tâche 2) ; `FileDeclarationNode`, `FileOperationNode`, builtin `%eof/%found/%equal/%open` avec argument `valueType: 'file'` (tâche 3).

- [ ] **Step 1: Write the failing tests** — créer `test/files.test.js` :

```js
// Fichiers natifs : programmes RPG lisant les données simulées de tables.json
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, run, runRaw } = require('./helpers');

const NOT_SUPPORTED = /pas encore support/i;
const INCOMPATIBLE = /types incompatibles/i;

function context() {
  return {
    programs: {},
    tables: {
      CLIENT: {
        format: 'CLIENTF',
        keys: ['NUMCLI'],
        columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'NOM', type: 'char(10)' },
                  { name: 'SOLDE', type: 'DECIMAL(9,2)' }, { name: 'CREE', type: 'date' }, { name: 'ACTIF', type: 'ind' }],
        data: [
          { NUMCLI: 3, NOM: 'Durand', SOLDE: 10, CREE: '2026-03-01', ACTIF: '1' },
          { NUMCLI: 1, NOM: 'Dupont', SOLDE: 1500.5, CREE: '2025-01-15', ACTIF: '1' },
          { NUMCLI: 2, NOM: 'Martin', SOLDE: 230, CREE: '2024-12-31', ACTIF: '0' },
        ],
      },
      CDE: {
        keys: ['NUMCLI', 'NUMCDE'],
        columns: [{ name: 'NUMCLI', type: 'packed(7:0)' }, { name: 'NUMCDE', type: 'packed(5:0)' }, { name: 'LIB', type: 'char(10)' }],
        data: [
          { NUMCLI: 1, NUMCDE: 10, LIB: 'a' }, { NUMCLI: 2, NUMCDE: 5, LIB: 'b' },
          { NUMCLI: 1, NUMCDE: 7, LIB: 'c' }, { NUMCLI: 2, NUMCDE: 1, LIB: 'd' },
        ],
      },
      VRAC: { columns: [{ name: 'X', type: 'AUTO' }], data: [{ X: 1 }] },
    },
  };
}

test('boucle READ / DOW NOT %EOF dans l\'ordre des clés', () => {
  const out = run(`
    dcl-f client keyed;
    read client;
    dow not %eof(client);
      dsply %char(numcli) + ' ' + %trim(nom) + ' ' + %char(solde);
      read client;
    enddo;
  `, context());
  assert.deepEqual(out, ['1 Dupont 1500.50', '2 Martin 230.00', '3 Durand 10.00']);
});

test('fichier sans KEYED : ordre d\'arrivée ; READ par nom de format', () => {
  const out = run(`
    dcl-f client;
    read clientf;
    dsply nom;
    read client;
    dsply nom;
  `, context());
  assert.deepEqual(out, ['Durand', 'Dupont']);
});

test('CHAIN / %FOUND ; zones inchangées si non trouvé ; types date et ind', () => {
  const out = run(`
    dcl-f client keyed;
    chain 2 client;
    if %found(client);
      dsply %trim(nom) + ' ' + %char(cree);
    endif;
    if not actif;
      dsply 'inactif';
    endif;
    chain 9 client;
    if not %found;
      dsply 'absent ' + %trim(nom);
    endif;
  `, context());
  assert.deepEqual(out, ['Martin 2024-12-31', 'inactif', 'absent Martin']);
});

test('SETLL / READE sur une clé partielle ; %EQUAL', () => {
  const out = run(`
    dcl-f cde keyed;
    dcl-s cli packed(7:0) inz(2);
    setll cli cde;
    if %equal(cde);
      reade cli cde;
      dow not %eof(cde);
        dsply %char(numcde) + lib;
        reade cli cde;
      enddo;
    endif;
    chain (1 : 7) cde;
    dsply lib;
  `, context());
  assert.deepEqual(out, ['1d', '5b', 'c']);
});

test('SETGT / READPE et READP depuis *END', () => {
  const out = run(`
    dcl-f cde keyed;
    dcl-f client keyed;
    setgt 1 cde;
    readpe 1 cde;
    dsply lib;
    setll *end client;
    readp client;
    dsply nom;
    setll *loval client;
    read client;
    dsply nom;
  `, context());
  assert.deepEqual(out, ['a', 'Durand', 'Dupont']);
});

test('USROPN : statut 01211 avant OPEN, 01215 si déjà ouvert, %OPEN', () => {
  const out = run(`
    dcl-f client keyed usropn;
    monitor;
      read client;
    on-error 01211;
      dsply 'ferme ' + %char(%status);
    endmon;
    if not %open(client);
      open client;
    endif;
    read client;
    dsply nom;
    monitor;
      open client;
    on-error 01215;
      dsply 'deja ouvert';
    endmon;
    close client;
    open client;
    read client;
    dsply nom;
  `, context());
  assert.deepEqual(out, ['ferme 1211', 'Dupont', 'deja ouvert', 'Dupont']);
  assert.throws(() => run(`dcl-f client usropn; read client;`, context()), /RNX1211/);
});

test('mêmes données que le SQL', () => {
  const out = run(`
    dcl-f client keyed;
    read client;
    exec sql insert into client (numcli, nom, solde, cree, actif) values (0, 'Avant', 0, '2026-01-01', '1');
    exec sql insert into client (numcli, nom, solde, cree, actif) values (4, 'Apres', 0, '2026-01-01', '1');
    dow not %eof(client);
      dsply nom;
      read client;
    enddo;
  `, context());
  assert.deepEqual(out, ['Dupont', 'Martin', 'Durand', 'Apres']);
});

test('erreurs de déclaration et de clé', () => {
  assert.throws(() => run(`dcl-f absent;`, context()), /ABSENT.*tables\.json/i);
  assert.throws(() => run(`dcl-f vrac;`, context()), /VRAC.*schema/i);
  assert.throws(() => run(`dcl-f vrac keyed;`, context()), /VRAC/i);
  assert.throws(() => run(`dcl-s nom packed(5:0); dcl-f client;`, context()), INCOMPATIBLE);
  assert.throws(() => run(`dcl-f client keyed; chain 'x' client;`, context()), INCOMPATIBLE);
  assert.throws(() => run(`dcl-f client keyed; chain 9 client; read client;`, context()), NOT_SUPPORTED);
  assert.throws(() => run(`dcl-f client keyed; read autref;`, context()), /AUTREF.*inconnu/i);
});

test('un programme appelé lit les mêmes données avec sa propre position', () => {
  const callee = `dcl-f client keyed; read client; dsply 'appele ' + nom;`;
  const out = run(`
    dcl-pr suivant extpgm('SUIVANT') end-pr;
    dcl-f client keyed;
    read client;
    read client;
    suivant();
    dsply 'appelant ' + nom;
  `, context(), { resolveProgram: name => (name === 'SUIVANT' ? { source: callee } : undefined) });
  assert.deepEqual(out, ['appele Dupont', 'appelant Martin']);
});
```

Note : `CLIENT` sans `format` dans un test → format `CLIENTF` (défaut `<FICHIER>F`) ; `CDE` → `CDEF`. Le test « dcl-s nom packed(5:0); dcl-f client » : `nom` est déjà déclaré avec un autre type que la zone `char(10)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test test/files.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** — `src/interpreter.ts` :
1. Dans `runProgram`, **avant** la première passe des déclarations : pour chaque `FileDeclarationNode` de `ast.files` :
   - table = `this.context.tables[NOM]` ; absente → `Error("Fichier NOM absent de context/tables.json")` ; colonnes de type `AUTO` (pas de `schema`) → `Error("Fichier NOM : décrivez ses zones dans \"schema\" de context/tables.json")` ; `keyed` et pas de `keys` → `Error("Fichier NOM déclaré KEYED sans \"keys\" dans context/tables.json")`.
   - zones = colonnes → `{ name, type: parseFieldType(col.type) }` ; format = `table.format ?? NOM + 'F'`.
   - `new NativeFile(NOM, format, zones, node.keyed ? table.keys : [], table.data)` (même tableau `data` que le SQL).
   - déclarer chaque zone comme variable globale : si déjà déclarée par un autre fichier avec le même type → partagée ; avec un type différent → `incompatibleTypes`. Valeur initiale : `defaultValue(type)`.
   - état du fichier : `{ file, open: !usropn, eof: false, found: false, equal: false }` dans une `Map` indexée par nom de fichier **et** par nom de format.
   - Une variable déclarée ensuite par `dcl-s`/`dcl-ds` avec le nom d'une zone : même type → erreur « déjà déclaré » existante ; on doit obtenir « types incompatibles » si le type diffère (test ci-dessus : `dcl-s nom packed(5:0)` **avant** `dcl-f` — traiter les fichiers avant les déclarations et faire échouer `declareVariable` d'une zone existante de type différent avec `incompatibleTypes`).
2. Exécution d'un `FileOperation` (cas `'FileOperation'` de `executeNode`) :
   - état introuvable par nom de fichier ou de format → `Error("Fichier ou format AUTREF inconnu")` ;
   - `open` : déjà ouvert → `RpgError(1215, "Fichier NOM déjà ouvert (RNX1215)")` ; sinon ouvert, `file.reset()`. `close` : fermé → `RpgError(1211, …)` ; sinon fermé.
   - autre opération sur un fichier fermé → `RpgError(1211, "Fichier NOM non ouvert (RNX1211)")`.
   - clé : évaluer chaque expression de `key` (valeurs RPG ; une date reste un `RpgDate`, `NativeFile` la compare par son texte) ; `special` → `'start'`/`'end'`.
   - `chain` sur un fichier non `keyed` : `chainRrn(clé[0])`.
   - appeler la méthode `NativeFile` ; si `record` : copier chaque zone dans sa variable via le chemin « données » : `coerce(valeur convertie, type, nom)` où une date/heure en texte ISO est convertie par `parseIso` (texte invalide → `Error` claire), un indicateur `'1'/'0'/true/false` → booléen ; **sans** `checkAssignable`.
   - mettre à jour l'état : `READ*` → `eof` ; `CHAIN` → `found` ; `SETLL` → `found` et `equal` ; `SETGT` → `found`. Mémoriser aussi la dernière valeur de chacun pour `%EOF`/`%FOUND`/`%EQUAL` sans argument (par indicateur : la dernière opération qui l'a mis à jour).
3. Fonctions `%eof`, `%found`, `%equal`, `%open` dans la branche builtin de `evaluate` (traitées avant l'appel générique, comme `%char`) : argument `valueType: 'file'` → état de ce fichier (nom ou format) ; sans argument → dernière valeur globale ; `%open(f)` → `open`. Résultat booléen.
4. Programme appelé (`callSourceProgram`) : le nouvel `Interpreter` a ses propres `NativeFile` sur les mêmes `context.tables` (déjà le cas si l'état des fichiers est un champ d'instance initialisé dans `runProgram`).

`readme.md` :
- Section « Fichiers natifs » (avant « Limites connues ») : format de `tables.json` (exemple `CLIENT` du spec avec `format`, `schema`, `keys`, `data`), types acceptés, opérations et fonctions supportées, ordre EBCDIC des clés caractère (caractère hors jeu invariant → refus), statuts 01211/01215, données partagées avec le SQL, refus (écriture, `PREFIX`/`RENAME`…, `%KDS`, `READE` sans clé, lecture après `CHAIN` non trouvé, écrans et impressions).
- Liste « Limites connues » : remplacer la mention « Pas de fichiers natifs (`dcl-f`, `read`, `chain`, `setll`…) » par « Fichiers natifs : lecture seulement (pas encore d'écriture `WRITE`/`UPDATE`/`DELETE`) ; pas d'écrans ni d'impressions ».
- Retirer toute mention de `files.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test test/files.test.js` puis `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interpreter.ts src/runtime.ts src/builtins.ts readme.md test/files.test.js
git commit -m "Fichiers natifs : exécution de la lecture, état %EOF/%FOUND/%EQUAL, statuts 01211/01215" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Vérification finale

- [ ] `npm test` : tout vert.
- [ ] Relancer la mesure sur `skills/rpg-ile/scripts/*.rpgle` (script de mesure du dossier temporaire) et noter le nouveau premier blocage de chaque programme.
- [ ] `git status --short` : seuls `fichiers_test/tstpgm.rpgle` (modifié) et `skills/` (non suivi) restent hors commit.
- [ ] Ne pas fusionner : attendre « fusionne ».
