const test = require('node:test');
const assert = require('node:assert/strict');
const Assessment = require('../js/requirements/DecisionAssessment.js');
const Preferences = require('../js/requirements/PreferenceModel.js');
const Engineering = require('../js/core/Engineering.js');

// ===== LE VERDICT, ASSEMBLÉ UNE FOIS =====
//
// Sept endroits jugeaient le même réducteur : le moteur, le front de Pareto,
// la conformité, les préférences, la carte, la bande d'identité, le tableau.
// Ce fichier tient ce que la couche unique doit garantir à tous.

function spur(teeth, module, target) {
  return Engineering.analyzeSolution(
    [{ type: 'spur', input: { teeth: teeth[0] }, output: { teeth: teeth[1] },
       parameters: { module: module, pressureAngle: 20, faceWidth: 20 } }],
    target || 3, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
}

test('the contributions add up to exactly the index they explain', () => {
  // Le mode expert affichait `JSON.stringify(solution.score)`. Une
  // décomposition qui ne se recompose pas expliquerait un autre nombre que
  // celui qui est affiché — ce serait pire que le JSON.
  const built = Assessment.build([spur([15, 45], 2), spur([18, 54], 1.5)],
    { preferences: new Preferences.PreferenceModel() });
  built.entries.forEach(entry => {
    const sum = entry.contributions.reduce((total, item) => total + (item.contribution || 0), 0);
    assert.ok(Math.abs(sum - entry.engineering) < 1e-9,
      'somme ' + sum.toFixed(6) + ' ≠ indice ' + entry.engineering.toFixed(6));
  });
});

test('a heuristic criterion says it is one', () => {
  // Bruit, coût et fabrication ne sont pas calculés : ce sont des estimations
  // qualitatives par famille. Le moteur le sait déjà et le note ; il ne restait
  // qu'à ne plus le perdre en route.
  const entry = Assessment.build([spur([15, 45], 2)], {}).entries[0];
  const byKey = {};
  entry.contributions.forEach(item => { byKey[item.key] = item; });
  ['noise', 'cost', 'manufacturing'].forEach(key => {
    assert.equal(byKey[key].confidence, 'low', key);
    assert.equal(byKey[key].source, 'heuristic', key);
  });
  ['ratio', 'size', 'efficiency'].forEach(key => {
    assert.equal(byKey[key].confidence, 'high', key);
    assert.equal(byKey[key].source, 'calculation', key);
  });
  // Et le facteur dominant est nommé, pour répondre à « pourquoi si bas ? ».
  assert.ok(entry.dominant && entry.dominant.label, 'aucun facteur dominant');
});

test('every card knows what it gains AND what it costs', () => {
  // §9. « Plus compacte. » ne dit que la moitié de ce qu'il faut pour choisir.
  const compact = spur([15, 45], 1.5);
  const strong = spur([15, 45], 3);
  const built = Assessment.build([compact, strong], { preferences: new Preferences.PreferenceModel() });
  const other = built.entries.find(entry => !entry.decision.recommended);
  assert.ok(other, 'aucune alternative à la référence');
  assert.ok(other.strengths.length, 'une alternative sans aucun gain n’est pas une alternative');
  assert.ok(other.compromises.length, 'une alternative sans aucun sacrifice serait la référence');
  // Les deux listes portent un texte lisible, pas un nombre nu.
  other.strengths.concat(other.compromises).forEach(item => {
    assert.match(item.text, /^[+−]/, item.text);
    assert.ok(item.label, 'écart sans nom');
  });
  // La référence, elle, ne se compare pas à elle-même.
  const reference = built.entries.find(entry => entry.decision.recommended);
  assert.deepEqual(reference.strengths, []);
  assert.deepEqual(reference.compromises, []);
});

test('a danger outranks any number of warnings', () => {
  // §13. « Warnings = 3 » ne dit pas si l'une d'elles est un refus.
  const three = { warnings: [
    { code: 'LOW_CONTACT_RATIO', level: 'warning' },
    { code: 'HIGH_AXIAL_LOAD', level: 'warning' },
    { code: 'THERMAL_RISK', level: 'warning' }] };
  const one = { warnings: [{ code: 'LOW_BENDING_SAFETY', level: 'danger' }] };
  assert.ok(Assessment.alerts(one).severity > Assessment.alerts(three).severity,
    'un danger doit primer sur trois réserves');
  assert.equal(Assessment.alerts(one).summary, '✕ 1');
  assert.equal(Assessment.alerts(three).summary, '⚠ 3');
  // Et le plus grave se lit en premier, sans quoi une coupe à trois le cache.
  const mixed = Assessment.alerts({ warnings: [
    { code: 'LOW_CONTACT_RATIO', level: 'warning' },
    { code: 'HIGH_AXIAL_LOAD', level: 'warning' },
    { code: 'THERMAL_RISK', level: 'warning' },
    { code: 'LOW_CONTACT_SAFETY', level: 'danger' }] });
  assert.equal(mixed.list[0].level, 'danger', 'le danger est relégué en quatrième');
});

test('a planetary is not as simple as a spur pair, whatever the stage count says', () => {
  // §10. « Plus simple — le moins d'étages et de pièces » ne comptait que les
  // étages : un planétaire à cinq satellites était aussi simple qu'un couple.
  const pair = Assessment.complexity({ stages: [{ type: 'spur' }] });
  const epicyclic = Assessment.complexity({ stages: [{ type: 'planetary', planetCount: 5 }] });
  assert.ok(epicyclic.value > pair.value,
    'planétaire ' + epicyclic.value + ' contre couple droit ' + pair.value);
  assert.equal(epicyclic.parts, 7, 'solaire + couronne + 5 satellites');
  assert.equal(epicyclic.carriers, 1);
  // Un renvoi conique coûte de l'usinage qu'un couple droit ne coûte pas.
  assert.ok(Assessment.complexity({ stages: [{ type: 'bevel' }] }).machining >
    Assessment.complexity({ stages: [{ type: 'spur' }] }).machining);
});

test('what was not verified is named, and weighs by what it hides', () => {
  // §5. Une grandeur inconnue valait 0,5 dans le front : ni avantage ni
  // pénalité, et surtout invisible.
  const verified = Assessment.build([spur([15, 45], 2)], { constraints: { tolerancePercent: 1 } }).entries[0];
  const belt = Assessment.build([{ stages: [{ type: 'belt' }], efficiency: 0.98, errorPercent: 0.2,
    dimensions: { maxDiameter: 90, length: 200 }, mechanical: [{}], warnings: [],
    score: { value: 0.3, metrics: {} } }], {}).entries[0];
  assert.ok(belt.uncertainty.mechanical.length, 'une courroie sans contrôle doit le dire');
  assert.equal(belt.uncertainty.level, 'high');
  assert.ok(belt.uncertainty.rank > verified.uncertainty.rank,
    'une mécanique non vérifiée doit peser plus qu’une tolérance non demandée');
});

test('two solutions computed under different assumptions are detectable', () => {
  // §19. Les épingles survivent aux recherches : deux colonnes peuvent avoir
  // été calculées sous un couple ou un procédé différents, et comparer leurs
  // SF revient alors à comparer deux mesures prises avec deux étalons.
  const same = spur([15, 45], 2);
  const other = Engineering.analyzeSolution(
    [{ type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } }],
    3, { inputSpeedRpm: 3000, inputTorqueNm: 25 });
  assert.equal(Assessment.fingerprint(same), Assessment.fingerprint(spur([15, 45], 2)),
    'deux calculs identiques doivent avoir la même empreinte');
  assert.notEqual(Assessment.fingerprint(same), Assessment.fingerprint(other));
  const differences = Assessment.contextDifferences(Assessment.fingerprint(same), Assessment.fingerprint(other));
  assert.deepEqual(differences, ['régime d’entrée', 'couple d’entrée']);
});

