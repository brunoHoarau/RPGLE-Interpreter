**FREE
Ctl-Opt ActGrp(*NEW);

// Déclaration de l'extension à tester
Dcl-Pr MonExtension ExtPgm('MONPGM');
  Entree_Param1  Char(10) Const;
  Sortie_Resultat  Packed(10:2);
End-Pr;

// Déclaration des variables de test
Dcl-S Prm_Test    Char(10);
Dcl-S Rst_Test    Packed(10:2);

Dsply ('--- DEBUT DES TESTS ---');

Prm_Test = 'VALIDE';

Monitor;
  MonExtension(Prm_Test : Rst_Test);
  Dsply ('Succes - Valeur : ' + %Char(Rst_Test));
On-Error;
  Dsply ('Erreur interceptee.');
EndMon;

Dsply ('--- FIN DES TESTS ---');

// Fin du programme traditionnel : on active l'indicateur Last Record
*InLR = *On;
Return;
