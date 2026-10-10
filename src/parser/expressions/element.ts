import { TokenType, Token, ElementRef, ExpressionNode } from '../../types';
import { ParserState } from '../state';
import { unsupported } from '../constants';
import { parseExpression } from './operators';

// Message commun : un tableau pris dans son ensemble n'est pas simulé
export function refuseWholeArray(name: string, token: Token): Error {
  return unsupported(`Opération sur le tableau entier ${name.toUpperCase()}`, token);
}

// arr(index) : le jeton courant est la parenthèse ouvrante. asTarget : cible d'affectation (seule place de *NEXT).
export function parseElement(p: ParserState, nameToken: Token, asTarget: boolean): ElementRef {
  const name = nameToken.value;
  p.expect(TokenType.LPAREN);
  const first = p.peek();
  let index: ElementRef['index'];
  if (first.type === TokenType.MULTIPLY && p.peekNext()?.type === TokenType.RPAREN) {
    throw refuseWholeArray(name, first);
  } else if (first.type === TokenType.SPECIAL_VALUE && first.value === '*next' && p.peekNext()?.type === TokenType.RPAREN) {
    if (!asTarget) throw new Error(`${name.toUpperCase()}(*NEXT) n'est permis que comme cible d'une affectation (ligne ${first.line})`);
    if (!p.arrayNames.get(name.toLowerCase())?.auto) {
      throw new Error(`${name.toUpperCase()}(*NEXT) exige un tableau déclaré DIM(*AUTO : n) (ligne ${first.line})`);
    }
    p.advance();
    index = '*next';
  } else {
    index = parseExpression(p);
  }
  p.expect(TokenType.RPAREN);
  return { name, index };
}

export function elementExpression(ref: ElementRef): ExpressionNode {
  return { type: 'Expression', value: ref, valueType: 'element' };
}
