import { TokenType, ASTNode, FileOperationNode, ExpressionNode } from '../../types';
import { ParserState } from '../state';
import { UNSUPPORTED_OPCODES, unsupported, COMPOUND_OPERATORS } from '../constants';
import { parseDateTimeSpecial } from '../declarations/variables';
import { requireFile } from '../files';
import { parseExpression } from '../expressions/operators';

// IBM i refuse à la compilation d'affecter une constante ou un paramètre CONST
export function checkWritable(p: ParserState, name: string, line: number): void {
  // d.x : la sous-zone d'un paramètre DS CONST est en lecture seule comme le paramètre
  const kind = p.readOnlyNames.get(name.toLowerCase()) ?? p.readOnlyNames.get(name.split('.')[0].toLowerCase());
  if (kind) {
    throw new Error(`${name} est ${kind} : affectation refusée par le compilateur IBM i (ligne ${line})`);
  }
}

export function checkCompound(p: ParserState): boolean {
  return COMPOUND_OPERATORS.has(p.peek().type);
}

export function advanceCompound(p: ParserState): string {
  return COMPOUND_OPERATORS.get(p.advance().type)!;
}

// x op= e  équivaut à  x = x op (e)
export function compoundValue(p: ParserState, target: string, operator: string): ExpressionNode {
  const right = parseExpression(p);
  const left: ExpressionNode = { type: 'Expression', value: target, valueType: 'identifier' };
  return { type: 'Expression', operator, left, right };
}

export function parseAssignmentOrCall(p: ParserState): ASTNode {
  const nameToken = p.expectName();
  let name = nameToken.value;
  const lower = name.toLowerCase();

  // CALLP [(E)] proc(...) : CALLP est facultatif en free form
  if (lower === 'callp' && (p.isName() || p.check(TokenType.LPAREN))) {
    if (p.check(TokenType.LPAREN)) {
      throw unsupported(`L'extenseur (${p.parenText().text.toUpperCase()}) de CALLP`, nameToken);
    }
    return parseAssignmentOrCall(p);
  }

  // EVAL var = expr ; les extenseurs (H, M, R) ne sont pas supportés
  if (lower === 'eval' && (p.isName() || p.check(TokenType.LPAREN))) {
    if (p.check(TokenType.LPAREN)) {
      const extender = p.peekNext();
      throw unsupported(`EVAL(${(extender?.value ?? '').toUpperCase()})`, nameToken);
    }
    return parseAssignmentOrCall(p);
  }

  // UNLOCK(E) fichier : seul l'extenseur E est accepté (N ne vaut que pour les lectures)
  let unlockExtender: FileOperationNode['extender'];
  if (lower === 'unlock' && p.check(TokenType.LPAREN)) {
    const { text, end } = p.parenText();
    if (p.tokens[end]?.type === TokenType.RPAREN && p.tokens[end + 1]?.type === TokenType.IDENTIFIER) {
      if (text.toLowerCase() !== 'e') throw unsupported(`L'extenseur (${text.toUpperCase()}) de UNLOCK`, nameToken);
      unlockExtender = { error: true, noLock: false };
      p.pos = end + 1;
    }
  }
  const isNameUse = p.check(TokenType.EQUALS) || checkCompound(p) || p.check(TokenType.DOT) || p.check(TokenType.LPAREN);
  // UNLOCK fichier : le fichier doit être déclaré
  if (lower === 'unlock' && !isNameUse && !p.check(TokenType.SEMICOLON)) {
    const fileToken = p.expectName();
    p.expect(TokenType.SEMICOLON);
    requireFile(p, fileToken.value, fileToken.line, true);
    const node: FileOperationNode = { type: 'FileOperation', operation: 'unlock', file: fileToken.value, line: nameToken.line };
    if (unlockExtender) node.extender = unlockExtender;
    return node;
  }
  if (UNSUPPORTED_OPCODES.has(lower) && !isNameUse) {
    throw unsupported(`L'opération ${name.toUpperCase()}`, nameToken);
  }

  // Notation pointée : client.id
  while (p.check(TokenType.DOT)) {
    p.advance();
    name += '.' + p.expectName().value;
  }

  if (p.check(TokenType.EQUALS)) {
    checkWritable(p, name, nameToken.line);
    p.advance();
    const allowed = p.mayBeDateTime(name) ? ['*loval', '*hival'] : [];
    const value = parseDateTimeSpecial(p, allowed, TokenType.SEMICOLON) ?? parseExpression(p);
    p.expect(TokenType.SEMICOLON);
    return { type: 'Assignment', variable: name, value };
  }

  if (checkCompound(p)) {
    checkWritable(p, name, nameToken.line);
    const operator = advanceCompound(p);
    const value = compoundValue(p, name, operator);
    p.expect(TokenType.SEMICOLON);
    return { type: 'Assignment', variable: name, value };
  }

  if (p.check(TokenType.LPAREN)) {
    const args = parseCallArguments(p);
    if (p.check(TokenType.EQUALS) || checkCompound(p)) {
      throw unsupported('Les tableaux (affectation indicée)', nameToken);
    }
    p.expect(TokenType.SEMICOLON);
    return { type: 'ProcedureCall', name, args };
  }

  if (p.check(TokenType.SEMICOLON)) {
    // Appel sans paramètre ni parenthèses : proc;
    p.advance();
    return { type: 'ProcedureCall', name, args: [] };
  }

  throw new Error(`Instruction non reconnue '${name}' à la ligne ${nameToken.line}`);
}

// Arguments d'appel : (a: b: c), la virgule est tolérée
export function parseCallArguments(p: ParserState): ExpressionNode[] {
  p.expect(TokenType.LPAREN);
  const args: ExpressionNode[] = [];
  if (!p.check(TokenType.RPAREN)) {
    args.push(parseExpression(p));
    while (p.check(TokenType.COLON) || p.check(TokenType.COMMA)) {
      p.advance();
      args.push(parseExpression(p));
    }
  }
  p.expect(TokenType.RPAREN);
  return args;
}
