const test = require('node:test');
const assert = require('node:assert/strict');
const Sizing = require('../js/core/GearSizing.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

test('two quantities fix the third, in each of the three directions', () => {
  // Z20 + m2 → Ø40
  const size = Sizing.solve({ module: 2, teeth: 20 });
  assert.equal(size.derived, 'diameter');
  assert.equal(size.diameter, 40);

  // Ø60 avec Z verrouillé → m3
  const module = Sizing.solve({ teeth: 20, diameter: 60, locked: ['teeth', 'diameter'] });
  assert.equal(module.derived, 'module');
  assert.ok(Math.abs(module.module - 3) < 1e-9);

  // Ø60 avec m verrouillé → Z30
  const teeth = Sizing.solve({ module: 2, diameter: 60, locked: ['module', 'diameter'] });
  assert.equal(teeth.derived, 'teeth');
  assert.equal(teeth.teeth, 30);
  assert.equal(teeth.diameter, 60);
});

test('an impossible demand is named, never absorbed by rescaling the drawing', () => {
  // m2 et Z20 imposent Ø40. Demander Ø60 en plus est contradictoire.
  const conflict = Sizing.solve({ module: 2, teeth: 20, diameter: 60,
    locked: ['module', 'teeth', 'diameter'] });
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.requestedDiameter, 60);
  assert.equal(conflict.impliedDiameter, 40);
  assert.match(conflict.message, /60/);
  assert.match(conflict.message, /40/);
  // Aucun diamètre n'est renvoyé : il n'y en a pas de valide à dessiner.
  assert.equal(conflict.diameter, null);

  // Le même cas SANS verrouiller le diamètre n'est pas un conflit : le
  // diamètre est la conséquence, il cède.
  const yields = Sizing.solve({ module: 2, teeth: 20, diameter: 60, locked: ['module', 'teeth'] });
  assert.equal(yields.status, 'solved');
  assert.equal(yields.derived, 'diameter');
  assert.equal(yields.diameter, 40);
});

test('the tooth count is an integer, so the reachable diameter is discrete', () => {
  // Ø65 avec m2 : 32,5 dents n'existent pas.
  const result = Sizing.solve({ module: 2, diameter: 65, locked: ['module', 'diameter'] });
  assert.equal(result.teeth, 33);
  assert.equal(result.diameter, 66);
  assert.ok(Math.abs(result.exactTeeth - 32.5) < 1e-9);
  // Arrondir en silence ferait mentir le diamètre affiché : on le dit.
  assert.match(result.message, /66/);
  assert.match(result.message, /65/);
});

test('a helical gear uses its normal module, cos β included', () => {
  // d = mn·Z / cos β : à module et dents égaux, une hélice grandit la roue.
  const straight = Sizing.solve({ module: 2, teeth: 20 }).diameter;
  const helical = Sizing.solve({ module: 2, teeth: 20, helixAngleDeg: 25 }).diameter;
  assert.ok(helical > straight);
  assert.ok(Math.abs(helical - 40 / Math.cos(25 * Math.PI / 180)) < 1e-9);

  // Le sens de l'hélice ne change pas le diamètre : seul son angle compte.
  assert.equal(Sizing.solve({ module: 2, teeth: 20, helixAngleDeg: -25 }).diameter, helical);

  // Et le chemin inverse retrouve le module normal.
  const back = Sizing.solve({ teeth: 20, diameter: helical, helixAngleDeg: 25, locked: ['teeth', 'diameter'] });
  assert.ok(Math.abs(back.module - 2) < 1e-9);
});

test('one quantity alone determines nothing, and says so', () => {
  ['module', 'teeth', 'diameter'].forEach(key => {
    const result = Sizing.solve({ [key]: 20 });
    assert.equal(result.status, 'underdetermined');
    assert.match(result.message, /deux grandeurs/);
  });
  assert.equal(Sizing.solve({}).status, 'underdetermined');
  assert.equal(Sizing.solve().status, 'underdetermined');
  // Zéro et négatif ne sont pas des valeurs : ce sont des champs vides.
  assert.equal(Sizing.solve({ module: 0, teeth: 20, diameter: 40 }).status, 'solved');
  assert.equal(Sizing.solve({ module: -2, teeth: 20 }).status, 'underdetermined');
});

test('a derived quantity is not editable, so nobody believes they can stretch a wheel', () => {
  const fields = Sizing.editable({ module: 2, teeth: 20, locked: ['module', 'teeth'] });
  const diameter = fields.find(f => f.key === 'diameter');
  assert.equal(diameter.derived, true);
  assert.equal(diameter.editable, false);
  assert.equal(diameter.value, 40);
  fields.filter(f => f.key !== 'diameter').forEach(field => {
    assert.equal(field.locked, true);
    assert.equal(field.editable, true);
  });
});

test('the solved size matches what the engine would compute for the same gear', () => {
  // Le module et les dents restent la source : ce solveur ne doit jamais
  // proposer une roue que le registre dessinerait autrement.
  [[2, 20, 'spur', undefined], [3, 41, 'spur', undefined], [2, 18, 'helical', 25]].forEach(([m, z, type, beta]) => {
    const stage = { type: type, input: { teeth: z }, output: { teeth: z * 2 },
      parameters: Object.assign({ module: m, pressureAngle: 20, faceWidth: 20 },
        beta == null ? {} : { helixAngle: beta }) };
    const geometry = Registry.get(type).calculateGeometry(stage);
    const solved = Sizing.solve({ module: m, teeth: z, helixAngleDeg: beta });
    assert.ok(Math.abs(solved.diameter - geometry.pitchDiameterInput) < 1e-6,
      `${type} m=${m} Z=${z}`);
  });
});
