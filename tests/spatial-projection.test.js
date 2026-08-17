const test = require('node:test');
const assert = require('node:assert/strict');
const Projection = require('../js/visualization/core/ProjectionEngine.js');
const Spatial = require('../js/visualization/core/SpatialLayout.js');
const Graph = require('../js/visualization/core/MechanicalGraph.js');
const Engineering = require('../js/core/Engineering.js');

const { dot, cross, unit, norm } = Projection.vector;

const SPUR = (a, b) => ({ type: 'spur', input: { teeth: a }, output: { teeth: b },
  parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } });
const WORM = () => ({ type: 'worm', wormStarts: 2, wheelTeeth: 40,
  parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } });
const BEVEL = () => ({ type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 },
  parameters: { module: 2, shaftAngle: 90, pressureAngle: 20, faceWidth: 15 } });

function layoutOf(stages, target) {
  const solution = Engineering.analyzeSolution(stages.map(s => JSON.parse(JSON.stringify(s))),
    target || 10, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  return Spatial.build(Graph.build(solution));
}

// ===== Les bases de projection =====

test('every view is a real orthonormal frame, not an ad hoc formula', () => {
  // L'ancienne « vue orthogonale » faisait x = X, y = Z : elle supprimait Y.
  // Ce n'est pas un point de vue, c'est une perte d'information.
  Projection.VIEWS.forEach(view => {
    assert.ok(Math.abs(norm(view.u) - 1) < 1e-9, view.id + ' : u unitaire');
    assert.ok(Math.abs(norm(view.v) - 1) < 1e-9, view.id + ' : v unitaire');
    assert.ok(Math.abs(norm(view.w) - 1) < 1e-9, view.id + ' : w unitaire');
    assert.ok(Math.abs(dot(view.u, view.v)) < 1e-9, view.id + ' : u ⟂ v');
    assert.ok(Math.abs(dot(view.u, view.w)) < 1e-9, view.id + ' : u ⟂ w');
    assert.ok(Math.abs(dot(view.v, view.w)) < 1e-9, view.id + ' : v ⟂ w');
  });
});

test('a projection loses only the depth, never a whole coordinate', () => {
  // Un point qui ne diffère QUE le long du regard se projette au même endroit ;
  // un point qui diffère dans le plan de l'écran, jamais.
  Projection.VIEWS.forEach(view => {
    const base = [3, -5, 7];
    const deeper = base.map((c, i) => c + view.w[i] * 12);
    const [flat, far] = [Projection.project(base, view), Projection.project(deeper, view)];
    // Tolérance plutôt qu'égalité : une base orthonormée donne un résidu de
    // l'ordre de 1e-16, et `-0` n'est pas strictement `0`.
    assert.ok(Math.hypot(flat[0] - far[0], flat[1] - far[1]) < 1e-9,
      view.id + ' : la profondeur ne doit rien déplacer');
    [view.u, view.v].forEach(direction => {
      const moved = base.map((c, i) => c + direction[i] * 4);
      const [a, b] = [Projection.project(base, view), Projection.project(moved, view)];
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 3.9, view.id + ' : un déplacement à l’écran se voit');
    });
  });
});

test('a wheel is a disc only when its axis points at the viewer', () => {
  // Une roue était presque toujours dessinée en cercle. C'est juste de face, et
  // faux partout ailleurs — d'où l'impossibilité de montrer un engrenage et une
  // vis sur le même arbre.
  const front = Projection.view('front');
  assert.equal(Projection.presentation([0, 0, 1], front), 'face');
  assert.equal(Projection.presentation([1, 0, 0], front), 'profile');
  assert.equal(Projection.presentation([0, 1, 0], front), 'profile');
  assert.equal(Projection.presentation(unit([1, 0, 1]), front), 'oblique');

  // Vue de côté, c'est l'inverse : ce qui était de face devient un rectangle.
  const side = Projection.view('side');
  assert.equal(Projection.presentation([1, 0, 0], side), 'face');
  assert.equal(Projection.presentation([0, 0, 1], side), 'profile');

  // Le raccourci vaut 1 de face et 0 de profil : c'est le petit axe apparent.
  assert.ok(Math.abs(Projection.foreshortening([0, 0, 1], front) - 1) < 1e-9);
  assert.ok(Projection.foreshortening([1, 0, 0], front) < 1e-9);
});

