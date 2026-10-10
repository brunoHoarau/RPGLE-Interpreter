# Fichiers écran (WORKSTN) — conception

## Objectif

Exécuter dans VS Code un programme RPGLE qui utilise un fichier écran, comme sur un terminal 5250 :
le programme tourne jusqu'à une opération écran, l'écran s'affiche dans un panneau, l'exécution
attend la saisie de l'utilisateur, puis le programme reprend avec les zones saisies et les
indicateurs de réponse, et suit sa propre logique (boucles, F3 pour sortir…).

Le mode interactif est le mode normal. Un fournisseur de saisie scripté existe pour les tests
automatiques uniquement.

## Découpage

- **5a — cœur** : interface `ScreenIO`, `displays.json`, `DCL-F … WORKSTN`, `EXFMT` / `WRITE` / `READ`,
  touches CA/CF/PAGEUP/PAGEDOWN, `INDARA` + `INDDS`, conditionnement `"if"`. Entièrement testé en mode scripté.
- **5b — interactif** : exécution dans un worker thread, panneau webview 5250, sortie DSPLY au fil de l'eau.

## 1. Architecture

```
extension.ts ──lance──▶ worker thread : lexer → parser → Interpreter (synchrone, inchangé)
     ▲                         │ EXFMT/READ : screenIO.read(...)
     │ réponse (zones, touche) │ → postMessage(écran) puis Atomics.wait
     └──── panneau webview 5250 ◀┘
```

`InterpreterOptions` reçoit un `screenIO?: ScreenIO` :

```ts
interface ScreenIO {
  show(screen: Screen): void;              // WRITE, et première moitié d'EXFMT
  read(request: ReadRequest): ScreenInput; // READ, et seconde moitié d'EXFMT ; synchrone
}
interface Screen {           // ce qui est affiché
  file: string; format: string;
  fields: { name: string; row: number; col: number; length: number;
            usage: 'I' | 'O' | 'B'; numeric: boolean; value: string }[]; // H non transmises
  constants: { row: number; col: number; text: string }[];             // seulement celles dont le "if" est vrai
  message?: string;          // erreur de saisie à afficher en ligne 24 (voir 3.4)
}
interface ReadRequest { file: string; format: string; screen: Screen; }
interface ScreenInput { key: string; fields: { [name: string]: string }; } // key : ENTER, F1…F24, PAGEUP, PAGEDOWN
```

- **Interactif (5b)** : le worker poste `Screen`, puis bloque sur un `SharedArrayBuffer` (`Atomics.wait`)
  jusqu'à ce que l'extension y dépose la réponse du panneau.
- **Scripté (tests)** : liste ordonnée de `{ format, file?, key?, fields? }` ; `format` est vérifié
  (erreur si le programme lit un autre format) ; liste épuisée → erreur
  « aucune saisie prévue pour le format FMT01 (lecture n° 4) ». Chaque `Screen` affiché est enregistré
  pour que les tests vérifient ce qui a été montré.
- Sans `screenIO`, un `DCL-F … WORKSTN` est refusé : « fichier écran : exécution interactive requise ».

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
- `type` : même syntaxe que les zones de fichiers base (`char(n)`, `zoned(p:d)`, `packed(p:d)`, forme SQL).
  Types autorisés pour une zone écran : char, zoned, packed (affichée comme zoned). Autres → refus.
- `usage` : `I`, `O`, `B`, `H`. `row`/`col` obligatoires sauf pour `H` ; la zone doit tenir dans 24×80.
- `if` (constantes et zones, facultatif) : liste d'indicateurs séparés par des blancs, `N` pour la négation,
  tous vrais (ET). Une zone non affichée n'est ni montrée ni lue.
- Noms en majuscules ; fichier, format ou zone invalides → erreur au chargement avec le chemin du fichier.

## 3. Exécution (5a)

