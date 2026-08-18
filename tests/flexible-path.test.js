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

test('points travel along the whole circuit without NaN', () => {
  const path = Geometry.flexiblePath({ x: 0, y: 0 }, { x: 200, y: 0 }, 20, 60, false);
  for (const s of [0, 37, path.spanLength, 2 * path.spanLength, -15, 5000]) {
    const point = Geometry.pointAlong(path, s);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 's=' + s);
  }
  // Un tour complet, c'est la LONGUEUR DÉVELOPPÉE, pas la somme des brins.
  const start = Geometry.pointAlong(path, 0);
  const loop = Geometry.pointAlong(path, path.length);
  assert.ok(Math.hypot(loop.x - start.x, loop.y - start.y) < 1e-9);
});

test('a marker follows the belt around the pulleys, it never jumps a strand', () => {
  const r1 = 20, r2 = 60;
  const path = Geometry.flexiblePath({ x: 0, y: 0 }, { x: 200, y: 0 }, r1, r2, false);
  const parts = Geometry.segments(path);
  // Quatre segments cinématiques : brin, arc, brin, arc.
  assert.deepEqual(parts.list.map(p => p.kind), ['line', 'arc', 'line', 'arc']);
  // Et leur somme est exactement la longueur développée.
  assert.ok(Math.abs(parts.total - path.length) < 1e-9, parts.total + ' vs ' + path.length);
  // Les arcs couvrent réellement les angles d'enroulement calculés.
  assert.ok(Math.abs(Math.abs(parts.list[1].delta) - path.wrapAngle2) < 1e-9, 'enroulement grande poulie');
  assert.ok(Math.abs(Math.abs(parts.list[3].delta) - path.wrapAngle1) < 1e-9, 'enroulement petite poulie');

  // Le trajet est continu : aucun saut entre deux abscisses voisines, et tout
  // point reste sur un brin ou sur une poulie — jamais à l'intérieur.
  let previous = Geometry.pointAlong(path, 0);
  let onPulley = 0;
  for (let s = path.length / 400; s <= path.length + 1e-9; s += path.length / 400) {
    const point = Geometry.pointAlong(path, s);
    assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < path.length / 100, 'saut à s=' + s);
    const d1 = Math.hypot(point.x, point.y), d2 = Math.hypot(point.x - 200, point.y);
    assert.ok(d1 >= r1 - 1e-6 && d2 >= r2 - 1e-6, 'point à l\'intérieur d\'une poulie à s=' + s);
    if (Math.abs(d1 - r1) < 1e-6 || Math.abs(d2 - r2) < 1e-6) onPulley++;
    previous = point;
  }
  // Une part significative du parcours se fait bien sur les poulies.
  assert.ok(onPulley > 120, 'seulement ' + onPulley + ' échantillons sur les poulies');
});

test('a crossed belt also wraps both pulleys over its whole length', () => {
  const path = Geometry.flexiblePath({ x: 0, y: 0 }, { x: 200, y: 0 }, 20, 60, true);
  const parts = Geometry.segments(path);
  assert.ok(Math.abs(parts.total - path.length) < 1e-9);
  assert.ok(Math.abs(Math.abs(parts.list[1].delta) - path.wrapAngle2) < 1e-9);
  assert.ok(Math.abs(Math.abs(parts.list[3].delta) - path.wrapAngle1) < 1e-9);
});

test('an impossible pulley geometry is rejected instead of yielding NaN', () => {
  assert.throws(() => Geometry.flexiblePath({ x: 0, y: 0 }, { x: 0, y: 0 }, 10, 20, false), RangeError);
  assert.throws(() => Geometry.flexiblePath({ x: 0, y: 0 }, { x: 10, y: 0 }, 10, 60, true), RangeError);
});
