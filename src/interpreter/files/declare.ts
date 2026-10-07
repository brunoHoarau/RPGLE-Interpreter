import { ProgramNode, ParameterNode, DataTypeNode, FileDeclarationNode } from '../../types';
import { NativeFile, parseFieldType } from '../../files';
import { TableDefinition } from '../../context';
import { defaultValue, describeType, sameDeclaredType } from '../../datatypes';
import { NotSupportedError, incompatibleTypes } from '../../errors';
import { fileState } from './operations';
import { findTable, tableFields } from './layout';
import { InterpreterState, FileState } from '../state';

// EXTDESC / EXTFILE : mêmes zones (noms et types écrits dans tables.json, ordre indifférent).
// Renvoie la première différence (zone de la description, puis zone en trop des données), ou undefined.
export function columnDifference(desc: TableDefinition, descName: string, data: TableDefinition, dataName: string): string | undefined {
  const typeOf = (t: TableDefinition, zone: string) => t.columns.find(c => c.name.toUpperCase() === zone)?.type;
  const normalized = (type: string) => String(type).replace(/\s+/g, '').toUpperCase();
  for (const column of desc.columns) {
    const zone = column.name.toUpperCase();
    const other = typeOf(data, zone);
    if (other === undefined) return `zone ${zone} (${column.type}) absente de ${dataName}`;
    if (normalized(column.type) !== normalized(other)) {
      return `zone ${zone} : ${other} dans ${dataName}, ${column.type} dans ${descName} (types comparés tels qu'écrits dans tables.json)`;
    }
  }
  const extra = data.columns.find(c => typeOf(desc, c.name.toUpperCase()) === undefined);
  return extra ? `zone ${extra.name.toUpperCase()} (${extra.type}) absente de ${descName}` : undefined;
}


// Au niveau du programme, un nom de zone de fichier ne peut pas être redéclaré (une procédure peut le masquer).
// Une variable de même type est valide sur IBM i (elle partage la zone) mais n'est pas simulée ;
// une structure de données ou une constante de même nom est un doublon refusé par le compilateur.
export function refuseFileFieldName(s: InterpreterState, name: string, type?: DataTypeNode, what = 'Variable'): void {
  if (s.runtime.callDepth > 0) return;
  const field = s.fileFields.get(String(name).toLowerCase());
  if (!field) return;
  if (type) refuseSameNameAsField(s, String(name).toUpperCase(), type, field.type, field.file, what);
  throw new Error(`${String(name).toUpperCase()} est déjà déclaré (zone du fichier ${field.file})`);
}

export function refuseSameNameAsField(s: InterpreterState, name: string, type: DataTypeNode, fieldType: DataTypeNode, file: string, what: string): never {
  if (!sameDeclaredType(fieldType, type)) {
    throw incompatibleTypes(`${what} ${name} ${describeType(type)} déclarée comme zone de fichier ${describeType(fieldType)}`);
  }
  throw new NotSupportedError(`${what} ${name} : ${name} porte le nom d'une zone du fichier ${file}`);
}

