// Conditions d'indicateurs de displays.json (syntaxe "if" : "31 N32")
// Indicateurs tous vrais (ET) ; negated : l'indicateur doit être à 0
export type Condition = { indicator: number; negated: boolean }[];

// "31 N32" : indicateurs séparés par des blancs, N devant = négation
export function condition(raw: any, where: string): Condition | undefined {
  if (raw === undefined) return undefined;
  const tokens = typeof raw === 'string' ? raw.trim().split(/\s+/) : [];
  if (typeof raw !== 'string' || raw.trim() === '' || !tokens.every(t => /^N?\d+$/.test(t))) {
    throw new Error(`${where} : "if" mal formé : indicateurs "01" à "99" séparés par des blancs, N devant pour la négation`);
  }
  return tokens.map(t => {
    const negated = t.startsWith('N');
    return { indicator: indicator(negated ? t.slice(1) : t, `${where} : "if"`), negated };
  });
}

export function indicator(digits: string, where: string): number {
  const n = Number(digits);
  if (n < 1 || n > 99) throw new Error(`${where} : indicateur '${digits}' hors de 01 à 99`);
  return n;
}

export const isObject = (v: any): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
