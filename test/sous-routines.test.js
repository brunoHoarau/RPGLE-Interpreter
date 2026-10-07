const test = require('node:test');
const assert = require('node:assert');
const { run, parse } = require('./helpers');

test('EXSR exécute la sous-routine puis reprend après l\'appel', () => {
  assert.deepStrictEqual(run(`
    dcl-s n int(10) inz(0);
    exsr ajoute;
    dsply 'milieu';
    exsr ajoute;
    dsply %char(n);
    return;
    begsr ajoute;
      n += 1;
    endsr;
  `), ['milieu', '2']);
});

test('EXSR peut précéder BEGSR dans la source ; les noms sont insensibles à la casse', () => {
  assert.deepStrictEqual(run(`
    EXSR Hello;
    begsr HELLO;
      dsply 'salut';
    endsr;
  `), ['salut']);
});

test('le flux séquentiel ne tombe pas dans une sous-routine', () => {
  assert.deepStrictEqual(run(`
    dsply 'principal';
    begsr jamais;
      dsply 'interdit';
    endsr;
  `), ['principal']);
});

test('sous-routines imbriquées (EXSR dans une sous-routine)', () => {
  assert.deepStrictEqual(run(`
    exsr a;
    begsr a;
      dsply 'a1';
      exsr b;
      dsply 'a2';
    endsr;
    begsr b;
      dsply 'b';
    endsr;
  `), ['a1', 'b', 'a2']);
});

test('EXSR dans un if, une boucle et un monitor', () => {
  assert.deepStrictEqual(run(`
    dcl-s i int(10);
    dcl-s n int(10) inz(0);
    for i = 1 to 3;
      if i <> 2;
        exsr inc;
      endif;
    endfor;
    dsply %char(n);
    begsr inc;
      n += 10;
    endsr;
  `), ['20']);
});

test('LEAVESR quitte la sous-routine immédiatement', () => {
  assert.deepStrictEqual(run(`
    exsr s;
    dsply 'apres';
    begsr s;
      dsply 'avant';
      leavesr;
      dsply 'jamais';
    endsr;
  `), ['avant', 'apres']);
});

test('LEAVESR dans une boucle de la sous-routine', () => {
  assert.deepStrictEqual(run(`
    dcl-s i int(10);
    exsr s;
    dsply 'fin';
    begsr s;
      for i = 1 to 10;
        if i = 3;
          leavesr;
        endif;
        dsply %char(i);
      endfor;
      dsply 'jamais';
    endsr;
  `), ['1', '2', 'fin']);
});

test('LEAVE et ITER dans une boucle d\'une sous-routine sont permis', () => {
  assert.deepStrictEqual(run(`
    dcl-s i int(10);
    exsr s;
    begsr s;
      for i = 1 to 5;
        if i = 2; iter; endif;
        if i = 4; leave; endif;
        dsply %char(i);
      endfor;
    endsr;
  `), ['1', '3']);
});

test('LEAVE / ITER dans une sous-routine hors boucle : erreur, même appelée depuis une boucle', () => {
  assert.throws(() => parse(`
    dcl-s i int(10);
    dow i < 3;
      exsr s;
    enddo;
    begsr s;
      leave;
    endsr;
  `), /LEAVE/);
  assert.throws(() => parse(`exsr s; begsr s; iter; endsr;`), /ITER/);
});

test('LEAVESR hors sous-routine : erreur', () => {
  assert.throws(() => parse(`leavesr;`), /LEAVESR/);
});

test('RETURN dans une sous-routine termine le programme', () => {
  assert.deepStrictEqual(run(`
    exsr s;
    dsply 'jamais';
    begsr s;
      dsply 'dans s';
      return;
    endsr;
  `), ['dans s']);
});

test('une erreur levée dans la sous-routine est capturée par le MONITOR de l\'appelant', () => {
  assert.deepStrictEqual(run(`
    dcl-s a packed(5:0) inz(0);
    monitor;
      exsr boom;
      dsply 'jamais';
    on-error;
      dsply 'capture';
    endmon;
    begsr boom;
      a = 1 / a;
    endsr;
  `), ['capture']);
});

test('sous-routine dans une procédure : variable locale de la procédure', () => {
  assert.deepStrictEqual(run(`
    dcl-proc double;
      dcl-pi *n int(10);
        x int(10) value;
      end-pi;
      dcl-s r int(10);
      exsr calc;
      return r;
      begsr calc;
        r = x * 2;
      endsr;
    end-proc;
    dsply %char(double(21));
  `), ['42']);
});

test('procédure sans RETURN : la mainline s\'arrête à BEGSR', () => {
  assert.deepStrictEqual(run(`
    dcl-proc p;
      dsply 'p1';
      begsr s;
        dsply 'jamais';
      endsr;
    end-proc;
    p();
    dsply 'fin';
  `), ['p1', 'fin']);
});

test('une sous-routine modifie une variable globale du programme', () => {
  assert.deepStrictEqual(run(`
    dcl-s g int(10) inz(1);
    exsr s;
    dsply %char(g);
    begsr s;
      g = 99;
    endsr;
  `), ['99']);
});

test('*INZSR s\'exécute une fois avant le code principal', () => {
  assert.deepStrictEqual(run(`
    dcl-s n int(10) inz(5);
    dsply 'principal ' + %char(n);
    begsr *inzsr;
      dsply 'init';
      n += 1;
    endsr;
  `), ['init', 'principal 6']);
});

test('EXSR *INZSR est permis', () => {
  assert.deepStrictEqual(run(`
    exsr *inzsr;
    begsr *inzsr;
      dsply 'init';
    endsr;
  `), ['init', 'init']);
});

test('*INZSR dans une procédure : erreur', () => {
  assert.throws(() => parse(`dcl-proc p; begsr *inzsr; endsr; end-proc;`), /INZSR/);
});

test('sous-routine inconnue : erreur à l\'analyse', () => {
  assert.throws(() => parse(`exsr nulle;`), /sous-routine.*NULLE/i);
});

test('une procédure ne voit pas les sous-routines du programme principal', () => {
  assert.throws(() => parse(`
    dcl-proc p; exsr s; end-proc;
    begsr s; endsr;
  `), /sous-routine.*S/i);
});

test('nom de sous-routine dupliqué : erreur', () => {
  assert.throws(() => parse(`begsr a; endsr; begsr A; endsr;`), /déjà définie/);
});

test('BEGSR imbriquée : erreur', () => {
  assert.throws(() => parse(`begsr a; begsr b; endsr; endsr;`), /imbriqu/i);
});

test('déclaration dans une sous-routine : erreur', () => {
  assert.throws(() => parse(`begsr a; dcl-s x int(5); endsr;`), /sous-routine/);
});

test('instruction ou déclaration après les sous-routines : erreur', () => {
  assert.throws(() => parse(`begsr a; endsr; dsply 'x';`), /doivent suivre le code principal/);
  assert.throws(() => parse(`begsr a; endsr; dcl-s x int(5);`), /doivent suivre le code principal/);
  assert.throws(() => parse(`dcl-proc p; begsr a; endsr; dsply 'x'; end-proc;`), /doivent suivre le code principal/);
});

test('dcl-proc après les sous-routines du programme principal : permis', () => {
  assert.deepStrictEqual(run(`
    exsr a;
    begsr a; dsply 'a'; endsr;
    dcl-proc p; end-proc;
  `), ['a']);
});

test('ENDSR sans BEGSR ou BEGSR sans ENDSR : erreur', () => {
  assert.throws(() => parse(`endsr;`), /ENDSR/);
  assert.throws(() => parse(`begsr a; dsply 'x';`), /ENDSR/);
});
