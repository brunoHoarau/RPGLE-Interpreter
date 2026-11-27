// Mots d'édition (%EDITW), selon ILE RPG Reference 7.5, « Edit words » (rzasd/editwd*.htm).
// Corps : blancs et premier 0 ou * (arrêt de la suppression des zéros) = positions de chiffres ; autres caractères = constantes.
// Statut : CR (premier après le dernier blanc) ou - (dernier caractère), imprimé seulement si la valeur est négative.
// Expansion : ce qui suit, toujours imprimé. & donne un blanc partout.
import { NotSupportedError } from './errors';

interface EditWord { body: string; stop: number; status: string; expansion: string; positions: number }

export function parseEditWord(word: string): EditWord {
  const stop = word.search(/[0*]/);
  const bodyEnd = Math.max(word.lastIndexOf(' '), stop) + 1;
  const rest = word.slice(bodyEnd);
  const cr = rest.indexOf('CR');
  const statusEnd = cr >= 0 ? cr + 2 : rest.endsWith('-') ? rest.length : 0;
  const body = word.slice(0, bodyEnd);
  const positions = [...body].filter((c, i) => c === ' ' || i === stop).length;
  return { body, stop: stop < bodyEnd ? stop : -1, status: rest.slice(0, statusEnd), expansion: rest.slice(statusEnd), positions };
}

// value : valeur de la zone ; digits, decimals : son type déclaré
export function editw(value: number, digits: number, decimals: number, word: string): string {
  const ew = parseEditWord(word);
  if (ew.positions < digits) {
    throw new Error(`%EDITW : le mot d'édition '${word}' a ${ew.positions} positions de chiffres pour une zone de ${digits} chiffres`);
  }
  // $ suivi du zéro d'arrêt : symbole flottant (les exemples IBM sont incohérents, non simulé)
  if (ew.stop > 0 && ew.body[ew.stop - 1] === '$') throw new NotSupportedError('%EDITW avec un symbole monétaire flottant');
  const source = Math.round(Math.abs(value) * 10 ** decimals).toString().padStart(ew.positions, '0');
  const fill = ew.stop >= 0 && ew.body[ew.stop] === '*' ? '*' : ' ';
  let next = 0;
  let significant = false;   // un chiffre significatif, ou le zéro d'arrêt, est passé à gauche
  let out = '';
  [...ew.body].forEach((c, i) => {
    if (c === ' ' || i === ew.stop) {
      const digit = source[next++];
      if (digit !== '0') significant = true;
      out += significant ? digit : fill;
      if (i === ew.stop) significant = true;
    } else if (c === '&') {
      out += ' ';
    } else if (i === 0 && c === '$') {
      out += '$';   // symbole monétaire fixe en première position
    } else {
      out += significant ? c : fill;
    }
  });
  const status = value < 0 ? ew.status.replace(/&/g, ' ') : ' '.repeat(ew.status.length);
  return out + status + ew.expansion.replace(/&/g, ' ');
}
