// Analyse du texte d'une instruction : blancs, mots et séparateurs de premier niveau.

export const HOST_NAME = /^[A-Za-z_$#@][\w$#@]*(?:\.[\w$#@]+)?$/;

// Réduit les blancs à un espace, sauf à l'intérieur des chaînes littérales
export function normalizeWhitespace(sql: string): string {
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\s+/g, ' ').replace(/\bWHERE\(/gi, 'WHERE (')))
    .join('')
    .trim();
}

// Position d'un mot entier hors littéraux et parenthèses, -1 si absent
export function findTopLevelWord(text: string, word: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") i++;
        else inString = false;
      }
    } else if (ch === "'") {
      inString = true;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (depth === 0 && /\s/.test(text[i - 1] ?? ' ') && text.substr(i, word.length).toUpperCase() === word
      && /\s|$/.test(text[i + word.length] ?? '')) {
      return i;
    }
  }
  return -1;
}

// Découpe sur un séparateur hors littéraux chaîne et hors parenthèses
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") i++;
        else inString = false;
      }
    } else if (ch === "'") {
      inString = true;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// Position de la parenthèse fermante qui correspond à une parenthèse ouverte juste avant `from`
export function findClosingParen(text: string, from: number): number {
  let depth = 1;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") i++;
        else inString = false;
      }
    } else if (ch === "'") {
      inString = true;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')' && --depth === 0) {
      return i;
    }
  }
  return -1;
}
