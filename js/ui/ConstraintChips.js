// ConstraintChips.js - Les contraintes, éditées sur le modèle (choix 4B + 6C).
//
// Les chips ressemblent aux précédentes, mais elles ne pilotent plus un champ
// caché : elles éditent directement le `PreferenceModel`. D'où la nouveauté
// visible — chaque chip porte un interrupteur :
//
//   🔒 contrainte   la solution qui ne tient pas est ÉCARTÉE
//   ♡ préférence    la solution est gardée, mais classée plus bas
//
// Le catalogue vient du modèle, pas d'une liste d'identifiants HTML : ajouter
// un critère au modèle suffit à le rendre proposable ici.
(function (GearApp) {
  'use strict';

  var CATEGORIES = [
    { id: 'dimensions', label: 'Encombrement' },
    { id: 'performance', label: 'Performance' },
    { id: 'robustesse', label: 'Robustesse' },
    { id: 'architecture', label: 'Architecture' }
  ];

  var KINDS = [
    { id: 'max', label: '≤' },
    { id: 'min', label: '≥' },
    { id: 'target', label: '≈' },
    { id: 'range', label: '⇄' }
  ];

  var DEFAULTS = {
    maxDiameter: 80, maxLength: 200, maxWidth: 80, efficiency: 90, outputTorque: 80,
    outputSpeed: 100, ratioError: 1, bendingSafety: 1.5, contactSafety: 1.2, stages: 3,
    outputForce: 200, linearSpeed: 500, centerDistance: 100
  };

  function ConstraintChips(session, onChange) {
    this.session = session;
    this.onChange = onChange || function () {};
    this.host = document.getElementById('constraintChips');
    this.menu = document.getElementById('constraintMenu');
    this.trigger = document.getElementById('addConstraintBtn');
    this._open = false;
  }

  ConstraintChips.prototype._criteria = function () {
    var linear = this.session.requirement.inferProblem().mode === 'rotationTranslation';
    return GearApp.requirements.preferences.CRITERIA.filter(function (meta) {
      return linear ? meta.linear || meta.category !== 'performance' || meta.key === 'ratioError' : !meta.linear;
    });
  };

  ConstraintChips.prototype.render = function () {
    if (!this.host) return this;
    var self = this, entries = this.session.preferences.list();
    this.host.textContent = '';
    entries.forEach(function (entry) { self.host.appendChild(self._chip(entry)); });
    this.host.hidden = !entries.length;
    if (this.trigger) {
      var badge = this.trigger.querySelector('.constraint-count');
      if (badge) { badge.textContent = entries.length ? String(entries.length) : ''; badge.hidden = !entries.length; }
      this.trigger.setAttribute('aria-expanded', String(this._open));
    }
    this._renderMenu();
    return this;
  };

  ConstraintChips.prototype._chip = function (entry) {
    var self = this, quantity = entry.quantity, bounds = quantity.bounds();
    var chip = document.createElement('span');
    chip.className = 'constraint-chip' + (quantity.soft ? ' constraint-chip-soft' : '');
    chip.dataset.constraint = entry.key;
    chip.dataset.role = quantity.soft ? 'preference' : 'constraint';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'constraint-chip-role';
    toggle.textContent = quantity.soft ? '♡' : '🔒';
    toggle.title = quantity.soft
      ? 'Préférence : les solutions qui s’en écartent restent proposées, moins bien classées. Cliquer pour en faire une contrainte.'
      : 'Contrainte : les solutions qui ne la respectent pas sont écartées. Cliquer pour en faire une préférence.';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.addEventListener('click', function () {
      self.session.preferences.toggleSoft(entry.key);
      self._changed();
    });
    chip.appendChild(toggle);

    var label = document.createElement('span');
    label.className = 'constraint-chip-label';
    label.textContent = entry.meta.label;
    chip.appendChild(label);

    var kind = document.createElement('select');
    kind.className = 'constraint-chip-kind';
    kind.setAttribute('aria-label', entry.meta.label + ' : type de valeur');
    KINDS.forEach(function (option) {
      var node = document.createElement('option');
      node.value = option.id; node.textContent = option.label;
      kind.appendChild(node);
    });
    kind.value = quantity.kind === 'exact' ? 'target' : quantity.kind;
    kind.addEventListener('change', function () { self._commit(entry, chip); });
    chip.appendChild(kind);

    var isRange = kind.value === 'range';
    chip.appendChild(this._input(entry, 'a', isRange ? bounds.min : quantity.value));
    var second = this._input(entry, 'b', bounds.max);
    second.hidden = !isRange;
    chip.appendChild(second);

    if (entry.meta.unit) {
      var unit = document.createElement('span');
      unit.className = 'constraint-chip-unit';
      unit.textContent = entry.meta.unit;
      chip.appendChild(unit);
    }

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'constraint-chip-remove';
    remove.setAttribute('aria-label', 'Supprimer ' + entry.meta.label);
    remove.textContent = '×';
    remove.addEventListener('click', function () {
      self.session.preferences.drop(entry.key);
      self._changed();
    });
    chip.appendChild(remove);
    return chip;
  };

  ConstraintChips.prototype._input = function (entry, slot, value) {
    var self = this, input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.className = 'constraint-chip-input';
    input.dataset.slot = slot;
    input.setAttribute('aria-label', entry.meta.label + (slot === 'b' ? ' : borne haute' : ''));
    input.value = value == null ? '' : String(Math.round(value * 10000) / 10000);
    input.addEventListener('change', function () { self._commit(entry, input.closest('.constraint-chip')); });
    return input;
  };

  ConstraintChips.prototype._commit = function (entry, chip) {
    var Q = GearApp.requirements.Quantity;
    var kind = chip.querySelector('.constraint-chip-kind').value;
    var a = numberOf(chip.querySelector('[data-slot="a"]'));
    var b = numberOf(chip.querySelector('[data-slot="b"]'));
    var soft = chip.dataset.role === 'preference';
    var quantity;
    if (kind === 'range') quantity = a == null || b == null ? Q.unknown() : Q.between(a, b);
    else if (a == null) quantity = Q.unknown();
    else if (kind === 'min') quantity = Q.atLeast(a);
    else if (kind === 'target') quantity = Q.target(a, null);
    else quantity = Q.atMost(a);
    this.session.preferences.require(entry.key, quantity, soft);
    this._changed();
  };

  ConstraintChips.prototype._renderMenu = function () {
    if (!this.menu) return;
    var self = this, active = this.session.preferences.entries;
    var available = this._criteria().filter(function (meta) { return !active[meta.key]; });
    this.menu.textContent = '';
    if (!available.length) {
      var empty = document.createElement('p');
      empty.className = 'constraint-menu-empty';
      empty.textContent = 'Toutes les contraintes disponibles sont déjà actives.';
      this.menu.appendChild(empty);
      return;
    }

    // §9 : d'abord les quelques critères qui comptent pour CE besoin, ensuite
    // seulement le catalogue. L'utilisateur n'a pas à savoir lesquels des trente
    // s'appliquent à une vis sans fin ou à une courroie.
    var linear = this.session.requirement.inferProblem().mode === 'rotationTranslation';
    var suggested = GearApp.requirements.preferences.suggest(this.session.selectedTechnologies(), linear, active);
    if (suggested.length) {
      var box = document.createElement('div');
      box.className = 'constraint-menu-group constraint-menu-suggested';
      box.id = 'constraintSuggestions';
      var heading = document.createElement('h4');
      heading.textContent = 'Critères recommandés';
      box.appendChild(heading);
      suggested.forEach(function (key) {
        var meta = GearApp.requirements.preferences.criterion(key);
        var item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.dataset.field = key;
        item.dataset.suggested = '1';
        item.textContent = '+ ' + meta.label + (meta.unit ? ' (' + meta.unit + ')' : '');
        item.addEventListener('click', function () { self.add(key); });
        box.appendChild(item);
      });
      this.menu.appendChild(box);

      var all = document.createElement('button');
      all.type = 'button';
      all.className = 'constraint-menu-all';
      all.id = 'showAllConstraints';
      all.textContent = this._showAll ? 'Masquer le catalogue' : 'Toutes les contraintes…';
      all.addEventListener('click', function () { self._showAll = !self._showAll; self.render(); });
      this.menu.appendChild(all);
      if (!this._showAll) return;
    }

    CATEGORIES.forEach(function (category) {
      var entries = available.filter(function (meta) { return meta.category === category.id; });
      if (!entries.length) return;
      var section = document.createElement('div');
      section.className = 'constraint-menu-group';
      var title = document.createElement('h4');
      title.textContent = category.label;
      section.appendChild(title);
      entries.forEach(function (meta) {
        var item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.dataset.field = meta.key;
        item.textContent = meta.label + (meta.unit ? ' (' + meta.unit + ')' : '');
        item.addEventListener('click', function () { self.add(meta.key); });
        section.appendChild(item);
      });
      self.menu.appendChild(section);
    });
  };

  ConstraintChips.prototype.add = function (key, quantity, soft) {
    var Q = GearApp.requirements.Quantity;
    var meta = GearApp.requirements.preferences.criterion(key);
    if (!meta) return this;
    var value = quantity || (meta.defaultKind === 'min' ? Q.atLeast(DEFAULTS[key]) : Q.atMost(DEFAULTS[key]));
    this.session.preferences.require(key, value, soft);
    this.closeMenu();
    this._changed();
    var input = this.host && this.host.querySelector('[data-constraint="' + key + '"] input');
    if (input) { input.focus(); input.select(); }
    return this;
  };

  ConstraintChips.prototype.openMenu = function () { this._open = true; this.menu.hidden = false; this.render(); return this; };
  ConstraintChips.prototype.closeMenu = function () { this._open = false; if (this.menu) this.menu.hidden = true; return this; };

  ConstraintChips.prototype.bind = function () {
    var self = this;
    if (this.trigger) {
      this.trigger.addEventListener('click', function () { self._open ? self.closeMenu() : self.openMenu(); });
      document.addEventListener('click', function (event) {
        if (!self._open) return;
        if (event.target.closest && event.target.closest('#constraintMenu, #addConstraintBtn')) return;
        self.closeMenu();
      });
    }
    return this.render();
  };

  ConstraintChips.prototype._changed = function () {
    this.session._advice = null;
    this.onChange();
  };

  function numberOf(input) {
    if (!input) return null;
    var raw = String(input.value).trim();
    if (raw === '') return null;
    var parsed = Number(raw.replace(',', '.'));
    return isFinite(parsed) ? parsed : null;
  }

  GearApp.ui.ConstraintChips = ConstraintChips;
  ConstraintChips.DEFAULTS = DEFAULTS;
  ConstraintChips.CATEGORIES = CATEGORIES;

})(GearApp);
