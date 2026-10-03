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
  IDENTIFIER = 'IDENTIFIER',
  BUILTIN = 'BUILTIN', // ex: %len, %trim
  SPECIAL_VALUE = 'SPECIAL_VALUE', // ex: *on, *off, *zero

  // Opérations spécifiques
  EXEC_SQL = 'EXEC_SQL',
  SETLL = 'SETLL',
  READ = 'READ',
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

// ==========================================
// 2. NŒUDS AST (Abstract Syntax Tree)
// ==========================================

// Type union principal : DOIT contenir toutes les interfaces ci-dessous
export type ASTNode = 
  | ProgramNode
  | ControlOptionsNode
  | VariableDeclarationNode
  | ConstantDeclarationNode
  | DataStructureNode
  | ProcedureNode
  | PrototypeNode
  | ParameterNode
  | AssignmentNode
  | IfStatementNode
  | SelectStatementNode
  | LoopStatementNode
  | ProcedureCallNode
  | ReturnNode
  | MonitorNode
  | SQLNode
  | FileOperationNode
  | LeaveNode
  | IterNode
  | DsplyNode;

export interface ProgramNode {
  type: 'Program';
  body: ASTNode[];
  parameters?: ParameterNode[];  // dcl-pi du programme principal : paramètres d'entrée
}

export interface ControlOptionsNode {
  type: 'ControlOptions';
  options: string; // Chaîne brute des options pour l'instant
}

export interface VariableDeclarationNode {
  type: 'VariableDeclaration';
  name: string;
  dataType: DataTypeNode;
  initialValue?: ExpressionNode;
}

export interface ConstantDeclarationNode {
  type: 'ConstantDeclaration';
  name: string;
  value: ExpressionNode;
}

export interface DataStructureNode {
  type: 'DataStructure';
  name: string;
  fields: {
    name: string;
    dataType: DataTypeNode;
    initialValue?: ExpressionNode;
  }[];
}

export interface ProcedureNode {
  type: 'Procedure';
  name: string;
  returnType?: DataTypeNode;
  parameters: ParameterNode[];
  body: ASTNode[];               // Déclarations locales et instructions, dans l'ordre
}

// dcl-pr : interface d'un programme (EXTPGM) ou d'une procédure (EXTPROC, ou interne)
export interface PrototypeNode {
  type: 'Prototype';
  name: string;
  kind: 'program' | 'procedure';
  externalName: string;          // Nom du programme / de la procédure appelé
  returnType?: DataTypeNode;
  parameters: ParameterNode[];
}

export interface ParameterNode {
  type: 'Parameter';
  name: string;
  dataType: DataTypeNode;
  isConst: boolean;              // CONST : lecture seule, pas de retour vers l'appelant
  byValue: boolean;              // VALUE : copie, pas de retour vers l'appelant
  options: string[];             // OPTIONS(*NOPASS : *OMIT ...), en minuscules
}

export interface DataTypeNode {
  type: 'DataType';
  typeName: string;
  length?: number;
  decimals?: number;
  format?: string;
}

export interface AssignmentNode {
  type: 'Assignment';
  variable: string;
  value: ExpressionNode;
}

export interface IfStatementNode {
  type: 'IfStatement';
  condition: ExpressionNode;
  thenBlock: ASTNode[];
  elseIfBlocks?: { condition: ExpressionNode; block: ASTNode[] }[];
  elseBlock?: ASTNode[];
}

export interface SelectStatementNode {
  type: 'SelectStatement';
  whenBlocks: { condition: ExpressionNode; block: ASTNode[] }[];
  otherBlock?: ASTNode[];
}

export interface LoopStatementNode {
  type: 'LoopStatement';
  loopType: 'dow' | 'dou' | 'for';
  variable?: string;          // Pour for
  condition?: ExpressionNode; // Pour dow/dou
  init?: ExpressionNode;      // Pour for
  limit?: ExpressionNode;     // Pour for
  step?: ExpressionNode;      // Pour for
  direction?: 'to' | 'downto';// Pour for
  body: ASTNode[];
}

export interface ProcedureCallNode {
  type: 'ProcedureCall';
  name: string;
  args: ExpressionNode[];
}

export interface ReturnNode {
  type: 'Return';
  value?: ExpressionNode;
}

export interface MonitorNode {
  type: 'Monitor';
  tryBlock: ASTNode[];
  catchBlocks: { errorCodes?: string[]; block: ASTNode[] }[];
}

export interface SQLNode {
  type: 'SQL';
  sql: string;
}

export interface FileOperationNode {
  type: 'FileOperation';
  operation: 'setll' | 'read' | 'chain' | 'update' | 'delete' | 'write';
  file: string;
  key?: ExpressionNode;
}

export interface LeaveNode {
  type: 'Leave';
}

export interface IterNode {
  type: 'Iter';
}

export interface DsplyNode {
  type: 'Dsply';
  hasErrorExtender: boolean;
  message?: ExpressionNode;
  responseVar?: string;
  queue?: ExpressionNode;
}

// ==========================================
// 3. EXPRESSIONS
// ==========================================

export interface ExpressionNode {
  type: 'Expression';
  operator?: string;
  left?: ExpressionNode;
  right?: ExpressionNode;
  value?: any;
  valueType?: 'number' | 'string' | 'boolean' | 'identifier' | 'builtin' | 'special' | 'call';
}


// ==========================================
// 3. DataStructure
// ==========================================

export interface DataStructureNode {
  type: 'DataStructure';
  name: string;
  isQualified: boolean;
  fields: {
    name: string;
    dataType: DataTypeNode;
    initialValue?: ExpressionNode;
  }[];
}