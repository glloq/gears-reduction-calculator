const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Constraints = require('../js/ui/ConstraintManager.js');
const Preferences = require('../js/requirements/PreferenceModel.js');
const { RequirementModel } = require('../js/requirements/RequirementModel.js');

const html = fs.readFileSync('index.html', 'utf8');
const session = fs.readFileSync('js/ui/SearchSession.js', 'utf8');
const sheet = fs.readFileSync('js/ui/RequirementSheet.js', 'utf8');
const chips = fs.readFileSync('js/ui/ConstraintChips.js', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');

// ===== Le formulaire n'est plus la source (20C) =====

test('the search is built from the model, never read back from the form', () => {
  // C'est l'inversion demandée : `app.js` passe par la session, et la session
  // passe par le compilateur puis l'adaptateur.
  assert.match(app, /session\.toSearchParams\(\)/);
  assert.match(session, /ConstraintCompiler\.compile/);
  assert.match(session, /LegacySearchAdapter\.toSearchParams/);
  // La fiche et les chips éditent le modèle, pas des champs cachés.
  assert.doesNotMatch(sheet, /getElementById\('(rapport|vitesse_entree|rpm_sortie_cible)'\)/);
  assert.doesNotMatch(chips, /getElementById\('max_diameter'\)/);
});

test('every mirrored control still exists, so old links keep working', () => {
  const mirrored = session.match(/id: '([a-z_]+)'|min: '([a-z_]+)'|max: '([a-z_]+)'/g) || [];
  const ids = mirrored.map(entry => entry.split("'")[1]);
  assert.ok(ids.length >= 8, 'les miroirs doivent couvrir la fiche');
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} absent du DOM`);
  }
});

test('the sheet renders a typed row per quantity, with its unit', () => {
  assert.match(html, /id="requirementSheet"/);
  assert.match(sheet, /quantity-kind/);
  assert.match(sheet, /quantity-value/);
  assert.match(sheet, /quantity-unit/);
  // Les cinq intentions du choix 3C sont toutes proposées.
  const kinds = sheet.slice(sheet.indexOf('var KINDS'), sheet.indexOf('var SHORTCUTS'));
  for (const kind of ['exact', 'target', 'min', 'max', 'range']) {
    assert.match(kinds, new RegExp(`'${kind}'`), kind + ' manquant');
  }
});

test('a chip can be flipped between constraint and preference', () => {
  assert.match(chips, /constraint-chip-role/);
  assert.match(chips, /toggleSoft/);
  // Et le modèle traite réellement les deux différemment.
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', { kind: 'max', value: 50 });
  const big = { dimensions: { maxDiameter: 60 } };
  assert.equal(prefs.accepts(big), false);
  prefs.toggleSoft('maxDiameter');
  assert.equal(prefs.accepts(big), true);
});

// ===== Le mode global a disparu (8B) =====

test('there is no standard/expert switch left anywhere', () => {
  assert.doesNotMatch(html, /id="proModeBtn"/);
  assert.doesNotMatch(app, /toggleProMode/);
  const components = fs.readFileSync('css/components.css', 'utf8');
  assert.doesNotMatch(components, /body\.pro-mode/);
  const workspace = fs.readFileSync('css/workspace.css', 'utf8');
  assert.doesNotMatch(workspace, /body\.pro-mode/);
});

test('the eight weights are shown, not edited', () => {
  // Choix 9B : ils dérivent des deux priorités, donc ils sont désactivés.
  for (const key of Preferences.WEIGHT_KEYS) {
    const match = html.match(new RegExp(`<input id="weight_${key}"[^>]*>`));
    assert.ok(match, `weight_${key} absent`);
    assert.match(match[0], /disabled/, `weight_${key} doit être en lecture seule`);
  }
  assert.match(html, /id="priority_primary"/);
  assert.match(html, /id="priority_secondary"/);
});

// ===== Le conseiller est visible et justifié (5C) =====

test('the technology step shows a ranking with reasons, not a checkbox dump', () => {
  assert.match(html, /id="advisorList"/);
  assert.match(html, /data-technology-mode="auto"/);
  assert.match(html, /data-technology-mode="manual"/);
  const panel = fs.readFileSync('js/ui/AdvisorPanel.js', 'utf8');
  assert.match(panel, /advisor-reason/);
  assert.match(panel, /Recommandé/);
  assert.match(panel, /Écarté/);
});

// ===== Contexte linéaire / rotatif =====

test('the sheet only offers what the current problem can use', () => {
  const rotary = new RequirementModel({ input: { speed: 1500 }, ratio: 12 });
  assert.equal(rotary.inferProblem().mode, 'ratio');
  const linear = new RequirementModel({ input: { speed: 1500 }, output: { travelPerRev: 100 } });
  assert.equal(linear.inferProblem().mode, 'rotationTranslation');
  // Le passage de l'un à l'autre est déduit d'une grandeur, jamais annoncé.
  assert.doesNotMatch(html, /objective-card/);
  assert.doesNotMatch(html, /id="objectiveCards"/);
});

// ===== La barre d'affinage garde son propre catalogue =====

test('result filters remain field-based, because they filter client-side', () => {
  // Ils n'ont pas à passer par le modèle : ils n'affectent pas la recherche.
  for (const entry of Constraints.CATALOG) {
    assert.ok(entry.name, entry.field + ' sans libellé accessible');
  }
  const explorer = fs.readFileSync('js/ui/SolutionExplorer.js', 'utf8');
  assert.match(explorer, /GearConstraintManager\.Manager/);
});
