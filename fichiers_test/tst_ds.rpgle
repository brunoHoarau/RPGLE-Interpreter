**free
ctl-opt dftactgrp(*no);

// Déclaration d'une structure de données qualifiée
dcl-ds client qualified;
    id    int(10) inz(0);
    nom   char(50) inz('');
    ville char(30) inz('');
    solde packed(9:2) inz(0);
end-ds;

// Affectation des champs
client.id = 123;
client.nom = 'Dupont';
client.ville = 'Paris';
client.solde = 1500.50;

// Affichage
dsply 'ID: ' + %char(client.id);
dsply 'Nom: ' + %trim(client.nom);
dsply 'Ville: ' + %trim(client.ville);
dsply 'Solde: ' + %char(client.solde);

// Modification
client.solde = client.solde + 500;
dsply 'Nouveau solde: ' + %char(client.solde);

// Condition sur un champ
if client.solde > 1000;
    dsply 'Client VIP';
else;
    dsply 'Client standard';
endif;

// Deuxième structure
dcl-ds commande qualified;
    numCmd   int(10) inz(1001);
    idClient int(10) inz(0);
    montant  packed(7:2) inz(0);
end-ds;

commande.idClient = client.id;
commande.montant = 250.75;

dsply 'Commande #' + %char(commande.numCmd) + ' pour client ' + %char(commande.idClient);
dsply 'Montant: ' + %char(commande.montant);

return;