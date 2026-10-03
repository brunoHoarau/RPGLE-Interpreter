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

// Fonction utilitaire pour charger le contexte depuis un dossier
export function loadContextFromFolder(folderPath: string): ExecutionContext {
  const fs = require('fs');
  const path = require('path');

  console.log('🔍 Tentative de chargement du contexte depuis :', folderPath);

  const context: ExecutionContext = {
    tables: {},
    files: {},
    programs: {}
  };

  const tablesPath = path.join(folderPath, 'tables.json');
  console.log('📄 Chemin recherché pour tables.json :', tablesPath);

  if (fs.existsSync(tablesPath)) {
    console.log('✅ Le fichier tables.json existe !');
    try {
      const rawContent = fs.readFileSync(tablesPath, 'utf8');
      console.log('📝 Contenu brut du fichier :\n', rawContent);
      
      const parsed = JSON.parse(rawContent);
      context.tables = normalizeTables(parsed);
      console.log('🎉 Tables chargées avec succès :', Object.keys(context.tables));
    } catch (err: any) {
      console.error('❌ Erreur lors de la lecture ou du parsing de tables.json :', err.message);
    }
  } else {
    console.warn('⚠️ Le fichier tables.json N\'EXISTE PAS à cet emplacement.');
  }

  return context;
}

// Normalise le format des tables (accepte plusieurs syntaxes)
function normalizeTables(raw: any): { [name: string]: TableDefinition } {
  const result: { [name: string]: TableDefinition } = {};

  for (const tableName in raw) {
    const table = raw[tableName];

    // Si l'utilisateur a fourni "schema" + "data"
    if (table.schema && table.data) {
      const columns: ColumnDefinition[] = [];
      for (const colName in table.schema) {
        columns.push({ name: colName.toUpperCase(), type: table.schema[colName] });
      }
      result[tableName.toUpperCase()] = { columns, data: table.data };
    }
    // Si l'utilisateur a fourni directement un tableau de lignes
    else if (Array.isArray(table)) {
      const columns: ColumnDefinition[] = [];
      if (table.length > 0) {
        for (const key of Object.keys(table[0])) {
          columns.push({ name: key.toUpperCase(), type: 'AUTO' });
        }
      }
      result[tableName.toUpperCase()] = { columns, data: table };
    }
  }

  return result;
}

// Contexte vide par défaut
export function emptyContext(): ExecutionContext {
  return { tables: {}, files: {}, programs: {} };
}