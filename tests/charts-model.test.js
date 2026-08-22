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