test('a truncated pool says so, instead of hiding it in a tooltip', () => {
  // §17. Une recommandation calculée sur 400 solutions retenues parmi 8 000
  // valides n'a pas la portée d'une optimisation exhaustive.
  const full = Assessment.scopeOf([1, 2, 3], { valid: 3 });
  assert.equal(full.truncated, false);
  assert.match(full.label, /3 solutions analysées/);
  const cut = Assessment.scopeOf(new Array(400), { valid: 8000 });
  assert.equal(cut.truncated, true);
  assert.match(cut.label, /400/);
  assert.match(cut.label, /8000/);
  assert.match(cut.label, /tronqué/);
});

test('the assessment carries one verdict per solution, and the ranking agrees with it', () => {
  const pool = [spur([15, 45], 2), spur([18, 54], 1.5), spur([20, 60], 3)];
  const built = Assessment.build(pool, { preferences: new Preferences.PreferenceModel() });
  assert.equal(built.entries.length, pool.length);
  const recommended = built.entries.filter(entry => entry.decision.recommended);
  assert.equal(recommended.length, 1, 'zéro ou deux recommandées ne recommandent rien');
  assert.equal(recommended[0].decision.rank, 1, 'la recommandée doit être au rang 1');
  assert.ok(recommended[0].decision.pareto, 'la recommandée doit être sur le front');
  assert.equal(built.reference, recommended[0].solution);
  // Et chaque solution a un rang, une fois.
  const ranks = built.entries.map(entry => entry.decision.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, [1, 2, 3]);
});

// ===== FAMILLE ET CONFIGURATION (§8) =====

const Grouping = require('../js/core/SolutionGrouping.js');

test('two planetary topologies are not the same mechanism', () => {
  // « Épicycloïdal » réunissait un train solaire-entrée / couronne-fixe et un
  // porte-satellites-entrée / solaire-fixe : mêmes dentures, rapports
  // différents, parfois de signe opposé. Ce ne sont pas deux variantes.
  const teeth = { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24 };
  const first = { stages: [Object.assign({}, teeth, { inputMember: 'S', fixed: 'R', outputMember: 'C' })], score: { value: 0.3 } };
  const second = { stages: [Object.assign({}, teeth, { inputMember: 'C', fixed: 'S', outputMember: 'R' })], score: { value: 0.4 } };
  assert.notEqual(Grouping.keyOf(first), Grouping.keyOf(second));
  assert.equal(Grouping.group([first, second]).length, 2, 'les deux topologies sont regroupées');
  // La famille, elle, reste la même : c'est le niveau au-dessus.
  assert.equal(Grouping.familyKeyOf(first), Grouping.familyKeyOf(second));
  // Et la configuration se lit en toutes lettres.
  assert.match(Grouping.describeAll(first), /entrée/);
  assert.notEqual(Grouping.describeAll(first), Grouping.describeAll(second));
});

