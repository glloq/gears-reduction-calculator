const test = require('node:test');
const assert = require('node:assert/strict');
const Evaluator = require('../js/requirements/SolutionEvaluator.js');
const Preferences = require('../js/requirements/PreferenceModel.js');
const Filter = require('../js/ui/SolutionFilter.js');
const Engineering = require('../js/core/Engineering.js');
const Search = require('../js/core/SearchEngine.js');
const Quantity = require('../js/requirements/Quantity.js');

// ===== UNE SEULE VÉRITÉ DÉCISIONNELLE =====
//
// L'application savait produire deux classements différents et les montrait
// tous les deux sans le dire. `solution.score.value` est l'indice ABSOLU
// d'Engineering — huit pénalités, calculées pour une solution seule.
// `SolutionEvaluator` construit le classement DÉCISIONNEL — normalisé sur le
// vivier, pondéré par les priorités, restreint au front de Pareto pour élire
// la recommandée. Le menu « Trier par → Recommandé » utilisait le premier pour
// nommer le second : la première carte de la liste pouvait donc ne pas être
// celle qui portait le badge ★.
//
// Ce fichier tient l'invariant : ce que l'écran appelle « recommandé » est ce
// que le moteur de décision appelle recommandé, partout.

function rotary(overrides) {
  return Object.assign({
    stages: [{ type: 'spur' }], efficiency: 0.94, errorPercent: 0.3,
    dimensions: { x: 70, y: 70, z: 20, maxDiameter: 70, length: 70, width: 20 },
    mechanical: [{ bending: { safetyFactor: 2 }, contact: { safetyFactor: 2 } }],
    score: { value: 0.5, metrics: {} }, warnings: []
  }, overrides || {});
}

test('sorting by « recommended » puts the recommended solution first', () => {
  // L'indice technique est délibérément à CONTRE-SENS du classement
  // décisionnel : c'est le cas qui révélait le défaut.
  const pool = [
    rotary({ efficiency: 0.90, errorPercent: 1.2, dimensions: { x: 90, y: 90, z: 30, maxDiameter: 90 },
      score: { value: 0.01, metrics: {} } }),
    rotary({ efficiency: 0.97, errorPercent: 0.05, dimensions: { x: 55, y: 55, z: 18, maxDiameter: 55 },
      score: { value: 0.99, metrics: {} } })
  ];
  const decision = Evaluator.evaluate(pool, new Preferences.PreferenceModel());
  assert.equal(decision.recommended, 1, 'la seconde est meilleure sur tous les axes');

  const view = Filter.apply(pool, { sort: 'recommended', decision: decision });
  assert.equal(view[0].index, decision.recommended,
    'la première ligne triée n’est pas la solution recommandée');

  // Et l'indice technique reste accessible — sous son nom, avec son ordre.
  const technical = Filter.apply(pool, { sort: 'technical', decision: decision });
  assert.equal(technical[0].index, 0, 'l’indice technique ne classe plus par lui-même');

  // `score` était le nom du tri « Recommandé » : il doit continuer de le
  // désigner, sans quoi un lien partagé ou une préférence stockée changerait
  // silencieusement de sens.
  assert.equal(Filter.apply(pool, { sort: 'score', decision: decision })[0].index, decision.recommended);
});

test('the decision rank is a total order, and rank 1 is the recommended one', () => {
  const pool = [rotary({ efficiency: 0.9 }), rotary({ efficiency: 0.95 }), rotary({ efficiency: 0.99 })];
  const decision = Evaluator.evaluate(pool, new Preferences.PreferenceModel());
  const ranks = Object.keys(decision.rank).map(k => decision.rank[k]).sort((a, b) => a - b);
  assert.deepEqual(ranks, [1, 2, 3], 'les rangs ne couvrent pas le vivier');
  assert.equal(decision.rank[decision.recommended], 1);
});

test('the order of the pool does not change the verdict', () => {
  // Un classement qui dépendrait de l'ordre d'arrivée ne serait pas un
  // classement : deux recherches identiques donneraient deux réponses.
  const a = rotary({ efficiency: 0.90, errorPercent: 0.8 });
  const b = rotary({ efficiency: 0.97, errorPercent: 0.1, dimensions: { x: 60, y: 60, z: 18, maxDiameter: 60 } });
  const c = rotary({ efficiency: 0.93, errorPercent: 0.4, dimensions: { x: 80, y: 80, z: 22, maxDiameter: 80 } });
  const straight = Evaluator.evaluate([a, b, c], new Preferences.PreferenceModel());
  const shuffled = Evaluator.evaluate([c, a, b], new Preferences.PreferenceModel());
  assert.equal([a, b, c][straight.recommended], [c, a, b][shuffled.recommended],
    'la recommandée dépend de l’ordre d’entrée');
});

