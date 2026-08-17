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

test('the old form stays out of the modal, and out of sight (§20)', () => {
  // Le plus gros reliquat de l'ancienne UI : montrer les panneaux numérotés
  // dans « Options techniques avancées » revenait à poser deux fois la même
  // question, dans deux langages différents.
  assert.doesNotMatch(modal, /adoptLegacyPanels/);
  assert.match(modal, /releaseLegacyPanels/);
  assert.match(modal, /legacyHost/);
  // Ils restent dans la page, cachés : ce sont encore les miroirs lus par
  // SearchParams, les presets et les URLs partagées.
  assert.match(html, /id="legacyHost" hidden/);
  for (const id of ['panel-avance-racine', 'technologyPanel', 'max_diameter', 'etages', 'weight_size', 'type_template']) {
    const count = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
    assert.equal(count, 1, `#${id} doit exister exactement une fois`);
  }
});

test('what only the old form carried now has an editor of its own (§20)', () => {
  // Chaque réglage retiré de la vue doit rester atteignable, sinon on n'a pas
  // simplifié : on a amputé.
  const Technical = require('../js/requirements/TechnicalSettingsModel.js');
  const covered = (modal.match(/group: '(\w+)', key: '(\w+)'/g) || [])
    .map(entry => entry.match(/group: '(\w+)', key: '(\w+)'/).slice(1).join('.'));
  for (const pair of ['materials.input', 'materials.output', 'module.mode', 'module.min', 'module.max',
    'shaft.supportDistanceMm', 'shaft.allowableShearMPa', 'manufacturing.minimumModule',
    'manufacturing.printerDiameter', 'manufacturing.additiveDerating']) {
    assert.ok(covered.includes(pair), pair + ' n’est plus éditable nulle part');
  }
  // Et l'éditeur écrit sur le MODÈLE, jamais sur un champ historique.
  assert.match(modal, /technical\.set\(field\.group, field\.key/);
  assert.ok(Technical.DEFAULTS.shaft && Technical.DEFAULTS.materials);
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

  // Le conseiller ORDONNE l'univers compatible ; il ne le referme pas.
  const ranking = ['internal', 'planetary', 'spur'];
  const universe = ['spur', 'helical', 'internal', 'bevel', 'planetary', 'worm', 'belt', 'chain'];

  // AUTO explore TOUT le compatible, dans l'ordre conseillé : se limiter au
  // classement reviendrait à décider avant d'avoir calculé.
  const auto = new Selection.TechnologySelectionModel().resolve(ranking, universe);
  assert.equal(auto.length, universe.length, 'automatique doit tout explorer');
  assert.deepEqual(auto.slice(0, 3), ranking, 'et le faire dans l’ordre conseillé');

  // « Uniquement du planétaire » ferme la porte, et c'est le seul mode qui le fait.
  const restrict = new Selection.TechnologySelectionModel({ policy: 'restrict', families: ['planetary'] });
  assert.deepEqual(restrict.resolve(ranking, universe), ['planetary']);

  // « Je préférerais du planétaire » la laisse GRANDE ouverte.
  const prefer = new Selection.TechnologySelectionModel({ policy: 'prefer', families: ['planetary'] });
  const preferred = prefer.resolve(ranking, universe);
  assert.equal(preferred[0], 'planetary');
  assert.equal(preferred.length, universe.length, 'préférer n’exclut rien');
  assert.ok(preferred.includes('worm'), 'même une famille jamais conseillée reste calculée');
});

test('the advisor eliminates, orders and explains — it never closes the domain', () => {
  const { RequirementModel } = require('../js/requirements/RequirementModel.js');
  const Advisor = require('../js/requirements/TransmissionAdvisor.js');
  const advice = Advisor.advise(
    new RequirementModel({ input: { speed: 1500 }, output: { speed: 125 } }),
    new Preferences.PreferenceModel());

  // La recommandation reste courte — c'est un affichage.
  assert.ok(advice.selection.length <= Advisor.MAX_RECOMMENDED);
  // Le classement, lui, couvre tout ce qui n'est pas formellement écarté.
  assert.equal(advice.ranking.length, Advisor.ROTARY.length - advice.excluded.length);
  assert.ok(advice.ranking.length > advice.selection.length, 'le domaine dépasse la recommandation');
  // Et il est trié : le mieux classé d'abord.
  assert.equal(advice.ranking[0], advice.recommended[0].id);
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
  // §12 : les réglages secondaires ne sont plus un second formulaire déroulé,
  // mais cinq lignes qui disent leur valeur et s'ouvrent à la demande.
  assert.match(modal, /var OPTION_ROWS = \[/);
  assert.match(modal, /label: 'Paramètres techniques'/);
  assert.match(modal, /_optionSummary/);
});

test('the first step asks two independent questions', () => {
  const Intent = require('../js/requirements/SearchIntentModel.js');
  // Ce qu'on cherche…
  assert.match(typeStep, /Que cherchez-vous/);
  // Trois points de départ, pas six : « meilleur compromis », « contraintes »
  // et « pièces existantes » n'étaient pas des méthodes mais, respectivement,
  // une stratégie de classement et deux jeux de données déjà saisis.
  assert.deepEqual(Intent.MODES.map(m => m.id), ['design', 'maximize', 'improve']);
  // …et, séparément, comment choisir la technologie.
  assert.match(typeStep, /Comment choisir la technologie/);
  assert.deepEqual(typeStep.match(/policy: '(\w+)'/g).slice(0, 4),
    ["policy: 'auto'", "policy: 'prefer'", "policy: 'restrict'", "policy: 'template'"]);
  // La disposition décrit le besoin : elle vaut quelle que soit la politique.
  assert.match(typeStep, /Disposition souhaitée/);
  assert.match(typeStep, /Renvoi d’angle/);
  assert.match(typeStep, /Arbres éloignés/);
});

test('only the modes the solver can honour are offered', () => {
  const Intent = require('../js/requirements/SearchIntentModel.js');
  // Les modes prévus mais irréalisables sont déclarés, jamais affichés :
  // une carte sans effet serait pire que son absence. La liste est vide
  // aujourd'hui — chaque mode annoncé est réellement honoré.
  for (const planned of Intent.PLANNED) {
    assert.ok(!Intent.mode(planned.id), planned.id + ' ne doit pas être proposé');
    assert.ok(planned.needs, planned.id + ' doit dire ce qui lui manque');
  }
  // Chaque mode affiché doit être porté par du code, pas par une carte seule.
  for (const mode of Intent.MODES) {
    if (mode.explore) assert.match(typeStep, /intent\.explores\(\)/);
    if (mode.improve) assert.match(typeStep, /intent\.improves\(\)/);
    if (mode.parts) assert.match(modal, /usesParts\(\)/);
  }
});

test('the quantity decides the ratio window, not a declared method', () => {
  const Intent = require('../js/requirements/SearchIntentModel.js');
  // Concevoir n'impose AUCUNE tolérance : « = 12 » veut dire cible stricte,
  // « ≈ 12 » un compromis, « 10 → 15 » une plage. Le modèle Quantity dit déjà
  // tout cela, et une carte de méthode ne peut que le contredire.
  assert.equal(new Intent.SearchIntentModel({ mode: 'design' }).ratioTolerance(), null);
  const Compiler = require('../js/requirements/ConstraintCompiler.js');
  const Q = require('../js/requirements/Quantity.js');
  const strict = Compiler.ratioTolerance(Q.exact(12));
  const soft = Compiler.ratioTolerance(Q.target(12, 4));
  const span = Compiler.ratioTolerance(Q.between(10, 15));
  assert.ok(strict.percent < soft.percent, 'une cible exacte est plus stricte qu’un « ≈ »');
  assert.ok(span.percent > soft.percent, 'une plage est plus large qu’un « ≈ » serré');
  // Un rapport saisi directement garde sa tolérance : la méthode n'écrase rien.
  assert.match(session, /!this\.requirement\.ratio\.isKnown\(\)/);
});

test('an old shared search still lands on the journey it meant', () => {
  const Intent = require('../js/requirements/SearchIntentModel.js');
  // Les quatre anciennes méthodes sont toutes des façons de CONCEVOIR.
  for (const old of ['best', 'target', 'constrained', 'parts']) {
    assert.equal(new Intent.SearchIntentModel({ mode: old }).mode, 'design', old);
  }
  // Exploration et amélioration gardent leur identifiant.
  assert.equal(new Intent.SearchIntentModel({ mode: 'maximize' }).mode, 'maximize');
  assert.equal(new Intent.SearchIntentModel({ mode: 'improve' }).mode, 'improve');
  assert.equal(new Intent.SearchIntentModel({ mode: 'jamais-vu' }).mode, 'design');
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

test('the secondary priority opens AND closes again (§10)', () => {
  assert.match(modal, /id = 'secondaryPriorityToggle'/);
  // Le bloc ne s'impose pas, mais le bouton ne disparaît jamais : il se
  // cachait après usage, si bien qu'une secondaire ouverte par erreur ne
  // pouvait plus être refermée.
  assert.doesNotMatch(modal, /toggle\.hidden = /);
  assert.match(modal, /Retirer la priorité secondaire/);
  assert.match(modal, /Ajouter une priorité secondaire/);
  // Refermer retire réellement la priorité, au lieu de la laisser agir cachée.
  assert.match(modal, /if \(self\._secondaryOpen\) self\.draft\.preferences\.secondary = null/);
});

// ===== Le mode global reste supprimé (passe précédente) =====

test('there is still no standard/expert switch', () => {
  assert.doesNotMatch(html, /id="proModeBtn"/);
  assert.doesNotMatch(app, /toggleProMode/);
  assert.doesNotMatch(workbench, /_rotaryTypes/);
});

// ===== §20 : la puissance moteur remplace le couple quand on ne l'a pas =====

test('a nameplate power and speed yield the torque nobody had to compute', () => {
  const { RequirementModel } = require('../js/requirements/RequirementModel.js');
  const model = new RequirementModel({ input: { speed: 1500, power: 750 }, ratio: 12 });
  // C = P·60 / (2πN) = 750·60 / (2π·1500) ≈ 4,77 N·m
  assert.equal(Math.round(model.inputTorqueRequirement().nominal() * 100) / 100, 4.77);
  // Le couple saisi reste prioritaire sur celui qu'on déduirait.
  model.set('input.torque', { kind: 'exact', value: 6 });
  assert.equal(model.inputTorqueRequirement().nominal(), 6);
});

test('the derived torque reaches the engine and unlocks the mechanical analysis', () => {
  const { RequirementModel } = require('../js/requirements/RequirementModel.js');
  const Compiler = require('../js/requirements/ConstraintCompiler.js');
  const model = new RequirementModel({ input: { speed: 3000, power: 1500 }, ratio: 10 });
  const request = Compiler.compile(model, new Preferences.PreferenceModel());
  assert.equal(Math.round(request.inputTorqueNm * 100) / 100, 4.77);
  // Et le diagnostic le dit plutôt que de réclamer un couple.
  assert.ok(model.diagnose().some(note => note.code === 'derived-torque'));
  assert.ok(!model.diagnose().some(note => note.code === 'no-input-torque'));
});

// ===== §9 : suggestions de critères contextuelles =====

test('the suggested criteria follow the families actually explored', () => {
  const worm = Preferences.suggest(['worm'], false, {});
  assert.equal(worm[0], 'efficiency', 'une vis sans fin appelle d’abord un rendement minimum');

  const belt = Preferences.suggest(['belt', 'chain'], false, {});
  assert.equal(belt[0], 'centerDistance', 'une courroie appelle d’abord un entraxe');
  assert.ok(!worm.includes('centerDistance'), 'l’entraxe n’est pas le sujet d’une vis');

  const rack = Preferences.suggest(['rack'], true, {});
  assert.deepEqual(rack.slice(0, 2), ['outputForce', 'linearSpeed']);
});

test('suggestions never repeat what is already posed, and never run dry', () => {
  const first = Preferences.suggest(['worm'], false, {});
  const after = Preferences.suggest(['worm'], false, { efficiency: 1 });
  assert.ok(!after.includes('efficiency'));
  assert.ok(after.length >= 4, 'la liste se complète depuis le socle générique');
  // Sans famille décidée, on propose quand même les critères universels.
  assert.deepEqual(Preferences.suggest([], false, {}), ['maxDiameter', 'maxLength', 'efficiency', 'stages']);
  assert.notDeepEqual(first, after);
});

test('the menu shows suggestions first and keeps the full catalogue one click away', () => {
  const chips = fs.readFileSync('js/ui/ConstraintChips.js', 'utf8');
  assert.match(chips, /constraintSuggestions/);
  assert.match(chips, /Critères recommandés/);
  assert.match(chips, /Toutes les contraintes/);
  // Le catalogue n'est rendu qu'après demande explicite.
  assert.match(chips, /if \(!this\._showAll\) return;/);
});

test('the centre distance is a real constraint, not a label', () => {
  const Compiler = require('../js/requirements/ConstraintCompiler.js');
  const { RequirementModel } = require('../js/requirements/RequirementModel.js');
  const prefs = new Preferences.PreferenceModel();
  prefs.require('centerDistance', Quantity.between(60, 120));
  const request = Compiler.compile(new RequirementModel({ ratio: 8 }), prefs);
  assert.equal(request.constraints.minCenterDistance, 60);
  assert.equal(request.constraints.maxCenterDistance, 120);
});

// ===== §15 : paramètres propres aux familles explorées =====

test('a family exposes exactly the parameters the registry defines for it', () => {
  const worm = Technical.TechnicalSettingsModel.definitionsFor('worm');
  assert.deepEqual(Object.keys(worm), ['wormStartsMin', 'wormStartsMax', 'leadAngle']);
  const planetary = Technical.TechnicalSettingsModel.definitionsFor('planetary');
  assert.ok(planetary.inputMember && planetary.outputMember && planetary.fixed);
  // L'hélicoïdal n'expose pas de nombre de filets, et réciproquement.
  assert.ok(!Technical.TechnicalSettingsModel.definitionsFor('helical').wormStartsMin);
});

test('the editor only renders the families the search will explore', () => {
  const editor = fs.readFileSync('js/ui/search/TypeParametersEditor.js', 'utf8');
  assert.match(editor, /this\.draft\.selectedTechnologies\(\)/);
  assert.match(editor, /definitionsFor/);
  // Il n'embarque aucune liste de paramètres : le registre reste la définition.
  assert.doesNotMatch(editor, /helixAngle|pressureAngle|planetCount/);
});

test('a type parameter edited in the modal reaches the engine and the mirrors', () => {
  const settings = new Technical.TechnicalSettingsModel();
  settings.setTypeParameter('spur', 'faceWidth', 18);
  assert.equal(settings.toAdapterSettings().typeParameters.spur.faceWidth, 18);
  assert.match(session, /el\('tp_' \+ typeId \+ '_' \+ key\)/, 'les champs historiques restent le miroir');
});

// ===== §20 : les données que le moteur calculait déjà sans les exposer =====

const Engine = require('../js/core/SearchEngine.js');

function pool(extra) {
  return Engine.search(Object.assign({
    rapportCible: 9, dentMenanteMin: 10, dentMenanteMax: 12, dentMeneeMin: 28, dentMeneeMax: 36,
    precisionToleree: 1, maxEtages: 2, maxSolutions: 20, maxIterations: 40000,
    typesActifs: ['spur'], typeParameters: { spur: { module: 1 } }, allowReductionOnly: true,
    module: 1, moduleMode: 'fixed', vitesseEntree: 1500, coupleEntree: 2
  }, extra)).solutions;
}

test('the output direction comes from the families, not from the ratio sign', () => {
  // Un couple droit inverse la sortie alors que son rapport est positif :
  // dériver le sens du signe du rapport donnait systématiquement « + ».
  const solutions = pool();
  assert.ok(solutions.length);
  for (const solution of solutions) {
    const expected = solution.stages.length % 2 === 0 ? 1 : -1;
    assert.equal(solution.totalDirection, expected, solution.stages.length + ' étage(s)');
  }
});

test('a demanded direction really filters, because the engine cannot', () => {
  const prefs = new Preferences.PreferenceModel();
  prefs.require('outputDirection', Quantity.exact(1));
  const solutions = pool();
  const kept = solutions.filter(s => prefs.accepts(s));
  assert.ok(kept.length < solutions.length || solutions.every(s => s.totalDirection === 1));
  assert.ok(kept.every(s => s.totalDirection === 1));
  // Et elle est signalée comme non traduisible pour le moteur.
  assert.deepEqual(prefs.clientConstraints().map(e => e.key), ['outputDirection']);
});

test('pitch line velocity is computed, not guessed', () => {
  const solution = pool()[0];
  const speed = solution.inputSpeedRpm;
  const diameter = solution.mechanical[0].geometry.pitchDiameterInput;
  const expected = Math.PI * diameter * speed / 60000;
  assert.ok(Math.abs(Preferences.pitchLineVelocity(solution) - expected) < 1e-9);
  // Sans régime d'entrée, on ne prétend rien.
  assert.equal(Preferences.pitchLineVelocity({ inputSpeedRpm: null, mechanical: [] }), null);
});

test('heat comes from the losses the engine already totals', () => {
  const solution = pool()[0];
  const loss = Preferences.criterion('powerLoss').metric(solution);
  assert.equal(loss, solution.lossPowerW);
  assert.ok(Math.abs(loss - (solution.inputPowerW - solution.outputPowerW)) < 1e-9);
});

test('a shaft distance makes belts and chains relevant, and says so', () => {
  const { RequirementModel } = require('../js/requirements/RequirementModel.js');
  const Advisor = require('../js/requirements/TransmissionAdvisor.js');
  const prefs = new Preferences.PreferenceModel();
  const near = Advisor.advise(new RequirementModel({ ratio: 9 }), prefs);
  const far = Advisor.advise(new RequirementModel({ ratio: 9, architecture: { shaftDistanceMm: 300 } }), prefs);

  const rank = (advice, id) => advice.recommended.concat(advice.possible).findIndex(e => e.id === id);
  assert.ok(rank(far, 'belt') < rank(near, 'belt'), 'la courroie doit remonter');
  const belt = far.recommended.concat(far.possible).find(e => e.id === 'belt');
  assert.ok(belt.reasons.some(r => /distance entre arbres/.test(r.text)));
});

test('the service cycle is reachable, and only expands once asked for', () => {
  assert.match(modal, /id: 'serviceOptions'/);
  assert.match(modal, /Estimer la fatigue/);
  assert.match(modal, /Durée de vie visée/);
  assert.match(modal, /Type de charge/);
  // §13 : la distance entre arbres a quitté « service » pour la disposition,
  // dont elle relève réellement — c'est une donnée d'architecture.
  assert.doesNotMatch(modal, /shaftDistance/);
  assert.match(typeStep, /id = 'shaftDistance'/);
  // Le détail du cycle ne s'affiche qu'une fois la fatigue demandée.
  assert.match(modal, /if \(field\.key !== 'enabled' && !fatigue\.enabled\) return;/);
});

test('a client-side constraint that empties the pool is named, not blamed elsewhere', () => {
  assert.match(app, /clientConstraints\(\)/);
  assert.match(app, /les écarte toutes/);
  // La sonde de relaxation voit les mêmes exigences que la recherche.
  assert.match(app, /session\.effectivePreferences\(\)/);
});

// ===== P0 : le front de Pareto dépend du cahier des charges =====

const Evaluator = require('../js/requirements/SolutionEvaluator.js');

test('the front gains an axis when a priority or a criterion calls for it', () => {
  const keys = prefs => Evaluator.objectivesFor(prefs).map(o => o.key);
  // Sans rien demander : les quatre axes universels.
  assert.deepEqual(keys(new Preferences.PreferenceModel()), ['size', 'efficiency', 'error', 'stages']);
  // Demander la robustesse l'ajoute au front, pas seulement au score.
  assert.ok(keys(new Preferences.PreferenceModel({ primary: 'robust' })).includes('robust'));
  // Poser un coefficient de sécurité produit le même effet, sans priorité.
  const withSafety = new Preferences.PreferenceModel();
  withSafety.require('bendingSafety', Quantity.atLeast(2));
  assert.ok(keys(withSafety).includes('robust'));
  // Et une préférence de pertes ajoute son axe.
  const withLoss = new Preferences.PreferenceModel();
  withLoss.require('powerLoss', Quantity.atMost(80), true);
  assert.ok(keys(withLoss).includes('loss'));
});

test('a safer but slightly bigger solution survives when robustness is asked for', () => {
  // C'est le cas que le front figé perdait : B est battue sur les quatre axes
  // universels, mais elle est deux fois plus sûre.
  const A = {
    stages: [{ type: 'spur' }], efficiency: 0.95, errorPercent: 0.1,
    dimensions: { x: 70, y: 70, z: 20, maxDiameter: 70 },
    mechanical: [{ bending: { safetyFactor: 1.5 } }]
  };
  const B = {
    stages: [{ type: 'spur' }], efficiency: 0.94, errorPercent: 0.2,
    dimensions: { x: 75, y: 75, z: 22, maxDiameter: 75 },
    mechanical: [{ bending: { safetyFactor: 4 } }]
  };
  const blind = Evaluator.evaluate([A, B], new Preferences.PreferenceModel());
  assert.deepEqual(blind.front, [0], 'sans axe robustesse, B est dominée et disparaît');

  const aware = Evaluator.evaluate([A, B], new Preferences.PreferenceModel({ primary: 'robust' }));
  assert.ok(aware.front.includes(1), 'avec l’axe robustesse, B reste sur le front');
  assert.ok(aware.objectives.includes('robust'));
});

test('a preferred family improves the ranking without excluding anything', () => {
  const solutions = [
    { stages: [{ type: 'spur' }], efficiency: 0.95, errorPercent: 0.2,
      dimensions: { x: 60, y: 60, z: 20, maxDiameter: 60 }, mechanical: [{}] },
    { stages: [{ type: 'planetary' }], efficiency: 0.95, errorPercent: 0.2,
      dimensions: { x: 60, y: 60, z: 20, maxDiameter: 60 }, mechanical: [{}] }
  ];
  const prefs = new Preferences.PreferenceModel();
  const neutral = Evaluator.evaluate(solutions, prefs);
  const tilted = Evaluator.evaluate(solutions, prefs,
    new Selection.TechnologySelectionModel({ policy: 'prefer', families: ['planetary'] }));
  assert.equal(neutral.scores[1], neutral.scores[0], 'à égalité sans préférence');
  assert.ok(tilted.scores[1] < tilted.scores[0], 'la famille préférée passe devant');
  assert.equal(tilted.front.length, neutral.front.length, 'et rien n’est exclu');
});

// ===== P1 : profondeur, composants, choix multiple, résumé =====

test('search depth names the trade-off, and never overwrites a hand-set limit', () => {
  const settings = new Technical.TechnicalSettingsModel();
  assert.equal(settings.depth().id, 'standard', 'le défaut porte un nom');
  assert.deepEqual(Technical.DEPTHS.map(d => d.id), ['quick', 'standard', 'deep', 'exhaustive']);
  // Les limites croissent monotonement : sinon « approfondie » ne voudrait rien dire.
  for (let i = 1; i < Technical.DEPTHS.length; i++) {
    assert.ok(Technical.DEPTHS[i].maxIterations > Technical.DEPTHS[i - 1].maxIterations);
    assert.ok(Technical.DEPTHS[i].maxSolutions > Technical.DEPTHS[i - 1].maxSolutions);
  }
  settings.setDepth('exhaustive');
  assert.equal(settings.search.maxIterations, Technical.depth('exhaustive').maxIterations);

  // Une limite réglée à la main survit au bouton : il ne prétend qu'à un ordre
  // de grandeur, il n'a pas à écraser une décision explicite.
  settings.set('search', 'maxIterations', 999);
  settings.setDepth('quick');
  assert.equal(settings.search.maxIterations, 999);
  assert.equal(settings.depth(), null, 'et la profondeur ne se réclame plus d’un préréglage');
});

test('a stage can accept several families, as the model always allowed', () => {
  const selection = new Selection.TechnologySelectionModel({ policy: 'template' });
  selection.addStage(['bevel', 'worm']).addStage(null);
  assert.deepEqual(selection.toTemplate(), [['bevel', 'worm'], null]);
  // Le cran libre ouvre l'univers pour lui seul.
  const explored = selection.resolve(['spur'], ['spur', 'bevel', 'worm', 'helical']);
  assert.ok(explored.includes('bevel') && explored.includes('worm') && explored.includes('helical'));
  // Et l'éditeur propose bien des chips, plus un select à choix unique.
  assert.match(typeStep, /stage-choice/);
  assert.doesNotMatch(typeStep, /Famille de l’étage/);
});

test('starting from one s own parts is DEDUCED, never declared', () => {
  // Saisir un inventaire, c'est déjà dire qu'on cherche dans son stock :
  // demander en plus « souhaitez-vous partir de vos pièces ? » ferait répéter
  // le geste. La question a donc disparu, la capacité non.
  assert.doesNotMatch(session, /startsFromParts/);
  assert.match(session, /SearchSession\.prototype\.usesParts = function/);
  assert.match(session, /teethInventory \|\| \[\]\)\.length > 0/);
  assert.match(modal, /draft\.usesParts\(\)/);
  // Module, dentures imposées et plages restent éditables au premier plan.
  assert.match(modal, /part_' \+ field\.group \+ '_' \+ field\.key/);
  assert.match(modal, /drivingFixed/);
  assert.match(modal, /drivenMax/);
});

test('the side summary reports what will actually be searched', () => {
  assert.match(session, /SearchSession\.prototype\.brief = function/);
  assert.match(modal, /this\.draft\.brief\(\)/);
  // Une rubrique vide n'est pas affichée : un résumé qui liste des sections
  // vides occupe la place sans informer.
  assert.match(session, /if \(kept\.length\) sections\.push/);
  // Et l'unité n'est jamais répétée derrière `describe()`.
  assert.doesNotMatch(session, /describe\(\) \+ ' rpm'/);
});
