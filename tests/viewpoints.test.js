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
// L'autre bord est une notion ORTHOGRAPHIQUE. L'isométrie n'y figure plus :
// son « coin opposé » [−1,−1,−1] est sous le mécanisme, et le présenter comme
// l'autre bord d'une vue de dessus faisait basculer tout le dessin d'un clic.
// Elle se TOURNE, et c'est l'objet des tests d'orbite plus bas.
const PAIRS = [['front', 'rear'], ['top', 'bottom'], ['side', 'side-far']];
const ISO_TURNS = ['iso', 'iso-90', 'iso-180', 'iso-270'];
const WORLD_UP = [0, 1, 0];

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
  // De l'autre bord, ce qui était devant passe derrière. Deux organes à la
  // MÊME profondeur n'ont pas d'ordre à inverser : la comparaison ne porte que
  // sur les couples que la profondeur sépare réellement.
  const seenFrom = id => SpatialLayout.frame(MechanicalGraph.build(solution, scene), { view: id }).projected;
  const here = seenFrom('front'), there = seenFrom('rear');
  here.order.forEach((a, i) => here.order.slice(i + 1).forEach(b => {
    const gap = here.member(a).depth - here.member(b).depth;
    if (Math.abs(gap) < 1e-9) return;
    const flipped = there.member(a).depth - there.member(b).depth;
    assert.ok(gap * flipped < 0, a + ' / ' + b + ' : la profondeur ne s’est pas retournée');
  }));
});

// ===== L'ORBITE ISOMÉTRIQUE ==========================================
//
// Le bouton de changement d'angle passait de [+1,+1,+1] à [−1,−1,−1] : le coin
// diagonalement opposé du cube. Mathématiquement une projection valable, mais
// située SOUS le mécanisme — un clic présenté comme « tourner » retournait donc
// d'un coup le signe de la verticale et toute la profondeur du dessin.

function rotateAround(vector, axis, radians) {
  const k = Projection.vector.unit(axis);
  const c = Math.cos(radians), s = Math.sin(radians);
  const cr = Projection.vector.cross(k, vector);
  const kv = Projection.vector.dot(k, vector);
  return [0, 1, 2].map(i => vector[i] * c + cr[i] * s + k[i] * kv * (1 - c));
}

test('turning around the mechanism never takes the camera underneath it', () => {
  ISO_TURNS.forEach(id => {
    const seen = Projection.view(id);
    assert.equal(seen.id, id, id + ' : vue absente');
    // La caméra garde sa hauteur : elle tourne AUTOUR, elle ne plonge pas
    // dessous. C'est la propriété que l'ancien « iso opposée » violait.
    assert.ok(Math.abs(Projection.vector.dot(seen.w, WORLD_UP) - 1 / Math.sqrt(3)) < 1e-12,
      id + ' : hauteur de caméra ' + Projection.vector.dot(seen.w, WORLD_UP));
    // Et le haut du monde reste le haut du dessin, sans roulis.
    const up = Projection.project(WORLD_UP, id);
    assert.ok(Math.abs(up[0]) < 1e-12, id + ' : la verticale penche (' + up[0] + ')');
    assert.ok(up[1] < -0.8, id + ' : la verticale ne monte pas (' + up[1] + ')');
  });
});

test('each quarter turn is a real rotation about the world vertical', () => {
  ISO_TURNS.forEach((id, index) => {
    const next = Projection.view(ISO_TURNS[(index + 1) % 4]).w;
    // Un quart de tour, et rien d'autre : la même direction de regard, tournée
    // de −90° autour de la verticale du monde.
    const turned = rotateAround(Projection.view(id).w, WORLD_UP, -Math.PI / 2);
    [0, 1, 2].forEach(i => assert.ok(Math.abs(turned[i] - next[i]) < 1e-12,
      id + ' → ' + ISO_TURNS[(index + 1) % 4] + ' : ce n’est pas une rotation autour de Y'));
  });
});

