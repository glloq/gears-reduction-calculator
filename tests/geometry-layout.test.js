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
