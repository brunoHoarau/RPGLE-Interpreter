// Protocole SPECIAL entre l'interpréteur et le simulateur d'écran, et interface du terminal

export interface SpecialCall {
  option: 'O' | 'C' | 'W' | 'R';   // entrée
  status: '0' | '1' | '2';         // sortie : 0 normal, 2 erreur (1 = fin de fichier, inutilisé pour un écran)
  error: number;                   // sortie : code d'erreur si status = 2
  message?: string;                // sortie : message d'erreur lisible si status = 2
  area: string;                    // entrée/sortie : image de l'enregistrement du format
  format: string;                  // paramètre supplémentaire : nom du format (W, R)
  indicators: string;              // paramètre supplémentaire : 99 caractères '0'/'1' (indicateur nn = position nn)
}

// Synchrone ; modifie ses paramètres
export interface SpecialRoutine { call(parameters: SpecialCall): void; }

export interface Screen {
  file: string;
  format: string;
  fields: { name: string; row: number; col: number; length: number;
            usage: 'I' | 'O' | 'B'; numeric: boolean; value: string }[];   // zones affichées (ni H, ni "if" faux)
  constants: { row: number; col: number; text: string }[];             // constantes dont le "if" est vrai
  message?: string;                                                    // erreur de saisie, ligne 24
}

// key : ENTER, F1…F24, PAGEUP, PAGEDOWN
export interface ScreenInput { key: string; fields: { [name: string]: string }; }

export interface Terminal {
  show(screen: Screen): void;         // affiche (W, et réaffichage avec message)
  input(screen: Screen): ScreenInput; // attend la saisie ; synchrone
}
