const test = require('node:test');
const assert = require('node:assert/strict');

const Quantity = require('../js/requirements/Quantity.js');
const { RequirementModel } = require('../js/requirements/RequirementModel.js');
const Preferences = require('../js/requirements/PreferenceModel.js');
const Advisor = require('../js/requirements/TransmissionAdvisor.js');
const Compiler = require('../js/requirements/ConstraintCompiler.js');
const Adapter = require('../js/requirements/LegacySearchAdapter.js');
const Evaluator = require('../js/requirements/SolutionEvaluator.js');
const NearMiss = require('../js/requirements/NearMissAnalyzer.js');

// ===== Grandeurs typées (3C) =====

test('a value carries its intent, not just a number', () => {
  assert.equal(Quantity.atMost(80).satisfies(79), true);
  assert.equal(Quantity.atMost(80).satisfies(81), false);
  assert.equal(Quantity.between(20, 40).satisfies(30), true);
  assert.equal(Quantity.between(20, 40).satisfies(41), false);
  // « ≈ 100 » accepte une marge ; « = 100 » ne l'accepte pas.
  assert.equal(Quantity.target(100, 10).satisfies(105), true);
  assert.equal(Quantity.exact(100).satisfies(105), false);
  // Une grandeur inconnue n'exclut rien : c'est ce qui permet une fiche partielle.
  assert.equal(Quantity.unknown().satisfies(1e9), true);
});

test('a range given upside down is still a range', () => {
  const q = Quantity.between(40, 20);
  assert.deepEqual([q.bounds().min, q.bounds().max], [20, 40]);
});

test('free-form input is understood without a mode selector', () => {
  assert.equal(Quantity.parse('20-40').kind, 'range');
  assert.equal(Quantity.parse('>=80').kind, 'min');
  assert.equal(Quantity.parse('≤ 100').kind, 'max');
  assert.equal(Quantity.parse('~100').kind, 'target');
  assert.equal(Quantity.parse('100').kind, 'exact');
  assert.equal(Quantity.parse('').kind, 'unknown');
  assert.equal(Quantity.parse('?').kind, 'unknown');
  // La virgule décimale française ne doit pas produire une plage.
  assert.equal(Quantity.parse('1,5').value, 1.5);
});

test('the shortfall measures how far a value misses, in its own unit', () => {
  assert.equal(Quantity.atMost(80).shortfall(83.6), 3.5999999999999943);
  assert.equal(Quantity.atMost(80).shortfall(70), 0);
  assert.equal(Quantity.atLeast(90).shortfall(85), 5);
});

test('a speed range maps to a ratio range, which no single field could express', () => {
  // 1500 rpm en entrée, 20 → 40 rpm en sortie : le rapport va de 37,5 à 75.
  const ratio = Quantity.between(20, 40).mapLinear(1500, true, ':1');
  assert.equal(ratio.kind, 'range');
  assert.equal(Math.round(ratio.bounds().min * 10) / 10, 37.5);
  assert.equal(ratio.bounds().max, 75);
});

// ===== Déduction du problème (2C) =====

test('the solver mode is deduced, never asked', () => {
  const ratioOnly = new RequirementModel({ ratio: 12 });
  assert.equal(ratioOnly.inferProblem().mode, 'ratio');

  const need = new RequirementModel({ input: { speed: 1500 }, output: { speed: 125 } });
  assert.equal(need.inferProblem().mode, 'need');
  assert.equal(Math.round(need.ratioRequirement().nominal()), 12);

  const linear = new RequirementModel({ input: { speed: 1500 }, output: { travelPerRev: 62.83 } });
  assert.equal(linear.inferProblem().mode, 'rotationTranslation');

  // Sans vitesses, deux couples suffisent à estimer un rapport.
  const byTorque = new RequirementModel({ input: { torque: 2 }, output: { torque: 24 } });
  assert.equal(byTorque.inferProblem().mode, 'ratio');
  assert.equal(byTorque.inferProblem().derivedFrom, 'torque');
  assert.equal(byTorque.ratioRequirement().nominal(), 12);
});

test('an unusable sheet says what is missing instead of failing silently', () => {
  const empty = new RequirementModel({ input: { speed: 1500 } });
  assert.equal(empty.inferProblem().mode, null);
  assert.match(empty.diagnose().find(n => n.level === 'error').text, /vitesse de sortie|rapport|course/);
  assert.equal(empty.isComplete(), false);
});

