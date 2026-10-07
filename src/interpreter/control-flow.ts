import { ASTNode, ExpressionNode } from '../types';
import { describeType, describeValue } from '../datatypes';
import { RpgError, incompatibleTypes, matchesStatus } from '../errors';
import { executeBlock } from './program';
import { valueFor } from './declarations';
import { evaluate } from './evaluate/evaluate';
import { InterpreterState } from './state';
import { LeaveSignal, IterSignal, ReturnSignal } from './signals';

// Exécute une itération ; renvoie false si la boucle doit s'arrêter (LEAVE)
export function runIteration(s: InterpreterState, body: ASTNode[]): boolean {
  if (++s.iterations > s.maxIterations) {
    throw new Error(`Limite de ${s.maxIterations} itérations atteinte (boucle infinie ?)`);
  }
  try {
    executeBlock(s, body);
  } catch (e) {
    if (e instanceof LeaveSignal) return false;
    if (e instanceof IterSignal) return true;
    throw e;
  }
  return true;
}

// Évalue une condition (IF, WHEN, DOW, DOU) : une date, une heure ou un timestamp n'est pas un indicateur
export function condition(s: InterpreterState, expr: ExpressionNode): any {
  const value = evaluate(s, expr);
  if (typeof value !== 'boolean') {
    throw incompatibleTypes(`Condition ${describeValue(value)}`);
  }
  return value;
}

export function executeIf(s: InterpreterState, node: any): void {
  if (condition(s, node.condition)) {
    executeBlock(s, node.thenBlock);
    return;
  }
  for (const elseIf of node.elseIfBlocks ?? []) {
    if (condition(s, elseIf.condition)) {
      executeBlock(s, elseIf.block);
      return;
    }
  }
  if (node.elseBlock) {
    executeBlock(s, node.elseBlock);
  }
}

export function executeSelect(s: InterpreterState, node: any): void {
  for (const when of node.whenBlocks) {
    if (condition(s, when.condition)) {
      executeBlock(s, when.block);
      return;
    }
  }
  if (node.otherBlock) {
    executeBlock(s, node.otherBlock);
  }
}

// Variable ou borne d'une boucle FOR : un nombre
export function numericBound(s: InterpreterState, expr: ExpressionNode, what: string): any {
  const value = evaluate(s, expr);
  if (typeof value !== 'number') {
    throw incompatibleTypes(`FOR, ${what} ${describeValue(value)}`);
  }
  return value;
}

export function executeLoop(s: InterpreterState, node: any): void {
  if (node.loopType === 'for') {
    // La variable de boucle est relue à chaque tour : le corps peut la modifier,
    // et elle vaut limite + pas en sortie de boucle, comme en RPG.
    const varName = node.variable;
    const loopType = s.runtime.getType(varName);
    if (loopType && !['int', 'uns', 'packed', 'zoned'].includes(loopType.typeName)) {
      throw incompatibleTypes(`FOR, variable ${varName} ${describeType(loopType)}`);
    }
    const limit = numericBound(s, node.limit, 'limite');
    const step = node.step ? numericBound(s, node.step, 'pas') : 1;
    const delta = node.direction === 'to' ? step : -step;
    const inRange = () => {
      const i = s.runtime.getVariable(varName);
      return node.direction === 'to' ? i <= limit : i >= limit;
    };

    s.runtime.setVariable(varName, numericBound(s, node.init, 'valeur initiale'));
    while (inRange()) {
      if (!runIteration(s, node.body)) return;
      s.runtime.setVariable(varName, s.runtime.getVariable(varName) + delta);
    }
  } else if (node.loopType === 'dow') {
    while (condition(s, node.condition)) {
      if (!runIteration(s, node.body)) return;
    }
  } else if (node.loopType === 'dou') {
    do {
      if (!runIteration(s, node.body)) return;
    } while (!condition(s, node.condition));
  }
}

export function executeReturn(s: InterpreterState, node: any): never {
  const returnType = s.returnTypes[s.returnTypes.length - 1];
  throw new ReturnSignal(node.value ? valueFor(s, node.value, returnType, 'valeur de retour') : undefined);
}

export function executeMonitor(s: InterpreterState, node: any): void {
  try {
    executeBlock(s, node.tryBlock);
  } catch (error) {
    // Les signaux LEAVE/ITER/RETURN et les erreurs de l'interpréteur ne sont pas des RpgError
    if (!(error instanceof RpgError)) throw error;
    const { status } = error;
    const handler = node.catchBlocks.find((c: any) => matchesStatus(c.errorCodes, status));
    if (!handler) throw error;
    s.runtime.status = status;
    s.runtime.addOutput(`[JOBLOG] ${error.message} - interceptée par MONITOR`);
    executeBlock(s, handler.block);
  }
}
