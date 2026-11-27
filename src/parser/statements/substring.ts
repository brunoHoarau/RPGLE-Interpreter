import { TokenType, ASTNode, ExpressionNode, ElementRef } from '../../types';
import { ParserState } from '../state';
import { unsupported, COMPOUND_OPERATORS } from '../constants';
import { parseExpression } from '../expressions/operators';
import { parseElement, elementExpression } from '../expressions/element';
import { checkWritable } from './assignment';

// Le jeton courant commence-t-il une cible %SUBST(...) = ... ?
export function isSubstringTarget(p: ParserState): boolean {
  const token = p.peek();
  return token.type === TokenType.BUILTIN && token.value.toLowerCase() === '%subst';
}

// {EVAL | EVALR} %SUBST(cible : début {: longueur}) = expression ;
// la cible désigne un emplacement : variable, sous-champ de DS ou élément de tableau
export function parseSubstringAssignment(p: ParserState, rightAdjust: boolean): ASTNode {
  const subst = p.advance();
  p.expect(TokenType.LPAREN);
  const nameToken = p.expectName();
  let variable = nameToken.value;
  let target: ElementRef | undefined;
  if (p.arrayNames.has(variable.toLowerCase())) {
    target = parseElement(p, nameToken, true);
  } else {
    while (p.check(TokenType.DOT)) {
      p.advance();
      variable += '.' + p.expectName().value;
    }
  }
  checkWritable(p, target?.field ? `${variable}.${target.field}` : variable, nameToken.line);
  p.expect(TokenType.COLON);
  const start = parseExpression(p);
  let length: ExpressionNode | undefined;
  if (p.check(TokenType.COLON)) {
    p.advance();
    length = parseExpression(p);
    if (p.check(TokenType.COLON)) throw unsupported('Le 4e paramètre (*NATURAL, *STDCHARSIZE) de %SUBST', subst);
  }
  p.expect(TokenType.RPAREN);
  if (COMPOUND_OPERATORS.has(p.peek().type)) throw unsupported('Un opérateur composé (+=, -=…) sur %SUBST', subst);
  p.expect(TokenType.EQUALS);
  const value = parseExpression(p);
  p.expect(TokenType.SEMICOLON);
  const current: ExpressionNode = target ? elementExpression(target) : { type: 'Expression', value: variable, valueType: 'identifier' };
  return { type: 'Assignment', variable, target, value, rightAdjust, substring: { start, length, current } } as ASTNode;
}
