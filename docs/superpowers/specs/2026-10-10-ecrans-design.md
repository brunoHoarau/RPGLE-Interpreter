# Fichiers écran (WORKSTN) — conception

## Objectif

Exécuter dans VS Code un programme RPGLE qui utilise un fichier écran, comme sur un terminal 5250 :
le programme tourne jusqu'à une opération écran, l'écran s'affiche dans un panneau, l'exécution
attend la saisie de l'utilisateur, puis le programme reprend avec les zones saisies et les
indicateurs de réponse, et suit sa propre logique (boucles, F3 pour sortir…).

Le mode interactif est le mode normal. Un terminal scripté existe pour les tests automatiques uniquement.

## Découpage

- **5a — cœur** : protocole SPECIAL entre interpréteur et simulateur d'écran, simulateur (comportement
  du poste 5250), `displays.json`, `DCL-F … WORKSTN`, `EXFMT` / `WRITE` / `READ`, touches CA/CF/PAGEUP/PAGEDOWN,
  `INDARA` + `INDDS`, conditionnement `"if"`. Entièrement testé avec le terminal scripté.
- **5b — interactif** : exécution dans un worker thread, terminal = panneau webview 5250, sortie DSPLY au fil de l'eau.
- **Plus tard** : vrai `DCL-F … SPECIAL PGMNAME(...)` avec une routine écrite en RPG et interprétée, sur le même protocole.

## 1. Architecture : le simulateur d'écran est une routine SPECIAL

Le dialogue suit le protocole des fichiers SPECIAL d'IBM i (routine utilisateur appelée avec
OPTION / STATUS / ERROR / AREA) : l'interpréteur traduit chaque verbe en un appel du simulateur, qui joue
le rôle du programme `USERIO` de la documentation IBM. Deux paramètres supplémentaires (comme un `PLIST`)
sont nécessaires à un écran : le nom du format et la zone des 99 indicateurs.

```
programme RPG ──EXFMT FMT01──▶ interpréteur ──call(W), call(R)──▶ simulateur d'écran ──▶ terminal
                                (variables ⇄ AREA,                 (poste 5250 : AREA ⇄ écran,     (scripté : tests ;
                                 indicateurs ⇄ INDICATORS)          touches, contrôles de saisie)   panneau : 5b)
```

```ts
interface SpecialCall {
  option: 'O' | 'C' | 'W' | 'R';   // entrée
  status: '0' | '1' | '2';         // sortie : 0 normal, 2 erreur (1 = fin de fichier, inutilisé pour un écran)
  error: number;                   // sortie : code d'erreur si status = 2
  area: string;                    // entrée/sortie : image de l'enregistrement du format
  format: string;                  // paramètre supplémentaire : nom du format (W, R)
  indicators: string;              // paramètre supplémentaire : 99 caractères '0'/'1' (indicateur nn = position nn)
}
interface SpecialRoutine { call(parameters: SpecialCall): void; }   // synchrone ; modifie ses paramètres
```

- **Verbes** : ouverture du fichier → `O` ; `WRITE fmt` → `W` ; `READ fmt` → `R` ; `EXFMT fmt` → `W` puis `R` ;
  `CLOSE` ou fin du programme → `C`. Statut `2` → erreur d'exécution « fichier écran ECRAN01 : <message> (erreur nnnnn) ».
- **AREA** : les zones du format, dans l'ordre de `displays.json`, H comprises, en image mémoire :
  char = valeur complétée à blanc ; zoned(p:d) = p chiffres, zéros de tête, signe négatif dans la dernière
  position (`}` pour 0, `J`…`R` pour 1…9, image EBCDIC des zones négatives).
  Le simulateur et l'interpréteur découpent AREA avec la même fonction (`src/screens/area.ts`).
