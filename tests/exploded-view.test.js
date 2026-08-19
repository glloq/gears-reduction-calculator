const test = require('node:test');
const assert = require('node:assert/strict');
const Explode = require('../js/visualization/core/ExplodedView.js');
const SpatialLayout = require('../js/visualization/core/SpatialLayout.js');
const Graph = require('../js/visualization/core/MechanicalGraph.js');
const Projection = require('../js/visualization/core/ProjectionEngine.js');
const Engineering = require('../js/core/Engineering.js');

const SPUR = (a, b) => ({ type: 'spur', input: { teeth: a }, output: { teeth: b },
  parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } });
const PLANETARY = () => ({ type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24,
  planetCount: 3, inputMember: 'S', outputMember: 'C', fixed: 'R',
  parameters: { module: 2, faceWidth: 20 } });
const BEVEL = () => ({ type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 },
  parameters: { module: 2, shaftAngle: 90, pressureAngle: 20, faceWidth: 15 } });

function graphOf(stages, target) {
  return Graph.build(Engineering.analyzeSolution(stages.map(s => JSON.parse(JSON.stringify(s))),
    target || 10, { inputSpeedRpm: 1500, inputTorqueNm: 10 }));
}
const seats = graph => SpatialLayout.build(graph);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('exploding never touches the mechanism it draws', () => {
  // C'est la règle qui rend l'éclaté acceptable dans un logiciel de calcul :
  // un écartement de DESSIN ne doit laisser aucune trace dans le modèle, sans
  // quoi une cote relevée plus tard hériterait d'une distance inventée.
  const graph = graphOf([PLANETARY(), PLANETARY()], 16);
  const before = JSON.stringify(graph);
  const layout = seats(graph);
  const opened = Explode.apply(layout, { explode: true });
  assert.equal(JSON.stringify(graph), before, 'le graphe mécanique a été modifié');
  // Et le placement d'origine non plus : les deux coexistent.
  layout.members.forEach((member, i) => {
    assert.equal(member.axialPosition, seats(graph).members[i].axialPosition);
  });
  assert.notEqual(opened.members, layout.members);
  assert.ok(opened.members.some((m, i) => m.axialPosition !== layout.members[i].axialPosition));
});

test('an organ slides along its own axis, and nowhere else', () => {
  // Un éclaté qui déplacerait une roue EN TRAVERS de son axe changerait un
  // entraxe : le dessin montrerait un engrènement qui n'existe pas.
  const graph = graphOf([BEVEL(), SPUR(20, 40)], 8);
  const layout = seats(graph);
  const opened = Explode.apply(layout, { explode: true });
  opened.members.forEach((member, i) => {
    const from = layout.members[i];
    const move = [member.position[0] - from.position[0], member.position[1] - from.position[1],
      member.position[2] - from.position[2]];
    const along = move[0] * from.axis[0] + move[1] * from.axis[1] + move[2] * from.axis[2];
    const across = [move[0] - from.axis[0] * along, move[1] - from.axis[1] * along,
      move[2] - from.axis[2] * along];
    assert.ok(Math.hypot(across[0], across[1], across[2]) < 1e-9,
      member.id + ' a bougé en travers de son axe');
  });
});

test('bodies sharing one plane are the ones the explosion separates', () => {
  // Le cas qui justifie la commande : planétaire, couronne, porte-satellites et
  // satellite d'un même étage sont RÉELLEMENT au même plan. Aucun cadrage, aucun
  // point de vue ne les sépare — seul un écartement le peut.
  const graph = graphOf([PLANETARY()], 4);
  const layout = seats(graph);
  const stacked = layout.members.filter(m => Math.abs(m.axialPosition) < 1e-9);
  assert.ok(stacked.length >= 4, 'le cas de départ n’empile plus rien');
  const opened = Explode.apply(layout, { explode: true });
  const places = stacked.map(m => opened.byId[m.id].axialPosition).sort((a, b) => a - b);
  for (let i = 1; i < places.length; i++) {
    assert.ok(places[i] - places[i - 1] > 1e-6,
      'deux organes du même plan sont restés confondus');
  }
  // Le satellite tourne autour d'un axe qui lui est propre, mais confondu avec
  // celui de son étage : le laisser sur place pendant que le reste s'écarte
  // ferait perdre l'étage au lieu de le montrer.
  const planet = layout.members.filter(m => m.memberRole === 'P')[0];
  assert.ok(planet, 'pas de satellite dans ce train');
  assert.notEqual(opened.byId[planet.id].axialPosition, planet.axialPosition);
});

