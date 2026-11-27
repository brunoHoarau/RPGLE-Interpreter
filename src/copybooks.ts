// Directives /COPY et /INCLUDE : lecture de la désignation du membre et recherche du source en local
import * as fs from 'fs';
import * as path from 'path';
import { ProgramSource } from './sources';
import { Token, TokenType } from './types';

// [bibliothèque/]fichier,membre — ou membre seul — ou chemin IFS
export interface CopySpec {
  library?: string;
  file?: string;
  member?: string;
  path?: string;
}

// Désignation -> source, ou undefined ; fromPath = chemin du source qui contient la directive
export type CopyResolver = (spec: CopySpec, fromPath: string | undefined) => ProgramSource | undefined;

// Texte de la désignation tel qu'écrit, pour les messages
export function describeCopySpec(spec: CopySpec): string {
  if (spec.path !== undefined) return spec.path;
  const file = spec.file !== undefined ? `${spec.library !== undefined ? spec.library + '/' : ''}${spec.file},` : '';
  return (file + spec.member).toUpperCase();
}

// Analyse le reste de la ligne après /COPY : le premier mot est la désignation, la suite un commentaire
export function parseCopySpec(text: string): CopySpec | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (trimmed[0] === "'" || trimmed[0] === '"') {
    const end = trimmed.indexOf(trimmed[0], 1);
    const value = trimmed.slice(1, end < 0 ? undefined : end);
    return value === '' ? undefined : { path: value };
  }
  const word = trimmed.split(/\s/)[0];
  const comma = word.indexOf(',');
  if (comma < 0) return word.includes('/') ? { path: word } : { member: word };
  const qualified = word.slice(0, comma);
  const member = word.slice(comma + 1);
  const slash = qualified.indexOf('/');
  return slash < 0
    ? { file: qualified, member }
    : { library: qualified.slice(0, slash), file: qualified.slice(slash + 1), member };
}

const MEMBER_EXTENSIONS = ['.rpgleinc', '.rpgle', '.sqlrpgle'];

// Entrée d'un dossier dont le nom correspond sans tenir compte de la casse
function findEntry(folder: string, matches: (entry: string) => boolean): string | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return undefined;
  }
  const entry = entries.find(matches);
  return entry !== undefined ? path.join(folder, entry) : undefined;
}

function findMember(folder: string, member: string): string | undefined {
  return findEntry(folder, entry => {
    const extension = path.extname(entry);
    return MEMBER_EXTENSIONS.includes(extension.toLowerCase())
      && path.basename(entry, extension).toUpperCase() === member.toUpperCase();
  });
}

// Recherche à partir du dossier du source qui contient la directive :
//  - chemin IFS : relatif à ce dossier ;
//  - fichier,membre : MEMBRE.rpgleinc (ou .rpgle, .sqlrpgle) dans le sous-dossier FICHIER, puis dans le dossier ;
//  - membre seul : dans le dossier, puis dans le sous-dossier QRPGLESRC (fichier par défaut).
// La bibliothèque est ignorée.
export const fileCopyResolver: CopyResolver = (spec, fromPath) => {
  const folder = fromPath !== undefined ? path.dirname(fromPath) : process.cwd();
  let found: string | undefined;
  if (spec.path !== undefined) {
    const full = path.resolve(folder, spec.path);
    found = fs.existsSync(full) && fs.statSync(full).isFile() ? full : undefined;
  } else {
    const member = spec.member!;
    const subfolder = findEntry(folder, entry => entry.toUpperCase() === (spec.file ?? 'QRPGLESRC').toUpperCase());
    const inSubfolder = () => (subfolder !== undefined ? findMember(subfolder, member) : undefined);
    found = spec.file !== undefined
      ? inSubfolder() ?? findMember(folder, member)
      : findMember(folder, member) ?? inSubfolder();
  }
  return found !== undefined ? { source: fs.readFileSync(found, 'utf8'), path: found } : undefined;
};

