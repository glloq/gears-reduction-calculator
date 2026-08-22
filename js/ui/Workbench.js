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

  // §19 : le nom d'une famille vient du registre, pas d'une table locale.
  var familyName = GearTransmissionRegistry.familyName;

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
    this._emptyHintDefault = '';
  }

  // ===== Initialisation =====

  Workbench.prototype.init = function () {
    var hint = el('workspaceEmptyHint');
    this._emptyHintDefault = hint ? hint.textContent : '';

    this._bindConfigurationFlow();
    this._bindMobilePanes();
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
    this.bus.on('compare:changed', function (data) {
      self._pinnedUids = data.uids || [];
      self._refreshPinMarks();
      self._refreshDetailTabs();
    });
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
  Workbench.prototype.refreshAfterRestore = function (restored) {
    this._restored = !!restored;
    this.renderTypeParams();
    this.updateContext();
    this.renderTypeTemplate();
    this._refreshModuleMode();
    this._refreshManufacturingMode();
    this._refreshWeights();
    this._refreshOptimizationCopy();
    this.adoptRestoredForm(this._restored);
    this.updateSummary();
  };

  // ===== La configuration vit dans le modal (§16) =====
  //
  // Workbench n'héberge plus d'éditeur : il tient la session, ouvre le modal
  // sur un brouillon, et affiche le cahier des charges en une ligne.
  Workbench.prototype._bindConfigurationFlow = function () {
    var self = this;
    this.session = new GearApp.ui.SearchSession();

    this.modal = new GearApp.ui.SearchModal({
      session: this.session,
      onSearch: function () {
        self._refreshConfigurationFlow();
        var start = el('startStopBtn');
        if (start) start.click();
      },
      onClose: function () { self._refreshConfigurationFlow(); }
    });

    // §26 : repartir d'une solution trouvée, sans la ressaisir. Le modèle
    // « réducteur existant » attend exactement des étages au format moteur —
    // c'est ce que la solution porte déjà.
    var optimise = el('optimiseSolutionBtn');
    if (optimise) optimise.addEventListener('click', function () {
      var solution = self.solutions && self.selected != null ? self.solutions[self.selected] : null;
      if (!solution || !self.session) return;
      self.session.existing = new GearApp.requirements.ExistingReducer({ stages: solution.stages });
      self.session.intent.setMode('improve');
      self.session.invalidate();
      self.modal.open(0);
    });

    // §25 : reprendre une solution DANS Construire. « Optimiser » cherche mieux
    // à rapport égal, sans rendre la main sur les étages ; « Modifier » les rend
    // tous, chacun avec son degré de liberté. C'est ce qui referme la boucle
    // concevoir → modifier → compléter → nouvelle solution.
    ['editSolutionBtn', 'editTransmissionBtn'].forEach(function (id) {
      var button = el(id);
      if (button) button.addEventListener('click', function () { self.editSelectedSolution(); });
    });

    var edit = el('editSearchBtn');
    // §25 : rouvrir une recherche définie ramène à l'étape qui la porte.
    if (edit) edit.addEventListener('click', function () { self.modal.open(); });
    var fresh = el('newSearchBtn');
    if (fresh) fresh.addEventListener('click', function () {
      // §21 : une nouvelle recherche repart vide, sans valeur imposée en silence.
      self.session.adopt(new GearApp.ui.SearchSession());
      self.modal.open(0);
    });

    this._refreshConfigurationFlow();
  };

  /**
   * Charge la solution affichée dans le constructeur. Tous ses étages y entrent
   * IMPOSÉS : c'est bien ce qu'on veut d'abord — la solution telle qu'elle est —
   * et l'utilisateur libère ensuite ce qu'il souhaite voir recalculé, en vidant
   * un champ. L'inverse — tout ouvrir d'emblée — perdrait la solution qu'on
   * venait justement de reprendre.
   */
  Workbench.prototype.editSelectedSolution = function () {
    var solution = this.solutions && this.selected != null ? this.solutions[this.selected] : null;
    if (!solution || !this.session) return this;
    this.session.build = GearApp.requirements.build.fromStages(solution.stages);
    this.session.setWorkspaceMode('build');
    this.session.invalidate();
    this._refreshConfigurationFlow();
    this.modal.open(0);
    return this;
  };

  /** Réaligne les miroirs et le bandeau sur la session. */
  Workbench.prototype._refreshConfigurationFlow = function () {
    if (!this.session) return;
    this.session.syncToForm();
    this.renderTypeParams();
    this.renderTypeTemplate();
    this.updateContext();
    this.updateSummary();
  };

  /**
   * Après une restauration (URL, preset, historique) les miroirs portent la
   * vérité : la session les adopte et redevient la source.
   */
  Workbench.prototype.adoptRestoredForm = function (restored) {
    if (!this.session) return;
    this.session.adoptForm(restored);
    this._refreshConfigurationFlow();
  };

  /**
   * Reprend une session rangée sous son schéma : elle remplace le modèle, et
   * les miroirs sont réécrits depuis lui — l'inverse du chemin historique.
   */
  Workbench.prototype.adoptStoredSession = function (data) {
    if (!this.session || !data) return this.refreshAfterRestore(false);
    this.session.adopt(new GearApp.ui.SearchSession(data));
    this._restored = true;
    this._refreshConfigurationFlow();
    return this;
  };

  /**
   * §1 : ouvrir l'application, c'est vouloir chercher. Le modal ne s'ouvrait
   * que si la session semblait VIDE — et une configuration rangée dans le
   * localStorage par une version précédente suffisait à la remplir, donc à
   * sauter le point d'entrée sans rien demander à personne.
   *
   * Un lien partagé est la seule exception : il désigne explicitement une
   * recherche, et l'ouvrir sur un modal reviendrait à ignorer le lien.
   * Une recherche relue du stockage n'est pas une demande : c'est un
   * PRÉREMPLISSAGE, et le modal s'ouvre par-dessus.
   *
   * @param {'fresh'|'localStorage'|'sharedUrl'} source
   */
  Workbench.prototype.openInitialSearchModal = function (source) {
    if (!this.modal) return this;
    if (source === 'sharedUrl') return this;
    this.modal.open(0);
    return this;
  };

  // ===== Objectif (rapport / vitesse / linéaire) =====

  Workbench.prototype._bindObjective = function () {
    var self = this;
    var mode = el('objective_mode');
    if (mode) mode.addEventListener('change', function () { self.updateContext(); });

    // Le rapport déduit est écrit par RequirementSheet, qui connaît l'intention
    // (une plage donne « 37,5 → 75:1 », pas une moyenne).
  };

  Workbench.prototype.updateContext = function () {
    var objective = el('objective_mode');
    var mode = objective ? objective.value : 'ratio';
    var linear = mode === 'rotationTranslation';
    var boxes = Array.from(document.querySelectorAll('.type-checkbox'));
    var self = this;

    // Les cases cochées appartiennent désormais à la session : ici on ne règle
    // plus QUE leur pertinence dans le contexte courant. L'ancien instantané
    // « types rotatifs » n'a plus lieu d'être — le conseiller reconstruit la
    // sélection à chaque changement de besoin.
    boxes.forEach(function (checkbox) {
      var isRack = checkbox.value === 'rack';
      checkbox.disabled = linear ? !isRack : isRack;
      var card = checkbox.closest('.type-option');
      if (card) card.hidden = linear ? !isRack : isRack;
    });

    document.body.classList.toggle('linear-objective', linear);
    this.renderTypeParams();
    this.renderTypeTemplate();
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
      summary.innerHTML = '<span class="type-badge ' + typeId + '">' + familyName(typeId, 'short') + '</span><em>réglages</em>';
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
              // Les libellés sont donnés par valeur (`{S: 'Solaire (S)'}`) ;
              // l'indexation par rang ne marchait que pour un tableau.
              option.textContent = def.optionLabels ? (def.optionLabels[opt] || def.optionLabels[i] || opt) : opt;
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
        chip(familyName(type, 'short'), selected, function () {
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

  // Le bandeau se met à jour quand la session change, pas quand un champ bouge :
  // il n'y a plus de formulaire dans la page à écouter.
  Workbench.prototype._bindSummary = function () { return this; };

  /** Le cahier des charges en une ligne, dans le bandeau (§16). */
  /**
   * §15 : le bandeau enfilait TOUT le cahier des charges en une phrase, qui
   * pouvait tenir sur trois lignes. Il sert à IDENTIFIER le projet, pas à
   * remplacer le modal : on garde les premiers éléments, on compte le reste.
   */
  var BANNER_PARTS = 4;

  Workbench.prototype.updateSummary = function () {
    var banner = el('requirementBannerText'), legacy = el('configurationSummary');
    if (!this.session) return;
    var parts = this.session.isEmpty() ? [] : this.session.summarise();
    var full = parts.length ? parts.join(' · ') : 'Aucune recherche définie.';
    if (legacy) legacy.textContent = full;
    if (!banner) return;
    banner.title = full;
    if (parts.length <= BANNER_PARTS) { banner.textContent = full; return; }
    var rest = parts.length - BANNER_PARTS;
    banner.textContent = parts.slice(0, BANNER_PARTS).join(' · ') +
      ' · + ' + rest + (rest > 1 ? ' critères' : ' critère');
  };
  /**
   * §27 : choisir le volet visible sur téléphone. Sélectionner une solution
   * bascule sur la vue — c'est ce qu'on vient de demander à voir — sans
   * enfermer : les trois boutons restent là.
   */
  Workbench.prototype._bindMobilePanes = function () {
    var self = this, nav = el('mobilePanes');
    var grid = document.querySelector('.design-workspace');
    if (!nav || !grid) return;
    grid.dataset.mobilePane = 'results';
    nav.addEventListener('click', function (event) {
      var button = event.target.closest('[data-pane]');
      if (!button) return;
      self.showMobilePane(button.dataset.pane);
    });

  };

  Workbench.prototype.showMobilePane = function (pane) {
    var nav = el('mobilePanes'), grid = document.querySelector('.design-workspace');
    if (!nav || !grid) return;
    grid.dataset.mobilePane = pane;
    Array.prototype.forEach.call(nav.querySelectorAll('[data-pane]'), function (button) {
      var active = button.dataset.pane === pane;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    // DEMANDER LA VUE ET NE VOIR QUE DES BOUTONS.
    // Sur un téléphone de 360 x 800, la barre d'outils du visualiseur occupe
    // le premier écran : on touchait « Vue » et le mécanisme était sous la
    // ligne de flottaison. Rien n'est masqué pour autant — la barre reste
    // au-dessus, on y remonte d'un geste —, mais ce qu'on vient de demander à
    // voir est amené à l'écran.
    if (pane === 'viewer') {
      var scene = document.querySelector('.viewer-scene');
      if (scene && scene.scrollIntoView) scene.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  };

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

    // Choix 12C : le front de Pareto est calculé sur le VIVIER COMPLET, puis
    // traduit en catégories. « La plus compacte » désigne la même solution quels
    // que soient les filtres, et ne s'affiche que si l'écart est réel.
    var Evaluator = GearApp.requirements.SolutionEvaluator;
    var preferences = this.session ? this.session.preferences : null;
    // §17 : le vocabulaire des badges suit la question posée — « couple
    // maximum » quand c'est le couple qu'on poussait, pas « recommandée ».
    var intent = this.session ? this.session.intent : null;
    // L'explorateur a déjà rendu le verdict sur le vivier entier — c'est lui
    // qui trie avec. Le recalculer ici, c'est risquer d'en obtenir un autre.
    var annotation = (info && info.decision) ||
      Evaluator.evaluate(info && info.pool ? info.pool : this.solutions, preferences,
        this.session ? this.session.technologySelection : null);
    // Le verdict COMPLET — gains, sacrifices, incertitude, alertes triées —
    // vient de la même couche. La carte ne calcule plus rien elle-même.
    var assessment = (info && info.assessment) || null;
    this._assessment = assessment;
    // La bande d'identité, au-dessus du dessin, doit porter le MÊME badge que la
    // carte : deux calculs donneraient deux verdicts pour une seule solution.
    this._annotation = annotation;
    this._poolIndexOf = info && info.pool ? function (position) { return self._indices[position]; }
      : function (position) { return position; };
    var poolIndexOf = info && info.pool ? function (position) { return self._indices[position]; }
      : function (position) { return position; };

    // §16 : deux cartes indépendantes obligent à comparer de tête. La
    // solution de tête sert de RÉFÉRENCE, et les autres disent ce qu'elles
    // gagnent ou perdent face à elle — c'est ce qui fait choisir.
    var referencePosition = -1;
    this.solutions.forEach(function (s, position) {
      if (referencePosition === -1 && (annotation.byIndex[poolIndexOf(position)] || []).indexOf('recommended') >= 0) {
        referencePosition = position;
      }
    });
    var reference = referencePosition >= 0 ? this.solutions[referencePosition] : null;

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
        (badges.length ? ' — ' + badges.map(function (id) { return Evaluator.label(id, intent); }).join(', ') : ''));

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
        return '<span class="recommendation-badge ' + id + '">' + (id === 'recommended' ? '★ ' : '') + Evaluator.label(id, intent) + '</span>';
      }).join('');
      var origin = s.origin === 'variante' ? '<span class="recommendation-badge variant">Variante</span>' : '';
      var architecture = (s.stages || []).map(function (x) { return familyName(x.type, 'short'); }).join(' → ');
      // Choix 13C : la carte dit aussi si la solution TIENT les contraintes.
      var violations = annotation.compliance[poolIndexOf(position)] || (preferences ? [] : null);
      var why = Evaluator.explain(s, badges, violations, intent);

      var deltas = reference && s !== reference ? deltaMarkup(s, reference, linear) : {};
      var referenceMark = s === reference ? '<span class="solution-reference">— référence —</span>' : '';
      var verdict = assessment ? assessment.byIndex[poolIndexOf(position)] : null;

      tile.innerHTML =
        '<header class="solution-card-head">' + badgeMarkup + origin +
          '<button class="tile-pin" title="Épingler pour comparer" aria-pressed="false">☆</button></header>' +
        '<h3 class="solution-architecture">' + architecture + referenceMark + '</h3>' +
        '<div class="solution-metrics">' + metrics.map(function (metric) {
          return '<span class="metric' + (metric[2] ? ' metric-primary' : ' metric-secondary') + '">' +
            '<small>' + metric[0] + '</small><strong>' + metric[1] + '</strong>' +
            (deltas[metric[0]] || '') + '</span>';
        }).join('') + '</div>' +
        // §22 : la carte est entièrement cliquable, au clavier compris. Un
        // bouton « Voir » en pied faisait exactement la même chose, et une
        // seconde action pour un seul geste se lit comme deux choix possibles.
        (why ? '<p class="solution-why">' + why + '</p>' : '') +
        tradeMarkup(verdict) + alertMarkup(verdict) + uncertaintyMarkup(verdict);

      function select() {
        self.selected = index;
        self.bus.emit('solution:selected', { index: index, solution: s });
        // §27 : choisir une solution, c'est demander à la voir. La sélection
        // AUTOMATIQUE du premier résultat, elle, ne demande rien — basculer
        // dessus cacherait la liste avant qu'on l'ait lue.
        if (window.matchMedia('(max-width: 1000px)').matches) self.showMobilePane('viewer');
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
    this._refreshDetailTabs();
  };

  /**
   * §16 : ce qu'une solution gagne ou perd face à la référence, métrique par
   * métrique. `better` dit dans quel sens va le mieux : un Ø plus petit est un
   * gain, un rendement plus petit une perte, et confondre les deux rendrait
   * l'écart illisible.
   */
  var DELTA_METRICS = {
    'Rendement': { read: function (s) { return s.efficiency * 100; }, digits: 1, unit: ' pt', better: 'up' },
    'Couple': { read: function (s) { return s.outputTorqueNm; }, digits: 1, unit: ' N·m', better: 'up' },
    'Ø max': { read: function (s) { return s.dimensions && s.dimensions.maxDiameter; }, digits: 0, unit: ' mm', better: 'down' },
    'Étages': { read: function (s) { return (s.stages || []).length; }, digits: 0, unit: '', better: 'down' },
    'Force': { read: function (s) { return s.outputForceN; }, digits: 1, unit: ' N', better: 'up' },
    'Ø pignon': { read: function (s) { return s.dimensions && s.dimensions.maxDiameter; }, digits: 1, unit: ' mm', better: 'down' }
  };

  /**
   * §9 : CE QU'ON GAGNE, ET CE QU'ON PERD.
   *
   * La carte disait « Plus compacte. » et s'arrêtait là. Une aide au choix doit
   * répondre à deux questions : pourquoi la prendre, et qu'est-ce qu'on perd en
   * la prenant. Les deux viennent du même endroit — l'évaluation —, la carte
   * ne fait que les écrire.
   */
  function tradeMarkup(verdict) {
    if (!verdict || (!verdict.strengths.length && !verdict.compromises.length)) return '';
    function line(items, css, title) {
      if (!items.length) return '';
      return '<span class="' + css + '"><small>' + title + '</small>' +
        items.slice(0, 3).map(function (item) { return '<em>' + escapeText(item.text) + '</em>'; }).join('') + '</span>';
    }
    return '<p class="solution-trades">' +
      line(verdict.strengths, 'trade-gain', 'Gagne') +
      line(verdict.compromises, 'trade-loss', 'Perd') + '</p>';
  }

  /**
   * §13/§20 : trois alertes s'affichaient, sans dire qu'il en existait
   * d'autres, et un compteur ne distingue pas un refus d'une réserve. Les plus
   * graves d'abord, et le reste est annoncé.
   */
  function alertMarkup(verdict) {
    var alerts = verdict && verdict.alerts;
    if (!alerts || !alerts.list.length) return '';
    var shown = alerts.list.slice(0, 3).map(function (entry) {
      return '<span class="solution-alert level-' + entry.level + '" title="' +
        escapeText(entry.advice || '') + '">' + entry.mark + ' ' + escapeText(entry.label) + '</span>';
    }).join('');
    var rest = alerts.list.length - 3;
    return '<p class="solution-alerts">' + shown +
      (rest > 0 ? '<span class="solution-alert-more">+ ' + rest + ' autre' + (rest > 1 ? 's' : '') + '</span>' : '') +
      '</p>';
  }

  /**
   * §5/§11 : ce qui n'a PAS été vérifié. Une courroie sans contrôle de flexion
   * valait 0,5 dans le front — ni avantage ni pénalité, et surtout invisible.
   */
  function uncertaintyMarkup(verdict) {
    var uncertainty = verdict && verdict.uncertainty;
    if (!uncertainty || !uncertainty.mechanical.length) return '';
    return '<p class="solution-uncertainty" title="Non vérifié n’est pas conforme.">· ' +
      escapeText(uncertainty.mechanical.slice(0, 2).join(', ')) +
      (uncertainty.mechanical.length > 2 ? ' (+' + (uncertainty.mechanical.length - 2) + ')' : '') +
      ' non évalué' + (uncertainty.mechanical.length > 1 ? 's' : '') + '</p>';
  }

  function escapeText(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function deltaMarkup(solution, reference) {
    var out = {};
    Object.keys(DELTA_METRICS).forEach(function (name) {
      var spec = DELTA_METRICS[name];
      var mine = spec.read(solution), theirs = spec.read(reference);
      if (!Number.isFinite(mine) || !Number.isFinite(theirs)) return;
      var gap = mine - theirs;
      var rounded = Math.round(gap * Math.pow(10, spec.digits)) / Math.pow(10, spec.digits);
      if (!rounded) return;
      var good = spec.better === 'up' ? rounded > 0 : rounded < 0;
      out[name] = '<span class="metric-delta ' + (good ? 'delta-better' : 'delta-worse') + '">' +
        (rounded > 0 ? '+' : '−') + Math.abs(rounded).toFixed(spec.digits) + spec.unit + '</span>';
    });
    return out;
  }

  /**
   * §25 : « Comparer » n'a de sens qu'avec des solutions épinglées,
   * « Graphiques » qu'avec un vivier à tracer, et « Journal » relève du
   * diagnostic. Les montrer toujours faisait payer cinq onglets pour deux.
   */
  Workbench.prototype._refreshDetailTabs = function () {
    var tabs = document.querySelector('.detail-tabs');
    if (!tabs) return;
    var pinned = (this._pinnedUids || []).length;
    var pool = this.solutions ? this.solutions.length : 0;
    var visible = { comparer: pinned > 1, graphiques: pool > 0, journal: false };
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-detail]'), function (button) {
      var id = button.dataset.detail;
      if (!(id in visible)) return;
      button.hidden = !visible[id];
      // Un onglet qui disparaît ne doit pas laisser son panneau actif.
      if (button.hidden && button.classList.contains('active')) {
        var first = tabs.querySelector('[data-detail="analyse"]');
        if (first) first.click();
      }
    });
    var actions = el('detailActions');
    if (actions) actions.hidden = this.selected == null || pool === 0;
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
      // §29 : l'état vide dit quoi faire ET permet de le faire. Renvoyer vers
      // « le panneau de gauche » ne menait nulle part depuis qu'il a disparu.
      if (actions) {
        actions.textContent = '';
        var open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn-primary';
        open.id = 'openSearchFromEmpty';
        open.textContent = 'Définir la recherche';
        open.addEventListener('click', function () { if (self.modal) self.modal.open(); });
        actions.appendChild(open);
        actions.hidden = false;
      }
      return;
    }

    if (title) title.textContent = 'Aucune architecture ne respecte toutes les contraintes';
    if (blockers) { blockers.textContent = ''; blockers.hidden = true; }
    if (actions) { actions.textContent = ''; actions.hidden = true; }

    // Choix 14C : quand la sonde a tourné, on ne LISTE plus des suspects — on
    // nomme le blocage, on mesure l'écart et on chiffre l'assouplissement.
    var diagnosis = info.diagnosis;
    if (diagnosis) {
      if (hint) hint.textContent = diagnosis.text;
      if (diagnosis.blocker && diagnosis.blocker.unlocked > 0 && actions) {
        var accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'btn-primary';
        accept.id = 'acceptRelaxationBtn';
        accept.dataset.field = diagnosis.blocker.key;
        accept.dataset.value = String(diagnosis.blocker.suggested);
        accept.textContent = 'Accepter ' + diagnosis.blocker.suggested +
          (diagnosis.blocker.meta.unit ? ' ' + diagnosis.blocker.meta.unit : '');
        accept.addEventListener('click', function () {
          self.session.preferences = diagnosis.blocker.preferences;
          self.session._advice = null;
          self._refreshConfigurationFlow();
          var start = el('startStopBtn');
          if (start) start.click();
        });
        actions.appendChild(accept);
        actions.hidden = false;
      }
      if (diagnosis.candidates && diagnosis.candidates.length > 1 && blockers) {
        diagnosis.candidates.slice(1, 4).forEach(function (candidate) {
          var item = document.createElement('li');
          item.textContent = candidate.meta.label + ' : au mieux ' + candidate.achieved +
            (candidate.meta.unit ? ' ' + candidate.meta.unit : '') + ' contre ' + candidate.limit + ' demandé.';
          blockers.appendChild(item);
        });
        blockers.hidden = false;
      }
      return;
    }

    var reason = info.stats.reason;
    if (hint) {
      hint.textContent = reason === 'NO_CANDIDATES'
        ? 'Aucun candidat d’étage n’a pu être généré : les plages de dents ou les technologies autorisées sont trop étroites.'
        : reason === 'NO_MODULES'
          ? 'Aucun module à tester : renseignez un module fixe valide ou une plage de modules automatique.'
          : 'La recherche a exploré le domaine autorisé sans trouver de solution valide.';
    }
    var suspects = this.session ? this.session.preferences.constraints() : [];
    if (blockers && suspects.length) {
      suspects.slice(0, 4).forEach(function (entry) {
        var item = document.createElement('li');
        item.textContent = entry.meta.label + ' ' + entry.quantity.describe();
        blockers.appendChild(item);
      });
      blockers.hidden = false;
    }
    if (actions && suspects.length) {
      suspects.slice(0, 4).forEach(function (entry) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-small';
        button.textContent = 'Lever « ' + entry.meta.label + ' »';
        button.addEventListener('click', function () {
          self.session.preferences.drop(entry.key);
          self._refreshConfigurationFlow();
        });
        actions.appendChild(button);
      });
      actions.hidden = false;
    }
  };
  Workbench.prototype._markSelected = function () {
    var self = this;
    document.querySelectorAll('.solution-card').forEach(function (tile) {
      tile.classList.toggle('selected', tile.dataset.index === String(self.selected));
    });
  };

  GearApp.ui.Workbench = Workbench;

})(GearApp);
