import { TokenType, ExpressionNode } from '../../types';
import { isSupportedBuiltin } from '../../builtins';
import { parseIso, unitFromName } from '../../datetime';
import { ParserState } from '../state';
import { DATETIME_LITERALS, FILE_BUILTINS, INDICATOR, SUPPORTED_SPECIAL_VALUES, NO_ARGUMENT_BUILTINS, FORMAT_BUILTINS, UNIT_ARGUMENT, BUILTIN_ARITY, unsupported } from '../constants';
import { requireFile } from '../files';
import { parseCallArguments } from '../statements/assignment';
import { parseExpression } from './operators';

// Unité de %DIFF / %SUBDT : *YEARS, *Y, *MONTHS, *M... ; inconnue : erreur, comme à la compilation
export function isUnitToken(p: ParserState): boolean {
  const token = p.peek();
  return token.type === TokenType.SPECIAL_VALUE && !!unitFromName(token.value);
}

export function parseUnitArgument(p: ParserState, builtin: string): ExpressionNode {
  const token = p.peek();
  if (token.type !== TokenType.SPECIAL_VALUE || !unitFromName(token.value)) {
    throw new Error(`${builtin.toUpperCase()} : unité ${token.value.toUpperCase()} inconnue (ligne ${token.line})`);
  }
  p.advance();
  return { type: 'Expression', value: token.value.toLowerCase(), valueType: 'special' };
}

// 2e argument de %CHAR / %DATE / %TIME / %TIMESTAMP : seul %CHAR(x : *ISO) est supporté
export function parseFormatArgument(p: ParserState, builtin: string): ExpressionNode {
  const token = p.peek();
  if (builtin.toLowerCase() === '%char' && token.type === TokenType.SPECIAL_VALUE && token.value.toLowerCase() === '*iso') {
    p.advance();
    return { type: 'Expression', value: '*iso', valueType: 'special' };
  }
  throw unsupported(`${builtin.toUpperCase()} avec le 2e argument ${token.value.toUpperCase()}`, token);
}

export function parsePrimary(p: ParserState): ExpressionNode {
  if (p.check(TokenType.NUMBER)) {
    const text = p.advance().value;
    const node: ExpressionNode = { type: 'Expression', value: parseFloat(text), valueType: 'number' };
    if (text.includes('.')) node.hasDecimalPoint = true;
    return node;
  }

  if (p.check(TokenType.STRING)) {
    const value = p.advance().value;
    return { type: 'Expression', value, valueType: 'string' };
  }

  const literalKind = DATETIME_LITERALS.get(p.peek().type);
  if (literalKind) {
    const token = p.advance();
    const value = parseIso(literalKind, token.value);
    if (!value) {
      const letter = { date: 'D', time: 'T', timestamp: 'Z' }[literalKind];
      throw new Error(`${letter}'${token.value}' : littéral ${literalKind.toUpperCase()} invalide (ligne ${token.line})`);
    }
    return { type: 'Expression', value, valueType: 'datetime' };
  }

  if (p.check(TokenType.SPECIAL_VALUE)) {
    const token = p.advance();
    const value = token.value.toLowerCase();
    if (!SUPPORTED_SPECIAL_VALUES.has(value) && !INDICATOR.test(value)) {
      throw unsupported(`La valeur spéciale ${value.toUpperCase()}`, token);
    }
    return { type: 'Expression', value, valueType: 'special' };
  }

  if (p.check(TokenType.BUILTIN)) {
    const token = p.advance();
    const name = token.value;
    if (!isSupportedBuiltin(name)) {
      throw unsupported(`La fonction ${name.toUpperCase()}`, token);
    }
    // %EOF, %FOUND, %EQUAL, %OPEN : l'argument est un nom de fichier, non évalué
    if (FILE_BUILTINS.has(name.toLowerCase())) {
      const args: ExpressionNode[] = [];
      if (p.check(TokenType.LPAREN) && p.peekNext()?.type === TokenType.RPAREN) {
        p.advance(); p.advance(); // %EOF() équivaut à %EOF
        if (name.toLowerCase() === '%open') throw new Error(`%OPEN attend un nom de fichier (ligne ${token.line})`);
      } else if (p.check(TokenType.LPAREN)) {
        p.advance();
        const fileToken = p.expectName();
        requireFile(p, fileToken.value, fileToken.line, true);
        args.push({ type: 'Expression', value: fileToken.value, valueType: 'file' });
        p.expect(TokenType.RPAREN);
      } else if (name.toLowerCase() === '%open') {
        throw new Error(`%OPEN attend un nom de fichier (ligne ${token.line})`);
      }
      return { type: 'Expression', value: { name, args }, valueType: 'builtin' };
    }
    // %DATE, %TIME et %TIMESTAMP sont valides sans parenthèses
    if (NO_ARGUMENT_BUILTINS.has(name.toLowerCase()) && !p.check(TokenType.LPAREN)) {
      return { type: 'Expression', value: { name, args: [] }, valueType: 'builtin' };
    }
    p.expect(TokenType.LPAREN);
    const args: ExpressionNode[] = [];

    const lower = name.toLowerCase();
    while (!p.check(TokenType.RPAREN)) {
      if (args.length === 2 && lower === '%char') {
        throw new Error(`%CHAR accepte au plus 2 arguments (ligne ${token.line})`);
      }
      if (args.length === 2 && lower === '%subdt') {
        throw unsupported('%SUBDT avec plus de 2 arguments', p.peek());
      }
      if (args.length === 1 && FORMAT_BUILTINS.has(lower)) {
        args.push(parseFormatArgument(p, name));
      } else if (UNIT_ARGUMENT.has(lower) && (UNIT_ARGUMENT.get(lower) === args.length || isUnitToken(p))) {
        args.push(parseUnitArgument(p, name));
      } else {
        args.push(parseExpression(p));
      }
      if (p.check(TokenType.COLON) || p.check(TokenType.COMMA)) {
        p.advance();
      }
    }

    p.expect(TokenType.RPAREN);
    const arity = BUILTIN_ARITY[lower];
    if (arity !== undefined && args.length !== arity) {
      throw new Error(`${name.toUpperCase()} attend ${arity} argument${arity > 1 ? 's' : ''} (ligne ${token.line})`);
    }
    return { type: 'Expression', value: { name, args }, valueType: 'builtin' };
  }

  if (p.isName()) {
      // 🔥 CORRECTION : Gérer la notation pointée dans les expressions
      let name = p.advance().value;

      // Si on a un '.', on continue à lire les parties suivantes
      while (p.check(TokenType.DOT)) {
          p.advance(); // Consomme le '.'
          const nextPart = p.expectName().value;
          name += '.' + nextPart;
      }

      if (p.check(TokenType.LPAREN)) {
          const args = parseCallArguments(p);
          return { type: 'Expression', value: { name, args }, valueType: 'call' };
      }

      return { type: 'Expression', value: name, valueType: 'identifier' };
  }

  if (p.check(TokenType.LPAREN)) {
    p.advance();
    const expr = parseExpression(p);
    p.expect(TokenType.RPAREN);
    return expr;
  }

  throw new Error(`Expression inattendue à la ligne ${p.peek().line}`);
}
