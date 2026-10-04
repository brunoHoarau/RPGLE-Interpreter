import { Token, TokenType } from './types';

export class Lexer {
  private code: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];

  constructor(code: string) {
    this.code = code;
  }

  tokenize(): Token[] {
    while (this.pos < this.code.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.code.length) break;

      const char = this.code[this.pos];

      if (this.match('**free')) {
        this.advance(6);
        continue;
      }

      if (char === ';') {
        this.addToken(TokenType.SEMICOLON, ';');
        this.advance();
      } else if (char === '(') {
        this.addToken(TokenType.LPAREN, '(');
        this.advance();
      } else if (char === ')') {
        this.addToken(TokenType.RPAREN, ')');
        this.advance();
      } else if (char === ':') {
        this.addToken(TokenType.COLON, ':');
        this.advance();
      } else if (char === ',') {
        this.addToken(TokenType.COMMA, ',');
        this.advance();
      } else if (char === '+' && this.peek(1) === '=') {
        this.addToken(TokenType.PLUS_EQUALS, '+=');
        this.advance(2);
      } else if (char === '+') {
        this.addToken(TokenType.PLUS, '+');
        this.advance();
      } else if (char === '-' && this.peek(1) === '=') {
        this.addToken(TokenType.MINUS_EQUALS, '-=');
        this.advance(2);
      } else if (char === '-') {
        this.addToken(TokenType.MINUS, '-');
        this.advance();
      } else if (char === '*') {
    if (this.peek(1) === '*' && this.peek(2) === '=') {
        this.addToken(TokenType.POWER_EQUALS, '**=');
        this.advance(3);
    } else if (this.peek(1) === '=') {
        this.addToken(TokenType.MULTIPLY_EQUALS, '*=');
        this.advance(2);
    } else if (this.peek(1) === '*') {
        // Puissance : **
        this.addToken(TokenType.POWER, '**');
        this.advance(2);
    } else if (this.isAlpha(this.peek(1))) {
        // Valeur spéciale : *blank, *on, *off, *zero, *all, *hival, *loval, *ext, *joblog, etc.
        this.readSpecialValue();
      } else {
          // Multiplication : *
          this.addToken(TokenType.MULTIPLY, '*');
          this.advance();
      }
    } else if (char === '/' && this.peek(1) === '=') {
        this.addToken(TokenType.DIVIDE_EQUALS, '/=');
        this.advance(2);
    } else if (char === '/') {
        this.addToken(TokenType.DIVIDE, '/');
        this.advance();
      } else if (char === '=') {
        this.addToken(TokenType.EQUALS, '=');
        this.advance();
      } else if (char === '<') {
        if (this.peek(1) === '>') {
          this.addToken(TokenType.NOT_EQUALS, '<>');
          this.advance(2);
        } else if (this.peek(1) === '=') {
          this.addToken(TokenType.LESS_EQ, '<=');
          this.advance(2);
        } else {
          this.addToken(TokenType.LESS, '<');
          this.advance();
        }
      } else if (char === '>') {
        if (this.peek(1) === '=') {
          this.addToken(TokenType.GREATER_EQ, '>=');
          this.advance(2);
        } else {
          this.addToken(TokenType.GREATER, '>');
          this.advance();
        }
      } else if (char === "'" || char === '"') {
        this.readString(char);
      } else if (char === '.') {
    // Vérifier si c'est un nombre décimal (ex: .5) ou un point séparateur (ex: table.colonne)
    if (this.isDigit(this.peek(1))) {
        this.readNumber();
    } else {
        this.addToken(TokenType.DOT, '.');
        this.advance();
    }
    } else if (this.isDigit(char)) {
        this.readNumber();
      } else if (char === '%') {
        this.readBuiltin();
      } else if (char === '*') {
        this.readSpecialValue();
      } else if (/[dtz]/i.test(char) && this.peek(1) === "'") {
        // Littéraux D'2026-10-04', T'13.45.00', Z'2026-10-04-13.45.00.000000'
        this.readDateTimeLiteral(char.toLowerCase() as 'd' | 't' | 'z');
      } else if (this.isAlpha(char)) {
        this.readKeywordOrIdentifier();
      } else {
        throw new Error(`Caractère inattendu '${char}' à la ligne ${this.line}`);
      }
    }

    this.addToken(TokenType.EOF, '');
    return this.tokens;
  }

  private skipWhitespaceAndComments() {
    while (this.pos < this.code.length) {
      const char = this.code[this.pos];

      if (char === ' ' || char === '\t' || char === '\r') {
        this.advance();
      } else if (char === '\n') {
        this.advance();
        this.line++;
        this.column = 1;
      } else if (char === '/' && this.peek(1) === '/') {
        // Commentaire ligne
        while (this.pos < this.code.length && this.code[this.pos] !== '\n') {
          this.advance();
        }
      } else if (char === '/' && this.peek(1) === '*') {
        // Commentaire bloc
        this.advance(2);
        while (this.pos < this.code.length && !(this.code[this.pos] === '*' && this.peek(1) === '/')) {
          if (this.code[this.pos] === '\n') {
            this.line++;
            this.column = 1;
          }
          this.advance();
        }
        this.advance(2);
      } else {
        break;
      }
    }
  }

  private readString(quote: string) {
    this.advance(); // Skip opening quote
    let value = '';

    while (this.pos < this.code.length) {
      if (this.code[this.pos] === quote) {
        if (this.peek(1) !== quote) break;
        value += quote; // Quote doublée = quote littérale
        this.advance(2);
      } else {
        value += this.code[this.pos];
        this.advance();
      }
    }

    this.advance(); // Skip closing quote
    this.addToken(TokenType.STRING, value);
  }

  private readDateTimeLiteral(letter: 'd' | 't' | 'z') {
    const types = { d: TokenType.DATE_LITERAL, t: TokenType.TIME_LITERAL, z: TokenType.TIMESTAMP_LITERAL };
    this.advance(); // La lettre ; readString lit le texte entre apostrophes
    this.readString("'");
    this.tokens[this.tokens.length - 1].type = types[letter];
  }

  private readNumber() {
    let value = '';

    while (this.pos < this.code.length && (this.isDigit(this.code[this.pos]) || this.code[this.pos] === '.')) {
      value += this.code[this.pos];
      this.advance();
    }

    this.addToken(TokenType.NUMBER, value);
  }

  private readBuiltin() {
    this.advance(); // Skip %
    let name = '%';

    while (this.pos < this.code.length && this.isAlphaNumeric(this.code[this.pos])) {
      name += this.code[this.pos];
      this.advance();
    }

    this.addToken(TokenType.BUILTIN, name);
  }

  private readSpecialValue() {
    let value = '*';
    this.advance(); // Skip *

    while (this.pos < this.code.length && this.isAlphaNumeric(this.code[this.pos])) {
      value += this.code[this.pos];
      this.advance();
    }

    this.addToken(TokenType.SPECIAL_VALUE, value.toLowerCase());
  }

    private readKeywordOrIdentifier() {
    let value = '';

    while (this.pos < this.code.length && this.isAlphaNumeric(this.code[this.pos])) {
      value += this.code[this.pos];
      this.advance();
    }

    // Le tiret n'appartient au mot que pour les mots-clés composés (dcl-s, on-error...) ;
    // sinon c'est une soustraction : a-b
    const suffix = this.code.slice(this.pos).match(/^-[A-Za-z]+/);
    if (suffix && Lexer.HYPHENATED_KEYWORDS.has((value + suffix[0]).toLowerCase())) {
      value += suffix[0];
      this.advance(suffix[0].length);
    }

    const lowerValue = value.toLowerCase();
    const keyword = this.getKeywordType(lowerValue);

    if (keyword) {
      this.addToken(keyword, lowerValue);
    } else {
      this.addToken(TokenType.IDENTIFIER, value);
    }
  }

  private static readonly HYPHENATED_KEYWORDS = new Set([
    'ctl-opt', 'dcl-s', 'dcl-c', 'dcl-ds', 'dcl-f', 'dcl-proc', 'dcl-pi', 'dcl-pr',
    'dcl-subf', 'dcl-parm', 'end-ds', 'end-pi', 'end-pr', 'end-proc', 'on-error', 'on-exit',
    // Codes opération composés (non supportés, mais reconnus comme un seul mot)
    'eval-corr', 'xml-into', 'xml-sax', 'data-into', 'data-gen', 'snd-msg', 'on-excp',
  ]);

  private getKeywordType(keyword: string): TokenType | null {
    const keywords: { [key: string]: TokenType } = {
      'ctl-opt': TokenType.CTL_OPT,
      'dcl-s': TokenType.DCL_S,
      'dcl-c': TokenType.DCL_C,
      'dcl-ds': TokenType.DCL_DS,
      'dcl-f': TokenType.DCL_F,
      'dcl-proc': TokenType.DCL_PROC,
      'dcl-pi': TokenType.DCL_PI,
      'dcl-pr': TokenType.DCL_PR,
      'end-ds': TokenType.END_DS,
      'end-pi': TokenType.END_PI,
      'end-pr': TokenType.END_PR,
      'end-proc': TokenType.END_PROC,
      'endif': TokenType.ENDIF,
      'endsl': TokenType.ENDSL,
      'enddo': TokenType.ENDDO,
      'endfor': TokenType.ENDFOR,
      'endmon': TokenType.ENDMON,
      'if': TokenType.IF,
      'elseif': TokenType.ELSEIF,
      'else': TokenType.ELSE,
      'select': TokenType.SELECT,
      'when': TokenType.WHEN,
      'other': TokenType.OTHER,
      'dow': TokenType.DOW,
      'dou': TokenType.DOU,
      'for': TokenType.FOR,
      'to': TokenType.TO,
      'downto': TokenType.DOWNTO,
      'by': TokenType.BY,
      'monitor': TokenType.MONITOR,
      'on-error': TokenType.ON_ERROR,
      'return': TokenType.RETURN,
      'leave': TokenType.LEAVE,
      'iter': TokenType.ITER,
      'and': TokenType.AND,
      'or': TokenType.OR,
      'not': TokenType.NOT,
      'char': TokenType.CHAR,
      'varchar': TokenType.VARCHAR,
      'packed': TokenType.PACKED,
      'zoned': TokenType.ZONED,
      'int': TokenType.INT,
      'uns': TokenType.UNS,
      'date': TokenType.DATE,
      'time': TokenType.TIME,
      'timestamp': TokenType.TIMESTAMP,
      'ind': TokenType.IND,
      'pointer': TokenType.POINTER,
      'setll': TokenType.SETLL,
      'read': TokenType.READ,
      'reade': TokenType.READE,
      'readp': TokenType.READP,
      'readpe': TokenType.READPE,
      'setgt': TokenType.SETGT,
      'open': TokenType.OPEN,
      'close': TokenType.CLOSE,
      'chain': TokenType.CHAIN,
      'update': TokenType.UPDATE,
      'delete': TokenType.DELETE,
      'write': TokenType.WRITE,
      'exec': TokenType.EXEC_SQL,
      'dsply': TokenType.DSPLY,
    };

    return keywords[keyword] || null;
  }

  private addToken(type: TokenType, value: string) {
    this.tokens.push({
      type,
      value,
      line: this.line,
      column: this.column
    });
  }

  private advance(count: number = 1) {
    for (let i = 0; i < count; i++) {
      this.pos++;
      this.column++;
    }
  }

  private peek(offset: number = 1): string {
    return this.code[this.pos + offset] || '';
  }

  private match(text: string): boolean {
    return this.code.substr(this.pos, text.length).toLowerCase() === text.toLowerCase();
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char);
  }
}