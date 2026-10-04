import { ExecutionContext, TableDefinition } from './context';
import { NotSupportedError } from './errors';

export interface SQLResult {
  rows: any[];
  rowCount: number;
  sqlCode: number;   // 0 = succès, 100 = pas de ligne, négatif = erreur
  sqlState: string;  // '00000', '02000', etc.
  message?: string;  // Détail de l'erreur quand sqlCode < 0
}

// Accès aux variables RPG utilisées comme variables hôtes (:nom)
export interface HostVariables {
  get(name: string): any;
  set(name: string, value: any): void;
}

// === Clause WHERE : tokens et arbre ===

type WhereToken =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'host'; name: string }
  | { kind: 'word'; value: string }   // colonne ou mot-clé (AND, OR, NOT, IS, NULL)
  | { kind: 'op'; value: string }     // = <> != < > <= >=
  | { kind: 'lparen' }
  | { kind: 'rparen' };

type Operand =
  | { kind: 'column'; name: string }
  | { kind: 'literal'; value: any };

type Condition =
  | { kind: 'or' | 'and'; left: Condition; right: Condition }
  | { kind: 'not'; operand: Condition }
  | { kind: 'compare'; op: string; left: Operand; right: Operand }
  | { kind: 'isNull'; operand: Operand; negated: boolean };

// Mots qui ouvrent une construction SQL hors périmètre (jamais pris pour une colonne inconnue)
const RESERVED_SQL_WORDS = new Set(['CURRENT', 'CASE', 'CAST', 'SELECT', 'DEFAULT', 'DATE', 'TIME', 'TIMESTAMP', 'USER', 'SESSION_USER', 'SYSTEM_USER']);

// CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_USER, CURRENT DATE... : jamais pris pour une colonne
const isReservedSqlWord = (upper: string) => RESERVED_SQL_WORDS.has(upper) || upper.startsWith('CURRENT_');

// Erreur SQL ordinaire avec son SQLCOD et son SQLSTATE (le programme continue)
class SqlError extends Error {
  constructor(message: string, public readonly sqlCode: number, public readonly sqlState: string) {
    super(message);
  }
}

