import { NotSupportedError } from '../../errors';
import { FileOperationNode } from '../../types';
import { DsOrigin, DsShape } from '../../ds-shape';
import { evaluate } from '../evaluate/evaluate';
import { findTable } from './layout';
import { InterpreterState, FileState } from '../state';

// Opérations de fichier avec une structure de données : contrôles du compilateur (origine et type
// d'extraction de la DS), liste de clés %KDS, zones réécrites par %FIELDS.

// La DS porte-t-elle sur le format de ce fichier ?
// LIKEREC : même DCL-F et même format de programme (après RENAME) ; EXTNAME : même table et format réel de la table
export function dsOriginMatchesFile(s: InterpreterState, origin: DsOrigin, state: FileState): boolean {
  if (origin.via === 'likerec') {
    return origin.table === state.file.name && origin.format === state.file.format;
  }
  return origin.format === state.realFormat && findTable(s, origin.table) === state.table;
}

const ALLOWED_USAGE = {
  read: ['input', 'all'], readp: ['input', 'all'], reade: ['input', 'all'], readpe: ['input', 'all'], chain: ['input', 'all'],
  write: ['output', 'all'], update: ['input', 'all'],
} as { [op: string]: string[] | undefined };

const USAGE_NAME = { input: '*INPUT', all: '*ALL', output: '*OUTPUT' } as { [usage: string]: string };

// DS résultat (lecture) ou source (WRITE, UPDATE) : erreur de compilation si elle ne porte pas sur le format du fichier
// ou si son type d'extraction ne convient pas au sens de l'opération. Fait avant tout accès au fichier.
export function checkIoDs(s: InterpreterState, node: FileOperationNode, state: FileState): DsShape {
  const name = node.resultDs!;
  const op = node.operation.toUpperCase();
  const refuse = (why: string) => new Error(`Le compilateur IBM i refuse ${op} ${state.file.format} avec la structure de données ${name.toUpperCase()} : ${why}`);
  const shape = s.runtime.getShape(name);
  if (!shape) throw new Error(`${name.toUpperCase()} n'est pas une structure de données déclarée`);
  const origin = shape.origin;
  if (!origin) throw refuse(`elle ne porte pas sur le format ${state.file.format} (LIKEREC ou EXTNAME attendu)`);
  if (origin.usage === 'none') throw refuse('EXTNAME sans type d\'extraction ne peut pas servir à une opération d\'entrée-sortie');
  if (!dsOriginMatchesFile(s, origin, state)) throw refuse(`elle ne porte pas sur le format ${state.file.format}`);
  const allowed = ALLOWED_USAGE[node.operation] ?? [];
  if (!allowed.includes(origin.usage)) {
    throw refuse(`type d'extraction *${origin.usage.toUpperCase()}, ${allowed.map(u => USAGE_NAME[u]).join(' ou ')} attendu`);
  }
  if (shape.fields.length !== state.file.fields.length) {
    throw refuse(`elle n'a pas les ${state.file.fields.length} zones du format`);
  }
  return shape;
}

// Liste de clés de %KDS(ds {: n}) : les n premières sous-zones de la DS (toutes par défaut)
export function kdsKey(s: InterpreterState, node: FileOperationNode): any[] {
  const kds = node.kds!;
  const shape = s.runtime.getShape(kds.ds);
  if (!shape) throw new Error(`${kds.ds.toUpperCase()} n'est pas une structure de données déclarée`);
  const count = kds.count ? Number(evaluate(s, kds.count)) : shape.fields.length;
  if (count > shape.fields.length) {
    throw new Error(`%KDS(${kds.ds.toUpperCase()} : ${count}) : la structure de données n'a que ${shape.fields.length} sous-zone(s)`);
  }
  return shape.fields.slice(0, count).map(f => s.runtime.getField(kds.ds, f.name));
}

// %FIELDS de UPDATE : zones du format (noms de fichier, en majuscules) à réécrire ; undefined sans %FIELDS.
// Sans DS : noms de zones du programme. Avec DS : sous-zones qualifiées de la DS résultat. Les mélanges ne sont pas simulés.
export function fieldsToUpdate(s: InterpreterState, node: FileOperationNode, state: FileState): Set<string> | undefined {
  if (!node.fields) return undefined;
  const zones = new Set<string>();
  const ds = node.resultDs?.toLowerCase();
  const shape = ds ? s.runtime.getShape(ds) : undefined;
  for (const name of node.fields) {
    const dot = name.indexOf('.');
    const unknown = () => new Error(`%FIELDS(${name.toUpperCase()}) : ${name.toUpperCase()} n'est pas une zone du format ${state.file.format}`);
    if (!ds) {
      if (dot >= 0) throw new NotSupportedError(`%FIELDS(${name.toUpperCase()}) sans structure de données résultat`);
      const zone = [...state.variables].find(([, variable]) => variable.toLowerCase() === name);
      if (!zone) throw unknown();
      zones.add(zone[0]);
    } else {
      if (dot < 0) throw new NotSupportedError(`%FIELDS(${name.toUpperCase()}) : zone simple avec une structure de données résultat`);
      if (name.slice(0, dot) !== ds) throw new NotSupportedError(`%FIELDS(${name.toUpperCase()}) : sous-zone d'une autre structure de données que ${ds.toUpperCase()}`);
      const index = shape!.fields.findIndex(f => f.name.toLowerCase() === name.slice(dot + 1));
      if (index < 0) throw unknown();
      zones.add(state.file.fields[index].name);
    }
  }
  return zones;
}
