import { ExpressionNode } from '../../types';
import { describeValue, formatChar, isDataStructure } from '../../datatypes';
import { FigurativeValue, isDateTime, isDuration } from '../../datetime';
import { NotSupportedError, incompatibleTypes } from '../../errors';
import { DURATION_BUILTINS, WHOLE_NUMBER_BUILTINS, DATE_AWARE_BUILTINS, NOT_YET_DATE_BUILTINS } from './builtins';
import { FILE_BUILTINS, fileBuiltin } from '../files/builtins';
import { callProcedure, declaredType } from '../calls';
import { dataStructureAsValue } from '../statements';
import { executeOperator } from './operators';
import { InterpreterState } from '../state';

export function evaluate(s: InterpreterState, expr: ExpressionNode): any {
  if (expr.valueType === 'number') {
    return expr.value;
  }

  if (expr.valueType === 'string') {
    return expr.value;
  }

  if (expr.valueType === 'datetime') {
    return expr.value;
  }

  if (expr.valueType === 'special') {
    switch (expr.value) {
      case '*loval': case '*hival': return new FigurativeValue(expr.value);
      case '*on': return true;
      case '*off': return false;
      case '*zero': case '*zeros': return 0;
      case '*blank': case '*blanks': return '';
      default:
        // Indicateurs *INLR, *INxx ; les autres valeurs (*EXT, *JOBLOG) ne viennent que de DSPLY
        return /^\*in(lr|\d\d)$/.test(expr.value) ? s.runtime.getVariable(expr.value) : expr.value;
    }
  }

  if (expr.valueType === 'identifier') {
    // Gestion des structures de données qualifiées
    if (expr.value.includes('.')) {
        const [dsName, fieldName] = expr.value.split('.');
        if (!s.runtime.hasVariable(dsName)) {
            throw new Error(`Structure de données '${dsName}' non déclarée`);
        }
        return s.runtime.getField(dsName, fieldName);
    }

    if (s.runtime.hasVariable(expr.value)) {
        const value = s.runtime.getVariable(expr.value);
        if (isDataStructure(value)) throw dataStructureAsValue(s, expr.value);
        return value;
    }
    try {
        return s.runtime.getConstant(expr.value);
    } catch {
        throw new Error(`Variable non déclarée: ${expr.value}`);
    }
  }

  if (expr.valueType === 'call') {
    return callProcedure(s, expr.value.name, expr.value.args);
  }

  if (expr.valueType === 'builtin') {
    const builtin = expr.value.name.toLowerCase();
    if (FILE_BUILTINS.has(builtin)) return fileBuiltin(s, expr.value.name, expr.value.args);
    // %ERROR : résultat de la dernière opération avec extenseur (E), *OFF au départ
    if (builtin === '%error') {
      if (expr.value.args.length > 0) throw new Error(`%ERROR n'accepte pas d'argument`);
      return s.lastError;
    }
    const isChar = builtin === '%char';
    // Le 2e argument (*ISO) est un format, inutile à évaluer
    const args = (isChar ? expr.value.args.slice(0, 1) : expr.value.args).map((arg: ExpressionNode) => evaluate(s, arg));
    // L'argument d'une durée doit être un entier garanti, quelle que soit sa valeur
    if (DURATION_BUILTINS.has(builtin) && typeof args[0] === 'number' && !isWholeNumberExpression(s, expr.value.args[0])) {
      throw new Error(`${expr.value.name.toUpperCase()} d'une valeur qui peut avoir des décimales : pas encore supporté par l'interpréteur`);
    }
    // Aucune fonction intégrée ne prend une durée en argument
    const duration = args.find(isDuration);
    if (duration) throw incompatibleTypes(`${expr.value.name.toUpperCase()}(${describeValue(duration)})`);
    if (!isChar && !DATE_AWARE_BUILTINS.has(builtin)) refuseDateArguments(s, expr.value.name, args);
    if (isChar) {
      // %CHAR(x : *ISO) n'existe que pour une date, une heure ou un timestamp
      if (expr.value.args.length > 1 && !isDateTime(args[0])) {
        throw incompatibleTypes(`%CHAR(${describeValue(args[0])} : *ISO)`);
      }
      // Le format dépend du type déclaré : variable, ou valeur de retour d'une procédure
      return formatChar(args[0], declaredType(s, expr.value.args[0]));
    }
    return s.runtime.executeBuiltin(expr.value.name, args);
  }

  if (expr.operator) {
    return executeOperator(s, expr);
  }

  throw new Error(`Expression non supportée`);
}

// Vrai si l'expression est numérique sans décimales par construction (pas selon sa valeur)
export function isWholeNumberExpression(s: InterpreterState, expr: ExpressionNode | undefined): boolean {
  if (!expr) return false;
  if (expr.operator) {
    if (expr.operator === 'neg') return isWholeNumberExpression(s, expr.left);
    if (['+', '-', '*'].includes(expr.operator)) return isWholeNumberExpression(s, expr.left) && isWholeNumberExpression(s, expr.right);
    return false;
  }
  if (expr.valueType === 'number') return !expr.hasDecimalPoint;
  if (expr.valueType === 'builtin') return WHOLE_NUMBER_BUILTINS.has(expr.value.name.toLowerCase());
  const type = declaredType(s, expr);
  if (!type) return false;
  if (type.typeName === 'int' || type.typeName === 'uns') return true;
  return (type.typeName === 'packed' || type.typeName === 'zoned') && !type.decimals;
}

// Les autres fonctions intégrées ne savent pas traiter une date, une heure ou un timestamp
export function refuseDateArguments(s: InterpreterState, name: string, args: any[]): void {
  const date = args.find(isDateTime);
  if (!date) return;
  if (NOT_YET_DATE_BUILTINS.has(name.toLowerCase())) {
    throw new Error(`${name.toUpperCase()} d'une valeur ${date.kind.toUpperCase()} : pas encore supporté par l'interpréteur`);
  }
  throw incompatibleTypes(`${name.toUpperCase()}(${describeValue(date)})`);
}

// *ZEROS / *BLANKS face à une autre valeur : ils prennent sa nature (texte : blancs ou zéros à sa longueur)
export function zeroOrBlankLike(s: InterpreterState, name: string, other: any): any {
  const zeros = name.startsWith('*zero');
  if (typeof other === 'string') return zeros ? '0'.repeat(other.length) : '';
  if (typeof other === 'number') {
    if (!zeros) throw incompatibleTypes(`Comparaison de ${name.toUpperCase()} avec ${describeValue(other)}`);
    return 0;
  }
  if (typeof other === 'boolean') throw new NotSupportedError(`Comparaison de ${name.toUpperCase()} avec un indicateur`);
  return zeros ? 0 : '';
}
