import { Token, TokenType, ASTNode, DataTypeNode } from '../../types';
import { byteLength } from '../../datatypes';
import { ParserState } from '../state';
import { unsupported } from '../constants';
import { rememberDateTime } from './variables';
import { parseDeclarationKeywords, parseDataType } from './keywords';

export function parseDataStructure(p: ParserState): ASTNode {
  p.expect(TokenType.DCL_DS);
  const name = p.expectName().value;
  p.readOnlyNames.delete(name.toLowerCase());
  let isQualified = false;
  const fields: any[] = [];
  const layout: { name: string; type: DataTypeNode; pos?: number; token: Token }[] = [];

  // 1. Options de la DS jusqu'au ';' : QUALIFIED et INZ sont supportés
  while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
    const token = p.peek();
    const word = token.type === TokenType.IDENTIFIER ? token.value.toLowerCase() : '';
    if (word === 'qualified') {
      p.advance();
      isQualified = true;
    } else if (word === 'inz' && p.peekNext()?.type !== TokenType.LPAREN) {
      p.advance(); // INZ seul : valeurs par défaut, déjà le comportement
    } else {
      throw unsupported(`Le mot-clé ${token.value.toUpperCase()} de DCL-DS`, token);
    }
  }
  p.expect(TokenType.SEMICOLON);

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
