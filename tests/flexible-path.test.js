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

test('an open belt wraps less than 180° on the small pulley and more on the large one', () => {
  const path = Geometry.flexiblePath({ x: 0, y: 0 }, { x: 200, y: 0 }, 20, 60, false);
  const deg = radians => radians * 180 / Math.PI;
  assert.ok(deg(path.wrapAngle1) < 180, 'petite poulie: ' + deg(path.wrapAngle1));
  assert.ok(deg(path.wrapAngle2) > 180, 'grande poulie: ' + deg(path.wrapAngle2));
  assert.ok(Math.abs(deg(path.wrapAngle1) + deg(path.wrapAngle2) - 360) < 1e-9);
});

test('a crossed belt wraps both pulleys equally and by more than 180°', () => {
  const path = Geometry.flexiblePath({ x: 0, y: 0 }, { x: 200, y: 0 }, 20, 60, true);
  assert.equal(path.wrapAngle1, path.wrapAngle2);
  assert.ok(path.wrapAngle1 > Math.PI);
});

test('the developed length is the two spans plus the two wrapped arcs', () => {
  const r1 = 20, r2 = 60;
  const path = Geometry.flexiblePath({ x: 0, y: 0 }, { x: 200, y: 0 }, r1, r2, false);
  assert.ok(Math.abs(path.length - (2 * path.spanLength + r1 * path.wrapAngle1 + r2 * path.wrapAngle2)) < 1e-9);
  // Une courroie croisée est plus longue que la même ouverte : elle traverse.
  assert.ok(Geometry.flexiblePath({ x: 0, y: 0 }, { x: 200, y: 0 }, r1, r2, true).length > path.length);
});

test('the outline is a closed path and points travel along it without NaN', () => {
  const path = Geometry.flexiblePath({ x: 0, y: 0 }, { x: 200, y: 0 }, 20, 60, false);
  const outline = Geometry.flexibleOutline(path, 20, 60);
  assert.match(outline, /^M .* Z$/);
  assert.doesNotMatch(outline, /NaN|Infinity/);
  for (const s of [0, 37, path.spanLength, 2 * path.spanLength, -15, 5000]) {
    const point = Geometry.pointAlong(path, s);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 's=' + s);
  }
  // Un tour complet du chemin ramène au point de départ.
  const start = Geometry.pointAlong(path, 0);
  const loop = Geometry.pointAlong(path, 2 * path.spanLength);
  assert.ok(Math.hypot(loop.x - start.x, loop.y - start.y) < 1e-9);
});

test('an impossible pulley geometry is rejected instead of yielding NaN', () => {
  assert.throws(() => Geometry.flexiblePath({ x: 0, y: 0 }, { x: 0, y: 0 }, 10, 20, false), RangeError);
  assert.throws(() => Geometry.flexiblePath({ x: 0, y: 0 }, { x: 10, y: 0 }, 10, 60, true), RangeError);
});
