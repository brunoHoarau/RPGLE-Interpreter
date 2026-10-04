import { Token, TokenType, ASTNode, ProgramNode, ExpressionNode, DataTypeNode, ParameterNode } from './types';
import { isSupportedBuiltin } from './builtins';
import { DateTimeKind, isDateTimeType, parseIso } from './datetime';

const TYPE_TOKENS = [
  TokenType.CHAR, TokenType.VARCHAR, TokenType.PACKED, TokenType.ZONED, TokenType.INT, TokenType.UNS,
  TokenType.DATE, TokenType.TIME, TokenType.TIMESTAMP, TokenType.IND, TokenType.POINTER,
];

// Types reconnus par la syntaxe mais sans sémantique dans l'interpréteur
const UNSUPPORTED_TYPE_TOKENS = [TokenType.POINTER];

const DATETIME_LITERALS = new Map<TokenType, DateTimeKind>([
  [TokenType.DATE_LITERAL, 'date'], [TokenType.TIME_LITERAL, 'time'], [TokenType.TIMESTAMP_LITERAL, 'timestamp'],
]);

// Opérations sur fichiers natifs : tokens dédiés
const FILE_OPERATION_TOKENS = [
  TokenType.SETLL, TokenType.READ, TokenType.CHAIN, TokenType.UPDATE, TokenType.DELETE, TokenType.WRITE,
];

// Codes opération RPG free form non supportés (reconnus quand ils ne sont pas
// suivis de '=', '.' ou '(' : sinon ce sont des noms de variable ou de procédure)
const UNSUPPORTED_OPCODES = new Set([
  'acq', 'begsr', 'clear', 'close', 'commit', 'data-gen', 'data-into', 'dealloc', 'dump', 'endsr',
  'eval-corr', 'evalr', 'except', 'exfmt', 'exsr', 'feod', 'force', 'in', 'leavesr', 'next',
  'on-excp', 'on-exit', 'open', 'out', 'post', 'readc', 'reade', 'readp', 'readpe', 'rel', 'reset',
  'rolbk', 'setgt', 'snd-msg', 'sorta', 'test', 'unlock', 'xml-into', 'xml-sax',
]);

const INDICATOR = /^\*in(lr|\d\d)$/;
const SUPPORTED_SPECIAL_VALUES = new Set(['*on', '*off', '*zero', '*zeros', '*blank', '*blanks']);

// Fonctions dont le 2e argument est un format de date (*ISO, *EUR...)
const FORMAT_BUILTINS = new Set(['%char', '%date', '%time', '%timestamp']);

function unsupported(what: string, token: Token): Error {
  return new Error(`${what} : pas encore supporté par l'interpréteur (ligne ${token.line})`);
}

export class Parser {
  private tokens: Token[];
  private pos: number = 0;
  // Noms déclarés DATE / TIME / TIMESTAMP ('var', 'ds.champ', champ de DS non qualifiée) :
  // *LOVAL et *HIVAL ne sont acceptés que pour eux
  private dateTimeNames = new Set<string>();

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ProgramNode {
    const body: ASTNode[] = [];
    let parameters: ParameterNode[] | undefined;

    while (!this.isAtEnd()) {
      if (this.check(TokenType.CTL_OPT)) {
        body.push(this.parseControlOptions());
      } else if (this.check(TokenType.DCL_S)) {
        body.push(this.parseVariableDeclaration());
      } else if (this.check(TokenType.DCL_C)) {
        body.push(this.parseConstantDeclaration());
      } else if (this.check(TokenType.DCL_DS)) {
        body.push(this.parseDataStructure());
      } else if (this.check(TokenType.DCL_PROC)) {
        body.push(this.parseProcedure());
      } else if (this.check(TokenType.DCL_PR)) {
        body.push(this.parsePrototype());
      } else if (this.check(TokenType.DCL_PI)) {
        parameters = this.parseProcedureInterface().parameters;
      } else if (this.check(TokenType.DCL_F)) {
        throw unsupported('DCL-F (fichiers natifs)', this.peek());
      } else {
        body.push(this.parseStatement());
      }
    }

    return { type: 'Program', body, parameters };
  }