test('the automatic view answers what there is to understand', () => {
  const axes = list => list.map(direction => ({ direction }));
  // Axes tous parallèles : de face, on voit les engrènements.
  assert.equal(Projection.auto(axes([[1, 0, 0], [1, 0, 0], [1, 0, 0]])).id, 'front');
  // Un seul renvoi : la vue qui contient les deux axes.
  const single = Projection.auto(axes([[1, 0, 0], [0, 0, 1]]));
  assert.notEqual(single.id, 'iso');
  assert.ok(Math.abs(dot(single.w, unit(cross([1, 0, 0], [0, 0, 1])))) > 0.9,
    'le regard est perpendiculaire au plan des deux axes');
  // Plusieurs renvois : aucune vue plane ne suffit.
  assert.equal(Projection.auto(axes([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).id, 'iso');
  assert.equal(Projection.auto([]).id, 'front');
});

test('the automatic view never hides what separates two parallel shafts', () => {
  // Une première version ne notait que les DIRECTIONS d'axes. Deux étages
  // parallèles ont la même direction : ce qui les distingue est leur entraxe.
  // Elle pouvait donc élire une vue où deux arbres se confondent — les roues
  // d'un train à deux étages se retrouvaient l'une sur l'autre.
  const chain = [
    { direction: [1, 0, 0], origin: [0, 0, 0] },
    { direction: [1, 0, 0], origin: [0, -80, 0] },     // entraxe suivant Y
    { direction: [0, 0, 1], origin: [0, -80, 0] }      // puis un renvoi
  ];
  const chosen = Projection.auto(chain);
  // « Dessus » (regard suivant Y) écraserait justement l'entraxe.
  assert.notEqual(chosen.id, 'top');
  // Quelle que soit la vue retenue, les deux axes parallèles restent séparés
  // à l'écran, et aucun axe n'est vu en bout.
  const seen = Math.hypot(dot([0, -80, 0], chosen.u), dot([0, -80, 0], chosen.v));
  assert.ok(seen > 1, 'l’entraxe doit rester visible');
  chain.forEach(axis => {
    assert.ok(Math.abs(dot(axis.direction, chosen.w)) < 0.99, 'aucun axe réduit à un point');
  });
});

// ===== Le placement spatial =====

test('a member sits on its axis, at its abscissa — and nowhere else', () => {
  const layout = layoutOf([SPUR(20, 60), SPUR(15, 45)], 9);
  layout.members.forEach(member => {
    const axis = layout.graph.byAxis[member.axisId];
    const expected = axis.origin.map((o, i) => o + axis.direction[i] * member.axialPosition);
    member.position.forEach((c, i) => assert.ok(Math.abs(c - expected[i]) < 1e-9, member.id));
  });
  // Les deux organes de l'arbre intermédiaire sont à des endroits différents.
  const middle = layout.shafts.find(s => s.memberIds.length === 2);
  const [a, b] = middle.memberIds.map(id => layout.byId[id]);
  assert.notDeepEqual(a.position, b.position);
  // Et l'arbre a une longueur, au lieu d'être un trait entre deux centres.
  assert.ok(middle.length > b.axialPosition - a.axialPosition);
});

test('changing the view moves pixels, never parts', () => {
  // C'est l'invariant central : une vue est un point de vue, pas un placement.
  const layout = layoutOf([SPUR(20, 40), WORM(), SPUR(20, 40)], 160);
  const reference = layout.members.map(m => m.position.join(','));
  Projection.VIEWS.forEach(view => {
    const projected = Spatial.project(layout, view.id);
    assert.deepEqual(projected.members.map(m => m.position.join(',')), reference,
      view.id + ' : aucune pièce ne bouge');
    // Les organes d'un même arbre restent coaxiaux dans toutes les vues : leurs
    // centres projetés sont alignés sur la direction projetée de l'arbre.
    projected.shafts.forEach(shaft => {
      if (shaft.memberIds.length < 2) return;
      const points = shaft.memberIds.map(id => projected.byId[id]);
      const dx = shaft.x2 - shaft.x1, dy = shaft.y2 - shaft.y1;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) return;   // arbre vu en bout : tout se superpose, c'est juste
      points.forEach(point => {
        const offset = Math.abs((point.cx - shaft.x1) * dy - (point.cy - shaft.y1) * dx) / length;
        assert.ok(offset < 1e-6, view.id + ' : ' + point.id + ' doit rester sur son arbre');
      });
    });
  });
});

test('perpendicular axes stay perpendicular in the world, in every view', () => {
  const layout = layoutOf([SPUR(20, 40), WORM(), SPUR(20, 40)], 160);
  const directions = layout.graph.axes.map(a => a.direction);
  const worm = layout.graph.mechanisms.find(m => m.type === 'worm');
  const before = layout.graph.axisFor(worm.inputPort.shaftId).direction;
  const after = layout.graph.axisFor(worm.outputPort.shaftId).direction;
  assert.ok(Math.abs(dot(before, after)) < 1e-9);
  // Projeter ne modifie pas le monde : la vérification porte sur le modèle, et
  // reste vraie quelle que soit la vue affichée.
  Projection.VIEWS.forEach(view => {
    Spatial.project(layout, view.id);
    assert.deepEqual(layout.graph.axes.map(a => a.direction), directions, view.id);
  });
});

test('a worm reads as a cylinder from the side and as a disc from the front', () => {
  const layout = layoutOf([WORM()], 20);
  const worm = layout.members.find(m => m.kind === 'worm');
  assert.ok(worm, 'la vis est placée');
  // De face — l'axe d'entrée est X, donc dans le plan de l'écran — elle se voit
  // de profil : c'est la vue latérale attendue pour un couple vis-roue.
  assert.equal(Spatial.project(layout, 'front').byId[worm.id].presentation, 'profile');
  // Vue de côté, on regarde le long de X : la vis se présente en bout.
  assert.equal(Spatial.project(layout, 'side').byId[worm.id].presentation, 'face');
});

test('the automatic view of a right-angle chain contains both axes', () => {
  const layout = layoutOf([SPUR(20, 40), BEVEL()], 4);
  const view = Spatial.autoView(layout);
  const directions = layout.graph.axes.map(a => a.direction);
  // Chaque axe doit être visible, c'est-à-dire non aligné avec le regard.
  directions.forEach(direction => {
    assert.ok(Math.abs(dot(direction, view.w)) < 0.99,
      'un axe aligné avec le regard se réduirait à un point');
  });
});

test('the frame of a projected scene never collapses, whatever the chain', () => {
  const chains = [
    [SPUR(20, 60)], [SPUR(20, 60), SPUR(15, 45)], [WORM()], [SPUR(20, 40), WORM(), SPUR(20, 40)],
    [BEVEL()], [WORM(), WORM()],
    [{ type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 3,
      inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2, faceWidth: 20 } }]
  ];
  chains.forEach((stages, n) => {
    const layout = layoutOf(stages, 40);
    Projection.VIEWS.forEach(view => {
      const projected = Spatial.project(layout, view.id);
      const box = projected.bounds;
      assert.ok(box.width > 0 && box.height > 0, `chaîne ${n} / ${view.id}`);
      assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y), `chaîne ${n} / ${view.id}`);
      projected.members.forEach(member => {
        assert.ok(Number.isFinite(member.cx) && Number.isFinite(member.cy), member.id + ' / ' + view.id);
      });
    });
  });
});

