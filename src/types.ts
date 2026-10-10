export * from './token-types';
import { TokenType } from './token-types';

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
  | SortaNode
  | ProcedureCallNode
  | ReturnNode
  | MonitorNode
  | SQLNode
  | FileDeclarationNode
  | FileOperationNode
  | LeaveNode
  | IterNode
  | SubroutineNode
  | ExsrNode
  | LeavesrNode
  | DsplyNode;

export interface ProgramNode {
  type: 'Program';
  body: ASTNode[];
  parameters?: ParameterNode[];  // dcl-pi du programme principal : paramètres d'entrée
  files?: FileDeclarationNode[]; // DCL-F du programme principal
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
  dim?: DimNode;
}

// DIM(max) ou DIM(*AUTO : max)
export interface DimNode {
  max: number;
  auto: boolean;
}

// Élément de tableau : arr(index) ; index = expression, '*' (tous les éléments, T5) ou '*next' (cible *AUTO)
export interface ElementRef {
  name: string;
  index: ExpressionNode | '*' | '*next';
  field?: string; // sous-zone d'un élément de DS tableau : d(i).champ
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
    start?: number;
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

// LIKEDS / LIKEREC / EXTNAME d'une structure de données (ou d'un paramètre LIKEDS / LIKEREC).
// name : DS source (LIKEDS, casse d'écriture), format (LIKEREC) ou fichier (EXTNAME), en majuscules sauf LIKEDS.
// usage : type d'extraction ; 'none' pour LIKEDS (sans objet) et EXTNAME sans type d'extraction.
export interface DsLike {
  kind: 'likeds' | 'likerec' | 'extname';
  name: string;
  format?: string;
  usage: 'all' | 'input' | 'output' | 'key' | 'none';
  inzLike?: boolean;             // INZ(*LIKEDS) : reprend les valeurs INZ de la DS source
}

export interface DataTypeNode {
  type: 'DataType';
  typeName: string;              // 'ds' pour un paramètre LIKEDS / LIKEREC (alors like est renseigné)
  length?: number;
  decimals?: number;
  format?: string;
  like?: DsLike;
}

export interface AssignmentNode {
  type: 'Assignment';
  variable: string;      // pour un élément de tableau : le nom du tableau
  target?: ElementRef;   // cible arr(index) = ... (sinon la cible est `variable`)
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

export interface SortaNode {
  type: 'Sorta';
  name: string;
  field?: string;       // SORTA d(*).champ
  descending: boolean;  // SORTA(D)
}

export interface LoopStatementNode {
  type: 'LoopStatement';
  loopType: 'dow' | 'dou' | 'for' | 'foreach';
  variable?: string;          // Pour for
  item?: string;              // Pour foreach : variable (ou DS) qui reçoit chaque élément
  source?: string;            // Pour foreach : tableau parcouru
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

export interface FileDeclarationNode {
  type: 'FileDeclaration';
  name: string;      // nom tel qu'écrit
  keyed: boolean;
  usropn: boolean;
  usage: { input: boolean; output: boolean; update: boolean; delete: boolean };
  device?: 'workstn';                              // WORKSTN : fichier écran (absent : DISK)
  indds?: string;                                  // INDDS(nom) : structure des indicateurs, en majuscules
  rename?: { from: string; to: string };           // RENAME(format:nouveau), majuscules
  prefix?: { text: string; count?: number };       // PREFIX(texte[:n]), texte en majuscules sans apostrophes
  extfile?: string;                                // EXTFILE : nom de table en majuscules, bibliothèque retirée, ou '*EXTDESC'
  extdesc?: string;                                // EXTDESC : idem
  line: number;
}

export interface FileOperationNode {
  type: 'FileOperation';
  operation: 'read' | 'readp' | 'reade' | 'readpe' | 'chain' | 'setll' | 'setgt' | 'open' | 'close' | 'write' | 'update' | 'delete' | 'unlock' | 'exfmt';
  file: string;                // nom de fichier ou de format, tel qu'écrit
  key?: ExpressionNode[];      // liste de valeurs de clé
  special?: 'start' | 'end';   // *START / *LOVAL, *END / *HIVAL
  lastKey?: boolean;           // READE / READPE sans clé : clé du dernier enregistrement lu
  extender?: { error: boolean; noLock: boolean }; // extenseurs (E) et (N)
  resultDs?: string;           // structure de données résultat (read f ds, write fmt ds...), telle qu'écrite
  kds?: { ds: string; count?: ExpressionNode }; // %KDS(ds {: n}) : clé tirée des sous-zones de la DS
  fields?: string[];           // UPDATE ... %FIELDS(a : b) : noms en minuscules, tels qu'écrits (ds.a possible)
  line: number;
}

export interface LeaveNode {
  type: 'Leave';
}

export interface IterNode {
  type: 'Iter';
}

// BEGSR nom; ... ENDSR; : sous-routine, partageant les variables de sa portée (programme ou procédure)
export interface SubroutineNode {
  type: 'Subroutine';
  name: string;
  body: ASTNode[];
}

export interface ExsrNode {
  type: 'Exsr';
  name: string;
  line: number;
}

export interface LeavesrNode {
  type: 'Leavesr';
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
  hasDecimalPoint?: boolean; // littéral numérique écrit avec un point décimal
  valueType?: 'number' | 'string' | 'boolean' | 'identifier' | 'builtin' | 'special' | 'call' | 'datetime' | 'file' | 'element' | 'array' | 'arrayref';
}


// ==========================================
// 3. DataStructure
// ==========================================

export interface DataStructureNode {
  type: 'DataStructure';
  name: string;
  isQualified: boolean;
  dim?: DimNode;                 // DS tableau : DIM(n) ou DIM(*AUTO : n)
  like?: DsLike;                 // LIKEDS / LIKEREC / EXTNAME : fields est alors vide
  fields: {
    name: string;
    dataType: DataTypeNode;
    initialValue?: ExpressionNode;
    start?: number;              // position de début (1-based) : POS explicite, sinon octet suivant
  }[];
}