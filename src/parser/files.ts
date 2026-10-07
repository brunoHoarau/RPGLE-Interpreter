import { Token, TokenType, FileDeclarationNode, FileOperationNode, ExpressionNode } from '../types';
import { ParserState } from './state';
import { READ_OPERATIONS, KEYED_OPERATIONS, unsupported, COMPOUND_OPERATORS } from './constants';
import { parseCallArguments } from './statements/assignment';
import { parseExpression } from './expressions/operators';

// dcl-f nom [DISK] [USAGE(*INPUT)] [KEYED] [USROPN];
export function parseFileDeclaration(p: ParserState): FileDeclarationNode {
  const start = p.expect(TokenType.DCL_F);
  const nameToken = p.expectName();
  const key = nameToken.value.toUpperCase();
  if (p.fileNames.has(key)) throw new Error(`Fichier ${key} déjà déclaré (ligne ${nameToken.line})`);
  let keyed = false;
  let usropn = false;
  let usage: FileDeclarationNode['usage'] | undefined;
  let rename: FileDeclarationNode['rename'];
  let prefix: FileDeclarationNode['prefix'];
  let extfile: string | undefined;
  let extdesc: string | undefined;
  while (!p.check(TokenType.SEMICOLON) && !p.isAtEnd()) {
    const word = p.advance();
    const lower = word.value.toLowerCase();
    if (lower === 'disk') {
      // périphérique par défaut ; DISK(*EXT) est équivalent
      if (p.check(TokenType.LPAREN)) {
        const { text, end } = p.parenText();
        if (text.toLowerCase() !== '*ext' || p.tokens[end]?.type !== TokenType.RPAREN) {
          throw unsupported(`DISK(${text.toUpperCase()}) de DCL-F`, word);
        }
        p.pos = end + 1;
      }
    } else if (lower === 'keyed') {
      keyed = true;
    } else if (lower === 'usropn') {
      usropn = true;
    } else if (lower === 'usage') {
      usage = parseUsage(p, word);
    } else if (lower === 'rename') {
      p.expect(TokenType.LPAREN);
      const from = p.expectName();
      if (!p.check(TokenType.COLON)) throw new Error(`RENAME attend deux noms : format et nouveau nom (ligne ${word.line})`);
      p.advance();
      const to = p.expectName();
      p.expect(TokenType.RPAREN);
      rename = { from: from.value.toUpperCase(), to: to.value.toUpperCase() };
    } else if (lower === 'prefix') {
      p.expect(TokenType.LPAREN);
      const text = p.advance();
      if (text.type !== TokenType.IDENTIFIER && text.type !== TokenType.STRING) throw unsupported('PREFIX de DCL-F mal formé', text);
      // PREFIX('DS.') : zones placées dans une structure qualifiée
      if (text.value.includes('.') || p.check(TokenType.DOT)) {
        throw unsupported('PREFIX de DCL-F vers une structure qualifiée (avec un point)', text);
      }
      prefix = { text: text.value.toUpperCase() };
      if (p.check(TokenType.COLON)) {
        p.advance();
        const count = p.advance();
        if (count.type !== TokenType.NUMBER || !/^[0-9]+$/.test(count.value)) throw unsupported('PREFIX de DCL-F mal formé', count);
        prefix.count = parseInt(count.value);
      }
      p.expect(TokenType.RPAREN);
    } else if (lower === 'extfile' || lower === 'extdesc') {
      p.expect(TokenType.LPAREN);
      const value = p.advance();
      const isExtdescValue = value.type === TokenType.SPECIAL_VALUE && value.value.toLowerCase() === '*extdesc';
      if (value.type !== TokenType.STRING && !(lower === 'extfile' && isExtdescValue)) {
        throw unsupported(`${lower.toUpperCase()}(variable)`, value);
      }
      if (!p.check(TokenType.RPAREN)) throw unsupported(`${lower.toUpperCase()} de DCL-F mal formé`, p.peek());
      p.advance();
      // 'BIBLIOTHEQUE/TABLE' : seule la table compte. Entre apostrophes, le nom est sensible à la casse :
      // 'client' ne désigne pas l'objet CLIENT sur IBM i (les noms de tables.json sont en majuscules)
      const literal = value.value.trim();
      const parts = literal.split('/');
      if (!isExtdescValue && (parts.length > 2 || parts.some(part => part === ''))) {
        throw new Error(`${lower.toUpperCase()}('${literal}') du fichier ${key} : nom de fichier mal formé (ligne ${value.line})`);
      }
      if (!isExtdescValue && /[a-z]/.test(literal)) {
        throw new Error(`${lower.toUpperCase()}('${literal}') du fichier ${key} : entre apostrophes, le nom est sensible à la casse `
          + `et les noms d'objets IBM i sont en majuscules : écrivez '${literal.toUpperCase()}' (ligne ${value.line})`);
      }
      const name = isExtdescValue ? '*EXTDESC' : parts[parts.length - 1];
      if (lower === 'extfile') extfile = name; else extdesc = name;
    } else if (lower === 'workstn' || lower === 'printer' || lower === 'special') {
      throw unsupported(`DCL-F ${lower.toUpperCase()}`, word);
    } else {
      throw unsupported(`Le mot-clé ${word.value.toUpperCase()} de DCL-F`, word);
    }
  }
  if (extfile === '*EXTDESC' && extdesc === undefined) {
    throw new Error(`EXTFILE(*EXTDESC) du fichier ${key} sans le mot-clé EXTDESC (ligne ${start.line})`);
  }
  p.expect(TokenType.SEMICOLON);
  p.fileNames.add(key);
  const finalUsage = usage ?? { input: true, output: false, update: false, delete: false };
  p.fileUsage.set(key, finalUsage);
  const node: FileDeclarationNode = { type: 'FileDeclaration', name: nameToken.value, keyed, usropn, usage: finalUsage, line: start.line };
  if (rename) node.rename = rename;
  if (prefix) node.prefix = prefix;
  if (extfile !== undefined) node.extfile = extfile;
  if (extdesc !== undefined) node.extdesc = extdesc;
  return node;
}

