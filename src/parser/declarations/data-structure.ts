import { Token, TokenType, ASTNode, DataTypeNode, DsLike } from '../../types';
import { byteLength } from '../../datatypes';
import { ParserState } from '../state';
import { unsupported } from '../constants';
import { rememberDateTime } from './variables';
import { parseDeclarationKeywords, parseDataType } from './keywords';
import { parseLikeDs, parseLikeRec, parseExtname, rememberDsLike } from './ds-like';

export function parseDataStructure(p: ParserState): ASTNode {
  p.expect(TokenType.DCL_DS);
  const name = p.expectName().value;
  p.readOnlyNames.delete(name.toLowerCase());
  let isQualified = false;
  let like: DsLike | undefined;
  let inlineEnd = false;
  let inzLike: Token | undefined;
  const fields: any[] = [];
  const layout: { name: string; type: DataTypeNode; pos?: number; token: Token }[] = [];

  // 1. Options de la DS jusqu'au ';' : QUALIFIED, INZ, LIKEDS, LIKEREC et EXTNAME sont supportés
  while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
    const token = p.peek();
    const word = token.type === TokenType.IDENTIFIER ? token.value.toLowerCase() : '';
    const next = p.peekNext();
    if (word === 'qualified') {
      p.advance();
      isQualified = true;
    } else if (word === 'inz' && next?.type !== TokenType.LPAREN) {
      p.advance(); // INZ seul : valeurs par défaut, déjà le comportement
    } else if (word === 'inz' && next?.type === TokenType.LPAREN && p.tokens[p.pos + 2]?.value.toLowerCase() === '*likeds'
               && p.tokens[p.pos + 3]?.type === TokenType.RPAREN) {
      p.pos += 4;
      inzLike = token;
    } else if ((word === 'likeds' || word === 'likerec' || word === 'extname') && next?.type === TokenType.LPAREN) {
      p.advance();
      const found = word === 'likeds' ? parseLikeDs(p, token) : word === 'likerec' ? parseLikeRec(p) : parseExtname(p);
      if (like) throw new Error(`${like.kind.toUpperCase()} et ${word.toUpperCase()} ne peuvent pas être combinés sur la DS ${name.toUpperCase()} (ligne ${token.line})`);
      like = found;
    } else if (token.type === TokenType.END_DS && like?.kind === 'extname') {
      p.advance(); // dcl-ds d extname('F') end-ds;
      inlineEnd = true;
    } else {
      throw unsupported(`Le mot-clé ${token.value.toUpperCase()} de DCL-DS`, token);
    }
  }
  p.expect(TokenType.SEMICOLON);
  if (inzLike && like?.kind !== 'likeds') {
    throw new Error(`INZ(*LIKEDS) sans le mot-clé LIKEDS sur la DS ${name.toUpperCase()} (ligne ${inzLike.line})`);
  }

  if (like && like.kind !== 'extname') {
    // LIKEDS / LIKEREC : pas de sous-zones ni de END-DS ; toujours qualifiée
    if (inzLike) like.inzLike = true;
    rememberDsLike(p, name, like);
    return { type: 'DataStructure', name, isQualified: true, fields, like };
  }
  if (like) {
    // EXTNAME : sous-zones tirées de la table à l'exécution, donc aucune déclarée ici
    if (!inlineEnd) {
      if (!p.check(TokenType.END_DS)) throw unsupported('Sous-zones déclarées dans une DS EXTNAME', p.peek());
      p.advance();
      p.skipToSemicolon();
    }
    rememberDsLike(p, name, like);
    return { type: 'DataStructure', name, isQualified, fields, like };
  }

  // 2. Champs jusqu'à 'end-ds'
  while (!p.check(TokenType.END_DS) && !p.isAtEnd()) {
    const fieldToken = p.peek();
    const fieldName = p.expectName().value;
    const fieldType = parseDataType(p);
    rememberDateTime(p, `${name}.${fieldName}`, fieldType);
    if (!isQualified) rememberDateTime(p, fieldName, fieldType);
    const position: { pos?: number } = {};
    const initialValue = parseDeclarationKeywords(p, 'champ de DS', fieldType, position, fieldName);
    p.expect(TokenType.SEMICOLON);
    layout.push({ name: fieldName, type: fieldType, pos: position.pos, token: fieldToken });
    fields.push({ name: fieldName, dataType: fieldType, initialValue });
  }

  p.expect(TokenType.END_DS);
  p.skipToSemicolon(); // end-ds peut répéter le nom
  checkFieldLayout(p, layout);

  p.dsInfo.set(name.toLowerCase(), { fields: fields.map(field => ({ name: field.name, dataType: field.dataType })) });
  return { type: 'DataStructure', name, isQualified, fields };
}

// Les champs sont des valeurs indépendantes : un recouvrement d'octets (via POS) ne serait pas fidèle
export function checkFieldLayout(p: ParserState, layout: { name: string; type: DataTypeNode; pos?: number; token: Token }[]): void {
  if (!layout.some(f => f.pos !== undefined)) return;
  const placed: { name: string; start: number; end: number }[] = [];
  let nextByte = 1;
  let maxEnd = 0;
  for (const field of layout) {
    const type = field.type;
    if (type.length === undefined && ['char', 'varchar', 'zoned', 'packed'].includes(type.typeName)) {
      throw new Error(`Longueur manquante pour le champ ${field.name.toUpperCase()} (POS) à la ligne ${field.token.line}`);
    }
    if (type.typeName === 'varchar' && type.decimals !== undefined && type.decimals !== 2 && type.decimals !== 4) {
      throw unsupported(`VARCHAR(${type.length}:${type.decimals})`, field.token);
    }
    if (field.pos === undefined && nextByte !== maxEnd + 1) {
      throw unsupported(`Champ de DS sans POS après un POS en arrière (${field.name.toUpperCase()})`, field.token);
    }
    const start = field.pos ?? nextByte;
    const end = start + byteLength(type) - 1;
    const clash = placed.find(p => start <= p.end && p.start <= end);
    if (clash) throw unsupported(`Champs de DS qui se chevauchent (${clash.name.toUpperCase()} et ${field.name.toUpperCase()})`, field.token);
    placed.push({ name: field.name, start, end });
    nextByte = end + 1;
    maxEnd = Math.max(maxEnd, end);
  }
}
