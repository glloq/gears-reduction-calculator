// Workbench.js - Couche de comportement de la nouvelle interface modulaire.
// Le DOM est entièrement défini dans index.html (ids historiques préservés,
// consommés par SearchParams) ; ce module n'ajoute que du comportement :
// contexte d'objectif, paramètres par type, onglets, tuiles de solutions.
(function (GearApp) {
  'use strict';

  var OPTIMIZATION_COPY = {
    minimumStages: 'Recherche la solution valide avec le moins d’étages.',
    precision: 'Priorise l’écart minimal au rapport cible.',
    efficiency: 'Priorise le rendement calculé parmi les solutions valides.',
    compact: 'Priorise l’encombrement calculé parmi les solutions respectant la tolérance.',
    robust: 'Favorise les marges de sécurité en flexion et au contact.',
    manufacturing: 'Favorise les architectures simples à fabriquer.',
    global: 'Équilibre précision, dimensions, rendement, résistance et fabrication.'
  };

  var TYPE_NAMES = {
    spur: 'Droit', helical: 'Hélicoïdal', internal: 'Intérieur', bevel: 'Conique',
    epicyclic: 'Épicycloïdal', worm: 'Vis sans fin', belt: 'Courroie', chain: 'Chaîne', rack: 'Crémaillère'
  };

  function el(id) { return document.getElementById(id); }
  function finite(value, digits) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
  function minSafety(solution, key) {
    return (solution.mechanical || []).reduce(function (min, stage) {
      var value = stage[key] && stage[key].safetyFactor;
      return Number.isFinite(value) ? Math.min(min, value) : min;
    }, Infinity);
  }

  function Workbench(eventBus) {
    this.bus = eventBus || GearApp.eventBus;
    this.solutions = [];
    this.selected = 0;
    // Instantané des types rotatifs cochés avant un passage en mode linéaire.
    // null = aucun instantané : le mode rotatif respecte alors l'état du DOM.
    this._rotaryTypes = null;
    this._emptyHintDefault = '';
  }

  // ===== Initialisation =====

  Workbench.prototype.init = function () {
    var hint = el('workspaceEmptyHint');
    this._emptyHintDefault = hint ? hint.textContent : '';

    this._bindObjective();
    this._bindTypes();
    this._bindModuleMode();
    this._bindWeights();
    this._bindOptimizationCopy();
    this._bindSummary();
    this._bindResultsView();
    this._bindDetailTabs();
    this._bindChartTabs();
    this._bindExportMenu();

    this.renderTypeParams();
    this.updateContext();
    this.updateSummary();

    var self = this;
    this.bus.on('solution:selected', function (data) { self.selected = data.index; self._markSelected(); });
    this.bus.on('search:progress', function (data) {
      var bar = document.querySelector('.sticky-progress');
      if (bar) bar.style.width = data.percent + '%';
    });
  };

  // À appeler après restauration URL/localStorage : les contrôles ont pu changer.
  Workbench.prototype.refreshAfterRestore = function () {
    this._rotaryTypes = null;
    this.renderTypeParams();
    this.updateContext();
    this._refreshModuleMode();
    this._refreshWeights();
    this._refreshOptimizationCopy();
    this.updateSummary();
  };

  // ===== Objectif (rapport / vitesse / linéaire) =====

  Workbench.prototype._bindObjective = function () {
    var self = this;
    var mode = el('objective_mode');
    if (mode) mode.addEventListener('change', function () { self.updateContext(); });

    function refreshDerived() {
      var inputRpm = parseFloat(el('vitesse_entree') && el('vitesse_entree').value);
      var outputRpm = parseFloat(el('rpm_sortie_cible') && el('rpm_sortie_cible').value);
      var derived = el('derivedRatio');
      if (derived) {
        derived.textContent = 'Rapport cible dérivé : ' +
          (inputRpm > 0 && outputRpm > 0 ? (inputRpm / outputRpm).toFixed(2) : '—') + ':1';
      }
    }
    ['vitesse_entree', 'rpm_sortie_cible'].forEach(function (id) {
      var input = el(id);
      if (input) input.addEventListener('input', refreshDerived);
    });
    this._refreshDerived = refreshDerived;
  };

  Workbench.prototype.updateContext = function () {
    var objective = el('objective_mode');
    var mode = objective ? objective.value : 'ratio';
    var linear = mode === 'rotationTranslation';
    var boxes = Array.from(document.querySelectorAll('.type-checkbox'));
    var self = this;

    // Mémoriser les choix rotatifs avant de verrouiller la crémaillère,
    // pour les restaurer au retour vers un objectif rotatif.
    if (linear) {
      var selectedRotaryTypes = boxes.filter(function (checkbox) {
        return checkbox.value !== 'rack' && checkbox.checked;
      }).map(function (checkbox) { return checkbox.value; });
      if (selectedRotaryTypes.length || this._rotaryTypes === null) {
        this._rotaryTypes = selectedRotaryTypes;
      }
    }

    document.querySelectorAll('.objective-fields').forEach(function (group) {
      var context = linear ? 'linear' : mode;
      group.classList.toggle('active', group.classList.contains('objective-' + context));
    });

    boxes.forEach(function (checkbox) {
      var isRack = checkbox.value === 'rack';
      checkbox.disabled = linear ? !isRack : isRack;
      if (linear) {
        checkbox.checked = isRack;
      } else if (isRack) {
        checkbox.checked = false;
      } else if (self._rotaryTypes !== null) {
        checkbox.checked = self._rotaryTypes.indexOf(checkbox.value) !== -1;
      }
      var card = checkbox.closest('.type-option');
      if (card) card.hidden = linear ? !isRack : isRack;
    });
    // L'instantané est consommé au retour en rotatif : les modifications
    // manuelles ultérieures ne doivent plus être écrasées.
    if (!linear) this._rotaryTypes = null;

    var output = el('rpm_sortie_cible');
    if (output) output.dispatchEvent(new Event('input'));

    document.body.classList.toggle('linear-objective', linear);
    this.renderTypeParams();
    this.updateSummary();
  };

  // ===== Types de transmission =====

  Workbench.prototype._bindTypes = function () {
    var self = this;
    var grid = document.querySelector('.types-grid');
    if (grid) {
      grid.addEventListener('change', function (event) {
        if (!event.target.classList.contains('type-checkbox')) return;
        self.renderTypeParams();
        self.updateSummary();
      });
    }
    var filters = document.querySelector('.transmission-filters');
    if (filters) {
      filters.addEventListener('click', function (event) {
        var button = event.target.closest('[data-filter]');
        if (!button) return;
        filters.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === button); });
        var linear = document.body.classList.contains('linear-objective');
        document.querySelectorAll('.type-option').forEach(function (card) {
          if (linear) return; // le mode linéaire gère lui-même la visibilité
          if (card.dataset.group === 'linear') { card.hidden = true; return; }
          card.hidden = button.dataset.filter !== 'all' && card.dataset.group !== button.dataset.filter;
        });
      });
    }
  };

  // Éditeurs de paramètres par type actif (disponibles en mode standard).
  Workbench.prototype.renderTypeParams = function () {
    var container = el('typeParamsContainer');
    if (!container || typeof GearTransmissionRegistry === 'undefined') return;
    var definitions = GearTransmissionRegistry.parameterDefinitions;

    // Conserver les valeurs déjà saisies avant reconstruction.
    var current = {};
    container.querySelectorAll('input, select').forEach(function (field) {
      current[field.id] = field.type === 'checkbox' ? field.checked : field.value;
    });
    var pending = GearApp.models && GearApp.models.SearchParams && GearApp.models.SearchParams._pendingExpert;

    container.innerHTML = '';
    var checked = Array.from(document.querySelectorAll('.type-checkbox:checked')).map(function (c) { return c.value; });

    checked.forEach(function (typeId) {
      var registryId = typeId === 'epicyclic' ? 'planetary' : typeId;
      var paramDefs = definitions[registryId];
      if (!paramDefs || !Object.keys(paramDefs).length) return;

      var group = document.createElement('details');
      group.className = 'type-param-group';
      var summary = document.createElement('summary');
      summary.innerHTML = '<span class="type-badge ' + typeId + '">' + (TYPE_NAMES[typeId] || typeId) + '</span><em>réglages</em>';
      group.appendChild(summary);

      Object.keys(paramDefs).forEach(function (key) {
        var def = paramDefs[key];
        var fieldId = 'tp_' + registryId + '_' + key;
        var wrapper = document.createElement('div');
        wrapper.className = 'type-param-field';
        var input;

        if (def.type === 'checkbox') {
          var boolWrapper = document.createElement('label');
          boolWrapper.className = 'checkbox-label';
          input = document.createElement('input');
          input.type = 'checkbox';
          input.id = fieldId;
          input.checked = !!def.default;
          boolWrapper.appendChild(input);
          boolWrapper.appendChild(document.createTextNode(' ' + def.label));
          wrapper.appendChild(boolWrapper);
        } else {
          var label = document.createElement('label');
          label.textContent = def.label;
          label.setAttribute('for', fieldId);
          wrapper.appendChild(label);
          if (def.options) {
            input = document.createElement('select');
            input.id = fieldId;
            def.options.forEach(function (opt, i) {
              var option = document.createElement('option');
              option.value = opt;
              option.textContent = def.optionLabels ? def.optionLabels[i] : opt;
              if (opt === def.default) option.selected = true;
              input.appendChild(option);
            });
          } else {
            input = document.createElement('input');
            input.type = 'number';
            input.id = fieldId;
            input.value = def.default;
            if (def.min !== undefined) input.min = def.min;
            if (def.max !== undefined) input.max = def.max;
            if (def.step !== undefined) input.step = def.step;
          }
          wrapper.appendChild(input);
        }

        input.dataset.persist = '';
        var saved = current[fieldId] !== undefined ? current[fieldId]
          : (pending && pending[fieldId] !== undefined ? pending[fieldId] : undefined);
        if (saved !== undefined) {
          if (input.type === 'checkbox') input.checked = !!saved && saved !== 'false';
          else input.value = saved;
        }
        group.appendChild(wrapper);
      });

      container.appendChild(group);
    });

    container.hidden = !container.children.length;
    var count = el('typesCount');
    if (count) count.textContent = checked.length + ' active' + (checked.length > 1 ? 's' : '');
  };

  // ===== Module fixe / automatique =====

  Workbench.prototype._bindModuleMode = function () {
    var self = this;
    var select = el('module_mode');
    if (select) select.addEventListener('change', function () { self._refreshModuleMode(); });
    this._refreshModuleMode();
  };

  Workbench.prototype._refreshModuleMode = function () {
    var select = el('module_mode');
    if (!select) return;
    var automatic = select.value === 'automatic';
    var fixed = document.querySelector('.module-fixed');
    var auto = document.querySelector('.module-auto');
    if (fixed) fixed.classList.toggle('hidden', automatic);
    if (auto) auto.classList.toggle('hidden', !automatic);
    var moduleInput = el('module');
    if (moduleInput) moduleInput.disabled = automatic;
  };

  // ===== Pondération : affichage des valeurs =====

  Workbench.prototype._bindWeights = function () {
    document.querySelectorAll('input[type="range"][id^="weight_"]').forEach(function (range) {
      var value = document.createElement('output');
      value.className = 'range-value';
      value.textContent = range.value;
      range.parentNode.insertBefore(value, range);
      range.addEventListener('input', function () { value.textContent = range.value; });
    });
  };

  Workbench.prototype._refreshWeights = function () {
    document.querySelectorAll('input[type="range"][id^="weight_"]').forEach(function (range) {
      var value = range.parentNode.querySelector('.range-value');
      if (value) value.textContent = range.value;
    });
  };

  // ===== Description du mode d'optimisation =====

  Workbench.prototype._bindOptimizationCopy = function () {
    var select = el('search_mode');
    if (!select) return;
    var copy = document.createElement('p');
    copy.id = 'optimizationDescription';
    copy.className = 'field-help';
    select.insertAdjacentElement('afterend', copy);
    var self = this;
    select.addEventListener('change', function () { self._refreshOptimizationCopy(); });
    this._refreshOptimizationCopy();
  };

  Workbench.prototype._refreshOptimizationCopy = function () {
    var select = el('search_mode');
    var copy = el('optimizationDescription');
    if (select && copy) copy.textContent = OPTIMIZATION_COPY[select.value] || '';
  };

  // ===== Résumé de configuration =====

  Workbench.prototype._bindSummary = function () {
    var self = this;
    var form = el('sidebar');
    if (!form) return;
    form.addEventListener('input', function () { self.updateSummary(); });
    form.addEventListener('change', function () { self.updateSummary(); });
  };

  Workbench.prototype.updateSummary = function () {
    var summary = el('configurationSummary');
    if (!summary) return;
    var mode = el('objective_mode') ? el('objective_mode').value : 'ratio';

    if (mode === 'rotationTranslation') {
      var bits = ['<strong>' + finite(parseFloat(el('linear_travel_per_rev').value), 2) + ' mm/tr</strong>',
        '<span>' + finite(parseFloat(el('vitesse_entree').value), 0) + ' tr/min entrée</span>'];
      var min = el('linear_speed_min'), max = el('linear_speed_max'), force = el('linear_force_min');
      if (min && min.value) bits.push('<span>Vitesse ≥ ' + min.value + ' mm/min</span>');
      if (max && max.value) bits.push('<span>Vitesse ≤ ' + max.value + ' mm/min</span>');
      if (force && force.value) bits.push('<span>Force ≥ ' + force.value + ' N</span>');
      bits.push('<span>Pignon-crémaillère</span>');
      summary.innerHTML = bits.join('');
      return;
    }

    var ratio = parseFloat(el('rapport').value) || 0;
    if (mode === 'need') {
      var a = parseFloat(el('vitesse_entree').value), b = parseFloat(el('rpm_sortie_cible').value);
      if (a > 0 && b > 0) ratio = a / b;
    }
    var types = Array.from(document.querySelectorAll('.type-checkbox:checked')).map(function (c) {
      return TYPE_NAMES[c.value] || c.value;
    });
    summary.innerHTML = '<strong>' + finite(ratio, 2) + ':1</strong>' +
      '<span>± ' + el('precision').value + ' %</span>' +
      '<span>' + (types.join(' · ') || 'aucun type') + '</span>' +
      '<span>≤ ' + el('etages').value + ' étages · ' + (OPTIMIZATION_COPY[el('search_mode').value] || '') + '</span>';
  };

  // ===== Vue résultats : cartes / tableau =====

  Workbench.prototype._bindResultsView = function () {
    var container = el('result-container'), cards = el('cardsViewBtn'), table = el('tableViewBtn');
    if (!container || !cards || !table) return;
    function set(tableMode) {
      container.classList.toggle('results-table-mode', tableMode);
      cards.classList.toggle('active', !tableMode);
      table.classList.toggle('active', tableMode);
      cards.setAttribute('aria-selected', String(!tableMode));
      table.setAttribute('aria-selected', String(tableMode));
    }
    cards.addEventListener('click', function () { set(false); });
    table.addEventListener('click', function () { set(true); });
  };

  // ===== Onglets de détail (Schéma / Analyse / Graphiques / Journal) =====

  Workbench.prototype._bindDetailTabs = function () {
    var tabs = document.querySelector('.detail-tabs');
    if (!tabs) return;
    tabs.addEventListener('click', function (event) {
      var button = event.target.closest('[data-detail]');
      if (!button) return;
      tabs.querySelectorAll('[data-detail]').forEach(function (b) {
        b.classList.toggle('active', b === button);
        b.setAttribute('aria-selected', String(b === button));
      });
      document.querySelectorAll('.detail-panel').forEach(function (panel) {
        panel.classList.toggle('active', panel.dataset.detailPanel === button.dataset.detail);
      });
      // Les graphiques créés dans un panneau masqué ont une taille nulle :
      // les redimensionner à l'affichage.
      if (button.dataset.detail === 'graphiques') {
        requestAnimationFrame(function () {
          var charts = window.GearCharts && window.GearCharts.charts;
          if (!charts) return;
          Object.keys(charts).forEach(function (key) {
            if (charts[key] && typeof charts[key].resize === 'function') charts[key].resize();
          });
        });
      }
    });
  };

  Workbench.prototype._bindChartTabs = function () {
    var tabs = el('chartTabs');
    if (!tabs) return;
    tabs.addEventListener('click', function (event) {
      var button = event.target.closest('[data-chart]');
      if (!button) return;
      tabs.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === button); });
      document.querySelectorAll('.chart-container').forEach(function (container) {
        container.classList.toggle('active', container.dataset.chartPanel === button.dataset.chart);
      });
      requestAnimationFrame(function () {
        var charts = window.GearCharts && window.GearCharts.charts;
        var chart = charts && charts[button.dataset.chart];
        if (chart && typeof chart.resize === 'function') chart.resize();
      });
    });
  };

  Workbench.prototype._bindExportMenu = function () {
    document.querySelectorAll('.export-menu [data-export]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (window.UI && typeof window.UI[button.dataset.export] === 'function') {
          window.UI[button.dataset.export]();
        }
      });
    });
  };

  // ===== Rendu des solutions =====

  // Rendu des tuiles à partir d'une vue filtrée du vivier. `indices[i]` est la
  // position de solutions[i] dans le vivier d'origine (contrat de sélection) ;
  // omis, la vue est le vivier lui-même.
  Workbench.prototype.renderSolutions = function (solutions, indices, info) {
    this.solutions = solutions || [];
    this._indices = indices || this.solutions.map(function (s, i) { return i; });
    // La sélection n'est jamais déplacée ici : seul l'évènement
    // `solution:selected` (émis par l'explorateur ou un clic) la fait évoluer.
    if (this.solutions.length) {
      document.body.classList.add('has-results');
    } else if (!(info && info.keepResults)) {
      document.body.classList.remove('has-results');
    }

    var hint = el('workspaceEmptyHint');
    if (hint) {
      var reason = info && info.stats && info.stats.reason;
      hint.textContent = this.solutions.length > 0 ? this._emptyHintDefault
        : reason === 'NO_CANDIDATES' ? 'Aucun candidat d’étage généré : élargissez les plages de dents ou activez d’autres types de transmission.'
        : reason === 'NO_MODULES' ? 'Aucun module à tester : renseignez un module fixe valide ou une plage de modules automatique.'
        : 'Aucune solution trouvée. Élargissez la tolérance, les plages de dents ou les types de transmission.';
    }

    var host = el('solutionCards');
    if (!host) return;
    host.innerHTML = '';
    var self = this;

    this.solutions.slice(0, 12).forEach(function (s, position) {
      var index = self._indices[position];
      var tile = document.createElement('article');
      tile.className = 'solution-tile' + (index === self.selected ? ' selected' : '');
      tile.tabIndex = 0;
      tile.dataset.index = index;
      tile.setAttribute('aria-label', 'Sélectionner la solution ' + (position + 1));
      var sf = minSafety(s, 'bending'), sh = minSafety(s, 'contact');
      var linear = s.mode === 'rotationTranslation';
      var kpis = linear
        ? '<span>Course<strong>' + finite(s.travelPerRevolutionMm, 2) + ' mm/tr</strong></span>' +
          '<span>Vitesse<strong>' + finite(s.outputLinearSpeedMmMin, 0) + ' mm/min</strong></span>' +
          '<span>Force<strong>' + finite(s.outputForceN, 1) + ' N</strong></span>' +
          '<span>Rendement<strong>' + finite(s.efficiency * 100, 1) + ' %</strong></span>' +
          '<span>Diamètre pignon<strong>' + finite(s.dimensions && s.dimensions.maxDiameter, 1) + ' mm</strong></span>' +
          '<span>Module<strong>' + finite(s.stats && s.stats.selectedModule, 2) + ' mm</strong></span>'
        : '<span>Rapport<strong>' + finite(s.ratio, 3) + ':1</strong></span>' +
          '<span>Rendement<strong>' + finite(s.efficiency * 100, 1) + ' %</strong></span>' +
          '<span>Dimensions<strong>' + finite(s.dimensions && s.dimensions.maxDiameter, 0) + ' mm</strong></span>' +
          '<span>SF / SH<strong>' + finite(sf, 2) + ' / ' + finite(sh, 2) + '</strong></span>';
      var origin = s.origin === 'variante' ? '<em class="tile-origin">Variante</em>' : '';
      tile.innerHTML = '<header><b>#' + (position + 1) + '</b>' + origin +
        '<span title="Score pondéré : plus bas = mieux">coût ' + finite(s.score && s.score.value, 3) + '</span></header>' +
        '<h3>' + s.stages.map(function (x) { return x.type; }).join(' → ') + '</h3>' +
        '<div class="tile-kpis">' + kpis + '</div>';
      function select() {
        self.selected = index;
        self.bus.emit('solution:selected', { index: index, solution: s });
        self._markSelected();
      }
      tile.addEventListener('click', select);
      tile.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
      });
      host.appendChild(tile);
    });

    this._markSelected();
  };

  // Le surlignage se fait par index de vivier (data-index), jamais par
  // position DOM : le tableau trié/paginé gère sa propre sélection.
  Workbench.prototype._markSelected = function () {
    var self = this;
    document.querySelectorAll('.solution-tile').forEach(function (tile) {
      tile.classList.toggle('selected', tile.dataset.index === String(self.selected));
    });
  };

  GearApp.ui.Workbench = Workbench;

})(GearApp);
