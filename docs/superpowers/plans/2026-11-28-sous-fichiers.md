# Sous-fichiers 5250 — plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (ou executing-plans). Cases `- [ ]`.

**But :** faire tourner un programme RPGLE à sous-fichier (SFL/SFLCTL, WRITE/CHAIN/UPDATE/READC, OVERLAY, SFLDROP) avec le terminal scripté.
**Architecture :** le simulateur garde le sous-fichier (`src/screens/subfile.ts`) ; le protocole SPECIAL gagne `rrn` et les options `SW/SC/SU/SR` ; l'interpréteur traduit les opcodes en appels.
**Spec :** `docs/superpowers/specs/2026-11-28-sous-fichiers-design.md` (lire en entier avant toute tâche) ; spec 5a : `docs/superpowers/specs/2026-10-10-ecrans-design.md`.

## Contraintes globales
- CLAUDE.md s'applique : TDD (test rouge d'abord), fichiers `src/` et `test/*.test.js` ≤ 400 lignes, messages d'erreur en français, commits en français.
- Pendant une tâche : `node scripts/check.js test/ecrans*.test.js` ; avant commit : `npm run --silent check` (1 ligne si vert).
- Tests écran : `const { runScreens, displaysFrom } = require('./helpers')` ; modèle : `test/ecrans-operations.test.js` (test « EXFMT : ENTER affecte les zones saisies »). Ne pas lire les fichiers de test en entier.
- Tout ce qui n'est pas dans la spec est refusé (clé JSON inconnue → erreur au chargement ; opération → `NotSupportedError`).
- `Screen` et `SpecialCall` : ajouts uniquement, les tests 5a restent verts sans modification.

## Points d'attention (non couverts par un test de tâche, à tester dans la tâche indiquée)
1. Programme page à page qui fait `SFLCLR` puis recharge les rangs 1..n : les drapeaux « modifié » et la position de `READC` repartent de zéro (tâche 3).
2. `EXFMT CTL1` alors que `BAS1` (overlay, ligne 23) est affiché : `BAS1` reste dans `shown[i]` (tâche 4).
3. Saisie `lines` sur une ligne d'une autre page puis ENTER : la page affichée au retour est celle de la dernière ligne saisie, et `READC` rend bien les deux lignes (tâche 5).
4. `CHAIN` sur un rang absent ne lève pas d'erreur et laisse les variables inchangées (tâche 6).
5. Variable de `SFILE` déjà déclarée en `int(10)` : acceptée (numérique sans décimales) ; en `packed(5:2)` : refusée (tâche 2).

---

### Tâche 1 : `displays.json` — sous-fichier, contrôle, overlay, fold
**Fichiers :** modifier `src/screens/definition.ts` (sortir la validation sous-fichier dans `src/screens/definition-subfile.ts` si > 400 lignes) ; test `test/ecrans-sous-fichiers-declaration.test.js`.
**Produit :**
```ts
interface SubfileSpec { nextChanged?: Condition }
interface ControlSpec { subfile: string; size: number; page: number;
  display?: Condition | null; displayControl?: Condition | null; clear?: Condition | null;
  delete?: Condition | null; initialize?: Condition | null;   // absent = mot-clé absent, null = toujours
  end?: { condition: Condition | null; text: '*MORE' | '*PLUS' }; recordNumber?: string; drop?: string }
// DisplayFormat gagne : subfile?: SubfileSpec; control?: ControlSpec; overlay: boolean
// DisplayField gagne : fold: boolean
```
- [ ] Tests rouges : JSON de la spec §2 accepté ; erreurs avec chemin pour : `subfile` du contrôle inconnu ou non sous-fichier, deux contrôles pour un sous-fichier, `size` hors 1–9999, `page` > `size`, page × hauteur > 24 lignes, `recordNumber` non numérique ou absent du contrôle, `drop` non CA/CF, `fold` hors format sous-fichier, clé inconnue (`SFLLIN`, `messages`…).
- [ ] Implémenter, vert, `npm run --silent check`, commit « displays.json : sous-fichiers, contrôle, overlay, fold ».

