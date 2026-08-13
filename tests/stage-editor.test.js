const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/ui/StageEditor.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');
const Engineering = require('../js/core/Engineering.js');
const ManufacturingRules = require('../js/core/ManufacturingRules.js');

const DEPS = { Engineering, ManufacturingRules, Registry };
const CONTEXT = {
  target: 4,
  engineeringOptions: { inputSpeedRpm: 1500, inputTorqueNm: 10 },
  manufacturing: { mode: 'standard' }
};

test('defaultStage produces a valid configuration for every rotary type', () => {
  for (const typeId of ['spur', 'helical', 'internal', 'bevel', 'worm', 'planetary', 'epicyclic', 'belt', 'chain']) {
    const stage = H.defaultStage(typeId, 1);
    const checks = H.validateStages([stage], Registry);
    assert.deepEqual(checks[0].errors, [], typeId + ': ' + checks[0].errors.join(' | '));
  }
});

test('validateStages flags bad worm starts, non-assemblable planetary and short belt center distance', () => {
  const badWorm = H.defaultStage('worm', 1);
  badWorm.wormStarts = 9;
  assert.ok(H.validateStages([badWorm], Registry)[0].errors.length > 0);

  const badPlanetary = H.defaultStage('planetary', 1);
  badPlanetary.ringTeeth = 49; // (49-12)/2 non entier
  assert.match(H.validateStages([badPlanetary], Registry)[0].errors.join(' '), /Satellites/);

  const badBelt = H.defaultStage('belt', 1);
  badBelt.parameters.centerDistance = 1;
  assert.match(H.validateStages([badBelt], Registry)[0].errors.join(' '), /Entraxe/);
});

test('validateStages rejects per-stage ratios beyond the type maximum', () => {
  const stage = H.defaultStage('spur', 1);
  stage.output.teeth = 200; // 200/20 = 10 > maxRatio spur (8)
  assert.match(H.validateStages([stage], Registry)[0].errors.join(' '), /maximum/);
});

test('reanalyze returns a coherent solution and never mutates its input', () => {
  const stages = [H.defaultStage('spur', 1), H.defaultStage('spur', 1)];
  const before = JSON.stringify(stages);
  const result = H.reanalyze(stages, CONTEXT, DEPS);
  assert.ok(result.solution, result.error);
  assert.equal(JSON.stringify(stages), before, 'input stages were mutated');
  assert.ok(Math.abs(result.solution.ratio - 4) < 1e-9);
  assert.ok(result.solution.efficiency > 0.9);
  assert.ok(result.solution.manufacturing);
  assert.equal(result.solution.manufacturing.valid, true);
  assert.ok(result.solution.mechanical.length === 2);
});

test('reanalyze reports manufacturing failures instead of hiding them', () => {
  const stages = [H.defaultStage('spur', 0.2)]; // module 0.2 < min standard 0.3
  const result = H.reanalyze(stages, CONTEXT, DEPS);
  assert.ok(result.solution);
  assert.equal(result.manufacturing.valid, false);
  assert.ok(result.manufacturing.failures.includes('MODULE_TOO_SMALL'));
});

test('reanalyze traps analyzeSolution exceptions and returns an error string', () => {
  const stages = [{ type: 'nope', parameters: {} }];
  const result = H.reanalyze(stages, CONTEXT, DEPS);
  assert.ok(result.error);
  assert.equal(result.solution, undefined);
});

test('reanalyze without an explicit target reports zero error against the achieved ratio', () => {
  const stages = [H.defaultStage('spur', 1)];
  const result = H.reanalyze(stages, { engineeringOptions: {}, manufacturing: { mode: 'standard' } }, DEPS);
  assert.ok(result.solution);
  assert.equal(result.solution.errorPercent, 0);
});

test('diff marks improvements and regressions with the right direction', () => {
  const stages = [H.defaultStage('spur', 1), H.defaultStage('spur', 1)];
  const original = H.reanalyze(stages, CONTEXT, DEPS).solution;
  const edited = H.reanalyze([H.defaultStage('spur', 1)], { ...CONTEXT, target: 2 }, DEPS).solution;
  const rows = H.diff(original, edited);
  const byLabel = Object.fromEntries(rows.map(r => [r.label, r]));
  assert.ok(byLabel['Longueur'].better === true, 'shorter chain should be better');
  assert.ok(byLabel['Rendement'].better === true, 'fewer stages → higher efficiency');
  assert.equal(byLabel['Rapport'].better, null, 'ratio is informational');
});