  // Options sans effet ici, sauf DATFMT et TIMFMT : un autre format que *ISO changerait les dates
  private parseControlOptions(): ASTNode {
    this.expect(TokenType.CTL_OPT);
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      const keyword = this.advance().value.toLowerCase();
      if ((keyword === 'datfmt' || keyword === 'timfmt') && this.check(TokenType.LPAREN)) {
        this.advance();
        const format = this.advance();
        if (format.value.toLowerCase() !== '*iso' || !this.check(TokenType.RPAREN)) {
          const text = `${format.value}${this.check(TokenType.RPAREN) ? '' : this.peek().value}`.toUpperCase();
          throw unsupported(`CTL-OPT ${keyword.toUpperCase()}(${text})`, format);
        }
      }
    }
    this.expect(TokenType.SEMICOLON);
    return { type: 'ControlOptions' } as any;
  }

  private parseVariableDeclaration(): ASTNode {
    this.expect(TokenType.DCL_S);
    const name = this.expect(TokenType.IDENTIFIER).value;
    const dataType = this.parseDataType();
    this.rememberDateTime(name, dataType);
    const initialValue = this.parseDeclarationKeywords('DCL-S', dataType);
    this.expect(TokenType.SEMICOLON);
    return { type: 'VariableDeclaration', name, dataType, initialValue };
  }

  // Mots-clés d'une déclaration jusqu'au ';' : seul INZ est supporté.
  // Renvoie la valeur de INZ(...), undefined pour INZ seul (valeur par défaut du type).
  private parseDeclarationKeywords(context: string, dataType: DataTypeNode): ExpressionNode | undefined {
    let initialValue: ExpressionNode | undefined;
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      const token = this.peek();
      if (token.type === TokenType.IDENTIFIER && token.value.toLowerCase() === 'inz') {
        this.advance();
        if (this.check(TokenType.LPAREN)) {
          this.advance();
          initialValue = this.parseDateTimeSpecial(this.inzSpecials(dataType), TokenType.RPAREN) ?? this.parseExpression();
          this.expect(TokenType.RPAREN);
        }
      } else {
        throw unsupported(`Le mot-clé ${token.value.toUpperCase()} de ${context}`, token);
      }
    }
    return initialValue;
  }

  private parseDataType(): any {
    const typeToken = this.peek();
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
    this.advance();
    const typeName = typeToken.value;
    if (isDateTimeType(typeName)) return this.parseDateTimeType(typeName);
    let length: number | undefined;
    let decimals: number | undefined;
    let format: string | undefined;

    if (this.check(TokenType.LPAREN)) {
      this.advance();
      length = parseInt(this.expect(TokenType.NUMBER).value);

      if (this.check(TokenType.COLON)) {
        this.advance();
        decimals = parseInt(this.expect(TokenType.NUMBER).value);
      }

      if (this.check(TokenType.IDENTIFIER) || this.check(TokenType.SPECIAL_VALUE)) {
        format = this.advance().value;
      }

      this.expect(TokenType.RPAREN);
    }

    return { type: 'DataType', typeName, length, decimals, format };
  }

  // date | date(*ISO) | time | time(*ISO) | timestamp | timestamp(6) : seul le format *ISO est supporté
  private parseDateTimeType(typeName: DateTimeKind): DataTypeNode {
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const arg = this.advance();
      if (typeName === 'timestamp') {
        if (arg.type !== TokenType.NUMBER || parseInt(arg.value) !== 6 || !this.check(TokenType.RPAREN)) {
          throw unsupported(`TIMESTAMP(${arg.value})`, arg);
        }
      } else if (arg.value.toLowerCase() !== '*iso' || !this.check(TokenType.RPAREN)) {
        const text = `${arg.value}${this.check(TokenType.RPAREN) ? '' : this.peek().value}`.toUpperCase();
        throw unsupported(`Le format ${text} de ${typeName.toUpperCase()}`, arg);
      }
      this.expect(TokenType.RPAREN);
    }
    return { type: 'DataType', typeName };
  }

  private parseConstantDeclaration(): ASTNode {
    this.expect(TokenType.DCL_C);
    const name = this.expect(TokenType.IDENTIFIER).value;
    const value = this.parseExpression();
    this.expect(TokenType.SEMICOLON);
    return { type: 'ConstantDeclaration', name, value };
  }

  private parseDataStructure(): ASTNode {
    this.expect(TokenType.DCL_DS);
    const name = this.expect(TokenType.IDENTIFIER).value;
    let isQualified = false;
    const fields: any[] = [];

    // 1. Options de la DS jusqu'au ';' : QUALIFIED et INZ sont supportés
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      const token = this.peek();
      const word = token.type === TokenType.IDENTIFIER ? token.value.toLowerCase() : '';
      if (word === 'qualified') {
        this.advance();
        isQualified = true;
      } else if (word === 'inz' && this.peekNext()?.type !== TokenType.LPAREN) {
        this.advance(); // INZ seul : valeurs par défaut, déjà le comportement
      } else {
        throw unsupported(`Le mot-clé ${token.value.toUpperCase()} de DCL-DS`, token);
      }
    }
    this.expect(TokenType.SEMICOLON);

    // 2. Champs jusqu'à 'end-ds'
    while (!this.check(TokenType.END_DS) && !this.isAtEnd()) {
      const fieldName = this.expect(TokenType.IDENTIFIER).value;
      const fieldType = this.parseDataType();
      this.rememberDateTime(`${name}.${fieldName}`, fieldType);
      if (!isQualified) this.rememberDateTime(fieldName, fieldType);
      const initialValue = this.parseDeclarationKeywords('champ de DS', fieldType);
      this.expect(TokenType.SEMICOLON);
      fields.push({ name: fieldName, dataType: fieldType, initialValue });
    }

    this.expect(TokenType.END_DS);
    this.skipToSemicolon(); // end-ds peut répéter le nom

    return { type: 'DataStructure', name, isQualified, fields };
  }

  private parseProcedure(): ASTNode {
    this.expect(TokenType.DCL_PROC);
    const name = this.expect(TokenType.IDENTIFIER).value;
    this.skipToSemicolon(); // Mots-clés : export, etc.

    let returnType: DataTypeNode | undefined;
    let parameters: ParameterNode[] = [];
    const body: ASTNode[] = [];
    const outerNames = new Set(this.dateTimeNames);

    while (!this.check(TokenType.END_PROC) && !this.isAtEnd()) {
      if (this.check(TokenType.DCL_PI)) {
        ({ returnType, parameters } = this.parseProcedureInterface());
      } else if (this.check(TokenType.DCL_S)) {
        body.push(this.parseVariableDeclaration());
      } else if (this.check(TokenType.DCL_C)) {
        body.push(this.parseConstantDeclaration());
      } else if (this.check(TokenType.DCL_DS)) {
        body.push(this.parseDataStructure());
      } else if (this.check(TokenType.DCL_PR)) {
        body.push(this.parsePrototype());
      } else {
        body.push(this.parseStatement());
      }
    }

    this.expect(TokenType.END_PROC);
    this.dateTimeNames = outerNames; // Les noms locaux disparaissent avec la procédure
    this.skipToSemicolon(); // end-proc peut répéter le nom

    return { type: 'Procedure', name, returnType, parameters, body };
  }

  // dcl-pi nom|*n [type-retour] [mots-clés]; paramètres... end-pi;
  private parseProcedureInterface(): { returnType?: DataTypeNode; parameters: ParameterNode[] } {
    this.expect(TokenType.DCL_PI);
    if (!this.check(TokenType.IDENTIFIER) && !this.check(TokenType.SPECIAL_VALUE)) {
      throw new Error(`Nom ou *N attendu après DCL-PI à la ligne ${this.peek().line}`);
    }
    this.advance();

    const next = this.peek();
    const isLikeKeyword = next.type === TokenType.IDENTIFIER && /^like(ds|rec)?$/i.test(next.value);
    const returnType = this.isTypeToken() || isLikeKeyword ? this.parseDataType() : undefined;
    // Autres mots-clés de l'interface (EXTPGM, EXTPROC...) : sans effet ici
    while (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.END_PI) && !this.isAtEnd()) {
      if (this.advance().type === TokenType.IDENTIFIER && this.check(TokenType.LPAREN)) this.skipParenthesized();
    }

    const parameters: ParameterNode[] = [];
    if (this.check(TokenType.END_PI)) {
      // Forme courte : dcl-pi *n end-pi;
      this.advance();
      this.expect(TokenType.SEMICOLON);
      return { returnType, parameters };
    }
    this.expect(TokenType.SEMICOLON);

    while (!this.check(TokenType.END_PI) && !this.isAtEnd()) {
      parameters.push(this.parseParameter());
    }
    this.expect(TokenType.END_PI);
    this.skipToSemicolon();

    parameters.forEach(p => this.rememberDateTime(p.name, p.dataType));
    return { returnType, parameters };
  }

  private parseParameter(): ParameterNode {
    const name = this.expect(TokenType.IDENTIFIER).value;
    const dataType: DataTypeNode = this.parseDataType();
    let isConst = false;
    let byValue = false;
    const options: string[] = [];

    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      const token = this.advance();
      const keyword = token.value.toLowerCase();
      if (keyword === 'const') {
        isConst = true;
      } else if (keyword === 'value') {
        byValue = true;
      } else if (keyword === 'options' && this.check(TokenType.LPAREN)) {
        this.advance();
        while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
          const option = this.advance();
          if (option.type === TokenType.COLON) continue;
          if (option.value.toLowerCase() !== '*nopass') {
            throw unsupported(`OPTIONS(${option.value.toUpperCase()})`, option);
          }
          options.push('*nopass');
        }
        this.expect(TokenType.RPAREN);
      } else {
        throw unsupported(`Le mot-clé ${token.value.toUpperCase()} de paramètre`, token);
      }
    }
    this.expect(TokenType.SEMICOLON);

    return { type: 'Parameter', name, dataType, isConst, byValue, options };
  }

  // dcl-pr nom [type-retour] [EXTPGM['nom'] | EXTPROC['nom']] ; paramètres... end-pr;
  // Sans EXTPGM ni EXTPROC, le prototype désigne une procédure du même nom.
  private parsePrototype(): ASTNode {
    this.expect(TokenType.DCL_PR);
    const name = this.expect(TokenType.IDENTIFIER).value;

    const next = this.peek();
    const isLikeKeyword = next.type === TokenType.IDENTIFIER && /^like(ds|rec)?$/i.test(next.value);
    const returnType = this.isTypeToken() || isLikeKeyword ? this.parseDataType() : undefined;

    let kind: 'program' | 'procedure' = 'procedure';
    let externalName = name;
    while (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.END_PR) && !this.isAtEnd()) {
      const token = this.advance();
      const keyword = token.value.toLowerCase();
      if (keyword === 'extpgm' || keyword === 'extproc') {
        kind = keyword === 'extpgm' ? 'program' : 'procedure';
        if (this.check(TokenType.LPAREN)) {
          this.advance();
          const target = this.advance();
          if (target.type !== TokenType.STRING) {
            throw unsupported(`${keyword.toUpperCase()} avec un nom non littéral`, target);
          }
          externalName = target.value;
          this.expect(TokenType.RPAREN);
        }
      } else if (this.check(TokenType.LPAREN)) {
        this.skipParenthesized(); // OPDESC, RTNPARM... : sans effet ici
      }
    }

    const parameters: ParameterNode[] = [];
    if (this.check(TokenType.END_PR)) {
      // Forme courte : dcl-pr nom extpgm end-pr;
      this.advance();
      this.expect(TokenType.SEMICOLON);
    } else {
      this.expect(TokenType.SEMICOLON);
      while (!this.check(TokenType.END_PR) && !this.isAtEnd()) {
        parameters.push(this.parseParameter());
      }
      this.expect(TokenType.END_PR);
      this.skipToSemicolon();
    }

    return { type: 'Prototype', name, kind, externalName, returnType, parameters };
  }

  private skipToSemicolon(): void {
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      this.advance();
    }
    this.expect(TokenType.SEMICOLON);
  }

  private skipParenthesized(): void {
    this.expect(TokenType.LPAREN);
    let depth = 1;
    while (depth > 0 && !this.isAtEnd()) {
      const token = this.advance();
      if (token.type === TokenType.LPAREN) depth++;
      if (token.type === TokenType.RPAREN) depth--;
    }
    if (depth > 0) throw new Error(`Parenthèse fermante attendue à la ligne ${this.peek().line}`);
  }

  // Une déclaration d'un autre type masque un nom date homonyme (variable locale)
  private rememberDateTime(name: string, dataType: DataTypeNode): void {
    if (isDateTimeType(dataType.typeName)) {
      this.dateTimeNames.add(name.toLowerCase());
    } else {
      this.dateTimeNames.delete(name.toLowerCase());
    }
  }

  // Valeurs spéciales permises dans INZ selon le type déclaré
  private inzSpecials(dataType: DataTypeNode): string[] {
    if (dataType.typeName === 'date') return ['*loval', '*hival', '*sys', '*job'];
    if (isDateTimeType(dataType.typeName)) return ['*loval', '*hival', '*sys'];
    return [];
  }

  // Valeur spéciale propre aux dates à la position courante, si elle est permise ici
  // (et suivie du token de fin attendu, s'il est donné)
  private parseDateTimeSpecial(allowed: string[], end?: TokenType): ExpressionNode | undefined {
    const token = this.peek();
    if (token.type !== TokenType.SPECIAL_VALUE || !allowed.includes(token.value)) return undefined;
    if (end !== undefined && this.peekNext()?.type !== end) return undefined;
    this.advance();
    return { type: 'Expression', value: token.value, valueType: 'special' };
  }

  private isTypeToken(): boolean {
    return TYPE_TOKENS.some(type => this.check(type));
  }

  // Arguments d'appel : (a: b: c), la virgule est tolérée
  private parseCallArguments(): ExpressionNode[] {
    this.expect(TokenType.LPAREN);
    const args: ExpressionNode[] = [];
    if (!this.check(TokenType.RPAREN)) {
      args.push(this.parseExpression());
      while (this.check(TokenType.COLON) || this.check(TokenType.COMMA)) {
        this.advance();
        args.push(this.parseExpression());
      }
    }
    this.expect(TokenType.RPAREN);
    return args;
  }

  private parseIfStatement(): ASTNode {
    this.expect(TokenType.IF);
    const condition = this.parseExpression();
    this.expect(TokenType.SEMICOLON);

    const thenBlock: ASTNode[] = [];
    while (!this.check(TokenType.ELSEIF) && !this.check(TokenType.ELSE) && !this.check(TokenType.ENDIF)) {
      thenBlock.push(this.parseStatement());
    }

    const elseIfBlocks: any[] = [];
    while (this.check(TokenType.ELSEIF)) {
      this.advance();
      const elseIfCondition = this.parseExpression();
      this.expect(TokenType.SEMICOLON);
      const elseIfBlock: ASTNode[] = [];
      while (!this.check(TokenType.ELSEIF) && !this.check(TokenType.ELSE) && !this.check(TokenType.ENDIF)) {
        elseIfBlock.push(this.parseStatement());
      }
      elseIfBlocks.push({ condition: elseIfCondition, block: elseIfBlock });
    }

    let elseBlock: ASTNode[] | undefined;
    if (this.check(TokenType.ELSE)) {
      this.advance();
      this.expect(TokenType.SEMICOLON);
      elseBlock = [];
      while (!this.check(TokenType.ENDIF)) {
        elseBlock.push(this.parseStatement());
      }
    }

    this.expect(TokenType.ENDIF);
    this.expect(TokenType.SEMICOLON);

    return { type: 'IfStatement', condition, thenBlock, elseIfBlocks, elseBlock };
  }

  private parseSelectStatement(): ASTNode {
    this.expect(TokenType.SELECT);
    this.expect(TokenType.SEMICOLON);

    const whenBlocks: any[] = [];
    let otherBlock: ASTNode[] | undefined;

    while (!this.check(TokenType.ENDSL) && !this.isAtEnd()) {
      if (this.check(TokenType.WHEN)) {
        this.advance();
        const condition = this.parseExpression();
        this.expect(TokenType.SEMICOLON);
        const block: ASTNode[] = [];
        while (!this.check(TokenType.WHEN) && !this.check(TokenType.OTHER) && !this.check(TokenType.ENDSL)) {
          block.push(this.parseStatement());
        }
        whenBlocks.push({ condition, block });
      } else if (this.check(TokenType.OTHER)) {
        this.advance();
        this.expect(TokenType.SEMICOLON);
        otherBlock = [];
        while (!this.check(TokenType.ENDSL)) {
          otherBlock.push(this.parseStatement());
        }
      } else {
        throw new Error(`Attendu WHEN, OTHER ou ENDSL à la ligne ${this.peek().line}`);
      }
    }

    this.expect(TokenType.ENDSL);
    this.expect(TokenType.SEMICOLON);

    return { type: 'SelectStatement', whenBlocks, otherBlock };
  }

  private parseLoop(): ASTNode {
    const loopType = this.advance().value as 'dow' | 'dou' | 'for';

    if (loopType === 'for') {
      const varName = this.expect(TokenType.IDENTIFIER).value;
      this.expect(TokenType.EQUALS);
      const init = this.parseExpression();
      const direction = this.advance().value as 'to' | 'downto';
      const limit = this.parseExpression();
      let step: ExpressionNode | undefined;

      if (this.check(TokenType.BY)) {
        this.advance();
        step = this.parseExpression();
      }

      this.expect(TokenType.SEMICOLON);
      const body: ASTNode[] = [];
      while (!this.check(TokenType.ENDFOR)) {
        body.push(this.parseStatement());
      }
      this.expect(TokenType.ENDFOR);
      this.expect(TokenType.SEMICOLON);

      return { type: 'LoopStatement', loopType: 'for', variable: varName, init, limit, step, direction, body };
    } else {
      const condition = this.parseExpression();
      this.expect(TokenType.SEMICOLON);
      const body: ASTNode[] = [];
      while (!this.check(TokenType.ENDDO)) {
        body.push(this.parseStatement());
      }
      this.expect(TokenType.ENDDO);
      this.expect(TokenType.SEMICOLON);

      return { type: 'LoopStatement', loopType, condition, body };
    }
  }

  private parseMonitor(): ASTNode {
    this.expect(TokenType.MONITOR);
    this.expect(TokenType.SEMICOLON);

    const tryBlock: ASTNode[] = [];
    while (!this.check(TokenType.ON_ERROR) && !this.check(TokenType.ENDMON)) {
      tryBlock.push(this.parseStatement());
    }

    const catchBlocks: any[] = [];
    while (this.check(TokenType.ON_ERROR)) {
      this.advance();
      // on-error [code {: code...}] ; code = statut (00102) ou *PROGRAM / *FILE / *ALL
      const errorCodes: string[] = [];
      while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
        const token = this.advance();
        if (token.type === TokenType.NUMBER || token.type === TokenType.SPECIAL_VALUE) {
          errorCodes.push(token.value.toLowerCase());
        } else if (token.type !== TokenType.COLON) {
          throw new Error(`Code d'erreur invalide '${token.value}' après ON-ERROR à la ligne ${token.line}`);
        }
      }
      this.expect(TokenType.SEMICOLON);

      const catchBlock: ASTNode[] = [];
      while (!this.check(TokenType.ON_ERROR) && !this.check(TokenType.ENDMON)) {
        catchBlock.push(this.parseStatement());
      }
      catchBlocks.push({ errorCodes, block: catchBlock });
    }

    this.expect(TokenType.ENDMON);
    this.expect(TokenType.SEMICOLON);

    return { type: 'Monitor', tryBlock, catchBlocks };
  }

  private parseReturn(): ASTNode {
    this.expect(TokenType.RETURN);
    let value: ExpressionNode | undefined;

    if (!this.check(TokenType.SEMICOLON)) {
      value = this.parseExpression();
    }

    this.expect(TokenType.SEMICOLON);
    return { type: 'Return', value };
  }

 private parseSQL(): ASTNode {
    this.expect(TokenType.EXEC_SQL);

    // Ignorer le mot "sql" s'il est présent juste après "exec"
    if (this.check(TokenType.IDENTIFIER) && this.peek().value.toLowerCase() === 'sql') {
        this.advance();
    }

    let sql = '';
    let previousTokenType: TokenType | null = null;

    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
        const token = this.advance();

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

    this.expect(TokenType.SEMICOLON);

    return { type: 'SQL', sql };
}

  private parseAssignmentOrCall(): ASTNode {
    const nameToken = this.expect(TokenType.IDENTIFIER);
    let name = nameToken.value;
    const lower = name.toLowerCase();

    // CALLP [(E)] proc(...) : CALLP est facultatif en free form
    if (lower === 'callp' && (this.check(TokenType.IDENTIFIER) || this.check(TokenType.LPAREN))) {
      if (this.check(TokenType.LPAREN)) this.skipParenthesized();
      return this.parseAssignmentOrCall();
    }

    // EVAL var = expr ; les extenseurs (H, M, R) ne sont pas supportés
    if (lower === 'eval' && (this.check(TokenType.IDENTIFIER) || this.check(TokenType.LPAREN))) {
      if (this.check(TokenType.LPAREN)) {
        const extender = this.peekNext();
        throw unsupported(`EVAL(${(extender?.value ?? '').toUpperCase()})`, nameToken);
      }
      return this.parseAssignmentOrCall();
    }

    const isNameUse = this.check(TokenType.EQUALS) || this.check(TokenType.DOT) || this.check(TokenType.LPAREN);
    if (UNSUPPORTED_OPCODES.has(lower) && !isNameUse) {
      throw unsupported(`L'opération ${name.toUpperCase()}`, nameToken);
    }

    // Notation pointée : client.id
    while (this.check(TokenType.DOT)) {
      this.advance();
      name += '.' + this.expect(TokenType.IDENTIFIER).value;
    }

    if (this.check(TokenType.EQUALS)) {
      this.advance();
      const allowed = this.dateTimeNames.has(name.toLowerCase()) ? ['*loval', '*hival'] : [];
      const value = this.parseDateTimeSpecial(allowed, TokenType.SEMICOLON) ?? this.parseExpression();
      this.expect(TokenType.SEMICOLON);
      return { type: 'Assignment', variable: name, value };
    }

    if (this.check(TokenType.LPAREN)) {
      const args = this.parseCallArguments();
      if (this.check(TokenType.EQUALS)) {
        throw unsupported('Les tableaux (affectation indicée)', nameToken);
      }
      this.expect(TokenType.SEMICOLON);
      return { type: 'ProcedureCall', name, args };
    }

    if (this.check(TokenType.SEMICOLON)) {
      // Appel sans paramètre ni parenthèses : proc;
      this.advance();
      return { type: 'ProcedureCall', name, args: [] };
    }

    throw new Error(`Instruction non reconnue '${name}' à la ligne ${nameToken.line}`);
  }

  private parseStatement(): ASTNode {
    if (this.check(TokenType.DSPLY)) return this.parseDsply();
    if (this.check(TokenType.IF)) return this.parseIfStatement();
    if (this.check(TokenType.SELECT)) return this.parseSelectStatement();
    if (this.check(TokenType.DOW) || this.check(TokenType.DOU) || this.check(TokenType.FOR)) return this.parseLoop();
    if (this.check(TokenType.MONITOR)) return this.parseMonitor();
    if (this.check(TokenType.RETURN)) return this.parseReturn();
    if (this.check(TokenType.EXEC_SQL)) return this.parseSQL();
    if (this.check(TokenType.LEAVE)) {
      this.advance();
      this.expect(TokenType.SEMICOLON);
      return { type: 'Leave' } as any;
    }
    if (this.check(TokenType.ITER)) {
      this.advance();
      this.expect(TokenType.SEMICOLON);
      return { type: 'Iter' } as any;
    }
    if (this.check(TokenType.IDENTIFIER)) return this.parseAssignmentOrCall();

    const token = this.peek();
    if (FILE_OPERATION_TOKENS.includes(token.type)) {
      throw unsupported(`L'opération ${token.value.toUpperCase()} (fichiers natifs)`, token);
    }
    if (token.type === TokenType.DCL_F) {
      throw unsupported('DCL-F (fichiers natifs)', token);
    }
    if (token.type === TokenType.SPECIAL_VALUE && INDICATOR.test(token.value)) {
      // *INLR = *ON; *IN50 = ...;
      this.advance();
      this.expect(TokenType.EQUALS);
      const value = this.parseExpression();
      this.expect(TokenType.SEMICOLON);
      return { type: 'Assignment', variable: token.value.toLowerCase(), value };
    }

    throw new Error(`Instruction inattendue '${token.value.toUpperCase()}' à la ligne ${token.line}`);
  }

  // Priorités RPG, de la plus faible à la plus forte :
  // OR < AND < NOT < comparaisons < + - < * / < ** < + - unaires
  private parseExpression(): ExpressionNode {
    return this.parseOr();
  }

  private parseOr(): ExpressionNode {
    let left = this.parseAnd();

    while (this.check(TokenType.OR)) {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'Expression', operator: 'or', left, right };
    }

    return left;
  }

  private parseAnd(): ExpressionNode {
    let left = this.parseNot();

    while (this.check(TokenType.AND)) {
      this.advance();
      const right = this.parseNot();
      left = { type: 'Expression', operator: 'and', left, right };
    }

    return left;
  }

  private parseNot(): ExpressionNode {
    if (this.check(TokenType.NOT)) {
      this.advance();
      return { type: 'Expression', operator: 'not', left: this.parseNot() };
    }

    return this.parseComparison();
  }

  private parseComparison(): ExpressionNode {
    let left = this.parseAddition();

    if (this.check(TokenType.EQUALS) || this.check(TokenType.NOT_EQUALS) ||
        this.check(TokenType.LESS) || this.check(TokenType.LESS_EQ) ||
        this.check(TokenType.GREATER) || this.check(TokenType.GREATER_EQ)) {
      const op = this.advance().value;
      const allowed = left.valueType === 'identifier' && this.dateTimeNames.has(String(left.value).toLowerCase())
        ? ['*loval', '*hival'] : [];
      const right = this.parseDateTimeSpecial(allowed) ?? this.parseAddition();
      return { type: 'Expression', operator: op, left, right };
    }

    return left;
  }

  private parseAddition(): ExpressionNode {
    let left = this.parseMultiplication();

    while (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) {
      const op = this.advance().value;
      const right = this.parseMultiplication();
      left = { type: 'Expression', operator: op, left, right };
    }

    return left;
  }

  private parseMultiplication(): ExpressionNode {
    let left = this.parsePower();

    while (this.check(TokenType.MULTIPLY) || this.check(TokenType.DIVIDE)) {
      const op = this.advance().value;
      const right = this.parsePower();
      left = { type: 'Expression', operator: op, left, right };
    }

    return left;
  }

  // ** est associatif à droite : 2 ** 3 ** 2 = 2 ** 9
  private parsePower(): ExpressionNode {
    const base = this.parseUnary();

    if (this.check(TokenType.POWER)) {
      this.advance();
      const exponent = this.parsePower();
      return { type: 'Expression', operator: '**', left: base, right: exponent };
    }

    return base;
  }

  private parseUnary(): ExpressionNode {
    if (this.check(TokenType.MINUS)) {
      this.advance();
      return { type: 'Expression', operator: 'neg', left: this.parseUnary() };
    }
    if (this.check(TokenType.PLUS)) {
      this.advance();
      return this.parseUnary();
    }

    return this.parsePrimary();
  }

  // 2e argument de %CHAR / %DATE / %TIME / %TIMESTAMP : seul %CHAR(x : *ISO) est supporté
  private parseFormatArgument(builtin: string): ExpressionNode {
    const token = this.peek();
    if (builtin.toLowerCase() === '%char' && token.type === TokenType.SPECIAL_VALUE && token.value.toLowerCase() === '*iso') {
      this.advance();
      return { type: 'Expression', value: '*iso', valueType: 'special' };
    }
    throw unsupported(`${builtin.toUpperCase()} avec le 2e argument ${token.value.toUpperCase()}`, token);
  }

  private parsePrimary(): ExpressionNode {
    if (this.check(TokenType.NUMBER)) {
      const value = parseFloat(this.advance().value);
      return { type: 'Expression', value, valueType: 'number' };
    }

    if (this.check(TokenType.STRING)) {
      const value = this.advance().value;
      return { type: 'Expression', value, valueType: 'string' };
    }

    const literalKind = DATETIME_LITERALS.get(this.peek().type);
    if (literalKind) {
      const token = this.advance();
      const value = parseIso(literalKind, token.value);
      if (!value) {
        const letter = { date: 'D', time: 'T', timestamp: 'Z' }[literalKind];
        throw new Error(`${letter}'${token.value}' : littéral ${literalKind.toUpperCase()} invalide (ligne ${token.line})`);
      }
      return { type: 'Expression', value, valueType: 'datetime' };
    }

    if (this.check(TokenType.SPECIAL_VALUE)) {
      const token = this.advance();
      const value = token.value.toLowerCase();
      if (!SUPPORTED_SPECIAL_VALUES.has(value) && !INDICATOR.test(value)) {
        throw unsupported(`La valeur spéciale ${value.toUpperCase()}`, token);
      }
      return { type: 'Expression', value, valueType: 'special' };
    }

    if (this.check(TokenType.BUILTIN)) {
      const token = this.advance();
      const name = token.value;
      if (!isSupportedBuiltin(name)) {
        throw unsupported(`La fonction ${name.toUpperCase()}`, token);
      }
      this.expect(TokenType.LPAREN);
      const args: ExpressionNode[] = [];

      while (!this.check(TokenType.RPAREN)) {
        if (args.length === 1 && FORMAT_BUILTINS.has(name.toLowerCase())) {
          args.push(this.parseFormatArgument(name));
        } else {
          args.push(this.parseExpression());
        }
        if (this.check(TokenType.COLON) || this.check(TokenType.COMMA)) {
          this.advance();
        }
      }

      this.expect(TokenType.RPAREN);
      return { type: 'Expression', value: { name, args }, valueType: 'builtin' };
    }

    if (this.check(TokenType.IDENTIFIER)) {
        // 🔥 CORRECTION : Gérer la notation pointée dans les expressions
        let name = this.advance().value;

        // Si on a un '.', on continue à lire les parties suivantes
        while (this.check(TokenType.DOT)) {
            this.advance(); // Consomme le '.'
            const nextPart = this.expect(TokenType.IDENTIFIER).value;
            name += '.' + nextPart;
        }

        if (this.check(TokenType.LPAREN)) {
            const args = this.parseCallArguments();
            return { type: 'Expression', value: { name, args }, valueType: 'call' };
        }

        return { type: 'Expression', value: name, valueType: 'identifier' };
    }

    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    throw new Error(`Expression inattendue à la ligne ${this.peek().line}`);
  }

  // Helper methods
  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.tokens[this.pos - 1];
  }

  private expect(type: TokenType): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`Attendu ${TokenType[type]} à la ligne ${this.peek().line}, reçu ${TokenType[this.peek().type]}`);
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private parseDsply(): ASTNode {
    this.expect(TokenType.DSPLY);
    let hasErrorExtender = false;

    // 1. Extendeur (E) optionnel ; sinon une parenthèse ouvre le message : dsply ('...');
    const extender = this.peekNext();
    if (this.check(TokenType.LPAREN) && extender?.type === TokenType.IDENTIFIER &&
        extender.value.toLowerCase() === 'e' && this.tokens[this.pos + 2]?.type === TokenType.RPAREN) {
        this.advance();
        this.advance();
        this.advance();
        hasErrorExtender = true;
    }

    // 2. Collecter tous les paramètres jusqu'au ';'
    // Les paramètres après le message peuvent être des valeurs spéciales
    // propres à DSPLY (*BLANK = pas de réponse, *EXT, *JOBLOG...)
    const params: ExpressionNode[] = [];
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
        if (params.length > 0 && this.check(TokenType.SPECIAL_VALUE)) {
            params.push({ type: 'Expression', value: this.advance().value.toLowerCase(), valueType: 'special' });
        } else {
            params.push(this.parseExpression());
        }
    }
    this.expect(TokenType.SEMICOLON);

    // 3. Assigner selon la position
    return {
        type: 'Dsply',
        hasErrorExtender,
        message: params[0],
        responseVar: params[1]?.valueType === 'identifier' ? params[1].value : undefined,
        queue: params[2]
    } as any;
  }

}

