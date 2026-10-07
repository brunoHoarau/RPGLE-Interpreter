import { ExpressionNode } from '../../types';
import { NotSupportedError } from '../../errors';
import { fileState } from './operations';
import { InterpreterState } from '../state';

export const FILE_BUILTINS = new Set(['%eof', '%found', '%equal', '%open']);

// %EOF, %FOUND, %EQUAL, %OPEN : état d'un fichier, ou dernier état connu sans argument
export function fileBuiltin(s: InterpreterState, name: string, args: ExpressionNode[]): boolean {
  const builtin = name.toLowerCase();
  if (args.length > 0) {
    const state = fileState(s, String(args[0].value));
    switch (builtin) {
      case '%open': return state.open;
      case '%eof':
        if (state.eof === undefined) {
          throw new NotSupportedError(`%EOF(${state.file.name}) après un CHAIN non trouvé`);
        }
        return state.eof;
      case '%found': return state.found;
      case '%equal': return state.equal;
    }
  } else {
    if (s.files.size === 0) throw new Error(`${name.toUpperCase()} sans fichier déclaré`);
    switch (builtin) {
      case '%eof': return s.lastIndicators.eof;
      case '%found': return s.lastIndicators.found;
      case '%equal': return s.lastIndicators.equal;
    }
  }
  throw new Error(`Fonction ${name.toUpperCase()} inattendue pour un fichier`);
}
