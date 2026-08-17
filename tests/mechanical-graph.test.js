const test = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../js/visualization/core/MechanicalGraph.js');
const Engineering = require('../js/core/Engineering.js');

// ===== Bibliothèque de transmissions de référence =====
//
// Ce sont les chaînes qui distinguent un vrai repère spatial d'un assemblage de
// dessins par étage. Chacune existe parce qu'une architecture 2D à curseur s'y
// trompe.

const SPUR = (a, b) => ({ type: 'spur', input: { teeth: a }, output: { teeth: b },
  parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } });
const WORM = () => ({ type: 'worm', wormStarts: 2, wheelTeeth: 40,
  parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } });
const BEVEL = () => ({ type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 },
  parameters: { module: 2, shaftAngle: 90, pressureAngle: 20, faceWidth: 15 } });
const PLANETARY = (input, output, fixed) => ({ type: 'planetary', sunTeeth: 24, ringTeeth: 72,
  planetTeeth: 24, planetCount: 3, inputMember: input, outputMember: output, fixed: fixed,
  parameters: { module: 2, faceWidth: 20 } });

function graphOf(stages, target) {
  return Graph.build(Engineering.analyzeSolution(stages.map(s => JSON.parse(JSON.stringify(s))),
    target || 10, { inputSpeedRpm: 1500, inputTorqueNm: 10 }));
}
function axisOf(graph, shaftId) { return graph.axisFor(shaftId); }
function parallel(a, b) { return Math.abs(Math.abs(Graph.vector.dot(a, b)) - 1) < 1e-6; }
function perpendicular(a, b) { return Math.abs(Graph.vector.dot(a, b)) < 1e-6; }

// ===== Géométrie vectorielle =====

test('a perpendicular direction is really perpendicular, whatever the axis', () => {
  [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [0, 0.3, -0.95]].forEach(direction => {
    const d = Graph.vector.unit(direction);
    [0, 45, 90, 180, 270].forEach(azimuth => {
      const p = Graph.vector.perpendicularDirection(d, azimuth);
      assert.ok(perpendicular(d, p), `${direction} @ ${azimuth}°`);
      assert.ok(Math.abs(Graph.vector.norm(p) - 1) < 1e-9, 'direction unitaire');
    });
  });
});

test('the azimuth is a property of the stage, not of its rank', () => {
  // La vue cinématique choisissait le plan du renvoi avec la PARITÉ de l'étage.
  // Deux réducteurs identiques placés à des rangs différents n'avaient donc pas
  // la même géométrie.
  const chain = stages => graphOf(stages, 80);
  const early = chain([BEVEL(), SPUR(20, 40)]);
  const late = chain([SPUR(20, 40), BEVEL(), SPUR(20, 40)]);
  const bevelAxis = g => axisOf(g, g.mechanisms.find(m => m.type === 'bevel').outputPort.shaftId).direction;
  assert.deepEqual(bevelAxis(early), bevelAxis(late), 'le renvoi tourne pareil, à n’importe quel rang');

  // Et il se pilote explicitement.
  const turned = graphOf([Object.assign(BEVEL(), { parameters: { module: 2, shaftAngle: 90, pressureAngle: 20, faceWidth: 15, azimuthDeg: 90 } })], 2);
  const turnedAxis = axisOf(turned, turned.mechanisms[0].outputPort.shaftId).direction;
  assert.notDeepEqual(turnedAxis, bevelAxis(early));
  assert.ok(perpendicular(turnedAxis, [1, 0, 0]), 'toujours un renvoi à 90°');
});

// ===== Droit → droit : deux roues sur l'arbre intermédiaire =====

test('a compound train puts two wheels on one shaft, at two positions', () => {
  const graph = graphOf([SPUR(20, 60), SPUR(15, 45)], 9);
  const middle = graph.shafts.find(s => s.members.length === 2);
  assert.ok(middle, 'l’arbre intermédiaire porte DEUX organes');
  assert.deepEqual(middle.members.map(m => m.id), ['s0-output', 's1-input']);

  // Sans abscisse ils se superposeraient : le dessin montrerait une roue là où
  // il y en a deux, et l'arbre n'aurait pas de longueur.
  const [first, second] = middle.members;
  assert.equal(first.axialPosition, 0);
  assert.ok(second.axialPosition > first.width / 2, 'la seconde est décalée le long de l’arbre');

  // Deux organes, un seul corps : même vitesse, diamètres différents.
  assert.notEqual(first.geometry.pitchDiameter, second.geometry.pitchDiameter);
  assert.deepEqual(graph.rigidBodyOf('s0-output'), ['s0-output', 's1-input']);
  assert.deepEqual(graph.rigidBodyOf('s1-input'), graph.rigidBodyOf('s0-output'));

  // Trois axes parallèles distincts, séparés par les entraxes réels.
  assert.equal(graph.axes.length, 3);
  graph.axes.forEach(axis => assert.ok(parallel(axis.direction, [1, 0, 0])));
  const origins = graph.axes.map(a => a.origin.join(','));
  assert.equal(new Set(origins).size, 3, 'aucun axe confondu');
});

