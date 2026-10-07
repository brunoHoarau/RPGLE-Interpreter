import { Token, TokenType, ASTNode, ExpressionNode } from '../../types';
import { ParserState } from '../state';
import { DATETIME_LITERALS, unsupported } from '../constants';
import { checkWritable } from './assignment';
import { parseExpression } from '../expressions/operators';

export function parseDsply(p: ParserState): ASTNode {
  p.expect(TokenType.DSPLY);
  let hasErrorExtender = false;

  // 1. Extendeur (E) optionnel ; sinon une parenthèse ouvre le message : dsply ('...');
  const extender = p.peekNext();
  if (p.check(TokenType.LPAREN) && extender?.type === TokenType.IDENTIFIER &&
      extender.value.toLowerCase() === 'e' && p.tokens[p.pos + 2]?.type === TokenType.RPAREN) {
      p.advance();
      p.advance();
      p.advance();
      hasErrorExtender = true;
  }

  // 2. Collecter tous les paramètres jusqu'au ';'
  // DSPLY message {file-de-messages {réponse}} : la file peut être une valeur
  // spéciale (*EXT, *JOBLOG, *BLANK...)
  const line = p.peek().line;
  const params: ExpressionNode[] = [];
  while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
      if (params.length > 0 && p.check(TokenType.SPECIAL_VALUE)) {
          params.push({ type: 'Expression', value: p.advance().value.toLowerCase(), valueType: 'special' });
      } else {
          params.push(parseExpression(p));
      }
  }
  p.expect(TokenType.SEMICOLON);

  if (params.length > 3) {
      throw new Error(`DSPLY accepte au plus 3 opérandes (ligne ${line})`);
  }
  if (params[2] && params[2].valueType !== 'identifier') {
      throw new Error(`La réponse de DSPLY doit être une variable (ligne ${line})`);
  }
  if (params[2]) checkWritable(p, String(params[2].value), line);

  // 3. Assigner selon la position
  return {
      type: 'Dsply',
      hasErrorExtender,
      message: params[0],
      queue: params[1],
      responseVar: params[2]?.value
  } as any;
}

export function parseSQL(p: ParserState): ASTNode {
  p.expect(TokenType.EXEC_SQL);

  // Ignorer le mot "sql" s'il est présent juste après "exec"
  if (p.check(TokenType.IDENTIFIER) && p.peek().value.toLowerCase() === 'sql') {
      p.advance();
  }

  let sql = '';
  let previousTokenType: TokenType | null = null;

  while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
      const token = p.advance();
      if (DATETIME_LITERALS.has(token.type)) {
        throw unsupported('Un littéral date ou heure dans EXEC SQL', token);
      }
      if (token.type === TokenType.COLON) refuseDateHostVariable(p, token);

      // 🔥 CORRECTION DE LA LOGIQUE :
      // - noSpaceBefore : le token ACTUEL doit-il être collé au précédent ?
      // - previousNoSpaceAfter : le token PRÉCÉDENT force-t-il le collage ?
      const noSpaceBefore = token.type === TokenType.DOT;
      const previousNoSpaceAfter = previousTokenType === TokenType.COLON || previousTokenType === TokenType.DOT;

      // On ajoute un espace SI :
      // - Ce n'est pas le premier token
      // - Le token actuel ne force pas le collage AVANT
      // - Le token précédent ne force pas le collage APRÈS
      if (sql.length > 0 && !noSpaceBefore && !previousNoSpaceAfter) {
          sql += ' ';
      }

      // Le lexer retire les délimiteurs des chaînes : on les remet pour que
      // le moteur SQL distingue un littéral d'un nom de colonne.
      sql += token.type === TokenType.STRING
          ? `'${token.value.replace(/'/g, "''")}'`
          : token.value;
      previousTokenType = token.type;
  }

  // Variables hôtes de sortie (SELECT ... INTO :a, :b FROM) : ce sont des cibles d'affectation
  const into = !/^\s*select\b/i.test(sql) ? null : /\binto\s+(.*?)\s+from\b/is.exec(sql.replace(/'(?:[^']|'')*'/g, "''"));
  if (into) {
    for (const [, host] of into[1].matchAll(/:\s*([A-Za-z_$#@][\w$#@]*)/g)) {
      checkWritable(p, host, p.peek().line);
    }
  }

  p.expect(TokenType.SEMICOLON);

  return { type: 'SQL', sql };
}

// Variable hôte :nom ou :ds.champ déclarée DATE / TIME / TIMESTAMP
export function refuseDateHostVariable(p: ParserState, colon: Token): void {
  let i = p.pos;
  let name = '';
  while (p.tokens[i]?.type === TokenType.IDENTIFIER || p.isTypeTokenAt(i)) {
    name += p.tokens[i].value;
    if (p.tokens[i + 1]?.type !== TokenType.DOT) break;
    name += '.';
    i += 2;
  }
  if (name && p.dateTimeNames.has(name.toLowerCase())) {
    throw unsupported(`Variable hôte :${name} de type date/heure dans EXEC SQL`, colon);
  }
}
