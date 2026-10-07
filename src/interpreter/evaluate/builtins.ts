// Fonctions intégrées qui acceptent une date, une heure ou un timestamp
export const DURATION_BUILTINS = new Set(['%years', '%months', '%days', '%hours', '%minutes', '%seconds', '%mseconds']);

export const WHOLE_NUMBER_BUILTINS = new Set(['%int', '%diff', '%subdt', '%len', '%scan', '%check', '%rem', '%div']);

export const DATE_AWARE_BUILTINS = new Set(['%date', '%time', '%timestamp', '%len', '%diff', '%subdt']);

// Acceptées sur IBM i (ou doute) mais pas encore implémentées pour les dates
export const NOT_YET_DATE_BUILTINS = new Set(['%dec', '%int', '%max', '%min']);

export const NUMERIC_TYPES = new Set(['int', 'uns', 'packed', 'zoned']);
