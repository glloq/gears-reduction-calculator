// RequirementForm.js - Première vue : décrire le BESOIN, rien d'autre.
//
// Les cartes d'objectif pilotent le `<select id="objective_mode">` conservé
// masqué : c'est lui que lit SearchParams, donc les URLs partagées, les presets
// et le worker continuent de fonctionner sans adaptation.
//
// « Vitesse + couple » n'est pas un mode moteur distinct : c'est l'objectif
// « vitesse de sortie » assorti d'une contrainte de couple minimum. Le mapping
// est explicite ici plutôt que caché dans le moteur.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else { root.GearRequirementForm = api; if (root.GearApp) root.GearApp.ui.RequirementForm = api.Form; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // objective UI → { mode moteur, contrainte impliquée }
  var OBJECTIVES = [
    { id: 'ratio', mode: 'ratio', label: 'Rapport' },
    { id: 'need', mode: 'need', label: 'Vitesse de sortie' },
    { id: 'needTorque', mode: 'need', label: 'Vitesse + couple', requires: 'minimum_output_torque', suggest: 80 },
    { id: 'rotationTranslation', mode: 'rotationTranslation', label: 'Rotation → translation' }
  ];

  function byId(id) {
    for (var i = 0; i < OBJECTIVES.length; i++) if (OBJECTIVES[i].id === id) return OBJECTIVES[i];
    return null;
  }

  /**
   * Carte à activer pour un état donné. « Vitesse + couple » l'emporte sur
   * « Vitesse de sortie » dès qu'une contrainte de couple est posée : c'est
   * exactement ce que l'utilisateur a demandé.
   */
  function activeObjective(mode, hasTorqueConstraint) {
    if (mode === 'need') return hasTorqueConstraint ? 'needTorque' : 'need';
    return mode === 'rotationTranslation' ? 'rotationTranslation' : 'ratio';
  }

  // ===== Liaison au DOM =====

  function Form(options) {
    options = options || {};
    this.cards = options.cards || null;
    this.constraints = options.constraints || null;   // ConstraintManager
    this.onChange = options.onChange || function () {};
  }

  Form.prototype._select = function () { return document.getElementById('objective_mode'); };

  Form.prototype._torque = function () {
    var input = document.getElementById('minimum_output_torque');
    return input && String(input.value).trim() !== '';
  };

  Form.prototype.current = function () {
    var select = this._select();
    return activeObjective(select ? select.value : 'ratio', this._torque());
  };

  Form.prototype.choose = function (id) {
    var objective = byId(id);
    if (!objective) return this;
    var select = this._select();
    if (select && select.value !== objective.mode) {
      select.value = objective.mode;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // La contrainte impliquée est posée si elle manque, retirée si l'objectif
    // ne la porte plus — sans jamais écraser une valeur déjà saisie.
    if (objective.requires && this.constraints) {
      if (!this._torque()) this.constraints.set(objective.requires, objective.suggest);
    } else if (id === 'need' && this.constraints && this._torque()) {
      this.constraints.remove('minimum_output_torque');
    }
    this.render();
    this.onChange(id);
    return this;
  };

  Form.prototype.render = function () {
    if (!this.cards) return this;
    var active = this.current();
    Array.prototype.forEach.call(this.cards.querySelectorAll('[data-objective]'), function (card) {
      var selected = card.dataset.objective === active;
      card.classList.toggle('active', selected);
      card.setAttribute('aria-checked', String(selected));
      card.tabIndex = selected ? 0 : -1;
    });
    return this;
  };

  Form.prototype.bind = function () {
    var self = this;
    if (this.cards) {
      this.cards.addEventListener('click', function (event) {
        var card = event.target.closest('[data-objective]');
        if (card) self.choose(card.dataset.objective);
      });
      // Navigation clavier d'un groupe radio : flèches entre les cartes.
      this.cards.addEventListener('keydown', function (event) {
        var keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
        if (keys.indexOf(event.key) < 0) return;
        var cards = Array.prototype.slice.call(self.cards.querySelectorAll('[data-objective]'));
        var index = cards.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        var step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        var next = cards[(index + step + cards.length) % cards.length];
        next.focus();
        self.choose(next.dataset.objective);
      });
    }
    var select = this._select();
    if (select) select.addEventListener('change', function () { self.render(); });
    var torque = document.getElementById('minimum_output_torque');
    if (torque) torque.addEventListener('change', function () { self.render(); });
    this.render();
    return this;
  };

  return { Form: Form, OBJECTIVES: OBJECTIVES, byId: byId, activeObjective: activeObjective };
});
