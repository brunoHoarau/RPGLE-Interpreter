# Sous-fichiers 5250 — conception

Prolonge `2026-10-10-ecrans-design.md` (5a). Seules les différences avec 5a sont décrites ici.

## Intention

Faire tourner, avec le terminal scripté, un programme RPGLE à sous-fichier tel qu'il est écrit
sur IBM i (chargement, affichage, options saisies sur les lignes, `READC`/`UPDATE`, pagination),
pour que des scénarios de test d'écran deviennent possibles. C'est la base de la partie E2E de la
bibliothèque de tests destinée à être commercialisée : les scénarios doivent être **lisibles et
robustes** (ne pas casser quand les données de test changent d'ordre).

La navigation à la main (panneau 5250) reste l'incrément 5b ; rien ici ne doit la gêner.

## Objectifs

- Les trois façons de gérer un sous-fichier : tout chargé (`SFLSIZ` > `SFLPAG`), extensible, page à page
  (`SFLSIZ` = `SFLPAG`, pagination par le programme). Un seul mécanisme, celui du poste 5250.
- Côté programme : `SFILE(format:rang)` sur `DCL-F`, `WRITE`, `CHAIN`, `UPDATE`, `READC` sur un format
  sous-fichier, `%FOUND`, `%EOF`.
- Côté écran : `SFL`, `SFLCTL`, `SFLSIZ`, `SFLPAG`, `SFLDSP`, `SFLDSPCTL`, `SFLCLR`, `SFLDLT`, `SFLINZ`,
  `SFLEND`, `SFLNXTCHG`, `SFLRCDNBR`, `SFLDROP`/`SFLFOLD`, enregistrement sur plusieurs lignes,
  et `OVERLAY` (indispensable : le motif courant est `WRITE BAS1; EXFMT CTL1;`).
- Scénario : désigner une ligne **par contenu** (`where`). La désignation par position est prévue
  (format réservé ci-dessous) mais faite plus tard.

## Non-objectifs

- Panneau interactif (5b), import DDS → `displays.json` (incrément séparé, important pour la vente).
- Sous-fichiers de messages (`SFLMSGRCD`, `SFLPGMQ`, `SFLMSG`, `SFLMSGID`) : exigent une file de messages
  programme et `SND-MSG`/`QMHSNDPM` ; incrément à part.

## Anti-objectifs

- Un comportement approximé qui fait passer un test qui échouerait sur IBM i. Tout ce qui n'est pas
  supporté est **refusé** : clé inconnue dans `displays.json` → erreur au chargement ; opération ou
  extenseur non supporté → `NotSupportedError` en français.
- Un scénario qui dépend de l'ordre des lignes quand le testeur ne l'a pas demandé.

## Approches

1. **Le simulateur garde le sous-fichier** — retenue. Comme sur IBM i (le sous-fichier appartient au
   fichier écran). Le protocole gagne un rang et quatre verbes ; stockage, drapeaux « modifié »,
   pagination et recherche `where` sont dans le simulateur ; le panneau 5b n'affichera que la page reçue.
   Contrepartie : le simulateur grossit, il faut le découper.
2. L'interpréteur garde le sous-fichier et l'envoie entier à l'affichage. Protocole presque inchangé,
   mais la logique 5250 est coupée en deux (saisies côté simulateur, drapeaux « modifié » côté
   interpréteur) ; écartée.

## 1. Protocole

`SpecialCall` gagne `rrn?: number` (entrée/sortie) et quatre options :

| Option | Opération RPG | Entrée | Sortie |
|---|---|---|---|
| `SW` | `WRITE sfl` | area, rrn, indicateurs | — |
| `SC` | `CHAIN rang sfl` | rrn | area ; statut `1` si le rang n'existe pas |
| `SU` | `UPDATE sfl` | area, rrn, indicateurs | — |
| `SR` | `READC sfl` | — | area, rrn ; statut `1` s'il n'y a plus de ligne modifiée |

- Le statut `1` (fin de fichier du protocole SPECIAL) sert à `%EOF` après `READC` et à `%FOUND` = faux
  après `CHAIN`. Ni l'un ni l'autre n'est une erreur.
- `W`/`R` d'un format de contrôle (`SFLCTL`) gardent leur sens ; `R` du contrôle rend aussi la saisie
  faite sur les lignes du sous-fichier (stockée dans le simulateur, lue ensuite par `READC`).
- `W`/`R`/`EXFMT` sur un format sous-fichier, et `SW`/`SC`/`SU`/`SR` sur un format qui n'en est pas un →
  erreur.

## 2. `displays.json`

```json
"formats": {
  "SFL1": {
    "subfile": { "nextChanged": "67" },
    "fields": [
      { "name": "OPT",  "type": "char(1)",    "usage": "B", "row": 6, "col": 3 },
      { "name": "CODE", "type": "char(6)",    "usage": "O", "row": 6, "col": 7 },
      { "name": "DESC", "type": "char(40)",   "usage": "O", "row": 7, "col": 7, "fold": true }
    ]
  },
  "CTL1": {
    "control": {
      "subfile": "SFL1", "size": 9999, "page": 7,
      "display": "32", "displayControl": "N31", "clear": "31", "delete": null, "initialize": null,
      "end": { "if": "90", "text": "*MORE" },
      "recordNumber": "RRNTOP",
      "drop": "CF11"
    },
    "overlay": true,
    "keys": { "PAGEDOWN": "25" },
    "constants": [ { "row": 4, "col": 2, "text": "Opt  Code" } ],
    "fields": [ { "name": "RRNTOP", "type": "zoned(4:0)", "usage": "H" } ]
  },
  "BAS1": { "overlay": true, "constants": [ { "row": 23, "col": 2, "text": "F3=Sortie" } ], "fields": [] }
}
```

- `subfile` (format sous-fichier, équivalent DDS `SFL`) ; `nextChanged` = indicateur(s) de `SFLNXTCHG`
  (syntaxe `if` de 5a), facultatif.
- `control` (équivalent `SFLCTL`) : `subfile` (format lié, obligatoire, un seul contrôle par sous-fichier),
  `size` 1–9999 et `page` ≥ 1 avec `page` ≤ `size` (obligatoires) ; `display`, `displayControl`, `clear`,
  `delete`, `initialize` : condition `if` (chaîne) ou `null` = toujours actif, absent = mot-clé absent ;
  `end` : `{ if, text }` avec `text` `*MORE` (défaut) ou `*PLUS` ; `recordNumber` : nom d'une zone
  numérique du contrôle (`SFLRCDNBR`) ; `drop` : touche CA/CF qui bascule `SFLDROP` (repli/dépli).
- Les lignes du sous-fichier : les zones de `SFL1` donnent la première page ; un enregistrement occupe
  les lignes de `min(row)` à `max(row)` de ses zones (multiligne) ; la page occupe `page` × hauteur lignes
  et doit tenir dans 24 lignes. `fold: true` sur une zone = masquée en forme tronquée (`SFLDROP`).
- `overlay` (tout format) : voir §3.5.
- Toute autre clé dans `control`/`subfile` (`SFLLIN`, `SFLRNA`, `SFLCSRRRN`, `SFLMODE`, `SFLSCROLL`,
  `SFLENTER`, `SFLROLVAL`, `SFLSNGCHC`, `SFLMLTCHC`, messages…) → erreur au chargement.

## 3. Comportement

### 3.1 Déclaration
`DCL-F ecran WORKSTN SFILE(SFL1:rrn1)` : un `SFILE` par format sous-fichier, obligatoire pour chacun ;
`rrn1` = variable numérique sans décimales (déclarée implicitement en `packed(4:0)` si elle n'existe pas,
comme le compilateur ; **à vérifier sur IBM i**). `SFILE` sur un format qui n'est pas sous-fichier → erreur.

### 3.2 Opérations sur le format sous-fichier
- `WRITE SFL1` : rang = valeur de `rrn1`. Rang < 1 ou > 9999 → erreur. Rang déjà présent → erreur
  (statut 01021, **à vérifier**). Rang > `size` : refusé si `size` = `page` (sous-fichier non extensible,
  **statut à vérifier**), sinon le sous-fichier s'étend. Enregistre les valeurs des zones **et les
  indicateurs** du moment (conditions `if` des zones et `SFLNXTCHG` évaluées par ligne) ;
  `SFLNXTCHG` vrai → ligne marquée modifiée.
- `CHAIN rang SFL1` : `%FOUND` ; trouvé → variables des zones et `rrn1` = rang.
- Zones H d'un format sous-fichier : stockées avec la ligne, rendues par `CHAIN`/`READC`, jamais montrées.
- Rangs : la page k contient les rangs (k−1)×`page`+1 à k×`page`. Un `WRITE` qui laisserait un trou
  (rang > plus grand rang présent + 1) est **refusé** (comportement IBM non vérifié).
- `READC SFL1` : prochaine ligne modifiée en ordre de rang croissant **après la position courante** ;
  la position revient avant le rang 1 à chaque `R` du contrôle ; met `rrn1` ; la ligne n'est plus
  modifiée ; aucune → `%EOF`. Une ligne remarquée par `UPDATE` avec `SFLNXTCHG` derrière la position
  n'est pas relue avant le prochain `R` du contrôle (c'est l'usage IBM : elle sera relue au tour suivant).
- `UPDATE SFL1` : réécrit la ligne du dernier `CHAIN`/`READC` réussi sur ce format (sinon erreur,
  statut 01211 **à vérifier**) ; indicateurs du moment ; `SFLNXTCHG` vrai → de nouveau modifiée.
- Extenseurs (`(E)`, `(N)`), DS résultat : refusés comme en 5a.

### 3.3 `WRITE` du contrôle (indicateurs évalués à ce moment, dans cet ordre)
`SFLDLT` (supprime le sous-fichier) → `SFLCLR` (vide les lignes) → `SFLINZ` (crée `size` lignes à blanc/zéro,
non modifiées) → affichage : `SFLDSPCTL` montre le contrôle, `SFLDSP` montre la page du sous-fichier.
`SFLDSP` vrai sur un sous-fichier vide → erreur (**à vérifier**). Ni l'un ni l'autre → rien n'est affiché.
Page montrée : celle qui contient le rang `SFLRCDNBR` s'il est valide, sinon la première.
Indicateur de fin (`SFLEND`) : `*MORE` → « A suivre... » / « Fin » sous la dernière ligne, cadré à droite
(textes français **à vérifier**) ; `*PLUS` → `+` tant qu'il reste des lignes.

### 3.4 `READ` du contrôle (saisie)
- Saisie sur les lignes : zones B/I de la page ; toute ligne saisie est marquée modifiée (comme le MDT 5250,
  même valeur ressaisie).
- `PAGEDOWN`/`PAGEUP` dans les lignes chargées : le simulateur change de page et redemande la saisie
  **sans rendre la main** (les saisies déjà faites sont conservées). Au-delà de la dernière ligne :
  `SFLEND` actif → message « fin du sous-fichier » (réaffichage, pas de retour) ; sinon, si la touche est
  déclarée, retour au programme avec son indicateur ; sinon touche refusée. Avant la première ligne : même
  règle avec `PAGEUP`.
- Touche `drop` : bascule repli/dépli, réaffiche, ne rend pas la main. Forme dépliée : `page` lignes
  par page ; forme tronquée (zones `fold` masquées, une ligne d'écran par enregistrement) : la même zone
  d'écran (`page` × hauteur lignes) est remplie d'enregistrements (**à vérifier**). Forme initiale : tronquée.
- Touche refusée et message « fin du sous-fichier » : réaffichage avec message, comme en 5a §3.4 ;
  avec le terminal scripté, c'est une erreur du scénario.
- Contrôle affiché sans `SFLDSP` : `READ` possible, aucune saisie de ligne (un `lines` → erreur du scénario).
- `CA` : saisies du contrôle **et** des lignes non transmises (rien marqué modifié).

### 3.5 `OVERLAY`
Un format occupe les lignes de ses zones et constantes (et, pour un contrôle, celles de la page du
sous-fichier). `WRITE` d'un format avec `overlay` retire de l'écran les formats affichés qui partagent
une ligne avec lui et garde les autres ; sans `overlay`, l'écran est vidé. `READ` d'un format exige qu'il
soit affiché ; seules ses zones (et ses lignes de sous-fichier) sont rendues.

### 3.6 Écran montré au terminal
`Screen` devient la composition des formats affichés (`formats: string[]` en plus de `format` = dernier
écrit) et gagne `subfile?: { format; rows: { rrn; fields[] }[]; end?: string; folded: boolean }`
pour la page affichée. Ajouts uniquement : les tests 5a et l'historique `shown` restent valides.

## 4. Scénario scripté

```js
{ format: 'CTL1', key: 'ENTER', fields: { POSIT: 'A' },
  lines: [ { where: { CODE: 'A001' }, fields: { OPT: '2' } } ] }
```

- `lines` s'applique à la saisie en cours, entrées dans l'ordre, sur plusieurs pages si besoin ; deux
  entrées visant la même ligne → erreur du scénario.
- `where` : égalité sur des zones du format sous-fichier, zones H comprises (valeur affichée, blancs de fin ignorés),
  cherchée dans **toutes les lignes chargées** ; le simulateur affiche la page qui la contient avant de
  saisir, comme un opérateur qui pagine (montré au terminal, sans consommer d'entrée du scénario). Aucune ligne → erreur du scénario
  « aucune ligne où CODE = 'A001' dans le sous-fichier SFL1 (12 lignes chargées) » ; plusieurs → erreur
  « plusieurs lignes où … (rangs 3, 8) ».
- Réservé, fait plus tard : `{ line: 3, fields }` = 3e ligne de la page affichée.
- `key: 'PAGEDOWN'` dans les lignes chargées consomme une entrée du scénario (comme l'opérateur).
- Les écrans montrés (`shown`) contiennent les pages : le test peut vérifier le contenu affiché.

## 5. Découpage du code (décision du constructeur, contraintes)
- Fichiers ≤ 400 lignes : sortir de `simulator.ts` au moins le stockage du sous-fichier
  (`src/screens/subfile.ts`) et la composition d'écran/overlay.
- Opérations côté interpréteur dans `src/interpreter/screens/` (nouveau fichier pour `SW/SC/SU/SR`).
- Tests : `test/ecrans-sous-fichiers*.test.js` (déclaration, opérations, scénario, refus) ;
  refus dans `test/unsupported-*.test.js` ; retirer `readc` de `UNSUPPORTED_OPCODES`.
- Mettre à jour §5 « Refusé » de la spec 5a.

## Laissé au constructeur
Nommage interne, ordre des tâches, textes exacts des erreurs (en français, avec le nom du fichier et
du format), forme de `Screen.subfile` tant que le terminal scripté et le futur panneau peuvent l'afficher.

## À vérifier sur IBM i
Statuts de `WRITE` rang en double / hors taille, d'`UPDATE` sans lecture, de `SFLDSP` sur sous-fichier
vide ; déclaration implicite de la variable de `SFILE` ; textes « A suivre... »/« Fin » ; nombre de lignes
par page en forme tronquée (`SFLDROP`) ; remise à zéro du curseur de `READC` à chaque `R` du contrôle.
