const test = require('node:test');
const assert = require('node:assert/strict');
const Scene = require('../js/visualization/core/ProjectedScene.js');
const Projection = require('../js/visualization/core/ProjectionEngine.js');
const Spatial = require('../js/visualization/core/SpatialLayout.js');
const Graph = require('../js/visualization/core/MechanicalGraph.js');
const Engineering = require('../js/core/Engineering.js');

const SPUR = (a, b) => ({ type: 'spur', input: { teeth: a }, output: { teeth: b },
  parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } });
const BEVEL = () => ({ type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 },
  parameters: { module: 2, shaftAngle: 90, pressureAngle: 20, faceWidth: 15 } });

function sceneOf(stages, view, target) {
  const solution = Engineering.analyzeSolution(stages.map(s => JSON.parse(JSON.stringify(s))),
    target || 6, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  const graph = Graph.build(solution);
  const spatial = Spatial.build(graph);
  return Scene.build(spatial, Spatial.frame(graph, { view }));
}

test('one basis answers what four calculations were answering separately', () => {
  // La phase d'une roue, l'orbite d'un satellite, les bras d'un porte-satellites
  // et le repère d'un cône étaient traités séparément, chacun en supposant une
  // vue de face. Ce sont quatre fois la même question : où se trouve un point
  // qui tourne autour d'un axe, tel qu'on le voit.
  const front = Projection.view('front');

  // Axe vers l'œil : le plan de rotation est vu de face, donc un vrai cercle.
  const facing = Scene.phaseBasis([0, 0, 1], front);
  [0, Math.PI / 3, Math.PI, 4].forEach(theta => {
    const point = Scene.phasePoint(facing, 10, theta);
    assert.ok(Math.abs(Math.hypot(point[0], point[1]) - 10) < 1e-9, 'cercle à θ=' + theta);
  });

  // Axe dans le plan de l'écran : le même cercle est vu par la tranche, donc
  // un segment. Ce n'est pas une dégénérescence à corriger, c'est ce qu'on voit.
  const edge = Scene.phaseBasis([1, 0, 0], front);
  const spread = [0, 1, 2, 3, 4, 5].map(i => Scene.phasePoint(edge, 10, i));
  const alongOne = spread.every(point => Math.abs(point[0]) < 1e-9 || Math.abs(point[1]) < 1e-9);
  assert.ok(alongOne, 'vu par la tranche, une orbite est un segment');
  assert.equal(edge.spin, 0, 'aucun sens de rotation à montrer par la tranche');

  // Obliquement : une ellipse. Son grand axe vaut le rayon, son petit axe le
  // rayon raccourci — et jamais l'inverse.
  const tilted = Scene.phaseBasis(Projection.vector.unit([1, 0, 1]), front);
  const reach = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const point = Scene.phasePoint(tilted, 10, i * Math.PI / 6);
    return Math.hypot(point[0], point[1]);
  });
  assert.ok(Math.max.apply(null, reach) <= 10 + 1e-9, 'une ellipse ne dépasse pas son rayon');
  assert.ok(Math.min.apply(null, reach) < 10 - 1e-6, 'et elle est bien aplatie');
});

test('a wheel seen from its other end turns the other way', () => {
  // C'est l'information que `abs(dot(...))` détruisait. Elle ne se reconstruit
  // pas après coup : il faut la garder, et le déterminant du repère projeté la
  // porte naturellement.
  const front = Projection.view('front');
  const toward = Scene.phaseBasis([0, 0, 1], front);
  const away = Scene.phaseBasis([0, 0, -1], front);
  assert.notEqual(toward.spin, 0);
  assert.equal(away.spin, -toward.spin, 'les deux bouts doivent s’opposer');
  // Le raccourci, lui, ne les distingue pas — et c'est normal.
  assert.equal(Projection.foreshortening([0, 0, 1], front), Projection.foreshortening([0, 0, -1], front));
});

test('every member carries how it is seen, in every view', () => {
  ['unfolded', 'front', 'top', 'side', 'iso'].forEach(view => {
    const scene = sceneOf([SPUR(15, 45), BEVEL()], view);
    assert.equal(scene.mode, view === 'unfolded' ? 'unfolded' : 'projected');
    Object.keys(scene.members).forEach(id => {
      const member = scene.member(id);
      assert.ok(Number.isFinite(member.x) && Number.isFinite(member.y), view + ' : ' + id);
      assert.ok(Number.isFinite(member.depth), view + ' : profondeur de ' + id);
      assert.ok(['face', 'profile', 'oblique'].includes(member.presentation), view + ' : ' + id);
      assert.ok([-1, 0, 1].includes(member.facing), view + ' : côté de ' + id);
      assert.ok(member.basis && member.basis.first && member.basis.second, view + ' : repère de ' + id);
      // Un organe vu de face n'a pas d'inclinaison à l'écran — DANS UNE
      // PROJECTION, où son axe pointe vers l'œil et n'a donc aucune image.
      //
      // La vue dépliée est un autre système : elle donne à chaque arbre une
      // direction de tracé, y compris quand l'axe est vu en bout, pour que les
      // organes qu'il porte s'étalent au lieu de se superposer en un point. Ce
      // qu'elle publie alors est cette direction de RANGEMENT, dont un sommet
      // de cône ou une course de crémaillère ont besoin pour se placer. La
      // présentation continue de dire, elle, que l'organe se voit en disque.
      if (view !== 'unfolded' && member.presentation === 'face') {
        assert.equal(member.axisAngleDeg, undefined, view + ' : ' + id);
      }
    });
  });
});

