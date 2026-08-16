// SearchSession.js - L'état d'un projet, et la seule route vers le moteur.
//
// La session porte quatre modèles et rien d'autre :
//
//   RequirementModel          ce que l'utilisateur a et veut
//   PreferenceModel           ce qui filtre, ce qui classe
//   TechnologySelectionModel  comment il veut choisir les familles
//   TechnicalSettingsModel    les réglages qui ne relèvent pas du besoin
//
//        → ConstraintCompiler → LegacySearchAdapter → SearchParams → moteur
//
// Les anciens champs du formulaire ne sont plus lus pendant la saisie : ce sont
// des MIROIRS, écrits par la session pour que les URLs partagées, les presets,
// l'historique et le panneau de comparaison gardent leur contrat.
//
// §18 : l'édition ne se fait jamais sur la session affichée. Le modal travaille
// sur un CLONE ; annuler le jette, chercher le promeut. Sans cela une simple
// édition abandonnée rendrait incohérents les résultats, le viewer, les chips,
// les exports et l'URL partagée.
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
    var next = value == null ? '' : String(typeof value === 'number' ? round(value) : value);
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

  /**
   * §21 : une nouvelle recherche est VIDE. Les anciennes valeurs d'usine
   * (1500 rpm, 10 N·m, rapport 12) dimensionnaient réellement les solutions
   * sans que personne ne les ait choisies ; seuls des exemples explicites, ou
   * l'utilisateur, peuvent désormais les poser.
   */
  function SearchSession(seed) {
    seed = seed || {};
    this.requirement = new R.RequirementModel(seed.requirement || {});
    this.preferences = new R.PreferenceModel(seed.preferences || {});
    this.intent = new R.SearchIntentModel(seed.intent || {});
    this.technologySelection = new R.TechnologySelectionModel(seed.technologySelection || {});
    this.technical = new R.TechnicalSettingsModel(seed.technical || {});
    this._advice = null;
  }

  // ===== Conseiller, mémorisé par état =====

  SearchSession.prototype.advice = function () {
    var key = JSON.stringify([this.requirement.toJSON(), this.preferences.toJSON()]);
    if (!this._advice || this._advice.key !== key) {
      this._advice = { key: key, value: R.TransmissionAdvisor.advise(this.requirement, this.preferences) };
    }
    return this._advice.value;
  };

  SearchSession.prototype.invalidate = function () { this._advice = null; return this; };

  /** L'univers permis par le problème courant : rotatif ou linéaire, jamais les deux. */
  SearchSession.prototype.universe = function () {
    return this.requirement.inferProblem().mode === 'rotationTranslation'
      ? ['rack'] : R.TransmissionAdvisor.ROTARY.slice();
  };

  /** L'univers moins ce que le conseiller a formellement écarté. */
  SearchSession.prototype.compatibleTechnologies = function () {
    var universe = this.universe();
    var excluded = this.advice().excluded.map(function (entry) { return entry.id; });
    var compatible = universe.filter(function (id) { return excluded.indexOf(id) === -1; });
    return compatible.length ? compatible : universe;
  };

  SearchSession.prototype.selectedTechnologies = function () {
    var universe = this.compatibleTechnologies();
    var resolved = this.technologySelection.resolve(this.advice().ranking, universe);
    // Une politique ne peut pas faire sortir de l'univers du problème.
    var allowed = resolved.filter(function (id) { return universe.indexOf(id) !== -1; });
    return allowed.length ? allowed : universe.slice(0, 1);
  };

  // ===== Vers le moteur =====

  SearchSession.prototype.compile = function (overrides) {
    var options = Object.assign({
      advice: this.advice(),
      technologies: this.selectedTechnologies()
    }, overrides || {});
    var request = R.ConstraintCompiler.compile(this.requirement, options.preferences || this.effectivePreferences(), options);
    // Une architecture imposée fixe aussi le nombre d'étages : le laisser à
    // « 4 par défaut » ferait chercher des trains que l'utilisateur a exclus.
    var imposed = this.technologySelection.stagesRequired();
    if (imposed) request.maxStages = imposed;
    // La méthode fixe la largeur de la fenêtre de rapport : « le meilleur
    // compromis » n'a pas de sens à 0,1 % près, et une cible n'en a pas à 5 %.
    // Une intention explicite sur la grandeur (« ≈ 12 ± 2 % ») reste prioritaire.
    var tolerance = this.intent.ratioTolerance();
    if (tolerance != null && !this.requirement.ratio.isKnown()) {
      request.ratioTolerancePercent = Math.max(request.ratioTolerancePercent, tolerance);
    }
    return request;
  };

  /**
   * §20 : le sens de rotation demandé n'est pas un décor. Le moteur ne sait pas
   * filtrer dessus, alors la session le pose en contrainte côté client — et une
   * contrainte qu'on ne peut pas traduire est APPLIQUÉE, jamais oubliée.
   */
  SearchSession.prototype.effectivePreferences = function () {
    var wanted = this.requirement.architecture.direction;
    if (wanted !== 'same' && wanted !== 'reverse') return this.preferences;
    var preferences = new R.PreferenceModel(this.preferences.toJSON());
    preferences.require('outputDirection', R.Quantity.exact(wanted === 'same' ? 1 : -1));
    return preferences;
  };

  /**
   * Écarte ce que le moteur ne pouvait pas écarter lui-même. Sans ce filtre,
   * demander une sortie tournant dans le même sens n'aurait aucun effet visible.
   */
  SearchSession.prototype.filterPool = function (solutions) {
    var preferences = this.effectivePreferences();
    var client = preferences.clientConstraints();
    if (!client.length) return solutions || [];
    return (solutions || []).filter(function (solution) {
      return client.every(function (entry) {
        var value = entry.meta.metric(solution);
        if (value == null) return true;              // non évalué : on n'invente pas
        if (entry.meta.scale) value *= entry.meta.scale;
        return entry.quantity.satisfies(value);
      });
    });
  };

  SearchSession.prototype.toSearchParams = function (overrides) {
    var request = this.compile(overrides);
    var settings = this.technical.toAdapterSettings();
    settings.typeTemplate = this.technologySelection.toTemplate();
    var params = R.LegacySearchAdapter.toSearchParams(request, settings, GearApp.models.SearchParams);
    params.requestNotes = request.notes;
    return params;
  };

  // ===== Niveau d'analyse disponible (§7) =====
  //
  // On n'oblige jamais à tout remplir : on dit ce qui sera calculable, et ce
  // qui manque pour aller plus loin.

  SearchSession.prototype.analysisLevels = function () {
    var requirement = this.requirement, technical = this.technical;
    var problem = requirement.inferProblem();
    var levels = [];

    levels.push({ id: 'geometry', label: 'Géométrie et rapport', available: !!problem.mode,
      missing: problem.mode ? null : 'besoin incomplet' });
    levels.push({ id: 'kinematics', label: 'Cinématique', available: !!problem.mode && requirement.input.speed.isKnown(),
      missing: requirement.input.speed.isKnown() ? null : 'vitesse d’entrée manquante' });
    // Le couple peut venir de la puissance : c'est lui qui compte, pas le champ.
    var torque = requirement.inputTorqueRequirement().isKnown();
    levels.push({ id: 'forces', label: 'Efforts mécaniques', available: torque,
      missing: torque ? null : 'couple ou puissance d’entrée manquant' });
    levels.push({ id: 'strength', label: 'Résistance', available: torque && technical.isCustomised('materials'),
      missing: !torque ? 'couple ou puissance d’entrée manquant'
        : technical.isCustomised('materials') ? null : 'matériaux laissés par défaut' });
    levels.push({ id: 'fatigue', label: 'Fatigue', available: technical.fatigue.enabled && torque,
      missing: technical.fatigue.enabled ? (torque ? null : 'couple ou puissance d’entrée manquant') : 'cycle de service non renseigné' });
    return levels;
  };

  SearchSession.prototype.diagnose = function () {
    var notes = this.requirement.diagnose().slice();
    if (this.technologySelection.policy === 'auto') {
      this.advice().coverage.forEach(function (gap) { notes.push({ level: 'warn', code: gap.code, text: gap.text }); });
    }
    if (!this.technologySelection.isComplete()) {
      notes.push({ level: 'error', code: 'no-technology', text: 'Choisissez au moins une famille de transmission.' });
    }
    var count = this.selectedTechnologies().length;
    if (count) notes.push({ level: 'ok', code: 'technologies', text: count + (count > 1 ? ' technologies explorées.' : ' technologie explorée.') });
    return notes;
  };

  SearchSession.prototype.isReady = function () {
    return this.requirement.isComplete() && this.technologySelection.isComplete() && this.selectedTechnologies().length > 0;
  };

  /** Résumé d'une ligne du cahier des charges, pour le bandeau (§16). */
  SearchSession.prototype.summarise = function () {
    var requirement = this.requirement, bits = [this.intent.describe()];
    var problem = requirement.inferProblem();
    if (problem.mode === 'rotationTranslation') {
      var travel = requirement.travelRequirement();
      if (travel.isKnown()) bits.push(travel.describe() + '/tr');
      if (requirement.output.force.isKnown()) bits.push('Force ' + requirement.output.force.describe() + ' N');
    } else {
      if (requirement.input.speed.isKnown() && requirement.output.speed.isKnown()) {
        bits.push(requirement.input.speed.describe() + ' → ' + requirement.output.speed.describe() + ' rpm');
      } else {
        var ratio = requirement.ratioRequirement();
        if (ratio.isKnown()) bits.push(ratio.describe());
      }
      if (requirement.output.torque.isKnown()) bits.push('Couple ' + requirement.output.torque.describe() + ' N·m');
    }
    var names = {};
    Object.keys(R.TransmissionAdvisor.KNOWLEDGE).forEach(function (id) {
      names[id] = R.TransmissionAdvisor.KNOWLEDGE[id].name;
    });
    bits.push(this.technologySelection.describe(names));
    this.preferences.constraints().forEach(function (entry) {
      bits.push(entry.meta.label + ' ' + entry.quantity.describe());
    });
    bits.push(this.preferences.describe());
    return bits.filter(Boolean);
  };

  // ===== Brouillon (§18) =====

  SearchSession.prototype.toJSON = function () {
    return {
      intent: this.intent.toJSON(),
      requirement: this.requirement.toJSON(),
      preferences: this.preferences.toJSON(),
      technologySelection: this.technologySelection.toJSON(),
      technical: this.technical.toJSON()
    };
  };

  /** Un clone indépendant : le modal l'édite sans toucher à la recherche affichée. */
  SearchSession.prototype.draft = function () { return new SearchSession(this.toJSON()); };

  /** Promotion du brouillon : la session adopte son contenu, en place. */
  SearchSession.prototype.adopt = function (draft) {
    this.intent = draft.intent;
    this.requirement = draft.requirement;
    this.preferences = draft.preferences;
    this.technologySelection = draft.technologySelection;
    this.technical = draft.technical;
    this._advice = null;
    return this;
  };

  SearchSession.prototype.isEmpty = function () {
    return !this.requirement.known().length;
  };

  // ===== Miroirs de compatibilité =====

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
    var template = el('type_template');
    if (template) template.value = JSON.stringify(this.technologySelection.toTemplate() || []);
    var parameters = this.technical.typeParameters;
    Object.keys(parameters).forEach(function (typeId) {
      Object.keys(parameters[typeId]).forEach(function (key) {
        var node = el('tp_' + typeId + '_' + key);
        if (!node) return;
        if (node.type === 'checkbox') node.checked = !!parameters[typeId][key];
        else write('tp_' + typeId + '_' + key, parameters[typeId][key]);
      });
    });
    this.syncTypeCheckboxes();
  };

  function aliasType(id) { return id === 'epicyclic' ? 'planetary' : id; }

  SearchSession.prototype.syncTypeCheckboxes = function () {
    var selected = this.selectedTechnologies().map(aliasType);
    Array.prototype.forEach.call(document.querySelectorAll('.type-checkbox'), function (box) {
      box.checked = selected.indexOf(aliasType(box.value)) !== -1;
    });
  };

  /**
   * Reconstruit la session depuis les champs historiques : c'est ce qui fait
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

    this._advice = null;
    var checked = Array.prototype.map.call(document.querySelectorAll('.type-checkbox:checked'), function (b) { return aliasType(b.value); });
    var selection = new R.TechnologySelectionModel();
    var templateRaw = (el('type_template') || {}).value;
    var parsedTemplate = null;
    if (templateRaw) { try { parsedTemplate = JSON.parse(templateRaw); } catch (ignore) { parsedTemplate = null; } }
    if (restored && Array.isArray(parsedTemplate) && parsedTemplate.length) {
      selection.setPolicy('template').merge({ template: parsedTemplate });
    } else if (restored && checked.length && !sameSet(checked, this.advice().selection.map(aliasType))) {
      // Une sélection portée par une URL est une décision ; les cases d'usine
      // du premier chargement n'en sont pas une.
      selection.setPolicy('restrict').merge({ families: checked });
    }
    this.technologySelection = selection;
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
    var axes = R.preferences.AXES;
    for (var i = 0; i < axes.length; i++) if (axes[i].searchMode === mode) return axes[i].id;
    return 'balanced';
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    return a.slice().sort().join('|') === b.slice().sort().join('|');
  }

  GearApp.ui.SearchSession = SearchSession;
  SearchSession.MIRRORS = MIRRORS;
  SearchSession.CONSTRAINT_MIRRORS = CONSTRAINT_MIRRORS;

})(GearApp);
