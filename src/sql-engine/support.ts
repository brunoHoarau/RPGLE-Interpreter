// Table, colonnes, variables hôtes et résultat : contrôles communs aux instructions.
import type { TableDefinition } from '../context';
import { NotSupportedError } from '../errors';
import { parseFieldType } from '../files';
import type { HostVariables, SQLResult } from './types';
import { SqlError } from './types';

export function getTable(tables: { [name: string]: TableDefinition }, name: string): TableDefinition {
  const table = tables[name.toUpperCase()];
  if (!table) throw new Error(`Table '${name.toUpperCase()}' non définie`);
  return table;
}

// Table à clé unique ("unique" de tables.json) : deux lignes de même clé → SQLCOD -803 (rien n'est modifié)
export function checkUnique(table: TableDefinition, name: string, rows: any[], written: Set<any>): void {
  const keys = table.keys;
  if (!table.unique || !keys || keys.length === 0) return;
  const types = keys.map(key => {
    const column = table.columns.find(c => c.name.toUpperCase() === key);
    return column ? parseFieldType(column.type)?.typeName : undefined;
  });
  const valueOf = (row: any, key: string, i: number) => {
    const column = key in row ? key : Object.keys(row).find(c => c.toUpperCase() === key);
    const value = column === undefined ? undefined : row[column];
    const numeric = ['int', 'uns', 'packed', 'zoned'].includes(types[i] ?? '');
    if (typeof value === 'number') return Number(value.toPrecision(15));
    if (numeric && typeof value === 'string' && /^[+-]?\d+(\.\d+)?$/.test(value)) return Number(Number(value).toPrecision(15));
    if (typeof value === 'string') return value.trimEnd();
    return value === undefined || value === null ? value : String(value);
  };
  // Seules les lignes écrites par l'instruction sont contrôlées contre toutes les autres
  const count = new Map<string, number>();
  const keyOf = rows.map(row => JSON.stringify(keys.map((k, i) => valueOf(row, k, i))));
  for (const key of keyOf) count.set(key, (count.get(key) ?? 0) + 1);
  const at = rows.findIndex((row, i) => written.has(row) && count.get(keyOf[i])! > 1);
  if (at >= 0) {
    const shown = keys.map((k, i) => `${k} = ${String(valueOf(rows[at], k, i))}`).join(', ');
    throw new SqlError(`Clé en double dans la table ${name} (${shown})`, -803, '23505');
  }
}

export function resultFor(rows: any[], count: number): SQLResult {
  return count > 0
    ? { rows, rowCount: count, sqlCode: 0, sqlState: '00000' }
    : { rows, rowCount: 0, sqlCode: 100, sqlState: '02000' };
}

// Le Runtime stocke les variables en minuscules
export function getHostVariable(name: string, hostVars: HostVariables): any {
  const value = hostVars.get(name.toLowerCase());
  if (value === undefined) throw new Error(`Variable hôte non déclarée: :${name}`);
  // Les blancs de remplissage d'un char RPG ne font pas partie de la donnée ; ceux d'un VARCHAR en font partie
  if (typeof value !== 'string') return value;
  return hostVars.type?.(name)?.typeName === 'varchar' ? value : value.trimEnd();
}

export function columnNames(table: TableDefinition): Set<string> {
  const names = new Set<string>(table.columns.map(c => c.name.toUpperCase()));
  for (const row of table.data) {
    for (const key of Object.keys(row)) names.add(key.toUpperCase());
  }
  return names;
}

// Une colonne qui n'existe pas dans la table est une erreur SQL (table sans aucune colonne connue : pas de contrôle)
export function checkDuplicates(columns: string[]): void {
  const seen = new Set<string>();
  for (const col of columns) {
    if (seen.has(col)) throw new Error(`Colonne en double: ${col}`);
    seen.add(col);
  }
}

export function checkColumns(table: TableDefinition, columns: string[], tableName = ''): void {
  const known = columnNames(table);
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
