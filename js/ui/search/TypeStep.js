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
  var DISPOSITIONS = [
    { id: 'any', label: 'Indifférente', sketch: 'Le système choisit', apply: function (a) { a.axisAngle = 0; a.coaxial = 'any'; } },
    { id: 'parallel', label: 'Axes parallèles', sketch: 'entrée ───── sortie', apply: function (a) { a.axisAngle = 0; a.coaxial = 'avoid'; } },
    { id: 'coaxial', label: 'Coaxial', sketch: 'entrée ──○── sortie', apply: function (a) { a.axisAngle = 0; a.coaxial = 'required'; } },
    { id: 'angle', label: 'Renvoi d’angle', sketch: 'entrée ─┐ sortie', apply: function (a) { a.axisAngle = 90; a.coaxial = 'any'; } },
    { id: 'spread', label: 'Arbres éloignés', sketch: 'courroie / chaîne', apply: function (a) { a.axisAngle = 0; a.coaxial = 'avoid'; a.spread = true; } },
    { id: 'linear', label: 'Translation', sketch: 'rotation → déplacement', apply: function (a) { a.axisAngle = 0; a.coaxial = 'any'; }, linear: true }
  ];

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
    return {
      customised: selection.policy !== 'auto',
      text: selection.describe(names) + ' · ' + explored +
        (explored > 1 ? ' familles explorées' : ' famille explorée')
    };
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

  /** Première décision : que cherche-t-on ? */
  TypeStep.prototype._renderIntent = function () {
    var self = this, intent = this.draft.intent;
    var section = document.createElement('section');
    section.className = 'type-section';
    section.innerHTML = '<h3>Que cherchez-vous&nbsp;?</h3>';

    var row = document.createElement('div');
    row.className = 'type-entries';
    row.id = 'intentCards';
    GearApp.requirements.searchIntent.MODES.forEach(function (mode) {
      var active = intent.mode === mode.id;
      var card = button('type-entry' + (active ? ' active' : ''), '');
      card.dataset.intent = mode.id;
      card.setAttribute('aria-pressed', String(active));
      card.innerHTML = '<span class="type-entry-icon" aria-hidden="true">' + mode.icon + '</span>' +
        '<strong>' + mode.label + '</strong><small>' + mode.help + '</small>';
      card.addEventListener('click', function () { intent.setMode(mode.id); self._changed(); });
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
        disposition.apply(architecture);
        // « Translation » n'est pas une disposition d'axes : c'est un autre
        // problème, et il se pose en renseignant une course.
        if (disposition.linear && !self.draft.requirement.output.travelPerRev.isKnown()) {
          self.draft.requirement.set('output.travelPerRev', GearApp.requirements.Quantity.exact(100, 'mm'));
        } else if (!disposition.linear) {
          self.draft.requirement.clear('output.travelPerRev');
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
    section.appendChild(functions);

    host.appendChild(section);
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
