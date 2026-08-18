const test = require('node:test');
const assert = require('node:assert/strict');
const GeometryLayout = require('../js/visualization/geometry/GeometryLayout.js');
const SpatialLayout = require('../js/visualization/core/SpatialLayout.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

function stage(type, config) {
  const def = Registry.get(type);
  const s = Object.assign({ type: type, parameters: { module: 1 } }, config);
  s.geometry = def.calculateGeometry(s);
  return s;
}
function mixed() {
  return { stages: [
    stage('spur', { input: { teeth: 12 }, output: { teeth: 36 }, parameters: { module: 2, faceWidth: 20 } }),
    stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } }),
    stage('bevel', { input: { teeth: 15 }, output: { teeth: 30 }, parameters: { module: 2, shaftAngle: 90 } })
  ], mechanical: [{ ratio: 3 }, { ratio: 20 }, { ratio: 2 }] };
}
const VIEWS = ['unfolded', 'front', 'top', 'side', 'iso'];

test('the dimensioned view knows how each part presents itself', () => {
  for (const view of VIEWS) {
    const model = GeometryLayout.build(mixed(), { view });
    model.stages.forEach(item => item.members.forEach(member => {
      assert.ok(['face', 'profile', 'oblique'].includes(member.presentation),
        view + ' ' + member.role + ' : ' + member.presentation);
      assert.ok(member.apparent, 'pas d’ellipse apparente en ' + view);
      // Un diamètre se projette toujours en vraie grandeur dans UNE direction :
      // c'est ce qui permet de le coter sans mentir. Le grand axe de l'ellipse
      // apparente vaut donc toujours 1.
      assert.ok(Math.abs(member.apparent.major - 1) < 1e-9,
        view + ' ' + member.role + ' grand axe ' + member.apparent.major);
      // Et la forme apparente suit la présentation, sans exception.
      if (member.presentation === 'face') assert.ok(Math.abs(member.apparent.minor - 1) < 1e-9);
      else if (member.presentation === 'profile') assert.ok(member.apparent.minor < 1e-9);
      else assert.ok(member.apparent.minor > 1e-9 && member.apparent.minor < 1 - 1e-9);
    }));
  }
});

test('what follows an axis is shortened, what crosses it is not', () => {
  for (const view of VIEWS) {
    const model = GeometryLayout.build(mixed(), { view });
    model.stages.forEach(item => item.members.forEach(member => {
      const expected = view === 'unfolded' ? 1
        : Math.sqrt(Math.max(0, 1 - member.apparent.minor * member.apparent.minor));
      assert.ok(Math.abs(member.axialScale - expected) < 1e-9,
        view + ' ' + member.role + ' : ' + member.axialScale + ' vs ' + expected);
    }));
    if (view === 'unfolded') continue;
    // Vu de face, un cylindre n'a plus de longueur apparente ; vu de profil,
    // il la garde entière.
    model.stages.forEach(item => item.members.forEach(member => {
      if (member.presentation === 'face') assert.ok(member.axialScale < 1e-9, view + ' ' + member.role);
      if (member.presentation === 'profile') assert.ok(Math.abs(member.axialScale - 1) < 1e-9, view + ' ' + member.role);
    }));
  }
});

test('an axis is the segment a shaft projects, a cross only when seen end-on', () => {
  // Train composé : deux étages, donc un arbre intermédiaire qui porte deux
  // roues. Elles doivent partager UNE ligne d'axe, pas deux croix.
  const compound = { stages: [
    stage('spur', { input: { teeth: 12 }, output: { teeth: 36 }, parameters: { module: 2, faceWidth: 20 } }),
    stage('spur', { input: { teeth: 12 }, output: { teeth: 36 }, parameters: { module: 2, faceWidth: 20 } })
  ], mechanical: [{ ratio: 3 }, { ratio: 3 }] };

  const drawn = GeometryLayout.build(compound, { view: 'front' });
  drawn.stages.forEach((item, index) => {
    assert.ok(item.axes.length >= 1, 'étage ' + index + ' sans axe');
    item.axes.forEach(mark => {
      // Vue de face, les arbres sont dans le plan de l'écran : ce sont des
      // segments, jamais des croix.
      assert.equal(mark.endOn, false);
      assert.ok(Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1) > 1,
        'axe de longueur nulle à l’étage ' + index);
    });
  });

  // Vue en bout : le regard suit les arbres, ils se voient en un point.
  const endOn = GeometryLayout.build(compound, { view: 'side' });
  endOn.stages.forEach(item => item.axes.forEach(mark => {
    assert.equal(mark.endOn, true);
    assert.ok(mark.reach > 0);
  }));

  // Les satellites partagent un corps mais pas une ligne : chacun garde le sien.
  const planetary = { stages: [stage('planetary', { sunTeeth: 24, ringTeeth: 72, planetTeeth: 24,
    planetCount: 4, inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2 } })],
    mechanical: [{ ratio: 4 }] };
  const axes = GeometryLayout.build(planetary, { view: 'unfolded' }).stages[0].axes;
  assert.ok(axes.length >= 4, 'les satellites se partagent une seule marque d’axe : ' + axes.length);
});

test('a bevel pair aims its two cones at one and the same apex', () => {
  for (const view of VIEWS) {
    const model = GeometryLayout.build(mixed(), { view });
    const cones = model.stages[2].members;
    assert.equal(cones.length, 2);
    cones.forEach(cone => assert.ok(cone.apexSide === 1 || cone.apexSide === -1,
      view + ' : côté du sommet inconnu (' + cone.apexSide + ')'));
    // Les deux côtés se déduisent du MONDE : les deux sommets s'y rejoignent.
    const spatial = model.frame.spatial;
    const world = cones.map(cone => {
      const placed = spatial.byId[cone.memberId];
      const back = SpatialLayout.coneBack(cone.pitchDiameter, cone.coneAngleDeg);
      return [0, 1, 2].map(i => placed.position[i] + placed.axis[i] * cone.apexSide * back);
    });
    assert.ok(Math.hypot(world[0][0] - world[1][0], world[0][1] - world[1][1], world[0][2] - world[1][2]) < 1e-6,
      view + ' : les deux sommets ne se rejoignent pas — ' + world.join(' | '));
  }
});

test('two cones that do not meet get no apex at all', () => {
  // Un couple dont les deux axes ne se coupent pas n'a pas de sommet commun :
  // en inventer un orienterait les silhouettes d'après une coïncidence.
  const apex = SpatialLayout.coneApex(
    { position: [0, 0, 0], axis: [1, 0, 0], back: 30 },
    { position: [0, 50, 90], axis: [0, 1, 0], back: 15 });
  assert.ok(apex.gap > 1, 'un écart de 90 mm passe pour un sommet : ' + apex.gap);
  assert.equal(SpatialLayout.coneApex(null, { position: [0, 0, 0], axis: [1, 0, 0], back: 15 }), null);
  assert.equal(SpatialLayout.coneApex({ position: [0, 0, 0], axis: [1, 0, 0], back: 0 },
    { position: [0, 0, 0], axis: [0, 1, 0], back: 15 }), null);
});
