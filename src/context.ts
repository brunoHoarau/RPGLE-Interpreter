// Définit la structure du contexte fourni par l'utilisateur

import { parseFieldType } from './files';

export interface ColumnDefinition {
  name: string;
  type: string; // 'INT', 'CHAR(50)', 'DECIMAL(9,2)', etc.
}

export interface TableDefinition {
  columns: ColumnDefinition[];
  data: any[];
  keys?: string[];   // Clés du fichier logique/physique, en majuscules
  format?: string;   // Nom du format d'enregistrement, en majuscules
}

// Bouchon d'un programme ou d'une procédure externe (context/programs.json).
// Le premier cas dont toutes les conditions "when" correspondent est appliqué.
export interface MockCase {
  when?: { [parameter: string]: any };  // Valeurs attendues des paramètres
  set?: { [parameter: string]: any };   // Paramètres renvoyés à l'appelant
  return?: any;                         // Valeur de retour (EXTPROC avec type de retour)
  error?: string;                       // Simule un échec du programme appelé
}

export interface ProgramMock {
  calls: MockCase[];
}

export interface ExecutionContext {
  tables: { [tableName: string]: TableDefinition };
  programs: { [programName: string]: ProgramMock };
}

// Charge le contexte d'exécution (données simulées) depuis un dossier : tables.json, programs.json.
// Un dossier ou un fichier absent donne un contexte vide ; un fichier invalide est une erreur.
export function loadContextFromFolder(folderPath: string): ExecutionContext {
  const context = emptyContext();

  const tables = readJson(folderPath, 'tables.json');
  if (tables !== undefined) context.tables = normalizeTables(tables.content, tables.path);

  const programs = readJson(folderPath, 'programs.json');
  if (programs !== undefined) context.programs = normalizePrograms(programs.content, programs.path);

  return context;
}

function readJson(folderPath: string, fileName: string): { path: string; content: any } | undefined {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(folderPath, fileName);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return { path: filePath, content: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (err: any) {
    throw new Error(`Fichier ${filePath} invalide : ${err.message}`);
  }
}

// Les noms de programme sont indexés en majuscules, comme sur IBM i
function normalizePrograms(raw: any, sourcePath: string): { [name: string]: ProgramMock } {
  const result: { [name: string]: ProgramMock } = {};
  for (const name in raw) {
    const mock = raw[name];
    if (!mock || !Array.isArray(mock.calls)) {
      throw new Error(`Bouchon '${name}' de ${sourcePath} : une liste "calls" est attendue`);
    }
    result[name.toUpperCase()] = { calls: mock.calls };
  }
  return result;
}

// Normalise le format des tables : tableau de lignes, ou { schema, data }
function normalizeTables(raw: any, sourcePath: string): { [name: string]: TableDefinition } {
  const result: { [name: string]: TableDefinition } = {};

  for (const tableName in raw) {
    const table = raw[tableName];

    if (table && table.schema && Array.isArray(table.data)) {
      const columns: ColumnDefinition[] = [];
      for (const colName in table.schema) {
        const type = table.schema[colName];
        if (typeof type !== 'string' || parseFieldType(type) === undefined) {
          throw new Error(`Table '${tableName}' de ${sourcePath} : type '${type}' de la colonne ${colName} inconnu`);
        }
        columns.push({ name: colName.toUpperCase(), type });
      }
      const definition: TableDefinition = { columns, data: table.data };
      if (Array.isArray(table.keys)) {
        definition.keys = table.keys.map((key: any) => String(key).toUpperCase());
        for (const key of definition.keys!) {
          if (!columns.some(c => c.name === key)) {
            throw new Error(`Table '${tableName}' de ${sourcePath} : clé '${key}' absente du schéma`);
          }
        }
      }
      if (typeof table.format === 'string') definition.format = table.format.toUpperCase();
      result[tableName.toUpperCase()] = definition;
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
  return { tables: {}, programs: {} };
}