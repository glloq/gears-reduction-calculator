// SearchIntentModel.js - Ce qu'on demande au solveur de TROUVER.
//
// Il manquait une distinction que rien ne portait :
//
//   SearchIntent      ce que je demande au solveur de trouver
//   PreferenceModel   comment départager les bonnes solutions
//
// Jusqu'ici la méthode de recherche et le choix de la technologie étaient la
// même question — « conseillez-moi / je connais le type / architecture » —
// alors que ce sont deux décisions indépendantes : on peut vouloir le meilleur
// compromis EN imposant un planétaire, ou viser un rapport exact en laissant
// le système choisir la famille.
//
// Seuls figurent ici les modes que le moteur sait réellement traiter. Les
// autres (maximiser sans cible, repartir d'un réducteur existant) demandent une
// extension du solveur : les afficher en attendant produirait des cartes sans
// effet, ce qui est pire que leur absence.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else {
    root.GearSearchIntentModel = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.SearchIntentModel = api.SearchIntentModel;
      root.GearApp.requirements.searchIntent = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * `focus` désigne l'étape sur laquelle le modal ouvre : chaque méthode part
   * de ce que l'utilisateur a réellement en main.
   * `tolerance` est la tolérance de rapport par défaut, en pourcent : chercher
   * « le meilleur compromis » n'a pas de sens à 0,1 % près, et viser une cible
   * n'en a pas non plus à 5 %.
   */
  var MODES = [
    {
      id: 'best', label: 'Trouver le meilleur', icon: '★',
      help: 'Le système compare les architectures possibles et propose le meilleur compromis.',
      focus: 'need', tolerance: 3,
      summary: 'Meilleur compromis'
    },
    {
      id: 'target', label: 'Atteindre une cible', icon: '◎',
      help: 'Je connais le rapport, la vitesse ou le couple à obtenir.',
      focus: 'need', tolerance: null,          // l'intention de la grandeur fait foi
      summary: 'Cible à atteindre'
    },
    {
      id: 'constrained', label: 'Partir de contraintes', icon: '◫',
      help: 'Je pars de l’espace disponible ou d’une architecture imposée.',
      focus: 'criteria', tolerance: 5,
      summary: 'Sous contraintes'
    },
    {
      id: 'parts', label: 'Pièces existantes', icon: '⚙',
      help: 'J’ai un module, des dentures ou un entraxe imposés.',
      focus: 'criteria', tolerance: 8, parts: true,
      summary: 'Depuis les composants'
    }
  ];

  /** Modes reconnus mais non encore réalisables : déclarés, jamais affichés. */
  var PLANNED = [
    { id: 'maximize', label: 'Maximiser une performance', needs: 'un solveur sans rapport cible' },
    { id: 'improveExisting', label: 'Améliorer un réducteur existant', needs: 'un orchestrateur de recherches' }
  ];

  function mode(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return null;
  }

  function SearchIntentModel(seed) {
    this.mode = 'best';
    if (seed) this.merge(seed);
  }

  SearchIntentModel.prototype.merge = function (seed) {
    if (typeof seed === 'string') { if (mode(seed)) this.mode = seed; return this; }
    if (seed && seed.mode && mode(seed.mode)) this.mode = seed.mode;
    return this;
  };

  SearchIntentModel.prototype.setMode = function (id) {
    if (mode(id)) this.mode = id;
    return this;
  };

  SearchIntentModel.prototype.descriptor = function () { return mode(this.mode) || MODES[0]; };

  /** Étape sur laquelle ouvrir le modal pour cette méthode. */
  SearchIntentModel.prototype.focusStep = function () { return this.descriptor().focus; };

  /**
   * Tolérance de rapport à appliquer, ou null pour laisser parler l'intention
   * de la grandeur elle-même (« ≈ 12 » vaut mieux que n'importe quel défaut).
   */
  SearchIntentModel.prototype.ratioTolerance = function () { return this.descriptor().tolerance; };

  SearchIntentModel.prototype.describe = function () { return this.descriptor().summary; };

  /** Cette méthode part-elle d'un inventaire de composants ? */
  SearchIntentModel.prototype.startsFromParts = function () { return !!this.descriptor().parts; };

  SearchIntentModel.prototype.toJSON = function () { return { mode: this.mode }; };

  return { SearchIntentModel: SearchIntentModel, MODES: MODES, PLANNED: PLANNED, mode: mode };
});