const HOST_NAME = /^[A-Za-z_$#@][\w$#@]*(?:\.[\w$#@]+)?$/;

export class SQLEngine {
  private tables: { [name: string]: TableDefinition };

  constructor(context: ExecutionContext) {
    this.tables = context.tables;
  }

  // Point d'entrée principal
  execute(sql: string, hostVariables: HostVariables): SQLResult {
    // Un commentaire SQL ne serait pas interprété : refusé plutôt que mal compris
    if (sql.split(/('(?:[^']|'')*')/).some((part, i) => i % 2 === 0 && /--|\/\*/.test(part))) {
      throw new NotSupportedError('Commentaire dans une instruction SQL');
    }
    const normalized = this.normalizeWhitespace(sql);
    const verb = (normalized.match(/^\w+/)?.[0] ?? '').toUpperCase();

    try {
      switch (verb) {
        case 'SELECT': return this.executeSelect(normalized, hostVariables);
        case 'INSERT': return this.executeInsert(normalized, hostVariables);
        case 'UPDATE': return this.executeUpdate(normalized, hostVariables);
        case 'DELETE': return this.executeDelete(normalized, hostVariables);
      }
      // DECLARE CURSOR, OPEN, FETCH, CLOSE, SET, VALUES, COMMIT, CALL, WITH... : le programme s'arrête
      throw new NotSupportedError(`Instruction SQL ${verb || normalized}`);
    } catch (error: any) {
      // Un refus « pas encore supporté » arrête le programme, il n'est pas une erreur SQL
      if (error instanceof NotSupportedError) throw error;
      return {
        rows: [],
        rowCount: 0,
        sqlCode: error instanceof SqlError ? error.sqlCode : -1,
        sqlState: error instanceof SqlError ? error.sqlState : 'HY000',
        message: error.message,
      };
    }
  }

  // === SELECT ===
  private executeSelect(sql: string, hostVars: HostVariables): SQLResult {
    // 1. Découpe : SELECT liste [INTO variables] FROM table [WHERE ...]
    const fromAt = this.findTopLevelWord(sql, 'FROM');
    if (fromAt < 0) throw new NotSupportedError('SELECT sans FROM');
    const intoAt = this.findTopLevelWord(sql, 'INTO');
    if (intoAt > fromAt) throw new NotSupportedError('INTO après FROM');
    const listText = sql.slice(6, intoAt < 0 ? fromAt : intoAt).trim();
    const intoText = intoAt < 0 ? '' : sql.slice(intoAt + 4, fromAt).trim();
    const after = sql.slice(fromAt + 4).trim().match(/^(\w+)\s*(.*)$/);
    if (!after) throw new NotSupportedError(`Clause FROM '${sql.slice(fromAt + 4).trim()}'`);
    const tail = after[2];
    if (tail !== '' && !/^WHERE\s/i.test(tail)) throw new NotSupportedError(`Clause SELECT '${tail}'`);

    // La liste ne contient que * ou des colonnes ; INTO que des variables hôtes sans indicateur
    const items = this.splitTopLevel(listText, ',').map(c => c.trim().toUpperCase());
    for (const item of items) {
      if (item !== '*' && !/^\w+$/.test(item)) throw new NotSupportedError(`Liste de SELECT '${item}'`);
    }
    if (items.includes('*') && items.length > 1) throw new NotSupportedError(`Liste de SELECT '${listText}'`);
    const targets = intoAt < 0 ? [] : this.splitTopLevel(intoText, ',').map(v => v.trim());
    for (const target of targets) {
      if (!target.startsWith(':') || !HOST_NAME.test(target.slice(1))) throw new NotSupportedError(`INTO '${target}'`);
    }

    // 2. Table et filtrage WHERE
    const table = this.getTable(after[1]);
    let rows = [...table.data];
    if (tail !== '') {
      rows = rows.filter(this.compileWhere(tail.slice(5), table, hostVars));
    }

    if (intoAt >= 0 && items[0] !== '*' && targets.length !== items.length) {
      throw new SqlError(`SELECT INTO : ${items.length} colonne(s) pour ${targets.length} variable(s) hôte(s)`, -313, '07001');
    }
    // 3. Gestion INTO : autant de variables que de colonnes (SQLCOD -313), une seule ligne (SQLCOD -811)
    if (intoAt >= 0 && rows.length > 0) {
      const firstRow = rows[0];
      const selectedColumns = items[0] === '*' ? Object.keys(firstRow).map(k => k.toUpperCase()) : items;
      if (targets.length !== selectedColumns.length) {
        throw new SqlError(`SELECT INTO : ${selectedColumns.length} colonne(s) pour ${targets.length} variable(s) hôte(s)`, -313, '07001');
      }
      if (rows.length > 1) throw new SqlError('SELECT INTO : plusieurs lignes trouvées', -811, '21000');

      // Mapper colonne -> variable hôte ; une valeur NULL sans indicateur laisse la variable inchangée (SQLCOD -305)
      let nullColumn: string | undefined;
      targets.forEach((target, idx) => {
        if (idx >= selectedColumns.length) return;
        const targetCol = selectedColumns[idx];
        const actualCol = Object.keys(firstRow).find(k => k.toUpperCase() === targetCol);
        if (actualCol === undefined) {
          throw new Error(`Colonne inconnue: ${targetCol}`);
        }
        const value = firstRow[actualCol];
        if (value === null || value === undefined) nullColumn ??= targetCol;
        else hostVars.set(target.slice(1).toLowerCase(), value);
      });
      if (nullColumn !== undefined) {
        throw new SqlError(`Valeur NULL de ${nullColumn} sans variable indicatrice`, -305, '22002');
      }
    }

    return this.resultFor(rows, rows.length);
  }

  // === INSERT ===
  private executeInsert(sql: string, hostVars: HostVariables): SQLResult {
    const match = sql.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(/i);
    if (!match) throw new NotSupportedError(`INSERT '${sql}'`);

    const table = this.getTable(match[1]);
    const columns = match[2].split(',').map(c => c.trim().toUpperCase());
    const close = this.findClosingParen(sql, match[0].length);
    if (close < 0 || sql.slice(close + 1).trim() !== '') throw new NotSupportedError(`INSERT '${sql}'`);
    const values = this.splitTopLevel(sql.slice(match[0].length, close), ',')
      .map(v => this.compileValue(v, null)({}, hostVars));
    this.checkColumns(table, columns, match[1].toUpperCase());
    this.checkDuplicates(columns);
    if (values.length !== columns.length) {
      throw new Error(`INSERT : ${columns.length} colonnes pour ${values.length} valeurs`);
    }

    const newRow: any = {};
    columns.forEach((col, idx) => newRow[col] = values[idx]);

    table.data.push(newRow);

    return { rows: [], rowCount: 1, sqlCode: 0, sqlState: '00000' };
  }

  // === UPDATE ===
  private executeUpdate(sql: string, hostVars: HostVariables): SQLResult {
    const head = sql.match(/^UPDATE\s+(\w+)\s+SET\s+/i);
    if (!head) throw new NotSupportedError(`UPDATE '${sql}'`);

    const table = this.getTable(head[1]);
    const rest = sql.slice(head[0].length);
    const whereAt = this.findTopLevelWord(rest, 'WHERE');
    const setClause = whereAt < 0 ? rest : rest.slice(0, whereAt);
    const targets = whereAt < 0
      ? [...table.data]
      : table.data.filter(this.compileWhere(rest.slice(whereAt + 5), table, hostVars));
    const known = this.columnNames(table);
    const assignments = this.splitTopLevel(setClause, ',').map(assign => {
      const eq = this.splitTopLevel(assign, '=');
      // SET (a, b) = (...) : liste de colonnes
      if (/^\s*\(/.test(eq[0])) throw new NotSupportedError(`Clause SET '${assign.trim()}'`);
      if (eq.length !== 2 || !/^\s*\w+\s*$/.test(eq[0])) throw new Error(`Clause SET invalide : ${assign.trim()}`);
      const col = eq[0].trim().toUpperCase();
      this.checkColumns(table, [col], head[1].toUpperCase());
      return { col, value: this.compileValue(eq[1], known) };
    });
    this.checkDuplicates(assignments.map(a => a.col));
    for (const row of targets) {
      // Toutes les expressions lisent la ligne avant mise à jour
      const before = { ...row };
      const computed = assignments.map(a => a.value(before, hostVars));
      assignments.forEach((a, i) => { row[a.col] = computed[i]; });
    }

    return this.resultFor([], targets.length);
  }

  // === DELETE ===
  private executeDelete(sql: string, hostVars: HostVariables): SQLResult {
    const match = sql.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
    if (!match) throw new NotSupportedError(`DELETE '${sql}'`);

    const table = this.getTable(match[1]);
    const before = table.data.length;
    if (match[2]) {
      const matches = this.compileWhere(match[2], table, hostVars);
      table.data = table.data.filter((row: any) => !matches(row));
    } else {
      table.data = [];
    }

    return this.resultFor([], before - table.data.length);
  }

  // === Utilitaires ===

  // Réduit les blancs à un espace, sauf à l'intérieur des chaînes littérales
  private normalizeWhitespace(sql: string): string {
    return sql
      .split(/('(?:[^']|'')*')/)
      .map((part, i) => (i % 2 === 1 ? part : part.replace(/\s+/g, ' ')))
      .join('')
      .trim();
  }

  private getTable(name: string): TableDefinition {
    const table = this.tables[name.toUpperCase()];
    if (!table) throw new Error(`Table '${name.toUpperCase()}' non définie`);
    return table;
  }

  private resultFor(rows: any[], count: number): SQLResult {
    return count > 0
      ? { rows, rowCount: count, sqlCode: 0, sqlState: '00000' }
      : { rows, rowCount: 0, sqlCode: 100, sqlState: '02000' };
  }

  // Le Runtime stocke les variables en minuscules
  private getHostVariable(name: string, hostVars: HostVariables): any {
    const value = hostVars.get(name.toLowerCase());
    if (value === undefined) throw new Error(`Variable hôte non déclarée: :${name}`);
    // Les blancs de remplissage d'un char RPG ne font pas partie de la donnée
    return typeof value === 'string' ? value.trimEnd() : value;
  }

  // === Expressions de valeur (SET, VALUES) ===

  private columnNames(table: TableDefinition): Set<string> {
    const names = new Set<string>(table.columns.map(c => c.name.toUpperCase()));
    for (const row of table.data) {
      for (const key of Object.keys(row)) names.add(key.toUpperCase());
    }
    return names;
  }

  // Une colonne qui n'existe pas dans la table est une erreur SQL (table sans aucune colonne connue : pas de contrôle)
  private checkDuplicates(columns: string[]): void {
    const seen = new Set<string>();
    for (const col of columns) {
      if (seen.has(col)) throw new Error(`Colonne en double: ${col}`);
      seen.add(col);
    }
  }

  private checkColumns(table: TableDefinition, columns: string[], tableName = ''): void {
    const known = this.columnNames(table);
    if (known.size === 0) {
      // Aucune colonne connue : une faute de frappe créerait une colonne fantôme
      if (table.data.length === 0) {
        throw new NotSupportedError(`Table ${tableName} vide sans colonnes déclarées : déclarez "columns" dans context/tables.json`);
      }
      return;
    }
    for (const col of columns) {
      if (!known.has(col)) throw new Error(`Colonne inconnue: ${col}`);
    }
  }

  // Position d'un mot entier hors littéraux et parenthèses, -1 si absent
  private findTopLevelWord(text: string, word: string): number {
    let depth = 0;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "'") {
          if (text[i + 1] === "'") i++;
          else inString = false;
        }
      } else if (ch === "'") {
        inString = true;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
      } else if (depth === 0 && /\s/.test(text[i - 1] ?? ' ') && text.substr(i, word.length).toUpperCase() === word
        && /\s|$/.test(text[i + word.length] ?? '')) {
        return i;
      }
    }
    return -1;
  }

  // Découpe sur un séparateur hors littéraux chaîne et hors parenthèses
  private splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "'") {
          if (text[i + 1] === "'") i++;
          else inString = false;
        }
      } else if (ch === "'") {
        inString = true;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
      } else if (ch === separator && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts;
  }

  // Position de la parenthèse fermante qui correspond à une parenthèse ouverte juste avant `from`
  private findClosingParen(text: string, from: number): number {
    let depth = 1;
    let inString = false;
    for (let i = from; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "'") {
          if (text[i + 1] === "'") i++;
          else inString = false;
        }
      } else if (ch === "'") {
        inString = true;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')' && --depth === 0) {
        return i;
      }
    }
    return -1;
  }

  // Analyse une expression de valeur et renvoie une fonction (ligne, variables hôtes) => valeur.
  // `columns` : colonnes utilisables (SET) ; null pour VALUES, où aucune colonne n'est visible.
  // Les constructions hors périmètre (fonctions, ||, CASE, sous-requêtes...) arrêtent le programme.
  private compileValue(text: string, columns: Set<string> | null): (row: any, hostVars: HostVariables) => any {
    type Evaluator = (row: any, hostVars: HostVariables) => any;
    const unsupported = (): never => {
      throw new NotSupportedError(`Expression SQL '${text.trim()}'`);
    };

    // Jetons : chaîne, nombre, variable hôte, mot, opérateur, parenthèse
    const tokens: { kind: 'string' | 'number' | 'host' | 'word' | 'op' | 'lparen' | 'rparen'; value: string }[] = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      let m: RegExpMatchArray | null;
      const rest = text.slice(i);
      if (/\s/.test(ch)) {
        i++;
      } else if (ch === "'") {
        let value = '';
        i++;
        while (true) {
          if (i >= text.length) throw new Error(`Chaîne non terminée : ${text.trim()}`);
          if (text[i] === "'") {
            if (text[i + 1] === "'") { value += "'"; i += 2; continue; }
            i++;
            break;
          }
          value += text[i++];
        }
        tokens.push({ kind: 'string', value });
      } else if ((m = rest.match(/^\d+(?:\.\d+)?/))) {
        tokens.push({ kind: 'number', value: m[0] });
        i += m[0].length;
      } else if ((m = rest.match(/^:([A-Za-z_$#@][\w$#@]*(?:\.[\w$#@]+)?)/))) {
        tokens.push({ kind: 'host', value: m[1] });
        i += m[0].length;
      } else if ((m = rest.match(/^[A-Za-z_][\w$#@]*/))) {
        tokens.push({ kind: 'word', value: m[0] });
        i += m[0].length;
      } else if ('+-*/'.includes(ch)) {
        tokens.push({ kind: 'op', value: ch });
        i++;
      } else if (ch === '(') {
        tokens.push({ kind: 'lparen', value: ch });
        i++;
      } else if (ch === ')') {
        tokens.push({ kind: 'rparen', value: ch });
        i++;
      } else {
        return unsupported();   // ||, comparaisons, etc.
      }
    }

    let pos = 0;
    const isOp = (v: string) => tokens[pos]?.kind === 'op' && tokens[pos].value === v;

    const numeric = (v: any): number | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return v;
      return unsupported();   // une chaîne dans un calcul
    };

    const parseAtom = (): Evaluator => {
      const t = tokens[pos];
      if (!t) return unsupported();
      pos++;
      switch (t.kind) {
        case 'string': return () => t.value;
        case 'number': return () => Number(t.value);
        case 'host': return (_row, hostVars) => this.getHostVariable(t.value, hostVars);
        case 'word': {
          const upper = t.value.toUpperCase();
          if (upper === 'NULL') return () => null;
          // Fonction, CURRENT DATE, CASE... : pas une simple colonne
          if (tokens[pos]?.kind === 'lparen' || isReservedSqlWord(upper) || !columns) return unsupported();
          if (!columns.has(upper)) throw new Error(`Colonne inconnue: ${upper}`);
          return (row) => {
            const key = Object.keys(row).find(k => k.toUpperCase() === upper);
            return key === undefined ? null : row[key];
          };
        }
        default: return unsupported();
      }
    };

    const parseFactor = (): Evaluator => {
      if (isOp('-')) {
        pos++;
        const inner = parseFactor();
        return (row, hv) => {
          const v = numeric(inner(row, hv));
          return v === null ? null : -v;
        };
      }
      if (tokens[pos]?.kind === 'lparen') {
        pos++;
        const inner = parseExpr();
        if (tokens[pos]?.kind !== 'rparen') return unsupported();
        pos++;
        return inner;
      }
      return parseAtom();
    };

    // 15 chiffres significatifs, comme les décimaux : balance + 0.1 ne laisse pas de résidu binaire
    const exact = (n: number) => {
      if (Math.abs(n) >= 1e15) throw new NotSupportedError('Résultat de calcul SQL de 15 chiffres ou plus');
      return Number(n.toPrecision(15));
    };

    const binary = (op: string, left: Evaluator, right: Evaluator): Evaluator => (row, hv) => {
      const a = numeric(left(row, hv));
      const b = numeric(right(row, hv));
      if (a === null || b === null) return null;
      switch (op) {
        case '+': return exact(a + b);
        case '-': return exact(a - b);
        default: return exact(a * b);
      }
    };

    const parseTerm = (): Evaluator => {
      let left = parseFactor();
      while (isOp('*') || isOp('/')) {
        // Précision et échelle du quotient DB2 non simulées
        if (isOp('/')) throw new NotSupportedError('Division dans une expression SQL');
        const op = tokens[pos++].value;
        left = binary(op, left, parseFactor());
      }
      return left;
    };

    const parseExpr = (): Evaluator => {
      let left = parseTerm();
      while (isOp('+') || isOp('-')) {
        const op = tokens[pos++].value;
        left = binary(op, left, parseTerm());
      }
      return left;
    };

    const evaluator = parseExpr();
    if (pos < tokens.length) return unsupported();
    return evaluator;
  }

  // === Clause WHERE ===
  // Analyse la clause une seule fois et renvoie un prédicat par ligne.
  // Toute construction non reconnue lève une erreur : une condition mal comprise
  // ne doit jamais sélectionner (et donc modifier ou supprimer) toutes les lignes.
  private compileWhere(clause: string, table: TableDefinition, hostVars: HostVariables): (row: any) => boolean {
    const knownColumns = new Set<string>(table.columns.map(c => c.name.toUpperCase()));
    for (const row of table.data) {
      for (const key of Object.keys(row)) knownColumns.add(key.toUpperCase());
    }

    const tokens = this.tokenizeWhere(clause);
    let pos = 0;

    const peek = () => tokens[pos];
    const isWord = (value: string) => {
      const t = peek();
      return t !== undefined && t.kind === 'word' && t.value.toUpperCase() === value;
    };
    const describe = (t: WhereToken | undefined) => {
      if (!t) return 'fin de clause';
      if (t.kind === 'lparen') return "'('";
      if (t.kind === 'rparen') return "')'";
      if (t.kind === 'host') return `':${t.name}'`;
      return `'${t.value}'`;
    };
    const unsupported = (): never => {
      throw new NotSupportedError(`Clause WHERE près de ${describe(peek())} : ${clause}`);
    };

    const parseOperand = (): Operand => {
      const t = peek();
      if (!t) return unsupported();
      if (t.kind === 'string' || t.kind === 'number') {
        pos++;
        return { kind: 'literal', value: t.value };
      }
      if (t.kind === 'host') {
        pos++;
        return { kind: 'literal', value: this.getHostVariable(t.name, hostVars) };
      }
      if (t.kind === 'word' && !['AND', 'OR', 'NOT', 'IS'].includes(t.value.toUpperCase())) {
        pos++;
        const name = t.value.toUpperCase();
        if (name === 'NULL') return { kind: 'literal', value: null };
        // Fonction, CURRENT DATE, CASE... : pas une simple colonne
        if (peek()?.kind === 'lparen' || isReservedSqlWord(name)) {
          throw new NotSupportedError(`Clause WHERE : '${t.value}' : ${clause}`);
        }
        if (!knownColumns.has(name)) throw new Error(`Colonne inconnue: ${name}`);
        return { kind: 'column', name };
      }
      return unsupported();
    };

    const parsePrimary = (): Condition => {
      if (peek()?.kind === 'lparen') {
        pos++;
        const inner = parseOr();
        if (peek()?.kind !== 'rparen') unsupported();
        pos++;
        return inner;
      }
      const left = parseOperand();
      if (isWord('IS')) {
        pos++;
        const negated = isWord('NOT');
        if (negated) pos++;
        if (!isWord('NULL')) unsupported();
        pos++;
        return { kind: 'isNull', operand: left, negated };
      }
      const t = peek();
      if (t?.kind !== 'op') return unsupported();
      pos++;
      return { kind: 'compare', op: t.value, left, right: parseOperand() };
    };

    const parseNot = (): Condition => {
      if (isWord('NOT')) {
        pos++;
        return { kind: 'not', operand: parseNot() };
      }
      return parsePrimary();
    };

    const parseAnd = (): Condition => {
      let left = parseNot();
      while (isWord('AND')) {
        pos++;
        left = { kind: 'and', left, right: parseNot() };
      }
      return left;
    };

    function parseOr(): Condition {
      let left = parseAnd();
      while (isWord('OR')) {
        pos++;
        left = { kind: 'or', left, right: parseAnd() };
      }
      return left;
    }

    const condition = parseOr();
    if (pos < tokens.length) unsupported();

    return (row: any) => this.evaluateCondition(condition, row);
  }

  private tokenizeWhere(clause: string): WhereToken[] {
    const tokens: WhereToken[] = [];
    let i = 0;

    while (i < clause.length) {
      const rest = clause.slice(i);
      const ch = clause[i];
      let m: RegExpMatchArray | null;

      if (/\s/.test(ch)) {
        i++;
      } else if (ch === "'") {
        let value = '';
        i++;
        while (true) {
          if (i >= clause.length) throw new Error(`Chaîne non terminée dans la clause WHERE : ${clause}`);
          if (clause[i] === "'") {
            if (clause[i + 1] === "'") { value += "'"; i += 2; continue; }
            i++;
            break;
          }
          value += clause[i++];
        }
        tokens.push({ kind: 'string', value });
      } else if ((m = rest.match(/^\d+(?:\.\d+)?/))) {
        tokens.push({ kind: 'number', value: Number(m[0]) });
        i += m[0].length;
      } else if ((m = rest.match(/^:([A-Za-z_$#@][\w$#@]*(?:\.[\w$#@]+)?)/))) {
        tokens.push({ kind: 'host', name: m[1] });
        i += m[0].length;
      } else if ((m = rest.match(/^(<=|>=|<>|!=|=|<|>)/))) {
        tokens.push({ kind: 'op', value: m[0] });
        i += m[0].length;
      } else if (ch === '(') {
        tokens.push({ kind: 'lparen' });
        i++;
      } else if (ch === ')') {
        tokens.push({ kind: 'rparen' });
        i++;
      } else if ((m = rest.match(/^[A-Za-z_][\w$#@]*/))) {
        tokens.push({ kind: 'word', value: m[0] });
        i += m[0].length;
      } else {
        throw new NotSupportedError(`Caractère '${ch}' dans la clause WHERE : ${clause}`);
      }
    }

    return tokens;
  }

  private evaluateCondition(cond: Condition, row: any): boolean {
    switch (cond.kind) {
      case 'or': return this.evaluateCondition(cond.left, row) || this.evaluateCondition(cond.right, row);
      case 'and': return this.evaluateCondition(cond.left, row) && this.evaluateCondition(cond.right, row);
      case 'not': return !this.evaluateCondition(cond.operand, row);
      case 'isNull': {
        const value = this.operandValue(cond.operand, row);
        const isNull = value === null || value === undefined;
        return cond.negated ? !isNull : isNull;
      }
      case 'compare':
        return this.compare(this.operandValue(cond.left, row), cond.op, this.operandValue(cond.right, row));
    }
  }

  private operandValue(operand: Operand, row: any): any {
    if (operand.kind === 'literal') return operand.value;
    const key = Object.keys(row).find(k => k.toUpperCase() === operand.name);
    return key === undefined ? null : row[key];
  }

  // Une comparaison avec NULL n'est jamais vraie. Un nombre comparé à une chaîne
  // numérique est comparé numériquement ; les chaînes ignorent les blancs de fin.
  private compare(left: any, op: string, right: any): boolean {
    if (left === null || left === undefined || right === null || right === undefined) return false;

    let a: any = left;
    let b: any = right;
    const asNumber = (v: any) => (typeof v === 'number' ? v : String(v).trim() === '' ? NaN : Number(v));
    if (typeof left === 'number' || typeof right === 'number') {
      const na = asNumber(left);
      const nb = asNumber(right);
      if (!isNaN(na) && !isNaN(nb)) {
        a = na;
        b = nb;
      }
    }
    if (typeof a !== 'number' || typeof b !== 'number') {
      a = String(a).trimEnd();
      b = String(b).trimEnd();
    }

    switch (op) {
      case '=': return a === b;
      case '<>': case '!=': return a !== b;
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      default: throw new Error(`Opérateur SQL non supporté: ${op}`);
    }
  }
}
