// Ordre de tri EBCDIC des clés de fichier.
import { NotSupportedError } from '../errors';

// Collation EBCDIC des caractères invariants (identiques dans tous les CCSID EBCDIC latins)
export const EBCDIC: { [ch: string]: number } = (() => {
  const map: { [ch: string]: number } = { ' ': 0x40, '.': 0x4b, '<': 0x4c, '(': 0x4d, '+': 0x4e, '&': 0x50,
    '*': 0x5c, ')': 0x5d, ';': 0x5e, '-': 0x60, '/': 0x61, ',': 0x6b, '%': 0x6c, '_': 0x6d, '>': 0x6e,
    '?': 0x6f, ':': 0x7a, "'": 0x7d, '=': 0x7e, '"': 0x7f };
  const range = (from: string, to: string, start: number) => {
    for (let c = from.charCodeAt(0), i = 0; c <= to.charCodeAt(0); c++, i++) map[String.fromCharCode(c)] = start + i;
  };
  range('a', 'i', 0x81); range('j', 'r', 0x91); range('s', 'z', 0xa2);
  range('A', 'I', 0xc1); range('J', 'R', 0xd1); range('S', 'Z', 0xe2);
  range('0', '9', 0xf0);
  return map;
})();

// Texte comparable dans l'ordre EBCDIC d'IBM i (blancs de fin ignorés)
export function ebcdicKey(text: string): string {
  let result = '';
  for (const ch of text.replace(/ +$/, '')) {
    const code = EBCDIC[ch];
    if (code === undefined) throw new NotSupportedError(`Clé contenant le caractère '${ch}' (ordre EBCDIC non simulé)`);
    result += String.fromCharCode(code);
  }
  return result;
}
