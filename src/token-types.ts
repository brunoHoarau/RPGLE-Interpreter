// Types de jetons (TokenType) et Token : réexportés par types.ts
// ==========================================
// 1. TOKENS (Analyse Lexicale)
// ==========================================

export enum TokenType {
  // Mots-clés de contrôle
  CTL_OPT = 'CTL_OPT',

  // Déclarations
  DCL_S = 'DCL_S',
  DCL_C = 'DCL_C',
  DCL_DS = 'DCL_DS',
  DCL_F = 'DCL_F',
  DCL_PROC = 'DCL_PROC',
  DCL_PI = 'DCL_PI',
  DCL_PR = 'DCL_PR',

  // Fin de blocs
  END_DS = 'END_DS',
  END_PI = 'END_PI',
  END_PR = 'END_PR',
  END_PROC = 'END_PROC',
  ENDIF = 'ENDIF',
  ENDSL = 'ENDSL',
  ENDDO = 'ENDDO',
  ENDFOR = 'ENDFOR',
  ENDMON = 'ENDMON',

  // Structures de contrôle
  IF = 'IF',
  ELSEIF = 'ELSEIF',
  ELSE = 'ELSE',
  SELECT = 'SELECT',
  WHEN = 'WHEN',
  OTHER = 'OTHER',
  DOW = 'DOW',
  DOU = 'DOU',
  FOR = 'FOR',
  TO = 'TO',
  DOWNTO = 'DOWNTO',
  BY = 'BY',
  MONITOR = 'MONITOR',
  ON_ERROR = 'ON_ERROR',

  // Flux d'exécution
  RETURN = 'RETURN',
  LEAVE = 'LEAVE',
  ITER = 'ITER',

  // Types de données
  CHAR = 'CHAR',
  VARCHAR = 'VARCHAR',
  PACKED = 'PACKED',
  ZONED = 'ZONED',
  INT = 'INT',
  UNS = 'UNS',
  DATE = 'DATE',
  TIME = 'TIME',
  TIMESTAMP = 'TIMESTAMP',
  IND = 'IND',
  POINTER = 'POINTER',

  // Opérateurs
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  LESS = 'LESS',
  LESS_EQ = 'LESS_EQ',
  GREATER = 'GREATER',
  GREATER_EQ = 'GREATER_EQ',
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  MULTIPLY = 'MULTIPLY',
  DIVIDE = 'DIVIDE',
  POWER = 'POWER',
  PLUS_EQUALS = 'PLUS_EQUALS',
  MINUS_EQUALS = 'MINUS_EQUALS',
  MULTIPLY_EQUALS = 'MULTIPLY_EQUALS',
  DIVIDE_EQUALS = 'DIVIDE_EQUALS',
  POWER_EQUALS = 'POWER_EQUALS',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',

  // Symboles
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  COLON = 'COLON',
  SEMICOLON = 'SEMICOLON',
  COMMA = 'COMMA',
  DOT = 'DOT',

  // Littéraux et identifiants
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  DATE_LITERAL = 'DATE_LITERAL',           // D'2026-10-04'
  TIME_LITERAL = 'TIME_LITERAL',           // T'13.45.00'
  TIMESTAMP_LITERAL = 'TIMESTAMP_LITERAL', // Z'2026-10-04-13.45.00.000000'
  IDENTIFIER = 'IDENTIFIER',
  BUILTIN = 'BUILTIN', // ex: %len, %trim
  SPECIAL_VALUE = 'SPECIAL_VALUE', // ex: *on, *off, *zero

  // Opérations spécifiques
  EXEC_SQL = 'EXEC_SQL',
  SETLL = 'SETLL',
  READ = 'READ',
  READE = 'READE',
  READP = 'READP',
  READPE = 'READPE',
  SETGT = 'SETGT',
  OPEN = 'OPEN',
  CLOSE = 'CLOSE',
  CHAIN = 'CHAIN',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  WRITE = 'WRITE',
  DSPLY = 'DSPLY',

  EOF = 'EOF'
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

