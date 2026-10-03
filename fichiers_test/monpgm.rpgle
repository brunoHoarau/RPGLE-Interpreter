**FREE
// Configuration du programme : il s'exécute dans le groupe d'activation de l'appelant
Ctl-Opt ActGrp(*CALLER);

// Déclaration de l'interface d'entrée (les paramètres reçus du pgm de test)
Dcl-Pi *N;
  In_Param    Char(10) Const;
  Out_Result  Packed(10:2);
End-Pi;

// Initialisation de la variable de sortie
Out_Result = 0;

// Traitement selon le paramètre reçu
Select;
  
  When In_Param = 'VALIDE';
    // Cas nominal : l'extension fait son travail mathématique
    Out_Result = 150.75;

  When In_Param = 'ERREUR';
    // Cas de test négatif : on force une division par zéro pour lever une erreur CPF
    // Cela permet de tester si votre programme de test intercepte bien les crashs
    Out_Result = 10 / Out_Result; 

  Other;
    // Autre cas : valeur non gérée
    Out_Result = -1;

EndSl;

// Fin obligatoire du programme traditionnel pour libérer la mémoire
*InLR = *On;
Return;
 