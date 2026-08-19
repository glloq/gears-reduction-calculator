const test = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../js/visualization/core/MechanicalGraph.js');
const SpatialLayout = require('../js/visualization/core/SpatialLayout.js');
const Engineering = require('../js/core/Engineering.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

// ===== Un étage par famille, avec les paramètres que le moteur sait tailler =====
//
// Une transmission n'est pas un tas de roues : c'est un ASSEMBLAGE, et chaque
// famille impose sa propre relation entre les axes qu'elle relie. Un couple
// droit garde ses axes parallèles à l'entraxe exact, une vis sans fin les
// croise à angle droit sans les couper, un couple conique les fait se COUPER
// sous l'angle d'arbre, un planétaire n'en a qu'un, une crémaillère n'en a
// plus. C'est cette relation, et elle seule, qui fait qu'un dessin se lit comme
// un mécanisme plutôt que comme des pièces posées côte à côte.

const STAGES = {
  spur: { type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } },
  helical: { type: 'helical', input: { teeth: 18 }, output: { teeth: 54 }, parameters: { module: 2, helixAngle: 25, pressureAngle: 20, faceWidth: 20 } },
  internal: { type: 'internal', input: { teeth: 18 }, output: { teeth: 54 }, parameters: { module: 2, pressureAngle: 20 } },
  bevel: { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 90, faceWidth: 15 } },
  bevel60: { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 60, faceWidth: 15 } },
  bevel120: { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 120, faceWidth: 15 } },
  worm: { type: 'worm', wormStarts: 2, wheelTeeth: 40, parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } },
  belt: { type: 'belt', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { pitch: 5, centerDistance: 150, profile: 'HTD-5M' } },
  chain: { type: 'chain', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { pitch: 12.7, centerDistance: 250 } },
  planetary: { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 3, inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2, faceWidth: 20 } },
  rack: { type: 'rack', pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } }
};

