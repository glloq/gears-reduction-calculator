// TypeStep.js - « Quel type de transmission recherchez-vous ? » (§2 à §5)
//
// Première question du modal, et la plus structurante. Elle ne montre pas neuf
// technologies : elle demande d'abord COMMENT l'utilisateur veut choisir.
//
//   Conseillez-moi              → on parle géométrie fonctionnelle, pas familles
//   Je connais le type          → grille de familles, imposées ou préférées
//   Architecture personnalisée  → un cran par étage
//
// La politique choisie devient `TechnologySelectionModel.policy`, ce qui évite
// trois workflows séparés pour une seule décision.
(function (GearApp) {
  'use strict';

  var KNOWLEDGE = GearApp.requirements.TransmissionAdvisor.KNOWLEDGE;

  // La politique technologique n'est plus la première question : c'est une
  // décision INDÉPENDANTE de la méthode de recherche. On peut vouloir le
  // meilleur compromis en imposant un planétaire, ou viser un rapport exact en
  // laissant le système choisir la famille.
  var POLICIES = [
    { policy: 'auto', label: 'Automatique', help: 'Toutes les technologies compatibles sont explorées.' },
    { policy: 'prefer', label: 'Préférer', help: 'Ces familles d’abord, sans écarter une meilleure alternative.' },
    { policy: 'restrict', label: 'Imposer', help: 'N’explorer que ces familles.' },
    { policy: 'template', label: 'Architecture', help: 'Fixer la famille de chaque étage.' }
  ];

  // §3 : on demande la géométrie fonctionnelle, jamais « droit ou hélicoïdal ».
  //
  // Chaque carte décrit l'état COMPLET, jamais seulement ce qu'elle change.
  // « Arbres éloignés » posait `spread = true` et aucune autre disposition ne
  // le remettait à false : revenir à « Indifférente » laissait donc le
  // conseiller croire à des arbres éloignés, et la carte active restait
  // « Arbres éloignés » puisque `_currentDisposition()` teste `spread`.
  var DISPOSITIONS = [
    { id: 'any', label: 'Indifférente', sketch: 'Le système choisit',
      state: { axisAngle: 0, coaxial: 'any', spread: false } },
    { id: 'parallel', label: 'Axes parallèles', sketch: 'entrée ───── sortie',
      state: { axisAngle: 0, coaxial: 'avoid', spread: false } },
    { id: 'coaxial', label: 'Coaxial', sketch: 'entrée ──○── sortie',
      state: { axisAngle: 0, coaxial: 'required', spread: false } },
    { id: 'angle', label: 'Renvoi d’angle', sketch: 'entrée ─┐ sortie',
      state: { axisAngle: 90, coaxial: 'any', spread: false } },
    { id: 'spread', label: 'Arbres éloignés', sketch: 'courroie / chaîne',
      state: { axisAngle: 0, coaxial: 'avoid', spread: true } },
    { id: 'linear', label: 'Translation', sketch: 'rotation → déplacement',
      state: { axisAngle: 0, coaxial: 'any', spread: false }, linear: true }
  ];

  /** Grandeurs qui n'ont de sens que pour un mouvement linéaire. */
  var LINEAR_PATHS = ['output.travelPerRev', 'output.force', 'output.linearSpeed'];
  var LINEAR_LABELS = {
    'output.travelPerRev': 'course par tour',
    'output.force': 'force',
    'output.linearSpeed': 'vitesse linéaire'
  };

  var FUNCTION_OPTIONS = [
    { key: 'selfLocking', label: 'Maintien de charge', options: [
      { value: 'any', label: 'non nécessaire' },
      { value: 'required', label: 'irréversible' },
      { value: 'forbidden', label: 'doit rester rétro-entraînable' }
    ] },
    { key: 'direction', label: 'Sens de sortie', options: [
      { value: 'any', label: 'indifférent' },
      { value: 'same', label: 'identique à l’entrée' },
      { value: 'reverse', label: 'inversé' }
    ] }
  ];

  var GROUPS = [
    { label: 'Engrenages', families: ['spur', 'helical', 'internal', 'planetary', 'bevel', 'worm'] },
    { label: 'Transmissions flexibles', families: ['belt', 'chain'] },
    { label: 'Linéaire', families: ['rack'] }
  ];

  function node_(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function button(className, text, onClick) {
    var node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = text;
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function TypeStep(host, draft, onChange) {
    this.host = host;
    this.draft = draft;
    this.onChange = onChange || function () {};
    // Sections dépliées à la main. Un réglage déjà personnalisé s'ouvre seul :
    // ceci ne mémorise que les ouvertures que rien d'autre ne justifie.
    this._open = {};
    // §11 : un seul étage du réducteur existant est déplié à la fois.
    this._openStage = null;
  }

  TypeStep.prototype.setDraft = function (draft) { this.draft = draft; return this; };

  TypeStep.prototype.render = function () {
    this.host.textContent = '';
    this._renderIntent();
    // Décrire ce qu'on a précède toute question sur ce qu'on veut : c'est la
    // machine décrite qui fixe le rapport à conserver.
    if (this.draft.intent.improves()) this._renderExisting();
    // Construire ou étudier, c'est décrire une CHAÎNE. La technologie et la
    // disposition n'ont alors plus de question à poser : elles sont écrites
    // étage par étage juste en dessous.
    if (this.draft.workspace.editsChain()) { this._renderBuild(); return this; }

    // §7, §8 : technologie et disposition sont d'excellentes fonctions, mais
    // quatre boutons et six cartes en permanence font payer à TOUS le prix
    // d'un réglage que la plupart laissent sur « Automatique ». Elles se
    // réduisent donc à une ligne de résumé, dépliable d'un clic — et déjà
    // dépliée dès que l'utilisateur y a touché.
    this._renderSetting('technology', 'Technologie', this._technologyValue(), function (host) {
      this._renderPolicy(host);
      var policy = this.draft.technologySelection.policy;
      if (policy === 'template') this._renderArchitecture(host);
      else if (policy !== 'auto') this._renderFamilies(host);
      // §9 : le conseil n'a rien à dire tant que le besoin est vide. Il ne
      // s'affiche donc qu'ici, une fois qu'on vient chercher de l'aide.
      host.appendChild(this._advice());
    });
    this._renderSetting('disposition', 'Disposition', this._dispositionValue(), function (host) {
      this._renderDisposition(host);
    });
    return this;
  };

  /**
   * Une ligne « Réglage — valeur — Modifier », qui ne déploie son contenu que
   * lorsqu'on le demande, ou lorsqu'il n'est plus au réglage d'usine.
   */
  TypeStep.prototype._renderSetting = function (key, label, value, renderBody) {
    var self = this;
    var section = document.createElement('section');
    section.className = 'type-section setting-section';
    section.dataset.setting = key;

    // Un réglage déjà personnalisé s'ouvre seul, mais on doit pouvoir le
    // replier : sans état explicite, `!open` serait aussitôt réécrasé par
    // `customised` et le bouton « Replier » n'aurait aucun effet.
    var explicit = this._open[key];
    var open = explicit === undefined ? value.customised : explicit;
    var row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = '<span class="setting-label">' + label + '</span>' +
      '<span class="setting-value">' + value.text + '</span>';
    var toggle = button('setting-toggle', open ? 'Replier' : 'Modifier…', function () {
      self._open[key] = !open;
      self._changed();
    });
    toggle.dataset.setting = key;
    toggle.setAttribute('aria-expanded', String(open));
    row.appendChild(toggle);
    section.appendChild(row);
    this.host.appendChild(section);

    if (!open) return;
    var body = document.createElement('div');
    body.className = 'setting-body';
    body.dataset.settingBody = key;
    section.appendChild(body);
    renderBody.call(this, body);
  };

  /** Ce que la ligne « Technologie » annonce sans être dépliée. */
  TypeStep.prototype._technologyValue = function () {
    var selection = this.draft.technologySelection;
    var names = {};
    Object.keys(KNOWLEDGE).forEach(function (id) { names[id] = KNOWLEDGE[id].name; });
    var explored = this.draft.selectedTechnologies().length;
    var text = selection.describe(names) + ' · ' + explored +
      (explored > 1 ? ' familles' : ' famille');
    // §12 : le conseiller travaille déjà ; le laisser muet tant qu'on n'ouvre
    // pas le panneau prive de son résultat ceux qui ne l'ouvriront jamais.
    var lead = this.draft.advice().recommended.slice(0, 2).map(function (entry) { return entry.name; });
    if (lead.length) text += ' · en tête : ' + lead.join(', ');
    return { customised: selection.policy !== 'auto', text: text };
  };

  /** Ce que la ligne « Disposition » annonce sans être dépliée. */
  TypeStep.prototype._dispositionValue = function () {
    var current = this._currentDisposition();
    var architecture = this.draft.requirement.architecture;
    var entry = DISPOSITIONS.filter(function (d) { return d.id === current; })[0];
    var extras = FUNCTION_OPTIONS.filter(function (option) {
      return architecture[option.key] && architecture[option.key] !== 'any';
    }).map(function (option) {
      var chosen = option.options.filter(function (o) { return o.value === architecture[option.key]; })[0];
      return chosen ? chosen.label : null;
    }).filter(Boolean);
    return {
      customised: current !== 'any' || extras.length > 0,
      text: [entry ? entry.label : 'Indifférente'].concat(extras).join(' · ')
    };
  };

  /**
   * Première décision : que veut-on FAIRE ? La question n'était pas celle-là —
   * « que cherchez-vous ? » présuppose une recherche, et fermait la porte à la
   * moitié des usages : décrire un mécanisme pour savoir ce qu'il fait, ou
   * choisir soi-même ses étages, ne sont pas des recherches.
   */
  TypeStep.prototype._renderIntent = function () {
    var self = this, workspace = this.draft.workspace, intent = this.draft.intent;
    var section = document.createElement('section');
    section.className = 'type-section';
    section.innerHTML = '<h3>Que voulez-vous faire&nbsp;?</h3>';

    var row = document.createElement('div');
    row.className = 'type-entries';
    row.id = 'intentCards';
    GearApp.requirements.workspace.MODES.forEach(function (mode) {
      var active = workspace.mode === mode.id;
      var card = button('type-entry' + (active ? ' active' : ''), '');
      // `data-workspace`, et lui seul : la carte ne désigne plus une intention
      // de recherche mais un mode de travail, et porter les deux noms pour la
      // même valeur reviendrait à préparer la prochaine divergence.
      card.dataset.workspace = mode.id;
      card.setAttribute('aria-pressed', String(active));
      card.innerHTML = '<span class="type-entry-icon" aria-hidden="true">' + mode.icon + '</span>' +
        '<strong>' + mode.label + '</strong><small>' + mode.help + '</small>';
      card.addEventListener('click', function () { self.draft.setWorkspaceMode(mode.id); self._changed(); });
      row.appendChild(card);
    });
    section.appendChild(row);

    // La performance poursuivie n'existe que pour l'exploration : l'afficher
    // ailleurs demanderait un choix sans effet (§15).
    if (intent.explores()) {
      var pick = document.createElement('div');
      pick.className = 'intent-objectives';
      pick.id = 'intentObjectives';
      pick.innerHTML = '<span class="intent-objective-label">Performance à pousser</span>';
      GearApp.requirements.searchIntent.OBJECTIVES.forEach(function (entry) {
        var active = intent.objective === entry.id;
        var chip = button('intent-objective' + (active ? ' active' : ''), entry.label, function () {
          intent.setObjective(entry.id);
          self._changed();
        });
        chip.dataset.objective = entry.id;
        chip.title = entry.help;
        chip.setAttribute('aria-pressed', String(active));
        pick.appendChild(chip);
      });
      section.appendChild(pick);

      var note = document.createElement('p');
      note.className = 'intent-span-note';
      note.id = 'intentSpanNote';
      note.textContent = spanNote(this.draft);
      section.appendChild(note);
    }
    this.host.appendChild(section);
  };

  /**
   * L'espace balayé, dit en toutes lettres. Une plage par défaut annoncée reste
   * une décision de l'utilisateur ; une plage par défaut muette n'en est pas une.
   */
  function spanNote(draft) {
    var span = draft.explorationSpan();
    var bands = GearApp.requirements.ExplorationPlanner.bands(span.min, span.max).length;
    return 'Espace balayé : rapports ' + short(span.min) + ' à ' + short(span.max) + ':1, en ' + bands + ' bandes' +
      (span.stated ? ' (d’après le rapport demandé).' : '. Posez un rapport en plage à l’étape Besoin pour le restreindre.');
  }

  function short(value) {
    return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  }

  /**
   * §G : décrire le réducteur qu'on possède déjà. Les mêmes champs que
   * l'éditeur d'étages, avant toute recherche — c'est ce qui manquait pour que
   * « je veux plus compact » ait un point de départ mesurable.
   */
  TypeStep.prototype._renderExisting = function () {
    var self = this, existing = this.draft.existing;
    var Helpers = GearApp.requirements.existingReducer;
    var section = document.createElement('section');
    section.className = 'type-section';
    section.innerHTML = '<h3>Votre réducteur actuel&nbsp;?</h3>';

    var list = document.createElement('ol');
    list.className = 'existing-stages';
    list.id = 'existingStages';

    // §11 : afficher tous les étages avec tous leurs champs à la fois était
    // fonctionnellement juste et visuellement écrasant. Un seul étage s'ouvre —
    // les autres se résument à ce qu'ils sont, ce qui suffit pour s'y retrouver.
    existing.stages.forEach(function (stage, index) {
      var item = document.createElement('li');
      item.className = 'existing-stage';
      item.dataset.stage = String(index);
      var open = self._openStage === index;

      if (!open) {
        var summary = button('existing-stage-summary', '', function () {
          self._openStage = index;
          self._changed();
        });
        summary.dataset.stage = String(index);
        summary.innerHTML = '<strong>Étage ' + (index + 1) + '</strong>' +
          '<span>' + stageSummary(stage, Helpers) + '</span><span class="existing-stage-edit">Modifier</span>';
        item.appendChild(summary);
        item.classList.add('existing-stage-folded');
        list.appendChild(item);
        return;
      }

      var family = document.createElement('select');
      family.className = 'existing-family';
      family.setAttribute('aria-label', 'Type de l’étage existant ' + (index + 1));
      GROUPS.forEach(function (group) {
        group.families.forEach(function (id) {
          if (id === 'rack') return;
          var option = document.createElement('option');
          option.value = id;
          option.textContent = KNOWLEDGE[id].name;
          if (id === (stage.type === 'epicyclic' ? 'planetary' : stage.type)) option.selected = true;
          family.appendChild(option);
        });
      });
      family.addEventListener('change', function () {
        existing.setType(index, family.value);
        self._changed();
      });
      item.appendChild(family);

      Helpers.fieldsFor(stage.type).forEach(function (field) {
        item.appendChild(numberField(field.label, field.unit, Helpers.get(stage, field.path), field, function (value) {
          existing.setField(index, field.path, value);
          self._changed();
        }, 'existing_' + index + '_' + field.path.replace('.', '_')));
      });
      item.appendChild(numberField('Module', 'mm', stage.parameters && stage.parameters.module,
        { min: 0.1, step: 0.05 }, function (value) {
          existing.setField(index, 'parameters.module', value);
          self._changed();
        }, 'existing_' + index + '_module'));

      var remove = button('existing-stage-remove', '×', function () {
        existing.removeStage(index);
        self._openStage = null;
        self._changed();
      });
      remove.setAttribute('aria-label', 'Retirer l’étage ' + (index + 1));
      item.appendChild(remove);
      list.appendChild(item);
    });
    section.appendChild(list);

    var add = button('btn-small', '+ Ajouter un étage', function () {
      existing.addStage('spur', 1);
      // Un étage qu'on vient d'ajouter est celui qu'on veut remplir.
      self._openStage = existing.stages.length - 1;
      self._changed();
    });
    add.id = 'addExistingStageBtn';
    section.appendChild(add);

    // Les erreurs de saisie se disent là où on saisit, pas au moment du clic
    // sur « Rechercher ».
    var errors = existing.errors();
    if (errors.length) {
      var warn = document.createElement('ul');
      warn.className = 'existing-errors';
      warn.id = 'existingErrors';
      errors.forEach(function (entry) {
        var line = document.createElement('li');
        line.textContent = 'Étage ' + entry.stage + ' : ' + entry.text;
        warn.appendChild(line);
      });
      section.appendChild(warn);
    }

    var reference = this.draft.baseline();
    var summary = document.createElement('p');
    summary.className = 'existing-summary';
    summary.id = 'existingSummary';
    summary.textContent = reference
      ? 'Rapport ' + (Math.round(reference.ratio * 100) / 100) + ':1, Ø ' +
        Math.round(reference.dimensions.maxDiameter) + ' mm, rendement ' +
        Math.round(reference.efficiency * 100) + ' %. Les solutions seront cherchées à ce rapport.'
      : 'Décrivez au moins un étage valide pour mesurer votre réducteur.';
    section.appendChild(summary);

    var goals = document.createElement('div');
    goals.className = 'existing-goals';
    goals.id = 'existingGoals';
    goals.innerHTML = '<span class="intent-objective-label">Ce que vous voulez gagner</span>';
    Helpers.GOALS.forEach(function (entry) {
      var active = existing.goal === entry.id;
      var chip = button('intent-objective' + (active ? ' active' : ''), entry.label, function () {
        existing.setGoal(entry.id);
        self._changed();
      });
      chip.dataset.goal = entry.id;
      chip.setAttribute('aria-pressed', String(active));
      goals.appendChild(chip);
    });
    section.appendChild(goals);
    this.host.appendChild(section);
  };

  /** Un étage replié en une ligne : « Droit · 20 → 60 dents · module 1 ». */
  function stageSummary(stage, Helpers) {
    var name = KNOWLEDGE[stage.type === 'epicyclic' ? 'planetary' : stage.type];
    var values = Helpers.fieldsFor(stage.type).map(function (field) {
      return Helpers.get(stage, field.path);
    }).filter(function (value) { return value != null; });
    var module = stage.parameters && stage.parameters.module;
    return [name ? name.name : stage.type]
      .concat(values.length === 2 ? [values[0] + ' → ' + values[1]] : values)
      .concat(module ? ['module ' + module] : [])
      .join(' · ');
  }

  function numberField(label, unit, value, spec, onCommit, id) {
    var wrap = document.createElement('label');
    wrap.className = 'existing-field';
    wrap.appendChild(document.createTextNode(label));
    var input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    if (spec.min != null) input.min = spec.min;
    if (spec.max != null) input.max = spec.max;
    input.step = spec.step || 1;
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', function () {
      var parsed = parseFloat(input.value);
      if (isFinite(parsed)) onCommit(parsed);
    });
    wrap.appendChild(input);
    if (unit) {
      var suffix = document.createElement('span');
      suffix.className = 'parts-unit';
      suffix.textContent = unit;
      wrap.appendChild(suffix);
    }
    return wrap;
  }

  // ===== Construire / étudier une chaîne =====

  /**
   * Familles proposées au constructeur. La crémaillère en est absente : elle
   * relève du solveur linéaire, qui ne compose pas de chaîne — l'offrir ici
   * promettrait un étage que rien ne saurait enchaîner.
   */
  function buildFamilies() {
    return GearTransmissionRegistry.list()
      .map(function (definition) { return definition.id; })
      .filter(function (id) { return id !== 'rack'; });
  }

  /**
   * Comment saisir un champ d'étage. Les libellés viennent d'où ils vivent
   * déjà — l'éditeur du réducteur existant pour les dentures, le registre pour
   * les organes d'un planétaire — plutôt que d'une table de plus (§19).
   */
  function fieldSpec(path) {
    var existing = GearApp.requirements.existingReducer.FIELDS;
    var found = null;
    Object.keys(existing).forEach(function (key) {
      existing[key].forEach(function (field) { if (field.path === path) found = field; });
    });
    if (found) return { label: found.label, unit: found.unit, min: found.min, max: found.max, step: found.step };
    var definitions = GearTransmissionRegistry.parameterDefinitions.planetary || {};
    var definition = definitions[path];
    if (definition) {
      return { label: definition.label, unit: '', min: definition.min, max: definition.max,
        step: definition.step, options: definition.options, optionLabels: definition.optionLabels };
    }
    return { label: path, unit: '' };
  }

  /**
   * Un champ de la chaîne en construction. Vider le champ ne le remet pas à sa
   * valeur précédente : il REDEVIENT inconnu, et le solveur le cherchera. Sans
   * cela, il serait impossible de dé-fixer une denture après l'avoir saisie —
   * exactement le piège qu'on a déjà corrigé sur les priorités secondaires.
   */
  function buildField(path, value, spec, onCommit, id) {
    var wrap = document.createElement('label');
    wrap.className = 'build-field' + (value == null ? ' build-field-auto' : '');
    wrap.appendChild(document.createTextNode(spec.label));
    var input;
    if (spec.options) {
      input = document.createElement('select');
      var empty = document.createElement('option');
      empty.value = ''; empty.textContent = 'Automatique';
      input.appendChild(empty);
      spec.options.forEach(function (option) {
        var node = document.createElement('option');
        node.value = option;
        node.textContent = (spec.optionLabels && spec.optionLabels[option]) || option;
        input.appendChild(node);
      });
      input.value = value == null ? '' : String(value);
    } else {
      input = document.createElement('input');
      input.type = 'number';
      if (spec.min != null) input.min = spec.min;
      if (spec.max != null) input.max = spec.max;
      input.step = spec.step || 1;
      input.placeholder = 'auto';
      input.value = value == null ? '' : String(value);
    }
    input.id = id;
    input.dataset.path = path;
    input.addEventListener('change', function () {
      var raw = String(input.value).trim();
      if (raw === '') return onCommit(null);
      if (spec.options) return onCommit(raw);
      var parsed = parseFloat(raw);
      onCommit(isFinite(parsed) ? parsed : null);
    });
    wrap.appendChild(input);
    if (spec.unit) {
      var suffix = document.createElement('span');
      suffix.className = 'parts-unit';
      suffix.textContent = spec.unit;
      wrap.appendChild(suffix);
    }
    return wrap;
  }

  /**
   * L'atelier : une chaîne d'étages, chacun connu au degré qu'on veut. C'est la
   * capacité qui existait déjà — Technologie → Architecture — mais qui ne
   * permettait de fixer que la FAMILLE de chaque étage, jamais ses dentures.
   */
  TypeStep.prototype._renderBuild = function () {
    var self = this, build = this.draft.build;
    var Levels = GearApp.requirements.build.LEVEL_LABELS;
    var section = document.createElement('section');
    section.className = 'type-section build-section';
    section.innerHTML = '<h3>Votre transmission</h3>';

    var plan = document.createElement('p');
    plan.className = 'build-plan';
    plan.id = 'buildPlan';
    plan.textContent = this._buildPlanText();
    section.appendChild(plan);

    var list = document.createElement('ol');
    list.className = 'build-stages';
    list.id = 'buildStages';
    build.stages.forEach(function (stage, index) {
      list.appendChild(self._buildStage(stage, index, Levels));
    });
    section.appendChild(list);

    var add = button('btn-small btn-primary', '+ Ajouter un étage', function () {
      build.addStage(null);
      self._changed();
    });
    add.id = 'addBuildStageBtn';
    section.appendChild(add);

    // Le moteur applique UN module à toute la chaîne : le proposer par étage
    // serait une promesse que rien ne tient.
    section.appendChild(buildField('module', build.module,
      { label: 'Module de la chaîne', unit: 'mm', min: 0.1, step: 0.05 },
      function (value) { build.setModule(value); self._changed(); }, 'buildModule'));

    var errors = build.errors();
    if (errors.length) {
      var box = document.createElement('ul');
      box.className = 'build-errors';
      box.id = 'buildErrors';
      errors.forEach(function (entry) {
        var item = document.createElement('li');
        item.textContent = 'Étage ' + entry.stage + ' : ' + entry.text;
        box.appendChild(item);
      });
      section.appendChild(box);
    }
    this.host.appendChild(section);
  };

  /** Ce qui se passera au clic : le dire évite de faire deviner (§8). */
  TypeStep.prototype._buildPlanText = function () {
    var build = this.draft.build;
    if (build.isEmpty()) return 'Ajoutez un étage pour commencer. Laissez vide ce que vous ne connaissez pas encore.';
    var unknown = build.unknownCount();
    if (!unknown) {
      var ratio = build.ratio();
      return 'Chaîne entièrement décrite' + (ratio ? ', rapport ' + (Math.round(ratio * 100) / 100) + ':1' : '') +
        ' — elle sera calculée directement, sans recherche.';
    }
    return unknown + (unknown > 1 ? ' étages restent' : ' étage reste') + ' à compléter : le solveur ne cherchera qu’eux.';
  };

  TypeStep.prototype._buildStage = function (stage, index, Levels) {
    var self = this, build = this.draft.build;
    var level = stage.level(), badge = Levels[level];
    var item = document.createElement('li');
    item.className = 'build-stage';
    item.dataset.stage = String(index);
    item.dataset.level = level;

    var head = document.createElement('header');
    head.className = 'build-stage-head';
    var title = document.createElement('strong');
    title.textContent = 'Étage ' + (index + 1);
    head.appendChild(title);

    var mark = document.createElement('span');
    mark.className = 'build-level';
    mark.dataset.level = level;
    mark.title = badge.help;
    mark.textContent = badge.icon + ' ' + badge.label;
    head.appendChild(mark);

    var family = document.createElement('select');
    family.className = 'build-family';
    family.id = 'buildFamily' + index;
    var free = document.createElement('option');
    free.value = ''; free.textContent = 'Famille automatique';
    family.appendChild(free);
    buildFamilies().forEach(function (id) {
      var option = document.createElement('option');
      option.value = id;
      option.textContent = GearTransmissionRegistry.familyName(id, 'short');
      family.appendChild(option);
    });
    family.value = stage.family || '';
    family.addEventListener('change', function () {
      stage.setFamily(family.value || null);
      self._changed();
    });
    head.appendChild(family);

    [['↑', -1], ['↓', 1]].forEach(function (entry) {
      var move = button('btn-small build-move', entry[0], function () {
        build.moveStage(index, entry[1]);
        self._changed();
      });
      move.dataset.move = String(entry[1]);
      move.setAttribute('aria-label', entry[1] < 0 ? 'Monter l’étage' : 'Descendre l’étage');
      move.disabled = index + entry[1] < 0 || index + entry[1] >= build.stages.length;
      head.appendChild(move);
    });

    var remove = button('btn-small build-remove', '✕', function () {
      build.removeStage(index);
      self._changed();
    });
    remove.setAttribute('aria-label', 'Retirer l’étage ' + (index + 1));
    head.appendChild(remove);
    item.appendChild(head);

    var fields = document.createElement('div');
    fields.className = 'build-fields';
    if (!stage.family) {
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Choisissez une famille pour fixer des dentures, ou laissez le système décider de tout cet étage.';
      fields.appendChild(hint);
    } else {
      stage.fields().forEach(function (field) {
        fields.appendChild(buildField(field.path, field.value, fieldSpec(field.path), function (value) {
          stage.set(field.path, value);
          self._changed();
        }, 'buildStage' + index + '_' + field.path.replace(/\./g, '_')));
      });
    }
    item.appendChild(fields);
    return item;
  };

  /** Seconde décision, indépendante : comment choisir la technologie ? */
  TypeStep.prototype._renderPolicy = function (host) {
    var self = this, selection = this.draft.technologySelection;
    var section = document.createElement('section');
    section.className = 'type-section';
    section.innerHTML = '<h3>Comment choisir la technologie&nbsp;?</h3>';

    var row = document.createElement('div');
    row.className = 'family-policy';
    row.id = 'technologyPolicy';
    POLICIES.forEach(function (entry) {
      var active = selection.policy === entry.policy;
      var node = button('policy-option' + (active ? ' active' : ''), entry.label, function () {
        selection.setPolicy(entry.policy);
        if (entry.policy === 'template' && !selection.template.length) selection.addStage(null).addStage(null);
        self._changed();
      });
      node.dataset.policy = entry.policy;
      node.title = entry.help;
      node.setAttribute('aria-pressed', String(active));
      row.appendChild(node);
    });
    section.appendChild(row);

    var hint = document.createElement('p');
    hint.className = 'field-help';
    hint.id = 'technologyPolicyHint';
    var current = POLICIES.filter(function (e) { return e.policy === selection.policy; })[0];
    hint.textContent = current ? current.help : '';
    section.appendChild(hint);
    host.appendChild(section);
  };

  // ----- Parcours A : géométrie fonctionnelle (§3) -----

  TypeStep.prototype._renderDisposition = function (host) {
    var self = this, architecture = this.draft.requirement.architecture;
    var section = document.createElement('section');
    section.className = 'type-section';
    section.innerHTML = '<h3>Disposition souhaitée</h3>';

    var grid = document.createElement('div');
    grid.className = 'disposition-grid';
    DISPOSITIONS.forEach(function (disposition) {
      var card = button('disposition-card' + (self._currentDisposition() === disposition.id ? ' active' : ''), '');
      card.dataset.disposition = disposition.id;
      card.innerHTML = '<strong>' + disposition.label + '</strong><small>' + disposition.sketch + '</small>';
      card.addEventListener('click', function () {
        Object.assign(architecture, disposition.state);
        // « Translation » n'est pas une disposition d'axes : c'est un autre
        // problème, et il se pose en renseignant une course — VIDE. Poser
        // 100 mm/tr dimensionnerait la crémaillère à la place de l'utilisateur.
        if (disposition.linear) {
          self.draft.reveal('output.travelPerRev');
        } else {
          self._leaveLinear();
        }
        self._changed();
      });
      grid.appendChild(card);
    });
    section.appendChild(grid);

    var functions = document.createElement('div');
    functions.className = 'type-functions';
    FUNCTION_OPTIONS.forEach(function (entry) {
      var label = document.createElement('label');
      label.textContent = entry.label;
      var select = document.createElement('select');
      select.dataset.architecture = entry.key;
      entry.options.forEach(function (option) {
        var node = document.createElement('option');
        node.value = option.value; node.textContent = option.label;
        select.appendChild(node);
      });
      select.value = architecture[entry.key] || 'any';
      select.addEventListener('change', function () {
        self.draft.requirement.architecture[entry.key] = select.value;
        self._changed();
      });
      label.appendChild(select);
      functions.appendChild(label);
    });
    // §13 : la distance entre arbres était rangée avec la fatigue et les
    // heures par jour. Ce n'est pas une donnée de service, c'est une donnée
    // d'architecture — et c'est elle qui rend courroies et chaînes évidentes.
    var distance = document.createElement('label');
    distance.className = 'type-function';
    distance.appendChild(document.createTextNode('Distance entre arbres'));
    var span = document.createElement('input');
    span.type = 'number';
    span.min = '0';
    span.id = 'shaftDistance';
    span.placeholder = 'libre';
    var current = architecture.shaftDistanceMm;
    span.value = current == null ? '' : String(current);
    span.addEventListener('change', function () {
      var value = parseFloat(span.value);
      architecture.shaftDistanceMm = isFinite(value) && value > 0 ? value : null;
      self._changed();
    });
    distance.appendChild(span);
    distance.appendChild(node_('span', 'quantity-unit', 'mm'));
    functions.appendChild(distance);

    section.appendChild(functions);

    // Ce qui vient d'être retiré est ANNONCÉ, et récupérable : perdre en
    // silence et conserver en silence sont deux fautes symétriques.
    if (this._removedLinear) {
      var notice = document.createElement('p');
      notice.className = 'disposition-notice';
      notice.id = 'linearRemovedNotice';
      notice.setAttribute('role', 'status');
      var names = this._removedLinear.map(function (entry) { return LINEAR_LABELS[entry.path]; });
      notice.textContent = 'Données linéaires retirées : ' + names.join(', ') + '. ';
      var undo = button('btn-link', 'Rétablir', function () {
        self._restoreLinear();
        self._changed();
      });
      undo.id = 'restoreLinearBtn';
      notice.appendChild(undo);
      section.appendChild(notice);
    }

    host.appendChild(section);
  };

  /**
   * Quitter le linéaire retire les grandeurs qui n'ont plus de sens. Les
   * effacer en silence serait aussi trompeur que les garder : le modèle
   * continuerait sinon d'en déduire un problème linéaire. On les retire donc,
   * et on le DIT, avec de quoi revenir en arrière.
   */
  TypeStep.prototype._leaveLinear = function () {
    var requirement = this.draft.requirement, removed = [];
    LINEAR_PATHS.forEach(function (path) {
      var quantity = requirement.get(path);
      if (quantity.isKnown()) removed.push({ path: path, quantity: quantity });
    });
    LINEAR_PATHS.forEach(function (path) {
      requirement.clear(path);
      this.draft.conceal(path);
    }, this);
    this._removedLinear = removed.length ? removed : null;
  };

  /** Rétablit ce que le passage en rotatif venait de retirer. */
  TypeStep.prototype._restoreLinear = function () {
    var requirement = this.draft.requirement;
    (this._removedLinear || []).forEach(function (entry) {
      requirement.set(entry.path, entry.quantity);
    });
    this._removedLinear = null;
    return this;
  };

  TypeStep.prototype._currentDisposition = function () {
    var architecture = this.draft.requirement.architecture;
    if (this.draft.requirement.inferProblem().mode === 'rotationTranslation') return 'linear';
    if (architecture.axisAngle === 90) return 'angle';
    if (architecture.coaxial === 'required') return 'coaxial';
    if (architecture.spread) return 'spread';
    if (architecture.coaxial === 'avoid') return 'parallel';
    return 'any';
  };

  /** Résumé du conseil : quelques lignes, pas le panneau complet (§3). */
  TypeStep.prototype._advice = function () {
    var advice = this.draft.advice();
    var box = document.createElement('div');
    box.className = 'type-advice';
    box.id = 'typeAdvice';
    var title = document.createElement('h4');
    title.textContent = 'D’après votre besoin';
    box.appendChild(title);

    var list = document.createElement('ul');
    var rows = advice.recommended.slice(0, 3).map(function (entry) { return { entry: entry, mark: '★', level: 'recommended' }; })
      .concat(advice.possible.slice(0, 2).map(function (entry) { return { entry: entry, mark: '✓', level: 'possible' }; }))
      .concat(advice.excluded.slice(0, 2).map(function (entry) { return { entry: entry, mark: '×', level: 'excluded' }; }));
    if (!rows.length) {
      var empty = document.createElement('li');
      empty.className = 'advice-row';
      empty.textContent = 'Renseignez un rapport ou une vitesse de sortie pour obtenir un conseil.';
      list.appendChild(empty);
    }
    rows.forEach(function (row) {
      var item = document.createElement('li');
      item.className = 'advice-row advice-' + row.level;
      item.dataset.family = row.entry.id;
      var reason = (row.entry.reasons || []).slice(0, 2).map(function (r) { return r.text; }).join(' ');
      item.innerHTML = '<span class="advice-mark">' + row.mark + '</span><span class="advice-name">' +
        row.entry.name + '</span><span class="advice-reason">' + reason + '</span>';
      list.appendChild(item);
    });
    box.appendChild(list);
    return box;
  };

  // ----- Parcours B : familles connues (§4) -----

  TypeStep.prototype._renderFamilies = function (host) {
    var self = this, selection = this.draft.technologySelection;
    var section = document.createElement('section');
    section.className = 'type-section';
    GROUPS.forEach(function (group) {
      var heading = document.createElement('h4');
      heading.textContent = group.label;
      section.appendChild(heading);
      var grid = document.createElement('div');
      grid.className = 'family-grid';
      group.families.forEach(function (id) {
        var known = KNOWLEDGE[id];
        var active = selection.families.indexOf(id) !== -1;
        var card = button('family-card' + (active ? ' active' : ''), '');
        card.dataset.family = id;
        card.setAttribute('aria-pressed', String(active));
        card.innerHTML = '<strong>' + known.name + '</strong>';
        card.addEventListener('click', function () { selection.toggleFamily(id); self._changed(); });
        grid.appendChild(card);
      });
      section.appendChild(grid);
    });
    host.appendChild(section);
  };

  // ----- Parcours C : architecture par étage (§5) -----

  TypeStep.prototype._renderArchitecture = function (host) {
    var self = this, selection = this.draft.technologySelection;
    var section = document.createElement('section');
    section.className = 'type-section';
    section.innerHTML = '<h3>Architecture</h3>';

    var list = document.createElement('ol');
    list.className = 'architecture-stages';
    list.id = 'architectureStages';
    selection.template.forEach(function (slot, index) {
      var item = document.createElement('li');
      item.className = 'architecture-stage';
      item.dataset.stage = String(index);

      var label = document.createElement('span');
      label.className = 'architecture-stage-label';
      label.textContent = 'Étage ' + (index + 1);
      item.appendChild(label);

      // Un cran accepte PLUSIEURS familles : « conique ou vis sans fin » est un
      // cahier des charges courant, qu'un select unique ne savait pas dire.
      var choices = document.createElement('div');
      choices.className = 'stage-choices';
      var auto = button('stage-choice' + (slot && slot.length ? '' : ' active'), 'Auto', function () {
        selection.setStage(index, null);
        self._changed();
      });
      auto.dataset.family = '';
      auto.title = 'Toute famille compatible pour cet étage';
      choices.appendChild(auto);

      GROUPS.forEach(function (group) {
        group.families.forEach(function (id) {
          if (id === 'rack') return;                 // la crémaillère n'est pas un étage de train
          var active = !!(slot && slot.indexOf(id) !== -1);
          var chip = button('stage-choice' + (active ? ' active' : ''), KNOWLEDGE[id].name, function () {
            var next = (slot || []).slice();
            var at = next.indexOf(id);
            if (at === -1) next.push(id); else next.splice(at, 1);
            selection.setStage(index, next.length ? next : null);
            self._changed();
          });
          chip.dataset.family = id;
          chip.setAttribute('aria-pressed', String(active));
          choices.appendChild(chip);
        });
      });
      item.appendChild(choices);

      var remove = button('architecture-stage-remove', '×', function () {
        selection.removeStage(index);
        self._changed();
      });
      remove.setAttribute('aria-label', 'Retirer l’étage ' + (index + 1));
      item.appendChild(remove);
      list.appendChild(item);
    });
    section.appendChild(list);

    var add = button('btn-small', '+ Ajouter un étage', function () {
      selection.addStage(null);
      self._changed();
    });
    add.id = 'addStageBtn';
    section.appendChild(add);
    host.appendChild(section);
  };

  /**
   * §18 : une seule source de rendu. `_changed` appelait `render()` PUIS
   * `onChange()`, qui remonte au modal, qui rappelle `render()` : le même DOM
   * était reconstruit deux fois par clic, avec le focus perdu au passage. Le
   * modal seul décide quand redessiner.
   */
  TypeStep.prototype._changed = function () {
    this.draft.invalidate();
    this.onChange();
  };

  GearApp.ui.TypeStep = TypeStep;
  TypeStep.POLICIES = POLICIES;
  TypeStep.DISPOSITIONS = DISPOSITIONS;

})(GearApp);