### 3.1 Déclaration
`DCL-F ecran WORKSTN` : le fichier doit exister dans `displays.json`. Les zones de tous ses formats
deviennent des variables globales, comme pour un fichier base décrit en externe : une variable déjà
déclarée avec le même nom doit avoir le même type, sinon erreur. `INDDS(ds)` est accepté si `indara`
vaut `true` (et refusé sinon) : la DS représente la zone de 99 indicateurs, l'indicateur nn étant
l'octet nn (sous-zones `ind pos(nn)`). Avec `indara`, indicateurs de réponse **et** de conditionnement
(`if`) sont lus/écrits dans cette DS et non dans `*INxx`.
`USAGE` par défaut d'un WORKSTN : `*INPUT : *OUTPUT`.

### 3.2 WRITE format
Construit le `Screen` à partir des variables et des indicateurs courants (zones O et B : valeur du
programme ; zones I : à blanc / zéro) et appelle `show`. L'écran affiché est remplacé (pas d'`OVERLAY`).
Le programme continue sans attendre.

### 3.3 READ format / EXFMT format
`EXFMT` = `WRITE` puis `READ`. `READ` appelle `read` et applique la réponse :

- **ENTER** : les zones I et B affichées sont rendues au programme ; tous les indicateurs de réponse
  du format et du fichier passent à off.
- **CFxx, PAGEUP, PAGEDOWN** : zones rendues ; l'indicateur de la touche à on, les autres à off.
- **CAxx** : zones **non** rendues (les variables gardent leur valeur) ; indicateurs comme pour CF.
- Indicateurs : `*INxx`, ou la DS `INDDS` si `indara`.
- Zone B ou I non saisie : renvoie ce qui était affiché (B : valeur écrite ; I : blanc / zéro).

### 3.4 Contrôles sans rendre la main (comme le 5250)
Touche non autorisée, valeur numérique invalide ou trop grande : le programme ne reprend pas ; l'écran
est réaffiché avec un `message` et `read` est rappelé. En mode scripté, c'est une erreur du scénario.

### 3.5 Valeurs à l'écran
- char : valeur complétée à blanc.
- numérique sans édition : chiffres avec zéros de tête, sans virgule ; négatif → signe `-` à droite
  (**à vérifier sur IBM i**).
- saisie numérique : chiffres, un signe `-` (début ou fin), un séparateur `,` ou `.` ; alignée sur les
  décimales ; trop de chiffres entiers ou décimaux → message (3.4).

## 4. Panneau (5b)

Webview : grille 24×80 en chasse fixe, vert sur noir ; zones de saisie soulignées, `maxlength` = longueur,
zones numériques filtrées ; ligne 24 = message d'erreur. Clavier : `Entrée`, `F1`–`F12`, `Maj+F1`–`F12`
(F13–F24), `PgUp`/`PgDn` ; rangée de boutons de secours. Fermer le panneau pendant une attente arrête le
programme (« écran fermé par l'utilisateur »). La sortie DSPLY est envoyée au canal au fil de l'eau.

## 5. Refusé explicitement (message en français, test dans `test/unsupported.test.js`)

Sous-fichiers (SFL/SFLCTL, `READC`, `CHAIN`/`UPDATE` sur un format écran) et leur pagination
automatique ; `OVERLAY` et superposition de formats ; `INFDS` et octet AID ; `READ` sur le nom de
fichier écran (sans format) ; extenseur `(E)` et `%ERROR` sur opérations écran ; `WRITE`/`READ` d'une DS
résultat sur un écran ; source DDS ; attributs d'affichage (`DSPATR`, `COLOR`) et codes d'édition ;
`PRINTER` et `SPECIAL` restent refusés.

## 6. Tests

- `test/ecrans.test.js` (5a) : `displays.json` et la liste de saisies passées au helper ; vérification
  des `Screen` affichés (valeurs, constantes conditionnées, zones I à blanc) et des effets
  (zones rendues, CA vs CF, indicateurs, INDDS, contrôles 3.4, erreurs de scénario).
- `test/context.test.js` : validation de `displays.json`.
- 5b : worker testé par un test Node sur le protocole `SharedArrayBuffer` ; panneau testé à la main.

## Points à vérifier sur IBM i

- Représentation à l'écran d'un numérique négatif sans code d'édition.
- Valeur d'une zone I non saisie après un premier affichage (supposée blanc / zéro à chaque WRITE).
