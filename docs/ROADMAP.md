# RPGLE Interpreter - Roadmap 2026-2027

> *Dernière mise à jour : 2026*
> *Statut : En cours de développement*

---

## 📋 Introduction

Ce document présente la **roadmap officielle** pour le développement continu du **RPGLE Interpreter pour VS Code**. 
Il définit les priorités, les fonctionnalités à implémenter, les estimations de temps et les livrables attendus.

**Objectif global** : Faire du RPGLE Interpreter un outil **production-ready** capable d'exécuter la majorité des programmes RPGLE sans dépendre d'un système IBM i.

---

## 🎯 Objectifs Stratégiques

1. **Complétude fonctionnelle** : Supporter 90%+ des fonctionnalités RPGLE courantes
2. **Expérience développeur** : Intégration transparente avec VS Code (debugging, autocomplétion)
3. **Performance** : Exécution rapide même pour les programmes complexes
4. **Stabilité** : Suite de tests complète et robuste
5. **Documentation** : Guides clairs pour les utilisateurs et contributeurs

---

## 🗺️ Phases de Développement

---

### 📌 Phase 1 : Fonctionnalités de Base Manquantes
**Priorité** : ⭐⭐⭐⭐⭐ (HAUTE)  
**Durée estimée** : 4-6 semaines  
**Objectif** : Combler les lacunes les plus demandées pour un usage professionnel de base.

| ID | Fonctionnalité | Description | Complexité | Estimation | Dépendances | Statut |
|----|---------------|-------------|------------|------------|-------------|--------|
| 1.1 | **Tableaux (`dim`)** | Support des tableaux 1D et 2D avec `dcl-s arr int(5) dim(10)`. Inclut l'indexation, l'affectation, et les fonctions `%ELEM`, `%SIZE` | ⭐⭐⭐ | 10-14 jours | Aucune | ⏳ |
| 1.2 | **Sous-routines (`BEGSR`/`EXSR`)** | Déclaration et appel de sous-routines avec `BEGSR`/`ENDSR` et `EXSR`. Support des variables locales et du partage de scope | ⭐⭐ | 7-10 jours | Aucune | ⏳ |
| 1.3 | **`/COPY`** | Inclusion de code source externe. Support des chemins relatifs et absolus, avec cache des fichiers inclus | ⭐⭐ | 5-7 jours | 1.2 (si partage de variables) | ⏳ |
| 1.4 | **`LIKE`/`LIKEDS`** | Déclarations basées sur d'autres variables ou structures de données. `dcl-s x like(y)` et `dcl-s ds likeds(other_ds)` | ⭐⭐ | 5-7 jours | Aucune | ⏳ |
| 1.5 | **`%FIELDS`** | Fonction intégrée pour compter le nombre de champs dans une structure de données ou un fichier | ⭐ | 2-3 jours | Aucune | ⏳ |

**📦 Livrables Phase 1** :
- [ ] Extension capable de gérer 80% des programmes RPGLE réels
- [ ] Tests unitaires complets pour chaque feature
- [ ] Documentation mise à jour (README, exemples)
- [ ] Exemples dans `fichiers_test/`

---

### 📌 Phase 2 : SQL Avancé
**Priorité** : ⭐⭐⭐⭐ (MOYENNE-HAUTE)  
**Durée estimée** : 3-4 semaines  
**Objectif** : Support complet des requêtes SQL embarquées courantes.

| ID | Fonctionnalité | Description | Complexité | Estimation | Dépendances |
|----|---------------|-------------|------------|------------|-------------|
| 2.1 | **`ORDER BY`** | Tri des résultats SQL par une ou plusieurs colonnes, avec `ASC`/`DESC` | ⭐⭐ | 5-7 jours | Moteur SQL existant |
| 2.2 | **`GROUP BY` + Agrégats** | Regroupement des résultats avec fonctions d'agrégation (`COUNT(*)`, `SUM`, `AVG`, `MIN`, `MAX`) | ⭐⭐⭐ | 8-10 jours | 2.1 |
| 2.3 | **`JOIN` (INNER/LEFT)** | Jointures entre tables (`INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`). Support des alias de tables | ⭐⭐⭐ | 10-12 jours | 2.2 |
| 2.4 | **`LIKE`** | Opérateur de pattern matching avec `%` et `_` | ⭐⭐ | 4-5 jours | Aucune |
| 2.5 | **Sous-requêtes** | Requêtes imbriquées dans `WHERE` (`IN`, `NOT IN`, `EXISTS`), `FROM`, et `SELECT` | ⭐⭐⭐ | 7-10 jours | 2.3 |
| 2.6 | **Fonctions SQL** | Fonctions scalaires (`UPPER`, `LOWER`, `SUBSTR`, `LENGTH`, `TRIM`, `COALESCE`, etc.) | ⭐⭐ | 5-7 jours | Aucune |
| 2.7 | **`HAVING`** | Filtre sur les résultats groupés | ⭐⭐ | 3-4 jours | 2.2 |

**📦 Livrables Phase 2** :
- [ ] Support de 90% des requêtes SQL courantes
- [ ] Exemples avancés dans `fichiers_test/`
- [ ] Benchmarks de performance pour les requêtes complexes
- [ ] Documentation SQL mise à jour

