import { Token, TokenType, ASTNode, ProgramNode, FileDeclarationNode, FileOperationNode, ExpressionNode, DataTypeNode, ParameterNode } from './types';
import { isSupportedBuiltin } from './builtins';
import { byteLength } from './datatypes';
import { DateTimeKind, isDateTimeType, parseIso, unitFromName } from './datetime';

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
  TokenType.SETLL, TokenType.SETGT, TokenType.READ, TokenType.READE, TokenType.READP, TokenType.READPE,
  TokenType.CHAIN, TokenType.OPEN, TokenType.CLOSE, TokenType.UPDATE, TokenType.DELETE, TokenType.WRITE,
];
const READ_OPERATIONS = new Set(['read', 'readp', 'reade', 'readpe', 'chain', 'setll', 'setgt']);
// Opérations dont le premier opérande est une clé
const KEYED_OPERATIONS = new Set(['reade', 'readpe', 'chain', 'setll', 'setgt']);

// Fonctions de fichier : l'argument facultatif est un nom de fichier, évalué par l'interpréteur
const FILE_BUILTINS = new Set(['%eof', '%found', '%equal', '%open']);

// Codes opération RPG free form non supportés (reconnus quand ils ne sont pas
// suivis de '=', '.' ou '(' : sinon ce sont des noms de variable ou de procédure)
const UNSUPPORTED_OPCODES = new Set([
  'acq', 'begsr', 'clear', 'commit', 'data-gen', 'data-into', 'dealloc', 'dump', 'endsr',
  'eval-corr', 'evalr', 'except', 'exfmt', 'exsr', 'feod', 'force', 'in', 'leavesr', 'next',
  'on-excp', 'on-exit', 'out', 'post', 'readc', 'rel', 'reset',
  'rolbk', 'snd-msg', 'sorta', 'test', 'xml-into', 'xml-sax',
]);

const INDICATOR = /^\*in(lr|\d\d)$/;
const SUPPORTED_SPECIAL_VALUES = new Set(['*on', '*off', '*zero', '*zeros', '*blank', '*blanks']);

// Fonctions valides sans parenthèses
const NO_ARGUMENT_BUILTINS = new Set(['%date', '%time', '%timestamp', '%status', '%error']);
const FORMAT_BUILTINS = new Set(['%char', '%date', '%time', '%timestamp']);

// Position (0 = 1er argument) de l'unité de date (*DAYS, *M...) dans %DIFF et %SUBDT
const UNIT_ARGUMENT = new Map([['%diff', 2], ['%subdt', 1]]);

// Nombre exact d'arguments des fonctions de dates
const BUILTIN_ARITY: { [name: string]: number } = {
  '%diff': 3, '%subdt': 2, '%years': 1, '%months': 1, '%days': 1,
  '%hours': 1, '%minutes': 1, '%seconds': 1, '%mseconds': 1,
};

function unsupported(what: string, token: Token): Error {
  return new Error(`${what} : pas encore supporté par l'interpréteur (ligne ${token.line})`);
}

