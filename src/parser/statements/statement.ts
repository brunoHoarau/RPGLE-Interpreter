import { TokenType, ASTNode } from '../../types';
import { ParserState } from '../state';
import { FILE_OPERATION_TOKENS, INDICATOR, unsupported, COMPOUND_OPERATORS } from '../constants';
import { isFileKeywordNameUse, parseFileOperation } from '../files';
import { parseIfStatement, parseSelectStatement, parseLoop, parseMonitor, parseReturn } from './control';
import { checkCompound, advanceCompound, compoundValue, parseAssignmentOrCall } from './assignment';
import { parseDsply, parseSQL } from './io';
import { isOpcode, parseExsr, parseLeavesr } from '../subroutines';
import { parseExpression } from '../expressions/operators';

export function parseStatement(p: ParserState): ASTNode {
  if (p.check(TokenType.DSPLY)) return parseDsply(p);
  if (p.check(TokenType.IF)) return parseIfStatement(p);
  if (p.check(TokenType.SELECT)) return parseSelectStatement(p);
  if (p.check(TokenType.DOW) || p.check(TokenType.DOU) || p.check(TokenType.FOR)) return parseLoop(p);
  if (p.check(TokenType.MONITOR)) return parseMonitor(p);
  if (p.check(TokenType.RETURN)) return parseReturn(p);
  if (p.check(TokenType.EXEC_SQL)) return parseSQL(p);
  if (p.check(TokenType.LEAVE)) {
    p.advance();
    p.expect(TokenType.SEMICOLON);
    return { type: 'Leave' } as any;
  }
  if (p.check(TokenType.ITER)) {
    p.advance();
    p.expect(TokenType.SEMICOLON);
    return { type: 'Iter' } as any;
  }
  if (isOpcode(p, 'exsr')) return parseExsr(p);
  if (isOpcode(p, 'leavesr')) return parseLeavesr(p);
  if (isOpcode(p, 'endsr')) throw new Error(`ENDSR sans BEGSR à la ligne ${p.peek().line}`);
  if (p.check(TokenType.IDENTIFIER)) return parseAssignmentOrCall(p);
  if (p.isTypeToken()) {
    // Un mot de type en début d'instruction est un nom s'il est utilisé comme tel
    const next = p.peekNext()?.type;
    if (next === TokenType.EQUALS || next === TokenType.DOT || next === TokenType.SEMICOLON || next === TokenType.LPAREN ||
        (next !== undefined && COMPOUND_OPERATORS.has(next))) {
      return parseAssignmentOrCall(p);
    }
  }

  const token = p.peek();
  if (FILE_OPERATION_TOKENS.includes(token.type)) {
    if (isFileKeywordNameUse(p)) return parseAssignmentOrCall(p);
    return parseFileOperation(p);
  }
  if (token.type === TokenType.DCL_F) {
    throw unsupported('DCL-F en dehors du niveau principal', token);
  }
  if (token.type === TokenType.SPECIAL_VALUE && INDICATOR.test(token.value)) {
    // *INLR = *ON; *IN50 = ...;
    p.advance();
    const variable = token.value.toLowerCase();
    if (checkCompound(p)) {
      const operator = advanceCompound(p);
      const value = compoundValue(p, variable, operator);
      p.expect(TokenType.SEMICOLON);
      return { type: 'Assignment', variable, value };
    }
    p.expect(TokenType.EQUALS);
    const value = parseExpression(p);
    p.expect(TokenType.SEMICOLON);
    return { type: 'Assignment', variable, value };
  }

  throw new Error(`Instruction inattendue '${token.value.toUpperCase()}' à la ligne ${token.line}`);
}
