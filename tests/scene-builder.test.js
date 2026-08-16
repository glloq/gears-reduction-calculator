const test = require('node:test');
const assert = require('node:assert/strict');
const SceneBuilder = require('../js/visualization/core/SceneBuilder.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

function analysed(stage) {
  const definition = Registry.get(stage.type === 'epicyclic' ? 'planetary' : stage.type);
  stage.geometry = definition.calculateGeometry(stage);
  return stage;
}

test('scene builder only exposes calculated dimensions', () => {
  const stage = { type: 'spur', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2 }, geometry: { pitchDiameterInput: 40, pitchDiameterOutput: 80, width: 12, axisRelation: 'parallel' } };
  const scene = SceneBuilder.build({ inputRpm: 1000, stages: [stage], mechanical: [{ outputTorqueNm: 25 }] });
  assert.equal(scene.members.length, 2);
  assert.equal(scene.members[0].geometry.pitchDiameter, 40);
  assert.equal(scene.members[0].geometry.width, 12);
  assert.equal(scene.members[1].mechanical.rpm, -500);
  assert.equal(scene.connections[0].axisRelation, 'parallel');
  // Le moteur n'a pas donné de Ø tête : la valeur reconstruite est signalée.
  assert.equal(scene.members[0].isExact('pitchDiameter'), true);
  assert.equal(scene.members[0].isExact('outsideDiameter'), false);
  assert.equal(scene.members[0].schematic, true);
});

test('a fully calculated stage declares every dimension as exact', () => {
  const stage = analysed({ type: 'spur', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } });
  const scene = SceneBuilder.build({ inputRpm: 1500, stages: [stage], mechanical: [{}] });
  for (const entry of scene.members) {
    for (const key of ['pitchDiameter', 'outsideDiameter', 'rootDiameter', 'baseDiameter', 'width']) {
      assert.equal(entry.isExact(key), true, entry.id + '.' + key + ' devrait venir du moteur');
    }
    assert.equal(entry.schematic, false, entry.id + ' ne devrait rien reconstruire');
  }
});

test('a planetary exposes the real geometry of S, R, P and C — not a generic pair', () => {
  const stage = analysed({ type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 5,
    inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2, faceWidth: 20 } });
  const scene = SceneBuilder.build({ inputRpm: 1200, stages: [stage], mechanical: [{}] });
  const byRole = Object.fromEntries(scene.members.map(m => [m.role, m]));
  assert.deepEqual(Object.keys(byRole).sort(), ['C', 'P', 'R', 'S']);

  // Chaque membre porte SA géométrie, pas celle d'une sortie générique.
  assert.equal(byRole.S.geometry.pitchDiameter, 48);
  assert.equal(byRole.R.geometry.pitchDiameter, 144);
  assert.equal(byRole.P.geometry.pitchDiameter, 48);
  assert.equal(byRole.S.isExact('pitchDiameter'), true);
  assert.equal(byRole.R.isExact('pitchDiameter'), true);
  assert.equal(byRole.P.isExact('pitchDiameter'), true);
  assert.notEqual(byRole.S.geometry.pitchDiameter, byRole.R.geometry.pitchDiameter);

  // La couronne a sa tête vers le centre, le solaire vers l'extérieur.
  assert.ok(byRole.R.geometry.outsideDiameter < byRole.R.geometry.pitchDiameter);
  assert.ok(byRole.S.geometry.outsideDiameter > byRole.S.geometry.pitchDiameter);

  // Satellites : nombre réel, orbite réelle, rotation propre ET orbite.
  assert.equal(byRole.P.count, 5);
  assert.equal(byRole.P.orbitRadius, 48);
  assert.equal(byRole.C.mechanical.rpm, scene.kinematics.members['s0-C'].omega);
  assert.ok(Number.isFinite(byRole.P.mechanical.orbitRelativeSpeed));
  assert.notEqual(byRole.P.mechanical.relativeSpeed, byRole.P.mechanical.orbitRelativeSpeed);
});

test('a rack exposes its pinion and its travel, and no phantom output gear', () => {
  const stage = analysed({ type: 'rack', pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } });
  const scene = SceneBuilder.build({ inputSpeedRpm: 1500, stages: [stage], mechanical: [{}] });
  const [pinion, rack] = scene.members;
  assert.equal(pinion.kind, 'gear');
  assert.equal(rack.kind, 'rack');
  assert.equal(rack.geometry.pitchDiameter, undefined, 'une crémaillère n\'a pas de diamètre primitif');
  assert.equal(rack.isExact('travelPerRevolution'), true);
  assert.ok(Math.abs(rack.geometry.travelPerRevolution - 40 * Math.PI) < 1e-9);
  assert.equal(rack.mechanical.mmPerRadian, 20);
});

test('shafts separate the shared axis from the actual rotating shaft', () => {
  const stages = [
    analysed({ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2 } }),
    analysed({ type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 3, inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2 } }),
    analysed({ type: 'spur', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2 } })
  ];
  const scene = SceneBuilder.build({ inputSpeedRpm: 1500, stages, mechanical: [{}, {}, {}] });
  assert.equal(scene.shafts.length, 4);
  assert.equal(scene.shafts[0].relativeSpeed, 1);
  assert.equal(scene.shafts[0].role, 'input');
  assert.equal(scene.shafts[3].role, 'output');

  // Le planétaire est coaxial : MÊME axe que son entrée, mais arbre distinct,
  // car sa sortie ne tourne pas à la même vitesse.
  const planetary = scene.shafts[2];
  assert.equal(planetary.coaxial, true);
  assert.equal(planetary.axis, scene.shafts[1].axis, 'axe partagé');
  assert.notEqual(planetary.id, scene.shafts[1].id, 'arbre distinct');
  assert.notEqual(planetary.relativeSpeed, scene.shafts[1].relativeSpeed, 'vitesse distincte');
  // Le dernier étage n'est pas coaxial : nouvel axe.
  assert.equal(scene.shafts[3].axis, planetary.axis + 1);

  // Chaque membre est rattaché à un arbre, et un seul.
  const attached = scene.shafts.flatMap(s => s.memberIds);
  assert.equal(attached.length, scene.members.length);
  assert.equal(new Set(attached).size, scene.members.length);
});

test('members are addressable by id, which is the animation key', () => {
  const stage = analysed({ type: 'spur', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2 } });
  const scene = SceneBuilder.build({ inputRpm: 1000, stages: [stage], mechanical: [{}] });
  assert.equal(scene.member('s0-input').role, 'input');
  assert.equal(scene.member('s0-output').role, 'output');
  assert.equal(scene.member('inconnu'), null);
  assert.equal(scene.stageMembers(0).length, 2);
  // Les identifiants sont exactement ceux du moteur cinématique.
  scene.members.forEach(entry => {
    const known = scene.kinematics.members[entry.id] || scene.kinematics.linear[entry.id];
    assert.ok(known, entry.id + ' absent du moteur cinématique');
  });
});
