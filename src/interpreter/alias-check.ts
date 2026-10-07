import { ExpressionNode, ParameterNode } from '../types';
import { NotSupportedError } from '../errors';

// Une variable est recouverte par une autre si c'est la même, ou si l'une est la DS de l'autre (d / d.nom)
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
}

// Le passage par référence est simulé par copie / recopie : deux paramètres qui désignent la même mémoire
// (sur IBM i) ne se verraient pas. Un paramètre CONST peut être passé par référence : même refus.
// VALUE est une vraie copie : accepté.
export function checkAliasedArguments(procName: string, params: ParameterNode[], argExprs: ExpressionNode[]): void {
  const shared = argExprs.map((arg, i) => ({
    name: arg.valueType === 'identifier' ? String(arg.value).toLowerCase() : undefined,
    writable: !params[i]?.isConst && !params[i]?.byValue,
    shared: !params[i]?.byValue,
  }));
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      const a = shared[i], b = shared[j];
      if (a.name === undefined || b.name === undefined || !a.shared || !b.shared) continue;
      if ((a.writable || b.writable) && overlaps(a.name, b.name)) {
        throw new NotSupportedError(`variable ${String(argExprs[i].value).toUpperCase()} passée deux fois par référence à ${procName} (paramètres ${params[i].name.toUpperCase()} et ${params[j].name.toUpperCase()})`);
      }
    }
  }
}
