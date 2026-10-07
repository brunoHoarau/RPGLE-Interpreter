// Fichiers natifs (DCL-F) : mêmes exports publics que l'ancien module unique src/files.ts.
export type { FieldDefinition, FileResult, FileSpecial, ReadOptions } from './types';
export { parseFieldType, fitsField } from './field-types';
export { ebcdicKey } from './ebcdic';
export { NativeFile } from './native-file';
