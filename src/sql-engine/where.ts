// Clause WHERE : analyse en arbre de conditions et évaluation sur une ligne.
import type { TableDefinition } from '../context';
import { NotSupportedError } from '../errors';
import { isReservedSqlWord } from './reserved';
import { getHostVariable } from './support';
import type { HostVariables } from './types';

// === Clause WHERE : tokens et arbre ===

export type WhereToken =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'host'; name: string }
  | { kind: 'word'; value: string }   // colonne ou mot-clé (AND, OR, NOT, IS, NULL)
  | { kind: 'op'; value: string }     // = <> != < > <= >=
  | { kind: 'lparen' }
  | { kind: 'rparen' };

export type Operand =
  | { kind: 'column'; name: string }
  | { kind: 'literal'; value: any };

export type Condition =
  | { kind: 'or' | 'and'; left: Condition; right: Condition }
  | { kind: 'not'; operand: Condition }
  | { kind: 'compare'; op: string; left: Operand; right: Operand }
  | { kind: 'isNull'; operand: Operand; negated: boolean };

// === Clause WHERE ===
// Analyse la clause une seule fois et renvoie un prédicat par ligne.
// Toute construction non reconnue lève une erreur : une condition mal comprise
// ne doit jamais sélectionner (et donc modifier ou supprimer) toutes les lignes.
export function compileWhere(clause: string, table: TableDefinition, hostVars: HostVariables): (row: any) => boolean {
  const knownColumns = new Set<string>(table.columns.map(c => c.name.toUpperCase()));
  for (const row of table.data) {
    for (const key of Object.keys(row)) knownColumns.add(key.toUpperCase());
  }

  const tokens = tokenizeWhere(clause);
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
      return { kind: 'literal', value: getHostVariable(t.name, hostVars) };
    }
    if (t.kind === 'word' && !['AND', 'OR', 'NOT', 'IS'].includes(t.value.toUpperCase())) {
      pos++;
      const name = t.value.toUpperCase();
      if (name === 'NULL') return { kind: 'literal', value: null };
      // Fonction, CURRENT DATE, CASE... : pas une simple colonne
      if (peek()?.kind === 'lparen' || isReservedSqlWord(name, knownColumns)) {
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

  return (row: any) => evaluateCondition(condition, row);
}

function tokenizeWhere(clause: string): WhereToken[] {
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
    } else if ((m = rest.match(/^-?\s*\d+(?:\.\d+)?/)) && (m[0][0] !== '-' || tokens[tokens.length - 1]?.kind === 'op')) {
      // Un signe moins ne fait partie d'un littéral qu'après un opérateur de comparaison
      tokens.push({ kind: 'number', value: Number(m[0].replace(/\s+/g, '')) });
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

function evaluateCondition(cond: Condition, row: any): boolean {
  switch (cond.kind) {
    case 'or': return evaluateCondition(cond.left, row) || evaluateCondition(cond.right, row);
    case 'and': return evaluateCondition(cond.left, row) && evaluateCondition(cond.right, row);
    case 'not': return !evaluateCondition(cond.operand, row);
    case 'isNull': {
      const value = operandValue(cond.operand, row);
      const isNull = value === null || value === undefined;
      return cond.negated ? !isNull : isNull;
    }
    case 'compare':
      return compare(operandValue(cond.left, row), cond.op, operandValue(cond.right, row));
  }
}

function operandValue(operand: Operand, row: any): any {
  if (operand.kind === 'literal') return operand.value;
  const key = Object.keys(row).find(k => k.toUpperCase() === operand.name);
  return key === undefined ? null : row[key];
}

// Une comparaison avec NULL n'est jamais vraie. Un nombre comparé à une chaîne
// numérique est comparé numériquement ; les chaînes ignorent les blancs de fin.
function compare(left: any, op: string, right: any): boolean {
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
