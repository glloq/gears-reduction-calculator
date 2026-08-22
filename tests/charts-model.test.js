const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// ===== LES GRAPHIQUES LISENT LE MODÈLE =====
//
// `Charts.js` est une classe de navigateur : on l'exécute dans un contexte où
// Chart.js et le DOM sont réduits à ce qu'elle en utilise réellement — un
// élément par identifiant, et un constructeur qui garde sa configuration. Ce
// qui est vérifié n'est pas le dessin, c'est la DONNÉE qu'on lui remet.

function load() {
  const drawn = {};
  const canvas = { getContext: () => null, width: 300, height: 150 };
  const context = {
    window: {},
    document: {
      getElementById: () => canvas,
      body: {}
    },
    Chart: function (target, config) { this.data = config.data; this.options = config.options; this.update = () => {}; this.destroy = () => {}; },
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../js/Charts.js'), 'utf8'), context);
  const charts = context.window.GearCharts;
  // `_updateOrCreate` renvoie l'instance : on la relit pour savoir ce qui a été tracé.
  const original = charts._updateOrCreate.bind(charts);
  charts._updateOrCreate = function (id, config) { drawn[id] = config; return original(id, config); };
  charts._placeholder = function (id, text) { drawn[id] = { placeholder: text }; };
  return { charts, drawn };
}

/** Une solution telle que `Engineering.analyzeSolution` la rend. */
function solution(overrides) {
  return Object.assign({
    mode: 'rotation', ratio: 20, errorPercent: 0.4,
    stages: [{ type: 'worm', wormStarts: 2, wheelTeeth: 40 }],
    mechanical: [], score: { value: 0.3, metrics: {} }
  }, overrides || {});
}

test('the ratio chart plots the ratio the engine computed, not one it re-derives', () => {
  // Le graphique reconstruisait le rapport à partir d'un triplet hérité
  // `[A, B, type]`, avec un `B / A` en dernier recours. Sur une vis sans fin à
  // deux filets entraînant 40 dents, cela donnait 20 par accident et 0,05 dès
  // que l'ordre des deux nombres changeait ; sur un planétaire, n'importe quoi.
  const { charts, drawn } = load();
  const worm = solution({ ratio: 20, errorPercent: 0.4 });
  const planetary = solution({ ratio: 4.0, errorPercent: 1.2,
    stages: [{ type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24 }] });
  charts.drawRatioComparison('ratioChart', [worm, planetary], 20);

  const sets = drawn.ratioChart.data.datasets;
  assert.deepEqual(sets[0].data, [20, 4.0], 'les rapports tracés ne sont pas ceux du modèle');
  assert.deepEqual(sets[sets.length - 1].data, [0.4, 1.2], 'les écarts tracés ne sont pas ceux du modèle');
});

test('a rotation-to-translation solution is left out of a ratio comparison', () => {
  // Une crémaillère n'a pas de rapport : elle a une course. L'aligner à zéro
  // sur l'axe des rapports écraserait l'échelle de toutes les autres.
  const { charts, drawn } = load();
  charts.drawRatioComparison('ratioChart',
    [solution({ ratio: 12 }), solution({ mode: 'rotationTranslation', ratio: null })], 12);
  assert.deepEqual(drawn.ratioChart.data.datasets[0].data, [12]);
  assert.equal(drawn.ratioChart.data.labels.length, 1);

  // Et s'il n'y a QUE du linéaire, on le dit au lieu de tracer un cadre vide.
  charts.drawRatioComparison('ratioChart', [solution({ mode: 'rotationTranslation', ratio: null })], 12);
  assert.match(drawn.ratioChart.placeholder, /aucune solution rotative/);
});

test('no target ratio means no target line', () => {
  // Une ligne de cible tracée à `NaN` ne se voit pas, mais sa légende, si :
  // elle affirmait un objectif qui n'avait pas été donné.
  const { charts, drawn } = load();
  charts.drawRatioComparison('ratioChart', [solution({ ratio: 12 })], NaN);
  const labels = drawn.ratioChart.data.datasets.map(set => set.label);
  assert.ok(!labels.some(label => /Cible/.test(label)), labels.join(' | '));

  charts.drawRatioComparison('ratioChart', [solution({ ratio: 12 })], 12);
  assert.ok(drawn.ratioChart.data.datasets.some(set => /Cible : 12/.test(set.label)));
});

test('the structured charts read Solution and mechanical, and say when data is missing', () => {
  const { charts, drawn } = load();
  const full = solution({
    inputSpeedRpm: 1500, inputTorqueNm: 10, inputPowerW: 1570, lossPowerW: 94,
    mechanical: [{ ratio: 4, efficiency: 0.97, bending: { safetyFactor: 1.8 }, contact: { safetyFactor: 1.2 } },
      { ratio: 5, efficiency: 0.96, bending: { safetyFactor: 2.4 }, contact: null }]
  });
  charts.drawStructuredCascade('cascadeChart', full);
  const speeds = drawn.cascadeChart.data.datasets[0].data;
  assert.equal(speeds.length, 3);
  assert.ok(Math.abs(speeds[1] - 375) < 1e-9, String(speeds));
  assert.ok(Math.abs(speeds[2] - 75) < 1e-9, String(speeds));

  charts.drawStructuredSafety('safetyChart', full);
  assert.deepEqual(drawn.safetyChart.data.datasets[1].data, [1.2, null],
    'un contrôle non supporté doit rester un trou, pas un zéro');

  // Sans puissance d'entrée, il n'y a pas de pertes à répartir : des barres à
  // zéro se liraient comme un rendement parfait.
  charts.drawStructuredLosses('powerLossChart', solution({ inputPowerW: null }));
  assert.match(drawn.powerLossChart.placeholder, /non renseigné/);
});

// ===== §23/§24 : DES GRAPHIQUES QUI AIDENT À CHOISIR =====

const Assessment = require('../js/requirements/DecisionAssessment.js');
const Preferences = require('../js/requirements/PreferenceModel.js');
const Engineering = require('../js/core/Engineering.js');

function analysed(teeth, module) {
  return Engineering.analyzeSolution(
    [{ type: 'spur', input: { teeth: teeth[0] }, output: { teeth: teeth[1] },
       parameters: { module: module, pressureAngle: 20, faceWidth: 20 } }],
    3, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
}

test('the trade-off chart makes the Pareto front visible instead of internal', () => {
  // Le front décidait quelles alternatives proposer et ne se montrait jamais.
  // C'est pourtant l'image qui fait comprendre un choix : « ces neuf-là ne
  // sont battues par personne, les autres le sont. »
  const { charts, drawn } = load();
  // Un vivier où les solutions se BATTENT : l'une est plus compacte, l'autre a
  // un meilleur rendement, la troisième est battue par les deux. Sans cela le
  // front n'a qu'un point, et le graphique n'aurait rien à montrer de son
  // intérêt — ni le test rien à vérifier.
  const trade = (efficiency, diameter, stages) => ({
    stages: new Array(stages).fill({ type: 'spur' }), efficiency: efficiency, errorPercent: 0.2,
    dimensions: { x: diameter, y: diameter, z: 20, maxDiameter: diameter },
    mechanical: [{ bending: { safetyFactor: 2 }, contact: { safetyFactor: 2 } }],
    warnings: [], score: { value: 0.3, metrics: {} }
  });
  const built = Assessment.build([trade(0.98, 140, 1), trade(0.90, 55, 1), trade(0.89, 150, 2)],
    { preferences: new Preferences.PreferenceModel() });
  assert.ok(built.decision.front.length >= 2, 'le vivier de test ne présente aucun compromis');

  charts.drawParetoScatter('paretoChart', built);

  const sets = drawn.paretoChart.data.datasets;
  assert.equal(sets.length, 3, 'recommandée, front, dominées');
  assert.ok(sets[1].data.length >= 1, 'le front non recommandé n’apparaît pas sur le diagramme');
  assert.ok(sets[2].data.length >= 1, 'aucune solution dominée n’est située');
  assert.match(sets[0].label, /Recommandée/);
  assert.match(sets[1].label, /Pareto/);
  assert.match(sets[2].label, /Dominées/);
  // Chaque solution est placée une fois et une seule.
  const placed = sets.reduce((total, set) => total + set.data.length, 0);
  assert.equal(placed, 3);
  // Les axes sont les grandeurs annoncées, et les points portent de quoi les lire.
  assert.match(drawn.paretoChart.options.scales.x.title.text, /Ø/);
  assert.match(drawn.paretoChart.options.scales.y.title.text, /Rendement/);
  sets.forEach(set => set.data.forEach(point => {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), JSON.stringify(point));
    assert.ok(Number.isFinite(point.rank), 'un point sans rang ne se relit pas');
  }));
  // Rien à situer : on le dit, plutôt qu'un cadre vide.
  charts.drawParetoScatter('paretoChart', { entries: [] });
  assert.match(drawn.paretoChart.placeholder, /aucune solution/);
});

