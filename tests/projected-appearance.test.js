const test = require('node:test');
const assert = require('node:assert/strict');
const Projection = require('../js/visualization/core/ProjectionEngine.js');
const ProjectedScene = require('../js/visualization/core/ProjectedScene.js');
const Flexible = require('../js/visualization/core/FlexibleDriveGeometry.js');
const Overlay = require('../js/visualization/teeth/TeethOverlay.js');
const Primitives = require('../js/visualization/teeth/TeethPrimitives.js');
const Layout = require('../js/visualization/TrainLayout.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');
const Geometry = require('../js/visualization/core/GeometryUtils.js');

const LEVELS = Primitives.LEVELS;
const VIEWS = ['front', 'top', 'side', 'iso', 'iso-rear'];
function stage(type, config) {
  const def = Registry.get(type);
  const s = Object.assign({ type: type, parameters: { module: 1 } }, config);
  s.geometry = def.calculateGeometry(s);
  return s;
}
const SPUR_BELT = () => [
  stage('spur', { input: { teeth: 15 }, output: { teeth: 60 }, parameters: { module: 2, faceWidth: 20 } }),
  stage('belt', { input: { teeth: 20 }, output: { teeth: 80 }, parameters: { module: 2, pitch: 5, centerDistance: 150 } })];
const mod180 = a => ((a % 180) + 180) % 180;
const closeAngle = (a, b) => Math.abs(mod180(a) - mod180(b)) < 1e-6 || Math.abs(Math.abs(mod180(a) - mod180(b)) - 180) < 1e-6;

// ===== §5 : l'ellipse apparente et l'axe projeté =====

test('the small axis of the apparent ellipse follows the projected axis', () => {
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1],
    [1, 1, 0], [1, 0, 2], [0.3, -0.7, 0.5], [2, 1, -1]];
  for (const view of VIEWS) {
    axes.forEach(axis => {
      const basis = ProjectedScene.phaseBasis(axis, view);
      const apparent = ProjectedScene.ellipseOf(basis.first, basis.second);
      const drawn = Projection.project(axis, view);
      const length = Math.hypot(drawn[0], drawn[1]);
      if (length < 1e-9) {
        // Axe vu en bout : le cercle est un vrai cercle, aucune direction à
        // comparer — et c'est exactement ce que dit `major === minor`.
        assert.ok(Math.abs(apparent.major - apparent.minor) < 1e-9, view + ' ' + axis);
        return;
      }
      const axisDeg = Math.atan2(drawn[1], drawn[0]) * 180 / Math.PI;
      // Le GRAND axe est perpendiculaire à l'axe projeté ; le petit lui est
      // parallèle. C'est ce qui autorise les primitives à travailler dans le
      // repère local sans rotation propre.
      assert.ok(closeAngle(apparent.rotationDeg, axisDeg + 90),
        view + ' / axe ' + axis + ' : grand axe à ' + mod180(apparent.rotationDeg).toFixed(3) +
        '° pour un axe à ' + mod180(axisDeg).toFixed(3) + '°');
      // Et le petit axe VAUT le cosinus de l'axe sur le regard : c'est ce
      // cosinus qui écrase le cercle, et rien d'autre.
      const unit = Math.hypot(axis[0], axis[1], axis[2]);
      const gaze = Projection.view(view).w;
      const cosine = Math.abs((axis[0] * gaze[0] + axis[1] * gaze[1] + axis[2] * gaze[2]) / unit);
      assert.ok(Math.abs(apparent.minor - cosine) < 1e-9,
        view + ' / axe ' + axis + ' : petit axe ' + apparent.minor + ' pour un cosinus de ' + cosine);
      assert.ok(apparent.minor <= apparent.major + 1e-9);
    });
  }
});

// ===== §6 : trois axes, trois ellipses de même excentricité =====

