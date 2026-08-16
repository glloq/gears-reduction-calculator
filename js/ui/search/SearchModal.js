// SearchModal.js - L'éditeur principal de la recherche (§2, §12, §13, §18).
//
// L'écran principal n'est plus un formulaire de configuration : il montre des
// solutions. Tout ce qui définit la recherche vit ici, en trois étapes
// obligatoires et une section technique facultative :
//
//   1. Type      comment choisir les technologies
//   2. Besoin    entrée, sortie, rapport
//   3. Critères  contraintes, priorités, fabrication
//
// §18 : le modal édite un BROUILLON cloné de la session. Annuler le jette,
// « Rechercher » le promeut. Sans cela, une édition abandonnée laisserait les
// résultats, le viewer, les chips, les exports et l'URL décrire un besoin qui
// n'est plus celui affiché.
//
// Le markup n'est pas dupliqué : les panneaux techniques historiques sont
// DÉPLACÉS dans le modal à l'ouverture. Aucun identifiant n'est perdu, donc
// SearchParams, les presets et les URLs partagées gardent leur contrat.
(function (GearApp) {
  'use strict';

  var STEPS = [
    { id: 'type', label: 'Type' },
    { id: 'need', label: 'Besoin' },
    { id: 'criteria', label: 'Critères' }
  ];

  function el(id) { return document.getElementById(id); }

  function node(tag, className, html) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (html != null) element.innerHTML = html;
    return element;
  }

  function SearchModal(options) {
    options = options || {};
    this.session = options.session;
    this.onSearch = options.onSearch || function () {};
    this.onClose = options.onClose || function () {};
    this.draft = null;
    this.step = 0;
    this._build();
  }

  // ===== Construction =====

  SearchModal.prototype._build = function () {
    var self = this;
    var root = node('div', 'search-modal');
    root.id = 'searchModal';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'searchModalTitle');

    var backdrop = node('div', 'search-modal-backdrop');
    backdrop.addEventListener('click', function () { self.cancel(); });
    root.appendChild(backdrop);

    var panel = node('div', 'search-modal-panel');

    var header = node('header', 'search-modal-header');
    var title = node('h2', null, 'Nouvelle transmission');
    title.id = 'searchModalTitle';
    header.appendChild(title);
    var close = node('button', 'search-modal-close', '×');
    close.type = 'button';
    close.id = 'searchModalClose';
    close.setAttribute('aria-label', 'Fermer');
    close.addEventListener('click', function () { self.cancel(); });
    header.appendChild(close);
    panel.appendChild(header);

    var body = node('div', 'search-modal-body');

    var nav = node('nav', 'search-modal-steps');
    nav.id = 'searchModalSteps';
    nav.setAttribute('aria-label', 'Étapes');
    STEPS.forEach(function (step, index) {
      var button = node('button', 'search-step', '<span class="search-step-index">' + (index + 1) + '</span>' + step.label);
      button.type = 'button';
      button.dataset.step = step.id;
      button.addEventListener('click', function () { self.goTo(index); });
      nav.appendChild(button);
    });
    body.appendChild(nav);

    var content = node('div', 'search-modal-content');
    content.id = 'searchModalContent';
    this.panes = {};
    STEPS.forEach(function (step) {
      var pane = node('section', 'search-pane');
      pane.dataset.pane = step.id;
      pane.hidden = true;
      content.appendChild(pane);
      self.panes[step.id] = pane;
    });
    body.appendChild(content);

    var summary = node('aside', 'search-modal-summary');
    summary.id = 'searchModalSummary';
    summary.setAttribute('aria-label', 'Votre recherche');
    body.appendChild(summary);

    panel.appendChild(body);

    var footer = node('footer', 'search-modal-footer');
    this.backButton = node('button', 'btn-small', 'Retour');
    this.backButton.type = 'button';
    this.backButton.id = 'searchModalBack';
    this.backButton.addEventListener('click', function () { self.goTo(self.step - 1); });
    footer.appendChild(this.backButton);

    var spacer = node('span', 'search-modal-spacer');
    footer.appendChild(spacer);

    this.nextButton = node('button', 'btn-small', 'Suivant');
    this.nextButton.type = 'button';
    this.nextButton.id = 'searchModalNext';
    this.nextButton.addEventListener('click', function () { self.goTo(self.step + 1); });
    footer.appendChild(this.nextButton);

    this.searchButton = node('button', 'btn-primary', 'Rechercher les solutions');
    this.searchButton.type = 'button';
    this.searchButton.id = 'searchModalSubmit';
    this.searchButton.addEventListener('click', function () { self.submit(); });
    footer.appendChild(this.searchButton);
    panel.appendChild(footer);

    root.appendChild(panel);
    document.body.appendChild(root);
    this.root = root;

    document.addEventListener('keydown', function (event) {
      if (root.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); self.cancel(); }
    });

    this._buildPanes();
  };

  /**
   * Le contenu des étapes 2 et 3 est du markup neuf ; les panneaux techniques
   * historiques sont déplacés depuis la page, ce qui préserve leurs
   * identifiants et tout ce qui les lit.
   */
  SearchModal.prototype._buildPanes = function () {
    var need = this.panes.need;
    need.appendChild(node('div', 'requirement-shortcuts')).id = 'requirementShortcuts';
    need.appendChild(node('div', 'requirement-sheet')).id = 'requirementSheet';
    var add = node('div', 'constraint-add');
    var addButton = node('button', 'btn-add-constraint', '+ Ajouter une donnée');
    addButton.type = 'button';
    addButton.id = 'addQuantityBtn';
    addButton.setAttribute('aria-expanded', 'false');
    addButton.setAttribute('aria-controls', 'quantityMenu');
    add.appendChild(addButton);
    var menu = node('div', 'constraint-menu');
    menu.id = 'quantityMenu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    add.appendChild(menu);
    need.appendChild(add);
    var derived = document.createElement('output');
    derived.id = 'derivedRatio';
    derived.className = 'derived-ratio';
    need.appendChild(derived);
    var diagnostic = node('p', 'requirement-diagnostic');
    diagnostic.id = 'requirementDiagnostic';
    diagnostic.setAttribute('aria-live', 'polite');
    need.appendChild(diagnostic);
    var levels = node('div', 'analysis-levels');
    levels.id = 'analysisLevels';
    need.appendChild(levels);

    var criteria = this.panes.criteria;
    criteria.appendChild(node('h3', null, 'Contraintes et préférences'));
    var chips = node('div', 'constraint-chips');
    chips.id = 'constraintChips';
    chips.hidden = true;
    chips.setAttribute('aria-live', 'polite');
    criteria.appendChild(chips);
    var criteriaAdd = node('div', 'constraint-add');
    var criteriaButton = node('button', 'btn-add-constraint', '+ Ajouter une contrainte<span class="constraint-count" hidden></span>');
    criteriaButton.type = 'button';
    criteriaButton.id = 'addConstraintBtn';
    criteriaButton.setAttribute('aria-expanded', 'false');
    criteriaButton.setAttribute('aria-controls', 'constraintMenu');
    criteriaAdd.appendChild(criteriaButton);
    var criteriaMenu = node('div', 'constraint-menu');
    criteriaMenu.id = 'constraintMenu';
    criteriaMenu.hidden = true;
    criteriaMenu.setAttribute('role', 'menu');
    criteriaAdd.appendChild(criteriaMenu);
    criteria.appendChild(criteriaAdd);

    criteria.appendChild(node('h3', null, 'Qu’est-ce qui compte le plus ?'));
    var priorities = node('div', 'priority-chips');
    priorities.id = 'priorityChips';
    priorities.setAttribute('role', 'radiogroup');
    priorities.setAttribute('aria-label', 'Priorité principale');
    criteria.appendChild(priorities);
    var secondaryToggle = node('button', 'btn-link', '+ priorité secondaire');
    secondaryToggle.type = 'button';
    secondaryToggle.id = 'secondaryPriorityToggle';
    criteria.appendChild(secondaryToggle);
    var secondary = node('div', 'priority-secondary');
    secondary.id = 'prioritySecondary';
    secondary.hidden = true;
    criteria.appendChild(secondary);

    criteria.appendChild(node('h3', null, 'Comment sera-t-il fabriqué ?'));
    var fabrication = node('div', 'fabrication-options');
    fabrication.id = 'fabricationOptions';
    fabrication.setAttribute('role', 'radiogroup');
    criteria.appendChild(fabrication);

    var advanced = node('details', 'advanced-settings');
    advanced.id = 'modalAdvanced';
    advanced.appendChild(node('summary', null, 'Options techniques avancées'));
    var advancedBody = node('div', 'advanced-body');
    advancedBody.id = 'modalAdvancedBody';
    // §15 : les paramètres propres aux familles explorées viennent EN PREMIER,
    // avant les panneaux génériques : ce sont ceux qui concernent ce projet.
    var typeParams = node('div', 'type-parameters-host');
    typeParams.id = 'typeParametersHost';
    advancedBody.appendChild(typeParams);
    advanced.appendChild(advancedBody);
    criteria.appendChild(advanced);
  };

  /** Déplace les panneaux techniques historiques dans le modal, une seule fois. */
  SearchModal.prototype.adoptLegacyPanels = function () {
    var host = el('modalAdvancedBody');
    if (!host) return this;
    ['panel-avance-racine', 'technologyPanel'].forEach(function (id) {
      var panel = el(id);
      if (panel && panel.parentElement !== host) host.appendChild(panel);
    });
    return this;
  };

  // ===== Cycle de vie =====

  SearchModal.prototype.open = function (step) {
    this.draft = this.session.draft();
    this.step = typeof step === 'number' ? step : 0;
    this.root.hidden = false;
    document.body.classList.add('modal-open');
    this.adoptLegacyPanels();
    this._mount();
    this.render();
    var first = this.root.querySelector('.search-pane:not([hidden]) button, .search-pane:not([hidden]) input');
    if (first && first.focus) first.focus();
    return this;
  };

  SearchModal.prototype.cancel = function () {
    // Le brouillon est jeté : la recherche affichée n'a jamais bougé.
    this.draft = null;
    this.root.hidden = true;
    document.body.classList.remove('modal-open');
    this.onClose();
    return this;
  };

  SearchModal.prototype.submit = function () {
    if (!this.draft || !this.draft.isReady()) { this.render(); return this; }
    this.session.adopt(this.draft);
    this.draft = null;
    this.root.hidden = true;
    document.body.classList.remove('modal-open');
    this.onSearch();
    return this;
  };

  SearchModal.prototype.goTo = function (index) {
    this.step = Math.max(0, Math.min(STEPS.length - 1, index));
    this.render();
    return this;
  };

  SearchModal.prototype.isOpen = function () { return !this.root.hidden; };

  // ===== Montage des éditeurs =====

  SearchModal.prototype._mount = function () {
    var self = this, refresh = function (structural) { self.render(structural); };
    if (!this.typeStep) {
      this.typeStep = new GearApp.ui.TypeStep(this.panes.type, this.draft, refresh);
      this.sheet = new GearApp.ui.RequirementSheet(this.draft, refresh);
      this.sheet.bind();
      this.chips = new GearApp.ui.ConstraintChips(this.draft, refresh);
      this.chips.bind();
      this.typeParameters = new GearApp.ui.TypeParametersEditor(el('typeParametersHost'), this.draft, refresh);
      this._bindPriorities(refresh);
      this._bindFabrication(refresh);
    }
    this.typeStep.setDraft(this.draft);
    this.sheet.session = this.draft;
    this.chips.session = this.draft;
    this.typeParameters.setDraft(this.draft);
  };

  SearchModal.prototype._bindPriorities = function (refresh) {
    var self = this, axes = GearApp.requirements.preferences.AXES;
    var host = el('priorityChips'), secondaryHost = el('prioritySecondary'), toggle = el('secondaryPriorityToggle');

    function chip(axis, container, isSecondary) {
      var preferences = self.draft.preferences;
      var active = isSecondary ? preferences.secondary === axis.id : preferences.primary === axis.id;
      var button = node('button', 'priority-chip' + (isSecondary ? ' priority-chip-secondary' : ' priority-chip-primary') + (active ? ' active' : ''), axis.label);
      button.type = 'button';
      button.dataset.axis = axis.id;
      button.title = axis.help;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(active));
      button.addEventListener('click', function () {
        if (isSecondary) preferences.secondary = preferences.secondary === axis.id ? null : axis.id;
        else preferences.primary = axis.id;
        refresh();
      });
      container.appendChild(button);
    }

    if (toggle) toggle.addEventListener('click', function () {
      secondaryHost.hidden = !secondaryHost.hidden;
      toggle.setAttribute('aria-expanded', String(!secondaryHost.hidden));
      refresh();
    });

    this._renderPriorities = function () {
      host.textContent = '';
      secondaryHost.textContent = '';
      axes.forEach(function (axis) { chip(axis, host, false); });
      axes.forEach(function (axis) { chip(axis, secondaryHost, true); });
      // La secondaire ne s'impose pas : elle n'apparaît que si elle sert (§10).
      if (self.draft.preferences.secondary) secondaryHost.hidden = false;
      toggle.hidden = !secondaryHost.hidden;
    };
  };

  var PROCESSES = [
    { id: 'standard', label: 'Non défini / standard' },
    { id: 'printing3d', label: 'Impression 3D' },
    { id: 'machining', label: 'Usinage CNC' },
    { id: 'cutting', label: 'Découpe' }
  ];

  SearchModal.prototype._bindFabrication = function (refresh) {
    var self = this, host = el('fabricationOptions');
    this._renderFabrication = function () {
      host.textContent = '';
      PROCESSES.forEach(function (process) {
        var active = self.draft.requirement.fabrication.process === process.id;
        var button = node('button', 'fabrication-option' + (active ? ' active' : ''), process.label);
        button.type = 'button';
        button.dataset.process = process.id;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', String(active));
        button.addEventListener('click', function () {
          self.draft.requirement.fabrication.process = process.id;
          self.draft.technical.set('manufacturing', 'process', process.id);
          self.draft.invalidate();
          refresh();
        });
        host.appendChild(button);
      });
    };
  };

  // ===== Rendu =====

  SearchModal.prototype.render = function (structural) {
    if (!this.draft) return this;
    var self = this;
    STEPS.forEach(function (step, index) {
      self.panes[step.id].hidden = index !== self.step;
      var button = self.root.querySelector('[data-step="' + step.id + '"]');
      button.classList.toggle('active', index === self.step);
      button.setAttribute('aria-current', index === self.step ? 'step' : 'false');
    });

    if (this.step === 0) this.typeStep.render();
    if (this.step === 1 && structural !== false) this.sheet.render();
    if (this.step === 2) {
      if (structural !== false) this.chips.render();
      this._renderPriorities();
      this._renderFabrication();
      this.typeParameters.render();
    }
    this._renderAnalysisLevels();
    this._renderSummary();

    this.backButton.disabled = this.step === 0;
    this.nextButton.hidden = this.step === STEPS.length - 1;
    this.searchButton.disabled = !this.draft.isReady();
    this.searchButton.title = this.draft.isReady() ? '' : 'Complétez le besoin pour lancer la recherche';
    return this;
  };

  /** §7 : dire ce qui sera calculable, plutôt qu'exiger vingt paramètres. */
  SearchModal.prototype._renderAnalysisLevels = function () {
    var host = el('analysisLevels');
    if (!host) return;
    host.textContent = '';
    var title = node('h4', null, 'Analyse disponible');
    host.appendChild(title);
    this.draft.analysisLevels().forEach(function (level) {
      var line = node('p', 'analysis-level analysis-' + (level.available ? 'ok' : 'partial'));
      line.dataset.level = level.id;
      line.textContent = (level.available ? '✓ ' : '△ ') + level.label + (level.missing ? ' — ' + level.missing : '');
      host.appendChild(line);
    });
  };

  SearchModal.prototype._renderSummary = function () {
    var host = el('searchModalSummary');
    if (!host) return;
    host.textContent = '';
    host.appendChild(node('h3', null, 'Votre recherche'));
    var list = node('ul', 'search-summary-list');
    this.draft.summarise().forEach(function (line) {
      var item = document.createElement('li');
      item.textContent = line;
      list.appendChild(item);
    });
    host.appendChild(list);

    var ready = this.draft.isReady();
    var state = node('p', 'search-summary-state ' + (ready ? 'ready' : 'blocked'));
    state.id = 'searchSummaryState';
    if (ready) {
      state.textContent = '✓ prêt';
    } else {
      var blocking = this.draft.diagnose().filter(function (note) { return note.level === 'error'; });
      state.textContent = blocking.length ? blocking[0].text : 'Complétez votre besoin.';
    }
    host.appendChild(state);
  };

  GearApp.ui.SearchModal = SearchModal;
  SearchModal.STEPS = STEPS;
  SearchModal.PROCESSES = PROCESSES;

})(GearApp);