- **Simulateur** (`ScreenSimulator`, fourni par l'extension) : connaît `displays.json`, garde l'écran affiché,
  construit ce qui est montré et applique les règles du poste 5250 (§3). Il parle à un **terminal** :

```ts
interface Terminal {
  show(screen: Screen): void;      // affiche (W, et réaffichage avec message)
  input(screen: Screen): ScreenInput; // attend la saisie ; synchrone
}
interface Screen {
  file: string; format: string;
  fields: { name: string; row: number; col: number; length: number;
            usage: 'I' | 'O' | 'B'; numeric: boolean; value: string }[];   // zones affichées (ni H, ni "if" faux)
  constants: { row: number; col: number; text: string }[];             // constantes dont le "if" est vrai
  message?: string;                                                    // erreur de saisie, ligne 24
}
interface ScreenInput { key: string; fields: { [name: string]: string }; } // key : ENTER, F1…F24, PAGEUP, PAGEDOWN
```

- **Terminal scripté** (tests) : liste ordonnée de `{ format, file?, key?, fields? }` ; `format` vérifié ;
  liste épuisée → erreur « aucune saisie prévue pour le format FMT01 (lecture n° 4) » ; écran avec `message`
  → erreur « saisie refusée par l'écran : <message> » ; garde la liste des écrans montrés.
- **Terminal panneau** (5b) : le worker poste l'écran, puis bloque sur un `SharedArrayBuffer` (`Atomics.wait`)
  jusqu'à la réponse du panneau.
- `InterpreterOptions.screens?: SpecialRoutine`. Sans lui, un `DCL-F … WORKSTN` est refusé :
  « fichier écran : exécution interactive requise ».

## 2. `displays.json` (dossier de contexte)

```json
{
  "ECRAN01": {
    "indara": false,
    "keys": { "CA03": "03", "CA12": "12" },
    "formats": {
      "FMT01": {
        "keys": { "CF05": "05", "PAGEDOWN": "25" },
        "constants": [
          { "row": 1,  "col": 30, "text": "Saisie commande" },
          { "row": 22, "col": 2,  "text": "Code article inconnu", "if": "31" },
          { "row": 23, "col": 2,  "text": "F3=Sortie  F5=Réafficher" }
        ],
        "fields": [
          { "name": "CODE",    "type": "char(6)",    "usage": "B", "row": 4, "col": 20 },
          { "name": "LIBELLE", "type": "char(30)",   "usage": "O", "row": 5, "col": 20 },
          { "name": "QTE",     "type": "zoned(5:0)", "usage": "I", "row": 6, "col": 20 },
          { "name": "CLE",     "type": "char(10)",   "usage": "H" }
        ]
      }
    }
  }
}
```

- `keys` : touche → indicateur de réponse (`"01"`…`"99"`) ou `null` (touche autorisée sans indicateur).
  Au niveau fichier (tous les formats) et au niveau format ; une même touche aux deux niveaux est une erreur.
  Touches : `CA01`…`CA24`, `CF01`…`CF24`, `PAGEUP`/`ROLLDOWN`, `PAGEDOWN`/`ROLLUP` (synonymes).
- `type` : `char(n)` ou `zoned(p:d)` (forme SQL `NUMERIC(p,d)` acceptée) — les seuls types d'une zone d'écran ;
  tout autre type → erreur.
- `usage` : `I`, `O`, `B`, `H`. `row`/`col` obligatoires sauf pour `H` ; la zone doit tenir dans 24×80.
- `lc` (zone char, facultatif, faux par défaut) : `true` conserve la saisie en minuscules (équivalent DDS `CHECK(LC)`) ; refusé sur un `zoned`.
- `if` (constantes et zones, facultatif) : indicateurs séparés par des blancs, `N` pour la négation, tous vrais (ET).
- Noms en majuscules ; fichier, format ou zone invalides → erreur au chargement avec le chemin du fichier.

## 3. Comportement (5a)

### 3.1 Déclaration (interpréteur)
`DCL-F ecran WORKSTN` : le fichier doit exister dans `displays.json`. Les zones de tous ses formats
deviennent des variables globales, comme pour un fichier base décrit en externe : une variable déjà
déclarée avec le même nom doit avoir le même type, sinon erreur. `INDDS(ds)` est accepté si `indara`
vaut `true` (et refusé sinon) : la DS représente la zone de 99 indicateurs, l'indicateur nn étant
l'octet nn (sous-zones `ind pos(nn)`). Les indicateurs passés au simulateur viennent de `*IN01`…`*IN99`,
ou de cette DS avec `indara`, et y sont recopiés au retour d'un `R`.
`USAGE` par défaut d'un WORKSTN : `*INPUT : *OUTPUT`.

### 3.2 W — affichage (simulateur)
Découpe AREA ; zones O et B : valeur reçue ; zones I : à blanc / zéro ; zones et constantes dont le `if`
est faux : absentes ; H : non montrées. L'écran affiché est remplacé (pas d'`OVERLAY`). Retour immédiat.