test('four quarter turns come back exactly, and left undoes right', () => {
  ISO_TURNS.forEach(id => {
    let here = id;
    for (let i = 0; i < 4; i++) here = Projection.rotateIso(here, 1);
    assert.equal(here, id, id + ' : quatre quarts de tour ne reviennent pas au départ');
    assert.equal(Projection.rotateIso(Projection.rotateIso(id, 1), -1), id, id + ' : ↷ puis ↶');
    assert.equal(Projection.rotateIso(Projection.rotateIso(id, -1), 1), id, id + ' : ↶ puis ↷');
    // Deux demi-tours aussi, et un quart de tour de −3 vaut un de +1.
    assert.equal(Projection.rotateIso(id, 2), Projection.rotateIso(Projection.rotateIso(id, 1), 1));
    assert.equal(Projection.rotateIso(id, -3), Projection.rotateIso(id, 1));
  });
  // Hors isométrie, il n'y a pas d'azimut à tourner : on n'invente pas de vue.
  ['front', 'top', 'side', 'rear', 'unfolded'].forEach(id => {
    assert.equal(Projection.rotateIso(id, 1), id, id + ' : tourné alors qu’il n’est pas iso');
    assert.equal(Projection.isIso(id), false, id);
  });
  ISO_TURNS.forEach(id => assert.equal(Projection.isIso(id), true, id));
});

test('every quarter turn is still a true isometry, not just the first one', () => {
  ISO_TURNS.forEach(id => {
    const seen = Projection.view(id);
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const shot = axes.map(axis => Projection.project(axis, id));
    // Isométrie : les trois axes du monde subissent le MÊME raccourcissement.
    shot.forEach((point, i) => assert.ok(Math.abs(Math.hypot(point[0], point[1]) - Math.sqrt(2 / 3)) < 1e-12,
      id + ' axe ' + i + ' : raccourci ' + Math.hypot(point[0], point[1])));
    // …et se séparent de 120°, une fois orientés vers le coin d'où l'on
    // regarde : c'est cette somme nulle qui définit le trièdre isométrique.
    const signed = axes.map((axis, i) => {
      const sign = Projection.vector.dot(axis, seen.w) > 0 ? 1 : -1;
      return [shot[i][0] * sign, shot[i][1] * sign];
    });
    const sum = signed.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]);
    assert.ok(Math.hypot(sum[0], sum[1]) < 1e-12, id + ' : les trois axes ne sont pas à 120°');
    for (let i = 0; i < 3; i++) {
      const a = signed[i], b = signed[(i + 1) % 3];
      const cos = (a[0] * b[0] + a[1] * b[1]) / (2 / 3);
      assert.ok(Math.abs(cos + 0.5) < 1e-12, id + ' : angle de ' + (Math.acos(cos) * 180 / Math.PI) + '°');
    }
  });
});

test('no view is a mirror image, whatever the camera azimuth', () => {
  Projection.ALL.forEach(seen => {
    const handed = Projection.vector.dot(Projection.vector.cross(seen.u, seen.v), seen.w);
    // Y écran pointe vers le BAS : le trièdre (u, v, w) est donc indirect, et
    // il l'est pour TOUTES les vues. Une seule exception suffirait à inverser
    // le sens apparent de rotation, et à lire une hélice droite comme gauche.
    assert.ok(Math.abs(handed + 1) < 1e-12, seen.id + ' : image miroir (' + handed + ')');
    // La base est bien orthonormée : c'est ce qui fait d'elle une projection.
    assert.ok(Math.abs(Projection.vector.norm(seen.u) - 1) < 1e-12, seen.id + ' : u non unitaire');
    assert.ok(Math.abs(Projection.vector.norm(seen.v) - 1) < 1e-12, seen.id + ' : v non unitaire');
    assert.ok(Math.abs(Projection.vector.dot(seen.u, seen.v)) < 1e-12, seen.id + ' : u et v non orthogonaux');
  });
});

