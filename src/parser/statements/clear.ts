import { TokenType, ASTNode } from '../../types';
import { ParserState } from '../state';
import { INDICATOR, unsupported } from '../constants';
import { isOpcode } from '../subroutines';
import { checkWritable } from './assignment';
import { parseElement, wholeDsArray } from '../expressions/element';

// CLEAR/RESET cible ; : le mot est un code opération et non une variable (clear = 1) ni un appel (clear(x))
export const isClear = (p: ParserState): boolean => isOpcode(p, 'clear') || isOpcode(p, 'reset');

// CLEAR | RESET nom | nom.champ | tab(i) | ds(i) | ds(i).champ | *INnn
// CLEAR : valeur par défaut du type, INZ ignoré ; RESET : valeur de fin d'initialisation.
// *NOKEY, *ALL et les noms de fichier sont refusés ici ; un nom de format ou une cible non déclarée, à l'exécution.
export function parseClear(p: ParserState): ASTNode {
  const opToken = p.advance();
  const op = opToken.value.toUpperCase();
  const type = op === 'RESET' ? 'Reset' : 'Clear';
  const token = p.peek();
  const line = opToken.line;
  if (token.type === TokenType.SPECIAL_VALUE) {
    const word = token.value.toLowerCase();
    if (word === '*nokey' || word === '*all') throw unsupported(`${op} ${word.toUpperCase()}`, token);
    if (!INDICATOR.test(word)) throw new Error(`${op} n'accepte pas ${token.value.toUpperCase()} (ligne ${token.line})`);
    p.advance();
    p.expect(TokenType.SEMICOLON);
    return { type, name: word, line } as ASTNode;
  }
  if (!p.isName()) throw new Error(`${op} attend un nom de variable (ligne ${token.line})`);
  const nameToken = p.advance();
  let name = nameToken.value;
  if (p.fileNames.has(name.toUpperCase())) throw unsupported(`${op} du fichier ${name.toUpperCase()}`, nameToken);
  const info = p.arrayNames.get(name.toLowerCase());
  if (info && p.check(TokenType.LPAREN)) {
    checkWritable(p, name, line);
    const target = parseElement(p, nameToken, false);
    p.expect(TokenType.SEMICOLON);
    return { type, name, target, line } as ASTNode;
  }
  if (info?.ds && p.check(TokenType.DOT)) throw wholeDsArray(name, nameToken);
  while (p.check(TokenType.DOT)) {
    p.advance();
    name += `.${p.expectName().value}`;
  }
  checkWritable(p, name, line);
  p.expect(TokenType.SEMICOLON);
  return { type, name, line } as ASTNode;
}
