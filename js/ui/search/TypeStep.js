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
  }

  TypeStep.prototype.setDraft = function (draft) { this.draft = draft; return this; };

  TypeStep.prototype.render = function () {
    this.host.textContent = '';
    this._renderIntent();
    this._renderPolicy();
    // La disposition décrit le besoin, pas la technologie : elle vaut quelle
    // que soit la politique, et c'est elle qui nourrit le conseiller.
    this._renderDisposition();
    var policy = this.draft.technologySelection.policy;
    if (policy === 'template') this._renderArchitecture();
    else if (policy !== 'auto') this._renderFamilies();
    return this;
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
    this.host.appendChild(section);
  };

  /** Seconde décision, indépendante : comment choisir la technologie ? */
  TypeStep.prototype._renderPolicy = function () {
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
    this.host.appendChild(section);
  };

  // ----- Parcours A : géométrie fonctionnelle (§3) -----

  TypeStep.prototype._renderDisposition = function () {
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

    section.appendChild(this._advice());
    this.host.appendChild(section);
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

  TypeStep.prototype._renderFamilies = function () {
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
    this.host.appendChild(section);
  };

  // ----- Parcours C : architecture par étage (§5) -----

  TypeStep.prototype._renderArchitecture = function () {
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
    this.host.appendChild(section);
  };

  TypeStep.prototype._changed = function () {
    this.draft.invalidate();
    this.render();
    this.onChange();
  };

  GearApp.ui.TypeStep = TypeStep;
  TypeStep.POLICIES = POLICIES;
  TypeStep.DISPOSITIONS = DISPOSITIONS;

})(GearApp);