### 3.3 R — saisie (simulateur)
Le format demandé doit être celui affiché, sinon statut 2 (« READ FMT02 : le format affiché est FMT01 »).
Demande la saisie au terminal, puis :

- **ENTER** : AREA rendue avec les zones I et B saisies (non saisie : valeur affichée) ; tous les indicateurs
  de réponse du format et du fichier à `0`.
- **CFxx, PAGEUP, PAGEDOWN** : idem, et l'indicateur de la touche à `1`.
- **CAxx** : AREA rendue **inchangée** (saisies non transmises) ; indicateurs comme pour CF.

L'interpréteur recopie toute l'AREA dans les variables et les indicateurs dans `*INxx` / INDDS.

### 3.4 Contrôles sans rendre la main (comme le 5250)
Touche non autorisée, zone inconnue ou non saisissable, valeur trop longue, numérique invalide ou trop grande :
l'écran est réaffiché avec un `message` et la saisie redemandée ; le programme ne reprend pas.
Avec le terminal scripté, c'est une erreur du scénario.

### 3.5 Valeurs à l'écran
- char : valeur complétée à blanc ; la saisie est convertie en majuscules, sauf zone avec `"lc": true`
  (DDS sans `CHECK(LC)` : **à vérifier sur IBM i**).
- numérique sans édition : chiffres avec zéros de tête, sans virgule ; négatif → signe `-` à droite
  (**à vérifier sur IBM i**).
- saisie numérique : chiffres, un signe `-` (début ou fin), un séparateur `,` ou `.` ; alignée sur les
  décimales ; vide → zéro.

## 4. Panneau (5b)

Webview : grille 24×80 en chasse fixe, vert sur noir ; zones de saisie soulignées, `maxlength` = longueur,
zones numériques filtrées ; ligne 24 = message d'erreur. Clavier : `Entrée`, `F1`–`F12`, `Maj+F1`–`F12`
(F13–F24), `PgUp`/`PgDn` ; rangée de boutons de secours. Fermer le panneau pendant une attente arrête le
programme (« écran fermé par l'utilisateur »). La sortie DSPLY est envoyée au canal au fil de l'eau.

## 5. Refusé explicitement (message en français, test dans `test/unsupported.test.js`)

Sous-fichiers de messages (`SFLMSGRCD`…) et mots-clés de sous-fichier hors spec « sous-fichiers »
(`SFLLIN`, `SFLRNA`, `SFLCSRRRN`…) ; `CHAIN`/`UPDATE`/`READC` sur un format qui n'est pas un sous-fichier
(les sous-fichiers « tels qu'écrits sur IBM i » sont faits : `2026-11-28-sous-fichiers-design.md`, avec `OVERLAY`) ;
`INFDS` et octet AID ; `READ` sur le nom de
fichier écran (sans format) ; extenseur `(E)` et `%ERROR` sur opérations écran ; `WRITE`/`READ` d'une DS
résultat sur un écran ; source DDS ; attributs d'affichage (`DSPATR`, `COLOR`) et codes d'édition ;
`PRINTER` et `SPECIAL` restent refusés.

## 6. Tests

- `test/ecrans.test.js` (5a) : `displays.json` et la liste de saisies passées au helper ; vérification
  des écrans montrés (valeurs, constantes conditionnées, zones I à blanc) et des effets
  (zones rendues, CA vs CF, indicateurs, INDDS, contrôles 3.4, erreurs de scénario) ; image AREA (signe zoned).
- `test/context.test.js` : validation de `displays.json`.
- 5b : worker testé par un test Node sur le protocole `SharedArrayBuffer` ; page HTML du panneau testée avec Playwright
  (Chromium headless, dépendance de développement uniquement) : positions, constantes conditionnées, touches, message ligne 24.

## Points à vérifier sur IBM i

- Représentation à l'écran d'un numérique négatif sans code d'édition.
- Conversion en majuscules sans CHECK(LC).
- Valeur d'une zone I non saisie après un premier affichage (supposée blanc / zéro à chaque WRITE).
