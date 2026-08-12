const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
  assert.match(ui, /course\/tour = π × diamètre primitif/);
});

test('successful searches automatically select solution zero', () => {
  assert.match(controller, /solution:selected', \{ index: 0, solution: solutions\[0\] \}/);
});

test('pure view changes do not invoke the search engine', () => {
  const viewMethods = ui.slice(ui.indexOf('._bindViewSwitch'), ui.indexOf('._bindFormSummary'));
  assert.doesNotMatch(viewMethods, /rechercher|lancerRecherche/);
});

test('hidden expert safety defaults do not constrain standard searches', () => {
  assert.match(ui, /document\.body\.classList\.contains\('pro-mode'\)/);
  assert.match(ui, /delete params\.constraints\.minimumBendingSafety/);
  assert.match(ui, /delete params\.constraints\.minimumContactSafety/);
  assert.match(ui, /bending\.value=''/);
  assert.match(ui, /contact\.value=''/);
});

test('workflow indexing keeps engineering available in Standard mode', () => {
  assert.match(ui, /workflowIndex=0/);
  assert.match(ui, /expertOnly=step>=5/);
  assert.match(ui, /labels=\['Objectif','Transmissions','Contraintes','Optimisation','Ingénierie','Fabrication','Durée de vie','Score'\]/);
});
