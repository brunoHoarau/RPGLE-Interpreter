// Recherche du source d'un programme appelé (EXTPGM) pour l'exécuter en local
import * as fs from 'fs';
import * as path from 'path';

export interface ProgramSource {
  source: string;
  path?: string;
}

// Nom de programme (majuscules ou non) -> source, ou undefined s'il est introuvable
export type ProgramResolver = (name: string) => ProgramSource | undefined;

const SOURCE_EXTENSIONS = ['.rpgle', '.sqlrpgle'];

// Cherche NOM.rpgle ou NOM.sqlrpgle dans un dossier, sans tenir compte de la casse
export function folderProgramResolver(folder: string): ProgramResolver {
  return name => {
    let entries: string[];
    try {
      entries = fs.readdirSync(folder);
    } catch {
      return undefined;
    }
    const file = entries.find(entry => {
      const extension = path.extname(entry);
      return SOURCE_EXTENSIONS.includes(extension.toLowerCase()) &&
        path.basename(entry, extension).toUpperCase() === name.toUpperCase();
    });
    if (!file) return undefined;
    const filePath = path.join(folder, file);
    return { source: fs.readFileSync(filePath, 'utf8'), path: filePath };
  };
}
