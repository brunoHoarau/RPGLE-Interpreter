// Fonctions intégrées supportées. Cette table est la seule source de vérité :
// le runtime les exécute, le parser refuse dès l'analyse celles qui n'y sont pas.

export interface BuiltinContext {
  status: number; // Pour %STATUS
  now(): Date;    // Pour %DATE(), %TIME(), %TIMESTAMP()
}

type Builtin = (ctx: BuiltinContext, ...args: any[]) => any;

export const BUILTINS: { [name: string]: Builtin } = {
  '%status': ctx => ctx.status,
  '%len': (_, str: any) => String(str).length,
  '%trim': (_, str: any) => String(str).trim(),
  '%trimr': (_, str: any) => String(str).trimEnd(),
  '%triml': (_, str: any) => String(str).trimStart(),
  '%subst': (_, source: any, start: number, length?: number) => {
    const str = String(source);
    const startPos = start - 1;
    return length !== undefined ? str.substr(startPos, length) : str.substr(startPos);
  },
  '%int': (_, value: any) => parseInt(value),
  '%dec': (_, value: any, precision?: number, decimals?: number) => {
    const num = parseFloat(value);
    return decimals !== undefined ? parseFloat(num.toFixed(decimals)) : num;
  },
  '%char': (_, value: any) => String(value),
  '%scan': (_, search: any, source: any) => {
    const pos = String(source).indexOf(String(search));
    return pos === -1 ? 0 : pos + 1;
  },
  '%upper': (_, str: any) => String(str).toUpperCase(),
  '%lower': (_, str: any) => String(str).toLowerCase(),
  '%replace': (_, newStr: any, source: any, start: number, length?: number) => {
    const str = String(source);
    const startPos = start - 1;
    const len = length !== undefined ? length : String(newStr).length;
    return str.substr(0, startPos) + String(newStr) + str.substr(startPos + len);
  },
  '%check': (_, comparator: any, base: any, start: number = 1) => {
    const comp = String(comparator);
    const baseStr = String(base);
    for (let i = start - 1; i < baseStr.length; i++) {
      if (comp.indexOf(baseStr[i]) === -1) return i + 1;
    }
    return 0;
  },
  '%abs': (_, value: number) => Math.abs(value),
  '%max': (_, ...values: number[]) => Math.max(...values),
  '%min': (_, ...values: number[]) => Math.min(...values),
  '%rem': (_, dividend: number, divisor: number) => dividend % divisor,
  '%div': (_, dividend: number, divisor: number) => Math.floor(dividend / divisor),
};

export function isSupportedBuiltin(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTINS, name.toLowerCase());
}
