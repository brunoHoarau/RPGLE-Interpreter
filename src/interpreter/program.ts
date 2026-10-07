import { ASTNode, ProgramNode, FileOperationNode } from '../types';
import { describeValue } from '../datatypes';
import { isDateTimeType, kindOf } from '../datetime';
import { executeVariableDeclaration, executeConstantDeclaration, executeDataStructure } from './declarations';
import { declareFile, checkRenamedFormats } from './files/declare';
import { executeFileOperation } from './files/operations';
import { checkFileChanges } from './files/changes';
import { executeAssignment, executeDsply, executeSQL } from './statements';
import { executeIf, executeSelect, executeLoop, executeReturn, executeMonitor } from './control-flow';
import { executeProcedureCall } from './calls';
import { InterpreterState } from './state';
import { LeaveSignal, IterSignal, ReturnSignal, LeaveSrSignal } from './signals';
import { splitSubroutines, executeSubroutine } from './subroutines';

// Exécute un programme avec ses paramètres d'entrée ; renvoie leurs valeurs finales
export function runProgram(s: InterpreterState, ast: ProgramNode, args: any[]): any[] {
  s.runtime.reset();
  s.runtime.clearOutput();
  s.iterations = 0;
  s.procedures.clear();
  s.prototypes.clear();
  s.files.clear();
  s.fileFields.clear();
  s.lastIndicators = { eof: false, found: false, equal: false };
  s.lastError = false;

  // Déclarer SQLCOD et SQLSTT par défaut
  s.runtime.declareVariable('SQLCOD', 0, { type: 'DataType', typeName: 'int', length: 10 });
  s.runtime.declareVariable('SQLSTT', '00000', { type: 'DataType', typeName: 'char', length: 5 });

  // Indicateurs *INLR et *IN01 à *IN99
  const ind = { type: 'DataType' as const, typeName: 'ind' };
  s.runtime.declareVariable('*inlr', false, ind);
  for (let i = 1; i <= 99; i++) {
    s.runtime.declareVariable(`*in${String(i).padStart(2, '0')}`, false, ind);
  }

  // Paramètres d'entrée du programme (dcl-pi principal), passés par l'appelant
  const parameters = ast.parameters ?? [];
  parameters.forEach((p, i) => {
    const type = p.dataType.typeName;
    // Sur IBM i les octets d'un autre type seraient réinterprétés comme une date
    if (isDateTimeType(type) && args[i] !== undefined && kindOf(args[i]) !== type) {
      throw new Error(`Paramètre ${p.name} : passage d'une valeur ${describeValue(args[i])} à un paramètre ${type.toUpperCase()} : `
        + `pas encore supporté par l'interpréteur`);
    }
    s.runtime.declareVariable(p.name, args[i], p.dataType);
    if (p.isConst) s.runtime.markReadOnly(p.name);
  });

  // Fichiers : avant les autres déclarations, leurs zones sont des variables globales
  for (const declaration of ast.files ?? []) declareFile(s, declaration, parameters);
  checkRenamedFormats(s, ast, parameters);
  if ((ast.files ?? []).length > 0) checkFileChanges(s, ast.body);

  // Première passe : déclarer variables, constantes, procédures
  for (const node of ast.body) {
    if (node.type === 'VariableDeclaration') {
      executeVariableDeclaration(s, node as any);
    } else if (node.type === 'ConstantDeclaration') {
      executeConstantDeclaration(s, node as any);
    } else if (node.type === 'DataStructure') {
      executeDataStructure(s, node as any);
    } else if (node.type === 'Procedure') {
      s.procedures.set(node.name.toLowerCase(), node);
    } else if (node.type === 'Prototype') {
      s.prototypes.set(node.name.toLowerCase(), node);
    }
  }

  // Deuxième passe : exécuter le code (les verrous de ce programme sont libérés à sa fin)
  const { mainline, subs } = splitSubroutines(ast.body);
  s.subroutines.push(subs);
  try {
    if (subs.has('*inzsr')) executeSubroutine(s, '*inzsr');
    for (const node of mainline) {
      if (node.type !== 'VariableDeclaration' &&
          node.type !== 'ConstantDeclaration' &&
          node.type !== 'DataStructure' &&
          node.type !== 'Procedure') {
        executeNode(s, node);
      }
    }
  } catch (e) {
    if (e instanceof LeaveSignal) throw new Error('LEAVE en dehors d\'une boucle');
    if (e instanceof IterSignal) throw new Error('ITER en dehors d\'une boucle');
    if (!(e instanceof ReturnSignal)) throw e;
  } finally {
    s.subroutines.pop();
    for (const state of s.files.values()) state.file.release();
  }

  return parameters.map(p => s.runtime.lookup(p.name));
}

export function executeBlock(s: InterpreterState, statements: ASTNode[]): void {
  for (const stmt of statements) {
    executeNode(s, stmt);
  }
}

export function executeNode(s: InterpreterState, node: ASTNode): any {
  switch (node.type) {
    case 'Assignment':
      return executeAssignment(s, node as any);
    case 'IfStatement':
      return executeIf(s, node as any);
    case 'SelectStatement':
      return executeSelect(s, node as any);
    case 'LoopStatement':
      return executeLoop(s, node as any);
    case 'ProcedureCall':
      return executeProcedureCall(s, node as any);
    case 'Return':
      return executeReturn(s, node as any);
    case 'Monitor':
      return executeMonitor(s, node as any);
    case 'DataStructure':
      return executeDataStructure(s, node as any);
    case 'VariableDeclaration':
      return executeVariableDeclaration(s, node as any);
    case 'ConstantDeclaration':
      return executeConstantDeclaration(s, node as any);
    case 'FileOperation':
      return executeFileOperation(s, node as FileOperationNode);
    case 'Dsply':
      return executeDsply(s, node as any);
    case 'SQL':
      return executeSQL(s, node as any);
    case 'Prototype':
      // Prototype local à une procédure
      s.prototypes.set(node.name.toLowerCase(), node);
      return;
    case 'Exsr':
      return executeSubroutine(s, (node as any).name);
    case 'Leavesr':
      throw new LeaveSrSignal();
    case 'Leave':
      throw new LeaveSignal();
    case 'Iter':
      throw new IterSignal();
    default:
      return;
  }
}
