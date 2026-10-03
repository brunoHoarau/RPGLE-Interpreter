import { Token, TokenType, ASTNode, ProgramNode, ExpressionNode, DataTypeNode, ParameterNode } from './types';

const TYPE_TOKENS = [
  TokenType.CHAR, TokenType.VARCHAR, TokenType.PACKED, TokenType.ZONED, TokenType.INT, TokenType.UNS,
  TokenType.DATE, TokenType.TIME, TokenType.TIMESTAMP, TokenType.IND, TokenType.POINTER,
];

export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ProgramNode {
    const body: ASTNode[] = [];

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
        this.skipPrototype();
      } else if (this.check(TokenType.DCL_PI)) {
        this.parseProcedureInterface(); // Paramètres du programme : non gérés
      } else if (this.check(TokenType.IF)) {
        body.push(this.parseIfStatement());
      } else if (this.check(TokenType.SELECT)) {
        body.push(this.parseSelectStatement());
      } else if (this.check(TokenType.DOW) || this.check(TokenType.DOU) || this.check(TokenType.FOR)) {
        body.push(this.parseLoop());
      } else if (this.check(TokenType.MONITOR)) {
        body.push(this.parseMonitor());
      } else if (this.check(TokenType.RETURN)) {
        body.push(this.parseReturn());
      } else if (this.check(TokenType.EXEC_SQL)) {
        body.push(this.parseSQL());
      } else if (this.check(TokenType.DSPLY)) {
        body.push(this.parseDsply());
      } else if (this.check(TokenType.IDENTIFIER)) {
        body.push(this.parseAssignmentOrCall());
      } else {
        this.advance(); // Skip unknown tokens
      }
    }

    return { type: 'Program', body };
  }

  private parseControlOptions(): ASTNode {
    this.expect(TokenType.CTL_OPT);
    // Skip options until semicolon
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      this.advance();
    }
    this.expect(TokenType.SEMICOLON);
    return { type: 'ControlOptions' } as any;
  }

  private parseVariableDeclaration(): ASTNode {
    this.expect(TokenType.DCL_S);
    const name = this.expect(TokenType.IDENTIFIER).value;
    const dataType = this.parseDataType();
    let initialValue: ExpressionNode | undefined;

    if (this.check(TokenType.IDENTIFIER) && this.peek().value.toLowerCase() === 'inz') {
      this.advance();
      this.expect(TokenType.LPAREN);
      initialValue = this.parseExpression();
      this.expect(TokenType.RPAREN);
    }

    this.expect(TokenType.SEMICOLON);
    return { type: 'VariableDeclaration', name, dataType, initialValue };
  }

  private parseDataType(): any {
    const typeToken = this.advance();
    const typeName = typeToken.value;
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

    // 1. Parser les options (qualified, dim, etc.) jusqu'au ';'
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
        if (this.check(TokenType.IDENTIFIER) && this.peek().value.toLowerCase() === 'qualified') {
            this.advance();
            isQualified = true;
        } else if (this.check(TokenType.IDENTIFIER) && this.peek().value.toLowerCase() === 'dim') {
            this.advance();
            this.expect(TokenType.LPAREN);
            this.expect(TokenType.NUMBER);
            this.expect(TokenType.RPAREN);
        } else {
            this.advance(); // Skip other options
        }
    }

    // 🔥 CORRECTION : Toujours consommer le ';' de fin de déclaration
    this.expect(TokenType.SEMICOLON);

    // 2. Parser les champs jusqu'à 'end-ds'
    while (!this.check(TokenType.END_DS) && !this.isAtEnd()) {
        const fieldName = this.expect(TokenType.IDENTIFIER).value;
        const fieldType = this.parseDataType();

        // Valeur initiale optionnelle (inz)
        let initialValue: ExpressionNode | undefined;
        if (this.check(TokenType.IDENTIFIER) && this.peek().value.toLowerCase() === 'inz') {
            this.advance();
            this.expect(TokenType.LPAREN);
            initialValue = this.parseExpression();
            this.expect(TokenType.RPAREN);
        }

        this.expect(TokenType.SEMICOLON);
        fields.push({ name: fieldName, dataType: fieldType, initialValue });
    }

    this.expect(TokenType.END_DS);
    this.expect(TokenType.SEMICOLON);

    return { type: 'DataStructure', name, isQualified, fields };
}

  private parseProcedure(): ASTNode {
    this.expect(TokenType.DCL_PROC);
    const name = this.expect(TokenType.IDENTIFIER).value;
    this.skipToSemicolon(); // Mots-clés : export, etc.

    let returnType: DataTypeNode | undefined;
    let parameters: ParameterNode[] = [];
    const body: ASTNode[] = [];

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
        this.skipPrototype();
      } else {
        body.push(this.parseStatement());
      }
    }

    this.expect(TokenType.END_PROC);
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

    const returnType = this.isTypeToken() ? this.parseDataType() : undefined;
    while (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.END_PI) && !this.isAtEnd()) {
      this.advance();
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

    return { returnType, parameters };
  }

  private parseParameter(): ParameterNode {
    const name = this.expect(TokenType.IDENTIFIER).value;
    const dataType: DataTypeNode = this.isTypeToken()
      ? this.parseDataType()
      : { type: 'DataType', typeName: 'unknown' }; // like(...), likeds(...) : traités comme mots-clés
    let isConst = false;
    let byValue = false;
    const options: string[] = [];

    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      const keyword = this.advance().value.toLowerCase();
      if (keyword === 'const') {
        isConst = true;
      } else if (keyword === 'value') {
        byValue = true;
      } else if (keyword === 'options' && this.check(TokenType.LPAREN)) {
        this.advance();
        while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
          const token = this.advance();
          if (token.type === TokenType.SPECIAL_VALUE) options.push(token.value.toLowerCase());
        }
        this.expect(TokenType.RPAREN);
      } else if (this.check(TokenType.LPAREN)) {
        this.skipParenthesized();
      }
    }
    this.expect(TokenType.SEMICOLON);

    return { type: 'Parameter', name, dataType, isConst, byValue, options };
  }

  // Les prototypes ne servent qu'au compilateur : l'interface réelle est lue dans dcl-pi
  private skipPrototype(): void {
    this.expect(TokenType.DCL_PR);
    while (!this.check(TokenType.END_PR) && !this.isAtEnd()) {
      this.advance();
    }
    this.expect(TokenType.END_PR);
    this.skipToSemicolon();
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
    // 🔥 CORRECTION : Lire le nom complet (avec notation pointée si présente)
    let name = this.expect(TokenType.IDENTIFIER).value;

    // CALLP [(E)] proc(...) : CALLP est facultatif en free form
    if (name.toLowerCase() === 'callp' && (this.check(TokenType.IDENTIFIER) || this.check(TokenType.LPAREN))) {
      if (this.check(TokenType.LPAREN)) this.skipParenthesized();
      return this.parseAssignmentOrCall();
    }

    // Gérer la notation pointée : client.id, ds.field.subfield, etc.
    while (this.check(TokenType.DOT)) {
        this.advance(); // Consomme le '.'
        const nextPart = this.expect(TokenType.IDENTIFIER).value;
        name += '.' + nextPart;
    }

    if (this.check(TokenType.EQUALS)) {
        // Affectation : var = value; ou ds.field = value;
        this.advance();
        const value = this.parseExpression();
        this.expect(TokenType.SEMICOLON);
        return { type: 'Assignment', variable: name, value };
    } else if (this.check(TokenType.LPAREN)) {
        // Appel avec parenthèses : proc(arg1: arg2);
        const args = this.parseCallArguments();
        this.expect(TokenType.SEMICOLON);
        return { type: 'ProcedureCall', name, args };
    } else {
        // Appel SANS parenthèses : dsply 'message';
        const args: ExpressionNode[] = [];
        if (!this.check(TokenType.SEMICOLON)) {
            args.push(this.parseExpression());
        }
        this.expect(TokenType.SEMICOLON);
        return { type: 'ProcedureCall', name, args };
    }
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

    throw new Error(`Instruction inattendue à la ligne ${this.peek().line}`);
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
      const right = this.parseAddition();
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

  private parsePrimary(): ExpressionNode {
    if (this.check(TokenType.NUMBER)) {
      const value = parseFloat(this.advance().value);
      return { type: 'Expression', value, valueType: 'number' };
    }

    if (this.check(TokenType.STRING)) {
      const value = this.advance().value;
      return { type: 'Expression', value, valueType: 'string' };
    }

    if (this.check(TokenType.SPECIAL_VALUE)) {
      const value = this.advance().value;
      return { type: 'Expression', value, valueType: 'special' };
    }

    if (this.check(TokenType.BUILTIN)) {
      const name = this.advance().value;
      this.expect(TokenType.LPAREN);
      const args: ExpressionNode[] = [];

      while (!this.check(TokenType.RPAREN)) {
        args.push(this.parseExpression());
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

    // 1. Extendeur (E) optionnel
    if (this.check(TokenType.LPAREN)) {
        this.advance();
        if (this.check(TokenType.IDENTIFIER) && this.peek().value.toLowerCase() === 'e') {
            this.advance();
            hasErrorExtender = true;
        }
        this.expect(TokenType.RPAREN);
    }

    // 2. Collecter tous les paramètres jusqu'au ';'
    const params: ExpressionNode[] = [];
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
        params.push(this.parseExpression());
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

