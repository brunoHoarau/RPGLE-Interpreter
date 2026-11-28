import { SubroutineNode, ProcedureNode, PrototypeNode, DataTypeNode, FileDeclarationNode } from '../types';
import { NativeFile } from '../files';
import { Runtime } from '../runtime';
import { ExecutionContext, TableDefinition, emptyContext } from '../context';
import { ProgramResolver } from '../sources';
import { CopyResolver } from '../copybooks';
import { DisplayFileDefinition } from '../screens/definition';
import { SpecialRoutine } from '../screens/protocol';

export interface InterpreterOptions {
  // Nombre total d'itérations de boucle autorisées avant d'arrêter l'exécution
  maxIterations?: number;
  // Nombre maximal d'appels de procédure imbriqués (protège des récursions infinies)
  maxCallDepth?: number;
  // Source des programmes appelés par EXTPGM sans bouchon
  resolveProgram?: ProgramResolver;
  // Membres /COPY et /INCLUDE des programmes appelés (par défaut : sur disque, à côté de leur source)
  resolveCopy?: CopyResolver;
  // RPGPPOPT de CRTSQLRPGI pour les programmes appelés (*NONE par défaut)
  rpgppopt?: string;
  // DSPLY numérique : valeur lisible (100.5) au lieu de la présentation IBM i (10050) ; pour les tests
  readableDsply?: boolean;
  // Horloge de *SYS, *JOB, %DATE()... ; les tests la figent
  clock?: () => Date;
  // Fabrique de la routine SPECIAL d'un fichier écran (un simulateur par fichier) ; absente : écrans refusés
  screens?: (file: string, definition: DisplayFileDefinition) => SpecialRoutine;
}

const DEFAULT_MAX_ITERATIONS = 1_000_000;
export const DEFAULT_MAX_CALL_DEPTH = 256;

// État d'un fichier déclaré par DCL-F dans le programme en cours
export interface FileState {
  file: NativeFile;
  open: boolean;
  eof: boolean | undefined;   // undefined : inconnu (après un CHAIN non trouvé)
  found: boolean;
  equal: boolean;
  usage: FileDeclarationNode['usage'];
  table: TableDefinition;     // Table des données : deletedRows après une suppression native
  variables: Map<string, string>; // Zone → variable du programme (PREFIX), en majuscules
  realFormat: string;         // Format de la table (avant RENAME)
}

// Fichier écran déclaré (DCL-F WORKSTN)
export interface DisplayState {
  file: string;                    // nom du fichier, en majuscules
  definition: DisplayFileDefinition;
  routine: SpecialRoutine;
  indds?: string;                  // INDDS(nom), en majuscules
  sfile: Map<string, string>;      // SFILE : format sous-fichier (majuscules) -> variable de rang (majuscules)
  usage: { input: boolean; output: boolean };
  opened?: boolean;                // appel O réussi, appel C encore dû
  found?: boolean;                 // %FOUND après CHAIN sur un sous-fichier
  eof?: boolean;                   // %EOF après READC
  area?: boolean[];                // indicateurs des positions sans sous-zone INDDS (index 1..99), valeur interne du fichier
}

// État de l'interpréteur, partagé par les fonctions des modules de ce dossier
export class InterpreterState {
  runtime: Runtime;
  maxIterations: number;
  maxCallDepth: number;
  iterations = 0;
  returnTypes: (DataTypeNode | undefined)[] = [];
  procedures = new Map<string, ProcedureNode>();
  prototypes = new Map<string, PrototypeNode>();
  subroutines: Map<string, SubroutineNode>[] = []; // Sous-routines de la portée en cours (programme ou procédure), au sommet
  context: ExecutionContext;
  options: InterpreterOptions;
  programDepth = 0; // Niveau d'imbrication des appels de programmes source
  parmCounts: number[] = []; // %PARMS : nombre de paramètres passés, au programme puis à chaque procédure en cours
  files = new Map<string, FileState>();          // Par nom de fichier et par nom de format, en majuscules
  displays = new Map<string, DisplayState>();    // Fichiers écran, par nom de fichier et par nom de format, en majuscules
  fileFields = new Map<string, { type: DataTypeNode; file: string }>(); // Zones des fichiers, en minuscules
  lastIndicators = { eof: false, found: false, equal: false }; // %EOF, %FOUND, %EQUAL sans argument
  lastError = false;
  initialValues = new Map<string, Map<string, any>>(); // Valeurs de RESET : '' globales, sinon par procédure (reset.ts)
  initializing = false; // *INZSR en cours : RESET d'une globale interdit (00109) // %ERROR : dernière opération avec extenseur (E), indicateur global au programme

  constructor(context?: ExecutionContext, options: InterpreterOptions = {}) {
    this.context = context ?? emptyContext();
    this.options = options;
    this.runtime = new Runtime(this.context, options.clock);
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
  }
}
