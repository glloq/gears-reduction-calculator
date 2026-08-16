// PrioritySelector.js - Priorités utilisateur au lieu de huit curseurs.
//
// Une priorité est un PRESET des contrôles existants : elle écrit `search_mode`
// et les huit `weight_*`. Ceux-ci restent la source lue par SearchParams, donc
// rien à changer côté moteur. Dès que l'utilisateur touche un curseur, la
// priorité bascule sur « Personnalisé » — et il peut revenir à un preset d'un
// clic, sans perdre la possibilité de régler finement.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else { root.GearPrioritySelector = api; if (root.GearApp) root.GearApp.ui.PrioritySelector = api.Selector; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WEIGHTS = ['ratio', 'size', 'efficiency', 'stress', 'stages', 'noise', 'manufacturing', 'cost'];

  // searchMode : mode d'optimisation du moteur ; weights : pondération globale.
  // Les deux sont cohérents pour qu'un preset ne se contredise pas lui-même.
  var PRIORITIES = [
    { id: 'recommended', label: 'Recommandé', searchMode: 'minimumStages',
      help: 'Le meilleur compromis général : peu d’étages, précision correcte.',
      weights: { ratio: 6, size: 5, efficiency: 5, stress: 5, stages: 6, noise: 4, manufacturing: 5, cost: 5 } },
    { id: 'compact', label: 'Compact', searchMode: 'compact',
      help: 'Minimise l’encombrement, quitte à ajouter un étage.',
      weights: { ratio: 5, size: 10, efficiency: 4, stress: 4, stages: 3, noise: 3, manufacturing: 4, cost: 4 } },
    { id: 'efficiency', label: 'Rendement', searchMode: 'efficiency',
      help: 'Privilégie le rendement global de la chaîne.',
      weights: { ratio: 5, size: 3, efficiency: 10, stress: 4, stages: 6, noise: 5, manufacturing: 3, cost: 3 } },
    { id: 'robust', label: 'Robuste', searchMode: 'robust',
      help: 'Favorise les marges de sécurité en flexion et au contact.',
      weights: { ratio: 4, size: 3, efficiency: 4, stress: 10, stages: 4, noise: 4, manufacturing: 4, cost: 3 } },
    { id: 'manufacturing', label: 'Simple à fabriquer', searchMode: 'manufacturing',
      help: 'Favorise les architectures simples et les pièces faciles à produire.',
      weights: { ratio: 4, size: 4, efficiency: 4, stress: 5, stages: 8, noise: 3, manufacturing: 10, cost: 6 } },
    { id: 'cost', label: 'Faible coût', searchMode: 'minimumStages',
      help: 'Limite le nombre de pièces et la complexité.',
      weights: { ratio: 4, size: 5, efficiency: 4, stress: 4, stages: 9, noise: 3, manufacturing: 7, cost: 10 } },
    { id: 'noise', label: 'Faible bruit', searchMode: 'global',
      help: 'Pénalise les dentures droites au profit des solutions silencieuses.',
      weights: { ratio: 5, size: 4, efficiency: 6, stress: 5, stages: 5, noise: 10, manufacturing: 4, cost: 4 } }
  ];

  function byId(id) {
    for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].id === id) return PRIORITIES[i];
    return null;
  }

  /**
   * Priorité correspondant à un jeu de poids, ou null si aucune ne correspond
   * exactement — c'est ce qui définit l'état « Personnalisé », sans drapeau
   * séparé à maintenir.
   */
  function match(weights, searchMode) {
    for (var i = 0; i < PRIORITIES.length; i++) {
      var candidate = PRIORITIES[i];
      if (searchMode !== undefined && searchMode !== null && candidate.searchMode !== searchMode) continue;
      var same = WEIGHTS.every(function (key) { return Number(weights[key]) === candidate.weights[key]; });
      if (same) return candidate.id;
    }
    return null;
  }

  // ===== Liaison au DOM =====

  function Selector(options) {
    options = options || {};
    this.host = options.host || null;
    this.help = options.help || null;
    this.onChange = options.onChange || function () {};
    this.current = null;
  }

  Selector.prototype._weightInput = function (key) { return document.getElementById('weight_' + key); };

  Selector.prototype.readWeights = function () {
    var weights = {};
    WEIGHTS.forEach(function (key) {
      var input = document.getElementById('weight_' + key);
      weights[key] = input ? Number(input.value) : 5;
    });
    return weights;
  };

  Selector.prototype.readSearchMode = function () {
    var select = document.getElementById('search_mode');
    return select ? select.value : 'minimumStages';
  };

  /** Applique un preset aux contrôles historiques, puis notifie. */
  Selector.prototype.apply = function (id) {
    var priority = byId(id);
    if (!priority) return this;
    var self = this;
    WEIGHTS.forEach(function (key) {
      var input = self._weightInput(key);
      if (!input) return;
      input.value = priority.weights[key];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    var select = document.getElementById('search_mode');
    if (select) {
      select.value = priority.searchMode;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.current = id;
    this.render();
    this.onChange(id);
    return this;
  };

  /** Priorité déduite des contrôles : null ⇒ « Personnalisé ». */
  Selector.prototype.detect = function () {
    return match(this.readWeights(), this.readSearchMode());
  };

  Selector.prototype.render = function () {
    if (!this.host) return this;
    var self = this;
    var active = this.detect();
    this.current = active;
    this.host.textContent = '';
    PRIORITIES.forEach(function (priority) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'priority-chip' + (priority.id === active ? ' active' : '');
      chip.dataset.priority = priority.id;
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(priority.id === active));
      chip.textContent = priority.label;
      chip.addEventListener('click', function () { self.apply(priority.id); });
      self.host.appendChild(chip);
    });
    if (!active) {
      var custom = document.createElement('span');
      custom.className = 'priority-chip custom active';
      custom.textContent = 'Personnalisé';
      custom.setAttribute('role', 'radio');
      custom.setAttribute('aria-checked', 'true');
      this.host.appendChild(custom);
    }
    if (this.help) {
      var priority = active ? byId(active) : null;
      this.help.textContent = priority ? priority.help
        : 'Pondération personnalisée — choisissez une priorité pour revenir à un réglage prédéfini.';
    }
    return this;
  };

  Selector.prototype.bind = function () {
    var self = this;
    // Toucher un curseur ou changer d'optimisation bascule automatiquement en
    // « Personnalisé » : l'affichage reste toujours honnête.
    WEIGHTS.forEach(function (key) {
      var input = self._weightInput(key);
      if (input) input.addEventListener('input', function () { self.render(); });
    });
    var select = document.getElementById('search_mode');
    if (select) select.addEventListener('change', function () { self.render(); });
    this.render();
    return this;
  };

  return { Selector: Selector, PRIORITIES: PRIORITIES, WEIGHTS: WEIGHTS, byId: byId, match: match };
});
