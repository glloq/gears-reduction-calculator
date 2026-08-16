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
// Trois points de départ suffisent : CONCEVOIR, EXPLORER, AMÉLIORER. Tout le
// reste — viser une cible ou accepter un compromis, partir de contraintes,
// puiser dans son stock — se déduit de ce que l'utilisateur a écrit. Le lui
// redemander sous forme de cartes lui ferait répéter ce qu'il vient de dire.
//
// Seuls figurent ici les modes que le moteur sait réellement traiter : une
// carte sans effet est pire que son absence.
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
   * TROIS points de départ, et pas un de plus. Les six « méthodes »
   * précédentes mélangeaient trois choses de natures différentes :
   *
   *   une vraie méthode de résolution   viser / explorer / améliorer
   *   une stratégie de classement       « trouver le meilleur »
   *   des données déjà en main          contraintes, pièces disponibles
   *
   * Seule la première est une décision que l'utilisateur doit prendre. Les
   * deux autres, le logiciel les DÉDUIT : un rapport écrit « = 12 » demande
   * une cible stricte, « ≈ 12 » autorise un compromis, « 10 → 15 » ouvre une
   * plage ; un Ø ≤ 80 mm posé EST une contrainte de départ ; un inventaire de
   * dentures saisi EST une recherche dans son stock. Demander tout cela en
   * plus, sous forme de cartes, revenait à faire répéter ce qui était déjà dit.
   *
   * `focus` désigne l'étape sur laquelle le modal ouvre : chaque méthode part
   * de ce que l'utilisateur a réellement en main.
   * `tolerance` est la tolérance de rapport imposée par la méthode, en
   * pourcent, ou null pour laisser parler l'intention de la grandeur.
   */
  var MODES = [
    {
      id: 'design', label: 'Concevoir', icon: '⚙',
      help: 'Je connais au moins une partie de ce que je veux : rapport, vitesse, couple, dimensions, pièces disponibles…',
      focus: 'need', tolerance: null,          // l'intention de la grandeur fait foi
      summary: 'Concevoir'
    },
    {
      id: 'maximize', label: 'Explorer les limites', icon: '↗',
      help: 'Je ne connais pas encore le rapport : quel maximum puis-je atteindre sous mes contraintes ?',
      focus: 'need', tolerance: null, explore: true,
      summary: 'Espace de conception'
    },
    {
      id: 'improve', label: 'Améliorer l’existant', icon: '↻',
      help: 'Je décris le réducteur que j’ai, et je cherche mieux à rapport égal.',
      focus: 'type', tolerance: 2, improve: true,
      summary: 'Depuis l’existant'
    }
  ];

  /**
   * Anciennes méthodes, ramenées à leur parcours. Une session partagée ou
   * restaurée porte encore ces identifiants : les ignorer la ferait repartir
   * du mode par défaut sans le dire.
   */
  var ALIASES = { best: 'design', target: 'design', constrained: 'design', parts: 'design' };

  /**
   * Performances qu'une exploration peut pousser. Les mots vivent ici, les
   * formules dans `ExplorationPlanner` : une seule source pour chacun.
   */
  var OBJECTIVES = [
    { id: 'torque', label: 'Couple de sortie', help: 'Le plus grand couple tenable sous ces contraintes.', sort: 'torque' },
    { id: 'ratio', label: 'Rapport de réduction', help: 'La plus forte réduction qui tienne.', sort: 'ratio' },
    { id: 'efficiency', label: 'Rendement', help: 'Le moins de pertes possible.', sort: 'efficiency' },
    { id: 'compact', label: 'Encombrement', help: 'Le plus petit réducteur possible.', sort: 'compactness' },
    { id: 'simple', label: 'Simplicité', help: 'Le moins d’étages possible.', sort: 'stages' }
  ];

  /**
   * Espace balayé par défaut, faute d'indication. Il est ANNONCÉ, jamais
   * imposé en silence (§10) : le modal l'affiche comme une plage modifiable.
   */
  var DEFAULT_SPAN = { min: 1, max: 200 };

  /**
   * Modes reconnus mais non encore réalisables : déclarés, jamais affichés.
   * Une carte sans effet serait pire que son absence — la liste est vide
   * aujourd'hui, et ce fichier est l'endroit où la rouvrir.
   */
  var PLANNED = [];

  function objective(id) {
    for (var i = 0; i < OBJECTIVES.length; i++) if (OBJECTIVES[i].id === id) return OBJECTIVES[i];
    return null;
  }

  function mode(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return null;
  }

  /** Résout un identifiant, y compris celui d'une ancienne méthode. */
  function resolve(id) {
    return mode(id) ? id : (ALIASES[id] && mode(ALIASES[id]) ? ALIASES[id] : null);
  }

  function SearchIntentModel(seed) {
    this.mode = 'design';
    this.objective = 'torque';
    if (seed) this.merge(seed);
  }

  SearchIntentModel.prototype.merge = function (seed) {
    if (typeof seed === 'string') return this.setMode(seed);
    if (seed && seed.mode) this.setMode(seed.mode);
    if (seed && seed.objective && objective(seed.objective)) this.objective = seed.objective;
    return this;
  };

  SearchIntentModel.prototype.setMode = function (id) {
    var resolved = resolve(id);
    if (resolved) this.mode = resolved;
    return this;
  };

  SearchIntentModel.prototype.setObjective = function (id) {
    if (objective(id)) this.objective = id;
    return this;
  };

  /** La performance poursuivie, quand la méthode en poursuit une. */
  SearchIntentModel.prototype.objectiveDescriptor = function () {
    return this.explores() ? objective(this.objective) || OBJECTIVES[0] : null;
  };

  /** Cette méthode balaye-t-elle un espace au lieu de viser un rapport ? */
  SearchIntentModel.prototype.explores = function () { return !!this.descriptor().explore; };

  /** Cette méthode part-elle d'un réducteur déjà construit ? */
  SearchIntentModel.prototype.improves = function () { return !!this.descriptor().improve; };

  SearchIntentModel.prototype.descriptor = function () { return mode(this.mode) || MODES[0]; };

  /** Étape sur laquelle ouvrir le modal pour cette méthode. */
  SearchIntentModel.prototype.focusStep = function () { return this.descriptor().focus; };

  /**
   * Tolérance de rapport à appliquer, ou null pour laisser parler l'intention
   * de la grandeur elle-même (« ≈ 12 » vaut mieux que n'importe quel défaut).
   */
  SearchIntentModel.prototype.ratioTolerance = function () { return this.descriptor().tolerance; };

  SearchIntentModel.prototype.describe = function () {
    var target = this.objectiveDescriptor();
    return target ? this.descriptor().summary + ' → ' + target.label.toLowerCase() : this.descriptor().summary;
  };

  SearchIntentModel.prototype.toJSON = function () { return { mode: this.mode, objective: this.objective }; };

  return { SearchIntentModel: SearchIntentModel, MODES: MODES, PLANNED: PLANNED, mode: mode,
    OBJECTIVES: OBJECTIVES, objective: objective, DEFAULT_SPAN: DEFAULT_SPAN,
    ALIASES: ALIASES, resolve: resolve };
});
