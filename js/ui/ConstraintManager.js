// ConstraintManager.js - Contraintes actives sous forme de chips.
//
// PRINCIPE : les contrôles historiques restent la SOURCE DE VÉRITÉ. Un chip
// n'est qu'une vue éditable d'un `<input>` existant, lu par SearchParams.
// Conséquences directes :
//   - `SearchParams.fromForm()` n'a pas à connaître les chips ;
//   - une ancienne URL ou un preset qui remplit `max_diameter` fait apparaître
//     le chip tout seul, sans code de migration ;
//   - ouvrir « Réglages avancés » et taper une valeur crée aussi le chip.
//
// Une contrainte est ACTIVE quand son contrôle s'écarte de sa valeur par
// défaut : une case cochée par défaut ne produit donc pas de chip permanent.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else { root.GearConstraintManager = api; if (root.GearApp) root.GearApp.ui.ConstraintManager = api.Manager; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Catalogue : un descripteur par contrainte, groupé comme le menu.
  // `field` est l'identifiant du contrôle historique piloté.
  var CATALOG = [
    { category: 'dimensions', field: 'max_diameter', label: 'Ø max', name: 'diamètre maximum', unit: 'mm', suggest: 80 },
    { category: 'dimensions', field: 'max_length', label: 'Longueur max', name: 'longueur maximum', unit: 'mm', suggest: 150 },
    { category: 'dimensions', field: 'max_width', label: 'Largeur max', name: 'largeur maximum', unit: 'mm', suggest: 40 },
    { category: 'dimensions', field: 'min_center_distance', label: 'Entraxe min', name: 'entraxe minimum', unit: 'mm', suggest: 20, rotaryOnly: true },
    { category: 'dimensions', field: 'max_center_distance', label: 'Entraxe max', name: 'entraxe maximum', unit: 'mm', suggest: 100, rotaryOnly: true },

    { category: 'performance', field: 'minimum_efficiency', label: 'Rendement ≥', name: 'rendement minimum', unit: '', suggest: 0.9, step: 0.01, rotaryOnly: true, format: function (v) { return (v * 100).toFixed(0) + ' %'; } },
    { category: 'performance', field: 'minimum_output_torque', label: 'Couple sortie ≥', name: 'couple de sortie minimum', unit: 'N·m', suggest: 50, rotaryOnly: true },
    { category: 'performance', field: 'rpm_sortie_min', label: 'RPM sortie ≥', name: 'vitesse de sortie minimum', unit: 'rpm', suggest: 20, rotaryOnly: true },
    { category: 'performance', field: 'rpm_sortie_max', label: 'RPM sortie ≤', name: 'vitesse de sortie maximum', unit: 'rpm', suggest: 200, rotaryOnly: true },
    { category: 'performance', field: 'minimum_bending_safety', label: 'SF ≥', name: 'facteur de sécurité en flexion minimum', unit: '', suggest: 1.5, step: 0.1 },
    { category: 'performance', field: 'minimum_contact_safety', label: 'SH ≥', name: 'facteur de sécurité au contact minimum', unit: '', suggest: 1.2, step: 0.1 },
    { category: 'performance', field: 'linear_speed_min', label: 'Vitesse ≥', name: 'vitesse linéaire minimum', unit: 'mm/min', suggest: 100, linearOnly: true },
    { category: 'performance', field: 'linear_speed_max', label: 'Vitesse ≤', name: 'vitesse linéaire maximum', unit: 'mm/min', suggest: 3000, linearOnly: true },
    { category: 'performance', field: 'linear_force_min', label: 'Force ≥', name: 'force de sortie minimum', unit: 'N', suggest: 200, linearOnly: true },

    { category: 'architecture', field: 'etages', label: 'Étages ≤', name: "nombre maximum d'étages", unit: '', suggest: 3, defaultValue: '4', rotaryOnly: true },
    { category: 'architecture', field: 'dent_menante_fixe', label: 'Dents entrée', name: "nombre de dents d'entrée imposé", unit: '', suggest: 20, rotaryOnly: true },
    { category: 'architecture', field: 'dent_menee_fixe', label: 'Dents sortie', name: 'nombre de dents de sortie imposé', unit: '', suggest: 60, rotaryOnly: true },
    { category: 'architecture', field: 'reduction_only', label: 'Multiplication autorisée', name: 'multiplication autorisée', kind: 'checkbox', defaultValue: true, rotaryOnly: true },
    { category: 'architecture', field: 'type_template', label: 'Architecture imposée', name: "architecture imposée par étage", kind: 'opaque', reveal: 'typeTemplateSection', rotaryOnly: true },

    { category: 'fabrication', field: 'manufacturing_mode', label: 'Procédé', name: 'procédé de fabrication', kind: 'select', defaultValue: 'standard' },
    { category: 'fabrication', field: 'manufacturing_min_module', label: 'Module ≥', name: 'module minimum de fabrication', unit: 'mm', suggest: 0.8, step: 0.1 },
    { category: 'fabrication', field: 'manufacturing_min_teeth', label: 'Dents ≥', name: 'nombre de dents minimum de fabrication', unit: '', suggest: 14 },
    { category: 'fabrication', field: 'manufacturing_min_width', label: 'Largeur ≥', name: 'largeur minimum de fabrication', unit: 'mm', suggest: 6 },
    { category: 'fabrication', field: 'printer_diameter', label: 'Ø imprimante', name: "diamètre imprimable", unit: 'mm', suggest: 220, defaultValue: '220' },

    { category: 'avance', field: 'module_mode', label: 'Module', name: 'mode de sélection du module', kind: 'select', defaultValue: 'fixed' },
    { category: 'avance', field: 'module_min', label: 'Module auto ≥', name: 'module automatique minimum', unit: 'mm', suggest: 0.5, step: 0.1 },
    { category: 'avance', field: 'module_max', label: 'Module auto ≤', name: 'module automatique maximum', unit: 'mm', suggest: 3, step: 0.1 },
    { category: 'avance', field: 'max_iterations', label: 'Itérations ≤', name: "nombre maximum d'itérations", unit: '', suggest: 200000, defaultValue: '500000' },
    { category: 'avance', field: 'input_material', label: 'Matériau entrée', name: "matériau d'entrée", kind: 'select', defaultValue: 'C45' },
    { category: 'avance', field: 'output_material', label: 'Matériau sortie', name: 'matériau de sortie', kind: 'select', defaultValue: 'C45' },
    { category: 'avance', field: 'fatigue_enabled', label: 'Fatigue estimée', name: 'estimation de fatigue', kind: 'checkbox', defaultValue: false },
    { category: 'avance', field: 'support_distance', label: 'Entre appuis', name: 'distance entre appuis', unit: 'mm', suggest: 60 }
  ];

  var CATEGORIES = [
    { id: 'dimensions', label: 'Dimensions' },
    { id: 'performance', label: 'Performance' },
    { id: 'architecture', label: 'Architecture' },
    { id: 'fabrication', label: 'Fabrication' },
    { id: 'avance', label: 'Avancé' }
  ];

  function descriptor(field, catalog) {
    catalog = catalog || CATALOG;
    for (var i = 0; i < catalog.length; i++) if (catalog[i].field === field) return catalog[i];
    return null;
  }

  /** Une contrainte est active quand son contrôle s'écarte de son défaut. */
  function isActive(entry, rawValue) {
    // Une valeur absente signifie « inconnue », pas « décochée » : sans cette
    // distinction, un état partiel ferait apparaître des contraintes fantômes.
    if (rawValue == null) return false;
    if (entry.kind === 'checkbox') return !!rawValue !== !!entry.defaultValue;
    var text = String(rawValue).trim();
    if (text === '') return false;
    if (entry.defaultValue !== undefined && text === String(entry.defaultValue)) return false;
    return true;
  }

  /** Texte du chip : « Ø max 80 mm », « Rendement ≥ 90 % »… */
  function describe(entry, rawValue) {
    if (entry.kind === 'checkbox') return entry.label;
    if (entry.kind === 'opaque') return entry.label;
    if (entry.format) {
      var parsed = Number(rawValue);
      return entry.label + ' ' + (Number.isFinite(parsed) ? entry.format(parsed) : rawValue);
    }
    return entry.label + ' ' + rawValue + (entry.unit ? ' ' + entry.unit : '');
  }

  /**
   * Contraintes actives d'un état de formulaire donné.
   * `state` associe un identifiant de contrôle à sa valeur : la fonction est
   * pure, donc testable sans DOM.
   */
  function activeConstraints(state, context, catalog) {
    context = context || {};
    return (catalog || CATALOG).filter(function (entry) {
      if (entry.rotaryOnly && context.linear) return false;
      if (entry.linearOnly && !context.linear) return false;
      return isActive(entry, state[entry.field]);
    }).map(function (entry) {
      return { field: entry.field, category: entry.category, name: entry.name,
        text: describe(entry, state[entry.field]), value: state[entry.field] };
    });
  }

  /** Contraintes proposables : celles qui ne sont pas déjà actives. */
  function available(state, context, catalog, categories) {
    context = context || {};
    catalog = catalog || CATALOG;
    var active = {};
    activeConstraints(state, context, catalog).forEach(function (c) { active[c.field] = true; });
    return (categories || CATEGORIES).map(function (category) {
      return { id: category.id, label: category.label,
        entries: catalog.filter(function (entry) {
          if (entry.category !== category.id || active[entry.field]) return false;
          if (entry.rotaryOnly && context.linear) return false;
          if (entry.linearOnly && !context.linear) return false;
          return true;
        }) };
    }).filter(function (category) { return category.entries.length; });
  }

  // ===== Liaison au DOM =====

  function Manager(options) {
    options = options || {};
    this.host = options.host || null;             // conteneur des chips
    this.menu = options.menu || null;             // panneau du menu d'ajout
    this.trigger = options.trigger || null;       // bouton « + Ajouter une contrainte »
    this.onChange = options.onChange || function () {};
    // Catalogue injectable : les filtres de résultats réutilisent la même
    // mécanique de chips avec leur propre liste de critères.
    this.catalog = options.catalog || CATALOG;
    this.categories = options.categories || CATEGORIES;
    this.sidebar = options.sidebar || 'sidebar';
    this._open = false;
  }

  Manager.prototype._control = function (field) { return document.getElementById(field); };

  Manager.prototype._read = function (field) {
    var control = this._control(field);
    if (!control) return null;
    return control.type === 'checkbox' ? control.checked : control.value;
  };

  /** État courant du formulaire, limité aux champs du catalogue. */
  Manager.prototype.state = function () {
    var self = this, state = {};
    this.catalog.forEach(function (entry) { state[entry.field] = self._read(entry.field); });
    return state;
  };

  Manager.prototype.context = function () {
    return { linear: document.body.classList.contains('linear-objective') };
  };

  Manager.prototype.active = function () { return activeConstraints(this.state(), this.context(), this.catalog); };

  /** Écrit dans le contrôle historique et notifie l'application. */
  Manager.prototype.set = function (field, value) {
    var control = this._control(field);
    if (!control) return this;
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = value == null ? '' : value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    this.render();
    this.onChange(field, value);
    return this;
  };

  /** Retirer un chip = remettre le contrôle à sa valeur par défaut. */
  Manager.prototype.remove = function (field) {
    var entry = descriptor(field, this.catalog);
    if (!entry) return this;
    return this.set(field, entry.defaultValue !== undefined ? entry.defaultValue : '');
  };

  Manager.prototype.add = function (field) {
    var entry = descriptor(field, this.catalog);
    if (!entry) return this;
    if (entry.kind === 'opaque' || entry.kind === 'select') {
      this.reveal(entry);
      this.closeMenu();
      return this;
    }
    if (entry.kind === 'checkbox') return this.set(field, !entry.defaultValue).closeMenu();
    this.set(field, entry.suggest);
    this.closeMenu();
    // Le champ du chip prend le focus : la valeur proposée est un point de
    // départ, pas une décision imposée à l'utilisateur.
    var input = this.host && this.host.querySelector('[data-constraint="' + field + '"] input');
    if (input) { input.focus(); input.select(); }
    return this;
  };

  /** Ouvre les réglages avancés sur la section concernée. */
  Manager.prototype.reveal = function (entry) {
    var control = this._control(entry.field);
    var target = entry.reveal ? document.getElementById(entry.reveal) : control;
    var node = target;
    while (node) {
      if (node.tagName === 'DETAILS') node.open = true;
      node = node.parentElement;
    }
    if (control && control.focus) control.focus();
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
  };

  // ===== Rendu =====

  Manager.prototype.render = function () {
    if (!this.host) return this;
    var self = this;
    var state = this.state(), context = this.context();
    var active = activeConstraints(state, context, this.catalog);
    this.host.textContent = '';
    active.forEach(function (constraint) {
      self.host.appendChild(self._chip(constraint, state));
    });
    this.host.hidden = !active.length;
    if (this.trigger) {
      var count = active.length;
      this.trigger.setAttribute('aria-expanded', String(this._open));
      var badge = this.trigger.querySelector('.constraint-count');
      if (badge) { badge.textContent = count ? String(count) : ''; badge.hidden = !count; }
    }
    this._renderMenu(state, context);
    return this;
  };

  Manager.prototype._chip = function (constraint, state) {
    var self = this;
    var entry = descriptor(constraint.field, this.catalog);
    var chip = document.createElement('span');
    chip.className = 'constraint-chip';
    chip.dataset.constraint = constraint.field;

    var editable = entry.kind !== 'checkbox' && entry.kind !== 'opaque' && entry.kind !== 'select';
    if (editable) {
      var label = document.createElement('span');
      label.className = 'constraint-chip-label';
      label.textContent = entry.label;
      chip.appendChild(label);

      var input = document.createElement('input');
      input.type = 'number';
      input.className = 'constraint-chip-input';
      input.value = state[entry.field];
      input.setAttribute('aria-label', entry.name);
      if (entry.step) input.step = entry.step;
      input.addEventListener('input', function () {
        var control = self._control(entry.field);
        if (!control) return;
        control.value = input.value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        self.onChange(entry.field, input.value);
      });
      // Un chip vidé disparaît : c'est la façon la plus directe de lever une
      // contrainte sans chercher le bouton de suppression.
      input.addEventListener('blur', function () { if (String(input.value).trim() === '') self.remove(entry.field); });
      chip.appendChild(input);

      if (entry.unit) {
        var unit = document.createElement('span');
        unit.className = 'constraint-chip-unit';
        unit.textContent = entry.unit;
        chip.appendChild(unit);
      }
    } else {
      var text = document.createElement('button');
      text.type = 'button';
      text.className = 'constraint-chip-label constraint-chip-open';
      text.textContent = constraint.text;
      text.setAttribute('aria-label', 'Modifier ' + entry.name);
      text.addEventListener('click', function () { self.reveal(entry); });
      chip.appendChild(text);
    }

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'constraint-chip-remove';
    remove.setAttribute('aria-label', 'Supprimer la contrainte ' + entry.name);
    remove.textContent = '×';
    remove.addEventListener('click', function () { self.remove(entry.field); });
    chip.appendChild(remove);
    return chip;
  };

  Manager.prototype._renderMenu = function (state, context) {
    if (!this.menu) return;
    var self = this;
    var groups = available(state, context, this.catalog, this.categories);
    this.menu.textContent = '';
    if (!groups.length) {
      var empty = document.createElement('p');
      empty.className = 'constraint-menu-empty';
      empty.textContent = 'Toutes les contraintes disponibles sont déjà actives.';
      this.menu.appendChild(empty);
      return;
    }
    groups.forEach(function (group) {
      var section = document.createElement('div');
      section.className = 'constraint-menu-group';
      var title = document.createElement('h4');
      title.textContent = group.label;
      section.appendChild(title);
      group.entries.forEach(function (entry) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'constraint-menu-item';
        button.dataset.field = entry.field;
        button.textContent = entry.name.charAt(0).toUpperCase() + entry.name.slice(1);
        button.addEventListener('click', function () { self.add(entry.field); });
        section.appendChild(button);
      });
      self.menu.appendChild(section);
    });
  };

  // ===== Menu d'ajout =====

  Manager.prototype.openMenu = function () {
    this._open = true;
    if (this.menu) this.menu.hidden = false;
    if (this.trigger) this.trigger.setAttribute('aria-expanded', 'true');
    return this;
  };
  Manager.prototype.closeMenu = function () {
    this._open = false;
    if (this.menu) this.menu.hidden = true;
    if (this.trigger) this.trigger.setAttribute('aria-expanded', 'false');
    return this;
  };
  Manager.prototype.toggleMenu = function () { return this._open ? this.closeMenu() : this.openMenu(); };

  Manager.prototype.bind = function () {
    var self = this;
    if (this.trigger) {
      this.trigger.addEventListener('click', function (event) { event.stopPropagation(); self.toggleMenu(); });
    }
    document.addEventListener('click', function (event) {
      if (!self._open) return;
      if (self.menu && (self.menu.contains(event.target) || (self.trigger && self.trigger.contains(event.target)))) return;
      self.closeMenu();
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && self._open) self.closeMenu(); });
    // Toute saisie ailleurs dans la configuration peut activer une contrainte :
    // c'est ainsi qu'une URL partagée ou les réglages avancés font apparaître
    // les chips correspondants, sans code de migration dédié.
    var sidebar = document.getElementById(this.sidebar);
    if (sidebar) {
      sidebar.addEventListener('change', function (event) {
        if (event.target && event.target.closest && event.target.closest('.constraint-chip')) return;
        self.render();
      });
    }
    this.closeMenu();
    this.render();
    return this;
  };

  return { Manager: Manager, CATALOG: CATALOG, CATEGORIES: CATEGORIES,
    descriptor: descriptor, isActive: isActive, describe: describe,
    activeConstraints: activeConstraints, available: available };
});