---

### 📌 Phase 3 : Fonctionnalités RPG Avancées
**Priorité** : ⭐⭐⭐ (MOYENNE)  
**Durée estimée** : 4-5 semaines  
**Objectif** : Support des patterns RPG avancés et des fonctionnalités système.

| ID | Fonctionnalité | Description | Complexité | Estimation | Dépendances |
|----|---------------|-------------|------------|------------|-------------|
| 3.1 | **Fichiers écran** | Support basique des fichiers écran (`dcl-f` avec `workstn`). Simulation des `EXFMT`, `WRITE`, `READ` | ⭐⭐⭐ | 10-14 jours | Système I/O existant |
| 3.2 | **Fichiers impression** | Support des fichiers impression avec `OVRPRTF`, `WRITE` vers imprimante. Génération de PDF/texte | ⭐⭐⭐ | 8-10 jours | 3.1 |
| 3.3 | **Type `float`** | Support du type floating point (`float(8)`). Gestion des précisions et conversions | ⭐ | 3-5 jours | Moteur types |
| 3.4 | **Paramètres programme** | Support des paramètres pour le programme principal : `dcl-pi *entry parm1 parm2` | ⭐⭐ | 5-7 jours | 1.2 |
| 3.5 | **`EXTNAME`** | Accès direct à des fichiers DB2 externes. Intégration avec le moteur SQL | ⭐⭐⭐ | 7-10 jours | SQL existant |
| 3.6 | **Variables globales persistantes** | Conservation des variables entre appels de programme (simulation de `*INZSR` et variables statiques) | ⭐⭐ | 5-7 jours | Système runtime |
| 3.7 | **`ALIAS`** | Déclaration d'alias pour les fichiers et formats | ⭐ | 2-3 jours | Système fichiers |

**📦 Livrables Phase 3** :
- [ ] Support des programmes RPG complexes
- [ ] Intégration basique avec le debugger VS Code (breakpoints)
- [ ] Exemples avancés

---

### 📌 Phase 4 : Outillage & Expérience Développeur
**Priorité** : ⭐⭐ (MOYENNE-BASSE)  
**Durée estimée** : 3-4 semaines  
**Objectif** : Améliorer l'expérience développeur et l'intégration avec VS Code.

| ID | Fonctionnalité | Description | Complexité | Estimation |
|----|---------------|-------------|------------|------------|
| 4.1 | **Debugger VS Code** | Intégration complète du debugger : breakpoints, step-in/over/out, inspection des variables, call stack | ⭐⭐⭐⭐ | 12-15 jours |
| 4.2 | **Autocomplétion améliorée** | Intellisense contextuel pour les variables, fonctions, fichiers. Support des snippets | ⭐⭐⭐ | 8-10 jours |
| 4.3 | **Linter avancé** | Règles de style RPG (nomenclature, conventions). Détection des anti-patterns | ⭐⭐ | 5-7 jours |
| 4.4 | **Snippets** | Morceaux de code prédéfinis pour les structures courantes (boucles, fichiers, etc.) | ⭐ | 3-5 jours |
| 4.5 | **Export vers IBM i** | Génération de code RPGLE compatible avec IBM i. Validation des différences | ⭐⭐ | 5-7 jours |
| 4.6 | **Profiler** | Analyse des performances : temps d'exécution, nombre d'opérations, mémoire utilisée | ⭐⭐⭐ | 7-10 jours |

**📦 Livrables Phase 4** :
- [ ] Extension "production-ready"
- [ ] Publication sur VS Code Marketplace
- [ ] Documentation utilisateur complète

---

### 📌 Phase 5 : Optimisations & Maintenance
**Priorité** : ⭐ (BASSE - Continu)  
**Durée estimée** : 2-3 semaines (continu)  
**Objectif** : Stabilité, performance et maintenance à long terme.

| ID | Fonctionnalité | Description | Estimation |
|----|---------------|-------------|------------|
| 5.1 | **Optimisation moteur** | Cache des résultats, compilation JIT pour les boucles, optimisation des accès mémoire | 7-10 jours |
| 5.2 | **Tests de non-régression** | Suite complète de tests pour toutes les fonctionnalités. Intégration CI/CD | 5-7 jours |
| 5.3 | **Documentation complète** | Guide utilisateur, guide du contributeur, API reference, tutoriels | 5-7 jours |
| 5.4 | **CI/CD amélioré** | Workflows GitHub Actions avancés : tests multi-OS, benchmarks, génération de docs | 3-5 jours |
| 5.5 | **Support multi-langues** | Traductions de l'interface et de la documentation (Français, Anglais, Espagnol) | 5-7 jours |
| 5.6 | **Analyse de couverture** | Mesure de la couverture de code par les tests. Objectif : 90%+ | 3-5 jours |

**📦 Livrables Phase 5** :
- [ ] Extension optimisée et stable
- [ ] Processus de contribution clair
- [ ] Communauté active

---

## 📊 Résumé des Temps & Ressources

