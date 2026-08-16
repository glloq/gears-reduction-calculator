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
