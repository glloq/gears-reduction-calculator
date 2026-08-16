const test = require('node:test');
const assert = require('node:assert/strict');
const SceneBuilder = require('../js/visualization/core/SceneBuilder.js');

test('scene builder only exposes calculated dimensions', () => {
  const stage = { type: 'spur', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2 }, geometry: { pitchDiameterInput: 40, pitchDiameterOutput: 80, width: 12, axisRelation: 'parallel' } };
  const scene = SceneBuilder.build({ inputRpm: 1000, stages: [stage], mechanical: [{ outputTorqueNm: 25 }] });
  assert.equal(scene.members.length, 2);
  assert.deepEqual(scene.members[0].geometry, { pitchDiameter: 40, width: 12 });
  assert.equal(scene.members[1].mechanical.rpm, -500);
  assert.equal(scene.connections[0].axisRelation, 'parallel');
  assert.equal(scene.members[0].geometry.outsideDiameter, undefined);
});
