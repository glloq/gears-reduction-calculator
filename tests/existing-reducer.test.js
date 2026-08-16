const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Existing = require('../js/requirements/ExistingReducer.js');
const Intent = require('../js/requirements/SearchIntentModel.js');
const Planner = require('../js/requirements/ExplorationPlanner.js');
const Search = require('../js/core/SearchEngine.js');

const session = fs.readFileSync('js/ui/SearchSession.js', 'utf8');
const typeStep = fs.readFileSync('js/ui/search/TypeStep.js', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');

/** Le réducteur de l'exemple : 20 → 60 en module 1, puis 15 → 45 en module 1,5. */
function described() {
  const reducer = new Existing.ExistingReducer();
  reducer.addStage('spur', 1).addStage('spur', 1.5);
  reducer.setField(0, 'input.teeth', 20).setField(0, 'output.teeth', 60);
  reducer.setField(1, 'input.teeth', 15).setField(1, 'output.teeth', 45);
  return reducer;
}

test('a described reducer is measured, not merely stored', () => {
  const reducer = described();
  assert.deepEqual(reducer.errors(), []);
  assert.equal(reducer.ratio(), 9);
  assert.match(reducer.describe(), /2 étages, rapport 9:1/);

  const analysed = reducer.analyze({ inputSpeedRpm: 1500, inputTorqueNm: 5 });
  assert.ok(analysed.dimensions.maxDiameter > 0);
  assert.ok(analysed.efficiency > 0.8 && analysed.efficiency < 1);
  assert.ok(analysed.outputTorqueNm > 5 * 9 * 0.8);
  // Rien n'a été visé : une référence n'a pas d'écart de rapport.
  assert.equal(analysed.errorPercent, 0);
  assert.equal(analysed.isExisting, true);
});

test('an impossible reducer says so instead of being analysed anyway', () => {
  const reducer = new Existing.ExistingReducer();
  reducer.addStage('planetary', 1);
  // Couronne − solaire impair : aucun satellite ne s'engrène.
  reducer.setField(0, 'sunTeeth', 12).setField(0, 'ringTeeth', 47);
  assert.ok(reducer.errors().length);
  assert.equal(reducer.analyze({}), null, 'une chaîne fausse ne doit pas produire de référence');
});

test('changing a family keeps the module and offers that family s own fields', () => {
  const reducer = described();
  reducer.setType(1, 'worm');
  assert.equal(reducer.stages[1].type, 'worm');
  assert.equal(reducer.stages[1].parameters.module, 1.5, 'le module saisi survit au changement');
  assert.deepEqual(Existing.fieldsFor('worm').map(f => f.path), ['wormStarts', 'wheelTeeth']);
  assert.deepEqual(Existing.fieldsFor('spur').map(f => f.path), ['input.teeth', 'output.teeth']);
  assert.deepEqual(Existing.fieldsFor('planetary').map(f => f.path), ['sunTeeth', 'ringTeeth']);
  assert.deepEqual(reducer.families(), ['spur', 'worm']);
});

test('every improvement goal reuses an exploration formula, and never the ratio', () => {
  for (const goal of Existing.GOALS) {
    assert.equal(typeof Planner.METRICS[goal.id], 'function', goal.id + ' sans formule');
    assert.ok(goal.sort, goal.id + ' doit dire comment trier le vivier');
  }
  // À rapport égal, « maximiser le rapport » n'a rien à gagner.
  assert.ok(!Existing.GOALS.some(goal => goal.id === 'ratio'));
});

test('the improvement really finds something better at the very same ratio', () => {
  const reducer = described();
  const options = { inputSpeedRpm: 1500, inputTorqueNm: 5 };
  const reference = reducer.analyze(options);

  const found = Search.search({
    rapportCible: reducer.ratio(), precisionToleree: 2, maxEtages: 2,
    maxSolutions: 60, maxIterations: 120000, typesActifs: ['spur'],
    typeParameters: { spur: { module: 1 } }, allowReductionOnly: true,
    module: 1, moduleMode: 'fixed', vitesseEntree: 1500, coupleEntree: 5,
    searchMode: 'compact'
  }).solutions;
  assert.ok(found.length);

  const volume = s => s.dimensions.x * s.dimensions.y * Math.max(1, s.dimensions.z);
  const best = found.slice().sort((a, b) => volume(a) - volume(b))[0];
  assert.ok(volume(best) < volume(reference), 'un réducteur plus compact doit exister');
  assert.ok(Math.abs(best.ratio - reference.ratio) / reference.ratio < 0.02,
    'et il doit conserver le rapport');
});

test('the improvement mode is wired end to end, ratio included', () => {
  assert.ok(Intent.mode('improve'), 'le mode doit être proposé');
  assert.ok(new Intent.SearchIntentModel({ mode: 'improve' }).improves());
  assert.ok(!new Intent.SearchIntentModel({ mode: 'best' }).improves());
  // Le rapport vient de la machine décrite, pas d'une saisie.
  assert.match(session, /this\.intent\.improves\(\) && request\.ratio == null/);
  // La référence entre dans le vivier : sans elle, « plus compact » ne se
  // compare à rien.
  assert.match(app, /session\.baseline\(\)/);
  assert.match(app, /\[reference\]\.concat\(resultats\)/);
  // Et l'éditeur d'étages existants vit dans la première étape du modal.
  assert.match(typeStep, /_renderExisting/);
  assert.match(typeStep, /existingGoals/);
});