// USAGE(*INPUT : *OUTPUT : *UPDATE : *DELETE) ; *UPDATE implique *INPUT, *DELETE implique *INPUT et *UPDATE
export function parseUsage(p: ParserState, word: Token): FileDeclarationNode['usage'] {
  const usage = { input: false, output: false, update: false, delete: false };
  if (!p.check(TokenType.LPAREN)) throw unsupported('USAGE de DCL-F sans valeur', word);
  p.advance();
  const given = new Set<string>();
  for (;;) {
    const value = p.advance();
    const name = value.value.toLowerCase();
    // Mot répété : refusé par le compilateur
    if (given.has(name)) throw new Error(`USAGE(${value.value.toUpperCase()}) répété (ligne ${value.line})`);
    given.add(name);
    if (name === '*input') usage.input = true;
    else if (name === '*output') usage.output = true;
    else if (name === '*update') { usage.update = true; usage.input = true; }
    else if (name === '*delete') { usage.delete = true; usage.update = true; usage.input = true; }
    else throw unsupported(`USAGE(${value.value.toUpperCase()}) de DCL-F`, value);
    if (p.check(TokenType.COLON)) { p.advance(); continue; }
    if (p.check(TokenType.RPAREN)) { p.advance(); break; }
    throw unsupported('USAGE de DCL-F mal formé', p.peek());
  }
  return usage;
}

// Un fichier doit avoir été déclaré. Pour une opération, le nom peut être un format
// (connu à l'exécution) : l'erreur n'est levée qu'en l'absence de tout DCL-F.
export function requireFile(p: ParserState, name: string, line: number, strict: boolean): void {
  if (strict ? !p.fileNames.has(name.toUpperCase()) : p.fileNames.size === 0) {
    throw new Error(`Fichier ${name.toUpperCase()} non déclaré (ligne ${line})`);
  }
}

// Après un mot d'opération de fichier : est-ce un nom de variable ou de procédure (x = 1, p(a), p;) ?
export function isFileKeywordNameUse(p: ParserState): boolean {
  const next = p.peekNext();
  if (!next) return false;
  if (next.type === TokenType.EQUALS || next.type === TokenType.DOT || next.type === TokenType.SEMICOLON ||
      COMPOUND_OPERATORS.has(next.type)) return true;
  if (next.type !== TokenType.LPAREN) return false;
  // (...) suivi d'un opérande : opération avec extenseur ou clé ; sinon appel
  let depth = 0;
  let i = p.pos + 1;
  for (; i < p.tokens.length; i++) {
    const t = p.tokens[i].type;
    if (t === TokenType.LPAREN) depth++;
    else if (t === TokenType.RPAREN && --depth === 0) break;
    else if (t === TokenType.EOF || t === TokenType.SEMICOLON) return true;
  }
  const after = p.tokens[i + 1];
  return !after || after.type === TokenType.SEMICOLON || after.type === TokenType.EQUALS ||
         after.type === TokenType.DOT || COMPOUND_OPERATORS.has(after.type);
}