test('in iso, three perpendicular axes give three ellipses of equal shape', () => {
  const seen = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => {
    const basis = ProjectedScene.phaseBasis(axis, 'iso');
    const apparent = ProjectedScene.ellipseOf(basis.first, basis.second);
    const drawn = Projection.project(axis, 'iso');
    return { apparent, axisDeg: Math.atan2(drawn[1], drawn[0]) * 180 / Math.PI,
      length: Math.hypot(drawn[0], drawn[1]) };
  });
  // Les trois axes se projettent avec la même longueur, à 120° les uns des
  // autres : c'est la définition d'une isométrie.
  seen.forEach(s => assert.ok(Math.abs(s.length - Math.sqrt(2 / 3)) < 1e-9, 'raccourci ' + s.length));
  // Donc les trois ellipses ont la MÊME excentricité…
  seen.forEach(s => assert.ok(Math.abs(s.apparent.minor / s.apparent.major - 1 / Math.sqrt(3)) < 1e-9,
    'excentricité ' + s.apparent.minor / s.apparent.major));
  // …et trois orientations séparées de 120°, comme leurs axes.
  const pairs = [[0, 1], [1, 2], [2, 0]];
  pairs.forEach(([a, b]) => {
    const gap = mod180(seen[a].apparent.rotationDeg - seen[b].apparent.rotationDeg);
    assert.ok(Math.abs(gap - 60) < 1e-6 || Math.abs(gap - 120) < 1e-6,
      'écart de ' + gap.toFixed(3) + '° entre deux ellipses');
  });
});

// ===== §3, §26 : les surfaces suivent le corps =====

test('no construction circle ever surrounds an oblique wheel', () => {
  const wheel = { kind: 'gear', teeth: 40, pitchD: 80, outsideD: 84, rootD: 75,
    baseD: 75.2, module: 2, faceWidth: 20, pressureAngle: 20 };
  const apparent = { major: 1, minor: 0.5774, rotationDeg: 120 };
  const drawn = Overlay.surfaces(wheel, LEVELS.TECHNICAL, { presentation: 'oblique', apparent });
  assert.ok(drawn.length >= 4, 'quatre surfaces au moins : ' + drawn.length);
  drawn.forEach(shape => {
    assert.notEqual(shape.tag, 'circle', 'un cercle autour d’une roue oblique : ' + shape.attrs.class);
    assert.equal(shape.tag, 'ellipse');
    // §26 : même centre, même rapport, même orientation — seule la taille change.
    assert.ok(Math.abs(Number(shape.attrs.rx) / Number(shape.attrs.ry) - apparent.minor / apparent.major) < 1e-3,
      shape.attrs.class + ' : rapport ' + Number(shape.attrs.rx) / Number(shape.attrs.ry));
    assert.equal(shape.attrs.transform, undefined, 'aucune rotation propre dans le repère local');
    assert.equal(shape.attrs.cx, undefined);
  });
  // De face, ce sont bien des cercles.
  Overlay.surfaces(wheel, LEVELS.TECHNICAL, { presentation: 'face' })
    .forEach(shape => assert.equal(shape.tag, 'circle'));
  // Par la tranche, des génératrices : aucun contour fermé.
  Overlay.surfaces(wheel, LEVELS.TECHNICAL, { presentation: 'profile' })
    .forEach(shape => assert.ok(shape.tag !== 'circle' && shape.tag !== 'ellipse', shape.tag));
});

test('the body and its surfaces describe one and the same ellipse', () => {
  for (const view of VIEWS) {
    const model = Layout.layout(SPUR_BELT(), [{ ratio: 4 }, { ratio: 4 }], { view });
    model.wheels.filter(w => w.presentation === 'oblique' && w.kind === 'gear').forEach(wheel => {
      const built = Primitives.build(wheel, { lod: LEVELS.TECHNICAL, presentation: 'oblique',
        apparent: wheel.apparent });
      const face = built.rotor.filter(s => /oblique-face/.test((s.attrs || {}).class || ''))[0];
      assert.ok(face, view + ' : pas de face elliptique');
      const surfaces = Overlay.surfaces(wheel, LEVELS.TECHNICAL,
        { presentation: 'oblique', apparent: wheel.apparent });
      const ratio = Number(face.attrs.rx) / Number(face.attrs.ry);
      surfaces.forEach(shape => {
        // Tolérance : les rayons sont écrits au centième de millimètre, ce qui
        // suffit à faire bouger le rapport de quelque 10⁻³ sur une petite roue.
        assert.ok(Math.abs(Number(shape.attrs.rx) / Number(shape.attrs.ry) - ratio) < 5e-3,
          view + ' ' + shape.attrs.class + ' : le corps et sa surface ne partagent pas la même ellipse');
      });
    });
  }
});

// ===== §8 : les arbres projetés =====

