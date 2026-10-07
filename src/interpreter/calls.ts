import { ProgramNode, ExpressionNode, PrototypeNode, ParameterNode, DataTypeNode } from '../types';
import { MockCase } from '../context';
import { coerce, describeType, sameDeclaredType } from '../datatypes';
import { isDateTime } from '../datetime';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { RpgError, STATUS_CALL_FAILED, STATUS_CALL_NOT_FOUND, incompatibleTypes } from '../errors';
import { fromMock, valueFor } from './declarations';
import { runProgram, executeBlock } from './program';
import { assignTo } from './statements';
import { DEFAULT_MAX_CALL_DEPTH, InterpreterState } from './state';
import { splitSubroutines } from './subroutines';
import { LeaveSignal, IterSignal, ReturnSignal } from './signals';

// Appelle une procédure utilisateur, sinon une procédure du runtime.
// Les arguments restent des expressions : un paramètre passé par référence
// (ni CONST ni VALUE) dont l'argument est une variable est recopié chez l'appelant.
export function callProcedure(s: InterpreterState, name: string, argExprs: ExpressionNode[]): any {
  const proc = s.procedures.get(name.toLowerCase());
  if (!proc) {
    // Pas de procédure interne : programme ou procédure externe déclaré par dcl-pr
    const prototype = s.prototypes.get(name.toLowerCase());
    if (prototype) return callExternal(s, prototype, argExprs);
    throw new Error(`Procédure non trouvée: ${name}`);
  }

  const params = proc.parameters;
  checkArgumentCount(s, proc.name, params, argExprs.length);
  checkReferenceArguments(s, params, argExprs);
  if (s.runtime.callDepth >= s.maxCallDepth) {
    throw new Error(`Profondeur de récursion maximale (${s.maxCallDepth}) atteinte dans ${proc.name}`);
  }

  const args = argExprs.map((arg, i) => valueFor(s, arg, params[i].dataType, params[i].name));
  const byReference = params.map((p, i) =>
    i < argExprs.length && !p.isConst && !p.byValue && argExprs[i].valueType === 'identifier');

  let returnValue: any;
  const outValues: any[] = [];
  const { mainline, subs } = splitSubroutines(proc.body);
  s.subroutines.push(subs);
  s.runtime.pushFrame(proc.name);
  s.returnTypes.push(proc.returnType);
  try {
    params.forEach((p, i) => {
      s.runtime.declareVariable(p.name, args[i], p.dataType);
      if (p.isConst) s.runtime.markReadOnly(p.name);
    });
    try {
      executeBlock(s, mainline);
    } catch (e) {
      if (e instanceof LeaveSignal) throw new Error(`LEAVE en dehors d'une boucle dans ${proc.name}`);
      if (e instanceof IterSignal) throw new Error(`ITER en dehors d'une boucle dans ${proc.name}`);
      if (!(e instanceof ReturnSignal)) throw e;
      returnValue = coerce(e.value, proc.returnType, proc.name);
    }
    params.forEach((p, i) => {
      if (byReference[i]) outValues[i] = s.runtime.getVariable(p.name);
    });
  } finally {
    s.subroutines.pop();
    s.returnTypes.pop();
    s.runtime.popFrame();
  }

  byReference.forEach((isRef, i) => {
    if (isRef) assignTo(s, argExprs[i].value, outValues[i]);
  });
  return returnValue;
}

export function declaredType(s: InterpreterState, expr: ExpressionNode | undefined): DataTypeNode | undefined {
  if (expr?.valueType === 'identifier') return s.runtime.getType(expr.value);
  if (expr?.valueType === 'call') {
    const name = expr.value.name.toLowerCase();
    return (s.procedures.get(name) ?? s.prototypes.get(name))?.returnType;
  }
  return undefined;
}

// Un paramètre par référence (ni CONST ni VALUE) exige une variable modifiable du même type exact : le compilateur
// IBM i refuse un littéral, une expression, une constante, un paramètre CONST ou une variable d'un autre type
export function checkReferenceArguments(s: InterpreterState, params: ParameterNode[], argExprs: ExpressionNode[]): void {
  argExprs.forEach((arg, i) => {
    const param = params[i];
    if (!param || param.isConst || param.byValue) return;
    const what = `passée à un paramètre modifiable ${param.name}`;
    if (arg.valueType !== 'identifier') {
      // Un indicateur *INxx est une variable : l'évaluation le traite comme avant
      if (arg.valueType === 'special' && /^\*in(lr|\d\d)$/.test(arg.value)) return;
      throw incompatibleTypes(`Valeur ou expression ${what}`);
    }
    const name = String(arg.value);
    const owner = name.split('.')[0]; // d.x : la structure de données porte le nom visible
    if (!s.runtime.hasVariable(owner)) {
      try {
        s.runtime.getConstant(name);
      } catch {
        return; // Ni variable ni constante : l'évaluation signalera l'erreur
      }
      throw incompatibleTypes(`Constante ${name} ${what}`);
    }
    if (s.runtime.isReadOnly(owner)) throw incompatibleTypes(`Paramètre CONST ${name} ${what}`);
    const declared = s.runtime.getType(name);
    if (declared && !sameDeclaredType(declared, param.dataType)) {
      throw incompatibleTypes(`Variable ${name} ${describeType(declared)} ${what} ${describeType(param.dataType)}`);
    }
  });
}

export function checkArgumentCount(s: InterpreterState, name: string, params: ParameterNode[], count: number): void {
  const required = params.filter(p => !p.options.includes('*nopass')).length;
  if (count < required || count > params.length) {
    const expected = required === params.length ? `${required}` : `${required} à ${params.length}`;
    throw new Error(`Nombre de paramètres incorrect pour ${name} : ${count} reçu(s), ${expected} attendu(s)`);
  }
}

