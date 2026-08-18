const test = require('node:test');
const assert = require('node:assert/strict');
const Inspector = require('../js/visualization/StageInspector.js');
const Forces = require('../js/visualization/overlays/ForceOverlay.js');
const Warnings = require('../js/visualization/overlays/WarningOverlay.js');

test('stage inspector exposes stable mechanical data without a DOM', () => {
  const solution = { inputSpeedRpm: 1500, stages: [{ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2 }, geometry: { centerDistance: 80 } }], mechanical: [{ ratio: 3, efficiency: .98, bending: { safetyFactor: 2.1 }, contact: { safetyFactor: 1.7 } }] };
  const data = Inspector.model(solution, 0, { getToothCounts: () => [20, 60] });
  assert.deepEqual(data.teeth, [20, 60]); assert.equal(data.outputRpm, 500); assert.equal(data.bendingSafety, 2.1);
});

test('force overlay normalizes vectors while preserving values', () => {
  // Le repère de l'engrènement : axe Z, ligne des centres suivant X. Ft suit
  // donc Y, Fr revient vers −X, Fa suit Z.
  const mesh = Forces.frame({ axis: [0, 0, 1], centre: [0, 0, 0], mate: [100, 0, 0], view: 'front' });
  const vectors = Forces.vectors({ tangentialN: 800, radialN: 200, axialN: -400 }, 24, mesh);
  assert.equal(vectors.length, 3);
  // La plus grande valeur prend toute la longueur, les autres à l'échelle.
  assert.ok(Math.abs(Math.hypot(vectors[0].x2, vectors[0].y2) - 24) < 1e-9);
  assert.ok(Math.hypot(vectors[1].x2, vectors[1].y2) < 24);
  assert.equal(vectors[2].value, -400);
});

test('the three forces come from the mesh, never from the screen', () => {
  const mesh = Forces.frame({ axis: [0, 0, 1], centre: [0, 0, 0], mate: [100, 0, 0], view: 'front' });
  // Vue de face (u = X, v = −Y, w = Z) : Ft suit Y, Fr revient vers −X, et Fa
  // pointe droit dans l'œil.
  const near = (got, want, what) => assert.ok(
    Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]) < 1e-12, what + ' : ' + got);
  near(mesh.world.tangentialN, [0, 1, 0], 'Ft');
  near(mesh.world.radialN, [-1, 0, 0], 'Fr');
  near(mesh.world.axialN, [0, 0, 1], 'Fa');
  const drawn = Forces.vectors({ tangentialN: 800, radialN: 200, axialN: 400 }, 24, mesh);
  const ft = drawn[0], fr = drawn[1], fa = drawn[2];
  // Ft est perpendiculaire à la ligne des centres, à l'écran comme dans le
  // mécanisme : c'est ce qu'une rosace fixe ne pouvait pas garantir.
  assert.ok(Math.abs(ft.x2 * fr.x2 + ft.y2 * fr.y2) < 1e-9);
  // Fa pointe vers l'œil : plus de longueur à montrer, seulement un sens.
  assert.equal(fa.x2, 0); assert.equal(fa.y2, 0);
  assert.equal(fa.towards, -1, 'Fa devrait s’enfoncer dans la feuille');
  // Le même effort, de l'autre côté : le symbole change de sens.
  assert.equal(Forces.vectors({ axialN: -400 }, 24, mesh)[0].towards, 1);

  // Tourner la ligne des centres tourne les flèches, d'exactement autant.
  const turned = Forces.frame({ axis: [0, 0, 1], centre: [0, 0, 0], mate: [0, 100, 0], view: 'front' });
  const after = Forces.vectors({ tangentialN: 800 }, 24, turned)[0];
  const angle = Math.atan2(after.y2, after.x2) - Math.atan2(ft.y2, ft.x2);
  assert.ok(Math.abs(Math.cos(angle)) < 1e-9 && Math.abs(Math.abs(Math.sin(angle)) - 1) < 1e-9,
    'les flèches n’ont pas tourné d’un quart de tour avec la ligne des centres : ' + angle);
});

test('without a mesh, no arrow at all', () => {
  // Une direction inventée vaut moins que rien sur un dessin : sans ligne des
  // centres, on ne dessine pas.
  assert.deepEqual(Forces.vectors({ tangentialN: 800, radialN: 200 }, 24), []);
  assert.deepEqual(Forces.vectors({ tangentialN: 800 }, 24, null), []);
  // Et une ligne des centres qui n'existe pas ne fabrique pas de repère :
  // deux organes coaxiaux, ou confondus.
  assert.equal(Forces.frame({ axis: [0, 0, 1], centre: [0, 0, 0], mate: [0, 0, 50], view: 'front' }), null);
  assert.equal(Forces.frame({ axis: [0, 0, 1], centre: [0, 0, 0], mate: [0, 0, 0], view: 'front' }), null);
  assert.equal(Forces.frame({ centre: [0, 0, 0], mate: [10, 0, 0], view: 'front' }), null);
});

test('the warning overlay only shows what the engine declared, where it declared it', () => {
  // Le viewer ne décide plus si une mécanique tient : il n'a plus de quoi.
  assert.equal(typeof Warnings.derive, 'undefined', 'aucun calcul d’alerte dans le viewer');

  const emitted = [
    { code: 'UNDERCUT', stageIndex: 1 },
    { code: 'LOW_BENDING_SAFETY', stageIndex: 0, level: 'danger' },
    { code: 'THERMAL_RISK', stageIndex: null },       // portée : la chaîne entière
    { code: 'LOW_CONTACT_RATIO', stage: 3 }           // forme historique, 1-indexée
  ];
  assert.deepEqual(Warnings.forStage(emitted, 1).map(w => w.code), ['UNDERCUT']);
  assert.deepEqual(Warnings.forStage(emitted, 0).map(w => w.code), ['LOW_BENDING_SAFETY']);
  assert.deepEqual(Warnings.forStage(emitted, 2).map(w => w.code), ['LOW_CONTACT_RATIO']);
  // Une alerte de chaîne ne se pose sur AUCUN étage : elle s'affichait
  // auparavant sur tous, faute de savoir où la mettre.
  assert.deepEqual([0, 1, 2, 3].flatMap(i => Warnings.forStage(emitted, i)).filter(w => w.code === 'THERMAL_RISK'), []);
  assert.deepEqual(Warnings.forStage(null, 0), []);
});

test('the engine scopes each warning to the stage it concerns', () => {
  const Engineering = require('../js/core/Engineering.js');
  // Un pignon de 12 dents sous-coupe ; il est ici au SECOND étage.
  const solution = Engineering.analyzeSolution([
    { type: 'spur', input: { teeth: 24 }, output: { teeth: 48 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } },
    { type: 'spur', input: { teeth: 12 }, output: { teeth: 48 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } }
  ], 8, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  const undercut = solution.warnings.filter(w => w.code === 'UNDERCUT');
  assert.equal(undercut.length, 1);
  assert.equal(undercut[0].stageIndex, 1, 'l’alerte désigne l’étage fautif, pas la chaîne');
  // Les alertes de chaîne restent sans portée d'étage.
  solution.warnings.filter(w => w.code === 'LOW_EFFICIENCY' || w.code === 'THERMAL_RISK')
    .forEach(w => assert.equal(w.stageIndex, null));
});
