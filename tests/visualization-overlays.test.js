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

test('the warning overlay only shows what the engine declared, where it declared it', () => {
  // Le viewer ne décide plus si une mécanique tient : il n'a plus de quoi.
  assert.equal(typeof Warnings.derive, 'undefined', 'aucun calcul d’alerte dans le viewer');

  const emitted = [
    { code: 'UNDERCUT', stageIndex: 1 },
    { code: 'LOW_BENDING_SAFETY', stageIndex: 0, level: 'danger' },
    { code: 'THERMAL_RISK', stageIndex: null },       // portée : la chaîne entière
    { code: 'LOW_CONTACT_RATIO', stage: 3 }           // forme historique, 1-indexée
  ];
  assert.deepEqual(Warnings.forStage(emitted, 1).map(w => w.code), ['UNDERCUT']);
  assert.deepEqual(Warnings.forStage(emitted, 0).map(w => w.code), ['LOW_BENDING_SAFETY']);
  assert.deepEqual(Warnings.forStage(emitted, 2).map(w => w.code), ['LOW_CONTACT_RATIO']);
  // Une alerte de chaîne ne se pose sur AUCUN étage : elle s'affichait
  // auparavant sur tous, faute de savoir où la mettre.
  assert.deepEqual([0, 1, 2, 3].flatMap(i => Warnings.forStage(emitted, i)).filter(w => w.code === 'THERMAL_RISK'), []);
  assert.deepEqual(Warnings.forStage(null, 0), []);
});

test('the engine scopes each warning to the stage it concerns', () => {
  const Engineering = require('../js/core/Engineering.js');
  // Un pignon de 12 dents sous-coupe ; il est ici au SECOND étage.
  const solution = Engineering.analyzeSolution([
    { type: 'spur', input: { teeth: 24 }, output: { teeth: 48 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } },
    { type: 'spur', input: { teeth: 12 }, output: { teeth: 48 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } }
  ], 8, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  const undercut = solution.warnings.filter(w => w.code === 'UNDERCUT');
  assert.equal(undercut.length, 1);
  assert.equal(undercut[0].stageIndex, 1, 'l’alerte désigne l’étage fautif, pas la chaîne');
  // Les alertes de chaîne restent sans portée d'étage.
  solution.warnings.filter(w => w.code === 'LOW_EFFICIENCY' || w.code === 'THERMAL_RISK')
    .forEach(w => assert.equal(w.stageIndex, null));
});