test('an empty layout projects to something drawable rather than throwing', () => {
  const empty = Spatial.build(Graph.build({ stages: [] }));
  assert.deepEqual(empty.members, []);
  const projected = Spatial.project(empty, 'front');
  assert.deepEqual(projected.members, []);
  assert.ok(projected.bounds.width > 0);
  assert.equal(Spatial.build(null).members.length, 0);
});

test('unfolding keeps every mesh at its true centre distance', () => {
  // Projeter aussi les longueurs est irréprochable et illisible : une vue
  // oblique raccourcit les entraxes, et deux roues dessinées en cercles à un
  // entraxe raccourci se chevauchent — un engrènement qu'on lit comme cassé.
  // On garde donc les directions de la projection et les longueurs vraies.
  const chains = [
    [[SPUR(20, 60), SPUR(15, 45)], 9],
    [[SPUR(20, 40), WORM(), SPUR(20, 40)], 160],
    [[SPUR(20, 40), BEVEL()], 4],
    [[WORM(), WORM()], 400]
  ];
  chains.forEach(([stages, target]) => {
    const layout = layoutOf(stages, target);
    Projection.VIEWS.forEach(view => {
      const frame = Spatial.unfold(layout, view.id);
      layout.graph.mechanisms.forEach(mechanism => {
        if (!mechanism.outputPort || !mechanism.outputPort.shaftId) return;
        const a = frame.byId[mechanism.inputPort.memberId];
        const b = frame.byId[mechanism.outputPort.memberId];
        if (!a || !b) return;
        const inAxis = layout.graph.axisFor(mechanism.inputPort.shaftId);
        const outAxis = layout.graph.axisFor(mechanism.outputPort.shaftId);
        const truth = Math.hypot(outAxis.origin[0] - inAxis.origin[0],
          outAxis.origin[1] - inAxis.origin[1], outAxis.origin[2] - inAxis.origin[2]);
        if (truth < 1e-6) return;                 // étage coaxial : pas d'entraxe
        const drawn = Math.hypot(b.x - a.x, b.y - a.y);
        assert.ok(Math.abs(drawn - truth) < 1e-6,
          `${view.id} : entraxe dessiné ${drawn.toFixed(2)} pour ${truth.toFixed(2)}`);
      });
    });
  });
});

