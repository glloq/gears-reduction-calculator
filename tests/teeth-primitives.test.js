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

// ===== Une pièce se dessine selon l'ANGLE SOUS LEQUEL on la voit =====

const GEAR = () => wheel({ kind: 'gear', teeth: 20, pitchD: 40, module: 2, faceWidth: 20 });
function classesOf(built) {
  return built.rotor.map(s => (s.attrs && s.attrs.class) || s.tag);
}

test('a gear seen along its axis keeps the drawing it always had', () => {
  const face = Primitives.build(GEAR(), { lod: LEVELS.INVOLUTE, presentation: 'face' });
  assert.equal(face.presentation, 'face');
  // La vue de face fonctionne : profil réel, moyeu, développante. On n'y touche pas.
  assert.ok(face.rotor.some(s => s.tag === 'path' && s.attrs.class === 'tooth-profile' && s.attrs.d));
  assert.ok(face.rotor.some(s => s.attrs.class === 'gear-hub'));
  // Et c'est le défaut : une primitive appelée sans orientation dessine comme avant.
  assert.deepEqual(classesOf(Primitives.build(GEAR(), { lod: LEVELS.INVOLUTE })), classesOf(face));
});

test('a gear seen edge-on is a cylinder of width b, never a circle', () => {
  // Un cercle affirme qu'on regarde LE LONG de l'axe. Dès que l'axe est dans le
  // plan de l'écran, deux roues d'un même arbre se recouvriraient malgré leur
  // écart axial réel, et un pignon après un planétaire tomberait dans sa couronne.
  const wide = wheel({ kind: 'gear', teeth: 20, pitchD: 40, module: 2, outsideD: 44, faceWidth: 30 });
  const built = Primitives.build(wide, { lod: LEVELS.INVOLUTE, presentation: 'profile' });
  assert.equal(built.presentation, 'profile');

  const body = built.rotor.find(s => s.attrs && /gear-profile/.test(s.attrs.class || ''));
  assert.ok(body, 'un corps de profil');
  assert.equal(body.tag, 'rect');
  // Les deux cotes que la vue de face ne pouvait pas montrer.
  assert.equal(Number(body.attrs.width), 30, 'largeur de denture');
  assert.equal(Number(body.attrs.height), 44, 'diamètre extérieur');

  // Aucune denture dessinée de face, et aucun disque.
  assert.ok(!built.rotor.some(s => s.tag === 'circle'), 'pas de cercle de profil');
  // Les surfaces — primitive et fond — ne sont plus tracées par le corps : ce
  // sont des surfaces, et c'est TeethOverlay qui les dessine, pour toutes les
  // présentations. Deux endroits pour un même trait, c'étaient deux occasions
  // de diverger — et c'est ainsi qu'une roue oblique se retrouvait cerclée.
  assert.ok(!classesOf(built).includes('pitch-line'), 'le corps ne trace plus les surfaces');
  const seen = Overlay.surfaces(wide, LEVELS.INVOLUTE, { presentation: 'profile' });
  assert.ok(seen.some(s => /pitch-line/.test(s.attrs.class)), 'les génératrices primitives');
  assert.ok(!seen.some(s => s.tag === 'circle' || s.tag === 'ellipse'), 'aucun contour fermé par la tranche');
  // Plus de repère d'indexation FIXE : la phase est portée par le repère mobile
  // que la pose pilote, et un trait immobile en travers du corps se lisait
  // comme un axe ou un diamètre.
  assert.ok(!classesOf(built).includes('index-mark'));
  // Z=n n'a pas de sens sur une tranche.
  assert.ok(!built.upright.some(s => s.attrs && s.attrs.class === 'tooth-count'));
});