// ===== Le test critique : droit → vis → droit =====

test('a worm turns the chain, and everything after it stays turned', () => {
  // C'EST le cas qui condamne un placement 2D à curseur : l'engrenage qui
  // précède la vis est vu de face, la vis de profil, et ils sont pourtant sur
  // le même arbre. Impossible sans repère spatial.
  const graph = graphOf([SPUR(20, 40), WORM(), SPUR(20, 40)], 160);
  const worm = graph.mechanisms.find(m => m.type === 'worm');
  assert.ok(worm, 'la vis est un mécanisme du graphe');

  const before = axisOf(graph, worm.inputPort.shaftId).direction;
  const after = axisOf(graph, worm.outputPort.shaftId).direction;
  assert.ok(perpendicular(before, after), 'la vis renvoie bien à 90°');

  // La vis EST sur l'arbre du pignon précédent : c'est ce que le placement 2D
  // ne pouvait pas tenir.
  assert.deepEqual(graph.rigidBodyOf('s1-input'), ['s0-output', 's1-input']);

  // Et l'étage APRÈS la vis reste sur le nouvel axe, au lieu de repartir dans
  // le plan d'origine.
  const last = graph.mechanisms[graph.mechanisms.length - 1];
  const tail = axisOf(graph, last.outputPort.shaftId).direction;
  assert.ok(parallel(tail, after), 'l’étage suivant garde l’axe de la roue');
  assert.ok(perpendicular(tail, before), 'et reste perpendiculaire à l’entrée');
});

test('two worms in a row move the frame onto a third axis', () => {
  const graph = graphOf([WORM(), WORM()], 400);
  const directions = graph.shafts.map(s => axisOf(graph, s.id).direction);
  const distinct = new Set(directions.map(d => d.join(',')));
  assert.equal(distinct.size, 3, 'trois orientations d’axe successives');
  const [first, second, third] = Array.from(distinct).map(k => k.split(',').map(Number));
  assert.ok(perpendicular(first, second));
  assert.ok(perpendicular(second, third));
});

test('a bevel keeps its right angle for the stages that follow', () => {
  const graph = graphOf([SPUR(20, 40), BEVEL(), SPUR(20, 40)], 16);
  const bevel = graph.mechanisms.find(m => m.type === 'bevel');
  const before = axisOf(graph, bevel.inputPort.shaftId).direction;
  const after = axisOf(graph, bevel.outputPort.shaftId).direction;
  assert.ok(perpendicular(before, after));
  const last = graph.mechanisms[graph.mechanisms.length - 1];
  assert.ok(parallel(axisOf(graph, last.outputPort.shaftId).direction, after));
});

// ===== Planétaires : trois corps, pas « l'entrée et tout le reste » =====

test('a planetary has three distinct coaxial bodies, and one of them is held', () => {
  const graph = graphOf([PLANETARY('S', 'C', 'R')], 4);
  const bodies = graph.rotatingBodies();
  // L'ancien modèle rangeait l'entrée sur l'arbre amont et TOUT le reste —
  // couronne, satellites, porte-satellites — sur un unique arbre de sortie.
  assert.ok(bodies.length >= 3, 'solaire, porte-satellites et satellites sont distincts');

  const held = graph.shafts.filter(s => s.grounded);
  assert.equal(held.length, 1);
  assert.deepEqual(held[0].members.map(m => m.id), ['s0-R']);
  assert.equal(held[0].angularSpeed, 0, 'un organe bloqué ne tourne pas');
  assert.deepEqual(graph.ground.memberIds, ['s0-R']);

  // Les trois corps partagent UN axe : c'est ce qui fait un train coaxial.
  const axes = new Set(['s0-S', 's0-R', 's0-C'].map(id => graph.shaftFor(id).axisId));
  assert.equal(axes.size, 1);

  // Les satellites sont un corps à part, PORTÉ par le porte-satellites : ils
  // tournent sur eux-mêmes tout en orbitant.
  const planets = graph.shafts.find(s => s.role === 'planet');
  assert.equal(planets.carriedBy, graph.shaftFor('s0-C').id);
  assert.equal(planets.count, 3);
  assert.notEqual(planets.angularSpeed, graph.shaftFor('s0-C').angularSpeed);
});

test('the three planetary topologies produce three different structures', () => {
  const describe = (i, o, f) => {
    const graph = graphOf([PLANETARY(i, o, f)], 3);
    const port = key => graph.mechanisms[0][key];
    return {
      input: port('inputPort').memberId,
      output: port('outputPort').memberId,
      fixed: port('fixedPort').memberId,
      grounded: graph.shafts.filter(s => s.grounded).flatMap(s => s.members.map(m => m.id)),
      carrier: graph.shafts.find(s => s.role === 'planet').carriedBy
    };
  };
  const a = describe('S', 'C', 'R'), b = describe('R', 'S', 'C'), c = describe('C', 'R', 'S');
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(b, c);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a.grounded, ['s0-R']);
  assert.deepEqual(b.grounded, ['s0-C']);
  assert.deepEqual(c.grounded, ['s0-S']);
});

