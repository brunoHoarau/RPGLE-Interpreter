import { TokenType, ASTNode } from '../../types';
import { ParserState } from '../state';
import { isOpcode } from '../subroutines';
import { unsupported } from '../constants';
import { checkWritable } from './assignment';
import { parseStatement } from './statement';
import { parseArrayOperand, parseWholeSubarr } from '../expressions/array-operand';

const OPERAND_START = [TokenType.IDENTIFIER, TokenType.BUILTIN];

// SORTA tab ; SORTA(A) tab ; SORTA(D) tab : le mot est un code opération et non un appel de procédure sorta(x)
export function isSorta(p: ParserState): boolean {
  if (!p.check(TokenType.IDENTIFIER) || p.peek().value.toLowerCase() !== 'sorta') return false;
  if (p.peekNext()?.type !== TokenType.LPAREN) return isOpcode(p, 'sorta');
  const after = p.tokens[p.pos + 4];
  return p.tokens[p.pos + 3]?.type === TokenType.RPAREN && after !== undefined && (OPERAND_START.includes(after.type) || p.isTypeTokenAt(p.pos + 4));
}

export function parseSorta(p: ParserState): ASTNode {
  const opToken = p.advance();
  let descending = false;
  if (p.check(TokenType.LPAREN)) {
    p.advance();
    const letter = p.advance();
    const lower = letter.value.toLowerCase();
    if (lower !== 'a' && lower !== 'd') throw new Error(`SORTA(${letter.value.toUpperCase()}) : seuls (A) et (D) existent (ligne ${opToken.line})`);
    descending = lower === 'd';
    p.expect(TokenType.RPAREN);
  }
  const { name, field, start, count } = parseArrayOperand(p, 'SORTA', { subarr: true }).value;
  p.expect(TokenType.SEMICOLON);
  return { type: 'Sorta', name, field, start, count, descending };
}

// FOR-EACH item IN tableau ; … ENDFOR ; : l'élément est copié dans item à chaque tour
export function parseForEach(p: ParserState): ASTNode {
  const forToken = p.advance();
  if (p.check(TokenType.LPAREN)) throw unsupported(`FOR-EACH${p.parenText().text ? `(${p.parenText().text.toUpperCase()})` : ''}`, forToken);
  const itemToken = p.expectName();
  let item = itemToken.value;
  while (p.check(TokenType.DOT)) {
    p.advance();
    item += `.${p.expectName().value}`;
  }
  if (p.check(TokenType.LPAREN) || p.arrayNames.has(item.toLowerCase())) {
    throw unsupported(`FOR-EACH avec ${item.toUpperCase()} (tableau ou élément) comme variable de boucle`, itemToken);
  }
  checkWritable(p, item, itemToken.line);
  if (!p.check(TokenType.IDENTIFIER) || p.peek().value.toLowerCase() !== 'in') {
    throw new Error(`FOR-EACH attend IN après ${item.toUpperCase()} (ligne ${p.peek().line})`);
  }
  p.advance();
  if (p.check(TokenType.BUILTIN)) {
    if (p.peek().value.toLowerCase() !== '%subarr') throw unsupported(`FOR-EACH … IN ${p.peek().value.toUpperCase()}`, p.peek());
    const { name, start, count } = parseWholeSubarr(p, 'FOR-EACH … IN');
    p.expect(TokenType.SEMICOLON);
    return { type: 'LoopStatement', loopType: 'foreach', item, source: name, start, count, body: parseForEachBody(p, forToken) };
  }
  const sourceToken = p.expectName();
  if (!p.arrayNames.has(sourceToken.value.toLowerCase())) {
    throw new Error(`FOR-EACH … IN attend un tableau : ${sourceToken.value.toUpperCase()} n'en est pas un (ligne ${sourceToken.line})`);
  }
  if (p.check(TokenType.LPAREN) || p.check(TokenType.DOT)) {
    throw unsupported(`FOR-EACH … IN ${sourceToken.value.toUpperCase()}(…) : seul le tableau entier est accepté`, sourceToken);
  }
  p.expect(TokenType.SEMICOLON);
  return { type: 'LoopStatement', loopType: 'foreach', item, source: sourceToken.value, body: parseForEachBody(p, forToken) };
}

function parseForEachBody(p: ParserState, forToken: { line: number }): ASTNode[] {
  const body: ASTNode[] = [];
  while (!p.check(TokenType.ENDFOR)) {
    if (p.isAtEnd()) throw new Error(`FOR-EACH sans ENDFOR (ligne ${forToken.line})`);
    body.push(parseStatement(p));
  }
  p.expect(TokenType.ENDFOR);
  p.expect(TokenType.SEMICOLON);
  return body;
}
