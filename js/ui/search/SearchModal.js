// SearchModal.js - L'éditeur principal de la recherche (§2, §12, §13, §18).
//
// L'écran principal n'est plus un formulaire de configuration : il montre des
// solutions. Tout ce qui définit la recherche vit ici, en trois étapes
// obligatoires et une section technique facultative :
//
//   1. Recherche  ce qu'on cherche, et comment choisir les technologies
//   2. Besoin     entrée, sortie, rapport
//   3. Affiner    contraintes, priorités, fabrication
//
// §18 : le modal édite un BROUILLON cloné de la session. Annuler le jette,
// « Rechercher » le promeut. Sans cela, une édition abandonnée laisserait les
// résultats, le viewer, les chips, les exports et l'URL décrire un besoin qui
// n'est plus celui affiché.
//
// L'ancien formulaire ne remonte plus ici : il reste dans la page, caché, comme
// miroir de compatibilité pour SearchParams, les presets et les URLs partagées.
// Ce qu'il portait seul a maintenant son propre éditeur, branché sur le modèle.
(function (GearApp) {
  'use strict';

  // « Type » ne décrivait plus l'étape depuis qu'elle commence par « que
  // cherchez-vous ? » et porte la stratégie, la technologie et l'architecture.
  var STEPS = [
    { id: 'type', label: 'Recherche' },
    { id: 'need', label: 'Besoin' },
    { id: 'criteria', label: 'Affiner' }
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
    // §27 : sur téléphone, le résumé prenait jusqu'à 30 % de la hauteur pour
    // une information secondaire. Il se replie en une barre d'une ligne, que
    // l'on déplie d'une tape. Sur grand écran, la barre n'existe pas.
    this.summaryBar = node('button', 'summary-bar', '');
    this.summaryBar.type = 'button';
    this.summaryBar.id = 'summaryToggle';
    this.summaryBar.addEventListener('click', function () {
      summary.classList.toggle('summary-open');
      self.summaryBar.setAttribute('aria-expanded', String(summary.classList.contains('summary-open')));
    });
    summary.appendChild(this.summaryBar);
    // §23 : les niveaux d'analyse étaient affichés DEUX fois — dans l'étape
    // Besoin et dans le résumé. Ils n'ont leur place qu'ici, où ils restent
    // visibles quelle que soit l'étape en cours.
    var levels = node('div', 'analysis-levels');
    levels.id = 'analysisLevels';
    summary.appendChild(levels);

    panel.appendChild(body);

    var footer = node('footer', 'search-modal-footer');
    this.backButton = node('button', 'btn-small', 'Retour');
    this.backButton.type = 'button';
    this.backButton.id = 'searchModalBack';
    this.backButton.addEventListener('click', function () { self.goTo(self.step - 1); });
    footer.appendChild(this.backButton);

    var spacer = node('span', 'search-modal-spacer');
    footer.appendChild(spacer);

    // §16 : « 500 000 itérations » ne méritait pas une section entière, mais
    // savoir ce qui va réellement partir au moteur mérite d'être sous les yeux
    // au moment de cliquer.
    this.context = node('span', 'search-modal-context');
    this.context.id = 'searchModalContext';
    footer.appendChild(this.context);

    this.nextButton = node('button', 'btn-small', 'Continuer');
    this.nextButton.type = 'button';
    this.nextButton.id = 'searchModalNext';
    this.nextButton.addEventListener('click', function () { self.goTo(self.step + 1); });
    footer.appendChild(this.nextButton);

    // §10 : « 1500 rpm → 100 rpm » n'a rien à affiner. Le bouton reste offert,
    // il cesse simplement d'être un passage obligé.
    this.refineButton = node('button', 'btn-small', 'Affiner…');
    this.refineButton.type = 'button';
    this.refineButton.id = 'searchModalRefine';
    this.refineButton.addEventListener('click', function () { self.goTo(STEPS.length - 1); });
    footer.appendChild(this.refineButton);

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
      // §28 : sans piège de focus, la tabulation sort du dialogue et parcourt
      // une page qu'on ne voit pas. `aria-modal` le dit aux lecteurs d'écran ;
      // il ne l'impose pas au clavier.
      if (event.key === 'Tab') self._trapFocus(event);
    });

    this._buildPanes();
  };

  /**
   * Tout le contenu des étapes est du markup neuf, branché sur les modèles.
   * Les identifiants historiques ne vivent plus que dans la page cachée.
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

    // §12 à §16 : l'étape 3 était devenue un second formulaire expert — cinq
    // grands blocs déroulés en permanence pour des réglages que la plupart des
    // recherches ne touchent jamais. Ils deviennent cinq LIGNES, chacune
    // annonçant sa valeur courante et ne s'ouvrant que si on le demande.
    criteria.appendChild(node('h3', null, 'Autres options'));
    var rows = node('div', 'option-rows');
    rows.id = 'optionRows';
    criteria.appendChild(rows);

    var self = this;
    this._optionOpen = {};
    OPTION_ROWS.forEach(function (entry) {
      var row = node('div', 'option-row');
      row.dataset.option = entry.key;
      var head = node('button', 'option-row-head',
        '<span class="option-row-label">' + entry.label + '</span>' +
        '<span class="option-row-value"></span><span class="option-row-mark">›</span>');
      head.type = 'button';
      head.dataset.option = entry.key;
      head.setAttribute('aria-expanded', 'false');
      head.addEventListener('click', function () {
        self._optionOpen[entry.key] = !self._optionOpen[entry.key];
        self.render(false);
      });
      row.appendChild(head);
      var body = node('div', 'option-row-body');
      body.dataset.optionBody = entry.key;
      body.hidden = true;
      entry.hosts.forEach(function (host) {
        var node_ = node('div', host.className);
        node_.id = host.id;
        if (host.role) node_.setAttribute('role', host.role);
        body.appendChild(node_);
      });
      row.appendChild(body);
      rows.appendChild(row);
    });
  };

  /**
   * Les cinq réglages secondaires de l'étape 3. Chacun dit ce qu'il vaut
   * aujourd'hui : « Standard », « Aucune », « Non définie » — de quoi savoir
   * qu'il n'y a rien à y faire sans avoir à l'ouvrir.
   */
  var OPTION_ROWS = [
    { key: 'fabrication', label: 'Fabrication',
      hosts: [{ id: 'fabricationOptions', className: 'fabrication-options', role: 'radiogroup' }] },
    { key: 'parts', label: 'Pièces disponibles',
      hosts: [{ id: 'partsOptions', className: 'parts-options' }] },
    { key: 'service', label: 'Usage et durée de vie',
      hosts: [{ id: 'serviceOptions', className: 'service-options' }] },
    { key: 'depth', label: 'Recherche',
      hosts: [{ id: 'depthOptions', className: 'depth-options', role: 'radiogroup' }] },
    // §15 : les paramètres propres aux familles explorées viennent EN PREMIER,
    // avant les réglages génériques : ce sont ceux qui concernent ce projet.
    { key: 'technical', label: 'Paramètres techniques',
      hosts: [{ id: 'typeParametersHost', className: 'type-parameters-host' },
        { id: 'technicalSettingsHost', className: 'technical-settings' }] }
  ];

  /**
   * §20 : l'ancien formulaire ne remonte plus dans le modal. Il restait le plus
   * gros reliquat de l'UI précédente — sliders, panneaux numérotés, doublons de
   * tout ce que le modal propose déjà — et le montrer revenait à demander deux
   * fois la même chose, dans deux langages différents.
   *
   * Les contrôles historiques restent dans la page, cachés : ce sont les
   * MIROIRS que `SearchParams.fromForm`, les presets et les URLs partagées
   * lisent encore. Ce qu'ils portaient d'irremplaçable — matériaux, module,
   * arbres, limites de fabrication — a désormais son propre éditeur ci-dessous.
   */
  SearchModal.prototype.releaseLegacyPanels = function () {
    var host = el('legacyHost');
    if (!host) return this;
    ['panel-avance-racine', 'technologyPanel'].forEach(function (id) {
      var panel = el(id);
      if (panel && panel.parentElement !== host) host.appendChild(panel);
    });
    return this;
  };

  /**
   * Les réglages qui n'ont pas d'autre place, édités sur le MODÈLE et non sur
   * l'ancien formulaire. Chaque entrée dit son groupe et sa clé dans
   * `TechnicalSettingsModel` : aucun identifiant historique n'est en jeu ici.
   */
  var TECHNICAL_GROUPS = [
    { label: 'Matériaux', fields: [
      { group: 'materials', key: 'input', label: 'Pignon', type: 'select', options: 'materials' },
      { group: 'materials', key: 'output', label: 'Roue', type: 'select', options: 'materials' }
    ] },
    { label: 'Module', fields: [
      { group: 'module', key: 'mode', label: 'Choix du module', type: 'select', options: [
        { value: 'fixed', label: 'imposé' }, { value: 'automatic', label: 'automatique' }
      ] },
      { group: 'module', key: 'min', label: 'Module auto min', type: 'number', min: 0.1, step: 0.1, blank: true },
      { group: 'module', key: 'max', label: 'Module auto max', type: 'number', min: 0.1, step: 0.1, blank: true }
    ] },
    { label: 'Arbres', fields: [
      { group: 'shaft', key: 'supportDistanceMm', label: 'Portée entre paliers', unit: 'mm', type: 'number', min: 0, step: 1, blank: true },
      { group: 'shaft', key: 'allowableShearMPa', label: 'Cisaillement admissible', unit: 'MPa', type: 'number', min: 1, step: 1 }
    ] },
    { label: 'Limites de fabrication', fields: [
      { group: 'manufacturing', key: 'minimumModule', label: 'Module minimum', unit: 'mm', type: 'number', min: 0, step: 0.05, blank: true },
      { group: 'manufacturing', key: 'minimumTeeth', label: 'Dents minimum', type: 'number', min: 0, step: 1, blank: true },
      { group: 'manufacturing', key: 'minimumFaceWidth', label: 'Largeur minimum', unit: 'mm', type: 'number', min: 0, step: 0.5, blank: true },
      { group: 'manufacturing', key: 'printerDiameter', label: 'Plateau d’impression', unit: 'mm', type: 'number', min: 0, step: 10, blank: true },
      { group: 'manufacturing', key: 'additiveDerating', label: 'Abattement imprimé', type: 'number', min: 0.1, max: 1, step: 0.05 }
    ] }
  ];

  SearchModal.prototype._bindTechnical = function (refresh) {
    var self = this, host = el('technicalSettingsHost');

    this._renderTechnical = function () {
      host.textContent = '';
      TECHNICAL_GROUPS.forEach(function (group) {
        var block = node('div', 'technical-group');
        block.dataset.group = group.label;
        block.appendChild(node('h4', null, group.label));
        var grid = node('div', 'technical-grid');
        group.fields.forEach(function (field) {
          grid.appendChild(technicalField(self.draft.technical, field, function () {
            self.draft.invalidate();
            refresh(false);
          }));
        });
        block.appendChild(grid);
        host.appendChild(block);
      });
    };
  };

  /** Matériaux connus du moteur : le catalogue fait foi, pas une liste recopiée. */
  function materialOptions() {
    var materials = (GearApp.core && GearApp.core.Engineering && GearApp.core.Engineering.materials) ||
      (typeof GearEngineering !== 'undefined' && GearEngineering.materials) || {};
    return Object.keys(materials).map(function (id) {
      return { value: id, label: materials[id].label || materials[id].name || id };
    });
  }

  function technicalField(technical, field, onCommit) {
    var wrap = node('label', 'technical-field');
    wrap.appendChild(node('span', null, field.label));
    var value = technical[field.group][field.key];
    var input;

    if (field.type === 'select') {
      input = document.createElement('select');
      var options = field.options === 'materials' ? materialOptions() : field.options;
      options.forEach(function (option) {
        var node_ = document.createElement('option');
        node_.value = option.value;
        node_.textContent = option.label;
        if (option.value === value) node_.selected = true;
        input.appendChild(node_);
      });
      input.addEventListener('change', function () {
        technical.set(field.group, field.key, input.value);
        onCommit();
      });
    } else {
      input = document.createElement('input');
      input.type = 'number';
      if (field.min != null) input.min = field.min;
      if (field.max != null) input.max = field.max;
      input.step = field.step || 'any';
      if (field.blank) input.placeholder = 'libre';
      input.value = value == null ? '' : String(value);
      input.addEventListener('change', function () {
        var parsed = parseFloat(input.value);
        var next = isFinite(parsed) ? parsed : (field.blank ? null : value);
        technical.set(field.group, field.key, next);
        onCommit();
      });
    }
    input.id = 'tech_' + field.group + '_' + field.key;
    wrap.appendChild(input);
    if (field.unit) wrap.appendChild(node('span', 'parts-unit', field.unit));
    return wrap;
  }

  // ===== Cycle de vie =====

  SearchModal.prototype.open = function (step) {
    // §28 : on rendra le focus à ce qui a ouvert le dialogue. Le perdre
    // renverrait l'utilisateur au clavier tout en haut de la page.
    this._opener = document.activeElement;
    this.draft = this.session.draft();
    // Un bloc ouvert à la main ne survit pas à la fermeture du modal : c'est
    // la recherche adoptée qui décide de ce qui se rouvre.
    this._secondaryOpen = false;
    if (this.typeStep) this.typeStep._open = {};
    this.step = typeof step === 'number' ? step : this._focusStep();
    this.root.hidden = false;
    document.body.classList.add('modal-open');
    this.releaseLegacyPanels();
    this._mount();
    this.render();
    var first = this.root.querySelector('.search-pane:not([hidden]) button, .search-pane:not([hidden]) input');
    if (first && first.focus) first.focus();
    return this;
  };

  /**
   * §25 : chaque méthode déclare par quelle étape elle commence, et cette
   * information ne servait à rien. Une recherche vide ouvre sur le choix de la
   * méthode ; une recherche déjà définie rouvre là où elle se modifie
   * vraiment — le besoin, ou le réducteur décrit.
   */
  /** Éléments réellement atteignables au clavier dans le dialogue. */
  SearchModal.prototype._focusable = function () {
    var selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
      ' textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(this.root.querySelectorAll(selector), function (node) {
      return node.offsetParent !== null || node === document.activeElement;
    });
  };

  SearchModal.prototype._trapFocus = function (event) {
    var nodes = this._focusable();
    if (!nodes.length) return;
    var first = nodes[0], last = nodes[nodes.length - 1];
    var active = document.activeElement;
    if (event.shiftKey && (active === first || !this.root.contains(active))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault(); first.focus();
    }
  };

  SearchModal.prototype._focusStep = function () {
    if (!this.draft || this.draft.isEmpty()) return 0;
    var id = this.draft.intent.focusStep();
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return i;
    return 0;
  };

  /**
   * §24 : une étape n'était qu'active ou inactive. Dire laquelle retient
   * encore la recherche évite de chercher l'information manquante à l'aveugle.
   *
   * §14 : la correspondance `code → étape` vivait ici, dans une table à tenir
   * à jour à chaque nouveau diagnostic. Chaque note porte désormais sa
   * `section` : plus rien à synchroniser, et rien ne peut être oublié.
   */
  SearchModal.prototype._stepStates = function () {
    var blocking = {};
    this.draft.diagnose().forEach(function (note) {
      if (note.level === 'error' && note.section) blocking[note.section] = true;
    });
    return blocking;
  };

  /**
   * Ce qu'une ligne d'option annonce sans être ouverte. Toute la valeur du
   * repli tient là : si la ligne ne disait pas où elle en est, la replier
   * reviendrait à cacher l'information au lieu de la résumer.
   */
  /** Ce qui partira au moteur, en une ligne, à côté du bouton. */
  /** Ce que le bouton d'action va réellement déclencher. */
  SearchModal.prototype._actionLabel = function () {
    var draft = this.draft;
    if (!draft.workspace.editsChain()) return 'Rechercher les solutions';
    var unknown = draft.build.unknownCount();
    if (!unknown) return 'Analyser cette transmission';
    return 'Compléter (' + unknown + (unknown > 1 ? ' étages' : ' étage') + ')';
  };

  /** Pourquoi la recherche ne peut pas partir, en une phrase. */
  SearchModal.prototype._blockedReason = function () {
    var draft = this.draft;
    if (draft.workspace.editsChain()) {
      if (draft.build.isEmpty()) return 'Ajoutez au moins un étage';
      var broken = draft.build.errors();
      if (broken.length) return 'Étage ' + broken[0].stage + ' : ' + broken[0].text;
      return 'Posez le rapport visé pour que le solveur puisse compléter la chaîne';
    }
    var errors = draft.diagnose().filter(function (note) { return note.level === 'error'; });
    return errors.length ? errors[0].text : 'Complétez le besoin pour lancer la recherche';
  };

  SearchModal.prototype._context = function () {
    var draft = this.draft;
    var depth = draft.technical.depth();
    var families = draft.selectedTechnologies().length;
    return [
      depth ? depth.label : draft.technical.search.maxSolutions + ' solutions',
      families + (families > 1 ? ' technologies' : ' technologie'),
      '≤ ' + draft.compile().maxStages + ' étages'
    ].join(' · ');
  };

  SearchModal.prototype._optionSummary = function (key) {
    var draft = this.draft, technical = draft.technical;
    switch (key) {
      case 'fabrication': {
        var process = PROCESSES.filter(function (entry) {
          return entry.id === draft.requirement.fabrication.process;
        })[0];
        return process ? process.label : 'Standard';
      }
      case 'parts': {
        if (!draft.usesParts()) return 'Aucune';
        var teeth = (technical.gearing.teethInventory || []).length;
        var modules = (technical.module.list || []).length;
        var said = [];
        if (teeth) said.push(teeth + ' dentures');
        if (modules) said.push(modules + (modules > 1 ? ' modules' : ' module'));
        if (technical.gearing.drivingFixed != null) said.push('pignon ' + technical.gearing.drivingFixed);
        if (technical.gearing.drivenFixed != null) said.push('roue ' + technical.gearing.drivenFixed);
        return said.length ? said.join(' · ') : 'Plages personnalisées';
      }
      case 'service':
        return technical.fatigue.enabled
          ? technical.fatigue.years + ' ans, ' + technical.fatigue.hoursPerDay + ' h/j'
          : 'Non évaluée';
      case 'depth': {
        var depth = technical.depth();
        return depth ? depth.label : technical.search.maxSolutions + ' solutions au plus';
      }
      case 'technical': {
        var groups = technical.customisedGroups().filter(function (group) {
          return group !== 'search' && group !== 'manufacturing';
        });
        return groups.length ? groups.length + (groups.length > 1 ? ' groupes modifiés' : ' groupe modifié') : 'Par défaut';
      }
      default: return '';
    }
  };

  SearchModal.prototype._renderOptionRows = function () {
    var self = this;
    OPTION_ROWS.forEach(function (entry) {
      var head = self.root.querySelector('.option-row-head[data-option="' + entry.key + '"]');
      var body = self.root.querySelector('[data-option-body="' + entry.key + '"]');
      if (!head || !body) return;
      var open = !!self._optionOpen[entry.key];
      head.querySelector('.option-row-value').textContent = self._optionSummary(entry.key);
      head.querySelector('.option-row-mark').textContent = open ? '⌄' : '›';
      head.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    });
  };

  SearchModal.prototype.cancel = function () {
    // Le brouillon est jeté : la recherche affichée n'a jamais bougé.
    this.draft = null;
    this._close();
    this.onClose();
    return this;
  };

  /** Ferme le dialogue et rend le focus à ce qui l'avait ouvert (§28). */
  SearchModal.prototype._close = function () {
    this.root.hidden = true;
    document.body.classList.remove('modal-open');
    if (this._opener && this._opener.focus && document.contains(this._opener)) this._opener.focus();
    this._opener = null;
  };

  SearchModal.prototype.submit = function () {
    if (!this.draft || !this.draft.isReady()) { this.render(); return this; }
    this.session.adopt(this.draft);
    this.draft = null;
    this._close();
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
      this._bindService(refresh);
      this._bindParts(refresh);
      this._bindDepth(refresh);
      this._bindTechnical(refresh);
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

    // Le bouton reste TOUJOURS visible : il ouvrait la priorité secondaire puis
    // se cachait lui-même, si bien qu'une secondaire ouverte par erreur ne
    // pouvait plus être refermée. Un interrupteur qui disparaît une fois
    // actionné n'est pas un interrupteur.
    if (toggle) toggle.addEventListener('click', function () {
      if (self._secondaryOpen) self.draft.preferences.secondary = null;
      self._secondaryOpen = !self._secondaryOpen;
      refresh();
    });

    this._renderPriorities = function () {
      host.textContent = '';
      secondaryHost.textContent = '';
      axes.forEach(function (axis) { chip(axis, host, false); });
      axes.forEach(function (axis) { chip(axis, secondaryHost, true); });
      // Une secondaire déjà choisie ouvre le bloc d'elle-même ; sinon il ne
      // s'impose pas (§10).
      var open = self._secondaryOpen || !!self.draft.preferences.secondary;
      self._secondaryOpen = open;
      secondaryHost.hidden = !open;
      toggle.textContent = open ? '− Retirer la priorité secondaire' : '+ Ajouter une priorité secondaire';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-controls', 'prioritySecondary');
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

  // §20 : le cycle de service et la distance entre arbres existaient dans les
  // modèles et dans le moteur, mais n'étaient atteignables nulle part. Ils ne
  // sont pas affichés par défaut : c'est le niveau d'analyse « Fatigue » qui
  // signale qu'ils manquent, et cette section qui permet de les poser.
  var SERVICE_FIELDS = [
    { key: 'enabled', label: 'Estimer la fatigue', type: 'checkbox' },
    { key: 'hoursPerDay', label: 'Heures par jour', type: 'number', min: 0, max: 24, step: 0.5 },
    { key: 'daysPerYear', label: 'Jours par an', type: 'number', min: 0, max: 365, step: 1 },
    { key: 'years', label: 'Durée de vie visée (ans)', type: 'number', min: 0, step: 1 },
    { key: 'loadType', label: 'Type de charge', type: 'select', options: [
      { value: 'constant', label: 'constante' },
      { value: 'light', label: 'légers à-coups' },
      { value: 'moderate', label: 'à-coups modérés' },
      { value: 'heavy', label: 'à-coups sévères' }
    ] }
  ];

  SearchModal.prototype._bindService = function (refresh) {
    var self = this, host = el('serviceOptions');

    this._renderService = function () {
      host.textContent = '';
      var fatigue = self.draft.technical.fatigue;

      SERVICE_FIELDS.forEach(function (field) {
        // Le détail du cycle n'a de sens qu'une fois la fatigue demandée.
        if (field.key !== 'enabled' && !fatigue.enabled) return;
        var label = node('label', 'service-field');
        label.appendChild(node('span', null, field.label));
        var control;
        if (field.type === 'checkbox') {
          control = document.createElement('input');
          control.type = 'checkbox';
          control.checked = !!fatigue.enabled;
        } else if (field.type === 'select') {
          control = document.createElement('select');
          field.options.forEach(function (option) {
            var node2 = document.createElement('option');
            node2.value = option.value; node2.textContent = option.label;
            control.appendChild(node2);
          });
          control.value = fatigue[field.key];
        } else {
          control = document.createElement('input');
          control.type = 'number';
          if (field.min != null) control.min = field.min;
          if (field.max != null) control.max = field.max;
          control.step = field.step || 'any';
          control.value = String(fatigue[field.key]);
        }
        control.id = 'svc_' + field.key;
        control.addEventListener('change', function () {
          var value = field.type === 'checkbox' ? control.checked
            : field.type === 'number' ? parseFloat(control.value) : control.value;
          self.draft.technical.set('fatigue', field.key, value);
          refresh(field.key === 'enabled');
        });
        label.appendChild(control);
        host.appendChild(label);
      });
    };
  };

  // §E : partir de ce qu'on a. Module, dentures et entraxe existaient dans
  // `TechnicalSettingsModel` mais n'étaient vus que comme des « paramètres
  // techniques » ; ce sont pourtant les données de départ de tout projet DIY.
  var PART_FIELDS = [
    { group: 'module', key: 'fixed', label: 'Module', unit: 'mm', step: 0.05, min: 0.1 },
    { group: 'gearing', key: 'drivingFixed', label: 'Pignon imposé', unit: 'dents', step: 1, min: 1, blank: true },
    { group: 'gearing', key: 'drivenFixed', label: 'Roue imposée', unit: 'dents', step: 1, min: 1, blank: true },
    { group: 'gearing', key: 'drivingMin', label: 'Pignon de', unit: 'dents', step: 1, min: 1 },
    { group: 'gearing', key: 'drivingMax', label: 'à', unit: 'dents', step: 1, min: 1 },
    { group: 'gearing', key: 'drivenMin', label: 'Roue de', unit: 'dents', step: 1, min: 1 },
    { group: 'gearing', key: 'drivenMax', label: 'à', unit: 'dents', step: 1, min: 1 }
  ];

  SearchModal.prototype._bindParts = function (refresh) {
    var self = this, host = el('partsOptions');

    this._renderParts = function () {
      host.textContent = '';
      var grid = node('div', 'parts-grid');
      PART_FIELDS.forEach(function (field) {
        var label = node('label', 'parts-field');
        label.appendChild(node('span', null, field.label));
        var input = document.createElement('input');
        input.type = 'number';
        input.id = 'part_' + field.group + '_' + field.key;
        if (field.min != null) input.min = field.min;
        input.step = field.step || 'any';
        if (field.blank) input.placeholder = 'libre';
        var value = self.draft.technical[field.group][field.key];
        input.value = value == null ? '' : String(value);
        input.addEventListener('change', function () {
          var parsed = parseFloat(input.value);
          var next = isFinite(parsed) ? parsed : (field.blank ? null : self.draft.technical[field.group][field.key]);
          self.draft.technical.set(field.group, field.key, next);
          refresh(false);
        });
        label.appendChild(input);
        label.appendChild(node('span', 'parts-unit', field.unit));
        grid.appendChild(label);
      });
      host.appendChild(grid);

      // Une plage dit « entre 20 et 60 dents ». Un stock dit « 20, 24, 40, 60 »,
      // et aucune plage ne saura jamais l'exprimer : c'est pourtant ce qu'on a
      // réellement dans un tiroir.
      INVENTORY_FIELDS.forEach(function (field) {
        var label = node('label', 'parts-inventory');
        label.appendChild(node('span', null, field.label));
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'inventory_' + field.group + '_' + field.key;
        input.placeholder = field.placeholder;
        input.setAttribute('inputmode', 'numeric');
        input.value = (self.draft.technical[field.group][field.key] || []).join(', ');
        input.addEventListener('change', function () {
          self.draft.technical.set(field.group, field.key, parseList(input.value));
          refresh(false);
        });
        label.appendChild(input);
        label.appendChild(node('small', 'parts-hint', field.hint));
        host.appendChild(label);
      });
    };
  };

  /** Ce qu'on possède, énuméré. Tout ce qui n'est pas un nombre est ignoré. */
  var INVENTORY_FIELDS = [
    { group: 'gearing', key: 'teethInventory', label: 'Dentures en stock',
      placeholder: 'ex. 16, 20, 24, 40, 60',
      hint: 'Seules ces dentures seront combinées. Vide = plages ci-dessus.' },
    { group: 'module', key: 'list', label: 'Modules en stock',
      placeholder: 'ex. 1, 1.5',
      hint: 'Vide = module imposé ou plage automatique.' }
  ];

  function parseList(text) {
    return String(text || '').split(/[^0-9.]+/)
      .map(function (piece) { return parseFloat(piece); })
      .filter(function (value) { return isFinite(value) && value > 0; });
  }

  SearchModal.prototype._bindDepth = function (refresh) {
    var self = this, host = el('depthOptions');

    this._renderDepth = function () {
      host.textContent = '';
      var current = self.draft.technical.depth();
      GearApp.requirements.technicalSettings.DEPTHS.forEach(function (entry) {
        var active = current && current.id === entry.id;
        var button = node('button', 'depth-option' + (active ? ' active' : ''), entry.label);
        button.type = 'button';
        button.dataset.depth = entry.id;
        button.title = entry.help;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', String(!!active));
        button.addEventListener('click', function () {
          self.draft.technical.setDepth(entry.id);
          refresh(false);
        });
        host.appendChild(button);
      });
      var hint = node('p', 'field-help', '');
      hint.id = 'depthHint';
      hint.textContent = current ? current.help : 'Limites réglées à la main dans les options techniques.';
      host.appendChild(hint);
    };
  };

  // ===== Rendu =====

  SearchModal.prototype.render = function (structural) {
    if (!this.draft) return this;
    var self = this;
    var blocking = this._stepStates();
    STEPS.forEach(function (step, index) {
      self.panes[step.id].hidden = index !== self.step;
      var button = self.root.querySelector('[data-step="' + step.id + '"]');
      button.classList.toggle('active', index === self.step);
      button.classList.toggle('step-blocked', !!blocking[step.id]);
      button.classList.toggle('step-done', !blocking[step.id]);
      button.setAttribute('aria-current', index === self.step ? 'step' : 'false');
      button.title = blocking[step.id] ? 'Information manquante à cette étape' : '';
    });

    if (this.step === 0) this.typeStep.render();
    if (this.step === 1 && structural !== false) this.sheet.render();
    if (this.step === 2) {
      if (structural !== false) this.chips.render();
      this._renderPriorities();
      this._renderFabrication();
      this._renderService();
      this._renderParts();
      this._renderDepth();
      this._renderTechnical();
      this.typeParameters.render();
      this._renderOptionRows();
    }
    this._renderAnalysisLevels();
    this._renderSummary();

    this.context.textContent = this._context();
    // §11 : le pied de page dit ce qu'il reste à faire, pas tout ce qu'on
    // pourrait faire. Trois boutons permanents obligeaient à choisir entre des
    // actions dont une seule avait du sens.
    var ready = this.draft.isReady();
    var last = this.step === STEPS.length - 1;
    this.backButton.hidden = this.step === 0;
    this.backButton.disabled = this.step === 0;
    this.nextButton.hidden = last || ready;
    this.refineButton.hidden = last || !ready;
    this.searchButton.hidden = !ready && !last;
    this.searchButton.disabled = !ready;
    // §28 : un bouton désactivé doit dire POURQUOI, et le dire au lecteur
    // d'écran — un `title` seul ne lui parvient pas.
    // §8 : le bouton dit ce qu'il va faire. « Rechercher les solutions » sur
    // une chaîne entièrement décrite serait faux — rien ne sera cherché.
    this.searchButton.textContent = this._actionLabel();
    this.searchButton.title = ready ? '' : this._blockedReason();
    this.searchButton.setAttribute('aria-describedby', 'searchSummaryState');
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

  /** Rubriques qui ne décrivent pas la recherche mais ses modalités (§22). */
  var SECONDARY_SECTIONS = ['Composants', 'Recherche'];

  SearchModal.prototype._renderSummary = function () {
    var host = el('searchModalSummary');
    if (!host) return;
    // Le bloc des niveaux d'analyse est un enfant permanent : on ne le détruit
    // pas avec le reste, on le remet en place après les rubriques.
    var levels = el('analysisLevels'), bar = this.summaryBar;
    host.textContent = '';
    if (bar) host.appendChild(bar);
    host.appendChild(node('h3', null, 'Votre recherche'));
    // §22 : le résumé est une bonne idée tant qu'il ne devient pas une seconde
    // page de configuration. Ce qui décrit la recherche reste visible ; ce qui
    // n'en règle que les modalités attend qu'on le demande.
    var self = this;
    var more = node('div', 'search-summary-more');
    more.id = 'searchSummaryMore';
    more.hidden = !this._summaryExpanded;
    this.draft.brief().forEach(function (section) {
      var block = node('div', 'search-summary-section');
      block.dataset.section = section.title;
      block.appendChild(node('h4', null, section.title));
      var list = node('ul', 'search-summary-list');
      section.lines.forEach(function (line) {
        var item = document.createElement('li');
        item.textContent = line;
        list.appendChild(item);
      });
      block.appendChild(list);
      (SECONDARY_SECTIONS.indexOf(section.title) === -1 ? host : more).appendChild(block);
    });
    if (more.childNodes.length) {
      var toggle = node('button', 'btn-link search-summary-toggle',
        this._summaryExpanded ? 'Masquer le détail' : 'Voir le résumé complet');
      toggle.type = 'button';
      toggle.id = 'searchSummaryToggle';
      toggle.setAttribute('aria-expanded', String(!!this._summaryExpanded));
      toggle.addEventListener('click', function () {
        self._summaryExpanded = !self._summaryExpanded;
        self.render(false);
      });
      host.appendChild(toggle);
      host.appendChild(more);
    }

    if (levels) host.appendChild(levels);

    var ready = this.draft.isReady();
    if (bar) bar.textContent = 'Résumé · ' + (ready ? '✓ prêt' : '! ' + this._blockedReason());
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
