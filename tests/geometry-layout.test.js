const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../js/visualization/geometry/GeometryLayout.js');

test('geometry layout uses calculated diameters and corrected flexible distance', () => {
  const solution = { stages: [{ type: 'belt', parameters: { crossed: false }, geometry: { pitchDiameterInput: 40, pitchDiameterOutput: 100, centerDistance: 210, correctedCenterDistance: 212.5, maxDiameter: 100 } }] };
  const model = Layout.build(solution);
  assert.equal(model.stages[0].centerDistance, 212.5);
  assert.ok(model.stages[0].width >= 282.5);
  assert.ok(model.bounds.width >= model.stages[0].x + model.stages[0].width / 2);
});

test('geometry layout spaces stages without overlapping their calculated extents', () => {
  const solution = { stages: [
    { type: 'spur', geometry: { pitchDiameterInput: 30, pitchDiameterOutput: 90, centerDistance: 60, maxDiameter: 94 } },
    { type: 'planetary', geometry: { sunDiameter: 30, planetDiameter: 30, ringDiameter: 90, maxDiameter: 94 } }
  ] };
  const model = Layout.build(solution, { stageGap: 80 });
  const first = model.stages[0], second = model.stages[1];
  assert.ok(second.x - second.diameter / 2 >= first.x - first.diameter / 2 + first.width + 80);
  model.stages.forEach(item => ['x', 'y', 'width', 'height', 'diameter'].forEach(key => assert.ok(Number.isFinite(item[key]))));
});

test('rack width reflects its real travel per revolution', () => {
  const model = Layout.build({ stages: [{ type: 'rack', parameters: { module: 2 }, geometry: { pitchDiameterInput: 40, maxDiameter: 44, travelPerRevolution: 125.66 } }] });
  assert.equal(model.stages[0].width, 125.66);
});

test('each stage exposes its members at their real calculated positions', () => {
  const Registry = require('../js/transmissions/TransmissionRegistry.js');
  const spur = { type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2, faceWidth: 20 } };
  spur.geometry = Registry.get('spur').calculateGeometry(spur);
  const item = Layout.build({ stages: [spur] }).stages[0];
  const [input, output] = item.members;
  assert.equal(input.role, 'input');
  assert.equal(output.cx - input.cx, spur.geometry.centerDistance, 'entraxe réel entre les deux membres');
  assert.equal(input.pitchDiameter, 40);
  assert.equal(output.outsideDiameter, spur.geometry.outsideDiameterOutput);
  assert.equal(input.baseDiameter, spur.geometry.baseDiameterInput);
});

test('a planetary exposes its ring, sun, every real planet and its carrier', () => {
  const stage = { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 5,
    parameters: { module: 2 }, geometry: { sunDiameter: 48, ringDiameter: 144, planetDiameter: 48, maxDiameter: 148 } };
  const members = Layout.build({ stages: [stage] }).stages[0].members;
  assert.equal(members.filter(m => m.role === 'planet').length, 5);
  assert.equal(members.filter(m => m.role === 'carrier').length, 1);
  // Les satellites sont sur l'orbite réelle (dS + dP) / 2.
  const item = Layout.build({ stages: [stage] }).stages[0];
  members.filter(m => m.role === 'planet').forEach(planet => {
    assert.ok(Math.abs(Math.hypot(planet.cx - item.x, planet.cy - item.y) - 48) < 1e-9);
  });
});

test('only the dimensions actually calculated are listed', () => {
  const belt = { type: 'belt', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2 },
    geometry: { pitchDiameterInput: 40, pitchDiameterOutput: 120, correctedCenterDistance: 212.5,
      maxDiameter: 120, width: 10, actualLength: 620, wrapAngleDeg: 158.2, beltTeeth: 310 } };
  const keys = Layout.build({ stages: [belt] }).stages[0].dimensions.map(d => d.key);
  assert.deepEqual(keys, ['centerDistance', 'width', 'module', 'length', 'wrap', 'beltTeeth']);
  // Une géométrie vide ne fabrique aucune cote.
  assert.deepEqual(Layout.build({ stages: [{ type: 'spur', parameters: {}, geometry: {} }] }).stages[0].dimensions, []);
});

test('the overall envelope repeats the engine dimensions, never invented ones', () => {
  const solution = { stages: [{ type: 'spur', parameters: { module: 1 }, geometry: { pitchDiameterInput: 20, pitchDiameterOutput: 60, centerDistance: 40, maxDiameter: 62 } }],
    dimensions: { length: 102, maxDiameter: 62, width: 10 } };
  assert.deepEqual(Layout.build(solution).envelope, { length: 102, maxDiameter: 62, width: 10 });
  assert.deepEqual(Layout.build({ stages: solution.stages }).envelope, { length: null, maxDiameter: null, width: null });
});

test('margins scale with the reducer so small and large trains frame alike', () => {
  const small = Layout.build({ stages: [{ type: 'spur', parameters: { module: .5 }, geometry: { pitchDiameterInput: 10, pitchDiameterOutput: 20, centerDistance: 15, maxDiameter: 21 } }] });
  const large = Layout.build({ stages: [{ type: 'spur', parameters: { module: 8 }, geometry: { pitchDiameterInput: 160, pitchDiameterOutput: 480, centerDistance: 320, maxDiameter: 496 } }] });
  const fill = model => (model.stages[0].width) / model.bounds.width;
  assert.ok(Math.abs(fill(small) - fill(large)) < 0.2, 'même part du cadre occupée: ' + fill(small) + ' vs ' + fill(large));
});