test('architecture contradictions are caught before any search runs', () => {
  const model = new RequirementModel({ ratio: 12, architecture: { axisAngle: 90, coaxial: 'required' } });
  const error = model.diagnose().find(n => n.code === 'axis-conflict');
  assert.ok(error, 'renvoi d’angle et coaxial doivent être signalés incompatibles');
  assert.equal(model.isComplete(), false);
});

// ===== Contraintes contre préférences (4B) =====

test('a constraint filters, a preference only ranks', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', Quantity.atMost(80));
  const tooBig = { dimensions: { maxDiameter: 90 } };
  assert.equal(prefs.accepts(tooBig), false);

  prefs.toggleSoft('maxDiameter');
  assert.equal(prefs.accepts(tooBig), true, 'une préférence ne doit jamais écarter');
  assert.ok(prefs.penalty(tooBig) > 0, 'mais elle doit coûter au classement');
});

test('an unevaluated metric never disqualifies a solution', () => {
  // Une courroie n'a pas de coefficient de sécurité : l'absence n'est pas un échec.
  const prefs = new Preferences.PreferenceModel();
  prefs.require('bendingSafety', Quantity.atLeast(2));
  assert.equal(prefs.accepts({ mechanical: [{}] }), true);
  assert.equal(prefs.accepts({ mechanical: [{ bending: { safetyFactor: 1.2 } }] }), false);
});

test('two priorities drive the eight engine weights, and nobody touches a slider', () => {
  const prefs = new Preferences.PreferenceModel({ primary: 'compact', secondary: 'quiet' });
  const weights = prefs.weights();
  assert.ok(weights.size > weights.noise, 'la principale doit dominer la secondaire');
  assert.ok(weights.noise > weights.cost, 'la secondaire doit dépasser le socle');
  Preferences.WEIGHT_KEYS.forEach(key => assert.ok(weights[key] > 0, key + ' ne doit jamais être nul'));
  assert.equal(prefs.searchMode(), 'compact');
  assert.equal(prefs.describe(), 'Compact, puis silencieux');
});

// ===== Conseiller (5C) =====

test('automatic no longer means "tick everything"', () => {
  const model = new RequirementModel({ input: { speed: 1500 }, output: { speed: 125 } });
  const advice = Advisor.advise(model, new Preferences.PreferenceModel());
  assert.ok(advice.selection.length > 0);
  assert.ok(advice.selection.length < Advisor.ROTARY.length, 'toutes les familles ne peuvent pas être pertinentes à la fois');
  advice.recommended.concat(advice.possible).forEach(entry => {
    assert.ok(Array.isArray(entry.reasons), entry.id + ' sans justification');
  });
});

test('a required 90° turn puts the angle families first, and says why', () => {
  const model = new RequirementModel({ ratio: 20, architecture: { axisAngle: 90 } });
  const advice = Advisor.advise(model, new Preferences.PreferenceModel());
  const bevel = advice.recommended.concat(advice.possible).find(e => e.id === 'bevel');
  assert.ok(bevel, 'le conique doit rester candidat');
  assert.ok(bevel.reasons.some(r => /renvoi d’angle/.test(r.text)));
  const spur = advice.recommended.concat(advice.possible).find(e => e.id === 'spur');
  assert.ok(spur.score < bevel.score, 'le droit ne réalise pas le renvoi, il doit être moins bien classé');
});

test('back-drivable rules the worm out, and the reason is stated', () => {
  const model = new RequirementModel({ ratio: 40, architecture: { selfLocking: 'forbidden' } });
  const advice = Advisor.advise(model, new Preferences.PreferenceModel());
  const worm = advice.excluded.find(e => e.id === 'worm');
  assert.ok(worm, 'la vis sans fin doit être écartée');
  assert.match(worm.reasons[0].text, /rréversible/);
  assert.ok(!advice.selection.includes('worm'));
});

test('a minimum efficiency excludes the families that cannot reach it', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('efficiency', Quantity.atLeast(90));   // en %
  const advice = Advisor.advise(new RequirementModel({ ratio: 30 }), prefs);
  assert.ok(advice.excluded.some(e => e.id === 'worm'), 'la vis sans fin plafonne bien sous 90 %');
});

test('the advisor reports what its own selection cannot do', () => {
  const model = new RequirementModel({ ratio: 10, architecture: { axisAngle: 90 } });
  const advice = Advisor.advise(model, new Preferences.PreferenceModel());
  const gaps = Advisor.advise(model, new Preferences.PreferenceModel()).coverage;
  assert.ok(Array.isArray(gaps));
  // Si aucune famille perpendiculaire n'est retenue, le manque doit être nommé.
  const perpendicular = advice.selection.some(id => Advisor.KNOWLEDGE[id].axis === 'perpendicular');
  assert.equal(gaps.some(g => g.code === 'angle'), !perpendicular);
});

