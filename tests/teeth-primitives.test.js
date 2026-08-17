const test = require('node:test');
const assert = require('node:assert/strict');
const Primitives = require('../js/visualization/teeth/TeethPrimitives.js');
const Overlay = require('../js/visualization/teeth/TeethOverlay.js');

const LEVELS = Primitives.LEVELS;

function wheel(overrides = {}) {
  return Object.assign({ kind: 'gear', role: 'input', teeth: 24, module: 2, pitchD: 48, outsideD: 52,
    rootD: 43, baseD: 45.1, pressureAngle: 20, cx: 0, cy: 0, speed: 1 }, overrides);
}
function allFinite(shapes) {
  shapes.forEach(shape => Object.values(shape.attrs || {}).forEach(value => {
    assert.doesNotMatch(String(value), /NaN|Infinity|undefined/, shape.tag + ' ' + JSON.stringify(shape.attrs));
  }));
}

test('the level of detail follows the on-screen size, not the zoom factor', () => {
  // Une roue de 20 mm à 0,5 px/mm reste une silhouette ; la même à 20 px/mm
  // mérite ses tracés de construction.
  assert.equal(Primitives.level(10), LEVELS.SILHOUETTE);
  assert.equal(Primitives.level(40), LEVELS.SIMPLIFIED);
  assert.equal(Primitives.level(150), LEVELS.INVOLUTE);
  assert.equal(Primitives.level(400), LEVELS.TECHNICAL);
  const small = wheel({ outsideD: 20 });
  assert.equal(Primitives.levelFor(small, 0.5), LEVELS.SILHOUETTE);
  assert.equal(Primitives.levelFor(small, 20), LEVELS.TECHNICAL);
  // Deux roues très différentes au même zoom n'ont pas le même niveau.
  assert.notEqual(Primitives.levelFor(wheel({ outsideD: 12 }), 2), Primitives.levelFor(wheel({ outsideD: 200 }), 2));
});

test('each level produces a strictly richer gear body', () => {
  const counts = [0, 1, 2, 3].map(lod => Primitives.build(wheel(), { lod: lod }).rotor.length);
  assert.equal(counts[0], 1, 'silhouette = un seul contour');
  assert.ok(counts[1] > counts[0] && counts[2] >= counts[1]);
  const silhouette = Primitives.build(wheel(), { lod: LEVELS.SILHOUETTE }).rotor[0];
  assert.equal(silhouette.tag, 'circle');
  const involute = Primitives.build(wheel(), { lod: LEVELS.INVOLUTE }).rotor[0];
  assert.match(involute.attrs.d, /^M .* Z$/);
});

test('every family draws finite geometry at every level', () => {
  const wheels = {
    gear: wheel(),
    'internal-ring': wheel({ kind: 'internal-ring', teeth: 60, pitchD: 120, outsideD: 126 }),
    pulley: wheel({ kind: 'pulley', teeth: 20, pitchD: 12.7 }),
    sprocket: wheel({ kind: 'sprocket', teeth: 15, pitchD: 61 }),
    worm: wheel({ kind: 'worm', teeth: 2, pitchD: 20, leadAngle: 18 }),
    cone: wheel({ kind: 'cone', coneAngleDeg: 26.57, faceWidth: 12 }),
    rack: wheel({ kind: 'rack', teeth: 0, length: 250 })
  };
  for (const [kind, model] of Object.entries(wheels)) {
    for (const lod of [0, 1, 2, 3]) {
      const built = Primitives.build(model, { lod });
      assert.ok(built.rotor.length, kind + ' @ lod ' + lod + ' produces nothing');
      allFinite(built.rotor);
      allFinite(built.fixed);
    }
  }
});

test('a helical gear is drawn differently from a spur gear', () => {
  const spur = Primitives.build(wheel(), { lod: LEVELS.TECHNICAL });
  const helical = Primitives.build(wheel({ helixAngle: 25, helixHand: 'right' }), { lod: LEVELS.TECHNICAL });
  const stripes = helical.rotor.filter(s => s.attrs.class === 'helix-stripe');
  assert.ok(stripes.length >= 4, 'stries d\'hélice attendues');
  assert.ok(helical.rotor.some(s => s.attrs.class === 'helix-hand'), 'sens d\'hélice attendu');
  assert.equal(spur.rotor.filter(s => s.attrs.class === 'helix-stripe').length, 0);
  // Le sens d'hélice change réellement l'inclinaison des stries.
  const left = Primitives.build(wheel({ helixAngle: 25, helixHand: 'left' }), { lod: LEVELS.TECHNICAL });
  assert.notDeepEqual(stripes[0].attrs.d, left.rotor.filter(s => s.attrs.class === 'helix-stripe')[0].attrs.d);
});

