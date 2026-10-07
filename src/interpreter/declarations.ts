import { ExpressionNode, DataTypeNode } from '../types';
import { checkAssignable, defaultValue, describeType } from '../datatypes';
import { fromClock, isDateTime, isDateTimeType, parseIso } from '../datetime';
import { NotSupportedError, incompatibleTypes } from '../errors';
import { refuseFileFieldName } from './files/declare';
import { evaluate } from './evaluate/evaluate';
import { InterpreterState } from './state';

export const isZeroOrBlank = (expr: ExpressionNode | undefined) =>
  expr?.valueType === 'special' && /^\*(zero|blank)s?$/.test(expr.value);

// Un bouchon JSON donne les dates, heures et timestamps en texte *ISO
export function fromMock(value: any, type: DataTypeNode | undefined, what: string): any {
  if (!type || !isDateTimeType(type.typeName) || value === undefined || value === null || isDateTime(value)) return value;
  if (typeof value !== 'string') {
    throw new Error(`${what} : la valeur ${type.typeName.toUpperCase()} doit être un texte *ISO, reçu ${value}`);
  }
  const parsed = parseIso(type.typeName, value);
  if (!parsed) throw new Error(`${what} : '${value}' n'est pas une valeur ${type.typeName.toUpperCase()} *ISO valide`);
  return parsed;
}

export function executeVariableDeclaration(s: InterpreterState, node: any): void {
  refuseFileFieldName(s, node.name, node.dataType);
  s.runtime.declareVariable(node.name, initialValue(s, node.initialValue, node.dataType, node.name), node.dataType);
}

// Valeur de INZ ; INZ(*SYS) et INZ(*JOB) lisent l'horloge (*JOB : date du jour, faute de travail IBM i)
export function initialValue(s: InterpreterState, expr: ExpressionNode | undefined, type: DataTypeNode, target: string): any {
  if (!expr) return defaultValue(type);
  if (expr.valueType === 'special' && (expr.value === '*sys' || expr.value === '*job') && isDateTimeType(type.typeName)) {
    return fromClock(type.typeName, s.runtime.now());
  }
  return valueFor(s, expr, type, target);
}

// Valeur d'une expression destinée à une cible typée, écrite dans le code RPG : *ZEROS et *BLANKS
// prennent la longueur de la cible, puis le type de la valeur est contrôlé comme le fait le compilateur IBM i
export function valueFor(s: InterpreterState, expr: ExpressionNode, type: DataTypeNode | undefined, target: string): any {
  let value: any;
  if (type && !isDateTimeType(type.typeName) && isZeroOrBlank(expr)) {
    value = zeroOrBlankFor(s, expr.value, type, target);
  } else {
    value = evaluate(s, expr);
  }
  checkAssignable(value, type, target, expr.valueType === 'string');
  return value;
}

export function zeroOrBlankFor(s: InterpreterState, name: string, type: DataTypeNode, target: string): any {
  const zeros = name.startsWith('*zero');
  switch (type.typeName) {
    case 'char': return (zeros ? '0' : ' ').repeat(type.length ?? 1);
    case 'int': case 'uns': case 'packed': case 'zoned':
      if (!zeros) throw incompatibleTypes(`Affectation de ${name.toUpperCase()} à ${target} ${describeType(type)}`);
      return 0;
    default:
      throw new NotSupportedError(`${name.toUpperCase()} affecté à ${target} ${describeType(type)}`);
  }
}

export function executeConstantDeclaration(s: InterpreterState, node: any): void {
  refuseFileFieldName(s, node.name);
  s.runtime.setConstant(node.name, evaluate(s, node.value));
}

export function executeDataStructure(s: InterpreterState, node: any): void {
  refuseFileFieldName(s, node.name);
  if (!node.isQualified) for (const field of node.fields) refuseFileFieldName(s, field.name, field.dataType);
  s.runtime.declareDataStructure(node.name, node.fields.map((field: any) => ({
    name: field.name,
    type: field.dataType,
    value: initialValue(s, field.initialValue, field.dataType, `${node.name}.${field.name}`),
  })), node.isQualified);
}
