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
  if (!p.check(TokenType.DOT)) return { name, index };
  const dot = p.advance();
  if (!p.arrayNames.get(name.toLowerCase())?.ds) {
    throw new Error(`${name.toUpperCase()}(…) n'est pas un tableau de structures de données : .${p.peek().value} impossible (ligne ${dot.line})`);
  }
  if (index === '*next') throw unsupported(`${name.toUpperCase()}(*NEXT).champ`, dot);
  return { name, index, field: p.expectName().value };
}

// Tableau de DS pris sans index (d seul ou d.champ) : erreur de compilation
export function wholeDsArray(name: string, token: Token): Error {
  return new Error(`${name.toUpperCase()} est un tableau de structures de données : un index est obligatoire, ${name.toUpperCase()}(i) (ligne ${token.line})`);
}

// Tableau pris sans index : DS tableau = erreur de compilation, tableau simple = refus
export function refuseUnindexed(p: ParserState, name: string, token: Token): Error {
  return p.arrayNames.get(name.toLowerCase())?.ds ? wholeDsArray(name, token) : refuseWholeArray(name, token);
}

export function elementExpression(ref: ElementRef): ExpressionNode {
  return { type: 'Expression', value: ref, valueType: 'element' };
}