// ===== ROBUSTESSE : DEUX CONTRÔLES, ET CE QUI N'A PAS ÉTÉ VÉRIFIÉ =====

test('robustness is the weakest margin, not the best bending factor', () => {
  // Le cas de l'audit : A a le meilleur SF et la pire marge réelle.
  const A = rotary({ mechanical: [{ bending: { safetyFactor: 3.0 }, contact: { safetyFactor: 1.12 } }] });
  const B = rotary({ mechanical: [{ bending: { safetyFactor: 2.2 }, contact: { safetyFactor: 2.0 } }] });
  const seenA = Evaluator.robustness(A), seenB = Evaluator.robustness(B);
  assert.equal(seenA.critical, 'contact', 'le maillon faible de A est le contact');
  assert.ok(seenB.margin > seenA.margin,
    'B (' + seenB.margin.toFixed(2) + ') devrait être plus robuste que A (' + seenA.margin.toFixed(2) + ')');

  const decision = Evaluator.evaluate([A, B], new Preferences.PreferenceModel({ primary: 'robust' }));
  assert.equal(decision.best.robust === undefined ? null : decision.best.robust,
    decision.best.robust === undefined ? null : 1, 'le badge « plus robuste » doit aller à B');
});

test('an unverified check never wins the robustness badge, but stays on the front', () => {
  // Non vérifié n'est pas conforme, et n'est pas non plus disqualifiant : la
  // solution reste classable, elle ne remporte simplement pas le titre.
  const verified = rotary({ mechanical: [{ bending: { safetyFactor: 1.6 }, contact: { safetyFactor: 1.4 } }] });
  const partial = rotary({
    efficiency: 0.99, errorPercent: 0.01, dimensions: { x: 40, y: 40, z: 12, maxDiameter: 40 },
    mechanical: [{ bending: { safetyFactor: 9 }, contact: null }]
  });
  assert.equal(Evaluator.certifiedSafety(partial), null, 'un contrôle manquant doit rester inconnu');
  assert.ok(Number.isFinite(Evaluator.robustness(partial).margin), 'mais la marge connue reste lisible');
  assert.ok(Evaluator.robustness(partial).unknown.length, 'et l’incertitude est nommée');

  const decision = Evaluator.evaluate([verified, partial], new Preferences.PreferenceModel({ primary: 'robust' }));
  assert.notEqual(decision.best.robust, 1, 'la solution non vérifiée a gagné « plus robuste »');
  assert.ok(decision.front.includes(1), 'elle a en revanche le droit de rester sur le front');
});

// ===== LE LINÉAIRE PARLE LA MÊME LANGUE =====

test('a linear solution carries the same eight-metric index as a rotary one', () => {
  // `value` valait l'erreur de course, et trois métriques tenaient lieu des
  // huit annoncées. Deux nombres nommés pareil ne mesuraient pas la même chose.
  const linear = Search.search({
    objectiveMode: 'rotationTranslation', typesActifs: ['rack'], courseCible: 60, precisionToleree: 5,
    maxEtages: 1, maxIterations: 20000, moduleMode: 'automatic', dentMenanteMin: 15, dentMenanteMax: 30,
    vitesseEntree: 1500, coupleEntree: 10, typeParameters: { rack: {} }, constraints: {},
    manufacturing: { minimumTeeth: 1, minimumFaceWidth: 1 }
  }).solutions[0];
  assert.ok(linear, 'aucune solution linéaire produite');
  const rotarySolution = Engineering.analyzeSolution(
    [{ type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } }],
    3, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  assert.deepEqual(Object.keys(linear.score.metrics).sort(), Object.keys(rotarySolution.score.metrics).sort());
  // Et la provenance suit : bruit, coût et fabrication restent des estimations.
  ['noise', 'cost', 'manufacturing'].forEach(key => {
    assert.equal(linear.score.metrics[key].confidence, 'low', key);
    assert.equal(linear.score.metrics[key].source, 'heuristic', key);
  });
});

// ===== LES CRITÈRES DÉCLARÉS SONT RÉELLEMENT LISIBLES =====

