import { Token, TokenType, FileDeclarationNode, ExpressionNode, DataTypeNode } from '../types';
import { TYPE_TOKENS, FILE_OPERATION_TOKENS } from './constants';

// Sous-routines d'une portée (programme principal ou procédure)
export interface SubScope {
  isProc: boolean;
  defined: Map<string, number>;                          // nom en minuscules -> ligne du BEGSR
  calls: { from?: string; to: string; token: Token }[];  // EXSR rencontrés ; from : sous-routine appelante
  seen: boolean;                                         // un BEGSR a déjà été vu
}

export function newSubScope(isProc: boolean): SubScope {
  return { isProc, defined: new Map(), calls: [], seen: false };
}

// État du parseur : jetons, curseur et tables de noms déclarés
export class ParserState {
  tokens: Token[];
  pos: number = 0;
  // Noms déclarés DATE / TIME / TIMESTAMP ('var', 'ds.champ', champ de DS non qualifiée) :
  // *LOVAL et *HIVAL ne sont acceptés que pour eux
  dateTimeNames = new Set<string>();
  // Constantes DCL-C et paramètres CONST visibles (nom en minuscules -> genre) : toute affectation est refusée
  readOnlyNames = new Map<string, string>();
  // Constantes DCL-C visibles (nom en minuscules -> valeur), pour EXTNAME(constante) et %KDS(ds : constante)
  constants = new Map<string, ExpressionNode>();
  // Structures de données déclarées (nom en minuscules) ; fields vide si les sous-zones ne sont connues
  // qu'à l'exécution (LIKEREC, EXTNAME) ; fromFile : DS tirée d'un fichier (ou LIKEDS d'une telle DS)
  dsInfo = new Map<string, { fields: { name: string; dataType: DataTypeNode }[]; fromFile?: boolean }>();
  // Fichiers déclarés par DCL-F (noms en majuscules)
  fileNames = new Set<string>();
  // Utilisation (USAGE) de chaque fichier déclaré (noms en majuscules)
  fileUsage = new Map<string, FileDeclarationNode['usage']>();

  subScope: SubScope = newSubScope(false);
  currentSub?: string; // Sous-routine en cours d'analyse (minuscules)

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // Helper methods
  check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  peek(): Token {
    return this.tokens[this.pos];
  }

  peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.tokens[this.pos - 1];
  }

  expect(type: TokenType): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`Attendu ${TokenType[type]} à la ligne ${this.peek().line}, reçu ${TokenType[this.peek().type]}`);
  }

  // Un nom : IDENTIFIER, ou un mot de type (char, zoned, date...) qui est aussi un nom valide en RPG
  isName(): boolean {
    return this.check(TokenType.IDENTIFIER) || this.isTypeToken() || FILE_OPERATION_TOKENS.some(type => this.check(type));
  }

  expectName(): Token {
    return this.isName() ? this.advance() : this.expect(TokenType.IDENTIFIER);
  }

  isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  isTypeToken(): boolean {
    return TYPE_TOKENS.some(type => this.check(type));
  }

  isTypeTokenAt(index: number): boolean {
    const type = this.tokens[index]?.type;
    return type !== undefined && TYPE_TOKENS.includes(type);
  }

  // *LOVAL et *HIVAL sont permis pour ce nom : date, heure ou timestamp connu, ou sous-zone d'une DS tirée d'un
  // fichier (type connu seulement à l'exécution, qui refuse alors une sous-zone non date).
  // Les sous-zones directes d'une DS EXTNAME non qualifiée ne sont pas reconnues ici : l'analyse ne connaît pas leurs noms.
  mayBeDateTime(name: string): boolean {
    const lower = name.toLowerCase();
    if (this.dateTimeNames.has(lower)) return true;
    const dot = lower.indexOf('.');
    return dot > 0 && this.dsInfo.get(lower.slice(0, dot))?.fromFile === true && !lower.includes('.', dot + 1);
  }

  // Parenthèse ouvrante au jeton courant : texte des jetons jusqu'à la parenthèse fermante (ou ';', fin) exclue,
  // et indice du jeton qui l'arrête (RPAREN si bien formé). Ne consomme rien.
  parenText(): { text: string; end: number } {
    let text = '';
    let end = this.pos + 1;
    for (; this.tokens[end] && ![TokenType.RPAREN, TokenType.SEMICOLON, TokenType.EOF].includes(this.tokens[end].type); end++) {
      text += this.tokens[end].value;
    }
    return { text, end };
  }

  skipToSemicolon(): void {
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      this.advance();
    }
    this.expect(TokenType.SEMICOLON);
  }

  skipParenthesized(): void {
    this.expect(TokenType.LPAREN);
    let depth = 1;
    while (depth > 0 && !this.isAtEnd()) {
      const token = this.advance();
      if (token.type === TokenType.LPAREN) depth++;
      if (token.type === TokenType.RPAREN) depth--;
    }
    if (depth > 0) throw new Error(`Parenthèse fermante attendue à la ligne ${this.peek().line}`);
  }
}