test('an internal ring seen edge-on stays recognisable as a ring', () => {
  const ring = wheel({ kind: 'internal-ring', teeth: 54, pitchD: 108, module: 2, faceWidth: 20 });
  const built = Primitives.build(ring, { lod: LEVELS.INVOLUTE, presentation: 'profile' });
  const classes = classesOf(built);
  // Deux jantes, pas un rectangle plein qu'on confondrait avec une roue.
  assert.ok(classes.some(c => /ring-profile-top/.test(c)));
  assert.ok(classes.some(c => /ring-profile-bottom/.test(c)));
  // Le vide central est un trait conventionnel : ce n'est pas une coupe.
  assert.ok(classes.includes('bore-line'));
  const rims = built.rotor.filter(s => /ring-profile/.test((s.attrs && s.attrs.class) || ''));
  assert.equal(rims.length, 2);
  rims.forEach(rim => assert.ok(Number(rim.attrs.height) > 0));
});

test('a pulley seen edge-on shows its width, not circular teeth', () => {
  const pulley = wheel({ kind: 'pulley', teeth: 20, pitchD: 40, module: 2, faceWidth: 12 });
  const built = Primitives.build(pulley, { lod: LEVELS.INVOLUTE, presentation: 'profile' });
  const body = built.rotor.find(s => /pulley-profile/.test((s.attrs && s.attrs.class) || ''));
  assert.equal(body.tag, 'rect');
  assert.equal(Number(body.attrs.width), 12);
  assert.ok(classesOf(built).includes('pulley-flange'), 'les joues distinguent une poulie');
  assert.ok(!built.rotor.some(s => s.tag === 'path' && /toothed/i.test(s.attrs.d || '')));
});

test('a worm is a cylinder from the side and a disc end-on', () => {
  const worm = wheel({ kind: 'worm', teeth: 2, pitchD: 20, module: 2, leadAngle: 20, id: 's0-input' });
  const side = Primitives.build(worm, { lod: LEVELS.INVOLUTE, presentation: 'profile' });
  assert.ok(classesOf(side).some(c => /worm-body/.test(c)), 'le corps couché');
  assert.ok(classesOf(side).includes('worm-thread-clip'), 'les filets clippés');

  const end = Primitives.build(worm, { lod: LEVELS.INVOLUTE, presentation: 'face' });
  assert.ok(classesOf(end).some(c => /worm-end/.test(c)));
  // Aucune translation longitudinale en bout : le mouvement est dans la
  // profondeur, il se montre par une phase.
  assert.ok(!classesOf(end).includes('worm-thread-phase'));
  assert.ok(classesOf(end).includes('worm-end-phase'));
  assert.ok(!classesOf(end).some(c => /worm-body/.test(c)));
});

test('a bevel keeps its cone from the side and shows its face end-on', () => {
  const cone = wheel({ kind: 'cone', teeth: 20, pitchD: 40, module: 2, coneAngleDeg: 26.6, faceWidth: 15 });
  const side = Primitives.build(cone, { lod: LEVELS.INVOLUTE, presentation: 'profile' });
  assert.ok(classesOf(side).some(c => /cone-body/.test(c)), 'le cône primitif reste un cône');
  const end = Primitives.build(cone, { lod: LEVELS.INVOLUTE, presentation: 'face' });
  assert.ok(classesOf(end).some(c => /cone-face/.test(c)));
  // Le conique ne retombe jamais dans un cercle générique de roue droite.
  assert.ok(!classesOf(end).includes('tooth-profile'));
});