test('whatever member carries the output, the next stage continues from it', () => {
  // Une couronne de sortie entraîne l'étage suivant exactement comme un
  // porte-satellites de sortie : le raccord doit suivre la FONCTION.
  [['S', 'C', 'R'], ['R', 'S', 'C'], ['C', 'R', 'S']].forEach(([input, output, fixed]) => {
    const graph = graphOf([PLANETARY(input, output, fixed), SPUR(20, 40)], 8);
    const outputMember = 's0-' + output;
    assert.ok(graph.rigidBodyOf(outputMember).includes('s1-input'),
      `${output} en sortie doit porter l’étage suivant`);
    // Et l'organe bloqué ne porte jamais la suite.
    assert.ok(!graph.rigidBodyOf('s0-' + fixed).includes('s1-input'));
  });
});

// ===== Invariants généraux =====

test('every member belongs to exactly one body, and no body is invented', () => {
  const chains = [
    [SPUR(20, 60)], [SPUR(20, 60), SPUR(15, 45)], [WORM()], [SPUR(20, 40), WORM(), SPUR(20, 40)],
    [BEVEL()], [PLANETARY('S', 'C', 'R')], [PLANETARY('C', 'R', 'S'), SPUR(20, 40)],
    [{ type: 'belt', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { pitch: 5, centerDistance: 150, profile: 'HTD-5M' } }],
    [{ type: 'rack', pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } }]
  ];
  chains.forEach((stages, n) => {
    const graph = graphOf(stages, 20);
    const placed = graph.shafts.flatMap(s => s.members.map(m => m.id));
    assert.equal(new Set(placed).size, placed.length, `chaîne ${n} : aucun membre en double`);
    graph.shafts.forEach(shaft => {
      assert.ok(graph.byAxis[shaft.axisId], `chaîne ${n} : ${shaft.id} doit avoir un axe`);
      shaft.members.forEach(member => {
        assert.equal(graph.shaftFor(member.id).id, shaft.id);
        assert.ok(Number.isFinite(member.axialPosition));
      });
    });
    // Un arbre sans organe ne représente rien : il n'en reste aucun.
    assert.equal(graph.shafts.filter(s => !s.members.length && s.id !== 'shaft-in').length, 0,
      `chaîne ${n} : aucun arbre vide`);
    // Une entrée et une sortie, toujours nommées.
    assert.ok(graph.shafts.some(s => s.role === 'input'));
    if (graph.shafts.length > 1) assert.ok(graph.shafts.some(s => s.role === 'output'));
  });
});

test('a rack translates, it does not turn', () => {
  const graph = graphOf([{ type: 'rack', pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } }], 1);
  assert.equal(graph.slides.length, 1);
  const slide = graph.slides[0];
  const pinionAxis = axisOf(graph, graph.mechanisms[0].inputPort.shaftId).direction;
  assert.ok(perpendicular(slide.direction, pinionAxis), 'la course est perpendiculaire à l’axe du pignon');
  assert.ok(Number.isFinite(slide.travelPerRevolution));
  // La crémaillère n'est pas un corps tournant : elle n'apparaît sur aucun arbre.
  assert.ok(!graph.shafts.some(s => s.members.some(m => m.kind === 'rack')));
});

test('an empty or unusable solution yields an empty graph rather than throwing', () => {
  [null, {}, { stages: [] }].forEach(solution => {
    const graph = Graph.build(solution);
    assert.equal(graph.shafts.length, 1, 'seul l’arbre d’entrée existe');
    assert.deepEqual(graph.mechanisms, []);
    assert.deepEqual(graph.ground.memberIds, []);
    assert.deepEqual(graph.rigidBodyOf('inexistant'), []);
    assert.equal(graph.shaftFor('inexistant'), null);
  });
});

test('speeds come from the engine, never from a local recomputation', () => {
  const solution = Engineering.analyzeSolution([SPUR(20, 60), SPUR(15, 45)], 9,
    { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  const graph = Graph.build(solution);
  graph.shafts.forEach(shaft => {
    shaft.members.forEach(member => {
      if (member.mechanical.rpm == null) return;
      assert.equal(shaft.angularSpeed, member.mechanical.rpm,
        shaft.id + ' tourne à la vitesse que le moteur donne à ses organes');
    });
  });
  // Sans régime, rien n'est inventé : les vitesses restent nulles au sens strict.
  const silent = Graph.build(Engineering.analyzeSolution([SPUR(20, 60)], 3, {}));
  assert.equal(silent.shafts[0].angularSpeed, null);
});
