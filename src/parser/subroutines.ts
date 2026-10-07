import { TokenType, ASTNode, SubroutineNode, ExsrNode, LeavesrNode } from '../types';
import { ParserState } from './state';
import { COMPOUND_OPERATORS, unsupported } from './constants';
import { parseStatement } from './statements/statement';

const DECLARATIONS = [
  TokenType.DCL_S, TokenType.DCL_C, TokenType.DCL_DS, TokenType.DCL_PR, TokenType.DCL_PI,
  TokenType.DCL_F, TokenType.DCL_PROC, TokenType.END_PROC, TokenType.CTL_OPT,
];

// Le mot courant est le code opération donné (et non un nom de variable ou de procédure du même nom)
export function isOpcode(p: ParserState, word: string): boolean {
  if (!p.check(TokenType.IDENTIFIER) || p.peek().value.toLowerCase() !== word) return false;
  const next = p.peekNext()?.type;
  return next !== TokenType.EQUALS && next !== TokenType.DOT && next !== TokenType.LPAREN &&
    !(next !== undefined && COMPOUND_OPERATORS.has(next));
}

// Les sous-routines terminent la portée : plus rien d'autre n'est permis après (sauf les types donnés)
export function checkAfterSubroutines(p: ParserState, allowed: TokenType[]): void {
  if (p.subScope.seen && !p.isAtEnd() && !allowed.some(type => p.check(type))) {
    throw new Error(`Instruction après les sous-routines : les sous-routines doivent suivre le code principal (ligne ${p.peek().line})`);
  }
}

// Nom d'une sous-routine : un nom ou une valeur spéciale (*INZSR, *PSSR)
function expectSubroutineName(p: ParserState) {
  if (p.check(TokenType.SPECIAL_VALUE)) return p.advance();
  return p.expectName();
}

export function parseSubroutine(p: ParserState): SubroutineNode {
  p.advance(); // BEGSR
  const nameToken = expectSubroutineName(p);
  const name = nameToken.value.toLowerCase();
  const scope = p.subScope;
  if (name === '*pssr') throw unsupported('La sous-routine d\'exception de programme *PSSR', nameToken);
  if (name.startsWith('*') && name !== '*inzsr') {
    throw new Error(`Nom de sous-routine ${nameToken.value.toUpperCase()} invalide (ligne ${nameToken.line})`);
  }
  if (name === '*inzsr' && scope.isProc) {
    throw new Error(`*INZSR n'est permise que dans le programme principal, pas dans une procédure (ligne ${nameToken.line})`);
  }
  if (scope.defined.has(name)) {
    throw new Error(`La sous-routine ${nameToken.value.toUpperCase()} est déjà définie (ligne ${nameToken.line})`);
  }
  scope.defined.set(name, nameToken.line);
  scope.seen = true;
  p.expect(TokenType.SEMICOLON);

  p.currentSub = name;
  const body: ASTNode[] = [];
  while (!isOpcode(p, 'endsr')) {
    if (p.isAtEnd()) throw new Error(`ENDSR attendu pour la sous-routine ${nameToken.value.toUpperCase()} (ligne ${nameToken.line})`);
    if (isOpcode(p, 'begsr')) throw new Error(`BEGSR imbriquée dans une sous-routine (ligne ${p.peek().line})`);
    if (DECLARATIONS.some(type => p.check(type))) {
      throw new Error(`Déclaration interdite dans une sous-routine (ligne ${p.peek().line})`);
    }
    body.push(parseStatement(p));
  }
  p.currentSub = undefined;
  const endToken = p.advance();
  if (!p.check(TokenType.SEMICOLON)) throw unsupported('ENDSR avec un opérande (code retour)', endToken);
  p.advance();

  checkNoLoopExit(body, false);
  return { type: 'Subroutine', name: nameToken.value, body };
}

// Le corps d'une sous-routine n'hérite pas des boucles de l'appelant : LEAVE et ITER exigent une boucle du corps
function checkNoLoopExit(node: any, inLoop: boolean): void {
  if (Array.isArray(node)) return node.forEach(child => checkNoLoopExit(child, inLoop));
  if (!node || typeof node !== 'object') return;
  if (!inLoop && (node.type === 'Leave' || node.type === 'Iter')) {
    throw new Error(`${node.type.toUpperCase()} dans une sous-routine sans boucle : le corps d'une sous-routine n'hérite pas de la boucle de l'appelant`);
  }
  const loop = inLoop || node.type === 'LoopStatement';
  for (const value of Object.values(node)) checkNoLoopExit(value, loop);
}

export function parseExsr(p: ParserState): ExsrNode {
  const opToken = p.advance();
  const nameToken = expectSubroutineName(p);
  p.expect(TokenType.SEMICOLON);
  const name = nameToken.value.toLowerCase();
  if (name === '*pssr') throw unsupported('EXSR *PSSR : la sous-routine d\'exception de programme', nameToken);
  p.subScope.calls.push({ from: p.currentSub, to: name, token: nameToken });
  return { type: 'Exsr', name, line: opToken.line };
}

export function parseLeavesr(p: ParserState): LeavesrNode {
  const token = p.advance();
  if (!p.currentSub) throw new Error(`LEAVESR en dehors d'une sous-routine (ligne ${token.line})`);
  p.expect(TokenType.SEMICOLON);
  return { type: 'Leavesr' };
}

// Fin de portée : tout EXSR vise une sous-routine de la portée, et aucune n'est récursive
export function finishSubScope(p: ParserState): void {
  const { defined, calls } = p.subScope;
  for (const call of calls) {
    if (!defined.has(call.to)) {
      throw new Error(`La sous-routine ${call.token.value.toUpperCase()} n'existe pas dans cette portée (ligne ${call.token.line})`);
    }
  }
  for (const start of defined.keys()) {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const from = stack.pop()!;
      for (const call of calls.filter(c => c.from === from)) {
        if (call.to === start) {
          throw unsupported(`Appel récursif de la sous-routine ${call.token.value.toUpperCase()}`, call.token);
        }
        if (!seen.has(call.to)) {
          seen.add(call.to);
          stack.push(call.to);
        }
      }
    }
  }
}
