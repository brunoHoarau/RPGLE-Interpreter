import { ProcedureNode, PrototypeNode, DataTypeNode, FileDeclarationNode } from '../types';
import { NativeFile } from '../files';
import { Runtime } from '../runtime';
import { ExecutionContext, TableDefinition, emptyContext } from '../context';
import { ProgramResolver } from '../sources';

export interface InterpreterOptions {
  // Nombre total d'itérations de boucle autorisées avant d'arrêter l'exécution
  maxIterations?: number;
  // Nombre maximal d'appels de procédure imbriqués (protège des récursions infinies)
  maxCallDepth?: number;
  // Source des programmes appelés par EXTPGM sans bouchon
  resolveProgram?: ProgramResolver;
  // Horloge de *SYS, *JOB, %DATE()... ; les tests la figent
  clock?: () => Date;
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
  context: ExecutionContext;
  options: InterpreterOptions;
  programDepth = 0; // Niveau d'imbrication des appels de programmes source
  files = new Map<string, FileState>();          // Par nom de fichier et par nom de format, en majuscules
  fileFields = new Map<string, { type: DataTypeNode; file: string }>(); // Zones des fichiers, en minuscules
  lastIndicators = { eof: false, found: false, equal: false }; // %EOF, %FOUND, %EQUAL sans argument
  lastError = false; // %ERROR : dernière opération avec extenseur (E), indicateur global au programme

  constructor(context?: ExecutionContext, options: InterpreterOptions = {}) {
    this.context = context ?? emptyContext();
    this.options = options;
    this.runtime = new Runtime(this.context, options.clock);
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
  }
}