function graphOf(names, target) {
  const stages = names.map(name => JSON.parse(JSON.stringify(STAGES[name])));
  return Graph.build(Engineering.analyzeSolution(stages, target || 10, { inputSpeedRpm: 1500, inputTorqueNm: 10 }));
}
const geometryOf = name => Registry.get(STAGES[name].type).calculateGeometry(STAGES[name]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angleDeg = (a, b) => Math.acos(Math.min(1, Math.max(-1, Math.abs(dot(a, b))))) * 180 / Math.PI;

/** La distance entre deux DROITES — l'entraxe —, et non entre deux points. */
function betweenAxes(a, b) {
  const n = cross(a.direction, b.direction);
  const delta = sub(b.origin, a.origin);
  if (norm(n) < 1e-9) {
    const along = dot(delta, a.direction);
    return norm(sub(delta, a.direction.map(c => c * along)));
  }
  return Math.abs(dot(delta, n)) / norm(n);
}
function axesOf(graph, name) {
  const layout = SpatialLayout.build(graph);
  const pick = role => layout.members.filter(m => m.memberRole === role)[0];
  const input = pick('input'), output = pick('output');
  return { input: graph.byAxis[input.axisId], output: graph.byAxis[output.axisId], layout: layout };
}

test('parallel-axis families sit at the exact centre distance, and stay parallel', () => {
  // L'entraxe n'est pas un espacement de dessin : c'est la donnée qui fait que
  // deux dentures engrènent. Le prendre ailleurs que dans la géométrie de
  // l'étage reviendrait à dessiner un couple qui ne tourne pas.
  ['spur', 'helical', 'internal', 'belt', 'chain'].forEach(name => {
    const { input, output } = axesOf(graphOf([name], 3));
    const geometry = geometryOf(name);
    assert.ok(angleDeg(input.direction, output.direction) < 1e-9, name + ' : axes non parallèles');
    assert.ok(Math.abs(betweenAxes(input, output) - geometry.centerDistance) < 1e-9,
      name + ' : entraxe ' + betweenAxes(input, output) + ' au lieu de ' + geometry.centerDistance);
  });
});

test('a worm crosses its wheel at a right angle, without meeting it', () => {
  // La vis et sa roue sont perpendiculaires ET distantes : leurs axes se
  // croisent sans se couper, à l'entraxe. Les confondre avec un couple conique
  // — qui, lui, a un point commun — fait passer la vis au travers de la roue.
  const { input, output } = axesOf(graphOf(['worm'], 20));
  assert.ok(Math.abs(angleDeg(input.direction, output.direction) - 90) < 1e-9);
  assert.ok(Math.abs(betweenAxes(input, output) - geometryOf('worm').centerDistance) < 1e-9);
  assert.ok(betweenAxes(input, output) > 1, 'une vis sans fin dont les axes se coupent');
});

test('a bevel pair meets at its apex, whatever the shaft angle', () => {
  // C'est le défaut qui a motivé ce test : seuls les renvois à 90° étaient
  // construits comme des renvois. Un couple conique taillé à 60° tombait dans
  // la branche « parallèle » — deux cônes posés bout à bout sur un même axe,
  // qui n'engrenaient rien et que rien ne signalait.
  [['bevel', 90], ['bevel60', 60], ['bevel120', 120]].forEach(([name, wanted]) => {
    const { input, output } = axesOf(graphOf([name], 2));
    const angle = angleDeg(input.direction, output.direction);
    const expected = Math.min(wanted, 180 - wanted);
    assert.ok(Math.abs(angle - expected) < 1e-6,
      name + ' : arbres à ' + angle.toFixed(3) + '° au lieu de ' + expected + '°');
    assert.ok(betweenAxes(input, output) < 1e-6,
      name + ' : les axes ne se coupent pas (écart ' + betweenAxes(input, output).toFixed(3) + ')');
  });
});

test('the two cones of a bevel pair share one apex', () => {
  // Deux cônes qui n'ont pas le même sommet ne sont pas un couple : leurs
  // génératrices ne se touchent nulle part.
  ['bevel', 'bevel60'].forEach(name => {
    const { layout } = axesOf(graphOf([name], 2));
    const cones = layout.members.filter(m => m.kind === 'cone');
    assert.equal(cones.length, 2, name);
    const geometry = geometryOf(name);
    const backs = [SpatialLayout.coneBack(geometry.pitchDiameterInput, geometry.pitchConeAngleInput),
      SpatialLayout.coneBack(geometry.pitchDiameterOutput, geometry.pitchConeAngleOutput)];
    const apex = SpatialLayout.coneApex(
      { position: cones[0].position, axis: cones[0].axis, back: backs[0] },
      { position: cones[1].position, axis: cones[1].axis, back: backs[1] });
    assert.ok(apex, name + ' : aucun sommet');
    // Au micron près : c'est le sommet d'un cône, pas une coïncidence.
    assert.ok(apex.gap < 1e-3, name + ' : sommets distants de ' + apex.gap.toExponential(2) + ' mm');
  });
});

test('a planetary train has one axis, and its satellites orbit around it', () => {
  const graph = graphOf(['planetary'], 4);
  const layout = SpatialLayout.build(graph);
  const directions = layout.members.map(m => graph.byAxis[m.axisId].direction);
  directions.forEach(d => assert.ok(angleDeg(directions[0], d) < 1e-9, 'un organe hors de l’axe de l’étage'));
  // Les satellites ne sont pas SUR l'axe : ils orbitent autour, à l'entraxe
  // solaire-satellite.
  const planet = graph.shafts.filter(s => s.role === 'planet')[0];
  assert.ok(planet, 'aucun arbre de satellite');
  const geometry = geometryOf('planetary');
  assert.ok(Math.abs(planet.orbitRadius - (geometry.sunDiameter + geometry.planetDiameter) / 2) < 1e-9,
    'rayon d’orbite ' + planet.orbitRadius);
});

test('a rack slides across the pinion axis, on the side the model names', () => {
  // La crémaillère n'a pas d'axe : elle a une GLISSIÈRE. Sa ligne primitive est
  // tangente au cercle primitif du pignon, et le côté où elle passe est une
  // donnée du mécanisme — que le dessin lisait jusqu'ici dans une normale
  // d'écran, donc différemment selon le point de vue.
  const graph = graphOf(['rack'], 1);
  const slide = graph.slides[0];
  assert.ok(slide, 'aucune glissière');
  const axis = graph.byAxis[graph.shafts[0].axisId];
  assert.ok(Math.abs(dot(slide.direction, axis.direction)) < 1e-9, 'la course n’est pas perpendiculaire à l’axe');
  assert.ok(slide.contact, 'la glissière ne dit pas de quel côté elle passe');
  assert.ok(Math.abs(norm(slide.contact) - 1) < 1e-9, 'direction de contact non unitaire');
  assert.ok(Math.abs(dot(slide.contact, axis.direction)) < 1e-9, 'le contact n’est pas dans le plan du pignon');
  assert.ok(Math.abs(dot(slide.contact, slide.direction)) < 1e-9, 'le contact n’est pas perpendiculaire à la course');
});

test('a stage placed after a right-angle drive leaves the plane of the one before', () => {
  // Un renvoi qui ne renvoie rien : c'est ce qu'on obtient si l'étage suivant
  // repart dans le plan du précédent. Le train se dessine alors à plat, et deux
  // architectures différentes se ressemblent.
  [['bevel', 'spur'], ['worm', 'spur'], ['bevel60', 'spur']].forEach(names => {
    const graph = graphOf(names, 6);
    const layout = SpatialLayout.build(graph);
    const first = graph.byAxis[layout.members[0].axisId].direction;
    const last = graph.byAxis[layout.members[layout.members.length - 1].axisId].direction;
    assert.ok(angleDeg(first, last) > 1e-6,
      names.join('+') + ' : le train est resté dans un seul plan');
  });
});

test('every family keeps its axis relation once it is drawn', () => {
  // Le contrat de bout en bout : ce que la famille DÉCLARE, le graphe le
  // réalise. Sans lui, une famille nouvelle tombe dans la branche par défaut —
  // « parallèle » — et personne ne s'en aperçoit.
  Object.keys(STAGES).forEach(name => {
    if (name === 'planetary' || name === 'rack') return;
    const geometry = geometryOf(name);
    const { input, output } = axesOf(graphOf([name], 3));
    const angle = angleDeg(input.direction, output.direction);
    const gap = betweenAxes(input, output);
    if (geometry.axisRelation === 'parallel' || geometry.axisRelation === 'internal-parallel') {
      assert.ok(angle < 1e-9, name + ' : ' + geometry.axisRelation + ' dessiné à ' + angle.toFixed(2) + '°');
    } else if (geometry.axisRelation === 'perpendicular') {
      assert.ok(Math.abs(angle - 90) < 1e-9, name + ' : perpendiculaire dessiné à ' + angle.toFixed(2) + '°');
    } else if (geometry.axisRelation === 'crossed') {
      const wanted = Math.min(geometry.shaftAngleDeg, 180 - geometry.shaftAngleDeg);
      assert.ok(Math.abs(angle - wanted) < 1e-6, name + ' : croisé dessiné à ' + angle.toFixed(2) + '°');
      assert.ok(gap < 1e-6, name + ' : croisé, mais les axes ne se coupent pas');
    } else {
      assert.fail(name + ' : relation d’axes « ' + geometry.axisRelation + ' » non couverte par ce test');
    }
  });
});
