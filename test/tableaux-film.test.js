// Tableaux : bout en bout : agrégation par catégorie
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parse } = require('./helpers');

// --- Bout en bout : agrégation par catégorie (DIM(*AUTO), *NEXT, %LOOKUP, SORTA, FOR-EACH, %EDITC) ---


test('bout en bout : film le plus vu par catégorie, trié en ordre EBCDIC', () => {
  const ctx = {
    programs: {},
    tables: {
      FILM: {
        format: 'FILM',
        columns: [{ name: 'CATEGORIE', type: 'char(15)' }, { name: 'LIBELLE', type: 'char(30)' },
                  { name: 'VUES', type: 'zoned(10:0)' }],
        data: [
          { CATEGORIE: 'Comedie', LIBELLE: 'Taxi', VUES: 120 },
          { CATEGORIE: 'Fantastique', LIBELLE: 'Harry Potter', VUES: 500 },
          { CATEGORIE: 'action', LIBELLE: 'Rambo', VUES: 7000 },
          { CATEGORIE: 'Comedie', LIBELLE: 'Les bronzes', VUES: 94558100 },
          { CATEGORIE: 'Drame', LIBELLE: 'Titanic', VUES: 3000 },
          { CATEGORIE: 'Fantastique', LIBELLE: 'Avatar', VUES: 985452365 },
          { CATEGORIE: 'action', LIBELLE: 'Alien', VUES: 7500 },
          { CATEGORIE: 'Drame', LIBELLE: 'Amelie', VUES: 800 },
          { CATEGORIE: 'Comedie', LIBELLE: 'Bis', VUES: 94558099 },
        ],
      },
    },
  };
  const out = run(`
**FREE

// Contexte :
//  Le fichier base de données FILM contient une liste des films

// Objectif :
//  Afficher par catégorie le film ayant le plus de vues et les afficher (DSPLY)
//  alphabétique.
//  Mise en forme du résultat :
//   DSPLY Comedie
//   DSPLY Les bronzes
//   DSPLY 0094558100
//   DSPLY Fantastique
//   DSPLY Avatar
//   DSPLY 0985452365
//
// =============================================================
// Programme RPG Free - Exercice : FILM
// Objectif : afficher le film le plus vu de chaque catégorie
// Auteur : Sylvain AKTEPE
// Date : 03/11/2025
// =============================================================

// -------------------------
// 1. Options de compilation
// -------------------------
ctl-opt actgrp(*new) alwnull(*no) extbinint(*yes);

// actgrp(*new)      le programme s'exécute dans un nouveau groupe dactivation
// alwnull(*no)      les champs NULL ne sont pas autorisés (sécurité)
// extbinint(*yes)   permet dutiliser les entiers binaires natifs IBM i

// -------------------------
// 2. Déclaration du fichier
// -------------------------
dcl-f film rename(film:ffilm);

// dcl-f = déclaration dun fichier base de données IBM i (ici FILM).
// rename(film:ffilm)  on renomme le format denregistrement interne
 // pour éviter les conflits de noms.

// -------------------------
// 3. Déclaration des structures de données
// -------------------------

// curFilm = structure contenant UN film lu du fichier FILM
dcl-ds curFilm likerec(ffilm);

// films = tableau contenant plusieurs films (maximum 10 ici)
// chaque élément du tableau a la même structure que le fichier FILM
dcl-ds films likerec(ffilm) dim(*auto:10);

// dim(*auto:10)  le tableau sagrandit automatiquement jusquà 10 éléments max
// chaque case du tableau servira à stocker le film le plus vu dune catégorie

// -------------------------
// 4. Lecture du fichier FILM
// -------------------------

read film curFilm;      // lecture du premier enregistrement du fichier FILM
dow not %eof;           // boucle tant quon nest pas en fin de fichier
   addFilm(curFilm);    // traitement de lenregistrement courant ( addFilm)
   read film curFilm;   // lire lenregistrement suivant
Enddo;


// À la fin de cette boucle, tous les films ont été lus et analysés
// le tableau "films" contient maintenant un film par catégorie (le plus vu)

// -------------------------
// 5. Affichage du résultat
// -------------------------

displayResult();              // appel de la procédure daffichage

*inlr = *on;
return;                       // fin du programme

// =============================================================
// 6. Procédure addFilm : ajoute ou remplace un film dans le tableau
// =============================================================

dcl-proc addFilm;

   // Variable locale pour stocker la position de la catégorie dans le tableau
   dcl-s l_index zoned(3:0) inz(0);

   // Définition des paramètres dentrée de la procédure
   dcl-pi *n;
      p_film likerec(ffilm) const ; // film passé en paramètre
   End-pi;

   // Recherche si la catégorie du film passé en paramètre existe déjà
   //  dans le tableau
   l_index = %lookup(p_film.categorie:films(*).categorie);

   // %LOOKUP cherche la position d'une valeur dans un tableau
   //  renvoie 0 si non trouvée
   //  renvoie la position (1, 2, 3, ...) si trouvée

   select;
      // --------------------------------------------------------
      // CAS 1 : la catégorie existe déjà ET le nouveau film a plus de vues
      // --------------------------------------------------------
      When l_index > 0 and films(l_index).vues < p_film.vues;
          films(l_index) = p_film ; // on remplace lancien film par le nouveau

      // --------------------------------------------------------
      // CAS 2 : la catégorie nexiste pas encore
      // --------------------------------------------------------
      When l_index = 0;
          films(*next) = p_film;       // on ajoute ce film à la fin du tableau
   Endsl;

End-proc;

// =============================================================
// 7. Procédure displayResult : affiche le résultat final
// =============================================================

dcl-proc displayResult;

   // --------------------------------------------------------
   // Étape 1 : trier le tableau "films" par catégorie alphabétique
   // --------------------------------------------------------
   sorta films(*).categorie;
   // SORTA = tri simple par champ (ici, ordre alphabétique des catégories)
   // Attention : SORTA est ancien mais pratique pour un petit exercice

   // --------------------------------------------------------
   // Étape 2 : affichage du contenu du tableau
   // --------------------------------------------------------
   for-each curFilm in films;
      DSPLY curFilm.categorie;          // afficher le nom de la catégorie
      DSPLY curFilm.libelle;            // afficher le titre du film
      DSPLY %editc(curFilm.vues:'X');   // afficher le nombre de vues (formaté)
   endfor;

   // %editc(...:'X')  convertit un nombre en texte lisible pour DSPLY
   // DSPLY : instruction daffichage sur lécran 5250 (max 52 caractères)
   // sur un écran vert, tu verras safficher les lignes lune après lautre

End-proc;

// =============================================================
// FIN DU PROGRAMME
// =============================================================

  `, ctx);
  assert.deepEqual(out, [
    'action', 'Alien', '0000007500',
    'Comedie', 'Les bronzes', '0094558100',
    'Drame', 'Titanic', '0000003000',
    'Fantastique', 'Avatar', '0985452365',
  ]);
});
