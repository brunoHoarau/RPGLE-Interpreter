const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./helpers');

const statusOf = expr => run(`dcl-s r varchar(50);
monitor;
  r = ${expr};
on-error;
  dsply %char(%status);
endmon;`)[0];

test('%XLATE traduit chaque caractère de from en celui de même rang de to', () => {
  assert.deepEqual(run(`dsply %xlate('abc':'ABC':'cabane');`), ['CABAne']);
});

test('%XLATE : les caractères de from sans correspondant dans to restent inchangés', () => {
  assert.deepEqual(run(`dsply %xlate('abc':'X':'cabane');`), ['cXbXne']);
});

test('%XLATE : un caractère répété dans from prend la première correspondance', () => {
  assert.deepEqual(run(`dsply %xlate('aa':'XY':'banane');`), ['bXnXne']);
});

test('%XLATE avec position de départ', () => {
  assert.deepEqual(run(`dsply %xlate('a':'X':'banane':3);`), ['banXne']);
});

test('%XLATE garde la longueur d\'une zone char fixe', () => {
  assert.deepEqual(run(`dcl-s c char(6) inz('ab');
dcl-s r varchar(8);
r = %xlate(' ':'.':c) + '|';
dsply r;`), ['ab....|']);
});

test('%XLATE : position de départ hors de la chaîne → statut 00100', () => {
  assert.deepEqual(statusOf(`%xlate('a':'b':'abc':4)`), '100');
  assert.deepEqual(statusOf(`%xlate('a':'b':'abc':0)`), '100');
});

test('%SCANRPL remplace toutes les occurrences', () => {
  assert.deepEqual(run(`dsply %scanrpl('an':'AN':'banane et ananas');`), ['bANANe et ANANas']);
});

test('%SCANRPL : remplacement par une chaîne plus longue ou vide', () => {
  assert.deepEqual(run(`dsply %scanrpl('a':'oo':'cadeau');`), ['coodeoou']);
  assert.deepEqual(run(`dsply %scanrpl('-':'':'01-02-03');`), ['010203']);
});

test('%SCANRPL : occurrences non chevauchantes, de gauche à droite', () => {
  assert.deepEqual(run(`dsply %scanrpl('aa':'b':'aaaaa');`), ['bba']);
});

test('%SCANRPL avec position de départ et longueur', () => {
  assert.deepEqual(run(`dsply %scanrpl('a':'X':'aaaaaa':2);`), ['aXXXXX']);
  assert.deepEqual(run(`dsply %scanrpl('a':'X':'aaaaaa':2:3);`), ['aXXXaa']);
});

test('%SCANRPL : une occurrence qui déborde de la plage n\'est pas remplacée', () => {
  assert.deepEqual(run(`dsply %scanrpl('ab':'X':'abababab':1:3);`), ['Xababab']);
});

test('%SCANRPL : position ou longueur hors de la chaîne → statut 00100', () => {
  assert.deepEqual(statusOf(`%scanrpl('a':'b':'abc':4)`), '100');
  assert.deepEqual(statusOf(`%scanrpl('a':'b':'abc':2:3)`), '100');
  assert.deepEqual(statusOf(`%scanrpl('a':'b':'abc':0)`), '100');
});
