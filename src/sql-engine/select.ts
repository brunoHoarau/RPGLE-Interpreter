// SELECT / SELECT INTO.
import type { TableDefinition } from '../context';
import { isDataStructure } from '../datatypes';
import { NotSupportedError } from '../errors';
import { isReservedSqlWord } from './reserved';
import { columnNames, getTable, resultFor } from './support';
import { HOST_NAME, findTopLevelWord, splitTopLevel } from './text';
import type { HostVariables, SQLResult } from './types';
import { SqlError } from './types';
import { compileWhere } from './where';

// === SELECT ===
export function executeSelect(tables: { [name: string]: TableDefinition }, sql: string, hostVars: HostVariables): SQLResult {
  // 1. Découpe : SELECT liste [INTO variables] FROM table [WHERE ...]
  const fromAt = findTopLevelWord(sql, 'FROM');
  if (fromAt < 0) throw new NotSupportedError('SELECT sans FROM');
  const intoAt = findTopLevelWord(sql, 'INTO');
  if (intoAt > fromAt) throw new NotSupportedError('INTO après FROM');
  const listText = sql.slice(6, intoAt < 0 ? fromAt : intoAt).trim();
  const intoText = intoAt < 0 ? '' : sql.slice(intoAt + 4, fromAt).trim();
  const after = sql.slice(fromAt + 4).trim().match(/^(\w+)\s*(.*)$/);
  if (!after) throw new NotSupportedError(`Clause FROM '${sql.slice(fromAt + 4).trim()}'`);
  const tail = after[2];
  if (tail !== '' && !/^WHERE\s/i.test(tail)) throw new NotSupportedError(`Clause SELECT '${tail}'`);

  // La liste ne contient que * ou des colonnes ; INTO que des variables hôtes sans indicateur
  const items = splitTopLevel(listText, ',').map(c => c.trim().toUpperCase());
  for (const item of items) {
    if (item !== '*' && !/^\w+$/.test(item)) throw new NotSupportedError(`Liste de SELECT '${item}'`);
  }
  if (items.includes('*') && items.length > 1) throw new NotSupportedError(`Liste de SELECT '${listText}'`);
  const targets = intoAt < 0 ? [] : splitTopLevel(intoText, ',').map(v => v.trim());
  for (const target of targets) {
    if (!target.startsWith(':') || !HOST_NAME.test(target.slice(1))) throw new NotSupportedError(`INTO '${target}'`);
    // IBM remplit les sous-champs d'une DS entière : non simulé
    if (isDataStructure(hostVars.get(target.slice(1).toLowerCase()))) throw new NotSupportedError(`INTO d'une structure de données entière '${target}'`);
  }

  // 2. Table et filtrage WHERE
  const table = getTable(tables, after[1]);
  const knownColumns = columnNames(table);
  // CURRENT_DATE & co ne sont pas des colonnes : registre spécial, non supporté
  for (const item of items) {
    if (item !== '*' && isReservedSqlWord(item, knownColumns)) throw new NotSupportedError(`Liste de SELECT '${item}'`);
  }
  let rows = [...table.data];
  if (tail !== '') {
    rows = rows.filter(compileWhere(tail.slice(5), table, hostVars));
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

    // Toutes les colonnes sont validées, puis les NULL repérés (SQLCOD -305), avant d'affecter quoi que ce soit
    const values = selectedColumns.map(targetCol => {
      const actualCol = Object.keys(firstRow).find(k => k.toUpperCase() === targetCol);
      if (actualCol === undefined) throw new Error(`Colonne inconnue: ${targetCol}`);
      return firstRow[actualCol];
    });
    const nullAt = values.findIndex(v => v === null || v === undefined);
    if (nullAt >= 0) {
      throw new SqlError(`Valeur NULL de ${selectedColumns[nullAt]} sans variable indicatrice`, -305, '22002');
    }
    targets.forEach((target, idx) => hostVars.set(target.slice(1).toLowerCase(), values[idx]));
  }

  return resultFor(rows, rows.length);
}
