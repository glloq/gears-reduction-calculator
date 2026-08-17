const test = require('node:test');
const assert = require('node:assert/strict');
const Compliance = require('../js/core/SolutionCompliance.js');
const Engineering = require('../js/core/Engineering.js');

function chain(options) {
  return Engineering.analyzeSolution([
    { type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } }
  ], 3, options || {});
}

test('a safety factor below its limit is never reported as satisfied', () => {
  // C'était le mensonge le plus direct de la carte : « ✓ SF 0.82 ».
  const weak = { mechanical: [{ mechanicalStatus: 'evaluated', bending: { safetyFactor: 0.82 }, contact: { safetyFactor: 0.94 } }] };
  const result = Compliance.evaluate(weak, {});
  assert.equal(result.bending.state, 'danger');
  assert.equal(result.contact.state, 'danger');
  assert.equal(Compliance.badges(result).find(b => b.key === 'bending').mark, '✕');
  assert.match(result.bending.label, /0\.82/);
  assert.match(result.bending.detail, /1\.30/);
});

test('a comfortable safety factor is satisfied, a marginal one is a reserve', () => {
  const comfortable = { mechanical: [{ mechanicalStatus: 'evaluated', bending: { safetyFactor: 3 }, contact: { safetyFactor: 2 } }] };
  assert.equal(Compliance.evaluate(comfortable, {}).bending.state, 'ok');
  const marginal = { mechanical: [{ mechanicalStatus: 'evaluated', bending: { safetyFactor: 1.4 } }] };
  assert.equal(Compliance.evaluate(marginal, {}).bending.state, 'warning');
});

test('what was never evaluated is unknown, not compliant', () => {
  // Une chaîne analysée sans couple d'entrée : il n'y a AUCUN facteur de
  // sécurité. La carte en affichait pourtant deux coches vertes.
  const result = Compliance.evaluate(chain({}), {});
  assert.equal(result.bending.state, 'unknown');
  assert.equal(result.contact.state, 'unknown');
  assert.equal(result.bending.value, null);
  assert.match(result.bending.detail, /couple/);
  assert.equal(Compliance.badges(result).find(b => b.key === 'contact').mark, '·');
});

test('accuracy and size are only judged against what was actually asked', () => {
  const solution = chain({ inputSpeedRpm: 1500, inputTorqueNm: 10 });

  // Sans tolérance ni limite d'encombrement demandées, on donne le chiffre et
  // aucun verdict : « conforme » à quoi ?
  const silent = Compliance.evaluate(solution, {});
  assert.equal(silent.ratio.state, 'unknown');
  assert.match(silent.ratio.detail, /Aucune tolérance/);
  assert.equal(silent.dimensions.state, 'unknown');
  assert.match(silent.dimensions.detail, /Aucune limite/);

  // Demandées, elles sont vérifiées pour de bon.
  const asked = Compliance.evaluate(solution, { tolerancePercent: 1, maxDiameter: 500 });
  assert.equal(asked.ratio.state, 'ok');
  assert.equal(asked.dimensions.state, 'ok');
  const tight = Compliance.evaluate(solution, { tolerancePercent: 1, maxDiameter: 10 });
  assert.equal(tight.dimensions.state, 'danger');
  assert.match(tight.dimensions.detail, /Ø hors-tout/, 'la limite dépassée est nommée en français');
});

test('a ratio outside its requested tolerance is refused', () => {
  const off = Engineering.analyzeSolution([
    { type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } }
  ], 4, {});   // visé 4, obtenu 3
  const result = Compliance.evaluate(off, { tolerancePercent: 1 });
  assert.equal(result.ratio.state, 'danger');
  assert.ok(result.ratio.value > 1);
});

test('manufacturing failures are named in French, never by their code', () => {
  const solution = { manufacturing: { rules: { mode: 'printing3d' }, valid: false, failures: ['MODULE_TOO_SMALL', 'PRINTER_DIAMETER'] } };
  const result = Compliance.evaluate(solution, {});
  assert.equal(result.fabrication.state, 'warning');
  assert.doesNotMatch(result.fabrication.detail, /MODULE_TOO_SMALL|PRINTER_DIAMETER/);
  assert.match(result.fabrication.detail, /Module sous la limite/);
  // Un procédé sans échec est réellement vérifié, lui.
  assert.equal(Compliance.evaluate({ manufacturing: { rules: { mode: 'CNC' }, failures: [] } }, {}).fabrication.state, 'ok');
  // Aucun procédé choisi : rien n'a été vérifié.
  assert.equal(Compliance.evaluate({}, {}).fabrication.state, 'unknown');
});

test('every code shown to a user has a French label', () => {
  Object.keys(Compliance.codes).forEach(code => {
    const text = Compliance.label(code);
    assert.notEqual(text, code, code + ' doit avoir un libellé');
    assert.ok(text.length > 3);
  });
  // Un code inconnu se rend tel quel plutôt que de disparaître : mieux vaut un
  // identifiant à l'écran qu'un badge vide.
  assert.equal(Compliance.label('CODE_INCONNU'), 'CODE_INCONNU');
});

test('the overall state is the worst verified one', () => {
  assert.equal(Compliance.overall(Compliance.evaluate(
    { mechanical: [{ mechanicalStatus: 'evaluated', bending: { safetyFactor: 0.8 }, contact: { safetyFactor: 5 } }] }, {})), 'danger');
  assert.equal(Compliance.overall(Compliance.evaluate(chain({}), {})), 'unknown');
  assert.equal(Compliance.overall(null), 'unknown');
});

test('the limits come from the engine, so no screen can hold a second copy', () => {
  assert.equal(Compliance.LIMITS, Engineering.LIMITS);
  assert.equal(Compliance.LIMITS.bendingSafety, 1.3);
  assert.equal(Compliance.LIMITS.contactSafety, 1.1);
});

test('a stage warning belongs to its stage, a chain warning to none', () => {
  const solution = { warnings: [
    { code: 'UNDERCUT', stageIndex: 2 },
    { code: 'THERMAL_RISK', stageIndex: null },
    { code: 'LOW_CONTACT_RATIO', stage: 1 }
  ] };
  assert.deepEqual(Compliance.stageWarnings(solution, 2).map(w => w.code), ['UNDERCUT']);
  assert.deepEqual(Compliance.stageWarnings(solution, 0).map(w => w.code), ['LOW_CONTACT_RATIO']);
  assert.deepEqual(Compliance.stageWarnings(solution, 1), []);
});

test('an unsupported check is distinguished from a missing input', () => {
  // Une vis sans fin CALCULE ses efforts mais pas sa flexion : le statut lu
  // doit être celui du contrôle, sinon on propose de renseigner un couple qui
  // l'est déjà.
  const worm = Engineering.analyzeSolution([
    { type: 'worm', wormStarts: 2, wheelTeeth: 40, parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } }
  ], 20, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  assert.equal(worm.mechanical[0].mechanicalStatus, 'evaluated');
  const result = Compliance.evaluate(worm, {});
  assert.equal(result.bending.state, 'unknown');
  assert.match(result.bending.detail, /technologie/);
  assert.doesNotMatch(result.bending.detail, /couple/);
});
