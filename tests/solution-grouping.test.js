const test = require('node:test');
const assert = require('node:assert/strict');
const Grouping = require('../js/core/SolutionGrouping.js');

const solution = (types, cost, extra) => Object.assign({
  stages: types.map(type => ({ type })),
  score: { value: cost },
  errorPercent: 0.1, efficiency: 0.9, dimensions: { maxDiameter: 100 }
}, extra || {});

test('solutions that differ only by a few teeth land in one group', () => {
  // Soixante « Droit → Droit » à la suite remplissent trois pages sans rien
  // apprendre : ce qui distingue deux lignes n'est pas Z20/60 contre Z18/54.
  // La famille la plus nombreuse est vue EN PREMIER dans le vivier, et la
  // meilleure solution appartient à l'autre : l'ordre d'apparition et l'ordre
  // de qualité sont donc opposés, ce qu'il faut pour vérifier lequel gagne.
  const pool = [
    solution(['spur', 'spur'], 0.44), solution(['spur', 'spur'], 0.34),
    solution(['worm', 'belt'], 0.41), solution(['spur', 'spur'], 0.38),
    solution(['worm', 'belt'], 0.19)
  ];
  const groups = Grouping.group(pool);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(entry => entry.count), [2, 3]);
  // L'ordre des groupes suit leur MEILLEURE : c'est la seule mise en ordre qui
  // ne contredise pas la liste complète.
  assert.deepEqual(groups[0].types, ['worm', 'belt']);
  assert.ok(Grouping.costOf(groups[0].best) < Grouping.costOf(groups[1].best));
  assert.equal(groups[0].best.score.value, 0.19);
});

test('a group keeps every one of its variants, in the same order as the full list', () => {
  const pool = [solution(['spur'], 0.7), solution(['spur'], 0.2), solution(['spur'], 0.5)];
  const groups = Grouping.group(pool);
  assert.equal(groups.length, 1);
  // Déplier doit donner la même hiérarchie que la liste complète, sinon la
  // deuxième ligne d'un groupe ne voudrait rien dire.
  assert.deepEqual(groups[0].members.map(item => item.solution.score.value), [0.2, 0.5, 0.7]);
  // Et rien n'est perdu : un groupe garde toutes ses solutions.
  assert.equal(groups[0].members.length, pool.length);
  assert.equal(groups[0].best, groups[0].members[0].solution);
});

test('a group remembers where each solution sits in the pool', () => {
  // Le contrat de sélection transporte la position d'origine : un groupe qui
  // renumérote ses membres ferait ouvrir une autre solution que celle qu'on a
  // cliquée.
  const pool = [solution(['spur'], 0.5), solution(['worm'], 0.2), solution(['spur'], 0.1)];
  const groups = Grouping.group(pool, { indices: [10, 11, 12] });
  const spur = groups.filter(entry => entry.key === 'spur')[0];
  assert.deepEqual(spur.members.map(item => item.index), [12, 10]);
  assert.equal(spur.bestIndex, 12);
  // Sans table d'index, la position locale fait foi.
  assert.equal(Grouping.group(pool)[0].bestIndex, 2);
});

test('the order of the stages is part of the architecture', () => {
  // « Vis puis courroie » et « courroie puis vis » ne sont pas le même
  // mécanisme : les confondre regrouperait deux choses qu'on cherche justement
  // à distinguer.
  const groups = Grouping.group([solution(['worm', 'belt'], 0.3), solution(['belt', 'worm'], 0.4)]);
  assert.equal(groups.length, 2);
  assert.equal(Grouping.keyOf(solution(['worm', 'belt'], 0)), 'worm>belt');
  assert.notEqual(Grouping.keyOf(solution(['worm', 'belt'], 0)), Grouping.keyOf(solution(['belt', 'worm'], 0)));
  // Un étage de plus, c'est une autre architecture.
  assert.equal(Grouping.group([solution(['spur'], 0.3), solution(['spur', 'spur'], 0.4)]).length, 2);
});

test('a group says how far apart its variants are', () => {
  // C'est l'étendue qui dit s'il vaut la peine de déplier : vingt-six variantes
  // dans 0,02 % d'écart ne demandent pas d'être lues une à une ; deux qui vont
  // de 85 à 94 % de rendement, si.
  const groups = Grouping.group([
    solution(['spur'], 0.2, { errorPercent: 0.01, efficiency: 0.94, dimensions: { maxDiameter: 80 } }),
    solution(['spur'], 0.5, { errorPercent: 0.40, efficiency: 0.85, dimensions: { maxDiameter: 120 } })
  ]);
  const spread = groups[0].spread;
  assert.ok(Math.abs(spread.error.span - 0.39) < 1e-9);
  assert.ok(Math.abs(spread.efficiency.min - 0.85) < 1e-9);
  assert.ok(Math.abs(spread.efficiency.max - 0.94) < 1e-9);
  assert.equal(spread.diameter.span, 40);
  // Une seule variante n'a pas d'étendue : c'est `null`, et non zéro, parce
  // qu'il n'y a rien à comparer.
  assert.equal(Grouping.group([solution(['spur'], 0.2)])[0].spread, null);
});

test('a missing measurement is not a measurement of zero', () => {
  const groups = Grouping.group([
    solution(['spur'], 0.2, { efficiency: null }),
    solution(['spur'], 0.3, { efficiency: undefined })
  ]);
  assert.equal(groups[0].spread.efficiency, null);
  // Les autres grandeurs restent mesurées.
  assert.ok(groups[0].spread.error);
  // Une solution sans score ne fait pas passer un groupe devant les autres.
  const mixed = Grouping.group([solution(['worm'], 0.9), solution(['spur'], NaN)]);
  assert.deepEqual(mixed.map(entry => entry.key), ['worm', 'spur']);
});

test('an empty pool yields no group rather than throwing', () => {
  assert.deepEqual(Grouping.group([]), []);
  assert.deepEqual(Grouping.group(null), []);
  // Une solution sans étage a une architecture vide, et c'en est une.
  const empty = Grouping.group([{ stages: [], score: { value: 1 } }]);
  assert.equal(empty.length, 1);
  assert.deepEqual(empty[0].types, []);
});