test('a ratio beyond every family in the stage budget is an honest refusal', () => {
  const model = new RequirementModel({ ratio: 5000, architecture: { maxStages: 1 } });
  const advice = Advisor.advise(model, new Preferences.PreferenceModel());
  assert.ok(advice.excluded.some(e => e.id === 'spur'));
  assert.match(advice.excluded.find(e => e.id === 'spur').reasons[0].text, /étages/);
});

// ===== Compilation (20C) =====

test('the compiler keeps the intent the engine cannot express', () => {
  const model = new RequirementModel({ input: { speed: 1500 }, output: { speed: Quantity.between(20, 40) } });
  const request = Compiler.compile(model, new Preferences.PreferenceModel());
  assert.equal(request.mode, 'need');
  // Le rapport centré ET les bornes dures sont émis : la tolérance oriente,
  // les bornes garantissent.
  assert.equal(Math.round(request.ratio), 56);
  assert.equal(request.constraints.minimumOutputSpeedRpm, 20);
  assert.equal(request.constraints.maximumOutputSpeedRpm, 40);
});

test('a one-sided ratio is flagged rather than silently approximated', () => {
  const model = new RequirementModel({ ratio: Quantity.atLeast(30) });
  const request = Compiler.compile(model, new Preferences.PreferenceModel());
  assert.ok(request.notes.some(n => n.code === 'ratio-open'));
});

test('the strictest of two sources wins, never the last one written', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('outputTorque', Quantity.atLeast(50));
  const model = new RequirementModel({ input: { speed: 1500, torque: 2 }, output: { speed: 125, torque: Quantity.atLeast(80) } });
  const request = Compiler.compile(model, prefs);
  assert.equal(request.constraints.minimumOutputTorqueNm, 80);
});

test('preferences never reach the engine as filters', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', Quantity.atMost(80), true);   // souple
  const request = Compiler.compile(new RequirementModel({ ratio: 12 }), prefs);
  assert.equal(request.constraints.maxDiameter, undefined);
});

test('the adapter produces engine parameters without touching the DOM', () => {
  const model = new RequirementModel({ input: { speed: 3000, torque: 2 }, output: { speed: 100 } });
  const prefs = new Preferences.PreferenceModel({ primary: 'compact' });
  const params = Adapter.toSearchParams(Compiler.compile(model, prefs), { module: 1.5 });
  assert.equal(params.objectiveMode, 'need');
  assert.equal(params.searchMode, 'compact');
  assert.equal(params.vitesseEntree, 3000);
  assert.equal(params.module, 1.5);
  assert.ok(!params.typesActifs.includes('rack'), 'la crémaillère est réservée au linéaire');
  const total = Object.values(params.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'les poids du moteur doivent sommer à 1');
});

test('a linear need reaches the rack solver and only it', () => {
  const model = new RequirementModel({ input: { speed: 1500, torque: 2 }, output: { travelPerRev: 62.83, force: Quantity.atLeast(200) } });
  const request = Compiler.compile(model, new Preferences.PreferenceModel());
  const params = Adapter.toSearchParams(request, {});
  assert.deepEqual(params.typesActifs, ['rack']);
  assert.equal(params.rapportCible, null);
  assert.equal(params.linearTravelPerRevolutionMm, 62.83);
  assert.equal(params.constraints.minimumOutputForceN, 200);
});

// ===== Pareto et catégories (12C) =====

function solution(overrides) {
  return Object.assign({
    stages: [{ type: 'spur' }], efficiency: 0.95, errorPercent: 0.2,
    dimensions: { x: 100, y: 50, z: 10, maxDiameter: 50 },
    mechanical: [{ bending: { safetyFactor: 2 } }]
  }, overrides);
}

test('the front keeps only what nothing else beats on every axis', () => {
  const dominated = solution({ efficiency: 0.90, errorPercent: 1.0, dimensions: { x: 200, y: 80, z: 20, maxDiameter: 80 } });
  const better = solution({ efficiency: 0.97, errorPercent: 0.1, dimensions: { x: 90, y: 40, z: 9, maxDiameter: 40 } });
  const result = Evaluator.evaluate([dominated, better]);
  assert.deepEqual(result.front, [1], 'la solution battue partout doit sortir du front');
});

