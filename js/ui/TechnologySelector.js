// TechnologySelector.js - « Automatique » par défaut, familles à la demande.
//
// L'utilisateur n'a aucune raison de choisir une technologie avant de savoir si
// ça change quelque chose. Le mode automatique coche toutes les familles
// compatibles avec l'objectif courant ; le mode manuel révèle les cases, qui
// restent les mêmes `.type-checkbox` que SearchParams lit déjà.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else { root.GearTechnologySelector = api; if (root.GearApp) root.GearApp.ui.TechnologySelector = api.Selector; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LABELS = {
    spur: 'Engrenage droit', helical: 'Hélicoïdal', internal: 'Intérieur', bevel: 'Conique',
    epicyclic: 'Planétaire', worm: 'Vis sans fin', belt: 'Courroie', chain: 'Chaîne',
    rack: 'Crémaillère'
  };

  // Familles proposées par le mode automatique. La crémaillère est traitée à
  // part : c'est le solveur linéaire qui la pilote.
  var ROTARY = ['spur', 'helical', 'internal', 'bevel', 'epicyclic', 'worm', 'belt', 'chain'];

  /** Familles retenues par le mode automatique pour un objectif donné. */
  function automaticFor(objective) {
    return objective === 'rotationTranslation' ? ['rack'] : ROTARY.slice();
  }

  /**
   * Résumé lisible d'une sélection : « Automatique », « Droit + 2 autres »…
   * Fonction pure, donc testable sans DOM.
   */
  function summarize(selected, objective) {
    var automatic = automaticFor(objective);
    var same = selected.length === automatic.length &&
      automatic.every(function (type) { return selected.indexOf(type) !== -1; });
    if (same) return { automatic: true, label: 'Automatique', count: selected.length };
    if (!selected.length) return { automatic: false, label: 'Aucune technologie', count: 0 };
    var first = LABELS[selected[0]] || selected[0];
    return { automatic: false, count: selected.length,
      label: selected.length === 1 ? first : first + ' + ' + (selected.length - 1) + ' autre' + (selected.length > 2 ? 's' : '') };
  }

  // ===== Liaison au DOM =====

  function Selector(options) {
    options = options || {};
    this.panel = options.panel || null;        // conteneur révélé
    this.toggle = options.toggle || null;      // bouton « Modifier les technologies »
    this.autoButton = options.autoButton || null;
    this.hint = options.hint || null;
    this.onChange = options.onChange || function () {};
    this._open = false;
  }

  Selector.prototype.objective = function () {
    var select = document.getElementById('objective_mode');
    return select ? select.value : 'ratio';
  };

  Selector.prototype.selected = function () {
    return Array.prototype.map.call(document.querySelectorAll('.type-checkbox:checked'),
      function (checkbox) { return checkbox.value; });
  };

  /** Coche exactement les familles demandées, en respectant les cases désactivées. */
  Selector.prototype.select = function (types) {
    Array.prototype.forEach.call(document.querySelectorAll('.type-checkbox'), function (checkbox) {
      if (checkbox.disabled) return;
      checkbox.checked = types.indexOf(checkbox.value) !== -1;
    });
    var grid = document.querySelector('.types-grid');
    if (grid) grid.dispatchEvent(new Event('change', { bubbles: true }));
    this.render();
    this.onChange(this.selected());
    return this;
  };

  Selector.prototype.setAutomatic = function () { return this.select(automaticFor(this.objective())); };

  Selector.prototype.isAutomatic = function () { return summarize(this.selected(), this.objective()).automatic; };

  Selector.prototype.open = function (open) {
    this._open = open === undefined ? !this._open : !!open;
    if (this.panel) this.panel.hidden = !this._open;
    if (this.toggle) {
      this.toggle.setAttribute('aria-expanded', String(this._open));
      this.toggle.textContent = this._open ? 'Masquer les technologies' : 'Modifier les technologies autorisées';
    }
    return this;
  };

  Selector.prototype.render = function () {
    var summary = summarize(this.selected(), this.objective());
    if (this.autoButton) {
      this.autoButton.textContent = summary.label;
      this.autoButton.setAttribute('aria-pressed', String(summary.automatic));
      this.autoButton.classList.toggle('active', summary.automatic);
    }
    if (this.hint) {
      this.hint.textContent = summary.automatic
        ? 'Le calculateur comparera les technologies compatibles.'
        : summary.count
          ? summary.count + ' technologie' + (summary.count > 1 ? 's' : '') + ' autorisée' + (summary.count > 1 ? 's' : '') + '.'
          : 'Aucune technologie autorisée : la recherche ne peut pas aboutir.';
    }
    return this;
  };

  Selector.prototype.bind = function () {
    var self = this;
    if (this.toggle) this.toggle.addEventListener('click', function () { self.open(); });
    if (this.autoButton) this.autoButton.addEventListener('click', function () { self.setAutomatic(); });
    var grid = document.querySelector('.types-grid');
    if (grid) grid.addEventListener('change', function () { self.render(); });
    var objective = document.getElementById('objective_mode');
    if (objective) objective.addEventListener('change', function () { self.render(); });
    this.open(false);
    this.render();
    return this;
  };

  return { Selector: Selector, LABELS: LABELS, ROTARY: ROTARY, automaticFor: automaticFor, summarize: summarize };
});
