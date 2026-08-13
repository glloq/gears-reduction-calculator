const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../js/visualization/TrainLayout.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

// Construit un étage avec sa géométrie calculée, comme Engineering le fait.
function stage(type, config) {
  const def = Registry.get(type === 'epicyclic' ? 'planetary' : type);
  const s = Object.assign({ type: type === 'epicyclic' ? 'planetary' : type, parameters: { module: 1 } }, config);
  s.geometry = def.calculateGeometry(s);
  return s;
}
function pair(type, a, b, params) {
  return stage(type, { input: { teeth: a }, output: { teeth: b }, parameters: Object.assign({ module: 1 }, params) });
}
function mech(ratio, signed) { return { ratio: Math.abs(ratio), signedRatio: signed === undefined ? -ratio : signed, efficiency: 0.97 }; }

function allFinite(model) {
  model.wheels.forEach(w => {
    for (const key of ['cx', 'cy', 'pitchD', 'outsideD', 'rootD']) {
      assert.ok(Number.isFinite(w[key]), key + ' is not finite on ' + w.role + ': ' + w[key]);
    }
  });
  model.stages.forEach(e => e.links.forEach(l => {
    for (const key of ['x1', 'y1', 'x2', 'y2', 'x', 'y']) {
      if (l[key] !== undefined) assert.ok(Number.isFinite(l[key]), 'link ' + l.kind + ' ' + key);
    }
  }));
}

test('mixed 8-type chain lays out with finite coordinates everywhere', () => {
  const stages = [
    pair('spur', 12, 36),
    pair('helical', 15, 45, { helixAngle: 20 }),
    pair('internal', 15, 45),
    pair('belt', 20, 60, { pitch: 2, centerDistance: 100 }),
    pair('chain', 15, 45, { pitch: 12.7, centerDistance: 200 }),
    stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 1, leadAngle: 20, diameterQuotient: 10 } }),
    pair('bevel', 15, 30, { shaftAngle: 90 }),
    stage('planetary', { sunTeeth: 12, ringTeeth: 48, planetTeeth: 18, planetCount: 4, inputMember: 'S', outputMember: 'C', fixed: 'R' })
  ];
  const mechanical = [mech(3), mech(3), mech(3), mech(3, 3), mech(3, 3), mech(20), mech(2), mech(5, 5)];
  const model = Layout.layout(stages, mechanical);
  assert.equal(model.stages.length, 8);
  allFinite(model);
  // Le planétaire a bien planetCount satellites réels
  const planetary = model.stages[7];
  assert.equal(planetary.wheels.filter(w => w.role === 'planet').length, 4);
});

test('consecutive external pairs are compound: input(i+1) concentric with output(i)', () => {
  const stages = [pair('spur', 12, 36), pair('spur', 12, 36)];
  const model = Layout.layout(stages, [mech(3), mech(3)]);
  const out0 = model.stages[0].wheels[1];
  const in1 = model.stages[1].wheels[0];
  assert.equal(in1.cx, out0.cx);
  assert.equal(in1.cy, out0.cy);
});

test('mesh distance equals the real calculated center distance', () => {
  const s = pair('spur', 12, 36);
  const model = Layout.layout([s], [mech(3)]);
  const [a, b] = model.stages[0].wheels;
  const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
  assert.ok(Math.abs(d - s.geometry.centerDistance) < 1e-6, d + ' vs ' + s.geometry.centerDistance);
});

test('belt and chain advance by the corrected center distance with real pitch diameters', () => {
  const belt = pair('belt', 20, 60, { pitch: 2, centerDistance: 100 });
  const model = Layout.layout([belt], [mech(3, 3)]);
  const [a, b] = model.stages[0].wheels;
  assert.ok(Math.abs(Math.hypot(b.cx - a.cx, b.cy - a.cy) - belt.geometry.correctedCenterDistance) < 1e-6);
  assert.ok(Math.abs(a.pitchD - 20 * 2 / Math.PI) < 1e-6, 'pulley pitch diameter is z·p/π');
  assert.equal(model.stages[0].links[0].kind, 'belt-span');
});

test('planetary and bevel break the axis before the next stage', () => {
  const stages = [
    stage('planetary', { sunTeeth: 12, ringTeeth: 48, planetTeeth: 18, planetCount: 3, inputMember: 'S', outputMember: 'C', fixed: 'R' }),
    pair('spur', 12, 36)
  ];
  const model = Layout.layout(stages, [mech(5, 5), mech(3)]);
  assert.equal(model.stages[0].attach, 'coaxial');
  assert.ok(model.stages[0].links.some(l => l.kind === 'shaft-break'));
  const ring = model.stages[0].wheels[1];
  const nextIn = model.stages[1].wheels[0];
  assert.ok(nextIn.cx - nextIn.outsideD / 2 > ring.cx + ring.outsideD / 2 - 1e-6, 'next stage placed beyond the ring');
});

test('speeds cascade and direction alternates through external pairs', () => {
  const stages = [pair('spur', 12, 36), pair('spur', 12, 36)];
  const model = Layout.layout(stages, [mech(3), mech(3)]);
  const w = model.stages.map(e => e.wheels);
  assert.equal(w[0][0].speed, 1);            // arbre d'entrée
  assert.equal(w[0][1].speed, -1 / 3);       // inversé et réduit
  assert.equal(w[1][0].speed, -1 / 3);       // même arbre
  assert.ok(Math.abs(w[1][1].speed - 1 / 9) < 1e-9); // ré-inversé
});

test('crossed belt inverts direction while straight belt preserves it', () => {
  const straight = Layout.layout([pair('belt', 20, 60, { pitch: 2, centerDistance: 100 })], [mech(3, 3)]);
  assert.ok(straight.stages[0].wheels[1].speed > 0);
  const crossedStage = pair('belt', 20, 60, { pitch: 2, centerDistance: 100, crossed: true });
  const crossed = Layout.layout([crossedStage], [mech(3, -3)]);
  assert.ok(crossed.stages[0].wheels[1].speed < 0);
});

test('single stage and missing mechanical data stay finite', () => {
  const single = Layout.layout([pair('spur', 10, 40)], []);
  allFinite(single);
  assert.equal(single.io.input.role, 'input');
  assert.equal(single.io.output.role, 'output');
  const empty = Layout.layout([], []);
  assert.equal(empty.stages.length, 0);
});

test('worm places the wheel perpendicular below the screw', () => {
  const s = stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 1, leadAngle: 20, diameterQuotient: 10 } });
  const model = Layout.layout([s], [mech(20)]);
  const [worm, wheel] = model.stages[0].wheels;
  assert.equal(worm.kind, 'worm');
  assert.ok(wheel.cy > worm.cy, 'wheel below the worm');
  assert.ok(Math.abs(wheel.cy - worm.cy - s.geometry.centerDistance) < 1e-6);
});
