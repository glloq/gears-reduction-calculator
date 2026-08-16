// SearchSession.js - L'état d'un projet, et la seule route vers le moteur.
//
// La session porte des modèles, et rien d'autre :
//
//   SearchIntentModel         ce qu'on demande au solveur de TROUVER
//   RequirementModel          ce que l'utilisateur a et veut
//   PreferenceModel           ce qui filtre, ce qui classe
//   TechnologySelectionModel  comment il veut choisir les familles
//   TechnicalSettingsModel    les réglages qui ne relèvent pas du besoin
//   ExistingReducer           la machine dont il part, quand il en a une
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

  /**
   * Réglages techniques reflétés par l'ancien formulaire. Sans eux, choisir
   * une profondeur « Exhaustive » ou un module imposé restait invisible pour
   * tout ce qui relit encore les champs : le panneau de comparaison et l'URL
   * partagée repartaient sur les valeurs d'usine.
   */
  var TECHNICAL_MIRRORS = [
    { id: 'max_solutions', group: 'search', key: 'maxSolutions' },
    { id: 'max_iterations', group: 'search', key: 'maxIterations' },
    { id: 'dent_menante_fixe', group: 'gearing', key: 'drivingFixed', nullable: true },
    { id: 'dent_menee_fixe', group: 'gearing', key: 'drivenFixed', nullable: true },
    { id: 'reduction_only', group: 'gearing', key: 'reductionOnly', kind: 'flag' },
    { id: 'module', group: 'module', key: 'fixed' },
    { id: 'module_mode', group: 'module', key: 'mode', kind: 'text' },
    { id: 'module_min', group: 'module', key: 'min', nullable: true },
    { id: 'module_max', group: 'module', key: 'max', nullable: true },
    { id: 'input_material', group: 'materials', key: 'input', kind: 'text' },
    { id: 'output_material', group: 'materials', key: 'output', kind: 'text' },
    { id: 'teeth_inventory', group: 'gearing', key: 'teethInventory', kind: 'list' },
    { id: 'module_list', group: 'module', key: 'list', kind: 'list' },
    { id: 'support_distance', group: 'shaft', key: 'supportDistanceMm', nullable: true },
    { id: 'shaft_allowable_shear', group: 'shaft', key: 'allowableShearMPa' },
    { id: 'manufacturing_mode', group: 'manufacturing', key: 'process', kind: 'text' },
    { id: 'manufacturing_min_module', group: 'manufacturing', key: 'minimumModule', nullable: true },
    { id: 'manufacturing_min_teeth', group: 'manufacturing', key: 'minimumTeeth', nullable: true },
    { id: 'manufacturing_min_width', group: 'manufacturing', key: 'minimumFaceWidth', nullable: true },
    { id: 'printer_diameter', group: 'manufacturing', key: 'printerDiameter', nullable: true },
    { id: 'additive_derating', group: 'manufacturing', key: 'additiveDerating' },
    { id: 'fatigue_enabled', group: 'fatigue', key: 'enabled', kind: 'flag' },
    { id: 'hours_per_day', group: 'fatigue', key: 'hoursPerDay' },
    { id: 'days_per_year', group: 'fatigue', key: 'daysPerYear' },
    { id: 'service_years', group: 'fatigue', key: 'years' },
    { id: 'load_type', group: 'fatigue', key: 'loadType', kind: 'text' }
  ];

  /** Les bornes de dentures sont portées par un curseur : des textes, pas des champs. */
  var TEETH_READOUTS = [
    { id: 'val_menante_min', key: 'drivingMin' },
    { id: 'val_menante_max', key: 'drivingMax' },
    { id: 'val_menee_min', key: 'drivenMin' },
    { id: 'val_menee_max', key: 'drivenMax' }
  ];

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

  function round1(value) {
    return typeof value === 'number' && isFinite(value) ? Math.round(value * 10) / 10 : value;
  }

  /** « 16, 20 24 » vaut [16, 20, 24] : un inventaire se saisit comme on le dit. */
  function numberList(text) {
    return String(text || '').split(/[^0-9.]+/)
      .map(function (piece) { return parseFloat(piece); })
      .filter(function (value) { return isFinite(value) && value > 0; });
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
    this.existing = new R.ExistingReducer(seed.existing || {});
    // Grandeurs MONTRÉES mais pas encore renseignées. Ajouter « Rapport » doit
    // ouvrir une ligne vide, pas poser 12:1 : une valeur que l'utilisateur n'a
    // pas choisie ne doit jamais dimensionner son réducteur en silence (§21).
    this.revealed = (seed.revealed || []).slice();
    this._advice = null;
  }

  /** Montre une grandeur sans rien y écrire. */
  SearchSession.prototype.reveal = function (path) {
    if (this.revealed.indexOf(path) === -1) this.revealed.push(path);
    return this;
  };

  SearchSession.prototype.conceal = function (path) {
    var at = this.revealed.indexOf(path);
    if (at !== -1) this.revealed.splice(at, 1);
    return this;
  };

  SearchSession.prototype.isRevealed = function (path) {
    return this.revealed.indexOf(path) !== -1;
  };

  /**
   * Options d'ingénierie du besoin courant, pour analyser une chaîne décrite à
   * la main. Le réducteur existant DOIT être mesuré avec les mêmes hypothèses
   * que ses remplaçants, sinon la comparaison compare deux mondes.
   */
  SearchSession.prototype.engineeringOptions = function () {
    var torque = this.requirement.inputTorqueRequirement().nominal();
    return {
      inputSpeedRpm: this.requirement.input.speed.nominal() || 1500,
      inputTorqueNm: torque == null ? 10 : torque,
      inputMaterial: this.technical.materials.input,
      outputMaterial: this.technical.materials.output,
      additiveDerating: this.technical.manufacturing.additiveDerating,
      weights: this.preferences.weights(),
      fatigue: this.technical.fatigue,
      shaft: this.technical.shaft
    };
  };

  /**
   * Cette recherche part-elle de composants déjà possédés ? C'est une
   * DÉDUCTION, plus une case à cocher : saisir « dentures 16, 20, 40 » ou un
   * pignon imposé, c'est déjà dire qu'on cherche dans son stock. Demander en
   * plus « souhaitez-vous partir de vos pièces ? » ferait répéter le geste.
   */
  SearchSession.prototype.usesParts = function () {
    var gearing = this.technical.gearing, module = this.technical.module;
    return (gearing.teethInventory || []).length > 0 ||
      (module.list || []).length > 0 ||
      gearing.drivingFixed != null || gearing.drivenFixed != null ||
      this.technical.isCustomised('gearing') || this.technical.isCustomised('module');
  };

  /** Le réducteur existant, analysé — la référence de toute comparaison. */
  SearchSession.prototype.baseline = function () {
    if (!this.intent.improves() || !this.existing.isDescribed()) return null;
    return this.existing.analyze(this.engineeringOptions());
  };

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
    // Améliorer l'existant, c'est chercher à RAPPORT ÉGAL : le rapport n'est
    // pas une exigence à saisir, il est déjà dans la machine qu'on décrit.
    if (this.intent.improves() && request.ratio == null) {
      var existingRatio = this.existing.ratio();
      if (existingRatio) request.ratio = existingRatio;
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

  /**
   * L'espace de rapports à balayer quand aucune cible n'est visée. Il vient de
   * ce que l'utilisateur a dit — « rapport 10 → 60 » — et à défaut d'une plage
   * annoncée, jamais devinée en silence : le modal l'affiche et il est
   * modifiable comme n'importe quelle grandeur.
   */
  SearchSession.prototype.explorationSpan = function () {
    var Planner = R.ExplorationPlanner, fallback = R.searchIntent.DEFAULT_SPAN;
    var ratio = this.requirement.ratioRequirement();
    if (ratio.isKnown()) {
      var bounds = ratio.bounds();
      var min = bounds.min != null ? Math.abs(bounds.min) : null;
      var max = bounds.max != null ? Math.abs(bounds.max) : null;
      if (min != null || max != null) {
        return {
          min: min != null ? min : Math.max(Planner.MIN_RATIO, fallback.min),
          max: max != null ? max : Math.max(fallback.max, (min || 1) * 10),
          stated: true
        };
      }
    }
    return { min: fallback.min, max: fallback.max, stated: false };
  };

  /**
   * Le plan d'exploration, ou null si la méthode vise un rapport. Chaque entrée
   * est une recherche ordinaire : c'est leur réunion qui décrit l'espace.
   */
  SearchSession.prototype.explorationPlan = function (overrides) {
    if (!this.intent.explores()) return null;
    var span = this.explorationSpan();
    var target = this.intent.objectiveDescriptor();
    return {
      span: span,
      objective: this.intent.objective,
      sort: target ? target.sort : 'score',
      runs: R.ExplorationPlanner.plan(this.toSearchParams(overrides), span)
    };
  };

  /**
   * Tri du vivier imposé par la méthode, ou null pour le classement habituel.
   * Une exploration comme une amélioration poursuivent une performance :
   * « recommandé » répondrait à une autre question que celle qui a été posée.
   */
  SearchSession.prototype.poolSort = function () {
    if (this.intent.explores()) {
      var target = this.intent.objectiveDescriptor();
      return target ? target.sort : null;
    }
    if (this.intent.improves()) {
      var wanted = R.existingReducer.goal(this.existing.goal);
      return wanted ? wanted.sort : null;
    }
    return null;
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

    // Une exploration se passe de rapport visé : la bande en fournit un. Une
    // amélioration le tire du réducteur décrit. Dans les deux cas la géométrie
    // est calculable, et prétendre le contraire découragerait à tort.
    if (this.intent.explores() || (this.intent.improves() && this.existing.ratio())) {
      problem = { mode: problem.mode || 'ratio', reason: problem.reason };
    }

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
    if (this.intent.explores()) {
      var span = this.explorationSpan();
      // « Il manque de quoi déterminer le rapport » est vrai, et sans objet :
      // ne pas fixer le rapport EST la méthode choisie.
      notes = notes.filter(function (note) { return note.code !== 'no-problem'; });
      notes.unshift({ level: 'ok', code: 'exploration',
        text: 'Espace exploré : rapports ' + round(span.min) + ' à ' + round(span.max) + ':1' +
          (span.stated ? '' : ' (plage par défaut, modifiable dans le besoin)') + '.' });
    }
    if (this.intent.improves()) {
      notes = notes.filter(function (note) { return note.code !== 'no-problem'; });
      var described = this.existing.describe();
      if (!described) {
        notes.unshift({ level: 'error', code: 'no-existing', text: 'Décrivez le réducteur que vous avez : au moins un étage.' });
      } else {
        this.existing.errors().forEach(function (entry) {
          notes.push({ level: 'error', code: 'existing-stage', text: 'Étage ' + entry.stage + ' : ' + entry.text });
        });
        var reference = this.baseline();
        notes.unshift({ level: reference ? 'ok' : 'warn', code: 'existing',
          text: reference
            ? 'Réducteur actuel : ' + described + ', Ø ' + Math.round(reference.dimensions.maxDiameter) +
              ' mm, rendement ' + Math.round(reference.efficiency * 100) + ' %.'
            : 'Réducteur actuel : ' + described + ' (non analysable en l’état).' });
      }
    }
    if (this.intent.explores()) {
      if (this.intent.objective === 'torque' && !this.requirement.inputTorqueRequirement().isKnown()) {
        // Le couple de sortie est proportionnel au couple d'entrée : le
        // CLASSEMENT reste juste sans lui, seules les valeurs sont arbitraires.
        notes.push({ level: 'warn', code: 'assumed-input-torque',
          text: 'Sans couple ni puissance d’entrée, le classement reste valable mais les couples affichés sont indicatifs.' });
      }
    }
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
    // Une exploration n'a pas de rapport à déterminer : c'est tout son objet.
    // Exiger un besoin « complet » lui interdirait de démarrer. Une
    // amélioration, elle, tire son rapport du réducteur décrit.
    var need = this.intent.explores() ? true
      : this.intent.improves() ? (!!this.existing.ratio() && !this.existing.errors().length)
      : this.requirement.isComplete();
    return need && this.technologySelection.isComplete() && this.selectedTechnologies().length > 0;
  };

  /**
   * Le cahier des charges par sections (§14). Chaque entrée n'apparaît que si
   * elle a quelque chose à dire : un résumé qui liste des rubriques vides
   * n'informe pas, il occupe.
   */
  SearchSession.prototype.brief = function () {
    var requirement = this.requirement, sections = [];
    var names = {};
    Object.keys(R.TransmissionAdvisor.KNOWLEDGE).forEach(function (id) {
      names[id] = R.TransmissionAdvisor.KNOWLEDGE[id].name;
    });

    function section(title, lines) {
      var kept = lines.filter(Boolean);
      if (kept.length) sections.push({ title: title, lines: kept });
    }

    section('Méthode', [this.intent.descriptor().icon + ' ' + this.intent.describe()]);

    var explored = this.selectedTechnologies();
    section('Technologies', [
      this.technologySelection.describe(names),
      explored.length + (explored.length > 1 ? ' familles explorées' : ' famille explorée')
    ]);

    // `describe()` porte déjà l'unité de la grandeur : la répéter donnerait
    // « = 1500 rpm rpm ».
    function say(quantity, suffix) {
      return quantity.isKnown() ? quantity.describe() + (suffix ? ' ' + suffix : '') : null;
    }

    section('Entrée', [
      say(requirement.input.speed),
      say(requirement.input.power),
      requirement.input.torque.isKnown()
        ? say(requirement.input.torque)
        : say(requirement.inputTorqueRequirement(), 'calculés')
    ]);

    var ratio = requirement.ratioRequirement();
    section('Sortie', [
      say(requirement.output.speed),
      say(requirement.output.torque),
      say(requirement.output.force),
      say(requirement.output.travelPerRev, 'par tour'),
      ratio.isKnown() ? 'rapport ' + ratio.describe() : null
    ]);

    if (this.intent.explores()) {
      var span = this.explorationSpan(), target = this.intent.objectiveDescriptor();
      section('Exploration', [
        'maximiser : ' + target.label.toLowerCase(),
        'rapports ' + round(span.min) + ' à ' + round(span.max) + ':1' + (span.stated ? '' : ' (par défaut)'),
        R.ExplorationPlanner.bands(span.min, span.max).length + ' bandes balayées'
      ]);
    }

    if (this.intent.improves() && this.existing.isDescribed()) {
      var reference = this.baseline();
      var wanted = R.existingReducer.goal(this.existing.goal);
      section('Réducteur actuel', [
        this.existing.describe(),
        reference ? 'Ø ' + Math.round(reference.dimensions.maxDiameter) + ' mm, rendement ' +
          Math.round(reference.efficiency * 100) + ' %, ' + round1(reference.outputTorqueNm) + ' N·m' : null,
        wanted ? 'objectif : ' + wanted.label.toLowerCase() : null
      ]);
    }

    section('Contraintes', this.effectivePreferences().constraints().map(function (entry) {
      return entry.meta.label + ' ' + entry.quantity.describe();
    }));

    var axes = this.preferences.activeAxes();
    section('Optimisation', axes.map(function (axis, index) { return (index + 1) + '. ' + axis.label; }));

    var teeth = this.technical.gearing.teethInventory || [];
    var modules = this.technical.module.list || [];
    section('Composants', [
      teeth.length ? teeth.length + ' dentures en stock : ' + teeth.join(', ') : null,
      modules.length ? 'modules : ' + modules.join(', ') : null
    ]);

    var depth = this.technical.depth();
    section('Recherche', [
      depth ? depth.label : this.technical.search.maxSolutions + ' solutions au plus',
      'jusqu’à ' + this.compile().maxStages + ' étages'
    ]);

    // Les niveaux d'analyse ne sont PAS repris ici : le résumé les affiche
    // déjà, en clair et avec ce qui leur manque (§23). Les répéter en version
    // appauvrie n'ajoutait rien et allongeait la colonne.
    return sections;
  };

  /** Résumé d'une ligne du cahier des charges, pour le bandeau (§16). */
  SearchSession.prototype.summarise = function () {
    var requirement = this.requirement, bits = [this.intent.describe()];
    var problem = requirement.inferProblem();
    // `describe()` porte déjà l'unité : la répéter donnait « 1500 rpm rpm ».
    if (problem.mode === 'rotationTranslation') {
      var travel = requirement.travelRequirement();
      if (travel.isKnown()) bits.push(travel.describe() + ' par tour');
      if (requirement.output.force.isKnown()) bits.push('Force ' + requirement.output.force.describe());
    } else {
      if (requirement.input.speed.isKnown() && requirement.output.speed.isKnown()) {
        bits.push(requirement.input.speed.describe() + ' → ' + requirement.output.speed.describe());
      } else {
        var ratio = requirement.ratioRequirement();
        if (ratio.isKnown()) bits.push(ratio.describe());
      }
      if (requirement.output.torque.isKnown()) bits.push('Couple ' + requirement.output.torque.describe());
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
      technical: this.technical.toJSON(),
      existing: this.existing.toJSON(),
      revealed: this.revealed.slice()
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
    this.existing = draft.existing;
    this.revealed = draft.revealed;
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
    TECHNICAL_MIRRORS.forEach(function (mirror) {
      var node = el(mirror.id);
      if (!node) return;
      var value = self.technical[mirror.group][mirror.key];
      if (mirror.kind === 'flag') node.checked = !!value;
      else if (mirror.kind === 'list') node.value = (value || []).join(', ');
      else if (mirror.kind === 'text') { if (value != null) node.value = String(value); }
      else write(mirror.id, value);
    });
    TEETH_READOUTS.forEach(function (readout) {
      var node = el(readout.id);
      if (node) node.textContent = String(self.technical.gearing[readout.key]);
    });
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

    // Les réglages techniques font le même chemin retour : une URL partagée
    // porte le module, la profondeur et les dentures, pas seulement le besoin.
    var technical = new R.TechnicalSettingsModel();
    TECHNICAL_MIRRORS.forEach(function (mirror) {
      var node = el(mirror.id);
      if (!node) return;
      if (mirror.kind === 'flag') { technical.set(mirror.group, mirror.key, !!node.checked); return; }
      if (mirror.kind === 'list') { technical.set(mirror.group, mirror.key, numberList(node.value)); return; }
      if (mirror.kind === 'text') { if (node.value) technical.set(mirror.group, mirror.key, node.value); return; }
      var value = read(mirror.id);
      // Un champ vide ne veut dire « aucune valeur » que là où c'est un choix
      // possible : ailleurs, il ne doit pas effacer le réglage d'usine.
      if (value != null || mirror.nullable) technical.set(mirror.group, mirror.key, value);
    });
    TEETH_READOUTS.forEach(function (readout) {
      var node = el(readout.id), value = node ? Number(node.textContent) : NaN;
      if (isFinite(value)) technical.set('gearing', readout.key, value);
    });
    Object.keys(technical.typeParameters).forEach(function (typeId) {
      Object.keys(technical.typeParameters[typeId]).forEach(function (key) {
        var node = el('tp_' + typeId + '_' + key);
        if (!node) return;
        if (node.type === 'checkbox') technical.setTypeParameter(typeId, key, node.checked);
        else if (node.value !== '') {
          var number = Number(node.value);
          technical.setTypeParameter(typeId, key, isFinite(number) && node.type !== 'text' ? number : node.value);
        }
      });
    });
    this.technical = technical;

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
