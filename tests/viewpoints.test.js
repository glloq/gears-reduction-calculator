const test = require('node:test');
const assert = require('node:assert/strict');
const Projection = require('../js/visualization/core/ProjectionEngine.js');
const Layout = require('../js/visualization/TrainLayout.js');
const SpatialLayout = require('../js/visualization/core/SpatialLayout.js');
const MechanicalGraph = require('../js/visualization/core/MechanicalGraph.js');
const SceneBuilder = require('../js/visualization/core/SceneBuilder.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

function stage(type, config) {
  const def = Registry.get(type);
  const s = Object.assign({ type: type, parameters: { module: 1 } }, config);
  s.geometry = def.calculateGeometry(s);
  return s;
}
function chain() {
  return [stage('spur', { input: { teeth: 12 }, output: { teeth: 36 }, parameters: { module: 2, faceWidth: 20 } }),
    stage('bevel', { input: { teeth: 15 }, output: { teeth: 30 }, parameters: { module: 2, shaftAngle: 90 } })];
}
const MECH = [{ ratio: 3, signedRatio: -3, efficiency: 0.98 }, { ratio: 2, signedRatio: -2, efficiency: 0.98 }];
const PAIRS = [['front', 'rear'], ['top', 'bottom'], ['side', 'side-far'], ['iso', 'iso-rear']];

test('every viewpoint has an other side, and it is an involution', () => {
  PAIRS.forEach(([here, there]) => {
    assert.equal(Projection.opposite(here), there);
    assert.equal(Projection.opposite(there), here);
    const a = Projection.view(here), b = Projection.view(there);
    // Le regard s'inverse…
    [0, 1, 2].forEach(i => assert.ok(Math.abs(a.w[i] + b.w[i]) < 1e-9, here + ' : le regard ne s’est pas retourné'));
    // …et la droite de l'écran avec lui, sans quoi on obtiendrait une image
    // miroir du mécanisme plutôt que son autre face.
    [0, 1, 2].forEach(i => assert.ok(Math.abs(a.u[i] + b.u[i]) < 1e-9, here + ' : u n’a pas suivi'));
    // Le haut de l'écran, lui, ne bouge pas : on se déplace autour, on ne
    // met pas le réducteur sur la tête.
    [0, 1, 2].forEach(i => assert.ok(Math.abs(a.v[i] - b.v[i]) < 1e-9, here + ' : v a bougé'));
  });
  // La vue dépliée n'est pas une projection : elle n'a pas de bord à changer.
  assert.equal(Projection.opposite('unfolded'), 'unfolded');
});

test('seen from the other side, the drawing is mirrored and the senses reverse', () => {
  PAIRS.forEach(([here, there]) => {
    const a = Layout.layout(chain(), MECH, { view: here });
    const b = Layout.layout(chain(), MECH, { view: there });
    a.wheels.forEach((wheel, index) => {
      const other = b.wheels[index];
      // Le dessin se retourne : gauche et droite s'échangent, le haut reste.
      assert.ok(Math.abs(wheel.cx + other.cx) < 1e-9, here + ' : x non retourné');
      assert.ok(Math.abs(wheel.cy - other.cy) < 1e-9, here + ' : y a bougé');
      // Le côté depuis lequel on regarde l'organe change…
      assert.ok(wheel.facing + other.facing === 0 && Math.abs(wheel.facing) === Math.abs(other.facing),
        here + ' : le côté n’a pas changé (' + wheel.facing + ' / ' + other.facing + ')');
      // …et donc le sens apparent de rotation. C'est ce qu'on observe d'un
      // vrai réducteur qu'on retourne, et c'est justement ce qui rend ces
      // vues utiles plutôt que décoratives.
      if (wheel.phaseBasis) {
        const mine = wheel.phaseBasis.spin, theirs = other.phaseBasis.spin;
        assert.ok(mine + theirs === 0 && Math.abs(mine) === Math.abs(theirs),
          here + ' : le sens n’a pas changé (' + mine + ' / ' + theirs + ')');
      }
    });
  });
});

test('the scene knows what is in front of what', () => {
  const solution = { stages: chain(), mechanical: MECH };
  const scene = SceneBuilder.build(solution);
  for (const view of ['front', 'iso', 'side']) {
    const frame = SpatialLayout.frame(MechanicalGraph.build(solution, scene), { view });
    const order = frame.projected.order;
    assert.ok(order.length > 1);
    // L'ordre de peinture va du plus lointain au plus proche : c'est ce qui
    // permet à une pièce proche de recouvrir celle qui est derrière elle.
    for (let i = 1; i < order.length; i++) {
      assert.ok(frame.projected.member(order[i - 1]).depth >= frame.projected.member(order[i]).depth - 1e-9,
        view + ' : ordre de peinture non trié');
    }
    // Et la profondeur est bien celle du MONDE, mesurée le long du regard.
    order.forEach(id => {
      const seen = frame.projected.member(id);
      const world = frame.spatial.byId[id].position;
      const depth = world[0] * frame.view.w[0] + world[1] * frame.view.w[1] + world[2] * frame.view.w[2];
      assert.ok(Math.abs(seen.depth - depth) < 1e-9, view + ' ' + id);
    });
  }
  // De l'autre bord, ce qui était devant passe derrière.
  const here = SpatialLayout.frame(MechanicalGraph.build(solution, scene), { view: 'iso' }).projected.order;
  const there = SpatialLayout.frame(MechanicalGraph.build(solution, scene), { view: 'iso-rear' }).projected.order;
  assert.deepEqual(there, here.slice().reverse());
});
