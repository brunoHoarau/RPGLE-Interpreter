// Définit la structure du contexte fourni par l'utilisateur

export interface ColumnDefinition {
  name: string;
  type: string; // 'INT', 'CHAR(50)', 'DECIMAL(9,2)', etc.
}

export interface TableDefinition {
  columns: ColumnDefinition[];
  data: any[];
}

export interface FileDefinition {
  records: any[];
  keyFields?: string[];
}

export interface ProgramMock {
  parameters?: { name: string; type: string }[];
  returnValue?: any;
  sideEffects?: { variable: string; value: any }[];
}

export interface ExecutionContext {
  tables: { [tableName: string]: TableDefinition };
  files: { [fileName: string]: FileDefinition };
  programs: { [programName: string]: ProgramMock };
}

// Charge le contexte d'exécution (données simulées) depuis un dossier.
// Un dossier ou un tables.json absent donne un contexte vide ; un fichier invalide est une erreur.
export function loadContextFromFolder(folderPath: string): ExecutionContext {
  const fs = require('fs');
  const path = require('path');

  const context = emptyContext();
  const tablesPath = path.join(folderPath, 'tables.json');
  if (!fs.existsSync(tablesPath)) return context;

  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(tablesPath, 'utf8'));
  } catch (err: any) {
    throw new Error(`Fichier ${tablesPath} invalide : ${err.message}`);
  }
  context.tables = normalizeTables(parsed, tablesPath);
  return context;
}

// Normalise le format des tables : tableau de lignes, ou { schema, data }
function normalizeTables(raw: any, sourcePath: string): { [name: string]: TableDefinition } {
  const result: { [name: string]: TableDefinition } = {};

  for (const tableName in raw) {
    const table = raw[tableName];

    if (table && table.schema && Array.isArray(table.data)) {
      const columns: ColumnDefinition[] = [];
      for (const colName in table.schema) {
        columns.push({ name: colName.toUpperCase(), type: table.schema[colName] });
      }
      result[tableName.toUpperCase()] = { columns, data: table.data };
    } else if (Array.isArray(table)) {
      const columns: ColumnDefinition[] = table.length > 0
        ? Object.keys(table[0]).map(key => ({ name: key.toUpperCase(), type: 'AUTO' }))
        : [];
      result[tableName.toUpperCase()] = { columns, data: table };
    } else {
      throw new Error(`Table '${tableName}' de ${sourcePath} : un tableau de lignes ou { "schema", "data" } est attendu`);
    }
  }

  return result;
}

// Contexte vide par défaut
export function emptyContext(): ExecutionContext {
  return { tables: {}, files: {}, programs: {} };
}