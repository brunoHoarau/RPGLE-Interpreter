import { TokenType, DimNode } from '../../types';
import { ParserState } from '../state';
import { unsupported } from '../constants';

const MAX_DIM = 16773104;

// Taille de DIM : littéral entier ou constante nommée (littéral entier)
function parseDimSize(p: ParserState): number {
  const token = p.advance();
  let text = token.value;
  if (token.type !== TokenType.NUMBER) {
    const constant = p.constants.get(token.value.toLowerCase());
    if (!constant) throw new Error(`DIM : '${token.value}' n'est pas une constante déclarée (ligne ${token.line})`);
    if (constant.valueType !== 'number') throw unsupported(`DIM(${token.value.toUpperCase()}) avec une constante qui n'est pas un littéral numérique`, token);
    text = String(constant.value);
  }
  if (!/^[0-9]+$/.test(text) || parseInt(text) < 1 || parseInt(text) > MAX_DIM) {
    throw new Error(`DIM(${text}) invalide à la ligne ${token.line} : un entier compris entre 1 et ${MAX_DIM} est attendu`);
  }
  return parseInt(text);
}

// DIM(n) ou DIM(*AUTO : n) ; le mot DIM est déjà consommé. DIM(*VAR : n) est refusé.
export function parseDim(p: ParserState): DimNode {
  p.expect(TokenType.LPAREN);
  const first = p.peek();
  let auto = false;
  if (first.type === TokenType.SPECIAL_VALUE) {
    if (first.value !== '*auto') throw unsupported(`DIM(${first.value.toUpperCase()}...)`, first);
    p.advance();
    auto = true;
    if (!p.check(TokenType.COLON)) throw new Error(`DIM(*AUTO) exige la taille maximale : DIM(*AUTO : n) (ligne ${first.line})`);
    p.advance();
  }
  const max = parseDimSize(p);
  p.expect(TokenType.RPAREN);
  return { max, auto };
}
