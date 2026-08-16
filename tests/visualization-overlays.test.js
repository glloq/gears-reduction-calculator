const test = require('node:test');
const assert = require('node:assert/strict');
const Inspector = require('../js/visualization/StageInspector.js');
const Forces = require('../js/visualization/overlays/ForceOverlay.js');
const Warnings = require('../js/visualization/overlays/WarningOverlay.js');

test('stage inspector exposes stable mechanical data without a DOM', () => {
  const solution = { inputSpeedRpm: 1500, stages: [{ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2 }, geometry: { centerDistance: 80 } }], mechanical: [{ ratio: 3, efficiency: .98, bending: { safetyFactor: 2.1 }, contact: { safetyFactor: 1.7 } }] };
  const data = Inspector.model(solution, 0, { getToothCounts: () => [20, 60] });
  assert.deepEqual(data.teeth, [20, 60]); assert.equal(data.outputRpm, 500); assert.equal(data.bendingSafety, 2.1);
});

test('force overlay normalizes vectors while preserving values and direction', () => {
  const vectors = Forces.vectors({ tangentialN: 800, radialN: 200, axialN: -400 }, 24);
  assert.equal(vectors.length, 3); assert.equal(vectors[0].x2, 24); assert.ok(vectors[1].y2 < 0); assert.ok(vectors[2].x2 < 0);
});

test('warning overlay derives and scopes structured mechanical warnings', () => {
  const derived = Warnings.derive({ input: { teeth: 12 }, parameters: {}, geometry: { totalContactRatio: 1.1 } }, { bending: { safetyFactor: 1.1 }, contact: { safetyFactor: 1 }, forces: { axialN: 500, tangentialN: 200 } });
  assert.deepEqual(derived.map(w => w.code), ['LOW_CONTACT_RATIO', 'UNDERCUT', 'LOW_BENDING_SAFETY', 'LOW_CONTACT_SAFETY', 'HIGH_AXIAL_LOAD']);
  assert.equal(Warnings.forStage([{ code: 'UNDERCUT', stageIndex: 1 }, { code: 'THERMAL_RISK' }], 1).length, 1);
});
