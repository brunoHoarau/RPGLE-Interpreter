// INSERT, UPDATE et DELETE.
import type { TableDefinition } from '../context';
import { NotSupportedError } from '../errors';
import { parseFieldType } from '../files';
import { checkColumns, checkDuplicates, checkUnique, columnNames, getTable, resultFor } from './support';
import { findClosingParen, findTopLevelWord, splitTopLevel } from './text';
import type { HostVariables, SQLResult } from './types';
import { compileValue } from './value';
import { compileWhere } from './where';

// Valeur par défaut IBM i d'une colonne omise dans INSERT (numériques : 0)
export const SQL_DEFAULTS: { [typeName: string]: any } = {
  char: '', varchar: '', ind: '0',
  date: '0001-01-01', time: '00.00.00', timestamp: '0001-01-01-00.00.00.000000',
};

// === INSERT ===
export function executeInsert(tables: { [name: string]: TableDefinition }, sql: string, hostVars: HostVariables): SQLResult {
  const match = sql.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(/i);
  if (!match) throw new NotSupportedError(`INSERT '${sql}'`);

  const table = getTable(tables, match[1]);
  const columns = match[2].split(',').map(c => c.trim().toUpperCase());
  const close = findClosingParen(sql, match[0].length);
  if (close < 0 || sql.slice(close + 1).trim() !== '') throw new NotSupportedError(`INSERT '${sql}'`);
  const values = splitTopLevel(sql.slice(match[0].length, close), ',')
    .map(v => compileValue(v, null)({}, hostVars));
  checkColumns(table, columns, match[1].toUpperCase());
  checkDuplicates(columns);
  if (values.length !== columns.length) {
    throw new Error(`INSERT : ${columns.length} colonnes pour ${values.length} valeurs`);
  }

  const newRow: any = {};
  // Colonne omise d'un type connu : valeur par défaut IBM i (blanc, zéro, '0', date/heure minimales)
  for (const column of table.columns) {
    const name = column.name.toUpperCase();
    if (columns.includes(name)) continue;
    const type = parseFieldType(column.type);
    if (type) newRow[name] = SQL_DEFAULTS[type.typeName] ?? 0;
  }
  columns.forEach((col, idx) => newRow[col] = values[idx]);
  checkUnique(table, match[1].toUpperCase(), [...table.data, newRow], new Set([newRow]));

  table.data.push(newRow);
  table.revision = (table.revision ?? 0) + 1;

  return { rows: [], rowCount: 1, sqlCode: 0, sqlState: '00000' };
}

// === UPDATE ===
export function executeUpdate(tables: { [name: string]: TableDefinition }, sql: string, hostVars: HostVariables): SQLResult {
  const head = sql.match(/^UPDATE\s+(\w+)\s+SET\s+/i);
  if (!head) throw new NotSupportedError(`UPDATE '${sql}'`);

  const table = getTable(tables, head[1]);
  const rest = sql.slice(head[0].length);
  const whereAt = findTopLevelWord(rest, 'WHERE');
  const setClause = whereAt < 0 ? rest : rest.slice(0, whereAt);
  const targets = whereAt < 0
    ? [...table.data]
    : table.data.filter(compileWhere(rest.slice(whereAt + 5), table, hostVars));
  const known = columnNames(table);
  const assignments = splitTopLevel(setClause, ',').map(assign => {
    const eq = splitTopLevel(assign, '=');
    // SET (a, b) = (...) : liste de colonnes
    if (/^\s*\(/.test(eq[0])) throw new NotSupportedError(`Clause SET '${assign.trim()}'`);
    if (eq.length !== 2 || !/^\s*\w+\s*$/.test(eq[0])) throw new Error(`Clause SET invalide : ${assign.trim()}`);
    const col = eq[0].trim().toUpperCase();
    checkColumns(table, [col], head[1].toUpperCase());
    return { col, value: compileValue(eq[1], known) };
  });
  checkDuplicates(assignments.map(a => a.col));
  if (targets.some(row => table.locks?.has(row))) {
    throw new NotSupportedError("UPDATE SQL d'un enregistrement verrouillé par une lecture native");
  }
  // Toutes les expressions lisent la ligne avant mise à jour ; rien n'est modifié si une clé unique serait en double
  const changes = new Map<any, any[]>();
  for (const row of targets) {
    const before = { ...row };
    changes.set(row, assignments.map(a => a.value(before, hostVars)));
  }
  const written = new Set<any>();
  const after = (row: any) => {
    const computed = changes.get(row);
    if (!computed) return row;
    const updated = { ...row };
    assignments.forEach((a, i) => { updated[a.col] = computed[i]; });
    written.add(updated);
    return updated;
  };
  checkUnique(table, head[1].toUpperCase(), table.data.map(after), written);
  for (const [row, computed] of changes) {
    assignments.forEach((a, i) => { row[a.col] = computed[i]; });
  }
  table.revision = (table.revision ?? 0) + 1;

  return resultFor([], targets.length);
}

// === DELETE ===
export function executeDelete(tables: { [name: string]: TableDefinition }, sql: string, hostVars: HostVariables): SQLResult {
  const match = sql.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) throw new NotSupportedError(`DELETE '${sql}'`);

  const table = getTable(tables, match[1]);
  const before = table.data.length;
  const locked = () => new NotSupportedError("DELETE SQL d'un enregistrement verrouillé par une lecture native");
  if (match[2]) {
    const matches = compileWhere(match[2], table, hostVars);
    if (table.data.some((row: any) => table.locks?.has(row) && matches(row))) throw locked();
    table.data = table.data.filter((row: any) => !matches(row));
  } else {
    if (table.data.some((row: any) => table.locks?.has(row))) throw locked();
    table.data = [];
  }
  if (table.data.length < before) table.deletedRows = true;
  table.revision = (table.revision ?? 0) + 1;

  return resultFor([], before - table.data.length);
}
