const test = require('node:test');
const assert = require('node:assert/strict');
const Flexible = require('../js/visualization/core/FlexibleDriveGeometry.js');
const Geometry = require('../js/visualization/core/GeometryUtils.js');
const Projection = require('../js/visualization/core/ProjectionEngine.js');
const Layout = require('../js/visualization/TrainLayout.js');
const GeometryLayout = require('../js/visualization/geometry/GeometryLayout.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

function stage(type, config) {
  const def = Registry.get(type);
  const s = Object.assign({ type: type, parameters: { module: 1 } }, config);
  s.geometry = def.calculateGeometry(s);
  return s;
}
function beltStage() {
  return stage('belt', { input: { teeth: 20 }, output: { teeth: 60 },
    parameters: { module: 2, pitch: 5, centerDistance: 120 } });
}
const MECH = [{ ratio: 3, signedRatio: 3, efficiency: 0.97 }];
const VIEWS = ['unfolded', 'front', 'top', 'side', 'iso'];

test('a belt is built in the plane of its pulleys, never along the screen', () => {
  // Deux poulies décalées EN DIAGONALE dans leur plan. Le tracé reconstruit
  // posait la seconde à (x + entraxe, y) : le brin partait donc à
  // l'horizontale, quel que soit le mécanisme.
  const g = Flexible.build({ axis: [0, 0, 1], centre1: [0, 0, 0], centre2: [60, 80, 0],
    r1: 20, r2: 40, view: 'front' });
  assert.ok(g, 'géométrie construite');
  assert.ok(Math.abs(g.distance - 100) < 1e-9, 'entraxe réel : ' + g.distance);
  // La seconde poulie est là où le modèle la met, pas à droite de la première.
  const drawn2 = Projection.project([60, 80, 0], 'front');
  assert.ok(Math.hypot(g.centre2[0] - drawn2[0], g.centre2[1] - drawn2[1]) < 1e-9);
  assert.ok(Math.abs(g.centre2[1] - g.centre1[1]) > 1, 'la courroie est restée à plat');
});

test('what a belt measures does not depend on where you stand', () => {
  const reference = Flexible.build({ axis: [0, 0, 1], centre1: [0, 0, 0], centre2: [60, 80, 0],
    r1: 20, r2: 40, view: 'side' });
  const outlines = new Set();
  for (const id of ['front', 'top', 'side', 'iso']) {
    const g = Flexible.build({ axis: [0, 0, 1], centre1: [0, 0, 0], centre2: [60, 80, 0],
      r1: 20, r2: 40, view: id });
    assert.ok(Math.abs(g.length - reference.length) < 1e-9, 'longueur en ' + id);
    assert.ok(Math.abs(g.wrapAngle1Deg - reference.wrapAngle1Deg) < 1e-9, 'enroulement en ' + id);
    assert.ok(Math.abs(g.distance - reference.distance) < 1e-9, 'entraxe en ' + id);
    outlines.add(g.outline);
  }
  // Les grandeurs mécaniques ne bougent pas ; le DESSIN, lui, change.
  assert.ok(outlines.size > 1, 'toutes les vues dessinent le même tracé');
});

test('the belt plane is the plane of the pulleys, and nothing else', () => {
  const g = Flexible.build({ axis: [0, 0, 1], centre1: [0, 0, 0], centre2: [60, 80, 0],
    r1: 20, r2: 40, view: 'iso' });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => Math.hypot(a[0], a[1], a[2]);
  // Deux directions unitaires, orthogonales entre elles ET à l'axe : c'est la
  // définition du plan de courroie. Une transverse prise ailleurs donnerait un
  // enroulement qui ne se referme pas sur les poulies.
  assert.ok(Math.abs(norm(g.planeFirst) - 1) < 1e-12);
  assert.ok(Math.abs(norm(g.planeSecond) - 1) < 1e-12);
  assert.ok(Math.abs(dot(g.planeFirst, g.planeSecond)) < 1e-12);
  assert.ok(Math.abs(dot(g.planeFirst, g.axis)) < 1e-12);
  assert.ok(Math.abs(dot(g.planeSecond, g.axis)) < 1e-12);
});

test('a marker travels on the belt, not on the picture of the belt', () => {
  const centre1 = [0, 0, 0], centre2 = [60, 80, 0];
  const g = Flexible.build({ axis: [0, 0, 1], centre1: centre1, centre2: centre2,
    r1: 20, r2: 40, view: 'iso' });
  for (const s of [0, 31, 97, g.length / 2, g.length - 4]) {
    const local = Geometry.pointAlong(g.local, s);
    // Le point physique, dans le monde : centre + a·F1 + b·F2.
    const world = [0, 1, 2].map(function (i) {
      return centre1[i] + local.x * g.planeFirst[i] + local.y * g.planeSecond[i];
    });
    const expected = Projection.project(world, 'iso');
    const drawn = g.point(s);
    assert.ok(Math.hypot(drawn[0] - expected[0], drawn[1] - expected[1]) < 1e-9,
      's=' + s + ' : ' + drawn + ' vs ' + expected);
  }
  // Un tour complet ramène exactement au point de départ.
  const start = g.point(0), loop = g.point(g.length);
  assert.ok(Math.hypot(loop[0] - start[0], loop[1] - start[1]) < 1e-9);
});

test('seen along its own plane a belt is a line, and it says so', () => {
  // Axe des poulies dans le plan de l'écran : on regarde la courroie par la
  // tranche. Elle n'a plus de surface, et prétendre en montrer l'enroulement
  // serait un dessin faux.
  const g = Flexible.build({ axis: [1, 0, 0], centre1: [0, 0, 0], centre2: [0, 100, 0],
    r1: 20, r2: 40, view: 'front' });
  assert.equal(g.collapsed, true);
  assert.ok(g.ellipse.minor < 1e-9);
  const points = [];
  for (let s = 0; s < g.length; s += g.length / 60) points.push(g.point(s));
  // Tous les points sont alignés : l'image du plan de courroie est une droite.
  const base = points[0];
  const far = points.reduce(function (best, p) {
    const d = Math.hypot(p[0] - base[0], p[1] - base[1]);
    return d > best.d ? { d: d, p: p } : best;
  }, { d: 0, p: base });
  const dir = [(far.p[0] - base[0]) / far.d, (far.p[1] - base[1]) / far.d];
  points.forEach(function (p) {
    const off = (p[0] - base[0]) * -dir[1] + (p[1] - base[1]) * dir[0];
    assert.ok(Math.abs(off) < 1e-6, 'point hors de la droite : ' + off);
  });
  // Vue de face la courroie garde sa longueur développée : c'est une cote
  // mécanique, pas une mesure faite sur le dessin.
  assert.ok(g.length > 2 * 100);
});

test('the image of a pulley is an ellipse, and its axes are exact', () => {
  // Cercle inchangé.
  const identity = Flexible.ellipseOf([1, 0], [0, 1]);
  assert.ok(Math.abs(identity.major - 1) < 1e-12 && Math.abs(identity.minor - 1) < 1e-12);
  // Écrasement pur : un demi-axe conservé, l'autre réduit d'autant.
  const flat = Flexible.ellipseOf([1, 0], [0, 0.4]);
  assert.ok(Math.abs(flat.major - 1) < 1e-12 && Math.abs(flat.minor - 0.4) < 1e-12);
  assert.ok(Math.abs(flat.rotationDeg) < 1e-9);
  // Plan vu par la tranche : plus de petit axe du tout.
  assert.ok(Flexible.ellipseOf([1, 0], [0, 0]).minor < 1e-12);
  // Le signe du déterminant dit si l'image retourne le sens de parcours.
  assert.ok(Flexible.ellipseOf([1, 0], [0, -1]).det < 0);
  assert.ok(Flexible.ellipseOf([1, 0], [0, 1]).det > 0);
});

test('an impossible belt is refused instead of being drawn wrong', () => {
  // Poulies confondues, et entraxe trop court pour une courroie croisée.
  assert.equal(Flexible.build({ axis: [0, 0, 1], centre1: [0, 0, 0], centre2: [0, 0, 40], r1: 10, r2: 20 }), null);
  assert.equal(Flexible.build({ axis: [0, 0, 1], centre1: [0, 0, 0], centre2: [10, 0, 0], r1: 10, r2: 60, crossed: true }), null);
  assert.equal(Flexible.build({ axis: [0, 0, 1], centre1: [0, 0, 0], centre2: [80, 0, 0], r1: 0, r2: 20 }), null);
});

test('the belt of the train view hangs on the pulleys the view actually drew', () => {
  for (const id of VIEWS) {
    const model = Layout.layout([beltStage()], MECH, { view: id });
    const link = model.stages[0].links[0];
    const wheels = model.stages[0].wheels;
    assert.ok(link.geometry, 'pas de géométrie en ' + id);
    // Les deux poulies dessinées sont exactement les deux centres de la courroie.
    assert.ok(Math.hypot(link.geometry.centre1[0] - wheels[0].cx, link.geometry.centre1[1] - wheels[0].cy) < 1e-9, id);
    assert.ok(Math.hypot(link.geometry.centre2[0] - wheels[1].cx, link.geometry.centre2[1] - wheels[1].cy) < 1e-9, id);
    assert.doesNotMatch(link.outline, /NaN|Infinity/, id);
    // La courroie et la poulie qu'elle enroule sont vues de la même façon : la
    // roue est dessinée sur la base de phase de son axe, la courroie sur le
    // plan de ses poulies — ce sont deux bases du MÊME plan, donc une seule
    // ellipse apparente. Sans cela, le brin quitterait la jante dessinée.
    const basis = wheels[0].phaseBasis;
    assert.ok(basis, 'la roue n’a pas de base de phase en ' + id);
    const wheelEllipse = Flexible.ellipseOf(basis.first, basis.second);
    assert.ok(Math.abs(wheelEllipse.major - link.geometry.ellipse.major) < 1e-9, 'grand axe ' + id);
    assert.ok(Math.abs(wheelEllipse.minor - link.geometry.ellipse.minor) < 1e-9, 'petit axe ' + id);
  }
});

test('Transmission and Dimensions describe one and the same belt', () => {
  const solution = { stages: [beltStage()], mechanical: MECH };
  for (const id of VIEWS) {
    const train = Layout.layout(solution.stages, MECH, { view: id }).stages[0].links[0];
    const dimensions = GeometryLayout.build(solution, { view: id }).stages[0].flexible;
    assert.ok(dimensions, 'la vue Dimensions ne construit pas la courroie en ' + id);
    // Une seule géométrie : les deux vues ne peuvent plus décrire deux courroies.
    assert.ok(Math.abs(train.length - dimensions.length) < 1e-9, 'longueur ' + id);
    assert.ok(Math.abs(train.wrapAngle1Deg - dimensions.wrapAngle1Deg) < 1e-9, 'enroulement ' + id);
    assert.ok(Math.abs(train.centerDistance - dimensions.distance) < 1e-9, 'entraxe ' + id);
    assert.equal(train.collapsed, dimensions.collapsed, 'plan de courroie ' + id);
    // Et la même déformation apparente : la Dimensions décale l'étage, elle ne
    // le redessine pas d'un autre point de vue.
    assert.ok(Math.abs(train.geometry.ellipse.minor - dimensions.ellipse.minor) < 1e-9, 'ellipse ' + id);
  }
});
