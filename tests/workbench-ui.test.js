const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/ui/WorkbenchUI.js', 'utf8');
const controller = fs.readFileSync('js/ui/UIController.js', 'utf8');

test('workbench shell and accessible result views are shipped on Pages', () => {
  assert.match(html, /Transmission Design Workbench/);
  assert.match(html, /id="solutionCards"/);
  assert.match(html, /role="tab" aria-selected="true">Cartes/);
  assert.match(html, /css\/workbench\.css/);
});

test('objective modes use contextual groups and expose a live derived ratio', () => {
  assert.match(ui, /objective-ratio/);
  assert.match(ui, /objective-need/);
  assert.match(ui, /objective-linear/);
  assert.match(ui, /Rapport cible dérivé/);
  assert.match(html, /solveur linéaire traite directement un pignon \+ crémaillère/);
});

test('successful searches automatically select solution zero', () => {
  assert.match(controller, /solution:selected', \{ index: 0, solution: solutions\[0\] \}/);
});

test('pure view changes do not invoke the search engine', () => {
  const viewMethods = ui.slice(ui.indexOf('._bindViewSwitch'), ui.indexOf('._bindFormSummary'));
  assert.doesNotMatch(viewMethods, /rechercher|lancerRecherche/);
});

test('optional safety presentation does not monkey-patch SearchParams', () => {
  assert.doesNotMatch(ui, /SearchParams\.fromForm\s*=/);
  assert.doesNotMatch(ui, /installSearchConstraintPolicy/);
  assert.match(ui, /bending\.value=''/);
  assert.match(ui, /contact\.value=''/);
});

test('workflow indexing keeps engineering available in Standard mode', () => {
  assert.match(ui, /workflowIndex=0/);
  assert.match(ui, /expertOnly=step>=5/);
  assert.match(ui, /labels=\['Objectif','Transmissions','Contraintes','Optimisation','Ingénierie','Fabrication','Durée de vie','Score'\]/);
});

test('updateContext exclusively selects rack in linear mode and restores rotary choices', () => {
  function classList(names = []) {
    const values = new Set(names);
    return {
      contains: value => values.has(value),
      toggle: (value, enabled) => enabled ? values.add(value) : values.delete(value)
    };
  }
  function checkbox(value, checked) {
    const card = {hidden: false};
    return {value, checked, disabled: false, closest: () => card, card};
  }

  const objective = {value: 'ratio'};
  const output = {dispatchEvent() {}};
  const fields = [
    {classList: classList(['objective-ratio'])},
    {classList: classList(['objective-linear'])}
  ];
  const boxes = [checkbox('spur', true), checkbox('belt', false), checkbox('rack', false)];
  const elements = {objective_mode: objective, rpm_sortie_cible: output};
  const document = {
    body: {classList: classList()},
    getElementById: id => elements[id] || null,
    querySelectorAll: selector => selector === '.type-checkbox' ? boxes : fields
  };
  const sandbox = {GearApp: {ui: {}}, document, Event: function Event(type) { this.type = type; }};
  vm.runInNewContext(ui, sandbox);
  const workbench = new sandbox.GearApp.ui.WorkbenchUI({});
  workbench.updateSummary = function () {};

  objective.value = 'rotationTranslation';
  workbench.updateContext();
  assert.deepEqual(boxes.map(box => [box.value, box.checked, box.disabled, box.card.hidden]), [
    ['spur', false, true, true],
    ['belt', false, true, true],
    ['rack', true, false, false]
  ]);
  assert.equal(fields[1].classList.contains('active'), true);

  objective.value = 'ratio';
  workbench.updateContext();
  assert.deepEqual(boxes.map(box => [box.value, box.checked, box.disabled, box.card.hidden]), [
    ['spur', true, false, false],
    ['belt', false, false, false],
    ['rack', false, true, true]
  ]);
  assert.equal(fields[0].classList.contains('active'), true);
});
