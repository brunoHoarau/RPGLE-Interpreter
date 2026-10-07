import { TokenType, ExpressionNode, DataTypeNode } from '../../types';
import { DateTimeKind, isDateTimeType } from '../../datetime';
import { ParserState } from '../state';
import { TYPE_TOKENS, UNSUPPORTED_TYPE_TOKENS, unsupported } from '../constants';
import { inzSpecials, parseDateTimeSpecial } from './variables';
import { parseExpression } from '../expressions/operators';

// Mots-clés d'une déclaration jusqu'au ';' : INZ, et POS pour un champ de DS (rangé dans fieldPos).
// Renvoie la valeur de INZ(...), undefined pour INZ seul (valeur par défaut du type).
export function parseDeclarationKeywords(p: ParserState, context: string, dataType: DataTypeNode, fieldPos?: { pos?: number }, fieldName = ''): ExpressionNode | undefined {
  let initialValue: ExpressionNode | undefined;
  while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
    const token = p.peek();
    if (token.type === TokenType.IDENTIFIER && token.value.toLowerCase() === 'inz') {
      p.advance();
      if (p.check(TokenType.LPAREN)) {
        p.advance();
        initialValue = parseDateTimeSpecial(p, inzSpecials(p, dataType), TokenType.RPAREN) ?? parseExpression(p);
        p.expect(TokenType.RPAREN);
      }
    } else if (fieldPos && token.type === TokenType.IDENTIFIER && token.value.toLowerCase() === 'pos') {
      p.advance();
      if (fieldPos.pos !== undefined) throw new Error(`POS indiqué deux fois pour le champ ${fieldName.toUpperCase()} à la ligne ${token.line}`);
      p.expect(TokenType.LPAREN);
      const arg = p.advance();
      if (arg.type !== TokenType.NUMBER || !/^[0-9]+$/.test(arg.value) || parseInt(arg.value) < 1 || arg.value.length > 8 || parseInt(arg.value) > 16773104 || !p.check(TokenType.RPAREN)) {
        throw new Error(`POS(${arg.type === TokenType.RPAREN ? '' : arg.value}) invalide à la ligne ${arg.line} : un entier compris entre 1 et 16773104 est attendu`);
      }
      p.advance();
      fieldPos.pos = parseInt(arg.value);
    } else {
      throw unsupported(`Le mot-clé ${token.value.toUpperCase()} de ${context}`, token);
    }
  }
  return initialValue;
}

export function parseDataType(p: ParserState): any {
  const typeToken = p.peek();
  if (UNSUPPORTED_TYPE_TOKENS.includes(typeToken.type)) {
    throw unsupported(`Le type ${typeToken.value.toUpperCase()}`, typeToken);
  }
  if (!TYPE_TOKENS.includes(typeToken.type)) {
    if (typeToken.type === TokenType.IDENTIFIER) {
      const word = typeToken.value.toLowerCase();
      const what = word === 'like' || word === 'likeds' || word === 'likerec' ? 'Le mot-clé' : 'Le type';
      throw unsupported(`${what} ${typeToken.value.toUpperCase()}`, typeToken);
    }
    throw new Error(`Type attendu à la ligne ${typeToken.line}, reçu '${typeToken.value}'`);
  }
  p.advance();
  const typeName = typeToken.value;
  if (isDateTimeType(typeName)) return parseDateTimeType(p, typeName);
  let length: number | undefined;
  let decimals: number | undefined;
  let format: string | undefined;

  if (p.check(TokenType.LPAREN)) {
    p.advance();
    length = parseInt(p.expect(TokenType.NUMBER).value);

    if (p.check(TokenType.COLON)) {
      p.advance();
      decimals = parseInt(p.expect(TokenType.NUMBER).value);
    }

    if (p.check(TokenType.IDENTIFIER) || p.check(TokenType.SPECIAL_VALUE)) {
      format = p.advance().value;
    }

    p.expect(TokenType.RPAREN);
  }

  return { type: 'DataType', typeName, length, decimals, format };
}

// date | date(*ISO) | time | time(*ISO) | timestamp | timestamp(6) : seul le format *ISO est supporté
export function parseDateTimeType(p: ParserState, typeName: DateTimeKind): DataTypeNode {
  if (p.check(TokenType.LPAREN)) {
    p.advance();
    const arg = p.advance();
    if (typeName === 'timestamp') {
      if (arg.type !== TokenType.NUMBER || parseInt(arg.value) !== 6 || !p.check(TokenType.RPAREN)) {
        throw unsupported(`TIMESTAMP(${arg.value})`, arg);
      }
    } else if (arg.value.toLowerCase() !== '*iso' || !p.check(TokenType.RPAREN)) {
      const text = `${arg.value}${p.check(TokenType.RPAREN) ? '' : p.peek().value}`.toUpperCase();
      throw unsupported(`Le format ${text} de ${typeName.toUpperCase()}`, arg);
    }
    p.expect(TokenType.RPAREN);
  }
  return { type: 'DataType', typeName };
}
