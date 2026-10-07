import { describeType, describeValue, isDataStructure } from '../datatypes';
import { isDateTimeType, isDuration } from '../datetime';
import { NotSupportedError, incompatibleTypes } from '../errors';
import { valueFor } from './declarations';
import { evaluate } from './evaluate/evaluate';
import { InterpreterState } from './state';

export function executeAssignment(s: InterpreterState, node: any): void {
  assignTo(s, node.variable, valueFor(s, node.value, s.runtime.getType(node.variable), node.variable));
}

export function assignTo(s: InterpreterState, variable: string, value: any): void {
  if (!variable.includes('.') && isDataStructure(s.runtime.lookup(variable))) throw dataStructureAsValue(s, variable);
  // Gestion des structures de données qualifiées
  if (variable.includes('.')) {
      const [dsName, fieldName] = variable.split('.');
      if (!s.runtime.hasVariable(dsName)) {
          throw new Error(`Structure de données '${dsName}' non déclarée`);
      }
      s.runtime.setField(dsName, fieldName, value);
  } else {
      s.runtime.setVariable(variable, value);
  }
}

export function dataStructureAsValue(s: InterpreterState, name: string): Error {
  return new NotSupportedError(`Structure de données ${name.toUpperCase()} utilisée comme valeur`);
}

export function executeDsply(s: InterpreterState, node: any): void {
  // DSPLY(E) : comme une opération de fichier avec (E), %ERROR à *OFF et %STATUS à 0 au départ
  if (node.hasErrorExtender) {
    s.runtime.status = 0;
    s.lastError = false;
  }
  let msg = '';
  if (node.message) {
    // Les blancs de fin d'un char sont invisibles à l'écran
    const value = evaluate(s, node.message);
    if (isDuration(value)) throw incompatibleTypes(`DSPLY ${describeValue(value)}`);
    msg = String(value).trimEnd();
  }

  let queueInfo = '';
  if (node.queue) {
    // File vide ou *BLANK : file par défaut, rien à afficher
    const queue = String(evaluate(s, node.queue)).trim();
    if (queue !== '' && !/^\*blanks?$/i.test(queue)) queueInfo = ` (File: ${queue})`;
  }
  s.runtime.addOutput(`[DSPLY] ${msg}${queueInfo}`);

  if (node.responseVar) {
    // La réponse simulée est un caractère : les autres types de variable ne sont pas pris en charge
    const responseType = s.runtime.getType(node.responseVar);
    if (responseType && responseType.typeName !== 'char' && responseType.typeName !== 'varchar') {
      throw new NotSupportedError(`Réponse de DSPLY dans une variable de type ${describeType(responseType)}`);
    }
    const simulatedResponse = 'Y'; 
    s.runtime.addOutput(`  -> (Simulé) Réponse '${simulatedResponse}' enregistrée dans la variable '${node.responseVar}'`);
    assignTo(s, node.responseVar, simulatedResponse);
  }
}

// 🆕 MÉTHODE SQL AJOUTÉE
export function executeSQL(s: InterpreterState, node: any): void {
  // Variables hôtes date/heure : les dates en SQL font l'objet d'un incrément à venir
  for (const [, name] of node.sql.matchAll(/:([A-Za-z_$#@][\w$#@]*(?:\.[\w$#@]+)?)/g)) {
    const type = s.runtime.getType(name);
    if (type && isDateTimeType(type.typeName)) {
      throw new Error(`Variable hôte :${name} de type ${type.typeName.toUpperCase()} dans EXEC SQL : pas encore supporté par l'interpréteur`);
    }
  }
  const result = s.runtime.executeSQL(node.sql);

  // Mettre à jour les variables RPG standard
  s.runtime.setVariable('SQLCOD', result.sqlCode);
  s.runtime.setVariable('SQLSTT', result.sqlState);

  if (result.sqlCode === 100) {
    s.runtime.addOutput(`[SQL] Aucune ligne trouvée (SQLCOD=100)`);
  } else if (result.sqlCode < 0) {
    s.runtime.addOutput(`[SQL] Erreur: SQLCOD=${result.sqlCode}${result.message ? ` - ${result.message}` : ''}`);
  } else {
    s.runtime.addOutput(`[SQL] Succès - ${result.rowCount} ligne(s) traitée(s)`);
  }
}