test('alternatives are shown only when the gain is real', () => {
  const base = solution();
  const marginal = solution({ dimensions: { x: 99.5, y: 50, z: 10, maxDiameter: 50 }, efficiency: 0.951 });
  const result = Evaluator.evaluate([base, marginal]);
  assert.equal(result.best.compact, undefined, '0,5 % d’encombrement n’est pas une alternative');
});

test('a genuinely different compromise is surfaced and named', () => {
  const balanced = solution();
  const tiny = solution({ dimensions: { x: 20, y: 10, z: 5, maxDiameter: 12 }, efficiency: 0.88, errorPercent: 1.4 });
  const result = Evaluator.evaluate([balanced, tiny]);
  assert.equal(result.best.compact, 1);
  assert.ok(result.order.includes(0) && result.order.includes(1));
  assert.match(Evaluator.explain(tiny, ['compact']), /encombrement/);
});

test('robustness ignores solutions whose safety factor was never evaluated', () => {
  const belt = solution({ stages: [{ type: 'belt' }], mechanical: [{}], dimensions: { x: 300, y: 60, z: 12, maxDiameter: 60 } });
  const geared = solution({ mechanical: [{ bending: { safetyFactor: 4 } }] });
  const result = Evaluator.evaluate([belt, geared]);
  assert.notEqual(result.best.robust, 0, 'une courroie sans SF ne peut pas être « la plus robuste »');
});

test('an empty pool produces no category and no crash', () => {
  const result = Evaluator.evaluate([]);
  assert.deepEqual(result.order, []);
  assert.deepEqual(result.front, []);
});

test('a violated constraint is stated on the card, not hidden', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', Quantity.atMost(30));
  const result = Evaluator.evaluate([solution()], prefs);
  assert.equal(result.compliance[0].length, 1);
  assert.match(Evaluator.explain(solution(), [], result.compliance[0]), /Ne respecte pas/);
  assert.match(Evaluator.explain(solution(), [], []), /Respecte toutes les contraintes/);
});

// ===== Relaxation chiffrée (14C) =====

test('no result names the blocker, measures it and quantifies the way out', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', Quantity.atMost(80));
  // Vivier sonde : ce que le moteur trouve SANS la contrainte de diamètre.
  const probe = [
    solution({ dimensions: { x: 100, y: 50, z: 10, maxDiameter: 83.6 } }),
    solution({ dimensions: { x: 110, y: 55, z: 10, maxDiameter: 84 } }),
    solution({ dimensions: { x: 140, y: 70, z: 12, maxDiameter: 120 } })
  ];
  const report = NearMiss.analyze(probe, prefs);
  assert.equal(report.status, 'relaxable');
  assert.equal(report.blocker.key, 'maxDiameter');
  assert.equal(report.blocker.limit, 80);
  assert.equal(report.blocker.achieved, 83.6);
  assert.equal(report.blocker.suggested, 84);
  assert.equal(report.blocker.unlocked, 2, 'deux solutions passent sous 84 mm');
  assert.match(report.text, /83\.6/);
  assert.match(report.text, /84/);
});

test('accepting the suggestion yields a model that really accepts those solutions', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', Quantity.atMost(80));
  const probe = [solution({ dimensions: { x: 100, y: 50, z: 10, maxDiameter: 83.6 } })];
  const report = NearMiss.analyze(probe, prefs);
  assert.equal(report.blocker.preferences.accepts(probe[0]), true);
  assert.equal(prefs.accepts(probe[0]), false, 'le modèle d’origine ne doit pas être muté');
});

test('when even the probe is empty, the requirement itself is blamed', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', Quantity.atMost(80));
  const report = NearMiss.analyze([], prefs);
  assert.equal(report.status, 'infeasible');
  assert.match(report.text, /technologies|étages|tolérance/);
});

test('constraints that each pass alone are reported as a combination', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', Quantity.atMost(80));
  const probe = [solution({ dimensions: { x: 100, y: 50, z: 10, maxDiameter: 40 } })];
  const report = NearMiss.analyze(probe, prefs);
  assert.equal(report.status, 'elsewhere');
});

test('suggested bounds are readable numbers, never raw measurements', () => {
  assert.equal(NearMiss.niceBound(83.6421, 'up'), 84);
  assert.equal(NearMiss.niceBound(0.913, 'up'), 0.92);
  assert.equal(NearMiss.niceBound(1234, 'up'), 1300);
  assert.equal(NearMiss.niceBound(91.4, 'down'), 91);
});