test('the deprecated iso-rear now means half a turn, not the underside', () => {
  const seen = Projection.view('iso-rear');
  assert.equal(seen.id, 'iso-180');
  // L'ancien vecteur, [−1,−1,−1], regardait le mécanisme par en dessous.
  assert.ok(Projection.vector.dot(seen.w, WORLD_UP) > 0, 'iso-rear regarde encore par en dessous');
  assert.equal(Projection.baseView('iso-rear'), 'iso');
  // Et l'isométrie n'a plus d'« autre bord » : il n'y a pas de coin opposé à
  // lui donner, seulement des azimuts.
  ISO_TURNS.forEach(id => assert.equal(Projection.opposite(id), id, id));
});

test('turning the camera never moves a single part of the mechanism', () => {
  const solution = { stages: chain(), mechanical: MECH };
  const scene = SceneBuilder.build(solution);
  const worlds = ISO_TURNS.map(view =>
    SpatialLayout.frame(MechanicalGraph.build(solution, scene), { view }));
  const reference = worlds[0];
  worlds.slice(1).forEach((frame, turn) => {
    const id = ISO_TURNS[turn + 1];
    frame.spatial.members.forEach((member, i) => {
      const same = reference.spatial.members[i];
      assert.equal(member.id, same.id, id);
      // Le monde ne bouge pas : position, axe, abscisse axiale, arbre.
      [0, 1, 2].forEach(k => {
        assert.ok(Math.abs(member.position[k] - same.position[k]) < 1e-12, id + ' ' + member.id + ' : position');
        assert.ok(Math.abs(member.axis[k] - same.axis[k]) < 1e-12, id + ' ' + member.id + ' : axe');
      });
      assert.equal(member.axialPosition, same.axialPosition, id + ' ' + member.id);
      assert.equal(member.shaftId, same.shaftId, id + ' ' + member.id);
    });
    frame.graph.axes.forEach((axis, i) => {
      const same = reference.graph.axes[i];
      [0, 1, 2].forEach(k => {
        assert.ok(Math.abs(axis.origin[k] - same.origin[k]) < 1e-12, id + ' ' + axis.id + ' : origine');
        assert.ok(Math.abs(axis.direction[k] - same.direction[k]) < 1e-12, id + ' ' + axis.id + ' : direction');
      });
    });
    // Ce qui change, et seulement cela : l'image.
    const moved = frame.projected.order.some(memberId =>
      Math.abs(frame.projected.member(memberId).depth - reference.projected.member(memberId).depth) > 1e-9);
    assert.ok(moved, id + ' : la caméra n’a rien changé du tout');
  });
});

test('two members of one shaft read alike from every azimuth', () => {
  const solution = { stages: chain(), mechanical: MECH };
  ISO_TURNS.forEach(view => {
    const model = Layout.layout(chain(), MECH, { view, solution });
    const byShaft = {};
    model.wheels.forEach(wheel => {
      const key = wheel.bodyId;
      if (!key) return;
      (byShaft[key] = byShaft[key] || []).push(wheel);
    });
    Object.keys(byShaft).forEach(key => {
      const [first, ...rest] = byShaft[key];
      rest.forEach(other => {
        // Deux organes du même arbre partagent son axe : seule leur abscisse
        // les sépare. Leur image ne peut donc différer que par la place.
        assert.equal(other.presentation, first.presentation, view + ' ' + key);
        assert.equal(other.facing, first.facing, view + ' ' + key);
        assert.ok(Math.abs(other.foreshortening - first.foreshortening) < 1e-9, view + ' ' + key);
        assert.ok(Math.abs(other.apparent.minor - first.apparent.minor) < 1e-9, view + ' ' + key);
        assert.ok(Math.abs(other.axisAngleDeg - first.axisAngleDeg) < 1e-9, view + ' ' + key);
      });
    });
  });
});
