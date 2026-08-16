const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Constraints = require('../js/ui/ConstraintManager.js');
const Priorities = require('../js/ui/PrioritySelector.js');
const Technologies = require('../js/ui/TechnologySelector.js');
const Requirements = require('../js/ui/RequirementForm.js');
const Recommendations = require('../js/ui/ResultRecommendations.js');

const html = fs.readFileSync('index.html', 'utf8');

// ===== Contraintes =====

test('a constraint is active only when it departs from its default', () => {
  const diameter = Constraints.descriptor('max_diameter');
  assert.equal(Constraints.isActive(diameter, ''), false);
  assert.equal(Constraints.isActive(diameter, '80'), true);

  // Un champ dont le défaut est une valeur ne devient une contrainte qu'une
  // fois modifié : « ≤ 4 étages » est le réglage d'usine, pas une contrainte.
  const stages = Constraints.descriptor('etages');
  assert.equal(Constraints.isActive(stages, '4'), false);
  assert.equal(Constraints.isActive(stages, '2'), true);

  // Une case cochée par défaut ne produit pas de chip permanent.
  const reduction = Constraints.descriptor('reduction_only');
  assert.equal(Constraints.isActive(reduction, true), false);
  assert.equal(Constraints.isActive(reduction, false), true);
});

test('every catalogued constraint targets a control that really exists', () => {
  for (const entry of Constraints.CATALOG) {
    assert.match(html, new RegExp(`id="${entry.field}"`), `#${entry.field} absent du DOM`);
    assert.ok(entry.name, entry.field + ' sans libellé accessible');
    assert.ok(Constraints.CATEGORIES.some(c => c.id === entry.category), entry.field + ' : catégorie inconnue');
  }
});

test('an old saved configuration materialises as chips, with no migration code', () => {
  // C'est le scénario §20 : maxDiameter=80 dans une URL partagée.
  const state = { max_diameter: '80', minimum_efficiency: '0.92', etages: '2' };
  const active = Constraints.activeConstraints(state);
  assert.deepEqual(active.map(c => c.field).sort(), ['etages', 'max_diameter', 'minimum_efficiency']);
  assert.equal(active.find(c => c.field === 'max_diameter').text, 'Ø max 80 mm');
  // Le rendement se lit en pourcentage, pas en fraction.
  assert.equal(active.find(c => c.field === 'minimum_efficiency').text, 'Rendement ≥ 92 %');
});

test('the constraint menu never offers what is already active', () => {
  const before = Constraints.available({});
  const dimensions = before.find(group => group.id === 'dimensions');
  assert.ok(dimensions.entries.some(entry => entry.field === 'max_diameter'));

  const after = Constraints.available({ max_diameter: '80' });
  const afterDimensions = after.find(group => group.id === 'dimensions');
  assert.ok(!afterDimensions.entries.some(entry => entry.field === 'max_diameter'));
});

test('constraints follow the objective: linear and rotary never mix', () => {
  const rotary = Constraints.available({}, { linear: false });
  const linear = Constraints.available({}, { linear: true });
  const fields = groups => groups.reduce((list, g) => list.concat(g.entries.map(e => e.field)), []);
  assert.ok(fields(rotary).includes('rpm_sortie_min'));
  assert.ok(!fields(rotary).includes('linear_force_min'));
  assert.ok(fields(linear).includes('linear_force_min'));
  assert.ok(!fields(linear).includes('rpm_sortie_min'));
  // Une contrainte hors contexte n'est pas non plus affichée comme active.
  assert.equal(Constraints.activeConstraints({ linear_force_min: '200' }, { linear: false }).length, 0);
});

// ===== Priorités =====

test('each priority is a complete, coherent preset', () => {
  for (const priority of Priorities.PRIORITIES) {
    assert.ok(priority.label && priority.help, priority.id + ' incomplet');
    assert.ok(priority.searchMode, priority.id + ' sans mode de recherche');
    for (const key of Priorities.WEIGHTS) {
      assert.ok(Number.isFinite(priority.weights[key]), priority.id + '.' + key);
    }
  }
});

test('a priority is detected from the controls, and anything else is Personnalisé', () => {
  const compact = Priorities.byId('compact');
  assert.equal(Priorities.match(compact.weights, compact.searchMode), 'compact');
  // Un seul curseur déplacé suffit à sortir du preset.
  assert.equal(Priorities.match({ ...compact.weights, cost: 1 }, compact.searchMode), null);
  // Les poids d'un preset avec le mode d'un autre ne sont pas ce preset.
  assert.equal(Priorities.match(compact.weights, 'efficiency'), null);
});

test('the shipped defaults match a named priority, never Personnalisé', () => {
  // Sinon le premier chargement afficherait « Personnalisé » sans que personne
  // n'ait rien personnalisé.
  const weights = {};
  for (const key of Priorities.WEIGHTS) {
    const match = html.match(new RegExp(`id="weight_${key}"[^>]*value="(\\d+)"`));
    assert.ok(match, `weight_${key} sans valeur par défaut`);
    weights[key] = Number(match[1]);
  }
  const searchMode = (html.match(/id="search_mode"[\s\S]*?<option value="([^"]+)"/) || [])[1];
  assert.equal(Priorities.match(weights, searchMode), 'recommended');
});

