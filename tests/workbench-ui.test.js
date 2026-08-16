const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/ui/Workbench.js', 'utf8');
const controller = fs.readFileSync('js/ui/UIController.js', 'utf8');

// Identifiants historiques consommés par SearchParams.fromForm : le nouveau
// DOM doit tous les fournir, sinon la lecture du formulaire échoue.
const REQUIRED_IDS = [
  'objective_mode', 'rapport', 'precision', 'rpm_sortie_cible',
  'linear_travel_per_rev', 'linear_speed_min', 'linear_speed_max', 'linear_force_min',
  'etages', 'max_solutions', 'max_iterations', 'dent_menante_fixe', 'dent_menee_fixe',
  'val_menante_min', 'val_menante_max', 'val_menee_min', 'val_menee_max',
  'reduction_only', 'search_mode', 'module_mode', 'module', 'module_min', 'module_max',
  'vitesse_entree', 'couple_entree', 'max_diameter', 'max_length', 'max_width',
  'rpm_sortie_min', 'rpm_sortie_max', 'minimum_output_torque', 'minimum_efficiency',
  'minimum_bending_safety', 'minimum_contact_safety',
  'input_material', 'output_material', 'manufacturing_mode', 'manufacturing_min_module',
  'manufacturing_min_teeth', 'manufacturing_min_width', 'printer_diameter', 'additive_derating',
  'fatigue_enabled', 'hours_per_day', 'days_per_year', 'service_years', 'load_type',
  'support_distance', 'shaft_allowable_shear',
  'weight_ratio', 'weight_size', 'weight_efficiency', 'weight_stress',
  'weight_stages', 'weight_noise', 'weight_manufacturing', 'weight_cost',
  'type-spur', 'type-helical', 'type-internal', 'type-bevel', 'type-epicyclic',
  'type-worm', 'type-belt', 'type-chain', 'type-rack', 'typeParamsContainer',
  'dent_menante_slider', 'dent_menee_slider',
  'type_template', 'typeTemplateContainer', 'min_center_distance', 'max_center_distance'
];

// Barre d'affinage du vivier (SolutionExplorer)
const REFINE_IDS = [
  'refineBar', 'refine_error_max', 'refine_efficiency_min', 'refine_sf_min',
  'refine_sh_min', 'refine_diameter_max', 'refine_length_max', 'refine_stages_max',
  'refineTypeChips', 'refine_sort', 'refineCount', 'refineResetBtn'
];

test('modular shell ships every field id consumed by SearchParams', () => {
  for (const id of REQUIRED_IDS) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});

test('refine bar ships every control consumed by SolutionExplorer', () => {
  for (const id of REFINE_IDS) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});

test('solution tiles carry pool indices and selection matches by data-index', () => {
  assert.match(ui, /tile\.dataset\.index = index/);
  assert.match(ui, /tile\.dataset\.index === String\(self\.selected\)/);
  // Le tableau gère sa propre sélection : plus de boucle positionnelle sur #resultats.
  assert.doesNotMatch(ui, /#resultats tr/);
});

test('manufacturing is a standard module, not expert-gated', () => {
  const panel = html.match(/<details class="([^"]*)" id="panel-fabrication">/);
  assert.ok(panel, 'missing #panel-fabrication');
  assert.doesNotMatch(panel[1], /expert-only/);
  assert.match(html, /id="manufacturing_mode"/);
  assert.match(html, /class="field-grid printing3d-only"/);
});

test('workspace is a master-detail layout with detail tabs', () => {
  assert.match(html, /id="solutionCards"/);
  assert.match(html, /id="resultats"/);
  assert.match(html, /class="detail-tabs"/);
  for (const tab of ['analyse', 'editeur', 'comparer', 'graphiques', 'journal']) {
    assert.match(html, new RegExp(`data-detail="${tab}"`), `missing detail tab ${tab}`);
    assert.match(html, new RegExp(`data-detail-panel="${tab}"`), `missing detail panel ${tab}`);
  }
  for (const canvas of ['ratioChart', 'radarChart', 'cascadeChart', 'powerLossChart', 'safetyChart']) {
    assert.match(html, new RegExp(`id="${canvas}"`), `missing chart ${canvas}`);
  }
  // L'onglet Analyse remplace l'ancien onglet Schéma comme panneau actif.
  assert.match(html, /class="detail-panel active" data-detail-panel="analyse"/);
  assert.doesNotMatch(html, /data-detail="schema"/);
});