test('every declared preference criterion reads something on a solution that has it', () => {
  // `linearSpeed` lisait `linearSpeedMmMin`, qui est le nom porté par la
  // GÉOMÉTRIE d'un étage — jamais par une solution. Le critère ne récoltait
  // donc qu'`undefined`, silencieusement, et la préférence était sans effet.
  const linear = Search.search({
    objectiveMode: 'rotationTranslation', typesActifs: ['rack'], courseCible: 60, precisionToleree: 5,
    maxEtages: 1, maxIterations: 20000, moduleMode: 'automatic', dentMenanteMin: 15, dentMenanteMax: 30,
    vitesseEntree: 1500, coupleEntree: 10, typeParameters: { rack: {} }, constraints: {},
    manufacturing: { minimumTeeth: 1, minimumFaceWidth: 1 }
  }).solutions[0];
  const rotarySolution = Engineering.analyzeSolution(
    [{ type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } }],
    3, { inputSpeedRpm: 1500, inputTorqueNm: 10 });

  const missing = [];
  Preferences.CRITERIA.forEach(meta => {
    const host = meta.linear ? linear : rotarySolution;
    const value = meta.metric(host);
    if (value === undefined) missing.push(meta.key + ' (' + (meta.linear ? 'linéaire' : 'rotatif') + ')');
  });
  assert.deepEqual(missing, [], 'critères déclarés mais illisibles');
});

test('a stated preference on output force reaches the Pareto front', () => {
  // Une préférence pouvait peser sur le score final alors que la solution
  // qu'elle servait avait déjà été écartée du front, dominée sur les autres
  // axes. Le front doit connaître ce qu'on lui demande.
  const weak = { mode: 'rotationTranslation', stages: [{ type: 'rack' }], efficiency: 0.97, errorPercent: 0.1,
    dimensions: { x: 40, y: 40, z: 12, maxDiameter: 40 }, outputForceN: 300,
    outputLinearSpeedMmMin: 4000, mechanical: [{}], score: { value: 0.2, metrics: {} }, warnings: [] };
  const strong = { mode: 'rotationTranslation', stages: [{ type: 'rack' }], efficiency: 0.96, errorPercent: 0.4,
    dimensions: { x: 80, y: 80, z: 20, maxDiameter: 80 }, outputForceN: 1800,
    outputLinearSpeedMmMin: 9000, mechanical: [{}], score: { value: 0.4, metrics: {} }, warnings: [] };

  const blind = Evaluator.evaluate([weak, strong], new Preferences.PreferenceModel());
  assert.deepEqual(blind.front, [0], 'sans axe de force, la solution puissante est dominée');

  const asked = new Preferences.PreferenceModel().require('outputForce', Quantity.atLeast(1500, 'N'), true);
  const aware = Evaluator.evaluate([weak, strong], asked);
  assert.ok(aware.objectives.includes('force'), 'la force n’est pas devenue un axe');
  assert.ok(aware.front.includes(1), 'la solution qui répond à la demande reste écartée du front');
});

test('a range preference becomes a distance-to-range axis, not a direction', () => {
  // Une vitesse linéaire demandée « entre X et Y » n'a pas de sens
  // d'amélioration : ce qui se minimise, c'est l'écart à la plage.
  const inside = { mode: 'rotationTranslation', stages: [{ type: 'rack' }], efficiency: 0.9, errorPercent: 0.6,
    dimensions: { x: 90, y: 90, z: 25, maxDiameter: 90 }, outputLinearSpeedMmMin: 6000,
    mechanical: [{}], score: { value: 0.5, metrics: {} }, warnings: [] };
  const outside = { mode: 'rotationTranslation', stages: [{ type: 'rack' }], efficiency: 0.98, errorPercent: 0.05,
    dimensions: { x: 40, y: 40, z: 12, maxDiameter: 40 }, outputLinearSpeedMmMin: 20000,
    mechanical: [{}], score: { value: 0.1, metrics: {} }, warnings: [] };
  const asked = new Preferences.PreferenceModel().require('linearSpeed', Quantity.between(5000, 7000, 'mm/min'), true);
  const aware = Evaluator.evaluate([inside, outside], asked);
  assert.ok(aware.objectives.includes('req:linearSpeed'), 'la plage demandée n’est pas un axe');
  assert.ok(aware.front.includes(0), 'la seule solution dans la plage est absente du front');
});