test('an oblique part is neither a disc nor a rectangle', () => {
  // L'ellipse vient de `apparent` — la description projetée que ProjectedScene
  // calcule pour l'axe —, et non d'un raccourci que la primitive redérive.
  const seen = { major: 1, minor: 0.5, rotationDeg: 0 };
  const built = Primitives.build(GEAR(), { lod: LEVELS.INVOLUTE, presentation: 'oblique', apparent: seen });
  assert.equal(built.presentation, 'oblique');
  const face = built.rotor.find(s => s.tag === 'ellipse' && /oblique-face/.test(s.attrs.class));
  assert.ok(face, 'une face elliptique');
  // Petit axe LE LONG de l'axe projeté, grand axe en travers : c'est le
  // contrat du repère local, et c'est lui qui montre l'orientation.
  assert.ok(Math.abs(Number(face.attrs.rx) / Number(face.attrs.ry) - 0.5) < 0.02);
  // Aucune rotation propre : le groupe de la pièce la porte déjà.
  assert.equal(face.attrs.transform, undefined);

  // De plus en plus de face : l'ellipse tend vers le cercle.
  const flat = Primitives.build(GEAR(), { lod: LEVELS.INVOLUTE, presentation: 'oblique',
    apparent: { major: 1, minor: 0.95, rotationDeg: 0 } });
  const nearlyFace = flat.rotor.find(s => s.tag === 'ellipse' && /oblique-face/.test(s.attrs.class));
  assert.ok(Number(nearlyFace.attrs.rx) > Number(face.attrs.rx));

  // Le raccourci seul reste accepté : c'est le cas particulier grand axe = 1.
  const legacy = Primitives.build(GEAR(), { lod: LEVELS.INVOLUTE, presentation: 'oblique', foreshortening: 0.5 });
  const same = legacy.rotor.find(s => s.tag === 'ellipse' && /oblique-face/.test(s.attrs.class));
  assert.equal(same.attrs.rx, face.attrs.rx);
  assert.equal(same.attrs.ry, face.attrs.ry);

  // Plus de repère d'indexation FIXE en travers du corps : il ne bougeait pas,
  // et se lisait comme un axe, un diamètre ou un sens de rotation.
  assert.equal(built.rotor.filter(s => /index-mark/.test((s.attrs || {}).class || '')).length, 0);
});

test('the level of detail follows the apparent size, not the true diameter', () => {
  // Une roue vue presque en bout occupe une bande de quelques millimètres :
  // elle déclenchait un niveau maximal pour dessiner une développante haute de
  // trois pixels.
  const big = wheel({ kind: 'gear', teeth: 60, pitchD: 200, outsideD: 208, module: 2, faceWidth: 12 });
  const face = Primitives.levelFor(big, 1.6, { presentation: 'face' });
  const profile = Primitives.levelFor(big, 1.6, { presentation: 'profile' });
  const oblique = Primitives.levelFor(big, 1.6, { presentation: 'oblique', foreshortening: 0.1 });
  assert.ok(profile < face, 'de profil, elle mérite moins de détail');
  assert.ok(oblique < face, 'presque en bout aussi');
  // Sans orientation, le comportement historique est conservé.
  assert.equal(Primitives.levelFor(big, 1.6), face);
});

test('the helix hand reaches the drawing, for gears and for worms', () => {
  // La primitive lisait `helixHand`, que rien ne posait jamais : une hélice à
  // gauche se dessinait exactement comme une hélice à droite.
  const helical = hand => wheel({ kind: 'gear', teeth: 20, pitchD: 40, module: 2,
    faceWidth: 20, helixAngle: 25, handedness: hand });
  const stripe = built => built.rotor.filter(s => s.attrs && s.attrs.class === 'helix-stripe')[0].attrs.d;
  assert.notEqual(stripe(Primitives.build(helical('right'), { lod: LEVELS.TECHNICAL })),
    stripe(Primitives.build(helical('left'), { lod: LEVELS.TECHNICAL })));

  const worm = hand => wheel({ kind: 'worm', teeth: 2, pitchD: 20, module: 2, leadAngle: 20,
    handedness: hand, id: 's0-input' });
  const thread = built => built.rotor.find(s => s.attrs && s.attrs.class === 'worm-thread-clip')
    .children[0].children[0].attrs.d;
  // §39 : le sens du filet ne doit pas changer que la cinématique.
  assert.notEqual(thread(Primitives.build(worm('right'), { lod: LEVELS.INVOLUTE })),
    thread(Primitives.build(worm('left'), { lod: LEVELS.INVOLUTE })));
});

