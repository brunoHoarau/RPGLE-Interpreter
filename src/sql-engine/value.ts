// Expressions de valeur (VALUES, SET) compilées en fonctions.
import { NotSupportedError } from '../errors';
import { isReservedSqlWord } from './reserved';
import { getHostVariable } from './support';
import type { HostVariables } from './types';

// Analyse une expression de valeur et renvoie une fonction (ligne, variables hôtes) => valeur.
// `columns` : colonnes utilisables (SET) ; null pour VALUES, où aucune colonne n'est visible.
// Les constructions hors périmètre (fonctions, ||, CASE, sous-requêtes...) arrêtent le programme.
export function compileValue(text: string, columns: Set<string> | null): (row: any, hostVars: HostVariables) => any {
  type Evaluator = (row: any, hostVars: HostVariables) => any;
  const unsupported = (): never => {
    throw new NotSupportedError(`Expression SQL '${text.trim()}'`);
  };

  // Jetons : chaîne, nombre, variable hôte, mot, opérateur, parenthèse
  const tokens: { kind: 'string' | 'number' | 'host' | 'word' | 'op' | 'lparen' | 'rparen'; value: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    let m: RegExpMatchArray | null;
    const rest = text.slice(i);
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "'") {
      let value = '';
      i++;
      while (true) {
        if (i >= text.length) throw new Error(`Chaîne non terminée : ${text.trim()}`);
        if (text[i] === "'") {
          if (text[i + 1] === "'") { value += "'"; i += 2; continue; }
          i++;
          break;
        }
        value += text[i++];
      }
      tokens.push({ kind: 'string', value });
    } else if ((m = rest.match(/^\d+(?:\.\d+)?/))) {
      tokens.push({ kind: 'number', value: m[0] });
      i += m[0].length;
    } else if ((m = rest.match(/^:([A-Za-z_$#@][\w$#@]*(?:\.[\w$#@]+)?)/))) {
      tokens.push({ kind: 'host', value: m[1] });
      i += m[0].length;
    } else if ((m = rest.match(/^[A-Za-z_][\w$#@]*/))) {
      tokens.push({ kind: 'word', value: m[0] });
      i += m[0].length;
    } else if ('+-*/'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i++;
    } else if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch });
      i++;
    } else if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch });
      i++;
    } else {
      return unsupported();   // ||, comparaisons, etc.
    }
  }

  let pos = 0;
  const isOp = (v: string) => tokens[pos]?.kind === 'op' && tokens[pos].value === v;

  const numeric = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    return unsupported();   // une chaîne dans un calcul
  };

  const parseAtom = (): Evaluator => {
    const t = tokens[pos];
    if (!t) return unsupported();
    pos++;
    switch (t.kind) {
      case 'string': return () => t.value;
      case 'number': return () => Number(t.value);
      case 'host': return (_row, hostVars) => getHostVariable(t.value, hostVars);
      case 'word': {
        const upper = t.value.toUpperCase();
        if (upper === 'NULL') return () => null;
        // Fonction, CURRENT DATE, CASE... : pas une simple colonne
        if (tokens[pos]?.kind === 'lparen' || isReservedSqlWord(upper, columns) || !columns) return unsupported();
        if (!columns.has(upper)) throw new Error(`Colonne inconnue: ${upper}`);
        return (row) => {
          const key = Object.keys(row).find(k => k.toUpperCase() === upper);
          return key === undefined ? null : row[key];
        };
      }
      default: return unsupported();
    }
  };

  const parseFactor = (): Evaluator => {
    if (isOp('-')) {
      pos++;
      const inner = parseFactor();
      return (row, hv) => {
        const v = numeric(inner(row, hv));
        return v === null ? null : -v;
      };
    }
    if (tokens[pos]?.kind === 'lparen') {
      pos++;
      const inner = parseExpr();
      if (tokens[pos]?.kind !== 'rparen') return unsupported();
      pos++;
      return inner;
    }
    return parseAtom();
  };

  // 15 chiffres significatifs, comme les décimaux : balance + 0.1 ne laisse pas de résidu binaire
  const exact = (n: number) => {
    if (Math.abs(n) >= 1e15) throw new NotSupportedError('Résultat de calcul SQL de 15 chiffres ou plus');
    return Number(n.toPrecision(15));
  };

  const binary = (op: string, left: Evaluator, right: Evaluator): Evaluator => (row, hv) => {
    const a = numeric(left(row, hv));
    const b = numeric(right(row, hv));
    if (a === null || b === null) return null;
    switch (op) {
      case '+': return exact(a + b);
      case '-': return exact(a - b);
      default: return exact(a * b);
    }
  };

  const parseTerm = (): Evaluator => {
    let left = parseFactor();
    while (isOp('*') || isOp('/')) {
      // Précision et échelle du quotient DB2 non simulées
      if (isOp('/')) throw new NotSupportedError('Division dans une expression SQL');
      const op = tokens[pos++].value;
      left = binary(op, left, parseFactor());
    }
    return left;
  };

  const parseExpr = (): Evaluator => {
    let left = parseTerm();
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].value;
      left = binary(op, left, parseTerm());
    }
    return left;
  };

  const evaluator = parseExpr();
  if (pos < tokens.length) return unsupported();
  return evaluator;
}