test('a bevel gear exposes its pitch cone and the intersection of the axes', () => {
  const built = Primitives.build(wheel({ kind: 'cone', coneAngleDeg: 30, faceWidth: 10 }), { lod: LEVELS.TECHNICAL });
  assert.ok(built.rotor.some(s => /cone-body/.test(s.attrs.class)));
  assert.ok(built.rotor.some(s => s.attrs.class === 'cone-tip'));
  assert.ok(built.rotor.some(s => s.attrs.class === 'cone-apex-point'), 'point d\'intersection des axes');
});

/** Le groupe de phase, désormais niché dans le groupe masqué. */
function threadPhase(built) {
  const clip = built.rotor.find(s => s.attrs && s.attrs.class === 'worm-thread-clip');
  return clip && clip.children.find(s => s.attrs && s.attrs.class === 'worm-thread-phase');
}

test('a worm keeps its body still and groups the threads that move', () => {
  const built = Primitives.build(wheel({ kind: 'worm', teeth: 3, pitchD: 20, leadAngle: 18 }), { lod: LEVELS.TECHNICAL });
  // §11 : corps et axe ne sont PAS dans le groupe animé — c'est tout l'objet
  // de la séparation, la vis tournait en se déplaçant le long de son arbre.
  const phase = threadPhase(built);
  assert.ok(phase, 'les filets doivent former un groupe à part');
  assert.ok(phase.children.length >= 2);
  assert.ok(phase.children.every(s => s.attrs.class === 'worm-thread'));
  assert.ok(built.rotor.some(s => s.attrs && s.attrs.class && s.attrs.class.includes('worm-body')));
  assert.ok(built.rotor.some(s => s.attrs && s.attrs.class === 'stage-axis'));
  assert.ok(built.rotor.some(s => s.text && s.text.includes('γ 18°')));
});

test('the thread pattern is really clipped to the body, not merely said to be', () => {
  const w = wheel({ kind: 'worm', teeth: 1, pitchD: 20, module: 2, leadAngle: 18, id: 's0-input' });
  const geometry = Primitives.wormGeometry(w);
  const built = Primitives.build(w, { lod: LEVELS.INVOLUTE });

  // Le commentaire annonçait un clip que le code ne créait pas : les filets,
  // dessinés deux pas plus loin, débordaient du corps et défilaient dans le
  // vide devant l'arbre.
  const clip = built.rotor.find(s => s.tag === 'clipPath');
  assert.ok(clip, 'le masque doit exister');
  const window = clip.children[0];
  assert.equal(Number(window.attrs.width), Number(geometry.length.toFixed(2)));
  assert.equal(Number(window.attrs.height), Number((2 * geometry.radius).toFixed(2)));

  // …et le groupe des filets doit RÉELLEMENT le référencer.
  const clipped = built.rotor.find(s => s.attrs && s.attrs.class === 'worm-thread-clip');
  assert.equal(clipped.attrs['clip-path'], 'url(#' + clip.attrs.id + ')');
  assert.ok(threadPhase(built), 'la phase animée vit dans le groupe masqué');

  // Le débord reste nécessaire : sans lui, un filet disparaîtrait d'un bord
  // avant que le suivant n'entre par l'autre, et la boucle sauterait.
  const xs = threadPhase(built).children.flatMap(p => p.attrs.d.match(/-?\d+(\.\d+)?(?= )/g).map(Number));
  assert.ok(Math.min(...xs) < -geometry.length / 2, 'motif débordant à gauche');
  assert.ok(Math.max(...xs) > geometry.length / 2, 'motif débordant à droite');
});

test('two worms in one chain never share a mask', () => {
  // Un masque partagé serait dimensionné pour l'une des deux vis, et
  // tronquerait la seconde aux bornes de la première.
  const first = Primitives.build(wheel({ kind: 'worm', teeth: 2, pitchD: 20, module: 2, id: 's0-input' }), { lod: LEVELS.INVOLUTE });
  const second = Primitives.build(wheel({ kind: 'worm', teeth: 1, pitchD: 30, module: 3, id: 's1-input' }), { lod: LEVELS.INVOLUTE });
  const idOf = built => built.rotor.find(s => s.tag === 'clipPath').attrs.id;
  assert.notEqual(idOf(first), idOf(second));
  // Et l'identifiant est STABLE : tiré d'un compteur, il changerait à chaque
  // rendu et casserait les exports.
  assert.equal(idOf(first), idOf(Primitives.build(wheel({ kind: 'worm', teeth: 2, pitchD: 20, module: 2, id: 's0-input' }), { lod: LEVELS.INVOLUTE })));
  assert.match(idOf(first), /^[A-Za-z][A-Za-z0-9_-]*$/, 'identifiant utilisable dans une URL de fragment');
});

