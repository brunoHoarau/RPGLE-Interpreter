import { TokenType, ASTNode, ExpressionNode } from '../../types';
import { ParserState } from '../state';
import { checkWritable } from './assignment';
import { parseStatement } from './statement';
import { parseExpression } from '../expressions/operators';

export function parseIfStatement(p: ParserState): ASTNode {
  p.expect(TokenType.IF);
  const condition = parseExpression(p);
  p.expect(TokenType.SEMICOLON);

  const thenBlock: ASTNode[] = [];
  while (!p.check(TokenType.ELSEIF) && !p.check(TokenType.ELSE) && !p.check(TokenType.ENDIF)) {
    thenBlock.push(parseStatement(p));
  }

  const elseIfBlocks: any[] = [];
  while (p.check(TokenType.ELSEIF)) {
    p.advance();
    const elseIfCondition = parseExpression(p);
    p.expect(TokenType.SEMICOLON);
    const elseIfBlock: ASTNode[] = [];
    while (!p.check(TokenType.ELSEIF) && !p.check(TokenType.ELSE) && !p.check(TokenType.ENDIF)) {
      elseIfBlock.push(parseStatement(p));
    }
    elseIfBlocks.push({ condition: elseIfCondition, block: elseIfBlock });
  }

  let elseBlock: ASTNode[] | undefined;
  if (p.check(TokenType.ELSE)) {
    p.advance();
    p.expect(TokenType.SEMICOLON);
    elseBlock = [];
    while (!p.check(TokenType.ENDIF)) {
      elseBlock.push(parseStatement(p));
    }
  }

  p.expect(TokenType.ENDIF);
  p.expect(TokenType.SEMICOLON);

  return { type: 'IfStatement', condition, thenBlock, elseIfBlocks, elseBlock };
}

export function parseSelectStatement(p: ParserState): ASTNode {
  p.expect(TokenType.SELECT);
  p.expect(TokenType.SEMICOLON);

  const whenBlocks: any[] = [];
  let otherBlock: ASTNode[] | undefined;

  while (!p.check(TokenType.ENDSL) && !p.isAtEnd()) {
    if (p.check(TokenType.WHEN)) {
      p.advance();
      const condition = parseExpression(p);
      p.expect(TokenType.SEMICOLON);
      const block: ASTNode[] = [];
      while (!p.check(TokenType.WHEN) && !p.check(TokenType.OTHER) && !p.check(TokenType.ENDSL)) {
        block.push(parseStatement(p));
      }
      whenBlocks.push({ condition, block });
    } else if (p.check(TokenType.OTHER)) {
      p.advance();
      p.expect(TokenType.SEMICOLON);
      otherBlock = [];
      while (!p.check(TokenType.ENDSL)) {
        otherBlock.push(parseStatement(p));
      }
    } else {
      throw new Error(`Attendu WHEN, OTHER ou ENDSL à la ligne ${p.peek().line}`);
    }
  }

  p.expect(TokenType.ENDSL);
  p.expect(TokenType.SEMICOLON);

  return { type: 'SelectStatement', whenBlocks, otherBlock };
}

export function parseLoop(p: ParserState): ASTNode {
  const loopType = p.advance().value as 'dow' | 'dou' | 'for';

  if (loopType === 'for') {
    const varToken = p.expectName();
    const varName = varToken.value;
    checkWritable(p, varName, varToken.line);
    p.expect(TokenType.EQUALS);
    const init = parseExpression(p);
    const direction = p.advance().value as 'to' | 'downto';
    const limit = parseExpression(p);
    let step: ExpressionNode | undefined;

    if (p.check(TokenType.BY)) {
      p.advance();
      step = parseExpression(p);
    }

    p.expect(TokenType.SEMICOLON);
    const body: ASTNode[] = [];
    while (!p.check(TokenType.ENDFOR)) {
      body.push(parseStatement(p));
    }
    p.expect(TokenType.ENDFOR);
    p.expect(TokenType.SEMICOLON);

    return { type: 'LoopStatement', loopType: 'for', variable: varName, init, limit, step, direction, body };
  } else {
    const condition = parseExpression(p);
    p.expect(TokenType.SEMICOLON);
    const body: ASTNode[] = [];
    while (!p.check(TokenType.ENDDO)) {
      body.push(parseStatement(p));
    }
    p.expect(TokenType.ENDDO);
    p.expect(TokenType.SEMICOLON);

    return { type: 'LoopStatement', loopType, condition, body };
  }
}

export function parseMonitor(p: ParserState): ASTNode {
  p.expect(TokenType.MONITOR);
  p.expect(TokenType.SEMICOLON);

  const tryBlock: ASTNode[] = [];
  while (!p.check(TokenType.ON_ERROR) && !p.check(TokenType.ENDMON)) {
    tryBlock.push(parseStatement(p));
  }

  const catchBlocks: any[] = [];
  while (p.check(TokenType.ON_ERROR)) {
    p.advance();
    // on-error [code {: code...}] ; code = statut (00102) ou *PROGRAM / *FILE / *ALL
    const errorCodes: string[] = [];
    while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
      const token = p.advance();
      if (token.type === TokenType.NUMBER || token.type === TokenType.SPECIAL_VALUE) {
        errorCodes.push(token.value.toLowerCase());
      } else if (token.type !== TokenType.COLON) {
        throw new Error(`Code d'erreur invalide '${token.value}' après ON-ERROR à la ligne ${token.line}`);
      }
    }
    p.expect(TokenType.SEMICOLON);

    const catchBlock: ASTNode[] = [];
    while (!p.check(TokenType.ON_ERROR) && !p.check(TokenType.ENDMON)) {
      catchBlock.push(parseStatement(p));
    }
    catchBlocks.push({ errorCodes, block: catchBlock });
  }

  p.expect(TokenType.ENDMON);
  p.expect(TokenType.SEMICOLON);

  return { type: 'Monitor', tryBlock, catchBlocks };
}

export function parseReturn(p: ParserState): ASTNode {
  p.expect(TokenType.RETURN);
  let value: ExpressionNode | undefined;

  if (!p.check(TokenType.SEMICOLON)) {
    value = parseExpression(p);
  }

  p.expect(TokenType.SEMICOLON);
  return { type: 'Return', value };
}
