const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Evaluator = require('../js/requirements/SolutionEvaluator.js');

const sheet = fs.readFileSync('js/ui/RequirementSheet.js', 'utf8');
const typeStep = fs.readFileSync('js/ui/search/TypeStep.js', 'utf8');
const session = fs.readFileSync('js/ui/SearchSession.js', 'utf8');
const explorer = fs.readFileSync('js/ui/SolutionExplorer.js', 'utf8');

// ===== §2, §3 : rien n'est posé à la place de l'utilisateur =====

test('adding a quantity opens an empty row, it never invents a value', () => {
  // `defaultFor` posait 12:1, 125 rpm, 80 N·m… : des valeurs que personne
  // n'avait choisies et qui dimensionnaient pourtant le réducteur.
  assert.doesNotMatch(sheet, /function defaultFor/);
  assert.doesNotMatch(sheet, /Q\.exact\(defaultFor/);
  assert.match(sheet, /self\.session\.reveal\(field\.path\)/);
  // La session sait montrer une grandeur sans rien y écrire.
  assert.match(session, /SearchSession\.prototype\.reveal = function/);
  assert.match(session, /SearchSession\.prototype\.conceal = function/);
  assert.match(session, /SearchSession\.prototype\.isRevealed = function/);
  // La fiche montre donc une grandeur révélée, même vide.
  assert.match(sheet, /if \(session\.isRevealed\(field\.path\)\) return true;/);
});

test('the shortcuts describe the shape of the problem, not a worked example', () => {
  // Ils remplissaient 1500 → 125 rpm, 80 N·m, rapport 12…
  assert.doesNotMatch(sheet, /apply: function \(model, Q\)/);
  assert.match(sheet, /reveal: \['input\.speed', 'output\.speed'\]/);
  // Et rien n'écrit de valeur : plus aucun Q.exact/atLeast/between dans la table.
  const table = sheet.slice(sheet.indexOf('var SHORTCUTS = ['), sheet.indexOf('function el(id)'));
  assert.doesNotMatch(table, /Q\.(exact|atLeast|atMost|between)\(/);
});

test('choosing Translation reveals the travel field instead of filling it', () => {
  assert.doesNotMatch(typeStep, /Quantity\.exact\(100, 'mm'\)/);
  assert.match(typeStep, /self\.draft\.reveal\('output\.travelPerRev'\)/);
});

// ===== §4 : une disposition décrit un état complet =====

test('every disposition states the whole architecture, spread included', () => {
  const states = [...typeStep.matchAll(/state: \{ ([^}]+) \}/g)].map(m => m[1]);
  assert.equal(states.length, 6, 'six dispositions');
  for (const state of states) {
    assert.match(state, /axisAngle:/, state);
    assert.match(state, /coaxial:/, state);
    // `spread` restait vrai en revenant à « Indifférente » : la carte active
    // et le conseiller croyaient encore à des arbres éloignés.
    assert.match(state, /spread:/, state);
  }
  assert.equal(states.filter(s => /spread: true/.test(s)).length, 1,
    'seule « Arbres éloignés » écarte les arbres');
  assert.match(typeStep, /Object\.assign\(architecture, disposition\.state\)/);
});

test('leaving the linear problem removes its data, says so, and can undo', () => {
  assert.match(typeStep, /LINEAR_PATHS = \['output\.travelPerRev', 'output\.force', 'output\.linearSpeed'\]/);
  assert.match(typeStep, /TypeStep\.prototype\._leaveLinear = function/);
  assert.match(typeStep, /TypeStep\.prototype\._restoreLinear = function/);
  assert.match(typeStep, /Données linéaires retirées/);
  assert.match(typeStep, /id = 'restoreLinearBtn'/);
});

// ===== §18 : la vue et le viewer décrivent le même objet =====

test('a filter that hides the shown solution moves the selection with it', () => {
  assert.match(explorer, /_selectedIndex/);
  assert.match(explorer, /var stillVisible = view\.some/);
  assert.match(explorer, /ne passait plus les filtres/);
  assert.match(explorer, /ne passe vos filtres/);
  // La sélection venue d'ailleurs (clic sur une carte) est suivie.
  assert.match(explorer, /this\.bus\.on\('solution:selected'/);
});

// ===== §17 : le vocabulaire des badges suit la question =====

test('the leading badge answers the question that was actually asked', () => {
  assert.equal(Evaluator.label('recommended'), 'Recommandée');
  assert.equal(Evaluator.label('recommended', { mode: 'design' }), 'Recommandée');
  assert.equal(Evaluator.label('recommended', { mode: 'maximize', objective: 'torque' }), 'Couple maximum');
  assert.equal(Evaluator.label('recommended', { mode: 'maximize', objective: 'compact' }), 'Le plus compact');
  assert.equal(Evaluator.label('recommended', { mode: 'improve', objective: 'compact' }), 'Meilleure amélioration');
  // Les autres badges ne bougent pas : eux répondaient déjà à leur question.
  assert.equal(Evaluator.label('compact', { mode: 'maximize', objective: 'torque' }),
    Evaluator.label('compact'));

  // La justification suit le même vocabulaire.
  const solution = { errorPercent: 0, efficiency: 0.95 };
  assert.match(Evaluator.explain(solution, ['recommended'], [], { mode: 'maximize', objective: 'torque' }),
    /espace exploré/);
  assert.match(Evaluator.explain(solution, ['recommended'], [], { mode: 'improve' }),
    /réducteur décrit/);
  assert.match(Evaluator.explain(solution, ['recommended'], []), /compromis/);
});

test('every declared lead label matches a real objective', () => {
  const Intent = require('../js/requirements/SearchIntentModel.js');
  for (const objective of Object.keys(Evaluator.LEAD_LABELS.maximize)) {
    assert.ok(Intent.objective(objective), objective + ' n’est pas une performance proposée');
  }
});

// ===== §6 : puissance ou couple, comme sur une plaque moteur =====

test('the input block asks for what a nameplate actually carries', () => {
  const model = fs.readFileSync('js/requirements/RequirementModel.js', 'utf8');
  // La puissance précède le couple, et aucun des deux n'est imposé.
  const input = model.slice(model.indexOf("path: 'input.speed'"), model.indexOf("path: 'output.speed'"));
  assert.ok(input.indexOf("input.power") < input.indexOf("input.torque"), 'la puissance vient en premier');
  assert.match(input, /path: 'input\.power'.*motor: 'power'/);
  assert.match(input, /path: 'input\.torque'.*motor: 'torque'/);
  assert.doesNotMatch(input, /path: 'input\.torque'[^\n]*essential: true/);
  // Le choix vit dans la session, et se DÉDUIT de ce qui est renseigné.
  assert.match(session, /SearchSession\.prototype\.motorInput = function/);
  assert.match(session, /SearchSession\.prototype\.setMotorInput = function/);
  assert.match(sheet, /choice === 'both' \|\| choice === field\.motor/);
});

// ===== §13, §14 : chaque chose à sa place =====

test('the shaft distance is an architecture datum, not a service one', () => {
  const modal = fs.readFileSync('js/ui/search/SearchModal.js', 'utf8');
  assert.doesNotMatch(modal, /shaftDistance/);
  assert.match(typeStep, /id = 'shaftDistance'/);
});

test('every diagnostic says which step it belongs to', () => {
  const Requirement = require('../js/requirements/RequirementModel.js');
  const notes = new Requirement.RequirementModel().diagnose();
  assert.ok(notes.length);
  for (const note of notes) {
    assert.ok(note.section, note.code + ' ne dit pas de quelle étape il relève');
  }
  // Le modal n'entretient plus de table code → étape : elle se désynchronisait.
  const modal = fs.readFileSync('js/ui/search/SearchModal.js', 'utf8');
  assert.doesNotMatch(modal, /STEP_OF_ERROR/);
  assert.match(modal, /note\.section\) blocking\[note\.section\] = true/);
});

// ===== §16, §22, §25, §26 : les résultats aident à choisir =====

test('cards state what they gain or lose against the reference', () => {
  const workbench = fs.readFileSync('js/ui/Workbench.js', 'utf8');
  assert.match(workbench, /var DELTA_METRICS = \{/);
  assert.match(workbench, /function deltaMarkup/);
  // Un Ø plus petit est un gain, un rendement plus petit une perte : confondre
  // les deux rendrait l'écart illisible.
  assert.match(workbench, /'Ø max': \{[\s\S]*?better: 'down'/);
  assert.match(workbench, /'Rendement': \{[\s\S]*?better: 'up'/);
  assert.match(workbench, /solution-reference/);
});

test('the results panel drops what has nothing to show', () => {
  const workbench = fs.readFileSync('js/ui/Workbench.js', 'utf8');
  const explorer2 = fs.readFileSync('js/ui/SolutionExplorer.js', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');
  // §25 : comparer sans épingles, tracer sans vivier, n'a rien à montrer.
  assert.match(workbench, /_refreshDetailTabs/);
  assert.match(workbench, /comparer: pinned > 1, graphiques: pool > 0, journal: false/);
  // §22 : chaque famille dit ce qu'elle apporte.
  assert.match(explorer2, /refine-chip-count/);
  // §24 : la vue linéaire simplifiée quitte l'interface.
  assert.doesNotMatch(html, /Vue linéaire simplifiée/);
  // §26 : repartir d'une solution trouvée.
  assert.match(workbench, /optimiseSolutionBtn/);
  assert.match(workbench, /new GearApp\.requirements\.ExistingReducer\(\{ stages: solution\.stages \}\)/);
});

// ===== §10, §11, §27, §29, §30 =====

test('the modal footer offers only what the state allows', () => {
  const modal = fs.readFileSync('js/ui/search/SearchModal.js', 'utf8');
  assert.match(modal, /id = 'searchModalRefine'/);
  assert.match(modal, /this\.nextButton\.hidden = last \|\| ready/);
  assert.match(modal, /this\.refineButton\.hidden = last \|\| !ready/);
});

test('mobile picks a pane instead of stacking three', () => {
  const workbench = fs.readFileSync('js/ui/Workbench.js', 'utf8');
  const layout = fs.readFileSync('css/layout.css', 'utf8');
  assert.match(workbench, /Workbench\.prototype\.showMobilePane = function/);
  assert.match(layout, /data-mobile-pane="viewer"/);
  // §28 : l'inspecteur reste sous le viewer, pas sous la liste.
  assert.match(layout, /\.design-workspace > \.detail-pane \{ grid-column: 2; grid-row: 2; \}/);
});

test('nothing still points at a panel that no longer exists', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.doesNotMatch(html, /panneau de gauche/);
  assert.doesNotMatch(html, /Mode expert/);
  // §30 : le produit dépasse le calcul d'engrenages.
  assert.match(html, /Concepteur de transmissions/);
  assert.doesNotMatch(html, /<strong>Calculateur d'engrenages<\/strong>/);
});
