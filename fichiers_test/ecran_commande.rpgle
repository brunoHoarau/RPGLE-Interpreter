**free
ctl-opt dftactgrp(*no);

// Saisie de commande sur un fichier ecran (context/displays.json)
// Le libelle vient du fichier ARTICLE (context/tables.json), lu par CHAIN
// F3 quitte, F5 reaffiche l'ecran vide
dcl-f cdeecran workstn;
dcl-f article keyed;

dcl-s nbLignes int(10) inz(0);

dow not *in03;
  exfmt saisie;
  *in31 = *off;
  if not *in03;
    if *in05;
      code = ' ';
      libelle = ' ';
      qte = 0;
    else;
      chain code article;
      if %found(article);
        nbLignes += 1;
        dsply ('Commande ' + %trim(code) + ' : ' + %trim(libelle) + ' x ' + %char(qte));
      else;
        libelle = ' ';
        *in31 = *on;
      endif;
    endif;
  endif;
enddo;

dsply ('Lignes saisies : ' + %char(nbLignes));
*inlr = *on;
