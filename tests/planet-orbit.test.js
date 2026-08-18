const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../js/visualization/TrainLayout.js');
const GeometryLayout = require('../js/visualization/geometry/GeometryLayout.js');
const ProjectedScene = require('../js/visualization/core/ProjectedScene.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

const PLANETARY = { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 4,
  inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2, faceWidth: 20 } };
function solution() {
  const stage = JSON.parse(JSON.stringify(PLANETARY));
  stage.geometry = Registry.get('planetary').calculateGeometry(stage);
  return { stages: [stage], mechanical: [{ ratio: 4, signedRatio: 4, efficiency: 0.97 }] };
}
const VIEWS = ['unfolded', 'front', 'top', 'side', 'iso'];

test('satellites sit in their orbit plane, not on a circle of the screen', () => {
  for (const view of VIEWS) {
    const sol = solution();
    const entry = Layout.layout(sol.stages, sol.mechanical, { view }).stages[0];
    const planets = entry.wheels.filter(w => w.role === 'planet');
    assert.equal(planets.length, 4);
    const basis = entry.carrier.basis;
    assert.ok(basis && basis.first && basis.second, 'pas de base d’orbite en ' + view);
    planets.forEach((planet, index) => {
      // Le satellite est à l'angle que le porte-satellites lui donne, DANS SON
      // PLAN : c'est la projection de ce point, et non un cos/sin d'écran.
      assert.ok(Math.abs(planet.phase - 2 * Math.PI * index / 4) < 1e-12, 'phase ' + view);
      const seat = ProjectedScene.phasePoint(basis, planet.orbit, planet.phase);
      assert.ok(Math.abs(planet.cx - (planet.orbitCenterX + seat[0])) < 1e-9, 'x en ' + view);
      assert.ok(Math.abs(planet.cy - (planet.orbitCenterY + seat[1])) < 1e-9, 'y en ' + view);
      assert.equal(planet.orbitBasis, basis, 'le satellite ignore la base de son orbite');
    });
  }
});

test('an orbit seen edge-on is a segment, and seen face-on a circle', () => {
  const shape = {};
  for (const view of VIEWS) {
    const sol = solution();
    const entry = Layout.layout(sol.stages, sol.mechanical, { view }).stages[0];
    const planets = entry.wheels.filter(w => w.role === 'planet');
    // L'orbite dessinée est l'image d'un cercle : ses deux demi-axes disent à
    // eux seuls si on la voit de face, de biais ou par la tranche.
    shape[view] = Object.assign(ProjectedScene.ellipseOf(entry.carrier.basis.first, entry.carrier.basis.second),
      { radii: planets.map(p => Math.hypot(p.cx - p.orbitCenterX, p.cy - p.orbitCenterY)),
        orbit: planets[0].orbit });
  }
  // Vue dépliée : l'engrènement est de face, l'orbite est un vrai cercle.
  assert.ok(Math.abs(shape.unfolded.minor - 1) < 1e-9, 'orbite dépliée aplatie');
  shape.unfolded.radii.forEach(r => assert.ok(Math.abs(r - shape.unfolded.orbit) < 1e-9, 'rayon ' + r));
  // Vue de face : l'axe du planétaire est dans le plan de l'écran, donc le plan
  // d'orbite est vu par la tranche — l'orbite se replie sur un segment.
  assert.ok(shape.front.minor < 1e-9, 'orbite de face non repliée : ' + shape.front.minor);
  assert.ok(shape.front.radii.some(r => r < 1e-9), 'aucun satellite sur l’axe : ' + shape.front.radii);
  // Iso : ni cercle ni segment — une ellipse.
  assert.ok(shape.iso.minor > 1e-6 && shape.iso.minor < shape.iso.major - 1e-6,
    'orbite isométrique : ' + shape.iso.major + ' / ' + shape.iso.minor);
  // Et l'orbite n'y déborde jamais du cercle qu'elle serait vue de face.
  shape.iso.radii.forEach(r => assert.ok(r <= shape.iso.orbit + 1e-9, 'rayon apparent ' + r));
});

