const test = require('node:test');
const assert = require('node:assert/strict');
const Selection = require('../js/visualization/core/Selection.js');

test('the most precise thing under the cursor wins', () => {
  // Une roue vit dans un groupe d'étage, sur un arbre : cliquer dessus trouve
  // les trois. Sans règle de priorité, tout clic répondrait « étage », puisque
  // l'étage englobe tout le reste — c'est exactement ce que faisait le dessin.
  const found = { stage: '1', member: 's1-output', shaft: 'shaft-2', mesh: null };
  assert.equal(Selection.resolve(found).type, 'member');
  assert.equal(Selection.resolve({ stage: '1', shaft: 'shaft-2' }).type, 'shaft');
  assert.equal(Selection.resolve({ stage: '1' }).type, 'stage');
  // L'engrènement l'emporte même sur la roue : sa poignée est posée sur la
  // zone de contact, et l'y viser ne peut vouloir dire qu'une chose.
  assert.equal(Selection.resolve({ stage: '1', member: 's1-output', mesh: 'm1' }).type, 'mesh');
  // Rien sous le curseur, c'est l'ENSEMBLE — une valeur, pas une absence.
  assert.equal(Selection.resolve({}).type, null);
  assert.equal(Selection.resolve(null).type, null);
});

test('a view only answers with what it can actually show', () => {
  const found = { stage: '2', member: 's2-input', shaft: 'shaft-3' };
  // Une vue qui ne dessine pas les arbres ne doit pas pouvoir en désigner un.
  assert.equal(Selection.resolve(found, { only: ['stage', 'member'] }).type, 'member');
  assert.equal(Selection.resolve(found, { only: ['stage'] }).type, 'stage');
  assert.equal(Selection.resolve(found, { only: [] }).type, null);
});

test('a selection carries the stage it belongs to, and a shaft may have none', () => {
  const member = Selection.resolve({ stage: '2', member: 's2-input' });
  assert.equal(member.stageIndex, 2);
  assert.equal(Selection.stageOf(member), 2);
  // Désigner une roue désigne aussi l'étage où elle se trouve : les commandes
  // qui ne connaissent qu'un étage — cadrer, éditer — continuent de marcher.
  assert.equal(Selection.stageOf(Selection.of('stage', 3, { stageIndex: 3 })), 3);
  // Un arbre traverse plusieurs étages : il peut n'en désigner aucun, et
  // prétendre le contraire ferait cadrer sur un étage choisi au hasard.
  const shaft = Selection.resolve({ shaft: 'shaft-2' });
  assert.equal(shaft.stageIndex, null);
  assert.equal(Selection.stageOf(shaft), -1);
  assert.equal(Selection.stageOf(Selection.none()), -1);
  // Une abscisse d'étage absurde ne devient pas un étage.
  assert.equal(Selection.of('member', 'x', { stageIndex: -1 }).stageIndex, null);
  assert.equal(Selection.of('member', 'x', { stageIndex: 'deux' }).stageIndex, null);
});

test('five satellites bearing one member id are five different things', () => {
  const first = Selection.resolve({ stage: '0', member: 's0-P', instance: '0' });
  const third = Selection.resolve({ stage: '0', member: 's0-P', instance: '2' });
  assert.equal(first.instance, 0);
  assert.equal(third.instance, 2);
  // Sans le numéro d'exemplaire, en désigner un les allumerait tous les cinq.
  assert.ok(!Selection.same(first, third));
  assert.ok(Selection.same(first, Selection.resolve({ stage: '0', member: 's0-P', instance: '0' })));
});

test('two selections are the same only when they designate the same thing', () => {
  const a = Selection.of('member', 's1-input', { stageIndex: 1 });
  assert.ok(Selection.same(a, Selection.of('member', 's1-input', { stageIndex: 1 })));
  // Le type compte : un arbre nommé comme un organe n'est pas cet organe.
  assert.ok(!Selection.same(a, Selection.of('shaft', 's1-input')));
  assert.ok(!Selection.same(a, Selection.of('member', 's1-output', { stageIndex: 1 })));
  // Deux « ensembles » sont le même ensemble.
  assert.ok(Selection.same(Selection.none(), Selection.none()));
  assert.ok(Selection.same(null, undefined));
  assert.ok(!Selection.same(a, Selection.none()));
});

test('an unknown type is not a selection', () => {
  // Une vue qui inventerait un type ne doit pas pouvoir poser une sélection
  // que personne ne saura relire.
  assert.equal(Selection.of('roue', 'x').type, null);
  assert.equal(Selection.of(null, 'x').type, null);
  assert.equal(Selection.resolve({ roue: 'x' }).type, null);
  // Et les types déclarés sont exactement ceux que les vues savent poser.
  assert.deepEqual(Selection.TYPES, ['mesh', 'member', 'shaft', 'stage']);
  Selection.TYPES.forEach(type => assert.ok(Selection.ATTRIBUTES[type], type));
});

test('a selection says in French what it designates', () => {
  assert.equal(Selection.describe(Selection.none()), 'Ensemble');
  assert.equal(Selection.describe(Selection.of('member', 'a')), 'Organe');
  assert.equal(Selection.describe(Selection.of('shaft', 'a')), 'Arbre');
  assert.equal(Selection.describe(Selection.of('mesh', 'a')), 'Engrènement');
  assert.equal(Selection.describe(Selection.of('stage', 0)), 'Étage');
});
