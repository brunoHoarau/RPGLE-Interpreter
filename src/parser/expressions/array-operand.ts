import { TokenType, ExpressionNode } from '../../types';
import { ParserState } from '../state';
import { unsupported } from '../constants';
import { wholeDsArray } from './element';
import { parseExpression } from './operators';

// Opérande « tableau » de %LOOKUP et de SORTA : `arr` (tableau simple) ou `d(*).champ` (sous-zone d'une DS tableau).
// Valeur : { name, field? } ; toute autre forme (arr(*), arr(i), %SUBARR…) est refusée.
export function parseArrayOperand(p: ParserState, what: string): ExpressionNode {
  if (p.check(TokenType.BUILTIN)) throw unsupported(`${what} sur ${p.peek().value.toUpperCase()}`, p.peek());
  const nameToken = p.expectName();
  const name = nameToken.value;
  const info = p.arrayNames.get(name.toLowerCase());
  if (!info) throw new Error(`${what} attend un tableau : ${name.toUpperCase()} n'en est pas un (ligne ${nameToken.line})`);
  const node = (value: { name: string; field?: string }): ExpressionNode => ({ type: 'Expression', value, valueType: 'arrayref' });
  if (!info.ds) {
    if (p.check(TokenType.LPAREN)) throw unsupported(`${what} sur ${name.toUpperCase()}(…) : seul le tableau entier ${name.toUpperCase()} est accepté`, p.peek());
    return node({ name });
  }
  if (!p.check(TokenType.LPAREN)) throw wholeDsArray(name, nameToken);
  p.advance();
  if (!p.check(TokenType.MULTIPLY) || p.peekNext()?.type !== TokenType.RPAREN) {
    throw unsupported(`${what} sur ${name.toUpperCase()}(i) : la forme est ${name.toUpperCase()}(*).champ`, p.peek());
  }
  p.advance();
  p.advance();
  if (!p.check(TokenType.DOT)) throw unsupported(`${what} sur ${name.toUpperCase()}(*) sans sous-zone : la forme est ${name.toUpperCase()}(*).champ`, p.peek());
  p.advance();
  return node({ name, field: p.expectName().value });
}

// %LOOKUP(valeur : tableau {: début {: nombre}})
export function parseLookup(p: ParserState, name: string, line: number): ExpressionNode {
  p.expect(TokenType.LPAREN);
  const args: ExpressionNode[] = [parseExpression(p)];
  if (!p.check(TokenType.COLON)) throw new Error(`%LOOKUP attend au moins 2 arguments : %LOOKUP(valeur : tableau) (ligne ${line})`);
  p.advance();
  args.push(parseArrayOperand(p, '%LOOKUP'));
  while (args.length < 4 && p.check(TokenType.COLON)) {
    p.advance();
    args.push(parseExpression(p));
  }
  if (!p.check(TokenType.RPAREN)) throw new Error(`%LOOKUP accepte au plus 4 arguments (ligne ${line})`);
  p.advance();
  return { type: 'Expression', value: { name, args }, valueType: 'builtin' };
}
