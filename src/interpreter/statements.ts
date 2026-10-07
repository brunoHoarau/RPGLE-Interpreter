import { describeType, describeValue, isDataStructure, sameDeclaredType } from '../datatypes';
import { isDateTimeType, isDuration } from '../datetime';
import { NotSupportedError, incompatibleTypes } from '../errors';
import { valueFor } from './declarations';
import { evaluate } from './evaluate/evaluate';
import { InterpreterState } from './state';

export function executeAssignment(s: InterpreterState, node: any): void {
  if (!node.variable.includes('.') && isDataStructure(s.runtime.lookup(node.variable))) return assignDataStructure(s, node);
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

// a = b entre deux DS de même disposition (mêmes types dans le même ordre, noms indifférents) : copie champ par champ.
// IBM i copie des octets : toute autre combinaison n'est pas simulée.
function assignDataStructure(s: InterpreterState, node: any): void {
  const target: string = node.variable;
  const source = node.value.valueType === 'identifier' ? String(node.value.value) : undefined;
  const refuse = (reason: string) => new NotSupportedError(`Affectation à la structure de données ${target.toUpperCase()} : ${reason} (copie d'octets non simulée)`);
  if (source === undefined || source.includes('.') || !isDataStructure(s.runtime.lookup(source))) {
    throw refuse("la valeur n'est pas une structure de données");
  }
  const to = s.runtime.getShape(target);
  const from = s.runtime.getShape(source);
  if (!to || !from) throw refuse(`disposition de ${(to ? source : target).toUpperCase()} inconnue`);
  const same = to.fields.length === from.fields.length && to.fields.every((f, i) => sameDeclaredType(f.type, from.fields[i].type));
  if (!same) throw refuse(`${source.toUpperCase()} n'a pas la même disposition (types des sous-zones)`);
  // Valeurs lues avant toute écriture, puis passage par la coercition normale de chaque sous-zone
  const values = from.fields.map(f => s.runtime.getField(source, f.name));
  to.fields.forEach((f, i) => s.runtime.setField(target, f.name, values[i]));
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