### Tâche 2 : `SFILE` et `READC` côté parser et déclaration
**Fichiers :** `src/parser/files.ts` (mot-clé `SFILE(fmt:var)`, plusieurs fois ; `READC fmt` ; `CHAIN rang fmt` déjà analysé), `src/parser/constants.ts` (retirer `'readc'`), `src/types.ts` (`FileDeclarationNode.sfile?: { format: string; rrn: string }[]`, opération `'readc'`), `src/interpreter/screens/declare.ts` ; tests `test/ecrans-sous-fichiers-declaration.test.js`, `test/unsupported-*.test.js` (retirer le test de refus de READC s'il existe).
**Produit :** `DisplayState.sfile: Map<string /*FORMAT*/, string /*variable rrn*/>`.
- [ ] Tests rouges : `SFILE` sur non-WORKSTN → erreur d'analyse ; format absent ou non sous-fichier → erreur ; sous-fichier sans `SFILE` → erreur « SFILE manquant pour le format SFL1 » ; variable absente → déclarée `packed(4:0)` ; points d'attention 5.
- [ ] Implémenter, vert, check, commit.

### Tâche 3 : stockage du sous-fichier
**Fichiers :** créer `src/screens/subfile.ts` ; test `test/ecrans-sous-fichiers-stockage.test.js` (module compilé `out/screens/subfile`).
**Produit :**
```ts
interface SubfileRecord { values: Map<string, AreaValue>; indicators: string; changed: boolean }
class Subfile {
  constructor(size: number, page: number, extensible: boolean)   // extensible = size > page
  write(rrn: number, r: SubfileRecord): string | undefined        // message d'erreur ou undefined
  chain(rrn: number): SubfileRecord | undefined
  update(rrn: number, r: SubfileRecord): void
  readChanged(): { rrn: number; record: SubfileRecord } | undefined   // après la position ; remet changed à false
  resetPosition(): void; clear(): void; delete(): void; initialize(blank: () => Map<string, AreaValue>): void
  get count(): number; pageOf(rrn: number): number; rows(page: number): number[]   // page 1 = rangs 1..page
}
```
- [ ] Tests rouges : rang < 1 ou > 9999, doublon, trou, dépassement non extensible → message ; `readChanged` en ordre croissant, position conservée jusqu'à `resetPosition` ; `initialize` crée `size` lignes non modifiées ; point d'attention 1.
- [ ] Implémenter, vert, check, commit.

### Tâche 4 : protocole, `W` du contrôle, overlay, écran composé
**Fichiers :** `src/screens/protocol.ts` (`option` + `'SW'|'SC'|'SU'|'SR'`, `rrn?: number` ; `Screen.formats?: string[]`, `Screen.subfile?: { format: string; rows: { rrn: number; fields: Screen['fields'] }[]; end?: string; folded: boolean }`), `src/screens/simulator.ts`, créer `src/screens/composition.ts` (lignes occupées par un format, overlay) ; test `test/ecrans-sous-fichiers-simulateur.test.js` (modèle : `test/ecrans-simulateur.test.js`, helper `call`).
- [ ] Tests rouges : `SW`/`SU` avec `nextChanged` vrai → ligne modifiée, conditions `if` des zones évaluées par ligne ; zones H stockées non montrées ; `SW/SC/SU/SR` (statut `1` pour CHAIN absent et fin de READC ; UPDATE sans CHAIN/READC → statut 2) ; ordre DLT → CLR → INZ → affichage ; `SFLDSP` sur vide → statut 2 ; page de `SFLRCDNBR` ; `*MORE` « A suivre... »/« Fin », `*PLUS` « + » ; overlay qui retire un format partageant une ligne, sans overlay écran vidé ; `W`/`R` sur un format sous-fichier → statut 2 ; point d'attention 2.
- [ ] Implémenter, vert, check, commit.

### Tâche 5 : `R` du contrôle et scénario `lines`/`where`
**Fichiers :** `src/screens/simulator.ts` (ou `src/screens/subfile-input.ts`), `src/screens/protocol.ts` (`ScreenInput.lines?: { rrn: number; fields: {[n: string]: string} }[]`), `src/screens/scripted-terminal.ts` (`ScriptedEntry.lines?: { where: {[n: string]: string}; fields: {[n: string]: string} }[]` ; résout `where` en rang sur toutes les lignes chargées ; montre la page avant saisie sans consommer d'entrée).
- [ ] Tests rouges : saisie sur une ligne → modifiée (même valeur) ; PAGEDOWN/PAGEUP dans les lignes chargées → pas de retour, saisies conservées, une entrée consommée ; au-delà : SFLEND → erreur du scénario, sinon indicateur de la touche ; touche `drop` → bascule tronquée/dépliée (forme initiale tronquée) ; CA → rien de modifié ; `where` absent / multiple / ligne visée deux fois → messages de la spec §4 ; `lines` sans SFLDSP → erreur ; point d'attention 3.
- [ ] Implémenter, vert, check, commit.

### Tâche 6 : opérations côté interpréteur et bout en bout
**Fichiers :** créer `src/interpreter/screens/subfile-operations.ts` (WRITE/CHAIN/UPDATE/READC → SW/SC/SU/SR, `%FOUND`, `%EOF`, variable rrn) ; aiguillage depuis `src/interpreter/screens/operations.ts` ; spec 5a §5 (retirer les sous-fichiers des refus, garder les messages) ; test `test/ecrans-sous-fichiers-operations.test.js`.
- [ ] Tests rouges : programme page à page (écrit dans le test, une instruction par ligne) : chargement 7 lignes, `write BAS1; exfmt CTL1;`, option 2 par `where`, boucle `READC`/`UPDATE` ; programme tout chargé (20 lignes, `page` 7) avec PAGEDOWN interne ; `CHAIN` trouvé / absent (point d'attention 4) ; READC → `rrn1` mis à jour ; `READ`/`EXFMT` sur SFL1 → erreur ; extenseur → `NotSupportedError`.
- [ ] Implémenter, vert, `npm run --silent check`, commit.
- [ ] Mettre à jour la mémoire d'avancement (`project-etat-avancement.md`) : sous-fichiers faits, suivant 5b.
