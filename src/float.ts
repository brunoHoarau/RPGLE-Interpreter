// Nombres flottants RPG : présentation externe, conversion depuis un texte, troncature exacte vers un décimal
import { NotSupportedError, RpgError, STATUS_INVALID_NUMERIC } from './errors';

// Valeur flottante finie : un débordement (1E308 * 10) est refusé plutôt que représenté par Infinity
export function checkFloat(value: number): number {
  if (!Number.isFinite(value)) throw new NotSupportedError('Valeur flottante hors limites (infinie ou non numérique)');
  return value;
}

// Format externe IBM i : signe toujours écrit, mantisse normalisée, E, signe de l'exposant
//   float(8) : 23 caractères, 16 chiffres significatifs, exposant sur 3 chiffres (+1.000000000000000E+000)
//   float(4) : 14 caractères, 8 chiffres significatifs, exposant sur 2 chiffres (+1.2345678E+03)
export function formatFloat(value: number, length: 4 | 8): string {
  checkFloat(value);
  const [mantissa, exponent] = Math.abs(value).toExponential(length === 4 ? 7 : 15).split('e');
  const exp = Number(exponent);
  const sign = value < 0 ? '-' : '+';
  return `${sign}${mantissa}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(length === 4 ? 2 : 3, '0')}`;
}

// %FLOAT d'un texte : blancs ignorés, signe, point ou virgule, exposant E permis ; sinon RNX0105
export function floatFromText(value: any): number {
  const text = String(value).replace(/ /g, '');
  const m = text.match(/^([+-])?(\d*[.,]?\d*)(?:[eE]([+-]?\d+))?$/);
  if (!m || !/\d/.test(m[2])) throw new RpgError(STATUS_INVALID_NUMERIC, `Valeur non numérique '${value}' (RNX0105)`);
  const n = Number(`${m[2].replace(',', '.')}e${m[3] ?? 0}`) * (m[1] === '-' ? -1 : 1);
  return checkFloat(n);
}

// Troncature de la valeur binaire exacte du double à `decimals` décimales (0.29 vaut 0.28999999999999998 : donne 0.28)
export function truncateExact(value: number, decimals: number): number {
  checkFloat(value);
  if (value === 0) return 0;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, Math.abs(value));
  const high = bits.getUint32(0), low = bits.getUint32(4);
  const biased = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (biased === 0 ? 1 : biased) - 1075;    // |valeur| = mantissa * 2^exponent
  const scaled = mantissa * 10n ** BigInt(decimals);
  const digits = exponent >= 0 ? scaled << BigInt(exponent) : scaled >> BigInt(-exponent);
  const result = Number(`${digits}e-${decimals}`);
  return value < 0 && result !== 0 ? -result : result;
}