| Phase | Durée | Fonctionnalités | Livrables | Priorité |
|-------|-------|------------------|-----------|----------|
| **Phase 1** | 4-6 semaines | Tableaux, SR, /COPY, LIKE, %FIELDS | 80% compatibilité RPG | ⭐⭐⭐⭐⭐ |
| **Phase 2** | 3-4 semaines | SQL avancé (JOIN, GROUP BY, etc.) | 90% compatibilité SQL | ⭐⭐⭐⭐ |
| **Phase 3** | 4-5 semaines | Fichiers écran/impression, float, etc. | Programmes complexes | ⭐⭐⭐ |
| **Phase 4** | 3-4 semaines | Debugger, autocomplétion, linter | Production-ready | ⭐⭐ |
| **Phase 5** | 2-3 semaines | Optimisations & docs | Stabilité | ⭐ |

**🎯 Total estimé** : **16-22 semaines** (4-5 mois) pour un produit complet.

---

## 🚀 Recommandations de Démarrage

### Priorité Immédiate (Phase 1)
1. **`dim` (Tableaux)** *(Recommandé - impact maximal)*
   - **Pourquoi** : Les tableaux sont utilisés dans presque tous les programmes RPG réels
   - **Impact** : Énorme pour les développeurs
   - **Complexité** : Moyenne (gestion mémoire, indexation)
   - **Estimation** : 10-14 jours
   - **Livrable** : Tests + docs + exemples

2. **`BEGSR`/`EXSR` (Sous-routines)**
   - **Pourquoi** : Structure de code essentielle en RPG
   - **Impact** : Très élevé pour la modularité
   - **Complexité** : Moyenne (scope, appel de fonctions)
   - **Estimation** : 7-10 jours

3. **`/COPY`**
   - **Pourquoi** : Réutilisation de code
   - **Impact** : Élevé pour les gros projets
   - **Complexité** : Moyenne (cache, chemins)
   - **Estimation** : 5-7 jours

---

## 📌 Critères d'Acceptation

Pour qu'une fonctionnalité soit considérée comme **terminée**, elle doit :

- [ ] **Être implémentée** dans le code source (`src/`)
- [ ] **Avoir des tests unitaires** complets (dans `test/`)
- [ ] **Passé tous les tests** existants (régression)
- [ ] **Avoir une documentation** mise à jour (README, docs/)
- [ ] **Avoir des exemples** dans `fichiers_test/` (si applicable)
- [ ] **Être validée** par une revue de code
- [ ] **Être mergée** dans la branche `main`

---

## 🛠️ Outils & Ressources

### Environnement de Développement
- **Langage** : TypeScript
- **Framework** : VS Code Extension API
- **Tests** : Node.js `test` module
- **Build** : `npm run compile`

### Commandes Utiles
```bash
# Compilation
npm run compile

# Tests
npm test

# Tests avec coverage (à ajouter)
npm run test:coverage

# Développement avec hot-reload
npm run watch

# Packaging pour VS Code
npm run package
```

### Structure des Branches
- `main` : Version stable (toujours fonctionnelle)
- `feat/*` : Nouvelles fonctionnalités
- `fix/*` : Corrections de bugs
- `docs/*` : Mises à jour de documentation
- `refactor/*` : Refactoring de code

---

## 🤝 Contribution

Les contributions sont les bienvenues ! Pour contribuer :

1. **Fork** le dépôt
2. **Crée une branche** pour ta fonctionnalité (`git checkout -b feat/ma-fonctionnalité`)
3. **Commit** tes changements (`git commit -m 'Ajout de ma fonctionnalité'`)
4. **Push** vers la branche (`git push origin feat/ma-fonctionnalité`)
5. **Ouvre une Pull Request** vers `main`

### Règles de Contribution
- Suis le **style de code** existant
- Ajoute des **tests** pour toute nouvelle fonctionnalité
- Mets à jour la **documentation** si nécessaire
- Assure-toi que **tous les tests passent** avant de pousser
- Utilise des **messages de commit clairs**

---

## 📞 Contact & Support

- **Auteur principal** : [brunoHoarau](https://github.com/brunoHoarau)
- **Dépôt** : [RPGLE-Interpreter](https://github.com/brunoHoarau/RPGLE-Interpreter)
- **Issues** : [Ouvrir une issue](https://github.com/brunoHoarau/RPGLE-Interpreter/issues)
- **Discussions** : [Discussions GitHub](https://github.com/brunoHoarau/RPGLE-Interpreter/discussions)

---

## 📝 Historique des Versions

| Version | Date | Changements |
|---------|------|-------------|
| 1.0.0 | 2026 | Version initiale (ce document) |

---

## 🎉 Feuille de Route à Long Terme (2026+)

- **Intégration avec IBM i** : Synchronisation bidirectionnelle avec des systèmes réels
- **Support RPG III** : Compatibilité descendante
- **IDE standalone** : Version desktop indépendante de VS Code
- **Plugin pour autres éditeurs** : JetBrains, Eclipse, etc.
- **Cloud IDE** : Version web avec Monaco Editor
- **AI Assistant** : Génération de code RPGLE assistée par IA

---

*Ce document est un travail en cours et sera mis à jour régulièrement.*
