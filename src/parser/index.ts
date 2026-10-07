import { Token, TokenType, ASTNode, ProgramNode, FileDeclarationNode, ParameterNode } from '../types';
import { ParserState } from './state';
import { parseControlOptions, parseVariableDeclaration, parseConstantDeclaration } from './declarations/variables';
import { parseDataStructure } from './declarations/data-structure';
import { parseProcedure, parseProcedureInterface, parsePrototype } from './procedures';
import { parseFileDeclaration } from './files';
import { parseStatement } from './statements/statement';
import { isOpcode, parseSubroutine, checkAfterSubroutines, finishSubScope } from './subroutines';

export class Parser {
  private state: ParserState;

  constructor(tokens: Token[]) {
    this.state = new ParserState(tokens);
  }

  parse(): ProgramNode {
    const p = this.state;
    const body: ASTNode[] = [];
    const files: FileDeclarationNode[] = [];
    let parameters: ParameterNode[] | undefined;

    while (!p.isAtEnd()) {
      if (isOpcode(p, 'begsr')) {
        body.push(parseSubroutine(p));
        continue;
      }
      checkAfterSubroutines(p, [TokenType.DCL_PROC, TokenType.DCL_PR]);
      if (p.check(TokenType.CTL_OPT)) {
        body.push(parseControlOptions(p));
      } else if (p.check(TokenType.DCL_S)) {
        body.push(parseVariableDeclaration(p));
      } else if (p.check(TokenType.DCL_C)) {
        body.push(parseConstantDeclaration(p));
      } else if (p.check(TokenType.DCL_DS)) {
        body.push(parseDataStructure(p));
      } else if (p.check(TokenType.DCL_PROC)) {
        body.push(parseProcedure(p));
      } else if (p.check(TokenType.DCL_PR)) {
        body.push(parsePrototype(p));
      } else if (p.check(TokenType.DCL_PI)) {
        parameters = parseProcedureInterface(p).parameters;
      } else if (p.check(TokenType.DCL_F)) {
        files.push(parseFileDeclaration(p));
      } else {
        body.push(parseStatement(p));
      }
    }

    finishSubScope(p);

    return files.length > 0 ? { type: 'Program', body, parameters, files } : { type: 'Program', body, parameters };
  }
}
