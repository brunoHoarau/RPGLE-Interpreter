**free
ctl-opt dftactgrp(*no);

dcl-s reponse char(1);
dcl-s nom char(20) inz('Jean');

// 1. DSPLY simple
dsply 'Début du programme';

// 2. DSPLY avec extendeur d'erreur (E) et variable de réponse
// En vrai, ça afficherait : "Continuer ? (Y/N)" et attendrait une touche.
// Notre interpréteur va simuler la saisie de 'Y'.
dsply(e) 'Continuer ? (Y/N) ' *ext reponse;

if reponse = 'Y';
    dsply 'Bonjour ' + %trim(nom) + ', traitement en cours...';
else;
    dsply 'Traitement annulé.';
endif;

// 3. DSPLY avec file de messages explicite (simulé)
dsply 'Fin du programme' *joblog;

return;