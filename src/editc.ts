import { NotSupportedError } from './errors';

export const EDIT_CODE = /^[1-4A-DJ-QXYZ]$/i;

// Codes 1-4, A-D, J-Q : le séparateur de milliers (1, 2, A, B, J, K, N, O) et l'affichage du zéro (1, 3, A, C, J, L, N, P)
const COMMAS = new Set('12ABJKNO');
const ZERO_BALANCE = new Set('13ACJLNP');

// %EDITC en fonction pure : valeur numérique, chiffres et décimales du type déclaré, code d'édition.
// Séparateur de milliers « , », point décimal « . » (DECEDIT par défaut).
export function editc(value: number, digits: number, decimals: number, rawCode: string): string {
  const code = rawCode.toUpperCase();
  const all = Math.abs(value).toFixed(decimals).replace('.', '').padStart(digits, '0');
  const isZero = /^0*$/.test(all);
  const negative = value < 0 && !isZero;
  if (code === 'X') {
    if (negative) throw new NotSupportedError(`%EDITC avec le code X d'une valeur négative`);
    return all;
  }
  if (code === 'Y') return editDate(all, decimals, isZero);
  const intLen = digits - decimals;
  if (code === 'Z') return isZero ? ' '.repeat(digits) : all.replace(/^0+/, z => ' '.repeat(z.length));

  const intDigits = all.slice(0, intLen);
  const fraction = all.slice(intLen);
  const commas = COMMAS.has(code);
  let core: string;
  if (isZero) {
    if (!ZERO_BALANCE.has(code)) return ' '.repeat(blankLength(code, intLen, decimals, commas));
    core = ' '.repeat(blankLength(code, intLen, decimals, commas) - signLength(code) - (decimals ? decimals + 1 : 1))
      + (decimals ? '.' + fraction : '0');
  } else {
    // Dernier chiffre entier conservé s'il n'y a pas de décimales ; avec décimales, tout est supprimé jusqu'au point
    let first = intDigits.search(/[1-9]/);
    if (first < 0) first = decimals ? intLen : intLen - 1;
    let cells = '';
    for (let j = 0; j < intLen; j++) {
      if (commas && j > 0 && (intLen - j) % 3 === 0) cells += j <= first ? ' ' : ',';
      cells += j < first ? ' ' : intDigits[j];
    }
    core = cells + (decimals ? '.' + fraction : '');
  }
  return withSign(core, code, negative);
}

function signLength(code: string): number {
  return /[A-D]/.test(code) ? 2 : /[J-Q]/.test(code) ? 1 : 0;
}

function blankLength(code: string, intLen: number, decimals: number, commas: boolean): number {
  const separators = commas && intLen > 0 ? Math.floor((intLen - 1) / 3) : 0;
  return intLen + decimals + separators + (decimals ? 1 : 0) + signLength(code);
}

function withSign(core: string, code: string, negative: boolean): string {
  if (/[A-D]/.test(code)) return core + (negative ? 'CR' : '  ');
  if (/[J-M]/.test(code)) return core + (negative ? '-' : ' ');
  if (/[N-Q]/.test(code)) {
    const padded = ' ' + core;
    if (!negative) return padded;
    const at = core.search(/\S/);
    return padded.slice(0, at) + '-' + padded.slice(at + 1);
  }
  return core;
}

// Y : date nn/nn/nn (6 chiffres) ou nn/nn/nnnn (8 chiffres), un premier zéro est suppressé
function editDate(all: string, decimals: number, isZero: boolean): string {
  if ((all.length !== 6 && all.length !== 8) || decimals > 0) {
    throw new NotSupportedError(`%EDITC avec le code Y sur ${all.length} chiffres${decimals ? ' avec décimales' : ''}`);
  }
  if (isZero) throw new NotSupportedError(`%EDITC avec le code Y d'une valeur nulle`);
  const text = `${all.slice(0, 2)}/${all.slice(2, 4)}/${all.slice(4)}`;
  return text.replace(/^0/, ' ');
}