export function declareFile(s: InterpreterState, node: FileDeclarationNode, parameters: ParameterNode[]): void {
  const name = node.name.toUpperCase();
  // Table de description (EXTDESC, sinon le nom du fichier) : zones, types, format (compilation).
  // Table de données (EXTFILE, *EXTDESC : celle de la description, sinon le nom du fichier) : lignes, verrous,
  // révision, clés et unicité (chemin d'accès du fichier ouvert). Si les deux diffèrent, zones (ordre compris),
  // clés et unicité doivent être identiques. La bibliothèque d'EXTFILE / EXTDESC est retirée par l'analyse.
  const descName = node.extdesc ?? name;
  const dataName = node.extfile === '*EXTDESC' ? descName : (node.extfile ?? name);
  const description = findTable(s, descName);
  const table = findTable(s, dataName);
  if (description.columns.some(c => c.type === 'AUTO')) {
    throw new Error(`Fichier ${descName} : décrivez ses zones dans "schema" de context/tables.json`);
  }
  if (dataName !== descName) {
    const difference = columnDifference(description, descName, table, dataName);
    if (difference) {
      throw new Error(`Fichier ${name} : les zones de ${dataName} diffèrent de celles de ${descName} (${difference})`);
    }
    // Ordre des zones : il change l'identificateur de niveau du format (CPF4131 à l'ouverture)
    const order = (t: TableDefinition) => t.columns.map(c => c.name.toUpperCase()).join(', ');
    if (order(description) !== order(table)) {
      throw new Error(`Fichier ${name} : ordre des zones différent (${order(table)} dans ${dataName}, ${order(description)} `
        + `dans ${descName}) : vérification de niveau CPF4131 à l'ouverture sur IBM i`);
    }
    // Nom du format : il fait partie de l'identificateur de niveau (CPF4131 à l'ouverture)
    const formatOf = (t: TableDefinition, tableName: string) => (t.format ?? tableName + 'F').toUpperCase();
    if (formatOf(description, descName) !== formatOf(table, dataName)) {
      throw new Error(`Fichier ${name} : nom de format différent (${formatOf(table, dataName)} dans ${dataName}, `
        + `${formatOf(description, descName)} dans ${descName}) : vérification de niveau CPF4131 à l'ouverture sur IBM i`);
    }
    // Clés et unicité ne font pas partie du niveau : IBM i ouvre le chemin d'accès de la table de données.
    // Sans KEYED, elles viennent de la table de données ; avec KEYED, le programme est compilé sur les clés
    // d'EXTDESC et exécuté sur celles d'EXTFILE : non simulé.
    if (node.keyed) {
      const keys = (t: TableDefinition) => (t.keys ?? []).map(k => k.toUpperCase()).join(', ');
      if (keys(description) !== keys(table)) {
        throw new NotSupportedError(`Fichier ${name} KEYED : clés différentes (${keys(table) || 'aucune'} dans ${dataName}, `
          + `${keys(description) || 'aucune'} dans ${descName})`);
      }
      if (!!description.unique !== !!table.unique) {
        const unique = (t: TableDefinition) => t.unique ? 'unique' : 'non unique';
        throw new NotSupportedError(`Fichier ${name} KEYED : unicité des clés différente (${unique(table)} dans ${dataName}, `
          + `${unique(description)} dans ${descName})`);
      }
    }
  }
  if (node.keyed && !(table.keys && table.keys.length > 0)) {
    throw new Error(`Fichier ${name} déclaré KEYED sans "keys" dans context/tables.json`);
  }
  const fields = tableFields(description, descName);
  let format = (description.format ?? descName + 'F').toUpperCase();
  // RENAME : le premier argument doit être le format réel ; l'ancien nom n'est plus reconnu
  if (node.rename) {
    if (node.rename.from !== format) {
      throw new Error(`Fichier ${name} : RENAME(${node.rename.from}) ne désigne pas le format ${format}`);
    }
    format = node.rename.to;
  }
  // Le compilateur exige un nom de format différent du nom du fichier
  if (format === name) {
    throw new Error(`Fichier ${name} : le format porte le nom du fichier (${format}) : RENAME nécessaire`);
  }
  // PREFIX(texte : n) : les n premiers caractères du nom de zone sont remplacés par le texte
  const variables = new Map<string, string>();
  for (const field of fields) {
    const count = node.prefix?.count ?? 0;
    if (count > field.name.length) {
      throw new NotSupportedError(`Fichier ${name} : PREFIX(${node.prefix!.text}:${count}) plus long que le nom de la zone ${field.name}`);
    }
    const variable = node.prefix ? node.prefix.text + field.name.slice(count) : field.name;
    if (node.prefix && !/^[A-Z_$#@][A-Z0-9_$#@]*$/.test(variable)) {
      throw new Error(`Fichier ${name} : PREFIX donne à la zone ${field.name} le nom ${variable}, qui n'est pas un nom RPG valide`);
    }
    const twin = [...variables].find(([, v]) => v === variable);
    if (twin) throw new Error(`Fichier ${name} : PREFIX donne le même nom ${variable} aux zones ${twin[0]} et ${field.name}`);
    variables.set(field.name, variable);
  }
  // Sur IBM i, les noms de fichiers et de formats d'un programme sont distincts : RENAME nécessaire
  for (const used of new Set([name, format])) {
    const other = s.files.get(used);
    if (other) {
      throw new Error(`Fichier ${name} : le nom ${used} est déjà utilisé par le fichier ${other.file.name}`
        + (used === format ? ` (format ${format} : RENAME nécessaire)` : ''));
    }
  }
  // Le moteur SQL remplace table.data à chaque DELETE : la source est relue à chaque opération
  // Seul le moteur SQL modifie les données pendant l'exécution : il incrémente table.revision
  // Les écritures natives font avancer la revision (changed) ; les verrous sont partagés par toutes les ouvertures
  table.locks ??= new WeakMap();
  const file = new NativeFile(name, format, fields, node.keyed ? table.keys! : [], () => table.data,
    { rowsDeleted: () => table.deletedRows === true, revision: () => table.revision ?? 0,
      updatable: node.usage.update || node.usage.delete, uniqueKeys: table.unique ? table.keys : undefined,
      locks: table.locks as WeakMap<object, NativeFile>, changed: () => { table.revision = (table.revision ?? 0) + 1; } });
  const duplicate = file.duplicateKey();
  if (duplicate) {
    const shown = Object.entries(duplicate).map(([zone, value]) => `${zone} = ${typeof value === 'string' ? `'${value}'` : String(value)}`);
    throw new Error(`Fichier ${name} : clé en double dans tables.json (${shown.join(', ')})`);
  }
  const state: FileState = { file, open: !node.usropn, eof: false, found: false, equal: false, usage: node.usage, table, variables };
  s.files.set(name, state);
  s.files.set(format, state);

  for (const field of fields) {
    const variable = variables.get(field.name)!;
    const key = variable.toLowerCase();
    const existing = s.fileFields.get(key);
    if (existing) {
      if (!sameDeclaredType(existing.type, field.type)) {
        throw incompatibleTypes(`Zone ${variable} du fichier ${name} ${describeType(field.type)} déjà déclarée par un autre fichier ${describeType(existing.type)}`);
      }
      continue;
    }
    const parameter = parameters.find(p => p.name.toLowerCase() === key);
    if (parameter) refuseSameNameAsField(s, variable, parameter.dataType, field.type, name, 'Paramètre');
    s.fileFields.set(key, { type: field.type, file: name });
    s.runtime.declareVariable(variable, defaultValue(field.type), field.type);
  }
}

// Le nom de format de chaque DCL-F (renommé ou non) ne doit pas être déjà un nom du programme. Fichiers et formats
// sont contrôlés à la déclaration ; ici les zones de tous les fichiers (après PREFIX), les paramètres et les déclarations globales
// (variables, constantes, structures de données et sous-zones d'une structure non qualifiée).
export function checkRenamedFormats(s: InterpreterState, ast: ProgramNode, parameters: ParameterNode[]): void {
  const names = new Map<string, string>();
  for (const p of parameters) names.set(p.name.toUpperCase(), 'paramètre');
  for (const node of ast.body as any[]) {
    if (node.type === 'VariableDeclaration') names.set(String(node.name).toUpperCase(), 'variable');
    else if (node.type === 'ConstantDeclaration') names.set(String(node.name).toUpperCase(), 'constante');
    else if (node.type === 'DataStructure') {
      names.set(String(node.name).toUpperCase(), 'structure de données');
      if (!node.isQualified) {
        for (const field of node.fields ?? []) names.set(String(field.name).toUpperCase(), `sous-zone de la structure ${String(node.name).toUpperCase()}`);
      }
    }
  }
  for (const declaration of ast.files ?? []) {
    const format = fileState(s, declaration.name).file.format;
    const field = s.fileFields.get(format.toLowerCase());
    const what = field ? `zone du fichier ${field.file}` : names.get(format);
    if (what) {
      const rename = declaration.rename ? `RENAME(${declaration.rename.from}:${format}) : ` : '';
      throw new Error(`Fichier ${declaration.name.toUpperCase()} : ${rename}le nom du format ${format} est déjà utilisé (${what})`
        + (declaration.rename ? '' : ' : RENAME nécessaire'));
    }
  }
}