test('a worm body is a cylinder seen from the side, not a capsule', () => {
  const built = Primitives.build(wheel({ kind: 'worm', teeth: 2, pitchD: 20, module: 2 }), { lod: LEVELS.INVOLUTE });
  const body = built.rotor.find(s => s.attrs && s.attrs.class && s.attrs.class.includes('worm-body'));
  // `rx = radius` en faisait une capsule à extrémités hémisphériques.
  assert.equal(body.attrs.rx, undefined, 'aucun arrondi d’extrémité');
  assert.equal(body.tag, 'rect');
});

test('the number of starts changes the pattern, not just the visual pitch', () => {
  const one = Primitives.build(wheel({ kind: 'worm', teeth: 1, pitchD: 20, module: 2 }), { lod: LEVELS.INVOLUTE });
  const four = Primitives.build(wheel({ kind: 'worm', teeth: 4, pitchD: 20, module: 2 }), { lod: LEVELS.INVOLUTE });
  const count = built => threadPhase(built).children.length;
  // §14 : quatre filets déphasés, pas un pas dessiné quatre fois plus grand.
  assert.ok(count(four) > count(one), 'une vis à 4 filets montre plus de traits');
  assert.equal(Primitives.wormGeometry(wheel({ kind: 'worm', teeth: 4, module: 2, pitchD: 20 })).starts, 4);
});

test('a rack is drawn at the real circular pitch over the whole travel', () => {
  const built = Primitives.build(wheel({ kind: 'rack', module: 2, length: 100 }), { lod: LEVELS.INVOLUTE });
  const path = built.rotor[0].attrs.d;
  // Un pas par π·m : environ 16 dents sur 100 mm avec m = 2.
  assert.ok(path.split(' L ').length > 50, 'denture complète attendue');
  assert.doesNotMatch(path, /NaN/);
});

test('construction circles and the line of action appear only at the finest level', () => {
  assert.equal(Overlay.circles(wheel(), LEVELS.SIMPLIFIED).length, 0);
  assert.equal(Overlay.circles(wheel(), LEVELS.INVOLUTE).map(c => c.attrs.class).join(), 'pitch-circle');
  const technical = Overlay.circles(wheel(), LEVELS.TECHNICAL).map(c => c.attrs.class);
  assert.deepEqual(technical, ['pitch-circle', 'base-circle', 'root-circle', 'tip-circle']);
});

test('the pitch point sits on the line of centres, inside out for an internal mesh', () => {
  const a = wheel({ cx: 0, cy: 0, pitchD: 40 });
  const b = wheel({ cx: 70, cy: 0, pitchD: 100 });
  const external = Overlay.pitchPoint(a, b, false);
  assert.equal(external.x, 20);                                     // r1 du menant
  assert.ok(Math.abs(Math.hypot(external.x - b.cx, external.y - b.cy) - 50) < 1e-9);
  const internal = Overlay.pitchPoint(a, { ...b, cx: 30 }, true);
  assert.equal(internal.x, -20);                                    // côté opposé à la couronne
  assert.ok(Math.abs(Math.hypot(internal.x - 30, internal.y) - 50) < 1e-9);
});

test('the meshing overlay is limited to real meshes and stays finite', () => {
  const entry = { type: 'spur', wheels: [wheel({ cx: 0 }), wheel({ cx: 70, pitchD: 100 })] };
  assert.equal(Overlay.mesh(entry, LEVELS.INVOLUTE).length, 0);
  const shapes = Overlay.mesh(entry, LEVELS.TECHNICAL);
  assert.deepEqual(shapes.map(s => s.attrs.class || s.tag), ['line-of-action', 'contact-point', 'title']);
  allFinite(shapes.filter(s => s.attrs.class));
  // Ni une courroie ni un planétaire n'ont de ligne d'action à tracer.
  ['belt', 'chain', 'planetary', 'rack', 'worm'].forEach(type => {
    assert.equal(Overlay.mesh({ ...entry, type }, LEVELS.TECHNICAL).length, 0, type);
  });
});
