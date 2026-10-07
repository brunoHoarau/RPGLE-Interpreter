import { ProgramNode } from '../types';
import { ExecutionContext } from '../context';
import { InterpreterOptions, InterpreterState } from './state';
import { runProgram } from './program';

export { InterpreterOptions } from './state';

export class Interpreter {
  private state: InterpreterState;

  constructor(context?: ExecutionContext, options: InterpreterOptions = {}) {
    this.state = new InterpreterState(context, options);
  }

  // Exécution en cours (lu par les tests)
  get runtime() {
    return this.state.runtime;
  }

  execute(ast: ProgramNode): string[] {
    const parameters = ast.parameters ?? [];
    if (parameters.length > 0) {
      throw new Error(`Ce programme attend des paramètres d'entrée (${parameters.map(p => p.name).join(', ')}) : `
        + `exécutez le programme qui l'appelle`);
    }
    runProgram(this.state, ast, []);
    return this.state.runtime.getOutput();
  }
}
