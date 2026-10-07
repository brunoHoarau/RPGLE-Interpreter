import { Token, TokenType } from '../types';
import { DateTimeKind } from '../datetime';

export const TYPE_TOKENS = [
  TokenType.CHAR, TokenType.VARCHAR, TokenType.PACKED, TokenType.ZONED, TokenType.INT, TokenType.UNS,
  TokenType.DATE, TokenType.TIME, TokenType.TIMESTAMP, TokenType.IND, TokenType.POINTER,
];

// Types reconnus par la syntaxe mais sans sémantique dans l'interpréteur
export const UNSUPPORTED_TYPE_TOKENS = [TokenType.POINTER];

export const DATETIME_LITERALS = new Map<TokenType, DateTimeKind>([
  [TokenType.DATE_LITERAL, 'date'], [TokenType.TIME_LITERAL, 'time'], [TokenType.TIMESTAMP_LITERAL, 'timestamp'],
]);

// Opérations sur fichiers natifs : tokens dédiés
export const FILE_OPERATION_TOKENS = [
  TokenType.SETLL, TokenType.SETGT, TokenType.READ, TokenType.READE, TokenType.READP, TokenType.READPE,
  TokenType.CHAIN, TokenType.OPEN, TokenType.CLOSE, TokenType.UPDATE, TokenType.DELETE, TokenType.WRITE,
];
export const READ_OPERATIONS = new Set(['read', 'readp', 'reade', 'readpe', 'chain', 'setll', 'setgt']);
// Opérations dont le premier opérande est une clé
export const KEYED_OPERATIONS = new Set(['reade', 'readpe', 'chain', 'setll', 'setgt']);

// Fonctions de fichier : l'argument facultatif est un nom de fichier, évalué par l'interpréteur
export const FILE_BUILTINS = new Set(['%eof', '%found', '%equal', '%open']);

// Codes opération RPG free form non supportés (reconnus quand ils ne sont pas
// suivis de '=', '.' ou '(' : sinon ce sont des noms de variable ou de procédure)
export const UNSUPPORTED_OPCODES = new Set([
  'acq', 'clear', 'commit', 'data-gen', 'data-into', 'dealloc', 'dump',
  'eval-corr', 'evalr', 'except', 'exfmt', 'feod', 'force', 'in', 'next',
  'on-excp', 'on-exit', 'out', 'post', 'readc', 'rel', 'reset',
  'rolbk', 'snd-msg', 'sorta', 'test', 'xml-into', 'xml-sax',
]);

export const INDICATOR = /^\*in(lr|\d\d)$/;
export const SUPPORTED_SPECIAL_VALUES = new Set(['*on', '*off', '*zero', '*zeros', '*blank', '*blanks']);

// Fonctions valides sans parenthèses
export const NO_ARGUMENT_BUILTINS = new Set(['%date', '%time', '%timestamp', '%status', '%error']);
export const FORMAT_BUILTINS = new Set(['%char', '%date', '%time', '%timestamp']);

// Position (0 = 1er argument) de l'unité de date (*DAYS, *M...) dans %DIFF et %SUBDT
export const UNIT_ARGUMENT = new Map([['%diff', 2], ['%subdt', 1]]);

// Nombre exact d'arguments des fonctions de dates
export const BUILTIN_ARITY: { [name: string]: number } = {
  '%diff': 3, '%subdt': 2, '%years': 1, '%months': 1, '%days': 1,
  '%hours': 1, '%minutes': 1, '%seconds': 1, '%mseconds': 1,
};

export function unsupported(what: string, token: Token): Error {
  return new Error(`${what} : pas encore supporté par l'interpréteur (ligne ${token.line})`);
}

export const COMPOUND_OPERATORS = new Map<TokenType, string>([
  [TokenType.PLUS_EQUALS, '+'],
  [TokenType.MINUS_EQUALS, '-'],
  [TokenType.MULTIPLY_EQUALS, '*'],
  [TokenType.DIVIDE_EQUALS, '/'],
  [TokenType.POWER_EQUALS, '**'],
]);