// READ f ; READE clé f ; CHAIN clé f ; SETLL clé f ; OPEN f ; CLOSE f ...
export function parseFileOperation(p: ParserState): FileOperationNode {
  const opToken = p.advance();
  const operation = opToken.value.toLowerCase() as FileOperationNode['operation'];
  const opName = operation.toUpperCase();
  let keyed = KEYED_OPERATIONS.has(operation);
  // DELETE [clé] fichier : la clé est facultative
  if (operation === 'delete') {
    const next = p.peekNext();
    keyed = !(p.check(TokenType.IDENTIFIER) && next?.type === TokenType.SEMICOLON);
  }

  // Extenseur (E), (N)... : collé au code opération. Avec un blanc, c'est la liste de clé.
  // Convention du lexer : la colonne d'un mot est celle de sa fin, celle d'une parenthèse celle de son début ;
  // une parenthèse collée au mot a donc la même colonne que lui.
  let extender: FileOperationNode['extender'];
  const paren = p.peek();
  if (paren.type === TokenType.LPAREN &&
      (!keyed || (paren.line === opToken.line && paren.column === opToken.column))) {
    const { text, end } = p.parenText();
    // E et N, dans n'importe quel ordre, une fois chacune ; N seulement sur les lectures
    const letters = text.toLowerCase();
    const valid = p.tokens[end]?.type === TokenType.RPAREN && letters.length > 0 && /^[en]+$/.test(letters) &&
      new Set(letters).size === letters.length &&
      (!letters.includes('n') || (READ_OPERATIONS.has(operation) && operation !== 'setll' && operation !== 'setgt'));
    if (!valid) throw unsupported(`L'extenseur (${text.toUpperCase()}) de ${opName}`, opToken);
    extender = { error: letters.includes('e'), noLock: letters.includes('n') };
    p.pos = end + 1;
    // DELETE [clé] fichier : la présence d'une clé se juge après l'extenseur
    if (operation === 'delete') keyed = !(p.check(TokenType.IDENTIFIER) && p.peekNext()?.type === TokenType.SEMICOLON);
  }
  // READE / READPE sans clé : clé du dernier enregistrement lu
  let lastKey = false;
  if ((operation === 'reade' || operation === 'readpe') && p.check(TokenType.IDENTIFIER) && p.peekNext()?.type === TokenType.SEMICOLON) {
    keyed = false;
    lastKey = true;
  }

  let key: ExpressionNode[] | undefined;
  let special: 'start' | 'end' | undefined;
  if (keyed) {
    if (p.check(TokenType.SEMICOLON)) throw unsupported(`${opName} sans clé`, opToken);
    if (p.check(TokenType.BUILTIN) && p.peek().value.toLowerCase() === '%kds') {
      throw unsupported('%KDS', p.peek());
    }
    const specials = ['*start', '*end', '*loval', '*hival'];
    if (p.check(TokenType.SPECIAL_VALUE) && specials.includes(p.peek().value.toLowerCase())) {
      const token = p.advance();
      if (operation !== 'setll' && operation !== 'setgt') throw unsupported(`${token.value.toUpperCase()} avec ${opName}`, token);
      special = ['*start', '*loval'].includes(token.value.toLowerCase()) ? 'start' : 'end';
    } else if (p.check(TokenType.LPAREN)) {
      key = parseCallArguments(p);
      if (key.length === 0) throw new Error(`Clé de ${opName} vide (ligne ${opToken.line})`);
    } else {
      key = [parseExpression(p)];
    }
    if (p.check(TokenType.SEMICOLON)) throw unsupported(`${opName} sans clé`, opToken);
  }

  const fileToken = p.expectName();
  if (!p.check(TokenType.SEMICOLON)) {
    throw unsupported(`${opName} avec un opérande de plus (structure de données résultat)`, p.peek());
  }
  p.advance();
  requireFile(p, fileToken.value, fileToken.line, false);
  if (READ_OPERATIONS.has(operation)) {
    const usage = p.fileUsage.get(fileToken.value.toUpperCase());
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
