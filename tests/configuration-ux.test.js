const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Preferences = require('../js/requirements/PreferenceModel.js');
const Selection = require('../js/requirements/TechnologySelectionModel.js');
const Technical = require('../js/requirements/TechnicalSettingsModel.js');
const Quantity = require('../js/requirements/Quantity.js');

const html = fs.readFileSync('index.html', 'utf8');
const session = fs.readFileSync('js/ui/SearchSession.js', 'utf8');
const modal = fs.readFileSync('js/ui/search/SearchModal.js', 'utf8');
const typeStep = fs.readFileSync('js/ui/search/TypeStep.js', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
const workbench = fs.readFileSync('js/ui/Workbench.js', 'utf8');

// ===== La page n'est plus un formulaire (§16) =====

test('the page carries no configuration form any more', () => {
  // Les étapes de configuration ont quitté la barre latérale.
  for (const id of ['step-besoin', 'step-contraintes', 'step-priorite', 'step-technologie']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `#${id} devrait avoir disparu de la page`);
  }
  // Ce sont le modal qui les crée, à la demande.
  assert.match(modal, /id = 'requirementSheet'/);
  assert.match(modal, /id = 'constraintChips'/);
  assert.match(html, /id="requirementBanner"/);
  assert.match(html, /id="editSearchBtn"/);
});

test('the technical panels are moved, never duplicated', () => {
  // Un identifiant dupliqué casserait SearchParams : le modal DÉPLACE.
  assert.match(modal, /adoptLegacyPanels/);
  assert.match(modal, /appendChild\(panel\)/);
  for (const id of ['panel-avance-racine', 'technologyPanel', 'max_diameter', 'etages', 'weight_size', 'type_template']) {
    const count = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
    assert.equal(count, 1, `#${id} doit exister exactement une fois`);
  }
});

