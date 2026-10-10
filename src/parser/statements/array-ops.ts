import { TokenType, ASTNode } from '../../types';
import { ParserState } from '../state';
import { isOpcode } from '../subroutines';
import { parseArrayOperand } from '../expressions/array-operand';

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
  const operand = parseArrayOperand(p, 'SORTA');
  p.expect(TokenType.SEMICOLON);
  return { type: 'Sorta', name: operand.value.name, field: operand.value.field, descending };
}
