// SolutionExplorer.js - Propriétaire du vivier de solutions et de la barre
// d'affinage. La recherche remplit le vivier ; l'affinage filtre/trie côté
// client (GearSolutionFilter) sans jamais relancer le moteur.
//
// Contrat de sélection : toute vue transporte des paires {solution, index} où
// index est la position dans le vivier d'origine ; `solution:selected {index}`
// garde ce sens, index === -1 signifiant « hors vivier » (variante/épingle).
(function (GearApp) {
  'use strict';

  var TYPE_LABELS = {
    spur: 'Droit', helical: 'Hélicoïdal', internal: 'Intérieur', bevel: 'Conique',
    planetary: 'Épicycloïdal', epicyclic: 'Épicycloïdal', worm: 'Vis sans fin',
    belt: 'Courroie', chain: 'Chaîne', rack: 'Crémaillère'
  };

  var NUMERIC_FIELDS = [
    'refine_error_max', 'refine_efficiency_min', 'refine_sf_min', 'refine_sh_min',
    'refine_diameter_max', 'refine_length_max', 'refine_stages_max'
  ];

  function el(id) { return document.getElementById(id); }
  function optionalNumber(id) {
    var input = el(id);
    if (!input) return null;
    var raw = String(input.value).trim();
    if (raw === '') return null;
    var value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function SolutionExplorer(eventBus, refs) {
    this.bus = eventBus || GearApp.eventBus;
    this.workbench = refs.workbench;
    this.resultsTable = refs.resultsTable;
    this.ui = refs.uiController;
    this._pool = [];
    this._params = null;
    this._workerParams = null;
    this._stats = null;
    this._nextUid = 1;
    this._disabledTypes = {};
    this._debounce = null;
  }

  // Catalogue des filtres : mêmes chips que les contraintes de recherche, mais
  // appliqués au vivier déjà calculé — jamais de nouvelle recherche.
  var FILTERS = [
    { category: 'precision', field: 'refine_error_max', label: 'Écart ≤', name: 'écart maximum', unit: '%', suggest: 1, step: 0.01 },
    { category: 'performance', field: 'refine_efficiency_min', label: 'Rendement ≥', name: 'rendement minimum', unit: '%', suggest: 90 },
    { category: 'performance', field: 'refine_sf_min', label: 'SF ≥', name: 'facteur de sécurité en flexion minimum', unit: '', suggest: 1.5, step: 0.1 },
    { category: 'performance', field: 'refine_sh_min', label: 'SH ≥', name: 'facteur de sécurité au contact minimum', unit: '', suggest: 1.2, step: 0.1 },
    { category: 'dimensions', field: 'refine_diameter_max', label: 'Ø ≤', name: 'diamètre maximum', unit: 'mm', suggest: 80 },
    { category: 'dimensions', field: 'refine_length_max', label: 'Longueur ≤', name: 'longueur maximum', unit: 'mm', suggest: 150 },
    { category: 'architecture', field: 'refine_stages_max', label: 'Étages ≤', name: "nombre maximum d'étages", unit: '', suggest: 2 }
  ];
  var FILTER_CATEGORIES = [
    { id: 'precision', label: 'Précision' },
    { id: 'performance', label: 'Performance' },
    { id: 'dimensions', label: 'Dimensions' },
    { id: 'architecture', label: 'Architecture' }
  ];

  SolutionExplorer.prototype.bind = function () {
    var self = this;
    // Les filtres deviennent des chips : seuls les critères réellement posés
    // occupent de la place.
    this.filters = new GearConstraintManager.Manager({
      host: el('refineChips'),
      menu: el('refineMenu'),
      trigger: el('addFilterBtn'),
      catalog: FILTERS,
      categories: FILTER_CATEGORIES,
      sidebar: 'refineBar',
      onChange: function () { self._schedulePublish(); }
    }).bind();

    NUMERIC_FIELDS.forEach(function (id) {
      var input = el(id);
      if (!input) return;
      input.addEventListener('input', function () { self._schedulePublish(); });
    });
    var sort = el('refine_sort');
    if (sort) sort.addEventListener('change', function () { self._publish(false); });

    var chips = el('refineTypeChips');
    if (chips) {
      chips.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-type]');
        if (!chip) return;
        var type = chip.dataset.type;
        self._disabledTypes[type] = !self._disabledTypes[type];
        chip.classList.toggle('active', !self._disabledTypes[type]);
        chip.setAttribute('aria-pressed', String(!self._disabledTypes[type]));
        self._publish(false);
      });
    }

    var reset = el('refineResetBtn');
    if (reset) reset.addEventListener('click', function () { self._resetCriteria(); self._publish(false); });
  };

  // ===== Vivier =====

  SolutionExplorer.prototype.setPool = function (solutions, searchParams, stats, diagnosis, options) {
    var self = this;
    // Une exploration classe par la performance poursuivie : « recommandé »
    // répondrait à une autre question que celle qui a été posée.
    this._defaultSort = (options && options.sort) || 'score';
    this._pool = solutions || [];
    this._pool.forEach(function (solution) {
      if (solution.uid === undefined) {
        Object.defineProperty(solution, 'uid', { value: self._nextUid++, enumerable: false });
      }
    });
    this._params = searchParams || null;
    this._workerParams = searchParams && searchParams.toWorkerParams ? searchParams.toWorkerParams() : null;
    this._stats = stats || null;
    // Diagnostic de relaxation, produit par la sonde quand le vivier est vide.
    this._diagnosis = diagnosis || null;
    this._resetCriteria();
    this._renderChips();

    var linear = this._pool.length > 0 && this._pool[0].mode === 'rotationTranslation';
    var bar = el('refineBar');
    if (bar) {
      bar.hidden = this._pool.length === 0;
      bar.classList.toggle('refine-linear', linear);
    }
    this._publish(true);
  };

  SolutionExplorer.prototype.addVariant = function (solution) {
    if (!solution) return;
    if (solution.uid === undefined) {
      Object.defineProperty(solution, 'uid', { value: this._nextUid++, enumerable: false });
    }
    this._pool.push(solution);
    this._publish(false);
    var index = this._pool.length - 1;
    this.bus.emit('solution:selected', { index: index, solution: solution });
    if (this.resultsTable && this.resultsTable.setSelectedIndex) this.resultsTable.setSelectedIndex(index);
  };

  SolutionExplorer.prototype.getPool = function () { return this._pool; };

  SolutionExplorer.prototype.poolIndexOf = function (uid) {
    for (var i = 0; i < this._pool.length; i++) if (this._pool[i].uid === uid) return i;
    return -1;
  };

  // Contexte d'ingénierie capturé au moment de la recherche : sert à l'éditeur
  // d'étages pour ré-analyser une chaîne avec les mêmes hypothèses.
  SolutionExplorer.prototype.getContext = function () {
    var wp = this._workerParams || {};
    return {
      target: Number.isFinite(wp.rapportCible) ? wp.rapportCible : null,
      linear: wp.objectiveMode === 'rotationTranslation',
      engineeringOptions: {
        inputSpeedRpm: wp.vitesseEntree || 1500,
        inputTorqueNm: wp.coupleEntree || 10,
        inputMaterial: wp.inputMaterial || 'C45',
        outputMaterial: wp.outputMaterial || 'C45',
        additiveDerating: wp.additiveDerating || 1,
        weights: wp.weights || {},
        fatigue: wp.fatigue,
        shaft: wp.shaft
      },
      manufacturing: wp.manufacturing || { mode: 'standard' },
      constraints: wp.constraints || {}
    };
  };

  // ===== Critères =====

  SolutionExplorer.prototype._resetCriteria = function () {
    NUMERIC_FIELDS.forEach(function (id) { var input = el(id); if (input) input.value = ''; });
    var sort = el('refine_sort');
    if (sort) sort.value = this._defaultSort || 'score';
    this._disabledTypes = {};
    if (this.filters) this.filters.render();
  };

  SolutionExplorer.prototype._criteria = function () {
    var efficiencyPercent = optionalNumber('refine_efficiency_min');
    var disabled = this._disabledTypes;
    var allTypes = GearSolutionFilter.bounds(this._pool).types;
    var enabled = allTypes.filter(function (type) { return !disabled[type]; });
    return {
      maxErrorPercent: optionalNumber('refine_error_max'),
      minEfficiency: efficiencyPercent == null ? null : efficiencyPercent / 100,
      minSF: optionalNumber('refine_sf_min'),
      minSH: optionalNumber('refine_sh_min'),
      maxDiameter: optionalNumber('refine_diameter_max'),
      maxLength: optionalNumber('refine_length_max'),
      maxStages: optionalNumber('refine_stages_max'),
      types: enabled.length === allTypes.length ? null : enabled,
      sort: (el('refine_sort') && el('refine_sort').value) || 'score'
    };
  };

  SolutionExplorer.prototype._renderChips = function () {
    var host = el('refineTypeChips');
    if (!host) return;
    host.innerHTML = '';
    GearSolutionFilter.bounds(this._pool).types.forEach(function (type) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'refine-chip active';
      chip.dataset.type = type;
      chip.setAttribute('aria-pressed', 'true');
      chip.textContent = TYPE_LABELS[type] || type;
      host.appendChild(chip);
    });
    host.hidden = !host.children.length;
  };

  // ===== Publication =====

  SolutionExplorer.prototype._schedulePublish = function () {
    var self = this;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(function () { self._publish(false); }, 120);
  };

  SolutionExplorer.prototype._publish = function (fresh) {
    var view = GearSolutionFilter.apply(this._pool, this._criteria());
    var solutions = view.map(function (item) { return item.solution; });
    var indices = view.map(function (item) { return item.index; });

    // keepResults : un affinage qui vide la vue ne doit pas masquer l'espace
    // de travail (la barre de filtres doit rester accessible).
    if (this.workbench) this.workbench.renderSolutions(solutions, indices, { stats: this._stats, pool: this._pool, diagnosis: this._diagnosis, session: this.session, keepResults: this._pool.length > 0 });
    if (this.resultsTable) this.resultsTable.display(solutions, this._params, indices);

    var count = el('refineCount');
    if (count) {
      count.textContent = view.length + ' affichée' + (view.length > 1 ? 's' : '') +
        ' / ' + this._pool.length + ' trouvée' + (this._pool.length > 1 ? 's' : '');
      var engineValid = this._stats && this._stats.valid;
      count.title = Number.isFinite(engineValid) && engineValid > this._pool.length
        ? engineValid + ' solutions valides côté moteur (vivier tronqué)'
        : '';
    }

    if (fresh) {
      if (this.ui && this.ui.updatePoolCharts) this.ui.updatePoolCharts(this._pool, this._params);
      if (view.length) {
        this.bus.emit('solution:selected', { index: view[0].index, solution: view[0].solution });
        if (this.resultsTable && this.resultsTable.setSelectedIndex) this.resultsTable.setSelectedIndex(view[0].index);
      } else if (this.ui && this.ui.clearDetail) {
        this.ui.clearDetail();
      }
    }
  };

  GearApp.ui.SolutionExplorer = SolutionExplorer;

})(GearApp);