test('the viewer is a full-width hero above the results grid', () => {
  // Le graphique d'abord : section héro pleine largeur, avant la grille
  // maître/détail, avec le conteneur SVG hors du volet détail.
  assert.match(html, /<section class="hero-viewer viz-section"/);
  assert.ok(html.indexOf('class="hero-viewer') < html.indexOf('class="workspace-grid"'), 'hero before the grid');
  assert.ok(html.indexOf('id="svgContainer"') < html.indexOf('class="workspace-grid"'), 'viewer outside the detail pane');
  // La denture réaliste est le bouton de vue actif par défaut, et elle n'est
  // plus réservée aux objectifs rotatifs : la crémaillère y est dessinée.
  assert.match(html, /class="view-mode active" data-view="teeth"/);
  assert.doesNotMatch(html, /view-mode[^"]*rotary-only/);
});

test('the viewer exposes adaptive display and animation controls', () => {
  assert.match(html, /id="viewerSpeed"/);
  assert.match(html, /id="viewerReverse"/);
  assert.match(html, /id="viewerDisplayMenu"/);
  assert.match(html, /data-overlay="dimensions"/);
  assert.match(html, /data-overlay="powerFlow"/);
});

test('behavior is bound in JS, not in inline attributes', () => {
  assert.doesNotMatch(html, /onclick=/);
});

test('objective modes use contextual groups and expose a live derived ratio', () => {
  assert.match(html, /objective-fields objective-ratio/);
  assert.match(html, /objective-fields objective-need/);
  assert.match(html, /objective-fields objective-linear/);
  assert.match(ui, /objective-' \+ context/);
  assert.match(ui, /Rapport cible dérivé/);
  assert.match(html, /solveur linéaire traite directement un pignon \+ crémaillère/);
});

test('successful searches automatically select solution zero', () => {
  assert.match(controller, /solution:selected', \{ index: 0, solution: solutions\[0\] \}/);
});

test('pure view changes do not invoke the search engine', () => {
  const viewMethods = ui.slice(ui.indexOf('_bindResultsView = function'), ui.indexOf('_bindExportMenu = function'));
  assert.ok(viewMethods.length > 0);
  assert.doesNotMatch(viewMethods, /rechercher|lancerRecherche/);
});

test('optional safety constraints ship blank with placeholders', () => {
  for (const id of ['minimum_bending_safety', 'minimum_contact_safety']) {
    const match = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert.ok(match, `missing #${id}`);
    assert.match(match[0], /placeholder=/);
    assert.doesNotMatch(match[0], /value=/);
  }
});

test('type parameter editors are available outside expert mode', () => {
  // Le rendu des champs tp_* ne doit dépendre d'aucun drapeau pro/expert.
  const renderer = ui.slice(ui.indexOf('renderTypeParams = function'), ui.indexOf('_bindModuleMode = function'));
  assert.ok(renderer.length > 0);
  assert.match(renderer, /tp_/);
  assert.doesNotMatch(renderer, /proMode|pro-mode/);
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
    const card = { hidden: false };
    return { value, checked, disabled: false, closest: () => card, card, classList: classList() };
  }

  const objective = { value: 'ratio' };
  const output = { dispatchEvent() {} };
  const fields = [
    { classList: classList(['objective-ratio']) },
    { classList: classList(['objective-linear']) }
  ];
  const boxes = [checkbox('spur', true), checkbox('belt', false), checkbox('rack', false)];
  const elements = { objective_mode: objective, rpm_sortie_cible: output };
  const document = {
    body: { classList: classList() },
    getElementById: id => elements[id] || null,
    querySelectorAll: selector => selector === '.type-checkbox' ? boxes : fields
  };
  const sandbox = { GearApp: { ui: {} }, document, Event: function Event(type) { this.type = type; }, window: {}, requestAnimationFrame: () => {} };
  vm.runInNewContext(ui, sandbox);
  const workbench = new sandbox.GearApp.ui.Workbench({});
  workbench.updateSummary = function () {};
  workbench.renderTypeParams = function () {};

  // Mode rotatif initial sans instantané : l'état du DOM est respecté.
  workbench.updateContext();
  assert.deepEqual(boxes.map(box => [box.value, box.checked]), [
    ['spur', true], ['belt', false], ['rack', false]
  ]);

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

  // L'instantané est consommé : un choix manuel ultérieur survit au prochain
  // passage dans updateContext.
  boxes[1].checked = true;
  workbench.updateContext();
  assert.equal(boxes[1].checked, true);
});