// ===== Technologies =====

test('automatic means every compatible family, and says so', () => {
  const rotary = Technologies.automaticFor('ratio');
  assert.ok(rotary.length >= 8);
  assert.ok(!rotary.includes('rack'), 'la crémaillère relève du solveur linéaire');
  assert.deepEqual(Technologies.automaticFor('rotationTranslation'), ['rack']);

  assert.equal(Technologies.summarize(rotary, 'ratio').automatic, true);
  assert.equal(Technologies.summarize(rotary, 'ratio').label, 'Automatique');
});

test('a manual restriction is summarised without opening the panel', () => {
  assert.equal(Technologies.summarize(['spur'], 'ratio').label, 'Engrenage droit');
  assert.equal(Technologies.summarize(['spur', 'helical'], 'ratio').label, 'Engrenage droit + 1 autre');
  assert.equal(Technologies.summarize(['spur', 'helical', 'worm'], 'ratio').label, 'Engrenage droit + 2 autres');
  const empty = Technologies.summarize([], 'ratio');
  assert.equal(empty.automatic, false);
  assert.equal(empty.count, 0);
});

// ===== Objectifs =====

test('« vitesse + couple » is the speed objective plus a torque constraint', () => {
  // Le moteur ne connaît que trois modes : le quatrième objectif de l'interface
  // est un mode existant assorti d'une contrainte, et c'est explicite.
  const modes = Requirements.OBJECTIVES.map(o => o.mode);
  assert.deepEqual([...new Set(modes)].sort(), ['need', 'ratio', 'rotationTranslation']);
  assert.equal(Requirements.byId('needTorque').mode, 'need');
  assert.equal(Requirements.byId('needTorque').requires, 'minimum_output_torque');

  assert.equal(Requirements.activeObjective('need', false), 'need');
  assert.equal(Requirements.activeObjective('need', true), 'needTorque');
  assert.equal(Requirements.activeObjective('ratio', true), 'ratio');
  assert.equal(Requirements.activeObjective('rotationTranslation', false), 'rotationTranslation');
});

// ===== Recommandations =====

function solution(overrides) {
  return Object.assign({
    stages: [{ type: 'spur' }], efficiency: 0.95, errorPercent: 0.2,
    dimensions: { x: 100, y: 50, z: 10, maxDiameter: 50, length: 100 },
    score: { value: 0.3 }, mechanical: [{ bending: { safetyFactor: 2 } }]
  }, overrides);
}

test('badges name the best of each criterion, on the calculated pool', () => {
  const pool = [
    solution({ score: { value: 0.5 } }),
    solution({ score: { value: 0.1 }, dimensions: { x: 300, y: 90, z: 20, maxDiameter: 90 } }),
    solution({ efficiency: 0.99, score: { value: 0.4 } }),
    solution({ dimensions: { x: 20, y: 10, z: 5, maxDiameter: 10 }, score: { value: 0.6 } })
  ];
  const annotation = Recommendations.annotate(pool);
  assert.equal(annotation.best.recommended, 1);   // meilleur score
  assert.equal(annotation.best.efficient, 2);     // meilleur rendement
  assert.equal(annotation.best.compact, 3);       // plus petit volume
  assert.ok(annotation.byIndex[1].includes('recommended'));
});

test('one solution can carry several badges, and is listed once', () => {
  const pool = [
    solution({ score: { value: 0.1 }, efficiency: 0.99, dimensions: { x: 10, y: 10, z: 5, maxDiameter: 10 } }),
    solution({ score: { value: 0.9 } })
  ];
  const annotation = Recommendations.annotate(pool);
  assert.ok(annotation.byIndex[0].length >= 3, 'la même solution cumule les badges');
  assert.deepEqual(annotation.order, [0], 'aucune carte dupliquée');
});

test('robustness ignores solutions whose safety factor was never evaluated', () => {
  const pool = [
    solution({ mechanical: [{}], score: { value: 0.1 } }),                       // courroie : pas de SF
    solution({ mechanical: [{ bending: { safetyFactor: 3 } }], score: { value: 0.9 } })
  ];
  assert.equal(Recommendations.annotate(pool).best.robust, 1);
});

test('an empty pool produces no badge and no crash', () => {
  const annotation = Recommendations.annotate([]);
  assert.deepEqual(annotation.order, []);
  assert.deepEqual(annotation.best, {});
});

test('every proposal is justified in plain language', () => {
  assert.match(Recommendations.explain(solution(), ['recommended']), /compromis/i);
  assert.match(Recommendations.explain(solution(), ['compact']), /encombrement/i);
  // Sans badge, la justification décrit ce qui a été mesuré.
  const plain = Recommendations.explain(solution({ errorPercent: 2.4, efficiency: 0.9 }), []);
  assert.match(plain, /2\.4 %/);
  assert.match(plain, /rendement 90 %/);
});