test('the contribution chart adds up to the index it explains, and marks estimates', () => {
  const { charts, drawn } = load();
  const built = Assessment.build([analysed([15, 45], 2)], {});
  const entry = built.entries[0];
  charts.drawScoreContribution('contributionChart', entry);

  const set = drawn.contributionChart.data.datasets[0];
  const total = set.data.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - entry.engineering) < 1e-9,
    'les barres ne recomposent pas l’indice : ' + total + ' vs ' + entry.engineering);
  assert.match(drawn.contributionChart.options.plugins.title.text, /total/);
  // §11 : ce qui est estimé ne se peint pas comme ce qui est calculé.
  const labels = drawn.contributionChart.data.labels;
  const estimatedColour = set.backgroundColor[labels.indexOf('Bruit')];
  const computedColour = set.backgroundColor[labels.indexOf('Encombrement')];
  assert.notEqual(estimatedColour, computedColour);
});

test('the safety chart carries its limits, and colours what falls under them', () => {
  // §24 : des barres sans ligne de minimum obligent à savoir de tête ce
  // qu'exige le calcul. C'est le seuil qui dit si la barre est acceptable.
  const { charts, drawn } = load();
  charts.drawStructuredSafety('safetyChart', { mechanical: [
    { bending: { safetyFactor: 0.9 }, contact: { safetyFactor: 2.4 } },   // flexion insuffisante
    { bending: { safetyFactor: 3.0 }, contact: null }                     // contact non évalué
  ] });
  const sets = drawn.safetyChart.data.datasets;
  const lines = sets.filter(set => set.type === 'line');
  assert.equal(lines.length, 2, 'les deux seuils doivent être tracés');
  assert.match(lines[0].label, /SF minimal 1\.30/);
  assert.match(lines[1].label, /SH minimal 1\.10/);
  lines.forEach(line => assert.ok(line.borderDash, 'un seuil se trace en pointillés, pas en barre'));

  // Un facteur sous sa limite, un facteur non évalué et un facteur conforme ne
  // portent pas la même couleur : c'est ce qui se lit d'un coup d'œil.
  const bending = sets[0].backgroundColor, contact = sets[1].backgroundColor;
  assert.notEqual(bending[0], bending[1], 'insuffisant et conforme se peignent pareil');
  assert.notEqual(contact[0], contact[1], 'évalué et non évalué se peignent pareil');
});
