const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Planner = require('../js/requirements/ExplorationPlanner.js');
const Intent = require('../js/requirements/SearchIntentModel.js');
const Search = require('../js/core/SearchEngine.js');

const session = fs.readFileSync('js/ui/SearchSession.js', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');

// ===== Les bandes couvrent l'espace, exactement =====

test('a band is exactly what the engine will accept, with no gap between bands', () => {
  const bands = Planner.bands(1, 200);
  assert.ok(bands.length > 1);
  for (const band of bands) {
    // Le moteur applique cible × (1 ± tolérance/100) : la bande doit être
    // CELA, sinon elle promet une couverture qu'elle n'a pas.
    const low = band.target * (1 - band.tolerancePercent / 100);
    const high = band.target * (1 + band.tolerancePercent / 100);
    assert.ok(Math.abs(low - band.min) < 1e-9, `borne basse ${low} ≠ ${band.min}`);
    assert.ok(Math.abs(high - band.max) < 1e-9, `borne haute ${high} ≠ ${band.max}`);
  }
  for (let i = 1; i < bands.length; i++) {
    assert.equal(bands[i].min, bands[i - 1].max, 'aucun rapport ne doit tomber entre deux bandes');
  }
  assert.equal(bands[0].min, 1);
  assert.equal(bands.at(-1).max, 200);
});

test('an absurd span stays bounded instead of exploding into hundreds of searches', () => {
  const bands = Planner.bands(1, 1e9);
  assert.ok(bands.length <= Planner.MAX_BANDS);
  assert.equal(bands.at(-1).max, Planner.MAX_RATIO);
  // Une plage vide ou inversée ne doit pas produire zéro recherche.
  assert.equal(Planner.bands(12, 12).length, 1);
  assert.equal(Planner.bands(50, 10).length, 1);
});

// ===== Le budget est réparti, pas multiplié =====

test('the depth budget is split across the bands, never multiplied by them', () => {
  const base = { maxIterations: 500000, maxSolutions: 100, searchMode: 'minimumStages' };
  const runs = Planner.plan(base, { min: 1, max: 200 });
  const total = runs.reduce((sum, run) => sum + run.maxIterations, 0);
  assert.ok(total <= base.maxIterations * 1.001, `budget total ${total} > ${base.maxIterations}`);
  assert.ok(runs.every(run => run.rapportCible > 0 && run.precision > 0));
  // « Le moins d'étages » s'arrête à la première profondeur qui donne quelque
  // chose : explorer avec ce mode ne verrait qu'une tranche de l'espace.
  assert.ok(runs.every(run => run.searchMode !== 'minimumStages'));
  assert.equal(base.searchMode, 'minimumStages', 'les paramètres d’origine ne sont pas modifiés');
});

test('the plan keeps the prototype of the parameters it clones', () => {
  function Params() { this.maxIterations = 100000; this.maxSolutions = 40; }
  Params.prototype.validate = function () { return { valid: true }; };
  const runs = Planner.plan(new Params(), { min: 4, max: 40 });
  assert.ok(runs.length > 1);
  assert.equal(typeof runs[0].validate, 'function', 'un SearchParams doit rester validable');
});

// ===== La réunion des viviers =====

test('merge removes what two neighbouring bands both found, and ranks by the objective', () => {
  const a = { stages: [{ type: 'spur', input: { teeth: 10 }, output: { teeth: 30 }, parameters: { module: 1 } }], outputTorqueNm: 30, ratio: 3, efficiency: 0.97 };
  const duplicate = JSON.parse(JSON.stringify(a));
  const b = { stages: [{ type: 'spur', input: { teeth: 12 }, output: { teeth: 60 }, parameters: { module: 1 } }], outputTorqueNm: 50, ratio: 5, efficiency: 0.95 };
  const unknown = { stages: [{ type: 'belt', input: { teeth: 20 }, output: { teeth: 40 }, parameters: {} }], ratio: 2, efficiency: 0.96 };

  const merged = Planner.merge([[a, unknown], [duplicate, b]], 'torque');
  assert.equal(merged.length, 3, 'la solution retrouvée deux fois ne compte qu’une fois');
  assert.equal(merged[0], b, 'le plus fort couple mène');
  assert.equal(merged.at(-1), unknown, 'une solution sans couple calculé ne prend la place de personne');

  // Personne n'a visé de rapport : annoncer un écart désignerait une cible
  // que le balayage a inventée pour lui-même.
  assert.ok(merged.every(solution => solution.errorPercent === 0));

  assert.equal(Planner.merge([[a, b]], 'efficiency')[0], a);
  assert.equal(Planner.merge([[a, b]], 'ratio')[0], b);
  assert.equal(Planner.merge([[a, b]], 'torque', 1).length, 1, 'le vivier est plafonné');
});

test('every declared objective has a formula, and every formula a label', () => {
  for (const objective of Intent.OBJECTIVES) {
    assert.equal(typeof Planner.METRICS[objective.id], 'function', objective.id + ' sans formule');
    assert.ok(objective.sort, objective.id + ' doit dire comment trier le vivier');
  }
  for (const key of Object.keys(Planner.METRICS)) {
    assert.ok(Intent.objective(key), key + ' est calculé mais jamais proposé');
  }
});

// ===== Le tout, contre le vrai moteur =====

test('the bands really do reach a maximum a single targeted search would miss', () => {
  const base = {
    dentMenanteMin: 10, dentMenanteMax: 14, dentMeneeMin: 30, dentMeneeMax: 60,
    maxEtages: 2, maxSolutions: 40, maxIterations: 60000, typesActifs: ['spur'],
    typeParameters: { spur: { module: 1 } }, allowReductionOnly: true,
    module: 1, moduleMode: 'fixed', vitesseEntree: 1500, coupleEntree: 2,
    searchMode: 'global'
  };
  const runs = Planner.plan(base, { min: 2, max: 25 });
  const pools = runs.map(run => Search.search(run).solutions);
  const explored = Planner.merge(pools, 'torque');
  assert.ok(explored.length > 5, 'l’exploration doit ramener un vrai vivier');

  // Le classement est bien un maximum, et il est monotone.
  for (let i = 1; i < explored.length; i++) {
    const previous = explored[i - 1].outputTorqueNm, current = explored[i].outputTorqueNm;
    if (Number.isFinite(previous) && Number.isFinite(current)) assert.ok(previous >= current);
  }

  // Ce que l'exploration trouve dépasse ce qu'une cible unique au milieu de la
  // plage pouvait atteindre : c'est exactement la raison d'être du balayage.
  const single = Search.search(Object.assign({}, base, { rapportCible: 12, precisionToleree: 3 })).solutions;
  const bestSingle = Math.max(...single.map(s => s.outputTorqueNm).filter(Number.isFinite));
  assert.ok(explored[0].outputTorqueNm > bestSingle,
    `exploration ${explored[0].outputTorqueNm} devrait dépasser ${bestSingle}`);
});

// ===== Le branchement =====

test('the session plans an exploration, and the app runs the bands one at a time', () => {
  assert.match(session, /SearchSession\.prototype\.explorationPlan = function/);
  assert.match(session, /SearchSession\.prototype\.explorationSpan = function/);
  // Une exploration n'a pas de rapport à déterminer : elle doit pouvoir partir.
  assert.match(session, /intent\.explores\(\) \? true : this\.requirement\.isComplete\(\)/);
  // Séquentiel : un worker à la fois, donc un « Arrêter » qui arrête vraiment.
  assert.match(app, /plan\.runs\.reduce/);
  assert.match(app, /if \(!isSearching\) return null;/);
});