test('the unfolded view never leaves a shaft without a direction to lie along', () => {
  // Le premier arbre n'avait aucun repli : vu en bout, il recevait la direction
  // NULLE et tous ses organes se posaient au même point. Le renvoi qui le
  // suivait, lui, gardait sa direction projetée — un renvoi conique à 90°
  // dessinait donc ses deux arbres PARALLÈLES, et se lisait comme un montage
  // coaxial. Le défaut n'apparaissait que dans un train COMPOSÉ, parce que
  // c'est là que la vue choisie regarde l'entrée dans l'axe.
  const scene = sceneOf([SPUR(15, 45), BEVEL()], 'unfolded');
  Object.keys(scene.shafts).forEach(id => {
    const along = scene.shaft(id).along;
    assert.ok(Math.hypot(along[0], along[1]) > 1e-9, 'arbre ' + id + ' sans direction');
  });
  // Les vues `auto` et éclatée choisissent leur regard autrement : elles
  // doivent tenir la même promesse, sans quoi le défaut reviendrait par là.
  const solution = Engineering.analyzeSolution([SPUR(15, 45), BEVEL()]
    .map(s => JSON.parse(JSON.stringify(s))), 6, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  const graph = Graph.build(solution);
  [{ view: 'auto' }, { view: 'unfolded', explode: 1 }].forEach(options => {
    const seats = Spatial.frame(graph, options).seats.shafts;
    Object.keys(seats).forEach(id => {
      const along = seats[id].along;
      assert.ok(Math.hypot(along[0], along[1]) > 1e-9,
        JSON.stringify(options) + ' : arbre ' + id + ' sans direction');
    });
  });
  // Et les deux axes du renvoi ne sont pas parallèles : c'est un renvoi.
  const cones = Object.keys(scene.members).filter(id => /s1-/.test(id)).map(id => scene.member(id));
  const angles = cones.map(m => Math.round(m.axisAngleDeg || 0));
  assert.notEqual(angles[0], angles[1], 'le renvoi se dessine coaxial : ' + angles.join(' / '));
});

test('with nothing to unfold, a train seen end-on stays stacked', () => {
  // L'autre moitié de la règle, et elle compte autant. Quand TOUS les axes sont
  // parallèles, regarder dans l'axe est une vue de bout parfaitement honnête :
  // deux roues d'un même arbre y sont concentriques parce qu'elles le sont
  // vraiment. Leur inventer un écartement latéral pour « déplier » quelque
  // chose qui n'est pas plié serait un mensonge de plus, pas un de moins.
  const scene = sceneOf([SPUR(15, 45), SPUR(18, 54)], 'unfolded');
  const perShaft = {};
  Object.keys(scene.members).forEach(id => {
    const member = scene.member(id);
    (perShaft[member.shaftId] = perShaft[member.shaftId] || []).push(member);
  });
  const shared = Object.keys(perShaft).filter(id => perShaft[id].length > 1);
  assert.ok(shared.length, 'aucun arbre ne porte deux roues');
  shared.forEach(id => {
    const seats = perShaft[id];
    seats.slice(1).forEach(seat => {
      assert.ok(Math.hypot(seat.x - seats[0].x, seat.y - seats[0].y) < 1e-9,
        'arbre ' + id + ' : deux roues concentriques écartées de force');
    });
  });
});

test('depth ordering puts the far parts first, so the near ones cover them', () => {
  // Les positions 3D étaient justes, mais le SVG était peint dans l'ordre des
  // étages — ce qui ne dit rien de la profondeur. En iso, une roue arrière
  // pouvait donc recouvrir l'arbre qui est devant.
  const scene = sceneOf([SPUR(15, 45), BEVEL()], 'iso');
  const depths = scene.order.map(id => scene.member(id).depth);
  for (let i = 1; i < depths.length; i++) {
    assert.ok(depths[i] <= depths[i - 1] + 1e-9, 'du plus lointain au plus proche');
  }
  assert.equal(scene.order.length, Object.keys(scene.members).length, 'aucun organe oublié');
});

test('the scene reads positions from the frame, and never decides them', () => {
  // Le ProjectedScene ne place rien : il DÉCRIT. Si la vue est dépliée, les
  // longueurs restent vraies ; si elle est projetée, elles sont projetées. La
  // distinction appartient au repère, pas à la description.
  [['unfolded', 'unfolded'], ['iso', 'projected']].forEach(([view, mode]) => {
    const solution = Engineering.analyzeSolution([SPUR(15, 45), BEVEL()].map(s => JSON.parse(JSON.stringify(s))),
      6, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
    const graph = Graph.build(solution);
    const spatial = Spatial.build(graph);
    const frame = Spatial.frame(graph, { view });
    const scene = Scene.build(spatial, frame);
    assert.equal(scene.mode, mode);
    Object.keys(scene.members).forEach(id => {
      assert.equal(scene.member(id).x, frame.seats.byId[id].x, view + ' : ' + id);
      assert.equal(scene.member(id).y, frame.seats.byId[id].y, view + ' : ' + id);
    });
  });
});
