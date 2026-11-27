import { TokenType, ExpressionNode } from '../../types';
import { ParserState } from '../state';
import { unsupported } from '../constants';
import { wholeDsArray } from './element';
import { parseExpression } from './operators';

interface OperandOptions {
  subarr?: boolean;  // %SUBARR(tableau : début {: nombre}) accepté
  wholeDs?: boolean; // DS tableau entière `d` acceptée (sinon seule `d(*).champ`)
}

// Opérande « tableau » de %LOOKUP, SORTA, FOR-EACH, CLEAR, RESET : `arr` (tableau simple) ou `d(*).champ`
// (sous-zone d'une DS tableau), et selon les options %SUBARR(…) ou la DS tableau entière.
// Valeur : { name, field?, start?, count? } ; toute autre forme (arr(*), arr(i), %LIST…) est refusée.
export function parseArrayOperand(p: ParserState, what: string, options: OperandOptions = {}): ExpressionNode {
  if (p.check(TokenType.BUILTIN)) {
    const token = p.peek();
    if (token.value.toLowerCase() === '%subarr' && options.subarr) return parseSubarr(p, options);
    if (token.value.toLowerCase() === '%subarr' && what === '%LOOKUP') {
      throw new Error(`%SUBARR n'est pas permis comme tableau de %LOOKUP : utiliser ses arguments début et nombre (ligne ${token.line})`);
    }
    throw unsupported(`${what} sur ${token.value.toUpperCase()}`, token);
  }
  const nameToken = p.expectName();
  const name = nameToken.value;
  const info = p.arrayNames.get(name.toLowerCase());
  if (!info) throw new Error(`${what} attend un tableau : ${name.toUpperCase()} n'en est pas un (ligne ${nameToken.line})`);
  const node = (value: { name: string; field?: string }): ExpressionNode => ({ type: 'Expression', value, valueType: 'arrayref' });
  if (!info.ds) {
    if (p.check(TokenType.LPAREN)) throw unsupported(`${what} sur ${name.toUpperCase()}(…) : seul le tableau entier ${name.toUpperCase()} est accepté`, p.peek());
    return node({ name });
  }
  if (!p.check(TokenType.LPAREN)) {
    if (options.wholeDs) return node({ name });
    throw wholeDsArray(name, nameToken);
  }
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

// %SUBARR(tableau : début {: nombre}) : la portion d'un tableau, bornée à l'exécution
function parseSubarr(p: ParserState, options: OperandOptions): ExpressionNode {
  const token = p.advance();
  p.expect(TokenType.LPAREN);
  const operand = parseArrayOperand(p, '%SUBARR', { wholeDs: options.wholeDs });
  if (!p.check(TokenType.COLON)) throw new Error(`%SUBARR attend au moins 2 arguments : %SUBARR(tableau : début {: nombre}) (ligne ${token.line})`);
  p.advance();
  const start = parseExpression(p);
  let count: ExpressionNode | undefined;
  if (p.check(TokenType.COLON)) {
    p.advance();
    count = parseExpression(p);
  }
  if (!p.check(TokenType.RPAREN)) throw new Error(`%SUBARR accepte au plus 3 arguments (ligne ${token.line})`);
  p.advance();
  return { ...operand, value: { ...operand.value, start, count } };
}

// Opérande %SUBARR d'un tableau entier (FOR-EACH, CLEAR, RESET) : la sous-zone d(*).champ y est refusée
export function parseWholeSubarr(p: ParserState, what: string): { name: string; start: ExpressionNode; count?: ExpressionNode } {
  const token = p.peek();
  const { name, field, start, count } = parseArrayOperand(p, what, { subarr: true, wholeDs: true }).value;
  if (field) throw unsupported(`${what} %SUBARR(${name.toUpperCase()}(*).${field.toUpperCase()})`, token);
  return { name, start, count };
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
