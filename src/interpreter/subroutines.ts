import { ASTNode, SubroutineNode } from '../types';
import { InterpreterState } from './state';
import { executeBlock } from './program';
import { LeaveSrSignal } from './signals';

export type Subroutines = Map<string, SubroutineNode>;

// Sépare le code principal des sous-routines : le flux séquentiel s'arrête au premier BEGSR
export function splitSubroutines(body: ASTNode[]): { mainline: ASTNode[]; subs: Subroutines } {
  const subs: Subroutines = new Map();
  let mainline = body;
  body.forEach((node, i) => {
    if (node.type !== 'Subroutine') return;
    if (mainline === body) mainline = body.slice(0, i);
    subs.set(node.name.toLowerCase(), node as SubroutineNode);
  });
  return { mainline, subs };
}

export function executeSubroutine(s: InterpreterState, name: string): void {
  const sub = s.subroutines[s.subroutines.length - 1]?.get(name.toLowerCase());
  if (!sub) throw new Error(`Sous-routine ${name.toUpperCase()} non trouvée`);
  try {
    executeBlock(s, sub.body);
  } catch (e) {
    if (!(e instanceof LeaveSrSignal)) throw e;
  }
}