test('the drawing does not drift: it opens around its middle', () => {
  // Un éclaté qui pousserait tout dans un sens sortirait du cadrage et
  // demanderait de recentrer à chaque fois.
  const graph = graphOf([PLANETARY(), PLANETARY()], 16);
  const layout = seats(graph);
  const opened = Explode.apply(layout, { explode: true });
  const mean = list => list.reduce((sum, m) => sum + m.axialPosition, 0) / list.length;
  assert.ok(Math.abs(mean(opened.members) - mean(layout.members)) < 1e-9);
});

test('the step comes from what has to clear, not from a count of stages', () => {
  // « Décaler le second étage de 30 » dirait quelque chose de faux sur la
  // machine, et raterait le train dont les roues font 60 de large. Le pas suit
  // la LARGEUR des organes.
  const thin = Explode.offsets(seats(graphOf([PLANETARY()], 4)), { explode: 1 });
  const wide = Explode.offsets(seats(graphOf([Object.assign(PLANETARY(),
    { parameters: { module: 2, faceWidth: 60 } })], 4)), { explode: 1 });
  assert.ok(wide.step > thin.step * 2, `${wide.step} vs ${thin.step}`);
  // Le pas dégage réellement : il dépasse la largeur qu'il doit séparer.
  const widest = seats(graphOf([PLANETARY()], 4)).members
    .reduce((max, m) => Math.max(max, m.width), 0);
  assert.ok(thin.step > widest, `pas de ${thin.step} pour des organes de ${widest} de large`);
  // Et il suit l'intensité demandée : à moitié ouvert, moitié moins écarté.
  assert.ok(Math.abs(Explode.offsets(seats(graphOf([PLANETARY()], 4)),
    { explode: 0.5 }).step - thin.step / 2) < 1e-9);
});

test('an organ alone on its line has nothing to move away from', () => {
  // Écarter une roue de personne ne ferait que la sortir de son arbre.
  const graph = graphOf([SPUR(20, 60), SPUR(18, 54)], 9);
  const layout = seats(graph);
  const plan = Explode.offsets(layout, { explode: true });
  const lonely = layout.members.filter(m =>
    layout.members.filter(other => other.axisId === m.axisId).length === 1);
  assert.ok(lonely.length, 'ce train n’a aucun organe seul sur sa ligne');
  lonely.forEach(m => assert.equal(plan.byId[m.id], undefined, m.id + ' a été écarté seul'));
  // Les deux roues qui PARTAGENT l'arbre intermédiaire, elles, se dégagent.
  const shared = layout.members.filter(m => m.shaftId === 'shaft-1');
  assert.equal(shared.length, 2);
  assert.ok(Math.abs(plan.byId[shared[0].id] - plan.byId[shared[1].id]) > 1e-6);
});

test('a shaft follows what it carries', () => {
  // Deux roues qui s'éloignent sur un arbre qui, lui, resterait court : la
  // seconde flotterait dans le vide.
  const graph = graphOf([SPUR(20, 60), SPUR(18, 54)], 9);
  const layout = seats(graph);
  const opened = Explode.apply(layout, { explode: true });
  const before = layout.shafts.filter(s => s.id === 'shaft-1')[0];
  const after = opened.shafts.filter(s => s.id === 'shaft-1')[0];
  assert.ok(after.length > before.length, `${after.length} vs ${before.length}`);
  // Chaque organe reste SUR son arbre, entre les deux bouts.
  opened.members.forEach(member => {
    const shaft = opened.shafts.filter(s => s.memberIds.indexOf(member.id) >= 0)[0];
    if (!shaft) return;
    const span = distance(shaft.start, shaft.end);
    assert.ok(distance(shaft.start, member.position) <= span + 1e-6
      && distance(shaft.end, member.position) <= span + 1e-6,
    member.id + ' est sorti de son arbre');
  });
});

