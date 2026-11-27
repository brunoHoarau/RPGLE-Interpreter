// %EDITW : exemples de la documentation IBM i 7.5 (Edit words, rzasd/editwd*.htm)
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./helpers');

// Valeur d'une zone de type donné éditée par un mot d'édition ; le résultat est encadré pour voir les blancs
const editw = (type, value, word) => run(`dcl-s v ${type} inz(${value});
dsply '|' + %editw(v : '${word}') + '|';`)[0].slice(1, -1);

test('%EDITW : zéro d\'arrêt de la suppression des zéros', () => {
  assert.equal(editw('zoned(8:0)', 4, '   0      '), '    000004');
  assert.equal(editw('zoned(6:0)', 12345, '   0      '), '    012345');
  assert.equal(editw('zoned(4:0)', 156, '0   '), ' 156');
  assert.equal(editw('zoned(4:0)', 156, '0    '), ' 0156');
});

test('%EDITW : décimales, virgules et constantes', () => {
  assert.equal(editw('zoned(8:2)', 0.12, '   , 0 .  '), '      0.12');
  assert.equal(editw('zoned(8:2)', 1.23, '   , 0 .  '), '      1.23');
  assert.equal(editw('zoned(8:2)', 1.23, ' 0 ,   .  '), '  0,001.23');
  assert.equal(editw('zoned(9:2)', 0.12, '       .  '), '        12');
  assert.equal(editw('zoned(9:2)', 0.01, '      0.  '), '       .01');
  assert.equal(editw('zoned(9:2)', 0, '      0.  '), '       .00');
  assert.equal(editw('zoned(6:0)', 10388, '  /  /  '), ' 1/03/88');
  assert.equal(editw('zoned(5:2)', 12.34, '  0.  000'), ' 12.34000');
});

test('%EDITW : astérisque de remplissage', () => {
  assert.equal(editw('zoned(9:2)', 1.23, '*      .  '), '*000001.23');
  assert.equal(editw('zoned(9:2)', 0, '     * .  '), '******0.00');
  assert.equal(editw('zoned(9:2)', 563.42, '     * .  **'), '****563.42**');
  assert.equal(editw('zoned(5:2)', 12.34, '  *.  000'), '*12.34000');
});

test('%EDITW : symbole monétaire fixe en première position', () => {
  assert.equal(editw('zoned(9:2)', 1234.56, '$ ,   ,  0.  '), '$    1,234.56');
  assert.equal(editw('zoned(9:2)', 0, '$  ,   ,0 0.  '), '$        00.00');
  assert.equal(editw('zoned(9:2)', 1234.56, '$ ,   ,*  .  '), '$****1,234.56');
});

test('%EDITW : & donne un blanc ; constantes du corps', () => {
  assert.equal(editw('zoned(10:0)', 4165551212, '0AREA&   &NO.&   -    '), ' AREA 416 NO. 555-1212');
});

test('%EDITW : statut CR ou -, imprimé seulement si la valeur est négative', () => {
  assert.equal(editw('zoned(9:2)', -1.23, '       .  -'), '      1.23-');
  assert.equal(editw('zoned(9:2)', 1.23, '       .  -'), '      1.23 ');
  assert.equal(editw('zoned(9:2)', -1.23, ' ,   ,  0.  &30&DAY&CR'), ' '.repeat(8) + '1.23 30 DAY CR'); // la doc IBM imprime 9 blancs ici, 8 dans l'exemple positif
  assert.equal(editw('zoned(9:2)', 1.23, ' ,   ,  0.  &30&DAY&CR'), ' '.repeat(8) + '1.23' + ' '.repeat(10));
});

test('%EDITW : l\'expansion est toujours imprimée', () => {
  assert.equal(editw('zoned(6:2)', -1.23, ' ,  0.  &CR&NET'), '    1.23 CR NET');
  assert.equal(editw('zoned(6:2)', 1.23, ' ,  0.  &CR&NET'), '    1.23    NET');
  assert.equal(editw('zoned(5:2)', -123.45, '  0.  &SECRET'), '123.45 SECRET');
  assert.equal(editw('zoned(5:2)', 123.45, '  0.  &SECRET'), '123.45     ET');
  assert.equal(editw('zoned(5:2)', 123.45, '  0.  &CR&&SECRET'), '123.45     SECRET');
});

test('%EDITW : valeur négative sans statut, signe non imprimé', () => {
  assert.equal(editw('packed(5:2)', -123.45, '  0.  '), '123.45');
});

test('%EDITW d\'un entier et avec un mot d\'édition en constante nommée', () => {
  assert.deepEqual(run(`dcl-c MOT '   0  ';
dcl-s i int(5) inz(42);
dsply '|' + %editw(i : MOT) + '|';`), ['|    42|']);
});

test('%EDITW : moins de positions de chiffres que la zone → refusé à la compilation', () => {
  assert.throws(() => editw('zoned(5:0)', 1, '   0'), /EDITW/);
});

test('%EDITW encore refusé : $ flottant, expression, mot d\'édition variable', () => {
  assert.throws(() => editw('zoned(9:2)', 12, '  ,   , $0.  '), /pas encore supporté/);
  assert.throws(() => run(`dcl-s v zoned(5:2) inz(1);\ndsply %editw(v * 2 : '   0.  ');`), /pas encore supporté/);
  assert.throws(() => run(`dcl-s v zoned(5:2) inz(1);\ndcl-s w char(7) inz('  0.  ');\ndsply %editw(v : w);`), /EDITW/);
});