test('a projected shaft is shortened exactly as the projection shortens it', () => {
  // Un arbre suivant X, en isométrie : sa longueur écran vaut sa longueur
  // réelle multipliée par √(2/3) — le raccourci isométrique, rien d'autre.
  const model = Layout.layout([stage('spur', { input: { teeth: 15 }, output: { teeth: 60 },
    parameters: { module: 2, faceWidth: 20 } })], [{ ratio: 4 }], { view: 'iso' });
  model.shafts.forEach(shaft => {
    const spatial = model.spatial.shafts.filter(s => s.id === shaft.id)[0];
    const drawn = Math.hypot(shaft.x2 - shaft.x1, shaft.y2 - shaft.y1);
    assert.ok(Math.abs(drawn - spatial.length * Math.sqrt(2 / 3)) < 1e-9,
      shaft.id + ' : ' + drawn.toFixed(4) + ' pour ' + spatial.length.toFixed(4) + ' mm réels');
  });
  // En vue dépliée, les longueurs sont conservées — c'est ce qu'elle promet.
  const unfolded = Layout.layout([stage('bevel', { input: { teeth: 15 }, output: { teeth: 30 },
    parameters: { module: 2, shaftAngle: 90 } })], [{ ratio: 2 }], { view: 'unfolded' });
  unfolded.shafts.filter(s => !s.endOn).forEach(shaft => {
    const spatial = unfolded.spatial.shafts.filter(s => s.id === shaft.id)[0];
    const drawn = Math.hypot(shaft.x2 - shaft.x1, shaft.y2 - shaft.y1);
    assert.ok(Math.abs(drawn - spatial.length) < 1e-9,
      shaft.id + ' : ' + drawn.toFixed(4) + ' pour ' + spatial.length.toFixed(4) + ' mm');
  });
});

// ===== §11, §25 : une seule ellipse pour la roue, la poulie et la courroie =====

test('pulley and belt describe the same projected circle, rotation included', () => {
  for (const view of ['unfolded'].concat(VIEWS)) {
    const model = Layout.layout(SPUR_BELT(), [{ ratio: 4 }, { ratio: 4 }], { view });
    const belt = model.stages[1];
    const link = belt.links[0];
    belt.wheels.forEach((wheel, index) => {
      const circle = link.geometry.circles[index];
      assert.ok(Math.abs(circle.major - wheel.apparent.major) < 1e-9, view + ' grand axe');
      assert.ok(Math.abs(circle.minor - wheel.apparent.minor) < 1e-9, view + ' petit axe');
      assert.ok(closeAngle(circle.rotationDeg, wheel.apparent.rotationDeg),
        view + ' : la courroie tourne son ellipse de ' + mod180(circle.rotationDeg).toFixed(3) +
        '° et la poulie de ' + mod180(wheel.apparent.rotationDeg).toFixed(3) + '°');
      // Et le cercle décrit bien CETTE poulie, à sa place.
      assert.ok(Math.hypot(circle.centre[0] - wheel.cx, circle.centre[1] - wheel.cy) < 1e-9, view);
      assert.ok(Math.abs(circle.radius - wheel.pitchD / 2) < 1e-9, view + ' rayon');
    });
  }
});

test('two parts on one shaft share one plane, and differ only along it', () => {
  for (const view of VIEWS) {
    const model = Layout.layout(SPUR_BELT(), [{ ratio: 4 }, { ratio: 4 }], { view });
    const byShaft = {};
    model.wheels.forEach(wheel => {
      (byShaft[wheel.bodyId] = byShaft[wheel.bodyId] || []).push(wheel);
    });
    const shared = Object.keys(byShaft).filter(id => byShaft[id].length > 1);
    assert.ok(shared.length > 0, view + ' : aucun arbre ne porte deux organes');
    shared.forEach(id => {
      const [a, b] = byShaft[id];
      assert.ok(Math.abs(a.apparent.major - b.apparent.major) < 1e-9, view + ' grand axe');
      assert.ok(Math.abs(a.apparent.minor - b.apparent.minor) < 1e-9, view + ' petit axe');
      assert.ok(closeAngle(a.apparent.rotationDeg, b.apparent.rotationDeg), view + ' orientation');
      // Ce qui les sépare à l'écran suit l'arbre : elles ne diffèrent que par
      // leur abscisse axiale.
      const shaft = model.shafts.filter(s => s.id === id)[0];
      const gap = [b.cx - a.cx, b.cy - a.cy];
      const span = Math.hypot(gap[0], gap[1]);
      if (span < 1e-9 || shaft.endOn) return;
      const along = [shaft.x2 - shaft.x1, shaft.y2 - shaft.y1];
      const length = Math.hypot(along[0], along[1]);
      const across = (gap[0] * -along[1] + gap[1] * along[0]) / length;
      assert.ok(Math.abs(across) < 1e-9,
        view + ' : les deux organes de ' + id + ' s’écartent de ' + across.toFixed(4) + ' mm en travers de leur arbre');
    });
  }
});

