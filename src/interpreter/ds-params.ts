import { ExpressionNode, ParameterNode } from '../types';
import { defaultValue } from '../datatypes';
import { NotSupportedError, incompatibleTypes } from '../errors';
import { DsOrigin, DsShape } from '../ds-shape';
import { formatLayout } from './files/layout';
import { InterpreterState } from './state';

// Argument d'un paramètre LIKEDS / LIKEREC : la DS de l'appelant (disposition) et une copie de ses valeurs
export interface DsArgument {
  name: string;
  shape: DsShape;
  values: { [field: string]: any };
}

// Paramètre DS : seules les options absentes sont supportées (*NOPASS, *OMIT : pas encore)
export function checkDsParameters(procName: string, params: ParameterNode[]): void {
  const param = params.find(p => p.dataType.typeName === 'ds' && p.options.length > 0);
  if (param) throw new NotSupportedError(`OPTIONS(${param.options.join(' : ').toUpperCase()}) du paramètre structure de données ${param.name.toUpperCase()} de ${procName}`);
}

// Lu dans la portée de l'appelant, avant l'ouverture du cadre de la procédure
export function dsArgument(s: InterpreterState, param: ParameterNode, arg: ExpressionNode): DsArgument {
  const name = arg.valueType === 'identifier' ? String(arg.value) : undefined;
  const shape = name !== undefined && !name.includes('.') ? s.runtime.getShape(name) : undefined;
  if (name === undefined || !shape) {
    throw incompatibleTypes(`Le paramètre ${param.name.toUpperCase()} attend une structure de données : valeur, variable ou sous-zone passée`);
  }
  return { name, shape, values: { ...s.runtime.getVariable(name) } };
}

const sameOrigin = (a?: DsOrigin, b?: DsOrigin) => !!a && !!b && a.usage === b.usage
  && a.table.toUpperCase() === b.table.toUpperCase() && a.format.toUpperCase() === b.format.toUpperCase();

// Déclare le paramètre DS dans le cadre de la procédure : DS qualifiée locale, copie de l'argument.
// Filiation exigée : LIKEDS = même racine ; LIKEREC = même fichier, même format et même usage.
export function declareDsParameter(s: InterpreterState, param: ParameterNode, arg: DsArgument): void {
  const like = param.dataType.like!;
  let fields: { name: string; type: any }[];
  let link: { origin?: DsOrigin; root?: number };
  let related: boolean;
  if (like.kind === 'likeds') {
    const source = s.runtime.getShape(like.name);
    if (!source) throw new Error(`LIKEDS(${like.name.toUpperCase()}) : ${like.name.toUpperCase()} n'est pas une structure de données déclarée`);
    fields = source.fields;
    link = { origin: source.origin, root: source.root };
    related = arg.shape.root === source.root;
  } else {
    const layout = formatLayout(s, like.name, like.usage);
    fields = layout.fields;
    link = { origin: layout.origin };
    related = sameOrigin(arg.shape.origin, layout.origin);
  }
  const what = `Structure de données ${arg.name.toUpperCase()} passée au paramètre ${param.name.toUpperCase()} (${like.kind.toUpperCase()}(${like.name.toUpperCase()}))`;
  if (!related) {
    // Par référence, le compilateur IBM i exige des types identiques ; CONST et VALUE : comportement non vérifié
    if (!param.isConst && !param.byValue) throw incompatibleTypes(`${what} sans filiation avec la définition`);
    throw new NotSupportedError(`${what} sans filiation avec la définition`);
  }
  s.runtime.declareDataStructure(param.name, fields.map(f => ({
    ...f,
    value: arg.values[f.name.toLowerCase()] ?? defaultValue(f.type),
  })), true, link);
}

// Au retour d'un paramètre par référence : recopie des sous-zones dans la DS de l'appelant
export function copyBackDs(s: InterpreterState, arg: DsArgument, values: { [field: string]: any }): void {
  for (const f of arg.shape.fields) s.runtime.setField(arg.name, f.name, values[f.name.toLowerCase()]);
}
