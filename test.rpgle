**free
ctl-opt dftactgrp(*no);

// Déclarations
dcl-s nom char(50) inz('Dupont');
dcl-s age int(5) inz(25);
dcl-s message char(100);
dcl-s i int(5);
dcl-s total packed(7:2) inz(0);

// Affichage simple
dsply 'Bonjour ' + %trim(nom);

// Condition
if age >= 18;
    message = 'Majeur';
else;
    message = 'Mineur';
endif;

dsply 'Statut: ' + %trim(message);

// Boucle FOR
for i = 1 to 5;
    total = total + i;
endfor;

dsply 'Total de 1 à 5: ' + %char(total);

// Boucle DOW
i = 10;
dow i > 0;
    i = i - 2;
enddo;

dsply 'Valeur finale de i: ' + %char(i);

// SELECT
select;
    when age < 18;
        dsply 'Enfant';
    when age < 65;
        dsply 'Adulte';
    other;
        dsply 'Senior';
endsl;

// Fonctions intégrées
dsply 'Longueur du nom: ' + %char(%len(nom));
dsply 'Nom en majuscules: ' + %upper(nom);

return;