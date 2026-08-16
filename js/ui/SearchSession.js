// SearchSession.js - L'état d'un projet, et la seule route vers le moteur.
//
// Choix 20C, côté application. La session porte le besoin et les préférences
// sous forme de MODÈLES ; c'est d'eux que sort la recherche :
//
//   RequirementModel + PreferenceModel
//        → ConstraintCompiler → LegacySearchAdapter → SearchParams → moteur
//
// Les anciens champs du formulaire ne sont plus une source : ce sont des
// MIROIRS. On continue de les écrire pour que les URLs partagées, les presets,
// l'historique et le panneau de comparaison gardent leur contrat ; et on sait
// les relire pour reconstruire une session à partir d'un lien ancien. Le jour
// où ces champs disparaîtront, seul ce fichier changera.
(function (GearApp) {
  'use strict';

  var R = GearApp.requirements;

  /** Champs historiques qui reflètent une grandeur du besoin. */
  var MIRRORS = [
    { path: 'input.speed', id: 'vitesse_entree' },
    { path: 'input.torque', id: 'couple_entree' },
    { path: 'output.speed', id: 'rpm_sortie_cible', min: 'rpm_sortie_min', max: 'rpm_sortie_max' },
    { path: 'output.torque', min: 'minimum_output_torque' },
    { path: 'output.force', min: 'linear_force_min' },
    { path: 'output.travelPerRev', id: 'linear_travel_per_rev' },
    { path: 'output.linearSpeed', min: 'linear_speed_min', max: 'linear_speed_max' },
    { path: 'ratio', id: 'rapport' }
  ];

  /** Préférences qui reflètent une contrainte historique. */
  var CONSTRAINT_MIRRORS = {
    maxDiameter: { max: 'max_diameter' },
    maxLength: { max: 'max_length' },
    maxWidth: { max: 'max_width' },
    efficiency: { min: 'minimum_efficiency', scale: 0.01 },
    bendingSafety: { min: 'minimum_bending_safety' },
    contactSafety: { min: 'minimum_contact_safety' },
    stages: { max: 'etages' }
  };

  function el(id) { return document.getElementById(id); }

  function write(id, value) {
    var node = el(id);
    if (!node) return;
    var next = value == null ? '' : String(round(value));
    if (node.value !== next) node.value = next;
  }

  function read(id) {
    var node = el(id);
    if (!node) return null;
    var raw = String(node.value).trim();
    if (raw === '') return null;
    var parsed = Number(raw);
    return isFinite(parsed) ? parsed : null;
  }

  function round(value) {
    return typeof value === 'number' ? Math.round(value * 10000) / 10000 : value;
  }

  function SearchSession() {
    this.requirement = new R.RequirementModel({ input: { speed: 1500, torque: 10 }, ratio: 12 });
    this.preferences = new R.PreferenceModel();
    this.technologyMode = 'auto';       // auto = le conseiller décide
    this.technologies = [];             // sélection manuelle éventuelle
    this._advice = null;
  }

  // ===== Lecture du conseiller, mémorisée par état =====

  SearchSession.prototype.advice = function () {
    var key = JSON.stringify([this.requirement.toJSON(), this.preferences.toJSON()]);
    if (!this._advice || this._advice.key !== key) {
      this._advice = { key: key, value: R.TransmissionAdvisor.advise(this.requirement, this.preferences) };
    }
    return this._advice.value;
  };

  SearchSession.prototype.selectedTechnologies = function () {
    if (this.technologyMode === 'manual' && this.technologies.length) return this.technologies.slice();
    return this.advice().selection.slice();
  };

  // ===== Vers le moteur =====

  SearchSession.prototype.compile = function (overrides) {
    var options = Object.assign({ advice: this.advice(), technologies: this.selectedTechnologies() }, overrides || {});
    return R.ConstraintCompiler.compile(this.requirement, options.preferences || this.preferences, options);
  };

  /**
   * Réglages purement techniques, toujours lus dans le formulaire avancé :
   * ils n'appartiennent pas au besoin et n'ont pas encore été redistribués
   * auprès des objets qu'ils modifient (choix 7C, reporté).
   */
  SearchSession.prototype.technical = function () {
    var settings = {};
    var legacy = GearApp.models.SearchParams.fromForm();
    ['dentMenanteMin', 'dentMenanteMax', 'dentMeneeMin', 'dentMeneeMax', 'dentMenanteFixe', 'dentMeneeFixe',
      'maxSolutions', 'maxIterations', 'module', 'moduleMode', 'moduleMin', 'moduleMax', 'reductionOnly',
      'typeParameters', 'typeTemplate', 'inputMaterial', 'outputMaterial', 'additiveDerating',
      'manufacturing', 'fatigue', 'shaft'].forEach(function (key) {
      if (legacy[key] !== undefined) settings[key] = legacy[key];
    });
    return settings;
  };

  SearchSession.prototype.toSearchParams = function (overrides) {
    var request = this.compile(overrides);
    var params = R.LegacySearchAdapter.toSearchParams(request, this.technical(), GearApp.models.SearchParams);
    params.requestNotes = request.notes;
    return params;
  };

  // ===== Miroirs : la session écrit le formulaire, jamais l'inverse pendant la saisie =====

  SearchSession.prototype.syncToForm = function () {
    var self = this;
    MIRRORS.forEach(function (mirror) {
      var quantity = self.requirement.get(mirror.path), bounds = quantity.bounds();
      if (mirror.id) write(mirror.id, quantity.isKnown() ? quantity.nominal() : null);
      if (mirror.min) write(mirror.min, quantity.isKnown() ? bounds.min : null);
      if (mirror.max) write(mirror.max, quantity.isKnown() ? bounds.max : null);
    });
    Object.keys(CONSTRAINT_MIRRORS).forEach(function (key) {
      var mirror = CONSTRAINT_MIRRORS[key], entry = self.preferences.get(key);
      var known = entry.isKnown() && !entry.soft, bounds = entry.bounds();
      var scale = mirror.scale || 1;
      if (mirror.min) write(mirror.min, known && bounds.min != null ? bounds.min * scale : null);
      if (mirror.max) write(mirror.max, known && bounds.max != null ? bounds.max * scale : null);
    });
    var mode = el('objective_mode');
    if (mode) mode.value = this.requirement.inferProblem().mode || 'ratio';
    var searchMode = el('search_mode');
    if (searchMode) searchMode.value = this.preferences.searchMode();
    var weights = this.preferences.weights();
    Object.keys(weights).forEach(function (key) { write('weight_' + key, weights[key]); });
    this.syncTypeCheckboxes();
  };

  // Le registre expose l'épicycloïdal sous deux noms ; la case porte l'alias
  // historique, le conseiller le nom canonique.
  function aliasType(id) { return id === 'epicyclic' ? 'planetary' : id; }

  SearchSession.prototype.syncTypeCheckboxes = function () {
    var selected = this.selectedTechnologies().map(aliasType);
    Array.prototype.forEach.call(document.querySelectorAll('.type-checkbox'), function (box) {
      box.checked = selected.indexOf(aliasType(box.value)) !== -1;
    });
  };

  /**
   * Reconstruit la session depuis les champs historiques. C'est ce qui fait
   * qu'une URL partagée ou un preset d'avant la refonte redevient un besoin
   * modélisé, sans code de migration dédié.
   */
  SearchSession.prototype.adoptForm = function (restored) {
    var Quantity = R.Quantity, requirement = new R.RequirementModel();
    var mode = (el('objective_mode') || {}).value || 'ratio';

    requirement.set('input.speed', quantityFrom('vitesse_entree'));
    requirement.set('input.torque', quantityFrom('couple_entree'));

    if (mode === 'rotationTranslation') {
      requirement.set('output.travelPerRev', quantityFrom('linear_travel_per_rev'));
      requirement.set('output.force', bounded('linear_force_min', null));
      requirement.set('output.linearSpeed', bounded('linear_speed_min', 'linear_speed_max'));
    } else {
      var speed = bounded('rpm_sortie_min', 'rpm_sortie_max');
      if (!speed.isKnown() && mode === 'need') speed = quantityFrom('rpm_sortie_cible');
      requirement.set('output.speed', speed);
      requirement.set('output.torque', bounded('minimum_output_torque', null));
      if (mode === 'ratio') requirement.set('ratio', quantityFrom('rapport'));
    }
    // Un besoin sans rien d'exploitable retombe sur le rapport affiché.
    if (!requirement.inferProblem().mode) requirement.set('ratio', quantityFrom('rapport'));
    this.requirement = requirement;

    var preferences = new R.PreferenceModel();
    Object.keys(CONSTRAINT_MIRRORS).forEach(function (key) {
      var mirror = CONSTRAINT_MIRRORS[key], scale = mirror.scale || 1;
      var min = mirror.min ? read(mirror.min) : null, max = mirror.max ? read(mirror.max) : null;
      if (key === 'stages' && max === 4) return;      // le réglage d'usine n'est pas une contrainte
      if (min != null && max != null) preferences.require(key, Quantity.between(min / scale, max / scale));
      else if (min != null) preferences.require(key, Quantity.atLeast(min / scale));
      else if (max != null) preferences.require(key, Quantity.atMost(max / scale));
    });
    preferences.primary = axisForSearchMode((el('search_mode') || {}).value);
    this.preferences = preferences;

    var checked = Array.prototype.map.call(document.querySelectorAll('.type-checkbox:checked'), function (b) { return aliasType(b.value); });
    this._advice = null;
    // Au premier chargement les cases portent leur valeur d'usine, pas un choix :
    // les prendre pour une décision manuelle désactiverait le conseiller d'entrée.
    if (restored && checked.length && !sameSet(checked, this.advice().selection.map(aliasType))) {
      this.technologyMode = 'manual';
      this.technologies = checked;
    } else {
      this.technologyMode = 'auto';
      this.technologies = [];
    }
    return this;
  };

  function quantityFrom(id) {
    var value = read(id);
    return value == null ? R.Quantity.unknown() : R.Quantity.exact(value);
  }

  function bounded(minId, maxId) {
    var min = minId ? read(minId) : null, max = maxId ? read(maxId) : null;
    if (min != null && max != null) return R.Quantity.between(min, max);
    if (min != null) return R.Quantity.atLeast(min);
    if (max != null) return R.Quantity.atMost(max);
    return R.Quantity.unknown();
  }

  function axisForSearchMode(mode) {
    var axes = GearApp.requirements.preferences.AXES;
    for (var i = 0; i < axes.length; i++) if (axes[i].searchMode === mode) return axes[i].id;
    return 'balanced';
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var sortedA = a.slice().sort().join('|'), sortedB = b.slice().sort().join('|');
    return sortedA === sortedB;
  }

  SearchSession.prototype.diagnose = function () {
    var notes = this.requirement.diagnose().slice();
    this.advice().coverage.forEach(function (gap) { notes.push({ level: 'warn', code: gap.code, text: gap.text }); });
    var count = this.selectedTechnologies().length;
    if (count) notes.push({ level: 'ok', code: 'technologies', text: count + (count > 1 ? ' technologies compatibles.' : ' technologie compatible.') });
    return notes;
  };

  SearchSession.prototype.isReady = function () {
    return this.requirement.isComplete() && this.selectedTechnologies().length > 0;
  };

  GearApp.ui.SearchSession = SearchSession;
  SearchSession.MIRRORS = MIRRORS;
  SearchSession.CONSTRAINT_MIRRORS = CONSTRAINT_MIRRORS;

})(GearApp);