test('unfolding closes every shaft joint, instead of drifting', () => {
  // C'est le défaut qu'ancrer chaque étage indépendamment sur sa position
  // projetée produisait : la position venait de la projection, la longueur du
  // calcul, et deux organes d'un même arbre ne se rejoignaient plus.
  const layout = layoutOf([SPUR(20, 40), WORM(), SPUR(20, 40)], 160);
  Projection.VIEWS.forEach(view => {
    const frame = Spatial.unfold(layout, view.id);
    layout.shafts.forEach(shaft => {
      if (shaft.memberIds.length < 2) return;
      const drawn = shaft.memberIds.map(id => frame.byId[id]).filter(Boolean);
      if (drawn.length < 2) return;
      const seat = frame.shafts[shaft.id];
      const spacing = Math.hypot(drawn[1].x - drawn[0].x, drawn[1].y - drawn[0].y);
      const axial = Math.abs(layout.byId[shaft.memberIds[1]].axialPosition
        - layout.byId[shaft.memberIds[0]].axialPosition);
      // Deux organes solidaires sont écartés de leur écart axial réel — sauf
      // dans une vue où l'arbre pointe vers l'œil, où ils se superposent parce
      // que c'est ce que cette vue montre.
      const endOn = Math.hypot(seat.along[0], seat.along[1]) < 1e-9;
      assert.ok(endOn || Math.abs(spacing - axial) < 1e-6,
        `${view.id} / ${shaft.id} : ${spacing.toFixed(2)} pour ${axial.toFixed(2)}`);
    });
  });
});

test('every member of the chain gets a seat, in every view', () => {
  const layout = layoutOf([SPUR(20, 40), WORM(), SPUR(20, 40)], 160);
  Projection.VIEWS.forEach(view => {
    const frame = Spatial.unfold(layout, view.id);
    layout.members.forEach(member => {
      const seat = frame.byId[member.id];
      assert.ok(seat, `${view.id} : ${member.id} doit être placé`);
      assert.ok(Number.isFinite(seat.x) && Number.isFinite(seat.y), member.id);
    });
  });
  assert.deepEqual(Spatial.unfold(null, 'front').byId, {});
});
