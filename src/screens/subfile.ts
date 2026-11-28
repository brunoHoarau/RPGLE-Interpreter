// Stockage d'un sous-fichier 5250 : lignes par rang, drapeau « modifié », position de READC
import type { AreaValue } from './area';

export interface SubfileRecord { values: Map<string, AreaValue>; indicators: string; changed: boolean }

const MAX_RRN = 9999;

export class Subfile {
  private lines = new Map<number, SubfileRecord>();
  private position = 0;          // dernier rang rendu par READC

  constructor(private readonly size: number, private readonly page: number, private readonly extensible: boolean) {}

  get count(): number { return this.lines.size; }

  // Message d'erreur, ou undefined si la ligne est enregistrée
  write(rrn: number, r: SubfileRecord): string | undefined {
    if (!Number.isInteger(rrn) || rrn < 1 || rrn > MAX_RRN) return `rang ${rrn} du sous-fichier invalide : 1 à ${MAX_RRN} attendu`;
    if (this.lines.has(rrn)) return `rang ${rrn} déjà présent dans le sous-fichier`;
    if (rrn > this.count + 1) return `rang ${rrn} : trou dans le sous-fichier (dernier rang écrit : ${this.count})`;
    if (!this.extensible && rrn > this.size) return `rang ${rrn} au-delà de la taille ${this.size} du sous-fichier (SFLSIZ = SFLPAG : non extensible)`;
    this.lines.set(rrn, r);
    return undefined;
  }

  chain(rrn: number): SubfileRecord | undefined { return this.lines.get(rrn); }

  update(rrn: number, r: SubfileRecord): void { this.lines.set(rrn, r); }

  // Prochaine ligne modifiée après la position courante, en ordre de rang ; elle n'est plus modifiée
  readChanged(): { rrn: number; record: SubfileRecord } | undefined {
    const rrns = [...this.lines.keys()].filter(n => n > this.position).sort((a, b) => a - b);
    for (const rrn of rrns) {
      const record = this.lines.get(rrn)!;
      if (!record.changed) continue;
      record.changed = false;
      this.position = rrn;
      return { rrn, record };
    }
    this.position = Math.max(this.position, ...this.lines.keys(), 0);
    return undefined;
  }

  resetPosition(): void { this.position = 0; }

  clear(): void {
    this.lines.clear();
    this.position = 0;
  }

  delete(): void { this.clear(); }

  // SFLINZ : size lignes à blanc/zéro, non modifiées
  initialize(blank: () => Map<string, AreaValue>): void {
    this.clear();
    for (let rrn = 1; rrn <= this.size; rrn++) this.lines.set(rrn, { values: blank(), indicators: '', changed: false });
  }

  pageOf(rrn: number): number { return Math.ceil(rrn / this.page); }

  // Rangs présents de la page (page 1 = rangs 1..page)
  rows(page: number): number[] {
    const first = (page - 1) * this.page + 1;
    const result: number[] = [];
    for (let rrn = first; rrn < first + this.page; rrn++) if (this.lines.has(rrn)) result.push(rrn);
    return result;
  }
}
