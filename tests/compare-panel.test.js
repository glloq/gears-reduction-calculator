const test = require('node:test');
const assert = require('node:assert/strict');
const H = require("../js/ui/ComparePanel.js");
const ComparePanel = H;

function solution(uid, overrides = {}) {
  const s = Object.assign({
    score: { value: 0.4 }, ratio: 12, errorPercent: 0.05, efficiency: 0.94,
    stages: [{ type: 'spur', input: { teeth: 15 }, output: { teeth: 45 } }],
    dimensions: { length: 60, maxDiameter: 45, width: 10 },
    mechanical: [{ bending: { safetyFactor: 1.5 }, contact: { safetyFactor: 1.2 } }],
    warnings: [], manufacturing: { failures: [] }
  }, overrides);
  Object.defineProperty(s, 'uid', { value: uid, enumerable: false });
  return s;
}

test('togglePin adds, removes and enforces the cap', () => {
  let pins = [];
  for (let i = 1; i <= H.PIN_CAP; i++) {
    const result = H.togglePin(pins, solution(i));
    assert.equal(result.action, 'added');
    pins = result.pins;
  }
  assert.equal(H.togglePin(pins, solution(99)).action, 'rejected');
  const removed = H.togglePin(pins, pins[0].solution);
  assert.equal(removed.action, 'removed');
  assert.equal(removed.pins.length, H.PIN_CAP - 1);
  assert.equal(H.isPinned(removed.pins, 1), false);
});

test('bestIndices honors direction, marks ties and ignores non-finite values', () => {
  assert.deepEqual(H.bestIndices([3, 1, 1, NaN], 'min'), [1, 2]);
  assert.deepEqual(H.bestIndices([3, 9, NaN], 'max'), [1]);
  assert.deepEqual(H.bestIndices([NaN, NaN], 'min'), []);
});

test('buildRows produces rotary rows with per-stage architecture labels', () => {
  const pins = [{ uid: 1, solution: solution(1) }, { uid: 2, solution: solution(2, { stages: [{ type: 'worm', wormStarts: 2, wheelTeeth: 40 }, { type: 'spur', input: { teeth: 12 }, output: { teeth: 36 } }] }) }];
  const rows = H.buildRows(pins);
  const labels = rows.map(r => r.label);
  assert.ok(labels.includes('SF min'));
  assert.ok(labels.includes('Étage 1'));
  assert.ok(labels.includes('Étage 2'));
  const stage2 = rows.find(r => r.label === 'Étage 2');
  assert.equal(stage2.values[0], null, 'single-stage solution has no second stage');
  assert.equal(stage2.values[1].label, '12 → 36');
  const stage1 = rows.find(r => r.label === 'Étage 1');
  assert.equal(stage1.values[1].label, 'vis 2 → 40');
});

test('buildRows blanks inapplicable cells when rotary and linear pins are mixed', () => {
  const linear = solution(3, {
    mode: 'rotationTranslation', ratio: null, errorPercent: 0,
    travelPerRevolutionMm: 62.8, outputLinearSpeedMmMin: 94000, outputForceN: 300,
    stages: [{ type: 'rack', pinionTeeth: 20 }], mechanical: [{}]
  });
  const rows = H.buildRows([{ uid: 1, solution: solution(1) }, { uid: 3, solution: linear }]);
  const ratio = rows.find(r => r.label === 'Rapport');
  assert.equal(ratio.values[1], null);
  const course = rows.find(r => r.label === 'Course');
  assert.equal(course.values[0], undefined);
  assert.equal(course.values[1], 62.8);
  const stage1 = rows.find(r => r.label === 'Étage 1');
  assert.equal(stage1.values[1].label, 'pignon 20');
});

test('two planetaries with the same teeth but different roles never look alike', () => {
  // « S20 / R80 » désignait indifféremment deux mécanismes sans rien de commun :
  // à dentures identiques, deux organes bloqués différents donnent deux
  // rapports différents — parfois de signe opposé.
  const teeth = { type: 'planetary', sunTeeth: 20, planetTeeth: 30, planetCount: 3, ringTeeth: 80 };
  const first = ComparePanel.stageLabel(Object.assign({}, teeth, { inputMember: 'S', fixed: 'R', outputMember: 'C' }));
  const second = ComparePanel.stageLabel(Object.assign({}, teeth, { inputMember: 'C', fixed: 'S', outputMember: 'R' }));
  assert.notEqual(first, second, 'la comparaison doit les distinguer');

  // Les satellites comptent aussi : ils décident du montage et de la répartition.
  assert.match(first, /S20/);
  assert.match(first, /P30×3/);
  assert.match(first, /R80/);
  // Les organes sont nommés en français, jamais par leur code seul.
  assert.match(first, /Solaire entrée/);
  assert.match(first, /Couronne fixe/);
  assert.match(second, /Porte-satellites entrée/);
  assert.doesNotMatch(first, /NaN|undefined/);

  // Une topologie inconnue se réduit aux dentures plutôt que d'inventer des rôles.
  assert.equal(ComparePanel.stageLabel(teeth), 'S20 / P30×3 / R80');
});

// ===== §13/§18 : LA GRAVITÉ, ET CE QUE LE COMPARATEUR NE DISAIT PAS =====

test('the comparison ranks alerts by severity, not by count', () => {
  // Trois réserves ne valent pas un refus, et « Avertissements : 3 » les
  // confondait. La ligne trie sur la gravité et se LIT dans les mêmes termes.
  const three = { warnings: [{ level: 'warning' }, { level: 'warning' }, { level: 'warning' }] };
  const one = { warnings: [{ level: 'danger' }] };
  assert.ok(H.alertSeverity(one) > H.alertSeverity(three));
  assert.equal(H.alertSummary(one), '✕ 1');
  assert.equal(H.alertSummary(three), '⚠ 3');
  assert.equal(H.alertSummary({ warnings: [] }), '—');
  assert.equal(H.alertSummary({ warnings: [{ level: 'danger' }, { level: 'warning' }, { level: 'warning' }] }), '✕ 1 · ⚠ 2');
});

test('the comparison carries what one comes to it for', () => {
  // §18 : vitesse et couple de sortie, puissance, pertes, largeur et risque
  // thermique manquaient — c'est-à-dire l'essentiel de ce qu'on vient y lire.
  const rows = H.buildRows([{ solution: solution('a') }, { solution: solution('b') }]);
  const labels = rows.map(row => row.label);
  ['Indice technique', 'Rendement', 'Vitesse sortie', 'Couple sortie', 'Puissance sortie',
    'Pertes', 'Largeur', 'Alertes', 'Risque thermique'].forEach(label => {
    assert.ok(labels.indexOf(label) >= 0, 'ligne manquante : ' + label);
  });
  // Et l'indice technique ne s'appelle plus « Score global » : ce n'est pas le
  // classement, et le comparateur ne doit pas le laisser croire.
  assert.equal(labels.indexOf('Score global'), -1);
});