test('every mirrored control still exists, so old links keep working', () => {
  // On ne lit QUE les tables de miroirs : le reste du fichier contient d'autres
  // `id:` (les niveaux d'analyse) qui ne désignent pas des contrôles.
  const tables = session.slice(session.indexOf('var MIRRORS'), session.indexOf('function el('));
  const ids = (tables.match(/(?:id|min|max): '([a-z_]+)'/g) || []).map(entry => entry.split("'")[1]);
  assert.ok(ids.length >= 8, 'les miroirs doivent couvrir la fiche');
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} absent du DOM`);
  }
});

// ===== §21 : une nouvelle recherche est vide =====

test('a new search imposes no value the user never chose', () => {
  assert.match(session, /new R\.RequirementModel\(seed\.requirement \|\| \{\}\)/);
  // Et les miroirs ne portent plus de valeur d'usine, sinon `adoptForm` la
  // ressusciterait au premier chargement.
  const mirrors = html.slice(html.indexOf('id="legacyMirrors"'), html.indexOf('id="technologyPanel"'));
  assert.doesNotMatch(mirrors, /value="\d/, 'aucune valeur d’usine dans les miroirs');
  assert.match(app, /openSearchModalIfEmpty/);
});

// ===== §18 : brouillon =====

test('editing works on a draft, so an abandoned edit changes nothing', () => {
  assert.match(session, /SearchSession\.prototype\.draft = function/);
  assert.match(session, /SearchSession\.prototype\.adopt = function/);
  assert.match(modal, /this\.draft = this\.session\.draft\(\)/);
  // Annuler jette le brouillon ; seul « Rechercher » le promeut.
  const cancel = modal.slice(modal.indexOf('SearchModal.prototype.cancel'), modal.indexOf('SearchModal.prototype.submit'));
  assert.doesNotMatch(cancel, /adopt/);
  assert.match(modal.slice(modal.indexOf('SearchModal.prototype.submit')), /this\.session\.adopt\(this\.draft\)/);
});

// ===== §19 : politique de sélection technologique =====

test('four policies cover the four real intents', () => {
  assert.deepEqual(Selection.POLICIES.map(p => p.id), ['auto', 'prefer', 'restrict', 'template']);

  const advice = ['internal', 'planetary', 'spur'];
  const universe = ['spur', 'helical', 'internal', 'bevel', 'planetary', 'worm', 'belt', 'chain'];

  const auto = new Selection.TechnologySelectionModel();
  assert.deepEqual(auto.resolve(advice, universe), advice);

  // « Uniquement du planétaire » ferme la porte.
  const restrict = new Selection.TechnologySelectionModel({ policy: 'restrict', families: ['planetary'] });
  assert.deepEqual(restrict.resolve(advice, universe), ['planetary']);

  // « Je préférerais du planétaire » la laisse ouverte, en tête de liste.
  const prefer = new Selection.TechnologySelectionModel({ policy: 'prefer', families: ['planetary'] });
  const preferred = prefer.resolve(advice, universe);
  assert.equal(preferred[0], 'planetary');
  assert.ok(preferred.includes('spur'), 'une meilleure alternative doit rester explorée');
});

test('a preference tilts the ranking without filtering anything', () => {
  const prefer = new Selection.TechnologySelectionModel({ policy: 'prefer', families: ['planetary'] });
  assert.equal(prefer.preferenceBonus({ stages: [{ type: 'planetary' }] }), 1);
  assert.equal(prefer.preferenceBonus({ stages: [{ type: 'spur' }] }), 0);
  // Un train mixte compte au prorata.
  assert.equal(prefer.preferenceBonus({ stages: [{ type: 'planetary' }, { type: 'spur' }] }), 0.5);
  // Une politique restrictive ne classe pas : elle filtre en amont.
  const restrict = new Selection.TechnologySelectionModel({ policy: 'restrict', families: ['planetary'] });
  assert.equal(restrict.preferenceBonus({ stages: [{ type: 'planetary' }] }), 0);
});

test('an imposed architecture fixes the stage count and the families explored', () => {
  const template = new Selection.TechnologySelectionModel({ policy: 'template', template: [['bevel'], ['helical']] });
  assert.equal(template.stagesRequired(), 2);
  assert.deepEqual(template.toTemplate(), [['bevel'], ['helical']]);
  assert.deepEqual(template.resolve(['spur'], ['spur', 'bevel', 'helical']).sort(), ['bevel', 'helical']);
  // Un cran « Auto » ouvre l'univers pour cet étage seulement.
  const mixed = new Selection.TechnologySelectionModel({ policy: 'template', template: [['bevel'], []] });
  assert.deepEqual(mixed.toTemplate(), [['bevel'], null]);
  assert.ok(mixed.resolve(['spur'], ['spur', 'bevel']).includes('spur'));
});

test('the epicyclic alias never produces two entries for one family', () => {
  const selection = new Selection.TechnologySelectionModel({ policy: 'restrict', families: ['epicyclic', 'planetary'] });
  assert.deepEqual(selection.families, ['planetary']);
});

// ===== §14 : réglages techniques modélisés =====

test('technical settings leave the form and become a model', () => {
  // La session ne lit plus SearchParams.fromForm pour ses réglages.
  assert.doesNotMatch(session, /SearchParams\.fromForm/);
  assert.match(session, /this\.technical\.toAdapterSettings\(\)/);

  const settings = new Technical.TechnicalSettingsModel();
  const adapter = settings.toAdapterSettings();
  assert.equal(adapter.dentMenanteMin, 10);
  assert.equal(adapter.moduleMode, 'fixed');
  assert.ok(adapter.typeParameters.spur, 'les paramètres par famille viennent du registre');
  assert.equal(adapter.typeParameters.spur.module, 1, 'le module descend dans chaque famille');
});

test('a group knows whether it was touched, so nothing is shown by default', () => {
  const settings = new Technical.TechnicalSettingsModel();
  assert.equal(settings.isCustomised('materials'), false);
  settings.set('materials', 'input', '42CrMo4');
  assert.equal(settings.isCustomised('materials'), true);
  assert.deepEqual(settings.customisedGroups(), ['materials']);
});

test('choosing 3D printing applies its derating, and undoing it restores the default', () => {
  const settings = new Technical.TechnicalSettingsModel();
  assert.equal(settings.manufacturing.additiveDerating, 1);
  settings.set('manufacturing', 'process', 'printing3d');
  assert.equal(settings.manufacturing.additiveDerating, Technical.ADDITIVE_DERATING);
  settings.set('manufacturing', 'process', 'standard');
  assert.equal(settings.manufacturing.additiveDerating, 1);
  // Un abattement réglé à la main n'est jamais écrasé.
  settings.set('manufacturing', 'additiveDerating', 0.8);
  settings.set('manufacturing', 'process', 'printing3d');
  assert.equal(settings.manufacturing.additiveDerating, 0.8);
});

// ===== §13 : trois étapes, pas sept =====

test('the mandatory path is three steps, the technical part is optional', () => {
  assert.match(modal, /var STEPS = \[/);
  const steps = modal.slice(modal.indexOf('var STEPS'), modal.indexOf('function el('));
  assert.match(steps, /'type'/);
  assert.match(steps, /'need'/);
  assert.match(steps, /'criteria'/);
  assert.equal((steps.match(/id: '/g) || []).length, 3, 'exactement trois étapes obligatoires');
  assert.match(modal, /Options techniques avancées/);
});

test('the first question is how to choose, not which of nine families', () => {
  assert.deepEqual(typeStep.match(/policy: '(\w+)'/g).slice(0, 3), ["policy: 'auto'", "policy: 'restrict'", "policy: 'template'"]);
  // Le parcours conseillé parle géométrie, pas denture.
  assert.match(typeStep, /Disposition souhaitée/);
  assert.match(typeStep, /Renvoi d’angle/);
  assert.match(typeStep, /Arbres éloignés/);
});

// ===== Contraintes et préférences, inchangées dans leur fond (§8) =====

test('a constraint still filters and a preference still only ranks', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('maxDiameter', Quantity.atMost(50));
  const big = { dimensions: { maxDiameter: 60 } };
  assert.equal(prefs.accepts(big), false);
  prefs.toggleSoft('maxDiameter');
  assert.equal(prefs.accepts(big), true);
  assert.ok(prefs.penalty(big) > 0);
});

test('the secondary priority appears only when it is used (§10)', () => {
  assert.match(modal, /id = 'secondaryPriorityToggle'/);
  assert.match(modal, /if \(self\.draft\.preferences\.secondary\) secondaryHost\.hidden = false/);
});

// ===== Le mode global reste supprimé (passe précédente) =====

test('there is still no standard/expert switch', () => {
  assert.doesNotMatch(html, /id="proModeBtn"/);
  assert.doesNotMatch(app, /toggleProMode/);
  assert.doesNotMatch(workbench, /_rotaryTypes/);
});