// ===== Les familles vues DE BIAIS =====================================
//
// Une seule primitive générique servait à tout le monde en oblique : la
// famille décidait du dessin de face et du dessin de profil, puis s'arrêtait
// au seuil de l'iso, où une vis, un cône et une couronne devenaient trois
// cylindres identiques.

const OBLIQUE = { major: 1, minor: 0.5, rotationDeg: 0 };
function obliqueOf(w, seen = OBLIQUE) {
  return Primitives.build(w, { lod: LEVELS.INVOLUTE, presentation: 'oblique', apparent: seen });
}
function obliqueClasses(shapes) {
  const out = new Set();
  (function walk(list) {
    list.forEach(s => {
      String((s.attrs || {}).class || '').split(/\s+/).filter(Boolean).forEach(c => out.add(c));
      if (s.children) walk(s.children);
    });
  })(shapes);
  return out;
}

const FAMILIES = {
  gear: () => wheel({ kind: 'gear', teeth: 20, pitchD: 40, module: 2, faceWidth: 20 }),
  'internal-ring': () => wheel({ kind: 'internal-ring', teeth: 54, pitchD: 108, module: 2, faceWidth: 20 }),
  pulley: () => wheel({ kind: 'pulley', teeth: 20, pitchD: 40, module: 2, faceWidth: 12 }),
  sprocket: () => wheel({ kind: 'sprocket', teeth: 17, pitchD: 40, module: 2, faceWidth: 12 }),
  worm: () => wheel({ kind: 'worm', teeth: 2, pitchD: 20, module: 2, leadAngle: 20, id: 's0-input' }),
  cone: () => wheel({ kind: 'cone', teeth: 20, pitchD: 40, module: 2, coneAngleDeg: 26.6, faceWidth: 15 })
};

test('every family keeps its own drawing when seen obliquely', () => {
  const signatures = new Map();
  for (const [kind, make] of Object.entries(FAMILIES)) {
    const built = obliqueOf(make());
    allFinite(built.rotor.concat(built.fixed || []));
    const classes = obliqueClasses(built.rotor);
    assert.ok(classes.size > 0, kind + ' ne dessine rien');
    signatures.set(kind, [...classes].sort().join('|'));
  }
  // Deux familles qui produisent EXACTEMENT le même jeu de classes sont deux
  // familles que le dessin ne distingue pas. C'est ce que faisait la primitive
  // générique unique : six familles, une seule signature.
  const seen = new Map();
  for (const [kind, signature] of signatures) {
    assert.ok(!seen.has(signature),
      kind + ' se dessine comme ' + seen.get(signature) + ' : ' + signature);
    seen.set(signature, kind);
  }
});

test('an internal ring seen obliquely keeps its bore open', () => {
  const built = obliqueOf(FAMILIES['internal-ring']());
  const face = built.rotor.find(s => /ring-oblique-face/.test((s.attrs || {}).class || ''));
  assert.ok(face, 'pas de face annulaire');
  // Deux sous-chemins et la règle evenodd : c'est ce qui fait un TROU. Un seul
  // chemin, ou une règle nonzero, et l'alésage se remplit.
  assert.equal(face.attrs['fill-rule'], 'evenodd');
  assert.equal((face.attrs.d.match(/M /g) || []).length, 2);
  // La jante ne barre pas l'alésage : les bandes de silhouette laissent la
  // bande centrale libre, là où le pignon vient s'engrener.
  const bands = built.rotor.filter(s => /ring-oblique-body/.test((s.attrs || {}).class || ''));
  assert.equal(bands.length, 2, 'un cylindre creux a DEUX bandes');
  assert.ok(built.rotor.some(s => /ring-oblique-bore/.test((s.attrs || {}).class || '')),
    'l’alésage se poursuit jusqu’au fond');
});