test('asking for nothing gives back exactly the same placement', () => {
  const layout = seats(graphOf([PLANETARY()], 4));
  [undefined, false, 0, 'non'].forEach(asked => {
    assert.equal(Explode.apply(layout, { explode: asked }), layout, String(asked));
    assert.equal(Explode.offsets(layout, { explode: asked }).active, false);
  });
  assert.equal(Explode.amountOf({ explode: true }), 1);
  assert.equal(Explode.amountOf({ explode: 0.4 }), 0.4);
});

test('two axes can be one line even when they carry different names', () => {
  const line = { origin: [0, 0, 0], direction: [1, 0, 0] };
  assert.ok(Explode.sameLine(line, { origin: [50, 0, 0], direction: [1, 0, 0] }));
  // Parallèles mais décalées en travers : deux lignes.
  assert.equal(Explode.sameLine(line, { origin: [0, 30, 0], direction: [1, 0, 0] }), false);
  // Sécantes : deux lignes aussi.
  assert.equal(Explode.sameLine(line, { origin: [0, 0, 0], direction: [0, 1, 0] }), false);
});

test('the frame carries the notice, because this drawing must not be measured', () => {
  const graph = graphOf([PLANETARY(), PLANETARY()], 16);
  const closed = SpatialLayout.frame(graph, { view: 'iso' });
  const open = SpatialLayout.frame(graph, { view: 'iso', explode: true });
  assert.equal(closed.exploded, null);
  assert.equal(open.exploded.notice, 'Vue éclatée — espacement non à l’échelle');
  assert.equal(open.exploded.visible, true);
  // Regardé DANS l'axe, l'écartement se projette sur un point : le dessin est
  // identique au dessin fermé, et la vue doit pouvoir le dire plutôt que de
  // laisser croire à une commande sans effet.
  const endOn = SpatialLayout.frame(graph, { view: 'side', explode: true });
  assert.equal(endOn.exploded.visible, false);
  assert.ok(Math.hypot.apply(null, Projection.project([1, 0, 0], endOn.view)) < 1e-9);
});

test('the exploded drawing really spreads, in both drawing systems', () => {
  // Le contrat de bout en bout : ce que les vues reçoivent — les sièges — doit
  // changer, dans la vue dépliée comme dans une projection.
  const graph = graphOf([PLANETARY(), PLANETARY()], 16);
  ['unfolded', 'iso', 'front'].forEach(view => {
    const closed = SpatialLayout.frame(graph, { view: view });
    const open = SpatialLayout.frame(graph, { view: view, explode: true });
    const spread = list => {
      const xs = Object.keys(list.seats.byId).map(id => list.seats.byId[id].x);
      return Math.max.apply(null, xs) - Math.min.apply(null, xs);
    };
    assert.ok(spread(open) > spread(closed) + 1, view + ' : rien ne s’est écarté');
    // Aucune pièce n'a disparu ni n'a été inventée.
    assert.deepEqual(Object.keys(open.seats.byId).sort(), Object.keys(closed.seats.byId).sort());
  });
});

test('an exploded view is not looked at down the axis', () => {
  // La vue dépliée retient d'ordinaire le regard qui montre le plus de
  // denture : pour un train d'axes parallèles, c'est celui qui les voit EN
  // BOUT, où les organes se superposent. Y écarter le long d'une direction qui
  // se projette sur un point ne montrerait rien.
  const graph = graphOf([PLANETARY(), PLANETARY()], 16);
  const closed = SpatialLayout.frame(graph, { view: 'unfolded' });
  const open = SpatialLayout.frame(graph, { view: 'unfolded', explode: true });
  assert.ok(Math.hypot.apply(null, Projection.project([1, 0, 0], closed.view)) < 1e-9,
    'le cas de départ ne regarde plus les axes en bout');
  assert.ok(Math.hypot.apply(null, Projection.project([1, 0, 0], open.view)) > 1e-6);
  assert.equal(open.exploded.visible, true);
  // Et le dessin fermé n'a pas changé de point de vue pour autant.
  assert.equal(closed.view.id, 'side');
});
