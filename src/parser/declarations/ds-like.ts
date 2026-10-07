import { Token, TokenType, DsLike, DataTypeNode } from '../../types';
import { ParserState } from '../state';
import { unsupported } from '../constants';
import { rememberDateTime } from './variables';

const USAGES = ['*all', '*input', '*output', '*key'];

// Paramètre `nom likeds(ds)` ou `nom likerec(format {: usage})` : l'identifiant est suivi d'une parenthèse
export function isDsLikeParameter(p: ParserState): boolean {
  const token = p.peek();
  return token.type === TokenType.IDENTIFIER && /^like(ds|rec)$/i.test(token.value) && p.peekNext()?.type === TokenType.LPAREN;
}

export function parseDsLikeParameter(p: ParserState): DataTypeNode {
  const keyword = p.advance();
  const like = keyword.value.toLowerCase() === 'likeds' ? parseLikeDs(p, keyword) : parseLikeRec(p);
  return { type: 'DataType', typeName: 'ds', like };
}

// Une DS déclarée : ses sous-zones connues de l'analyse (LIKEDS en hérite), pour les contrôles qui en dépendent
export function rememberDsLike(p: ParserState, name: string, like: DsLike): void {
  const source = like.kind === 'likeds' ? p.dsInfo.get(like.name.toLowerCase()) : undefined;
  const fields = source ? source.fields : [];
  p.dsInfo.set(name.toLowerCase(), { fields });
  for (const field of fields) rememberDateTime(p, `${name}.${field.name}`, field.dataType);
}

// Après le mot LIKEDS : ( ds )
export function parseLikeDs(p: ParserState, keyword: Token): DsLike {
  p.expect(TokenType.LPAREN);
  const name = p.expectName();
  if (p.check(TokenType.DOT)) throw unsupported('LIKEDS d\'une sous-zone', name);
  p.expect(TokenType.RPAREN);
  if (!p.dsInfo.has(name.value.toLowerCase())) {
    throw new Error(`LIKEDS(${name.value.toUpperCase()}) : ${name.value.toUpperCase()} n'est pas une structure de données déclarée avant (ligne ${keyword.line})`);
  }
  return { kind: 'likeds', name: name.value, usage: 'none' };
}

// Après le mot LIKEREC : ( format {: *ALL | *INPUT | *OUTPUT | *KEY} )
export function parseLikeRec(p: ParserState): DsLike {
  p.expect(TokenType.LPAREN);
  const format = p.expectName().value.toUpperCase();
  let usage: DsLike['usage'] = 'input';
  if (p.check(TokenType.COLON)) {
    p.advance();
    usage = parseUsageValue(p, 'LIKEREC');
  }
  p.expect(TokenType.RPAREN);
  return { kind: 'likerec', name: format, format, usage };
}

function parseUsageValue(p: ParserState, keyword: string): DsLike['usage'] {
  const token = p.advance();
  const value = token.value.toLowerCase();
  if (!USAGES.includes(value)) {
    throw new Error(`${keyword} : type d'extraction ${token.value.toUpperCase()} inconnu, *ALL, *INPUT, *OUTPUT ou *KEY attendu (ligne ${token.line})`);
  }
  return value.slice(1) as DsLike['usage'];
}

// Après le mot EXTNAME : ( fichier {: format} {: type d'extraction} ), fichier et format littéraux
// (ou constantes nommées déclarées avant) ; la bibliothèque éventuelle est ignorée
export function parseExtname(p: ParserState): DsLike {
  p.expect(TokenType.LPAREN);
  const like: DsLike = { kind: 'extname', name: extnameLiteral(p, true), usage: 'none' };
  let formatDone = false;
  while (p.check(TokenType.COLON)) {
    p.advance();
    if (p.check(TokenType.SPECIAL_VALUE) && p.peek().value.toLowerCase() !== '*null') {
      like.usage = parseUsageValue(p, 'EXTNAME');
      break;
    }
    if (formatDone) throw new Error(`EXTNAME : paramètre en trop (ligne ${p.peek().line})`);
    like.format = extnameLiteral(p, false);
    formatDone = true;
  }
  p.expect(TokenType.RPAREN);
  return like;
}

function extnameLiteral(p: ParserState, isFile: boolean): string {
  const token = p.peek();
  let value: string | undefined;
  if (token.type === TokenType.STRING) {
    value = token.value;
  } else if (token.type === TokenType.SPECIAL_VALUE && token.value.toLowerCase() === '*null') {
    throw unsupported('EXTNAME(*NULL)', token);
  } else if (token.type === TokenType.IDENTIFIER) {
    const constant = p.constants.get(token.value.toLowerCase());
    if (constant && constant.valueType === 'string') value = String(constant.value);
  }
  if (value === undefined) {
    throw new Error(`EXTNAME attend un littéral entre apostrophes ou une constante nommée pour ${isFile ? 'le fichier' : 'le format'} : `
      + `en free-form, écrivez EXTNAME('FICHIER') (ligne ${token.line})`);
  }
  p.advance();
  const literal = value.trim();
  if (/[a-z]/.test(literal)) {
    throw new Error(`EXTNAME('${literal}') : entre apostrophes, le nom est sensible à la casse `
      + `et les noms d'objets IBM i sont en majuscules : écrivez '${literal.toUpperCase()}' (ligne ${token.line})`);
  }
  const parts = literal.split('/');
  const name = parts[parts.length - 1];
  const wellFormed = isFile
    ? parts.length <= 2 && /^[A-Z0-9_#$@]+$/.test(name) && (parts.length === 1 || /^\*?[A-Z0-9_#$@]+$/.test(parts[0]))
    : /^[A-Z0-9_#$@]+$/.test(literal);
  if (!wellFormed) throw new Error(`EXTNAME('${literal}') : nom mal formé (ligne ${token.line})`);
  return name;
}