export class Parser {
  private tokens: Token[];
  private pos: number = 0;
  // Noms déclarés DATE / TIME / TIMESTAMP ('var', 'ds.champ', champ de DS non qualifiée) :
  // *LOVAL et *HIVAL ne sont acceptés que pour eux
  private dateTimeNames = new Set<string>();
  // Constantes DCL-C et paramètres CONST visibles (nom en minuscules -> genre) : toute affectation est refusée
  private readOnlyNames = new Map<string, string>();
  // Fichiers déclarés par DCL-F (noms en majuscules)
  private fileNames = new Set<string>();
  // Utilisation (USAGE) de chaque fichier déclaré (noms en majuscules)
  private fileUsage = new Map<string, FileDeclarationNode['usage']>();

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ProgramNode {
    const body: ASTNode[] = [];
    const files: FileDeclarationNode[] = [];
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
        files.push(this.parseFileDeclaration());
      } else {
        body.push(this.parseStatement());
      }
    }

    return files.length > 0 ? { type: 'Program', body, parameters, files } : { type: 'Program', body, parameters };
  }

  // dcl-f nom [DISK] [USAGE(*INPUT)] [KEYED] [USROPN];
  private parseFileDeclaration(): FileDeclarationNode {
    const start = this.expect(TokenType.DCL_F);
    const nameToken = this.expectName();
    const key = nameToken.value.toUpperCase();
    if (this.fileNames.has(key)) throw new Error(`Fichier ${key} déjà déclaré (ligne ${nameToken.line})`);
    let keyed = false;
    let usropn = false;
    let usage: FileDeclarationNode['usage'] | undefined;
    let rename: FileDeclarationNode['rename'];
    let prefix: FileDeclarationNode['prefix'];
    let extfile: string | undefined;
    let extdesc: string | undefined;
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
      const word = this.advance();
      const lower = word.value.toLowerCase();
      if (lower === 'disk') {
        // périphérique par défaut ; DISK(*EXT) est équivalent
        if (this.check(TokenType.LPAREN)) {
          let text = '';
          let i = this.pos + 1;
          for (; this.tokens[i] && ![TokenType.RPAREN, TokenType.SEMICOLON, TokenType.EOF].includes(this.tokens[i].type); i++) {
            text += this.tokens[i].value;
          }
          if (text.toLowerCase() !== '*ext' || this.tokens[i]?.type !== TokenType.RPAREN) {
            throw unsupported(`DISK(${text.toUpperCase()}) de DCL-F`, word);
          }
          this.pos = i + 1;
        }
      } else if (lower === 'keyed') {
        keyed = true;
      } else if (lower === 'usropn') {
        usropn = true;
      } else if (lower === 'usage') {
        usage = this.parseUsage(word);
      } else if (lower === 'rename') {
        this.expect(TokenType.LPAREN);
        const from = this.expectName();
        if (!this.check(TokenType.COLON)) throw new Error(`RENAME attend deux noms : format et nouveau nom (ligne ${word.line})`);
        this.advance();
        const to = this.expectName();
        this.expect(TokenType.RPAREN);
        rename = { from: from.value.toUpperCase(), to: to.value.toUpperCase() };
      } else if (lower === 'prefix') {
        this.expect(TokenType.LPAREN);
        const text = this.advance();
        if (text.type !== TokenType.IDENTIFIER && text.type !== TokenType.STRING) throw unsupported('PREFIX de DCL-F mal formé', text);
        prefix = { text: text.value.toUpperCase() };
        if (this.check(TokenType.COLON)) {
          this.advance();
          const count = this.advance();
          if (count.type !== TokenType.NUMBER || !/^[0-9]+$/.test(count.value)) throw unsupported('PREFIX de DCL-F mal formé', count);
          prefix.count = parseInt(count.value);
        }
        this.expect(TokenType.RPAREN);
      } else if (lower === 'extfile' || lower === 'extdesc') {
        this.expect(TokenType.LPAREN);
        const value = this.advance();
        const isExtdescValue = value.type === TokenType.SPECIAL_VALUE && value.value.toLowerCase() === '*extdesc';
        if (value.type !== TokenType.STRING && !(lower === 'extfile' && isExtdescValue)) {
          throw unsupported(`${lower.toUpperCase()}(variable)`, value);
        }
        if (!this.check(TokenType.RPAREN)) throw unsupported(`${lower.toUpperCase()} de DCL-F mal formé`, this.peek());
        this.advance();
        // 'BIBLIOTHEQUE/TABLE' : seule la table compte
        const name = isExtdescValue ? '*EXTDESC' : value.value.trim().toUpperCase().split('/').pop()!;
        if (lower === 'extfile') extfile = name; else extdesc = name;
      } else if (lower === 'workstn' || lower === 'printer' || lower === 'special') {
        throw unsupported(`DCL-F ${lower.toUpperCase()}`, word);
      } else {
        throw unsupported(`Le mot-clé ${word.value.toUpperCase()} de DCL-F`, word);
      }
    }
    this.expect(TokenType.SEMICOLON);
    this.fileNames.add(key);
    const finalUsage = usage ?? { input: true, output: false, update: false, delete: false };
    this.fileUsage.set(key, finalUsage);
    const node: FileDeclarationNode = { type: 'FileDeclaration', name: nameToken.value, keyed, usropn, usage: finalUsage, line: start.line };
    if (rename) node.rename = rename;
    if (prefix) node.prefix = prefix;
    if (extfile !== undefined) node.extfile = extfile;
    if (extdesc !== undefined) node.extdesc = extdesc;
    return node;
  }

  // USAGE(*INPUT : *OUTPUT : *UPDATE : *DELETE) ; *UPDATE implique *INPUT, *DELETE implique *INPUT et *UPDATE
  private parseUsage(word: Token): FileDeclarationNode['usage'] {
    const usage = { input: false, output: false, update: false, delete: false };
    if (!this.check(TokenType.LPAREN)) throw unsupported('USAGE de DCL-F sans valeur', word);
    this.advance();
    const given = new Set<string>();
    for (;;) {
      const value = this.advance();
      const name = value.value.toLowerCase();
      // Mot répété : refusé par le compilateur
      if (given.has(name)) throw new Error(`USAGE(${value.value.toUpperCase()}) répété (ligne ${value.line})`);
      given.add(name);
      if (name === '*input') usage.input = true;
      else if (name === '*output') usage.output = true;
      else if (name === '*update') { usage.update = true; usage.input = true; }
      else if (name === '*delete') { usage.delete = true; usage.update = true; usage.input = true; }
      else throw unsupported(`USAGE(${value.value.toUpperCase()}) de DCL-F`, value);
      if (this.check(TokenType.COLON)) { this.advance(); continue; }
      if (this.check(TokenType.RPAREN)) { this.advance(); break; }
      throw unsupported('USAGE de DCL-F mal formé', this.peek());
    }
    return usage;
  }

  // Un fichier doit avoir été déclaré. Pour une opération, le nom peut être un format
  // (connu à l'exécution) : l'erreur n'est levée qu'en l'absence de tout DCL-F.
  private requireFile(name: string, line: number, strict: boolean): void {
    if (strict ? !this.fileNames.has(name.toUpperCase()) : this.fileNames.size === 0) {
      throw new Error(`Fichier ${name.toUpperCase()} non déclaré (ligne ${line})`);
    }
  }

  // Après un mot d'opération de fichier : est-ce un nom de variable ou de procédure (x = 1, p(a), p;) ?
  private isFileKeywordNameUse(): boolean {
    const next = this.peekNext();
    if (!next) return false;
    if (next.type === TokenType.EQUALS || next.type === TokenType.DOT || next.type === TokenType.SEMICOLON ||
        Parser.COMPOUND_OPERATORS.has(next.type)) return true;
    if (next.type !== TokenType.LPAREN) return false;
    // (...) suivi d'un opérande : opération avec extenseur ou clé ; sinon appel
    let depth = 0;
    let i = this.pos + 1;
    for (; i < this.tokens.length; i++) {
      const t = this.tokens[i].type;
      if (t === TokenType.LPAREN) depth++;
      else if (t === TokenType.RPAREN && --depth === 0) break;
      else if (t === TokenType.EOF || t === TokenType.SEMICOLON) return true;
    }
    const after = this.tokens[i + 1];
    return !after || after.type === TokenType.SEMICOLON || after.type === TokenType.EQUALS ||
           after.type === TokenType.DOT || Parser.COMPOUND_OPERATORS.has(after.type);
  }

  // READ f ; READE clé f ; CHAIN clé f ; SETLL clé f ; OPEN f ; CLOSE f ...
  private parseFileOperation(): FileOperationNode {
    const opToken = this.advance();
    const operation = opToken.value.toLowerCase() as FileOperationNode['operation'];
    const opName = operation.toUpperCase();
    let keyed = KEYED_OPERATIONS.has(operation);
    // DELETE [clé] fichier : la clé est facultative
    if (operation === 'delete') {
      const next = this.peekNext();
      keyed = !(this.check(TokenType.IDENTIFIER) && next?.type === TokenType.SEMICOLON);
    }

    // Extenseur (E), (N)... : collé au code opération. Avec un blanc, c'est la liste de clé.
    // Convention du lexer : la colonne d'un mot est celle de sa fin, celle d'une parenthèse celle de son début ;
    // une parenthèse collée au mot a donc la même colonne que lui.
    let extender: FileOperationNode['extender'];
    const paren = this.peek();
    if (paren.type === TokenType.LPAREN &&
        (!keyed || (paren.line === opToken.line && paren.column === opToken.column))) {
      let text = '';
      let i = this.pos + 1;
      for (; this.tokens[i] && ![TokenType.RPAREN, TokenType.SEMICOLON, TokenType.EOF].includes(this.tokens[i].type); i++) {
        text += this.tokens[i].value;
      }
      // E et N, dans n'importe quel ordre, une fois chacune ; N seulement sur les lectures
      const letters = text.toLowerCase();
      const valid = this.tokens[i]?.type === TokenType.RPAREN && letters.length > 0 && /^[en]+$/.test(letters) &&
        new Set(letters).size === letters.length &&
        (!letters.includes('n') || (READ_OPERATIONS.has(operation) && operation !== 'setll' && operation !== 'setgt'));
      if (!valid) throw unsupported(`L'extenseur (${text.toUpperCase()}) de ${opName}`, opToken);
      extender = { error: letters.includes('e'), noLock: letters.includes('n') };
      this.pos = i + 1;
      // DELETE [clé] fichier : la présence d'une clé se juge après l'extenseur
      if (operation === 'delete') keyed = !(this.check(TokenType.IDENTIFIER) && this.peekNext()?.type === TokenType.SEMICOLON);
    }
    // READE / READPE sans clé : clé du dernier enregistrement lu
    let lastKey = false;
    if ((operation === 'reade' || operation === 'readpe') && this.check(TokenType.IDENTIFIER) && this.peekNext()?.type === TokenType.SEMICOLON) {
      keyed = false;
      lastKey = true;
    }

    let key: ExpressionNode[] | undefined;
    let special: 'start' | 'end' | undefined;
    if (keyed) {
      if (this.check(TokenType.SEMICOLON)) throw unsupported(`${opName} sans clé`, opToken);
      if (this.check(TokenType.BUILTIN) && this.peek().value.toLowerCase() === '%kds') {
        throw unsupported('%KDS', this.peek());
      }
      const specials = ['*start', '*end', '*loval', '*hival'];
      if (this.check(TokenType.SPECIAL_VALUE) && specials.includes(this.peek().value.toLowerCase())) {
        const token = this.advance();
        if (operation !== 'setll' && operation !== 'setgt') throw unsupported(`${token.value.toUpperCase()} avec ${opName}`, token);
        special = ['*start', '*loval'].includes(token.value.toLowerCase()) ? 'start' : 'end';
      } else if (this.check(TokenType.LPAREN)) {
        key = this.parseCallArguments();
        if (key.length === 0) throw new Error(`Clé de ${opName} vide (ligne ${opToken.line})`);
      } else {
        key = [this.parseExpression()];
      }
      if (this.check(TokenType.SEMICOLON)) throw unsupported(`${opName} sans clé`, opToken);
    }

    const fileToken = this.expectName();
    if (!this.check(TokenType.SEMICOLON)) {
      throw unsupported(`${opName} avec un opérande de plus (structure de données résultat)`, this.peek());
    }
    this.advance();
    this.requireFile(fileToken.value, fileToken.line, false);
    if (READ_OPERATIONS.has(operation)) {
      const usage = this.fileUsage.get(fileToken.value.toUpperCase());
      if (usage && !usage.input) {
        throw new Error(`Fichier ${fileToken.value.toUpperCase()} ouvert en sortie seule : ${opName} impossible (ligne ${opToken.line})`);
      }
    }

    const node: FileOperationNode = { type: 'FileOperation', operation, file: fileToken.value, line: opToken.line };
    if (key) node.key = key;
    if (special) node.special = special;
    if (lastKey) node.lastKey = true;
    if (extender) node.extender = extender;
    return node;
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
    const name = this.expectName().value;
    const dataType = this.parseDataType();
    this.rememberDateTime(name, dataType);
    const initialValue = this.parseDeclarationKeywords('DCL-S', dataType);
    this.expect(TokenType.SEMICOLON);
    return { type: 'VariableDeclaration', name, dataType, initialValue };
  }

  // Mots-clés d'une déclaration jusqu'au ';' : INZ, et POS pour un champ de DS (rangé dans fieldPos).
  // Renvoie la valeur de INZ(...), undefined pour INZ seul (valeur par défaut du type).
  private parseDeclarationKeywords(context: string, dataType: DataTypeNode, fieldPos?: { pos?: number }, fieldName = ''): ExpressionNode | undefined {
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
      } else if (fieldPos && token.type === TokenType.IDENTIFIER && token.value.toLowerCase() === 'pos') {
        this.advance();
        if (fieldPos.pos !== undefined) throw new Error(`POS indiqué deux fois pour le champ ${fieldName.toUpperCase()} à la ligne ${token.line}`);
        this.expect(TokenType.LPAREN);
        const arg = this.advance();
        if (arg.type !== TokenType.NUMBER || !/^[0-9]+$/.test(arg.value) || parseInt(arg.value) < 1 || arg.value.length > 8 || parseInt(arg.value) > 16773104 || !this.check(TokenType.RPAREN)) {
          throw new Error(`POS(${arg.type === TokenType.RPAREN ? '' : arg.value}) invalide à la ligne ${arg.line} : un entier compris entre 1 et 16773104 est attendu`);
        }
        this.advance();
        fieldPos.pos = parseInt(arg.value);
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
    const name = this.expectName().value;
    const value = this.parseExpression();
    this.expect(TokenType.SEMICOLON);
    this.readOnlyNames.set(name.toLowerCase(), 'une constante');
    return { type: 'ConstantDeclaration', name, value };
  }

  private parseDataStructure(): ASTNode {
    this.expect(TokenType.DCL_DS);
    const name = this.expectName().value;
    this.readOnlyNames.delete(name.toLowerCase());
    let isQualified = false;
    const fields: any[] = [];
    const layout: { name: string; type: DataTypeNode; pos?: number; token: Token }[] = [];

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
      const fieldToken = this.peek();
      const fieldName = this.expectName().value;
      const fieldType = this.parseDataType();
      this.rememberDateTime(`${name}.${fieldName}`, fieldType);
      if (!isQualified) this.rememberDateTime(fieldName, fieldType);
      const position: { pos?: number } = {};
      const initialValue = this.parseDeclarationKeywords('champ de DS', fieldType, position, fieldName);
      this.expect(TokenType.SEMICOLON);
      layout.push({ name: fieldName, type: fieldType, pos: position.pos, token: fieldToken });
      fields.push({ name: fieldName, dataType: fieldType, initialValue });
    }

    this.expect(TokenType.END_DS);
    this.skipToSemicolon(); // end-ds peut répéter le nom
    this.checkFieldLayout(layout);

    return { type: 'DataStructure', name, isQualified, fields };
  }

  // Les champs sont des valeurs indépendantes : un recouvrement d'octets (via POS) ne serait pas fidèle
  private checkFieldLayout(layout: { name: string; type: DataTypeNode; pos?: number; token: Token }[]): void {
    if (!layout.some(f => f.pos !== undefined)) return;
    const placed: { name: string; start: number; end: number }[] = [];
    let nextByte = 1;
    let maxEnd = 0;
    for (const field of layout) {
      const type = field.type;
      if (type.length === undefined && ['char', 'varchar', 'zoned', 'packed'].includes(type.typeName)) {
        throw new Error(`Longueur manquante pour le champ ${field.name.toUpperCase()} (POS) à la ligne ${field.token.line}`);
      }
      if (type.typeName === 'varchar' && type.decimals !== undefined && type.decimals !== 2 && type.decimals !== 4) {
        throw unsupported(`VARCHAR(${type.length}:${type.decimals})`, field.token);
      }
      if (field.pos === undefined && nextByte !== maxEnd + 1) {
        throw unsupported(`Champ de DS sans POS après un POS en arrière (${field.name.toUpperCase()})`, field.token);
      }
      const start = field.pos ?? nextByte;
      const end = start + byteLength(type) - 1;
      const clash = placed.find(p => start <= p.end && p.start <= end);
      if (clash) throw unsupported(`Champs de DS qui se chevauchent (${clash.name.toUpperCase()} et ${field.name.toUpperCase()})`, field.token);
      placed.push({ name: field.name, start, end });
      nextByte = end + 1;
      maxEnd = Math.max(maxEnd, end);
    }
  }

  private parseProcedure(): ASTNode {
    this.expect(TokenType.DCL_PROC);
    const name = this.expectName().value;
    this.skipToSemicolon(); // Mots-clés : export, etc.

    let returnType: DataTypeNode | undefined;
    let parameters: ParameterNode[] = [];
    const body: ASTNode[] = [];
    const outerNames = new Set(this.dateTimeNames);
    const outerReadOnly = new Map(this.readOnlyNames);

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
      } else if (this.check(TokenType.DCL_F)) {
        throw unsupported('DCL-F dans une procédure', this.peek());
      } else {
        body.push(this.parseStatement());
      }
    }

    this.expect(TokenType.END_PROC);
    this.dateTimeNames = outerNames; // Les noms locaux disparaissent avec la procédure
    this.readOnlyNames = outerReadOnly;
    this.skipToSemicolon(); // end-proc peut répéter le nom

    return { type: 'Procedure', name, returnType, parameters, body };
  }

  // dcl-pi nom|*n [type-retour] [mots-clés]; paramètres... end-pi;
  private parseProcedureInterface(): { returnType?: DataTypeNode; parameters: ParameterNode[] } {
    this.expect(TokenType.DCL_PI);
    if (!this.isName() && !this.check(TokenType.SPECIAL_VALUE)) {
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
      parameters.push(this.parseParameter(parameters.length + 1, false));
    }
    this.expect(TokenType.END_PI);
    this.skipToSemicolon();

    parameters.forEach(p => {
      this.rememberDateTime(p.name, p.dataType);
      if (p.isConst) this.readOnlyNames.set(p.name.toLowerCase(), 'un paramètre CONST');
    });
    return { returnType, parameters };
  }

  // *N (paramètre sans nom) n'existe que dans un prototype : nom interne *N(position)
  private parseParameter(position: number, allowUnnamed: boolean): ParameterNode {
    const unnamed = allowUnnamed && this.check(TokenType.SPECIAL_VALUE) && this.peek().value.toLowerCase() === '*n';
    if (unnamed) this.advance();
    const name = unnamed ? `*N(${position})` : this.expectName().value;
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
    const name = this.expectName().value;

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
        parameters.push(this.parseParameter(parameters.length + 1, true));
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
    this.readOnlyNames.delete(name.toLowerCase()); // Une déclaration locale masque la constante
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

  private isTypeTokenAt(index: number): boolean {
    const type = this.tokens[index]?.type;
    return type !== undefined && TYPE_TOKENS.includes(type);
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

  // IBM i refuse à la compilation d'affecter une constante ou un paramètre CONST
  private checkWritable(name: string, line: number): void {
    const kind = this.readOnlyNames.get(name.toLowerCase());
    if (kind) {
      throw new Error(`${name} est ${kind} : affectation refusée par le compilateur IBM i (ligne ${line})`);
    }
  }

  private parseLoop(): ASTNode {
    const loopType = this.advance().value as 'dow' | 'dou' | 'for';

    if (loopType === 'for') {
      const varToken = this.expectName();
      const varName = varToken.value;
      this.checkWritable(varName, varToken.line);
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

  // Variable hôte :nom ou :ds.champ déclarée DATE / TIME / TIMESTAMP
  private refuseDateHostVariable(colon: Token): void {
    let i = this.pos;
    let name = '';
    while (this.tokens[i]?.type === TokenType.IDENTIFIER || this.isTypeTokenAt(i)) {
      name += this.tokens[i].value;
      if (this.tokens[i + 1]?.type !== TokenType.DOT) break;
      name += '.';
      i += 2;
    }
    if (name && this.dateTimeNames.has(name.toLowerCase())) {
      throw unsupported(`Variable hôte :${name} de type date/heure dans EXEC SQL`, colon);
    }
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
        if (DATETIME_LITERALS.has(token.type)) {
          throw unsupported('Un littéral date ou heure dans EXEC SQL', token);
        }
        if (token.type === TokenType.COLON) this.refuseDateHostVariable(token);

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
        this.checkWritable(host, this.peek().line);
      }
    }

    this.expect(TokenType.SEMICOLON);

    return { type: 'SQL', sql };
}

  private static readonly COMPOUND_OPERATORS = new Map<TokenType, string>([
    [TokenType.PLUS_EQUALS, '+'],
    [TokenType.MINUS_EQUALS, '-'],
    [TokenType.MULTIPLY_EQUALS, '*'],
    [TokenType.DIVIDE_EQUALS, '/'],
    [TokenType.POWER_EQUALS, '**'],
  ]);

  private checkCompound(): boolean {
    return Parser.COMPOUND_OPERATORS.has(this.peek().type);
  }

  private advanceCompound(): string {
    return Parser.COMPOUND_OPERATORS.get(this.advance().type)!;
  }

  // x op= e  équivaut à  x = x op (e)
  private compoundValue(target: string, operator: string): ExpressionNode {
    const right = this.parseExpression();
    const left: ExpressionNode = { type: 'Expression', value: target, valueType: 'identifier' };
    return { type: 'Expression', operator, left, right };
  }

  private parseAssignmentOrCall(): ASTNode {
    const nameToken = this.expectName();
    let name = nameToken.value;
    const lower = name.toLowerCase();

    // CALLP [(E)] proc(...) : CALLP est facultatif en free form
    if (lower === 'callp' && (this.isName() || this.check(TokenType.LPAREN))) {
      if (this.check(TokenType.LPAREN)) {
        let text = '';
        for (let i = this.pos + 1; this.tokens[i] && ![TokenType.RPAREN, TokenType.SEMICOLON, TokenType.EOF].includes(this.tokens[i].type); i++) {
          text += this.tokens[i].value;
        }
        throw unsupported(`L'extenseur (${text.toUpperCase()}) de CALLP`, nameToken);
      }
      return this.parseAssignmentOrCall();
    }

    // EVAL var = expr ; les extenseurs (H, M, R) ne sont pas supportés
    if (lower === 'eval' && (this.isName() || this.check(TokenType.LPAREN))) {
      if (this.check(TokenType.LPAREN)) {
        const extender = this.peekNext();
        throw unsupported(`EVAL(${(extender?.value ?? '').toUpperCase()})`, nameToken);
      }
      return this.parseAssignmentOrCall();
    }

    // UNLOCK(E) fichier : extenseur refusé comme pour les autres opérations de fichier
    if (lower === 'unlock' && this.check(TokenType.LPAREN)) {
      let text = '';
      let i = this.pos + 1;
      for (; this.tokens[i] && ![TokenType.RPAREN, TokenType.SEMICOLON, TokenType.EOF].includes(this.tokens[i].type); i++) {
        text += this.tokens[i].value;
      }
      if (this.tokens[i]?.type === TokenType.RPAREN && this.tokens[i + 1]?.type === TokenType.IDENTIFIER) {
        throw unsupported(`L'extenseur (${text.toUpperCase()}) de UNLOCK`, nameToken);
      }
    }
    const isNameUse = this.check(TokenType.EQUALS) || this.checkCompound() || this.check(TokenType.DOT) || this.check(TokenType.LPAREN);
    // UNLOCK fichier : le fichier doit être déclaré
    if (lower === 'unlock' && !isNameUse && !this.check(TokenType.SEMICOLON)) {
      const fileToken = this.expectName();
      this.expect(TokenType.SEMICOLON);
      this.requireFile(fileToken.value, fileToken.line, true);
      return { type: 'FileOperation', operation: 'unlock', file: fileToken.value, line: nameToken.line } as FileOperationNode;
    }
    if (UNSUPPORTED_OPCODES.has(lower) && !isNameUse) {
      throw unsupported(`L'opération ${name.toUpperCase()}`, nameToken);
    }

    // Notation pointée : client.id
    while (this.check(TokenType.DOT)) {
      this.advance();
      name += '.' + this.expectName().value;
    }

    if (this.check(TokenType.EQUALS)) {
      this.checkWritable(name, nameToken.line);
      this.advance();
      const allowed = this.dateTimeNames.has(name.toLowerCase()) ? ['*loval', '*hival'] : [];
      const value = this.parseDateTimeSpecial(allowed, TokenType.SEMICOLON) ?? this.parseExpression();
      this.expect(TokenType.SEMICOLON);
      return { type: 'Assignment', variable: name, value };
    }

    if (this.checkCompound()) {
      this.checkWritable(name, nameToken.line);
      const operator = this.advanceCompound();
      const value = this.compoundValue(name, operator);
      this.expect(TokenType.SEMICOLON);
      return { type: 'Assignment', variable: name, value };
    }

    if (this.check(TokenType.LPAREN)) {
      const args = this.parseCallArguments();
      if (this.check(TokenType.EQUALS) || this.checkCompound()) {
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
    if (this.isTypeToken()) {
      // Un mot de type en début d'instruction est un nom s'il est utilisé comme tel
      const next = this.peekNext()?.type;
      if (next === TokenType.EQUALS || next === TokenType.DOT || next === TokenType.SEMICOLON || next === TokenType.LPAREN ||
          (next !== undefined && Parser.COMPOUND_OPERATORS.has(next))) {
        return this.parseAssignmentOrCall();
      }
    }

    const token = this.peek();
    if (FILE_OPERATION_TOKENS.includes(token.type)) {
      if (this.isFileKeywordNameUse()) return this.parseAssignmentOrCall();
      return this.parseFileOperation();
    }
    if (token.type === TokenType.DCL_F) {
      throw unsupported('DCL-F en dehors du niveau principal', token);
    }
    if (token.type === TokenType.SPECIAL_VALUE && INDICATOR.test(token.value)) {
      // *INLR = *ON; *IN50 = ...;
      this.advance();
      const variable = token.value.toLowerCase();
      if (this.checkCompound()) {
        const operator = this.advanceCompound();
        const value = this.compoundValue(variable, operator);
        this.expect(TokenType.SEMICOLON);
        return { type: 'Assignment', variable, value };
      }
      this.expect(TokenType.EQUALS);
      const value = this.parseExpression();
      this.expect(TokenType.SEMICOLON);
      return { type: 'Assignment', variable, value };
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

  // Unité de %DIFF / %SUBDT : *YEARS, *Y, *MONTHS, *M... ; inconnue : erreur, comme à la compilation
  private isUnitToken(): boolean {
    const token = this.peek();
    return token.type === TokenType.SPECIAL_VALUE && !!unitFromName(token.value);
  }

  private parseUnitArgument(builtin: string): ExpressionNode {
    const token = this.peek();
    if (token.type !== TokenType.SPECIAL_VALUE || !unitFromName(token.value)) {
      throw new Error(`${builtin.toUpperCase()} : unité ${token.value.toUpperCase()} inconnue (ligne ${token.line})`);
    }
    this.advance();
    return { type: 'Expression', value: token.value.toLowerCase(), valueType: 'special' };
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
      const text = this.advance().value;
      const node: ExpressionNode = { type: 'Expression', value: parseFloat(text), valueType: 'number' };
      if (text.includes('.')) node.hasDecimalPoint = true;
      return node;
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
      // %EOF, %FOUND, %EQUAL, %OPEN : l'argument est un nom de fichier, non évalué
      if (FILE_BUILTINS.has(name.toLowerCase())) {
        const args: ExpressionNode[] = [];
        if (this.check(TokenType.LPAREN) && this.peekNext()?.type === TokenType.RPAREN) {
          this.advance(); this.advance(); // %EOF() équivaut à %EOF
          if (name.toLowerCase() === '%open') throw new Error(`%OPEN attend un nom de fichier (ligne ${token.line})`);
        } else if (this.check(TokenType.LPAREN)) {
          this.advance();
          const fileToken = this.expectName();
          this.requireFile(fileToken.value, fileToken.line, true);
          args.push({ type: 'Expression', value: fileToken.value, valueType: 'file' });
          this.expect(TokenType.RPAREN);
        } else if (name.toLowerCase() === '%open') {
          throw new Error(`%OPEN attend un nom de fichier (ligne ${token.line})`);
        }
        return { type: 'Expression', value: { name, args }, valueType: 'builtin' };
      }
      // %DATE, %TIME et %TIMESTAMP sont valides sans parenthèses
      if (NO_ARGUMENT_BUILTINS.has(name.toLowerCase()) && !this.check(TokenType.LPAREN)) {
        return { type: 'Expression', value: { name, args: [] }, valueType: 'builtin' };
      }
      this.expect(TokenType.LPAREN);
      const args: ExpressionNode[] = [];

      const lower = name.toLowerCase();
      while (!this.check(TokenType.RPAREN)) {
        if (args.length === 2 && lower === '%char') {
          throw new Error(`%CHAR accepte au plus 2 arguments (ligne ${token.line})`);
        }
        if (args.length === 2 && lower === '%subdt') {
          throw unsupported('%SUBDT avec plus de 2 arguments', this.peek());
        }
        if (args.length === 1 && FORMAT_BUILTINS.has(lower)) {
          args.push(this.parseFormatArgument(name));
        } else if (UNIT_ARGUMENT.has(lower) && (UNIT_ARGUMENT.get(lower) === args.length || this.isUnitToken())) {
          args.push(this.parseUnitArgument(name));
        } else {
          args.push(this.parseExpression());
        }
        if (this.check(TokenType.COLON) || this.check(TokenType.COMMA)) {
          this.advance();
        }
      }

      this.expect(TokenType.RPAREN);
      const arity = BUILTIN_ARITY[lower];
      if (arity !== undefined && args.length !== arity) {
        throw new Error(`${name.toUpperCase()} attend ${arity} argument${arity > 1 ? 's' : ''} (ligne ${token.line})`);
      }
      return { type: 'Expression', value: { name, args }, valueType: 'builtin' };
    }

    if (this.isName()) {
        // 🔥 CORRECTION : Gérer la notation pointée dans les expressions
        let name = this.advance().value;

        // Si on a un '.', on continue à lire les parties suivantes
        while (this.check(TokenType.DOT)) {
            this.advance(); // Consomme le '.'
            const nextPart = this.expectName().value;
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

  // Un nom : IDENTIFIER, ou un mot de type (char, zoned, date...) qui est aussi un nom valide en RPG
  private isName(): boolean {
    return this.check(TokenType.IDENTIFIER) || this.isTypeToken() || FILE_OPERATION_TOKENS.some(type => this.check(type));
  }

  private expectName(): Token {
    return this.isName() ? this.advance() : this.expect(TokenType.IDENTIFIER);
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
    // DSPLY message {file-de-messages {réponse}} : la file peut être une valeur
    // spéciale (*EXT, *JOBLOG, *BLANK...)
    const line = this.peek().line;
    const params: ExpressionNode[] = [];
    while (!this.check(TokenType.SEMICOLON) && !this.isAtEnd()) {
        if (params.length > 0 && this.check(TokenType.SPECIAL_VALUE)) {
            params.push({ type: 'Expression', value: this.advance().value.toLowerCase(), valueType: 'special' });
        } else {
            params.push(this.parseExpression());
        }
    }
    this.expect(TokenType.SEMICOLON);

    if (params.length > 3) {
        throw new Error(`DSPLY accepte au plus 3 opérandes (ligne ${line})`);
    }
    if (params[2] && params[2].valueType !== 'identifier') {
        throw new Error(`La réponse de DSPLY doit être une variable (ligne ${line})`);
    }
    if (params[2]) this.checkWritable(String(params[2].value), line);

    // 3. Assigner selon la position
    return {
        type: 'Dsply',
        hasErrorExtender,
        message: params[0],
        queue: params[1],
        responseVar: params[2]?.value
    } as any;
  }

}

