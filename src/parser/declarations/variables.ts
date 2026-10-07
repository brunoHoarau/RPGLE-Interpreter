import { TokenType, ASTNode, ExpressionNode, DataTypeNode } from '../../types';
import { isDateTimeType } from '../../datetime';
import { ParserState } from '../state';
import { unsupported } from '../constants';
import { parseDeclarationKeywords, parseDataType } from './keywords';
import { parseExpression } from '../expressions/operators';

// Options sans effet ici, sauf DATFMT et TIMFMT : un autre format que *ISO changerait les dates
export function parseControlOptions(p: ParserState): ASTNode {
  p.expect(TokenType.CTL_OPT);
  while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
    const keyword = p.advance().value.toLowerCase();
    if ((keyword === 'datfmt' || keyword === 'timfmt') && p.check(TokenType.LPAREN)) {
      p.advance();
      const format = p.advance();
      if (format.value.toLowerCase() !== '*iso' || !p.check(TokenType.RPAREN)) {
        const text = `${format.value}${p.check(TokenType.RPAREN) ? '' : p.peek().value}`.toUpperCase();
        throw unsupported(`CTL-OPT ${keyword.toUpperCase()}(${text})`, format);
      }
    }
  }
  p.expect(TokenType.SEMICOLON);
  return { type: 'ControlOptions' } as any;
}

export function parseVariableDeclaration(p: ParserState): ASTNode {
  p.expect(TokenType.DCL_S);
  const name = p.expectName().value;
  const dataType = parseDataType(p);
  rememberDateTime(p, name, dataType);
  const initialValue = parseDeclarationKeywords(p, 'DCL-S', dataType);
  p.expect(TokenType.SEMICOLON);
  return { type: 'VariableDeclaration', name, dataType, initialValue };
}

export function parseConstantDeclaration(p: ParserState): ASTNode {
  p.expect(TokenType.DCL_C);
  const name = p.expectName().value;
  const value = parseExpression(p);
  p.expect(TokenType.SEMICOLON);
  p.readOnlyNames.set(name.toLowerCase(), 'une constante');
  p.constants.set(name.toLowerCase(), value);
  return { type: 'ConstantDeclaration', name, value };
}

// Une déclaration d'un autre type masque un nom date homonyme (variable locale)
export function rememberDateTime(p: ParserState, name: string, dataType: DataTypeNode): void {
  p.readOnlyNames.delete(name.toLowerCase()); // Une déclaration locale masque la constante
  if (isDateTimeType(dataType.typeName)) {
    p.dateTimeNames.add(name.toLowerCase());
  } else {
    p.dateTimeNames.delete(name.toLowerCase());
  }
}

// Valeurs spéciales permises dans INZ selon le type déclaré
export function inzSpecials(p: ParserState, dataType: DataTypeNode): string[] {
  if (dataType.typeName === 'date') return ['*loval', '*hival', '*sys', '*job'];
  if (isDateTimeType(dataType.typeName)) return ['*loval', '*hival', '*sys'];
  return [];
}

// Valeur spéciale propre aux dates à la position courante, si elle est permise ici
// (et suivie du token de fin attendu, s'il est donné)
export function parseDateTimeSpecial(p: ParserState, allowed: string[], end?: TokenType): ExpressionNode | undefined {
  const token = p.peek();
  if (token.type !== TokenType.SPECIAL_VALUE || !allowed.includes(token.value)) return undefined;
  if (end !== undefined && p.peekNext()?.type !== end) return undefined;
  p.advance();
  return { type: 'Expression', value: token.value, valueType: 'special' };
}