test('Transmission and Dimensions put the satellites in the same plane', () => {
  for (const view of VIEWS) {
    const sol = solution();
    const train = Layout.layout(sol.stages, sol.mechanical, { view }).stages[0];
    const dimensions = GeometryLayout.build(solution(), { view }).stages[0];
    const trainPlanets = train.wheels.filter(w => w.role === 'planet');
    const dimPlanets = dimensions.members.filter(m => m.role === 'planet');
    assert.equal(dimPlanets.length, trainPlanets.length);
    // Les deux vues posent l'étage à des endroits différents ; ce qui doit
    // coïncider, c'est la place de chaque satellite PAR RAPPORT à son centre.
    dimPlanets.forEach((planet, index) => {
      const mine = [planet.cx - planet.orbitCenterX, planet.cy - planet.orbitCenterY];
      const theirs = [trainPlanets[index].cx - trainPlanets[index].orbitCenterX,
        trainPlanets[index].cy - trainPlanets[index].orbitCenterY];
      assert.ok(Math.hypot(mine[0] - theirs[0], mine[1] - theirs[1]) < 1e-9,
        view + ' satellite ' + index + ' : ' + mine + ' vs ' + theirs);
      // Et à la même PROFONDEUR relative : les deux vues doivent empiler les
      // satellites dans le même ordre, sinon l'une des deux ment.
      const mineDepth = planet.depth - dimPlanets[0].depth;
      const theirsDepth = trainPlanets[index].depth - trainPlanets[0].depth;
      assert.ok(Math.abs(mineDepth - theirsDepth) < 1e-9,
        view + ' satellite ' + index + ' : profondeur ' + mineDepth + ' vs ' + theirsDepth);
      assert.equal(planet.instance, index, view + ' : exemplaire non numéroté');
    });
    // Et le porte-satellites de la vue cotée connaît la même base.
    const carrier = dimensions.members.filter(m => m.role === 'carrier')[0];
    assert.ok(carrier && carrier.orbitBasis, 'le porte-satellites coté n’a pas de base');
    assert.ok(Math.abs(carrier.orbitBasis.first[0] - train.carrier.basis.first[0]) < 1e-12, view);
    assert.ok(Math.abs(carrier.orbitBasis.second[1] - train.carrier.basis.second[1]) < 1e-12, view);
  }
});

const Projection = require('../js/visualization/core/ProjectionEngine.js');

test('a point of an orbit carries its depth, not only its place on screen', () => {
  // `phasePoint` ne rend que l'écran : deux satellites diamétralement opposés
  // s'y confondent quand l'orbite est vue par la tranche, et rien ne dit lequel
  // est devant. La profondeur du point est ce qui manque.
  for (const view of ['front', 'top', 'side', 'iso', 'iso-rear']) {
    const resolved = Projection.view(view);
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [2, -1, 3]]) {
      const basis = ProjectedScene.phaseBasis(axis, resolved);
      for (let i = 0; i < 8; i++) {
        const theta = 2 * Math.PI * i / 8;
        const seen = ProjectedScene.orbitPoint(basis, 37, theta);
        // La vérité de référence : le point RÉEL de l'orbite, projeté et
        // mesuré en profondeur indépendamment de la formule testée.
        const world = [0, 1, 2].map(k =>
          37 * (Math.cos(theta) * basis.e1[k] + Math.sin(theta) * basis.e2[k]));
        const screen = Projection.project(world, resolved);
        assert.ok(Math.abs(seen.x - screen[0]) < 1e-9 && Math.abs(seen.y - screen[1]) < 1e-9,
          view + ' : le point d’orbite n’est pas celui de la projection');
        assert.ok(Math.abs(seen.depth - Projection.depth(world, resolved)) < 1e-9,
          view + ' : profondeur ' + seen.depth + ' ≠ ' + Projection.depth(world, resolved));
      }
      // Un tour complet est centré sur l'axe : ce qui s'éloigne d'un côté se
      // rapproche de l'autre, exactement.
      const round = [0, 1, 2, 3].reduce((sum, i) =>
        sum + ProjectedScene.orbitPoint(basis, 37, Math.PI * i / 2).depth, 0);
      assert.ok(Math.abs(round) < 1e-9, view + ' : orbite décentrée en profondeur');
    }
  }
});

test('each satellite has its own depth, and two opposite ones are not confused', () => {
  for (const view of VIEWS) {
    const sol = solution();
    const model = Layout.layout(sol.stages, sol.mechanical, { view });
    const entry = model.stages[0];
    const planets = entry.wheels.filter(w => w.role === 'planet');
    assert.equal(planets.length, 4);
    planets.forEach(p => assert.ok(Number.isFinite(p.depth), view + ' : satellite sans profondeur'));
    if (view === 'unfolded') continue;
    // Le repère d'orbite dit lui-même ce que chaque satellite doit valoir.
    const basis = planets[0].orbitBasis;
    planets.forEach(p => {
      const expected = ProjectedScene.orbitPoint(basis, p.orbit, p.phase).depth;
      assert.ok(Math.abs(p.depth - p.orbitDepth - expected) < 1e-9,
        view + ' : profondeur du satellite ' + p.phase.toFixed(2));
    });
    // Deux satellites qui se superposent à l'écran sont à des profondeurs
    // DIFFÉRENTES : c'est la seule chose qui permet de dire lequel est devant.
    for (let i = 0; i < planets.length; i++) {
      for (let j = i + 1; j < planets.length; j++) {
        const together = Math.hypot(planets[i].cx - planets[j].cx, planets[i].cy - planets[j].cy) < 1e-6;
        if (together) assert.ok(Math.abs(planets[i].depth - planets[j].depth) > 1,
          view + ' : deux satellites confondus à la même profondeur');
      }
    }
  }
});
