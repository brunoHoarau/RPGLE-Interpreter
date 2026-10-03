const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./helpers');

test('FOR TO additionne 1 à 5', () => {
  const out = run(`
    dcl-s i int(5);
    dcl-s total int(5) inz(0);
    for i = 1 to 5;
      total = total + i;
    endfor;
    dsply %char(total);
  `);
  assert.deepEqual(out, ['15']);
});

test('FOR laisse la variable au-delà de la limite en fin de boucle', () => {
  const out = run(`
    dcl-s i int(5);
    for i = 1 to 5;
    endfor;
    dsply %char(i);
  `);
  assert.deepEqual(out, ['6']);
});

test('FOR DOWNTO avec BY', () => {
  const out = run(`
    dcl-s i int(5);
    for i = 10 downto 1 by 3;
      dsply %char(i);
    endfor;
  `);
  assert.deepEqual(out, ['10', '7', '4', '1']);
});

test('LEAVE sort de la boucle DOW', () => {
  const out = run(`
    dcl-s i int(5) inz(0);
    dow i < 10;
      i = i + 1;
      if i = 2;
        leave;
      endif;
    enddo;
    dsply %char(i);
  `);
  assert.deepEqual(out, ['2']);
});

test('LEAVE dans une boucle infinie DOW 1 = 1', () => {
  const out = run(`
    dcl-s i int(5) inz(0);
    dow 1 = 1;
      i = i + 1;
      if i >= 3;
        leave;
      endif;
    enddo;
    dsply %char(i);
  `, undefined, { maxIterations: 1000 });
  assert.deepEqual(out, ['3']);
});

test('ITER passe à l\'itération suivante', () => {
  const out = run(`
    dcl-s i int(5);
    for i = 1 to 4;
      if i = 2;
        iter;
      endif;
      dsply %char(i);
    endfor;
  `);
  assert.deepEqual(out, ['1', '3', '4']);
});

test('ITER dans DOU réévalue la condition', () => {
  const out = run(`
    dcl-s i int(5) inz(0);
    dou i >= 3;
      i = i + 1;
      iter;
      dsply 'jamais';
    enddo;
    dsply %char(i);
  `);
  assert.deepEqual(out, ['3']);
});

test('LEAVE ne sort que de la boucle la plus interne', () => {
  const out = run(`
    dcl-s i int(5);
    dcl-s j int(5);
    for i = 1 to 2;
      for j = 1 to 5;
        leave;
      endfor;
      dsply %char(i) + '-' + %char(j);
    endfor;
  `);
  assert.deepEqual(out, ['1-1', '2-1']);
});

test('RETURN arrête le programme principal', () => {
  const out = run(`
    dsply 'avant';
    return;
    dsply 'apres';
  `);
  assert.deepEqual(out, ['avant']);
});

test('RETURN dans un IF arrête le programme principal', () => {
  const out = run(`
    dcl-s i int(5);
    for i = 1 to 5;
      if i = 2;
        return;
      endif;
      dsply %char(i);
    endfor;
    dsply 'fin';
  `);
  assert.deepEqual(out, ['1']);
});

test('RETURN dans un MONITOR n\'est pas intercepté par ON-ERROR', () => {
  const out = run(`
    monitor;
      return;
    on-error;
      dsply 'erreur';
    endmon;
    dsply 'apres';
  `);
  assert.deepEqual(out, []);
});

test('LEAVE dans un MONITOR sort de la boucle', () => {
  const out = run(`
    dcl-s i int(5) inz(0);
    dow i < 10;
      i = i + 1;
      monitor;
        leave;
      on-error;
        dsply 'erreur';
      endmon;
    enddo;
    dsply %char(i);
  `);
  assert.deepEqual(out, ['1']);
});

test('une boucle infinie est stoppée par la limite d\'itérations', () => {
  assert.throws(
    () => run(`dow 1 = 1; enddo;`, undefined, { maxIterations: 1000 }),
    /limite/i
  );
});

test('la limite d\'itérations s\'applique à FOR', () => {
  assert.throws(
    () => run(`dcl-s i int(5); for i = 1 to 5000; endfor;`, undefined, { maxIterations: 1000 }),
    /limite/i
  );
});
