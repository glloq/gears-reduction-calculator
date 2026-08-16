const test = require('node:test');
const assert = require('node:assert/strict');
const Geometry = require('../js/visualization/core/GeometryUtils.js');

test('open and crossed flexible paths produce exact finite tangent points', () => {
  for (const crossed of [false, true]) {
    const path = Geometry.flexiblePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 20, crossed);
    assert.equal(path.tangents.length, 2);
    assert.equal(path.crossed, crossed);
    assert.ok(path.tangents.every(t => Object.values(t.from).concat(Object.values(t.to)).every(Number.isFinite)));
  }
});