// ===== §12 : la tangence, réellement testée =====

test('every strand really leaves its pulley tangentially, in every view', () => {
  const setups = [
    { r1: 30, r2: 30, crossed: false }, { r1: 20, r2: 60, crossed: false },
    { r1: 30, r2: 30, crossed: true }, { r1: 20, r2: 60, crossed: true }
  ];
  for (const view of VIEWS) {
    setups.forEach(setup => {
      const g = Flexible.build({ axis: [0, 0, 1], centre1: [0, 0, 0], centre2: [200, 0, 0],
        r1: setup.r1, r2: setup.r2, crossed: setup.crossed, view: view });
      assert.ok(g, view + ' : géométrie absente');
      const det = g.first[0] * g.second[1] - g.second[0] * g.first[1];
      if (Math.abs(det) < 1e-9) return;   // plan vu par la tranche : plus de tangence à voir
      const toLocal = point => {
        const dx = point[0] - g.origin[0], dy = point[1] - g.origin[1];
        return [(dx * g.second[1] - dy * g.second[0]) / det, (dy * g.first[0] - dx * g.first[1]) / det];
      };
      const parts = Geometry.segments(g.local);
      parts.list.filter(p => p.kind === 'line').forEach(strand => {
        // Les deux brins ne sont pas parcourus dans le même sens : c'est la
        // poulie la plus proche qui dit à laquelle un bout appartient.
        [strand.from, strand.to].forEach(point => {
          const first = Math.abs(Math.hypot(point.x, point.y) - setup.r1) <
            Math.abs(Math.hypot(point.x - g.distance, point.y) - setup.r2);
          const centre = first ? [0, 0] : [g.distance, 0];
          const radius = first ? setup.r1 : setup.r2;
          // 1. le point de tangence appartient bien au cercle de la poulie…
          const screen = g.toScreen([point.x, point.y]);
          const local = toLocal(screen);
          assert.ok(Math.abs(Math.hypot(local[0] - centre[0], local[1] - centre[1]) - radius) < 1e-6,
            view + ' : point de tangence hors de la poulie');
          // 2. …et le brin y est perpendiculaire au rayon, donc tangent.
          const along = [strand.to.x - strand.from.x, strand.to.y - strand.from.y];
          const span = Math.hypot(along[0], along[1]);
          const radial = [point.x - centre[0], point.y - centre[1]];
          const cos = (along[0] * radial[0] + along[1] * radial[1]) / (span * radius);
          assert.ok(Math.abs(cos) < 1e-9, view + ' : brin non tangent (cos = ' + cos.toFixed(9) + ')');
        });
      });
    });
  }
});

test('the two cones of a bevel pair point at their common apex', () => {
  // Deux cônes primitifs qui engrènent partagent UN sommet — c'est ce qui
  // définit le couple. Le dessin les orientait pourtant tous les deux dans le
  // même sens : l'un des deux s'éloignait de son propre sommet, et le couple
  // ressemblait à deux cônes posés bout à bout au hasard.
  const bevel = () => [stage('bevel', { input: { teeth: 20 }, output: { teeth: 40 },
    parameters: { module: 2, shaftAngle: 90, faceWidth: 14 } })];
  for (const view of VIEWS) {
    const model = Layout.layout(bevel(), [{ ratio: 2 }], { view });
    const wheels = model.stages[0].wheels;
    assert.equal(wheels.length, 2);
    wheels.forEach(w => assert.ok(w.apexSide === 1 || w.apexSide === -1,
      view + ' : ' + w.role + ' sans côté de sommet (' + w.apexSide + ')'));
    // Le sommet est commun : dans un couple à 90°, les deux cônes se tournent
    // le dos le long de leurs axes respectifs.
    assert.notEqual(wheels[0].apexSide, wheels[1].apexSide,
      view + ' : les deux cônes pointent du même côté');
  }
  // Et hors d'un couple conique, rien n'est orienté au hasard.
  const spur = Layout.layout([stage('spur', { input: { teeth: 15 }, output: { teeth: 60 },
    parameters: { module: 2, faceWidth: 20 } })], [{ ratio: 4 }], { view: 'iso' });
  spur.stages[0].wheels.forEach(w => assert.equal(w.apexSide, undefined));
});
