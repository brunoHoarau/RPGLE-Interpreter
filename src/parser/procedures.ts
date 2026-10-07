import { TokenType, ASTNode, DataTypeNode, ParameterNode } from '../types';
import { ParserState } from './state';
import { unsupported } from './constants';
import { parseVariableDeclaration, parseConstantDeclaration, rememberDateTime } from './declarations/variables';
import { parseDataType } from './declarations/keywords';
import { parseDataStructure } from './declarations/data-structure';
import { parseStatement } from './statements/statement';

export function parseProcedure(p: ParserState): ASTNode {
  p.expect(TokenType.DCL_PROC);
  const name = p.expectName().value;
  p.skipToSemicolon(); // Mots-clés : export, etc.

  let returnType: DataTypeNode | undefined;
  let parameters: ParameterNode[] = [];
  const body: ASTNode[] = [];
  const outerNames = new Set(p.dateTimeNames);
  const outerReadOnly = new Map(p.readOnlyNames);

  while (!p.check(TokenType.END_PROC) && !p.isAtEnd()) {
    if (p.check(TokenType.DCL_PI)) {
      ({ returnType, parameters } = parseProcedureInterface(p));
    } else if (p.check(TokenType.DCL_S)) {
      body.push(parseVariableDeclaration(p));
    } else if (p.check(TokenType.DCL_C)) {
      body.push(parseConstantDeclaration(p));
    } else if (p.check(TokenType.DCL_DS)) {
      body.push(parseDataStructure(p));
    } else if (p.check(TokenType.DCL_PR)) {
      body.push(parsePrototype(p));
    } else if (p.check(TokenType.DCL_F)) {
      throw unsupported('DCL-F dans une procédure', p.peek());
    } else {
      body.push(parseStatement(p));
    }
  }

  p.expect(TokenType.END_PROC);
  p.dateTimeNames = outerNames; // Les noms locaux disparaissent avec la procédure
  p.readOnlyNames = outerReadOnly;
  p.skipToSemicolon(); // end-proc peut répéter le nom

  return { type: 'Procedure', name, returnType, parameters, body };
}

// dcl-pi nom|*n [type-retour] [mots-clés]; paramètres... end-pi;
export function parseProcedureInterface(p: ParserState): { returnType?: DataTypeNode; parameters: ParameterNode[] } {
  p.expect(TokenType.DCL_PI);
  if (!p.isName() && !p.check(TokenType.SPECIAL_VALUE)) {
    throw new Error(`Nom ou *N attendu après DCL-PI à la ligne ${p.peek().line}`);
  }
  p.advance();

  const next = p.peek();
  const isLikeKeyword = next.type === TokenType.IDENTIFIER && /^like(ds|rec)?$/i.test(next.value);
  const returnType = p.isTypeToken() || isLikeKeyword ? parseDataType(p) : undefined;
  // Autres mots-clés de l'interface (EXTPGM, EXTPROC...) : sans effet ici
  while (!p.check(TokenType.SEMICOLON) && !p.check(TokenType.END_PI) && !p.isAtEnd()) {
    if (p.advance().type === TokenType.IDENTIFIER && p.check(TokenType.LPAREN)) p.skipParenthesized();
  }

  const parameters: ParameterNode[] = [];
  if (p.check(TokenType.END_PI)) {
    // Forme courte : dcl-pi *n end-pi;
    p.advance();
    p.expect(TokenType.SEMICOLON);
    return { returnType, parameters };
  }
  p.expect(TokenType.SEMICOLON);

  while (!p.check(TokenType.END_PI) && !p.isAtEnd()) {
    parameters.push(parseParameter(p, parameters.length + 1, false));
  }
  p.expect(TokenType.END_PI);
  p.skipToSemicolon();

  parameters.forEach(param => {
    rememberDateTime(p, param.name, param.dataType);
    if (param.isConst) p.readOnlyNames.set(param.name.toLowerCase(), 'un paramètre CONST');
  });
  return { returnType, parameters };
}

// *N (paramètre sans nom) n'existe que dans un prototype : nom interne *N(position)
export function parseParameter(p: ParserState, position: number, allowUnnamed: boolean): ParameterNode {
  const unnamed = allowUnnamed && p.check(TokenType.SPECIAL_VALUE) && p.peek().value.toLowerCase() === '*n';
  if (unnamed) p.advance();
  const name = unnamed ? `*N(${position})` : p.expectName().value;
  const dataType: DataTypeNode = parseDataType(p);
  let isConst = false;
  let byValue = false;
  const options: string[] = [];

  while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
    const token = p.advance();
    const keyword = token.value.toLowerCase();
    if (keyword === 'const') {
      isConst = true;
    } else if (keyword === 'value') {
      byValue = true;
    } else if (keyword === 'options' && p.check(TokenType.LPAREN)) {
      p.advance();
      while (!p.check(TokenType.RPAREN) && !p.isAtEnd()) {
        const option = p.advance();
        if (option.type === TokenType.COLON) continue;
        if (option.value.toLowerCase() !== '*nopass') {
          throw unsupported(`OPTIONS(${option.value.toUpperCase()})`, option);
        }
        options.push('*nopass');
      }
      p.expect(TokenType.RPAREN);
    } else {
      throw unsupported(`Le mot-clé ${token.value.toUpperCase()} de paramètre`, token);
    }
  }
  p.expect(TokenType.SEMICOLON);

  return { type: 'Parameter', name, dataType, isConst, byValue, options };
}

// dcl-pr nom [type-retour] [EXTPGM['nom'] | EXTPROC['nom']] ; paramètres... end-pr;
// Sans EXTPGM ni EXTPROC, le prototype désigne une procédure du même nom.
export function parsePrototype(p: ParserState): ASTNode {
  p.expect(TokenType.DCL_PR);
  const name = p.expectName().value;

  const next = p.peek();
  const isLikeKeyword = next.type === TokenType.IDENTIFIER && /^like(ds|rec)?$/i.test(next.value);
  const returnType = p.isTypeToken() || isLikeKeyword ? parseDataType(p) : undefined;

  let kind: 'program' | 'procedure' = 'procedure';
  let externalName = name;
  while (!p.check(TokenType.SEMICOLON) && !p.check(TokenType.END_PR) && !p.isAtEnd()) {
    const token = p.advance();
    const keyword = token.value.toLowerCase();
    if (keyword === 'extpgm' || keyword === 'extproc') {
      kind = keyword === 'extpgm' ? 'program' : 'procedure';
      if (p.check(TokenType.LPAREN)) {
        p.advance();
        const target = p.advance();
        if (target.type !== TokenType.STRING) {
          throw unsupported(`${keyword.toUpperCase()} avec un nom non littéral`, target);
        }
        externalName = target.value;
        p.expect(TokenType.RPAREN);
      }
    } else if (p.check(TokenType.LPAREN)) {
      p.skipParenthesized(); // OPDESC, RTNPARM... : sans effet ici
    }
  }

  const parameters: ParameterNode[] = [];
  if (p.check(TokenType.END_PR)) {
    // Forme courte : dcl-pr nom extpgm end-pr;
    p.advance();
    p.expect(TokenType.SEMICOLON);
  } else {
    p.expect(TokenType.SEMICOLON);
    while (!p.check(TokenType.END_PR) && !p.isAtEnd()) {
      parameters.push(parseParameter(p, parameters.length + 1, true));
    }
    p.expect(TokenType.END_PR);
    p.skipToSemicolon();
  }

  return { type: 'Prototype', name, kind, externalName, returnType, parameters };
}