// Appel d'un programme (EXTPGM) ou d'une procédure externe, simulé par le bouchon
// de context/programs.json. Sans bouchon : erreur 00211, comme un programme introuvable.
export function callExternal(s: InterpreterState, proto: PrototypeNode, argExprs: ExpressionNode[]): any {
  const target = proto.externalName.toUpperCase();
  const what = proto.kind === 'program' ? 'Programme' : 'Procédure externe';
  checkArgumentCount(s, proto.name, proto.parameters, argExprs.length);
  checkReferenceArguments(s, proto.parameters, argExprs);

  const args = argExprs.map((arg, i) => coerce(valueFor(s, arg, proto.parameters[i].dataType, proto.parameters[i].name), proto.parameters[i].dataType, proto.parameters[i].name));
  const describe = (v: any) => (typeof v === 'string' ? `'${v.trimEnd()}'` : String(v));
  const callText = proto.parameters
    .slice(0, args.length)
    .map((p, i) => `${p.name}=${describe(args[i])}`)
    .join(', ');

  const mockName = Object.keys(s.context.programs).find(n => n.toUpperCase() === target);
  const mock = mockName !== undefined ? s.context.programs[mockName] : undefined;
  if (!mock) {
    // Sans bouchon, un programme dont le source est disponible est exécuté
    const program = proto.kind === 'program' ? s.options.resolveProgram?.(target) : undefined;
    if (program) return callSourceProgram(s, proto, target, program, argExprs, args, callText);
    const hint = proto.kind === 'program'
      ? `placez ${target}.rpgle à côté du programme appelant ou ajoutez son bouchon dans context/programs.json`
      : 'ajoutez son bouchon dans context/programs.json';
    throw new RpgError(STATUS_CALL_NOT_FOUND, `${what} ${target} introuvable : ${hint} (RNX0211)`);
  }
  s.runtime.addOutput(`[APPEL] ${target}(${callText}) (bouchon)`);

  const paramIndex = (paramName: string) => {
    const index = proto.parameters.findIndex(p => p.name.toLowerCase() === paramName.toLowerCase());
    if (index < 0) throw new Error(`Bouchon ${target} : paramètre '${paramName}' inconnu dans le prototype ${proto.name}`);
    return index;
  };
  const sameValue = (actual: any, expected: any) =>
    typeof actual === 'string' ? actual.trimEnd() === String(expected).trimEnd()
      : isDateTime(actual) ? String(actual) === String(expected)
      : actual === expected;

  const matching = mock.calls.find((c: MockCase) =>
    Object.entries(c.when ?? {}).every(([paramName, expected]) => sameValue(args[paramIndex(paramName)], expected)));
  if (!matching) {
    throw new Error(`Bouchon ${target} : aucun cas ne correspond à l'appel (${callText})`);
  }

  if (matching.error !== undefined) {
    throw new RpgError(STATUS_CALL_FAILED, `${what} ${target} en échec : ${matching.error} (RNX0202)`);
  }
  for (const [paramName, value] of Object.entries(matching.set ?? {})) {
    const index = paramIndex(paramName);
    const param = proto.parameters[index];
    if (param.isConst || param.byValue) {
      throw new Error(`Bouchon ${target} : le paramètre ${param.name} est ${param.isConst ? 'CONST' : 'VALUE'}, il ne peut pas être renvoyé`);
    }
    const arg = argExprs[index];
    if (!arg || arg.valueType !== 'identifier') {
      throw new Error(`Bouchon ${target} : le paramètre ${param.name} doit recevoir une variable pour être renvoyé`);
    }
    assignTo(s, arg.value, coerce(fromMock(value, param.dataType, `Bouchon ${target}`), param.dataType, param.name));
  }
  return coerce(fromMock(matching.return, proto.returnType, `Bouchon ${target}`), proto.returnType, proto.name);
}

// Exécute le source d'un programme appelé, avec ses propres variables globales.
// Paramètres passés par référence ; une erreur RPG non interceptée remonte en 00202.
export function callSourceProgram(s: InterpreterState, proto: PrototypeNode, target: string, program: { source: string; path?: string },
                                  argExprs: ExpressionNode[], args: any[], callText: string): void {
  if (s.programDepth >= (s.options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH)) {
    throw new Error(`Profondeur maximale d'appels de programmes atteinte en appelant ${target}`);
  }
  s.runtime.addOutput(`[APPEL] ${target}(${callText}) (source ${program.path ?? target})`);

  let ast: ProgramNode;
  try {
    ast = new Parser(new Lexer(program.source).tokenize()).parse();
  } catch (e: any) {
    throw new Error(`${target} (${program.path ?? 'source'}) : ${e.message}`);
  }

  const callee = new InterpreterState(s.context, s.options);
  callee.programDepth = s.programDepth + 1;
  let finalValues: any[];
  try {
    finalValues = runProgram(callee, ast, args);
  } catch (e) {
    callee.runtime.getOutput().forEach((line: string) => s.runtime.addOutput(line));
    if (e instanceof RpgError) {
      throw new RpgError(STATUS_CALL_FAILED, `Programme ${target} en échec : ${e.message} (RNX0202)`);
    }
    throw e;
  }
  callee.runtime.getOutput().forEach((line: string) => s.runtime.addOutput(line));

  proto.parameters.forEach((param, i) => {
    const arg = argExprs[i];
    if (i < finalValues.length && !param.isConst && !param.byValue && arg?.valueType === 'identifier') {
      assignTo(s, arg.value, coerce(finalValues[i], param.dataType, param.name));
    }
  });
}

export function executeProcedureCall(s: InterpreterState, node: any): void {
  return callProcedure(s, node.name, node.args);
}
