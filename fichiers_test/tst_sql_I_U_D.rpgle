**free
ctl-opt dftactgrp(*no);

dcl-s vName char(50);
dcl-s vCount int(10);

// 1. SELECT initial
exec sql select name into :vName from customers where id = 1;
dsply 'Avant UPDATE : ' + %trim(vName);

// 2. UPDATE
exec sql update customers set name = 'Dupont-Modifie' where id = 1;
dsply 'UPDATE effectue';

// 3. SELECT après UPDATE
exec sql select name into :vName from customers where id = 1;
dsply 'Apres UPDATE : ' + %trim(vName);

// 4. INSERT
exec sql insert into customers (id, name, city, balance) values (4, 'Nouveau', 'Toulouse', 500.00);
dsply 'INSERT effectue';

// 5. SELECT après INSERT (vérification)
exec sql select name into :vName from customers where id = 4;
dsply 'Nouveau client : ' + %trim(vName);

// 6. DELETE
exec sql delete from customers where id = 4;
dsply 'DELETE effectue';

// 7. Vérification suppression
exec sql select name into :vName from customers where id = 4;
if sqlcod = 100;
    dsply 'Client 4 bien supprime';
else;
    dsply 'ERREUR : client 4 toujours present';
endif;

return;