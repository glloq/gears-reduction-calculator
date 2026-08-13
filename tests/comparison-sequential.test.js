// ComparisonManager.runAll doit enchaîner les recherches séquentiellement :
// Engine.rechercher termine le worker précédent, un fan-out parallèle
// s'auto-annulerait (seule la dernière cible répondrait).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('runAll chains searches sequentially and collects every target result', async () => {
  const elements = { compResults: { innerHTML: '' } };
  const document = {
    getElementById: id => elements[id] || { innerHTML: '', appendChild() {}, onclick: null },
    createElement: () => ({ classList: { add() {}, toggle() {} }, appendChild() {}, addEventListener() {}, setAttribute() {}, style: {}, dataset: {} }),
    querySelectorAll: () => []
  };
  const context = {
    GearApp: {
      ui: {},
      eventBus: { on() {}, emit() {} },
      models: { SearchParams: { fromForm: () => ({ rapportCible: 0 }) } }
    },
    document, console, setTimeout, Promise
  };
  vm.runInNewContext(fs.readFileSync('js/ui/ComparisonManager.js', 'utf8'), context);

  const manager = new context.GearApp.ui.ComparisonManager('nope', context.GearApp.eventBus);

  let busy = false;
  const served = [];
  manager.setEngine({
    rechercher(params) {
      assert.equal(busy, false, 'a search started while the previous one was still running');
      busy = true;
      return new Promise(resolve => setTimeout(() => {
        busy = false;
        served.push(params.rapportCible);
        resolve([{ ratio: params.rapportCible }]);
      }, 5));
    }
  });

  let rendered = 0;
  manager._renderResults = () => { rendered++; };
  manager._renderSummary = () => { rendered++; };
  manager._outputs = [
    { id: 1, ratio: 4, label: 'A', solutions: [], selectedIdx: 0 },
    { id: 2, ratio: 8, label: 'B', solutions: [], selectedIdx: 0 },
    { id: 3, ratio: 12, label: 'C', solutions: [], selectedIdx: 0 }
  ];

  manager.runAll();
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.deepEqual(served, [4, 8, 12]);
  for (const output of manager._outputs) {
    assert.equal(output.solutions.length, 1);
    assert.equal(output.solutions[0].ratio, output.ratio);
  }
  assert.equal(rendered, 2);
});
