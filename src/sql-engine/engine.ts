// Moteur SQL embarqué : simule les instructions SQL du programme sur les tables de context/tables.json.
// L'analyse et l'exécution des instructions sont dans les fichiers voisins.
import { ExecutionContext, TableDefinition } from '../context';
import { NotSupportedError } from '../errors';
import { HostVariables, SQLResult, SqlError } from './types';
import { normalizeWhitespace } from './text';
import { executeSelect } from './select';
import { executeInsert, executeUpdate, executeDelete } from './modify';

export class SQLEngine {
  private tables: { [name: string]: TableDefinition };

  constructor(context: ExecutionContext) {
    this.tables = context.tables;
  }

  // Point d'entrée principal
  execute(sql: string, hostVariables: HostVariables): SQLResult {
    // Un commentaire SQL ne serait pas interprété : refusé plutôt que mal compris
    if (sql.split(/('(?:[^']|'')*')/).some((part, i) => i % 2 === 0 && /--|\/\*/.test(part))) {
      throw new NotSupportedError('Commentaire dans une instruction SQL');
    }
    const normalized = normalizeWhitespace(sql);
    const verb = (normalized.match(/^\w+/)?.[0] ?? '').toUpperCase();

    try {
      switch (verb) {
        case 'SELECT': return executeSelect(this.tables, normalized, hostVariables);
        case 'INSERT': return executeInsert(this.tables, normalized, hostVariables);
        case 'UPDATE': return executeUpdate(this.tables, normalized, hostVariables);
        case 'DELETE': return executeDelete(this.tables, normalized, hostVariables);
      }
      // DECLARE CURSOR, OPEN, FETCH, CLOSE, SET, VALUES, COMMIT, CALL, WITH... : le programme s'arrête
      throw new NotSupportedError(`Instruction SQL ${verb || normalized}`);
    } catch (error: any) {
      // Un refus « pas encore supporté » arrête le programme, il n'est pas une erreur SQL
      if (error instanceof NotSupportedError) throw error;
      return {
        rows: [],
        rowCount: 0,
        sqlCode: error instanceof SqlError ? error.sqlCode : -1,
        sqlState: error instanceof SqlError ? error.sqlState : 'HY000',
        message: error.message,
      };
    }
  }
}
