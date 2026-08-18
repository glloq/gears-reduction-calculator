const test = require('node:test');
const assert = require('node:assert/strict');
const Forces = require('../js/visualization/overlays/ForceOverlay.js');
const Layout = require('../js/visualization/TrainLayout.js');
const GeometryLayout = require('../js/visualization/geometry/GeometryLayout.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

function stage(type, config) {
  const def = Registry.get(type);
  const s = Object.assign({ type: type, parameters: { module: 1 } }, config);
  s.geometry = def.calculateGeometry(s);
  return s;
}
const FAMILIES = {
  spur: () => stage('spur', { input: { teeth: 12 }, output: { teeth: 36 }, parameters: { module: 2, faceWidth: 20 } }),
  worm: () => stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } }),
  bevel: () => stage('bevel', { input: { teeth: 15 }, output: { teeth: 30 }, parameters: { module: 2, shaftAngle: 90 } }),
  belt: () => stage('belt', { input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2, pitch: 5, centerDistance: 120 } }),
  rack: () => stage('rack', { pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } }),
  planetary: () => stage('planetary', { sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 4,
    inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2 } })
};
const VIEWS = ['unfolded', 'front', 'top', 'side', 'iso'];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('every family gets a mesh frame, and it is a real trihedron', () => {
  for (const [name, build] of Object.entries(FAMILIES)) {
    for (const view of VIEWS) {
      const entry = Layout.layout([build()], [{ ratio: 3, signedRatio: 3, efficiency: 0.97 }], { view }).stages[0];
      const mesh = entry.forceFrame;
      assert.ok(mesh, name + ' en ' + view + ' : aucun repère d’efforts');
      const { tangentialN: t, radialN: r, axialN: a } = mesh.world;
      // Trois directions unitaires, deux à deux perpendiculaires : c'est le
      // repère de l'engrènement, pas trois flèches choisies séparément.
      [t, r, a].forEach(v => assert.ok(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-9, name + ' ' + view));
      assert.ok(Math.abs(dot(t, r)) < 1e-9, name + ' ' + view + ' : Ft et Fr non perpendiculaires');
      assert.ok(Math.abs(dot(t, a)) < 1e-9, name + ' ' + view + ' : Ft et Fa non perpendiculaires');
      assert.ok(Math.abs(dot(r, a)) < 1e-9, name + ' ' + view + ' : Fr et Fa non perpendiculaires');
      // Fa suit l'axe : c'est la définition d'un effort axial.
      assert.ok(Math.abs(Math.abs(dot(a, mesh.world.axialN)) - 1) < 1e-9);
    }
  }
});

test('the mechanics does not move when the point of view does', () => {
  for (const [name, build] of Object.entries(FAMILIES)) {
    const reference = Layout.layout([build()], [{ ratio: 3 }], { view: 'unfolded' }).stages[0].forceFrame;
    const drawn = new Set();
    for (const view of VIEWS) {
      const mesh = Layout.layout([build()], [{ ratio: 3 }], { view }).stages[0].forceFrame;
      // Les directions dans le MONDE sont les mêmes partout…
      ['tangentialN', 'radialN', 'axialN'].forEach(key => {
        const world = mesh.world[key], want = reference.world[key];
        assert.ok(Math.hypot(world[0] - want[0], world[1] - want[1], world[2] - want[2]) < 1e-9,
          name + ' ' + view + ' ' + key);
      });
      drawn.add(JSON.stringify(mesh.screen));
    }
    // …et seule leur image change.
    assert.ok(drawn.size > 1, name + ' : les flèches sont les mêmes dans toutes les vues');
  }
});

test('Transmission and Dimensions draw one and the same force', () => {
  for (const [name, build] of Object.entries(FAMILIES)) {
    for (const view of VIEWS) {
      const stages = [build()];
      const solution = { stages: stages, mechanical: [{ ratio: 3, signedRatio: 3, efficiency: 0.97 }] };
      const train = Layout.layout(stages, solution.mechanical, { view }).stages[0].forceFrame;
      const cotted = GeometryLayout.build(solution, { view }).stages[0].forceFrame;
      assert.ok(cotted, name + ' en ' + view + ' : la vue cotée n’a pas de repère');
      ['tangentialN', 'radialN', 'axialN'].forEach(key => {
        const a = train.screen[key], b = cotted.screen[key];
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, name + ' ' + view + ' ' + key);
      });
    }
  }
});

test('the forces are applied where the teeth touch, not at the centre', () => {
  for (const view of VIEWS) {
    const entry = Layout.layout([FAMILIES.spur()], [{ ratio: 3 }], { view }).stages[0];
    const wheels = entry.wheels;
    const origin = entry.forceFrame.origin;
    // Le point d'application est sur la ligne des centres dessinée, à un rayon
    // primitif du menant : c'est le point primitif.
    const dx = wheels[1].cx - wheels[0].cx, dy = wheels[1].cy - wheels[0].cy;
    const span = Math.hypot(dx, dy);
    const reach = Math.hypot(origin[0] - wheels[0].cx, origin[1] - wheels[0].cy);
    if (span < 1e-9) { assert.ok(reach < 1e-9, view); continue; }
    assert.ok(Math.abs(reach - Math.min(wheels[0].pitchD / 2, span)) < 1e-9, view + ' : ' + reach);
    // …et il est bien SUR cette ligne, pas à côté.
    const across = (origin[0] - wheels[0].cx) * -dy / span + (origin[1] - wheels[0].cy) * dx / span;
    assert.ok(Math.abs(across) < 1e-9, view + ' : point d’application hors de la ligne des centres');
  }
});

test('an axial force seen along its own axis becomes a symbol, not a stub', () => {
  // Vue de face d'un couple d'axe Z : Fa pointe droit vers l'observateur.
  const mesh = Forces.frame({ axis: [0, 0, 1], centre: [0, 0, 0], mate: [80, 0, 0], view: 'front' });
  const drawn = Forces.vectors({ tangentialN: 500, axialN: 300 }, 24, mesh);
  const fa = drawn.filter(v => v.label === 'Fa')[0];
  assert.ok(fa.towards !== 0, 'Fa vue dans son axe reste une flèche');
  assert.equal(fa.x2, 0); assert.equal(fa.y2, 0);
  assert.ok(fa.foreshortening < 0.2);
  // Vue de dessus, le même effort redevient une flèche de pleine longueur.
  const sideways = Forces.frame({ axis: [0, 0, 1], centre: [0, 0, 0], mate: [80, 0, 0], view: 'top' });
  const again = Forces.vectors({ tangentialN: 500, axialN: 300 }, 24, sideways).filter(v => v.label === 'Fa')[0];
  assert.equal(again.towards, 0);
  assert.ok(Math.hypot(again.x2, again.y2) > 7);
});