test('a worm seen obliquely keeps its threads, squeezed along its axis', () => {
  const seat = obliqueOf(FAMILIES.worm()).rotor
    .find(s => /worm-oblique-seat/.test((s.attrs || {}).class || ''));
  assert.ok(seat, 'la vis perd ses filets en oblique');
  assert.ok(seat.children && seat.children.length, 'le repère comprimé est vide');
  // Ce sont bien les FILETS qui sont dedans, pas un cylindre nu.
  assert.ok(obliqueClasses(seat.children).has('worm-thread'), 'le repère comprimé ne porte pas de filet');
  const [sx, sy] = /scale\(([-\d.]+) ([-\d.]+)\)/.exec(seat.attrs.transform).slice(1).map(Number);
  // L'axe se raccourcit, la section ne bouge pas : sqrt(1 − minor²) le long de
  // l'axe, `major` en travers.
  assert.ok(Math.abs(sx - Math.sqrt(1 - 0.5 * 0.5)) < 1e-3, 'raccourci axial faux : ' + sx);
  assert.ok(Math.abs(sy - 1) < 1e-3, 'la section ne se raccourcit pas : ' + sy);
  // Plus la vis est vue en bout, plus elle est courte.
  const endOn = obliqueOf(FAMILIES.worm(), { major: 1, minor: 0.9, rotationDeg: 0 }).rotor
    .find(s => /worm-oblique-seat/.test((s.attrs || {}).class || ''));
  assert.ok(Number(/scale\(([-\d.]+) /.exec(endOn.attrs.transform)[1]) < sx);
});

test('a bevel gear seen obliquely tapers towards the apex it shares', () => {
  function cone(apexSide) {
    const w = FAMILIES.cone();
    w.apexSide = apexSide;
    const built = obliqueOf(w);
    const back = built.rotor.find(s => /cone-oblique-back/.test((s.attrs || {}).class || ''));
    const front = built.rotor.find(s => /cone-oblique-face/.test((s.attrs || {}).class || ''));
    assert.ok(back && front, 'un cône a deux bases');
    return { back: back, front: front,
      teeth: built.rotor.find(s => /cone-teeth/.test((s.attrs || {}).class || '')) };
  }
  const right = cone(1);
  // Un tronc de cône, pas un cylindre : la petite base est plus petite.
  assert.ok(Number(right.front.attrs.ry) < Number(right.back.attrs.ry) * 0.95,
    'la petite base ne rétrécit pas');
  assert.ok(right.teeth, 'aucune génératrice : le cône se lit comme un cylindre');
  // Et elle est décalée le long de l'axe, du côté du sommet.
  assert.ok(Number(right.front.attrs.cx) > 0);
  const left = cone(-1);
  assert.ok(Number(left.front.attrs.cx) < 0,
    'les deux cônes d’un couple pointent du même côté : leurs sommets ne peuvent pas coïncider');
  assert.equal(Number(left.front.attrs.cx), -Number(right.front.attrs.cx));
});

test('a chain sprocket is not drawn as a smooth pulley', () => {
  const pulley = obliqueClasses(obliqueOf(FAMILIES.pulley()).rotor);
  const sprocket = obliqueClasses(obliqueOf(FAMILIES.sprocket()).rotor);
  // La poulie a une gorge lisse où la courroie adhère ; le pignon a des dents
  // dans lesquelles les maillons se logent.
  assert.ok(pulley.has('flexible-groove') && !pulley.has('sprocket-oblique-teeth'));
  assert.ok(sprocket.has('sprocket-oblique-teeth') && !sprocket.has('flexible-groove'));
  const teeth = obliqueOf(FAMILIES.sprocket()).rotor
    .find(s => /sprocket-oblique-teeth/.test((s.attrs || {}).class || ''));
  assert.equal((teeth.attrs.d.match(/M /g) || []).length, 17, 'une entaille par dent');
});
