// Non-régression : les programmes d'exemple du dépôt
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { run, customersContext } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('test.rpgle', () => {
  assert.deepEqual(run(read('test.rpgle')), [
    'Bonjour Dupont',
    'Statut: Majeur',
    'Total de 1 à 5: 15.00',
    'Valeur finale de i: 0',
    'Adulte',
    'Longueur du nom: 50',
    'Nom en majuscules: DUPONT',
  ]);
});

test('tst_ds.rpgle', () => {
  assert.deepEqual(run(read('fichiers_test/tst_ds.rpgle')), [
    'ID: 123',
    'Nom: Dupont',
    'Ville: Paris',
    'Solde: 1500.50',
    'Nouveau solde: 2000.50',
    'Client VIP',
    'Commande #1001 pour client 123',
    'Montant: 250.75',
  ]);
});

test('tst_dsply.rpgle', () => {
  assert.deepEqual(run(read('fichiers_test/tst_dsply.rpgle')), [
    'Début du programme',
    'Continuer ? (Y/N) (File: *ext)',
    'Bonjour Jean, traitement en cours...',
    'Fin du programme (File: *joblog)',
  ]);
});

test('tst_sql_Select.rpgle', () => {
  assert.deepEqual(run(read('fichiers_test/tst_sql_Select.rpgle'), customersContext()), [
    'Client trouve: Martin de Lyon',
    'Aucun client avec ID=999 (comportement correct)',
    'Solde de Dupont : 1500.50',
  ]);
});

test('tst_sql_I_U_D.rpgle', () => {
  assert.deepEqual(run(read('fichiers_test/tst_sql_I_U_D.rpgle'), customersContext()), [
    'Avant UPDATE : Dupont',
    'UPDATE effectue',
    'Apres UPDATE : Dupont-Modifie',
    'INSERT effectue',
    'Nouveau client : Nouveau',
    'DELETE effectue',
    'Client 4 bien supprime',
  ]);
});

test('tstpgm.rpgle avec le bouchon de VOTRE_PGM du dossier context/', () => {
  const { loadContextFromFolder } = require('../out/context');
  assert.deepEqual(run(read('fichiers_test/tstpgm.rpgle'), loadContextFromFolder(path.join(ROOT, 'context'))), [
    '--- DEBUT DES TESTS ---',
    'Succes - Valeur : 1500.50',
    '--- FIN DES TESTS ---',
  ]);
});
