import { DataTypeNode, DsLike } from '../../types';
import { parseFieldType } from '../../files';
import { TableDefinition } from '../../context';
import { DsOrigin } from '../../ds-shape';
import { InterpreterState } from '../state';

// Zones d'un format ou d'une table : noms (en majuscules, après PREFIX pour un fichier déclaré) et types
export interface FieldLayout {
  name: string;
  type: DataTypeNode;
}

export interface FormatLayout {
  fields: FieldLayout[];
  origin: DsOrigin;
}

export function findTable(s: InterpreterState, tableName: string): TableDefinition {
  const key = Object.keys(s.context.tables).find(n => n.toUpperCase() === tableName);
  if (key === undefined) throw new Error(`Fichier ${tableName} absent de context/tables.json`);
  return s.context.tables[key];
}

// Zones d'une table décrite dans tables.json (types lus comme pour DCL-F)
export function tableFields(table: TableDefinition, tableName: string): FieldLayout[] {
  if (table.columns.some(c => c.type === 'AUTO')) {
    throw new Error(`Fichier ${tableName} : décrivez ses zones dans "schema" de context/tables.json`);
  }
  return table.columns.map(col => {
    const type = parseFieldType(col.type);
    if (!type) throw new Error(`Fichier ${tableName} : type '${col.type}' de la zone ${col.name} inconnu`);
    return { name: col.name.toUpperCase(), type };
  });
}

// Pour un fichier physique ou logique, *ALL, *INPUT et *OUTPUT donnent toutes les zones ; *KEY les zones de clé dans l'ordre de la clé
function select(fields: FieldLayout[], keys: string[], usage: DsLike['usage'], what: string, keyed: string): FieldLayout[] {
  if (usage !== 'key') return fields;
  if (keys.length === 0) throw new Error(`${what} : type d'extraction *KEY impossible, ${keyed}`);
  return keys.map(key => fields.find(f => f.name === key.toUpperCase())!);
}

// LIKEREC(format {: usage}) : zones du format d'un DCL-F du programme, sous leurs noms de programme (PREFIX)
export function formatLayout(s: InterpreterState, format: string, usage: DsLike['usage']): FormatLayout {
  const state = s.files.get(format);
  if (!state || state.file.format !== format) {
    throw new Error(`LIKEREC(${format}) : ${format} n'est pas le format d'un fichier déclaré par DCL-F`);
  }
  const program = (zone: string) => state.variables.get(zone) ?? zone;
  const fields = state.file.fields.map(f => ({ name: program(f.name), type: f.type }));
  const keys = state.file.keys.map(program);
  return {
    fields: select(fields, keys, usage, `LIKEREC(${format})`, `le fichier ${state.file.name} n'est pas déclaré KEYED`),
    origin: { table: state.file.name, format, usage, via: 'likerec' },
  };
}

// EXTNAME(table {: format} {: usage}) : zones de la table de tables.json, sans PREFIX
export function tableLayout(s: InterpreterState, tableName: string, format: string | undefined, usage: DsLike['usage']): FormatLayout {
  const table = findTable(s, tableName);
  const real = (table.format ?? tableName + 'F').toUpperCase();
  if (format !== undefined && format !== real) {
    throw new Error(`EXTNAME('${tableName}') : le format ${format} n'est pas celui de la table (${real})`);
  }
  const fields = tableFields(table, tableName);
  return {
    fields: select(fields, table.keys ?? [], usage, `EXTNAME('${tableName}')`, `la table ${tableName} n'a pas de "keys" dans context/tables.json`),
    origin: { table: tableName, format: real, usage, via: 'extname' },
  };
}