export interface CopyOptions {
  resolveCopy?: CopyResolver;   // recherche des membres /COPY et /INCLUDE (par défaut : sur disque)
  path?: string;                // chemin du source, point de départ de la recherche des membres
  copyStack?: string[];         // membres en cours d'inclusion (détection des /COPY récursifs)
  rpgppopt?: string;            // option RPGPPOPT de CRTSQLRPGI : *NONE (défaut), *LVL1, *LVL2
  underInclude?: string;        // /INCLUDE englobant que le précompilateur SQL ne développe pas
}

const RPGPPOPT_VALUES = ['*NONE', '*LVL1', '*LVL2'];

// Situe une erreur survenue dans un membre : « ligne M (membre X, ligne N) », M étant la ligne du /COPY
export function locateInMember(error: unknown, member: string, includedAt: number): unknown {
  if (!(error instanceof Error)) return error;
  error.message = /ligne \d+/.test(error.message)
    ? error.message.replace(/ligne (\d+)/, `ligne ${includedAt} (membre ${member}, ligne $1)`)
    : `${error.message} (ligne ${includedAt}, membre ${member})`;
  return error;
}

type Tokenize = (source: string, options: CopyOptions) => Token[];

// Directives sans effet sur le programme (mise en page de la liste de compilation)
const LISTING_DIRECTIVES = ['eject', 'space', 'title'];

// text = ligne de la directive sans le '/' ; renvoie les tokens à insérer, ou 'eof' pour ignorer la suite du source
export function compileDirective(text: string, line: number, options: CopyOptions, tokenize: Tokenize): Token[] | 'eof' {
  const name = /^[a-z-]+/i.exec(text)![0].toLowerCase();
  if (name === 'eof') return 'eof';
  if (name === 'copy' || name === 'include') return includeMember(name.toUpperCase(), text.slice(name.length), line, options, tokenize);
  if (LISTING_DIRECTIVES.includes(name)) return [];
  throw new Error(`Directive /${name.toUpperCase()} non supportée par l'interpréteur (ligne ${line})`);
}

// Tokens du membre désigné, qui remplacent la directive
function includeMember(directive: string, rest: string, line: number, options: CopyOptions, tokenize: Tokenize): Token[] {
  const spec = parseCopySpec(rest);
  if (!spec) throw new Error(`/${directive} sans nom de membre (ligne ${line})`);
  const label = describeCopySpec(spec);
  const member = (options.resolveCopy ?? fileCopyResolver)(spec, options.path);
  if (!member) {
    throw new Error(`/${directive} ${label} introuvable : placez le membre (NOM.rpgleinc) à côté du programme `
      + `ou dans un sous-dossier portant le nom du fichier source (ligne ${line})`);
  }
  const stack = options.copyStack ?? (options.path !== undefined ? [options.path.toUpperCase()] : []);
  const key = (member.path ?? label).toUpperCase();
  if (stack.includes(key)) throw new Error(`/${directive} ${label} : inclusion récursive (ligne ${line})`);
  const rpgppopt = (options.rpgppopt ?? '*NONE').toUpperCase();
  if (!RPGPPOPT_VALUES.includes(rpgppopt)) throw new Error(`RPGPPOPT(${rpgppopt}) inconnu : *NONE, *LVL1 ou *LVL2 attendu`);
  // Sans RPGPPOPT(*LVL2), le précompilateur SQL ne développe pas /INCLUDE : ce qu'il contient n'est pas vu
  const underInclude = options.underInclude ?? (directive === 'INCLUDE' && rpgppopt !== '*LVL2' ? `/INCLUDE ${label}` : undefined);
  let tokens: Token[];
  try {
    tokens = tokenize(member.source, { ...options, path: member.path, copyStack: [...stack, key], underInclude });
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    const error = e as Error & { copyMember?: string };
    error.copyMember ??= label;
    throw options.copyStack === undefined ? locateInMember(error, error.copyMember, line) : error;
  }
  for (const token of tokens) {
    token.member ??= label;
    token.includedAt = line;
  }
  if (underInclude !== undefined && options.underInclude === undefined && tokens.some(t => t.type === TokenType.EXEC_SQL)) {
    throw new Error(`EXEC SQL dans le membre ${underInclude} : avec RPGPPOPT(${rpgppopt}), le précompilateur SQL `
      + `ne développe pas /INCLUDE ; utilisez /COPY ou RPGPPOPT(*LVL2) (ligne ${line})`);
  }
  return tokens;
}