test('an open belt and a crossed belt stay distinguishable', () => {
  // Croisée, la poulie menée tourne à l'envers.
  const open = { stages: [{ type: 'belt', parameters: {} }], score: { value: 0.2 } };
  const crossed = { stages: [{ type: 'belt', parameters: { crossed: true } }], score: { value: 0.3 } };
  assert.notEqual(Grouping.keyOf(open), Grouping.keyOf(crossed));
  assert.equal(Grouping.group([open, crossed]).length, 2);
  assert.equal(Grouping.describeAll(crossed), 'croisée');
  assert.equal(Grouping.describeAll(open), '', 'le montage par défaut n’a rien à préciser');
});

test('bevel drives at different shaft angles, and worms with different starts, are separated', () => {
  const right = { stages: [{ type: 'bevel', parameters: { shaftAngle: 90 } }], score: { value: 0.3 } };
  const oblique = { stages: [{ type: 'bevel', parameters: { shaftAngle: 45 } }], score: { value: 0.4 } };
  assert.notEqual(Grouping.keyOf(right), Grouping.keyOf(oblique));
  const single = { stages: [{ type: 'worm', wormStarts: 1 }], score: { value: 0.3 } };
  const quad = { stages: [{ type: 'worm', wormStarts: 4 }], score: { value: 0.4 } };
  assert.notEqual(Grouping.keyOf(single), Grouping.keyOf(quad),
    'un filet unique est irréversible, quatre ne le sont pas');
  // Mais deux, trois et quatre filets restent un seul groupe : le nombre de
  // filets est un réglage de RAPPORT, et l'éclater en six lignes défait
  // exactement ce que le regroupement apporte.
  const twin = { stages: [{ type: 'worm', wormStarts: 2 }], score: { value: 0.5 } };
  assert.equal(Grouping.keyOf(twin), Grouping.keyOf(quad));
  // Mais deux dentures différentes d'un même montage restent un seul groupe :
  // c'est tout l'objet du regroupement.
  const a = { stages: [{ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 } }], score: { value: 0.3 } };
  const b = { stages: [{ type: 'spur', input: { teeth: 18 }, output: { teeth: 54 } }], score: { value: 0.4 } };
  assert.equal(Grouping.group([a, b]).length, 1);
});

// ===== CE QUE LES CATÉGORIES PROMETTENT (§11, §12) =====

const Evaluator = require('../js/requirements/SolutionEvaluator.js');

function family(type, efficiency, diameter) {
  return { stages: [{ type: type }], efficiency: efficiency, errorPercent: 0.2,
    dimensions: { x: diameter, y: diameter, z: 20, maxDiameter: diameter },
    mechanical: [{ bending: { safetyFactor: 2 }, contact: { safetyFactor: 2 } }] };
}

test('an alternative answers a priority only when that priority was expressed', () => {
  // §12. « Économique » et « fabricable » se choisissent dans les priorités, et
  // aucune alternative ne répondait jamais à ces mots-là. À l'inverse, les
  // proposer toujours répondrait à une question qu'on n'a pas posée.
  const pool = [family('planetary', 0.97, 50), family('spur', 0.96, 140)];
  const silent = Evaluator.evaluate(pool, new Preferences.PreferenceModel({ primary: 'compact' }));
  assert.equal(silent.best.cheap, undefined, 'une alternative « économique » non demandée');

  const asked = Evaluator.evaluate(pool, new Preferences.PreferenceModel({ primary: 'compact', secondary: 'cheap' }));
  assert.equal(asked.best.cheap, 1, 'la priorité « économique » ne propose aucune alternative');
  assert.equal(Evaluator.label('cheap'), 'Plus économique');
  assert.equal(Evaluator.label('manufacturable'), 'Plus facile à fabriquer');
});

test('an estimated quality does not pretend to be a measurement', () => {
  // §11. « Plus silencieuse » se lisait comme s'il existait un calcul
  // acoustique. Il n'y en a pas : c'est une aptitude moyenne par famille.
  const estimated = Evaluator.CATEGORIES.filter(category => category.estimated).map(category => category.id);
  assert.deepEqual(estimated.sort(), ['cheap', 'manufacturable', 'quiet']);
  assert.match(Evaluator.label('quiet'), /^Potentiellement/);
  // Et les catégories calculées, elles, ne portent pas cette réserve.
  ['compact', 'efficient', 'robust', 'precise'].forEach(id => {
    const category = Evaluator.CATEGORIES.filter(entry => entry.id === id)[0];
    assert.ok(category && !category.estimated, id + ' ne devrait pas être une estimation');
  });
});
