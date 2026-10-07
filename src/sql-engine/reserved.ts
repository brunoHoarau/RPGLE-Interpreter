// Mots réservés SQL qui ouvrent une construction hors périmètre.

// Mots qui ouvrent une construction SQL hors périmètre (jamais pris pour une colonne inconnue)
export const RESERVED_SQL_WORDS = new Set(['CURRENT', 'CASE', 'CAST', 'SELECT', 'DEFAULT', 'DATE', 'TIME', 'TIMESTAMP', 'USER', 'SESSION_USER', 'SYSTEM_USER']);

// CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_USER, CURRENT DATE... : jamais pris pour une colonne
// Mots toujours réservés : même une colonne de ce nom ne pourrait pas être écrite sans guillemets
export const ALWAYS_RESERVED_SQL_WORDS = new Set(['CURRENT', 'CASE', 'CAST', 'SELECT', 'DEFAULT']);

// Une colonne réelle de la table nommée DATE, USER, CURRENT_BALANCE... reste une colonne
export const isReservedSqlWord = (upper: string, columns?: Set<string> | null) =>
  (RESERVED_SQL_WORDS.has(upper) || upper.startsWith('CURRENT_'))
  && (ALWAYS_RESERVED_SQL_WORDS.has(upper) || !columns?.has(upper));
