**free
ctl-opt dftactgrp(*no);

dcl-s vName char(50);
dcl-s vCity char(30);
dcl-s vId int(10) inz(2);
dcl-s vBalance packed(9:2);

// Test 1 : SELECT avec INTO
exec sql select name, city into :vName, :vCity from customers where id = :vId;

if sqlstt = '00000';
    dsply 'Client trouve: ' + %trim(vName) + ' de ' + %trim(vCity);
else;
    dsply 'Client non trouve (SQLCOD=' + %char(sqlcod) + ')';
endif;

// Test 2 : SELECT qui ne trouve rien
vId = 999;
exec sql select name into :vName from customers where id = :vId;

if sqlcod = 100;
    dsply 'Aucun client avec ID=999 (comportement correct)';
else;
    dsply 'Erreur inattendue';
endif;

// Test 3 : Reprise avec une recherche valide
vId = 1;
exec sql select name, balance into :vName, :vBalance from customers where id = :vId;

if sqlstt = '00000';
    dsply 'Solde de ' + %trim(vName) + ' : ' + %char(vBalance);
endif;

return;