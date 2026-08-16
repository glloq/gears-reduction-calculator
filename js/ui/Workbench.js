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

    this._bindConfigurationFlow();
    this._bindObjective();
    this._bindTypes();
    this._bindTypeTemplate();
    this._bindModuleMode();
    this._bindManufacturingMode();
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
    this.bus.on('compare:changed', function (data) { self._pinnedUids = data.uids || []; self._refreshPinMarks(); });
  };

  Workbench.prototype._refreshPinMarks = function () {
    var pinned = this._pinnedUids || [];
    document.querySelectorAll('.tile-pin').forEach(function (button) {
      var active = button.dataset.uid !== undefined && pinned.indexOf(Number(button.dataset.uid)) !== -1;
      button.textContent = active ? '★' : '☆';
      button.classList.toggle('pinned', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  // À appeler après restauration URL/localStorage : les contrôles ont pu changer.
  Workbench.prototype.refreshAfterRestore = function () {
    this._restored = true;
    this._rotaryTypes = null;
    this.renderTypeParams();
    this.updateContext();
    this.renderTypeTemplate();
    this._refreshModuleMode();
    this._refreshManufacturingMode();
    this._refreshWeights();
    this._refreshOptimizationCopy();
    this._refreshConfigurationFlow();
    this.updateSummary();
  };

  // ===== Parcours de configuration : besoin → contraintes → priorité =====
  //
  // Workbench n'implémente pas ces composants : il les assemble. Chacun pilote
  // les contrôles historiques, qui restent lus par SearchParams.
  Workbench.prototype._bindConfigurationFlow = function () {
    var self = this;

    this.constraints = new GearConstraintManager.Manager({
      host: el('constraintChips'),
      menu: el('constraintMenu'),
      trigger: el('addConstraintBtn'),
      onChange: function () { self.updateSummary(); }
    }).bind();

    this.priorities = new GearPrioritySelector.Selector({
      host: el('priorityChips'),
      help: el('priorityHelp'),
      onChange: function () { self.updateSummary(); }
    }).bind();

    this.technologies = new GearTechnologySelector.Selector({
      panel: el('technologyPanel'),
      toggle: el('technologyToggle'),
      autoButton: el('technologyAutoBtn'),
      hint: el('technologyHint'),
      onChange: function () { self.renderTypeParams(); self.renderTypeTemplate(); self.updateSummary(); }
    }).bind();

    this.requirements = new GearRequirementForm.Form({
      cards: el('objectiveCards'),
      constraints: this.constraints,
      onChange: function () { self.updateContext(); }
    }).bind();

    // Au premier chargement sans configuration restaurée, l'utilisateur doit
    // pouvoir chercher sans rien ouvrir : technologies automatiques d'emblée.
    if (!this._restored && this.technologies.selected().length <= 1) this.technologies.setAutomatic();
  };

  /** Réaligne le parcours après une restauration URL/localStorage/preset. */
  Workbench.prototype._refreshConfigurationFlow = function () {
    if (this.constraints) this.constraints.render();
    if (this.priorities) this.priorities.render();
    if (this.technologies) this.technologies.render();
    if (this.requirements) this.requirements.render();
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
    this.renderTypeTemplate();
    // Le jeu de contraintes applicables dépend de l'objectif : une contrainte
    // linéaire n'a pas de sens en rotatif, et réciproquement.
    if (this.constraints) this.constraints.render();
    if (this.technologies) this.technologies.render();
    if (this.requirements) this.requirements.render();
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

  // ===== Gabarit d'architecture (types imposés par étage) =====

  Workbench.prototype._bindTypeTemplate = function () {
    var self = this;
    var etages = el('etages');
    if (etages) {
      etages.addEventListener('input', function () { self.renderTypeTemplate(); });
      etages.addEventListener('change', function () { self.renderTypeTemplate(); });
    }
    var grid = document.querySelector('.types-grid');
    if (grid) {
      grid.addEventListener('change', function (event) {
        if (event.target.classList.contains('type-checkbox')) self.renderTypeTemplate();
      });
    }
    this.renderTypeTemplate();
  };

  Workbench.prototype._readTemplate = function () {
    var hidden = el('type_template');
    if (!hidden || !hidden.value) return [];
    try {
      var parsed = JSON.parse(hidden.value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  };

  Workbench.prototype._writeTemplate = function (template) {
    var hidden = el('type_template');
    if (!hidden) return;
    var meaningful = template.some(function (slot) { return slot && slot.length; });
    hidden.value = meaningful ? JSON.stringify(template) : '';
  };

  Workbench.prototype.renderTypeTemplate = function () {
    var container = el('typeTemplateContainer');
    if (!container) return;
    var self = this;
    var stageCount = Math.max(1, Math.min(8, parseInt(el('etages') && el('etages').value, 10) || 4));
    var activeTypes = Array.from(document.querySelectorAll('.type-checkbox:checked'))
      .map(function (checkbox) { return checkbox.value; })
      .filter(function (type) { return type !== 'rack'; });

    // Conserver l'état existant, tronqué à la longueur courante, nettoyé des
    // types désormais inactifs.
    var template = this._readTemplate().slice(0, stageCount);
    while (template.length < stageCount) template.push(null);
    template = template.map(function (slot) {
      if (!Array.isArray(slot)) return null;
      var kept = slot.filter(function (type) { return activeTypes.indexOf(type) !== -1; });
      return kept.length ? kept : null;
    });
    this._writeTemplate(template);

    container.innerHTML = '';
    template.forEach(function (slot, stageIndex) {
      var row = document.createElement('div');
      row.className = 'template-row';
      var label = document.createElement('span');
      label.className = 'template-stage-label';
      label.textContent = 'Étage ' + (stageIndex + 1);
      row.appendChild(label);

      function chip(labelText, active, onClick) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'template-chip' + (active ? ' active' : '');
        button.setAttribute('aria-pressed', String(active));
        button.textContent = labelText;
        button.addEventListener('click', onClick);
        row.appendChild(button);
      }

      chip('Libre', slot === null, function () {
        template[stageIndex] = null;
        self._writeTemplate(template);
        self.renderTypeTemplate();
        self.updateSummary();
      });
      activeTypes.forEach(function (type) {
        var selected = Array.isArray(slot) && slot.indexOf(type) !== -1;
        chip(TYPE_NAMES[type] || type, selected, function () {
          var current = Array.isArray(template[stageIndex]) ? template[stageIndex].slice() : [];
          var position = current.indexOf(type);
          if (position === -1) current.push(type); else current.splice(position, 1);
          template[stageIndex] = current.length ? current : null;
          self._writeTemplate(template);
          self.renderTypeTemplate();
          self.updateSummary();
        });
      });

      container.appendChild(row);
    });
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

  // ===== Procédé de fabrication =====

  Workbench.prototype._bindManufacturingMode = function () {
    var self = this;
    var select = el('manufacturing_mode');
    if (select) select.addEventListener('change', function () { self._refreshManufacturingMode(); });
    this._refreshManufacturingMode();
  };

  Workbench.prototype._refreshManufacturingMode = function () {
    var select = el('manufacturing_mode');
    if (!select) return;
    var printing = select.value === 'printing3d';
    document.querySelectorAll('.printing3d-only').forEach(function (group) {
      group.classList.toggle('hidden', !printing);
    });
    var hint = el('manufacturingHint');
    if (hint) hint.textContent = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '';
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
    // Sous cette largeur, un tableau à douze colonnes n'est plus lisible : on
    // impose les cartes. Le choix explicite de l'utilisateur n'est pas perdu
    // pour autant, il reprend effet dès que la fenêtre redevient assez large.
    var narrow = window.matchMedia('(max-width: 700px)');
    var wanted = false;
    function apply() {
      set(wanted && !narrow.matches);
      table.disabled = narrow.matches;
      table.title = narrow.matches ? 'Le tableau demande un écran plus large' : '';
    }
    cards.addEventListener('click', function () { wanted = false; apply(); });
    table.addEventListener('click', function () { wanted = true; apply(); });
    if (narrow.addEventListener) narrow.addEventListener('change', apply);
    else if (narrow.addListener) narrow.addListener(apply);
    apply();
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

    this._renderEmptyState(info);

    var host = el('solutionCards');
    if (!host) return;
    host.innerHTML = '';
    var self = this;

    // Badges calculés sur le VIVIER COMPLET, pas sur la vue filtrée : « la plus
    // compacte » doit désigner la même solution quels que soient les filtres.
    var annotation = GearResultRecommendations.annotate(info && info.pool ? info.pool : this.solutions);
    var poolIndexOf = info && info.pool ? function (position) { return self._indices[position]; }
      : function (position) { return position; };

    // Toutes les tuiles de la vue sont rendues : le compteur de la barre
    // d'affinage correspond exactement à ce qui est affiché.
    this.solutions.forEach(function (s, position) {
      var index = self._indices[position];
      var badges = annotation.byIndex[poolIndexOf(position)] || [];
      var tile = document.createElement('article');
      tile.className = 'solution-card' + (index === self.selected ? ' selected' : '') +
        (badges.indexOf('recommended') >= 0 ? ' recommended' : '');
      tile.tabIndex = 0;
      tile.dataset.index = index;
      tile.setAttribute('aria-label', 'Solution ' + (position + 1) +
        (badges.length ? ' — ' + badges.map(function (id) { return GearResultRecommendations.badge(id).label; }).join(', ') : ''));

      var linear = s.mode === 'rotationTranslation';
      // Cartes volontairement courtes : de quoi DÉCIDER. SF/SH, efforts et
      // diamètres détaillés restent dans l'inspection.
      var metrics = linear
        ? [['Course', finite(s.travelPerRevolutionMm, 2) + ' mm/tr', true],
           ['Vitesse', finite(s.outputLinearSpeedMmMin, 0) + ' mm/min', false],
           ['Force', finite(s.outputForceN, 1) + ' N', false],
           ['Rendement', finite(s.efficiency * 100, 1) + ' %', false],
           ['Ø pignon', finite(s.dimensions && s.dimensions.maxDiameter, 1) + ' mm', false]]
        : [['Rapport', finite(s.ratio, 2) + ' : 1', true],
           ['Sortie', finite(s.outputSpeedRpm, 1) + ' rpm', true],
           ['Rendement', finite(s.efficiency * 100, 1) + ' %', false],
           ['Couple', finite(s.outputTorqueNm, 1) + ' N·m', false],
           ['Ø max', finite(s.dimensions && s.dimensions.maxDiameter, 0) + ' mm', false],
           ['Étages', String((s.stages || []).length), false]];

      var badgeMarkup = badges.map(function (id) {
        var entry = GearResultRecommendations.badge(id);
        return '<span class="recommendation-badge ' + id + '">' + (id === 'recommended' ? '★ ' : '') + entry.label + '</span>';
      }).join('');
      var origin = s.origin === 'variante' ? '<span class="recommendation-badge variant">Variante</span>' : '';
      var architecture = (s.stages || []).map(function (x) { return TYPE_NAMES[x.type] || x.type; }).join(' → ');
      var why = GearResultRecommendations.explain(s, badges);

      tile.innerHTML =
        '<header class="solution-card-head">' + badgeMarkup + origin +
          '<button class="tile-pin" title="Épingler pour comparer" aria-pressed="false">☆</button></header>' +
        '<h3 class="solution-architecture">' + architecture + '</h3>' +
        '<div class="solution-metrics">' + metrics.map(function (metric) {
          return '<span class="metric' + (metric[2] ? ' metric-primary' : ' metric-secondary') + '">' +
            '<small>' + metric[0] + '</small><strong>' + metric[1] + '</strong></span>';
        }).join('') + '</div>' +
        (why ? '<p class="solution-why">' + why + '</p>' : '') +
        '<footer class="solution-card-actions"><button type="button" class="btn-small solution-view">Voir</button></footer>';

      function select() {
        self.selected = index;
        self.bus.emit('solution:selected', { index: index, solution: s });
        self._markSelected();
      }
      tile.addEventListener('click', select);
      tile.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
      });
      var pin = tile.querySelector('.tile-pin');
      if (pin) {
        if (s.uid !== undefined) pin.dataset.uid = s.uid;
        pin.addEventListener('click', function (event) {
          event.stopPropagation();
          self.bus.emit('solution:pin-toggled', { solution: s });
        });
      }
      host.appendChild(tile);
    });
    this._refreshPinMarks();

    this._markSelected();
  };

  /**
   * État vide actionnable : « 0 résultat » n'aide personne. On nomme les
   * contraintes les plus susceptibles de bloquer et on propose de les lever.
   * La structure est prête à recevoir un vrai diagnostic « near-miss » du
   * moteur : il suffira de remplir `info.stats.blockers`.
   */
  Workbench.prototype._renderEmptyState = function (info) {
    var title = el('workspaceEmptyTitle');
    var hint = el('workspaceEmptyHint');
    var blockers = el('workspaceEmptyBlockers');
    var actions = el('workspaceEmptyActions');
    var searched = !!(info && info.stats);
    var self = this;

    if (this.solutions.length > 0 || !searched) {
      if (title) title.textContent = 'Décrivez la transmission que vous recherchez';
      if (hint) hint.textContent = this._emptyHintDefault;
      if (blockers) { blockers.hidden = true; blockers.textContent = ''; }
      if (actions) { actions.hidden = true; actions.textContent = ''; }
      return;
    }

    var reason = info.stats.reason;
    if (title) title.textContent = 'Aucune architecture ne respecte toutes les contraintes';
    if (hint) {
      hint.textContent = reason === 'NO_CANDIDATES'
        ? 'Aucun candidat d’étage n’a pu être généré : les plages de dents ou les technologies autorisées sont trop étroites.'
        : reason === 'NO_MODULES'
          ? 'Aucun module à tester : renseignez un module fixe valide ou une plage de modules automatique.'
          : 'La recherche a exploré le domaine autorisé sans trouver de solution valide.';
    }

    // Les contraintes explicitement posées sont les suspects les plus probables.
    var suspects = (info.stats.blockers || (this.constraints ? this.constraints.active() : [])).slice(0, 4);
    if (blockers) {
      blockers.textContent = '';
      suspects.forEach(function (constraint) {
        var item = document.createElement('li');
        item.textContent = constraint.text || constraint.name;
        blockers.appendChild(item);
      });
      blockers.hidden = !suspects.length;
    }
    if (actions) {
      actions.textContent = '';
      suspects.forEach(function (constraint) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-small';
        button.textContent = 'Lever « ' + (constraint.text || constraint.name) + ' »';
        button.addEventListener('click', function () {
          if (self.constraints) self.constraints.remove(constraint.field);
        });
        actions.appendChild(button);
      });
      // Toujours une porte de sortie, même sans contrainte explicite.
      if (!suspects.length) {
        var relax = document.createElement('button');
        relax.type = 'button';
        relax.className = 'btn-small';
        relax.textContent = 'Autoriser un étage de plus';
        relax.addEventListener('click', function () {
          var stages = el('etages');
          if (!stages) return;
          stages.value = String(Math.min(8, (parseInt(stages.value, 10) || 4) + 1));
          stages.dispatchEvent(new Event('change', { bubbles: true }));
        });
        actions.appendChild(relax);
      }
      actions.hidden = !actions.children.length;
    }
  };

  // Le surlignage se fait par index de vivier (data-index), jamais par
  // position DOM : le tableau trié/paginé gère sa propre sélection.
  Workbench.prototype._markSelected = function () {
    var self = this;
    document.querySelectorAll('.solution-card').forEach(function (tile) {
      tile.classList.toggle('selected', tile.dataset.index === String(self.selected));
    });
  };

  GearApp.ui.Workbench = Workbench;

})(GearApp);
