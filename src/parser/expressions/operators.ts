import { TokenType, ExpressionNode } from '../../types';
import { ParserState } from '../state';
import { parseDateTimeSpecial } from '../declarations/variables';
import { parsePrimary } from './primary';

// Priorités RPG, de la plus faible à la plus forte :
// OR < AND < NOT < comparaisons < + - < * / < ** < + - unaires
export function parseExpression(p: ParserState): ExpressionNode {
  return parseOr(p);
}

export function parseOr(p: ParserState): ExpressionNode {
  let left = parseAnd(p);

  while (p.check(TokenType.OR)) {
    p.advance();
    const right = parseAnd(p);
    left = { type: 'Expression', operator: 'or', left, right };
  }

  return left;
}

export function parseAnd(p: ParserState): ExpressionNode {
  let left = parseNot(p);

  while (p.check(TokenType.AND)) {
    p.advance();
    const right = parseNot(p);
    left = { type: 'Expression', operator: 'and', left, right };
  }

  return left;
}

export function parseNot(p: ParserState): ExpressionNode {
  if (p.check(TokenType.NOT)) {
    p.advance();
    return { type: 'Expression', operator: 'not', left: parseNot(p) };
  }

  return parseComparison(p);
}

export function parseComparison(p: ParserState): ExpressionNode {
  let left = parseAddition(p);

  if (p.check(TokenType.EQUALS) || p.check(TokenType.NOT_EQUALS) ||
      p.check(TokenType.LESS) || p.check(TokenType.LESS_EQ) ||
      p.check(TokenType.GREATER) || p.check(TokenType.GREATER_EQ)) {
    const op = p.advance().value;
    const allowed = left.valueType === 'identifier' && p.dateTimeNames.has(String(left.value).toLowerCase())
      ? ['*loval', '*hival'] : [];
    const right = parseDateTimeSpecial(p, allowed) ?? parseAddition(p);
    return { type: 'Expression', operator: op, left, right };
  }

  return left;
}

export function parseAddition(p: ParserState): ExpressionNode {
  let left = parseMultiplication(p);

  while (p.check(TokenType.PLUS) || p.check(TokenType.MINUS)) {
    const op = p.advance().value;
    const right = parseMultiplication(p);
    left = { type: 'Expression', operator: op, left, right };
  }

  return left;
}

export function parseMultiplication(p: ParserState): ExpressionNode {
  let left = parsePower(p);

  while (p.check(TokenType.MULTIPLY) || p.check(TokenType.DIVIDE)) {
    const op = p.advance().value;
    const right = parsePower(p);
    left = { type: 'Expression', operator: op, left, right };
  }

  return left;
}

// ** est associatif à droite : 2 ** 3 ** 2 = 2 ** 9
export function parsePower(p: ParserState): ExpressionNode {
  const base = parseUnary(p);

  if (p.check(TokenType.POWER)) {
    p.advance();
    const exponent = parsePower(p);
    return { type: 'Expression', operator: '**', left: base, right: exponent };
  }

  return base;
}

export function parseUnary(p: ParserState): ExpressionNode {
  if (p.check(TokenType.MINUS)) {
    p.advance();
    return { type: 'Expression', operator: 'neg', left: parseUnary(p) };
  }
  if (p.check(TokenType.PLUS)) {
    p.advance();
    return parseUnary(p);
  }

  return parsePrimary(p);
}
