// WorkspaceModel.js - Ce que l'utilisateur est venu FAIRE.
//
// Il manquait un niveau au-dessus de `SearchIntentModel`. Celui-ci est bien
// défini — « ce que je demande au solveur de trouver » — et c'est précisément
// pourquoi il ne pouvait pas porter tous les usages : la moitié d'entre eux ne
// demandent rien à aucun solveur.
//
//   « voilà mon système, dis-moi ce qu'il fait »   n'est pas une recherche
//   « je choisis moi-même mes étages »             n'est pas une recherche
//   « complète les inconnues de ma chaîne »        est une recherche PARTIELLE
//
// Tout faire entrer dans `SearchIntentModel` aurait obligé à inventer des
// modes de recherche pour des parcours qui n'en lancent aucune. Le mode de
// travail répond donc à « que voulez-vous faire ? », et l'intention de
// recherche ne sert plus que lorsqu'il y a effectivement quelque chose à
// chercher.
//
// Règle héritée de `SearchIntentModel`, et maintenue ici : un mode qui n'a pas
// d'effet réel n'est pas affiché. `PLANNED` est l'endroit où un mode attend
// d'être réalisé, déclaré mais absent de l'écran.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else {
    root.GearWorkspaceModel = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.WorkspaceModel = api.WorkspaceModel;
      root.GearApp.requirements.workspace = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Ce que le mode fait RÉELLEMENT tourner. C'est la distinction utile, celle
   * qui décide du parcours et du bouton d'action :
   *
   *   'search'    une recherche complète, sur tout l'espace des chaînes
   *   'complete'  une recherche restreinte aux inconnues d'une chaîne donnée
   *   'analyze'   aucune recherche : la chaîne est connue, on la calcule
   */
  var ENGINES = { search: 'search', complete: 'complete', analyze: 'analyze' };

  /**
   * Les modes de travail. `intent` est l'intention de recherche à adopter
   * quand le mode en lance une — c'est le seul lien avec `SearchIntentModel`,
   * et il va dans ce sens-là uniquement.
   */
  var MODES = [
    {
      id: 'design', label: 'Concevoir', icon: '★',
      help: 'Trouver automatiquement une transmission qui répond à mon besoin.',
      engine: ENGINES.search, intent: 'design', focus: 'need'
    },
    {
      id: 'build', label: 'Construire', icon: '✚',
      help: 'Choisir moi-même les étages, et laisser le système compléter ce que je ne fixe pas.',
      // Compléter par défaut ; une chaîne entièrement décrite bascule d'elle-
      // même en simple calcul (voir `engineFor`).
      engine: ENGINES.complete, intent: 'design', focus: 'build'
    },
    {
      id: 'analyze', label: 'Étudier l’existant', icon: '◉',
      help: 'Décrire un mécanisme et savoir ce qu’il fait, et s’il tient.',
      engine: ENGINES.analyze, intent: null, focus: 'build'
    },
    {
      id: 'explore', label: 'Explorer', icon: '↗',
      help: 'Je ne sais pas encore ce qui est possible : chercher les limites.',
      engine: ENGINES.search, intent: 'maximize', focus: 'need'
    },
    {
      id: 'optimize', label: 'Optimiser', icon: '↻',
      help: 'J’ai un système : en chercher un meilleur, à rapport égal.',
      engine: ENGINES.search, intent: 'improve', focus: 'type'
    }
  ];

  /**
   * Modes reconnus mais pas encore réalisables. Ils sont déclarés ici — c'est
   * la carte de la suite — et n'apparaissent NULLE PART à l'écran : une carte
   * qui ne fait rien coûte plus cher qu'une carte absente.
   */
  var PLANNED = [
    { id: 'compare', label: 'Comparer', icon: '⇄',
      help: 'Étudier plusieurs architectures pour un même besoin.' }
  ];

  function mode(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return null;
  }

  function WorkspaceModel(seed) {
    this.mode = 'design';
    if (seed) this.merge(seed);
  }

  WorkspaceModel.prototype.merge = function (seed) {
    if (typeof seed === 'string') return this.setMode(seed);
    if (seed && seed.mode) this.setMode(seed.mode);
    return this;
  };

  WorkspaceModel.prototype.setMode = function (id) {
    if (mode(id)) this.mode = id;
    return this;
  };

  WorkspaceModel.prototype.descriptor = function () { return mode(this.mode) || MODES[0]; };

  /**
   * « Entièrement manuel », « compléter », « dimensionner l'architecture » sont
   * trois façons de décrire le MÊME travail, qui ne diffèrent que par ce qui
   * est déjà connu de la chaîne. Les faire choisir en plus serait demander à
   * l'utilisateur de classer lui-même ce qu'il vient d'écrire — et l'autoriser
   * à se tromper : cocher « entièrement manuel » sur une chaîne incomplète, ou
   * « compléter » sur une chaîne qui n'a plus rien d'inconnu. Le mode de calcul
   * se DÉDUIT donc de la chaîne, exactement comme le degré de liberté d'un
   * étage se déduit de ses valeurs.
   *
   * @param {number} unknownStages étages non entièrement déterminés
   */
  WorkspaceModel.prototype.engineFor = function (unknownStages) {
    if (this.mode === 'build') return unknownStages > 0 ? ENGINES.complete : ENGINES.analyze;
    return this.descriptor().engine;
  };

  /** Ce qui tourne par défaut, chaîne inconnue. Voir `engineFor`. */
  WorkspaceModel.prototype.engine = function () { return this.descriptor().engine; };

  WorkspaceModel.prototype.runsSearch = function () { return this.engine() !== ENGINES.analyze; };

  /** Le mode décrit-il une chaîne d'étages plutôt qu'un besoin ? */
  WorkspaceModel.prototype.editsChain = function () { return this.descriptor().focus === 'build'; };

  /**
   * L'intention à donner au solveur, ou null quand rien n'est cherché.
   * C'est la seule dépendance vers `SearchIntentModel`, et elle ne va que
   * dans ce sens : le mode de travail décide, l'intention obéit.
   */
  WorkspaceModel.prototype.searchIntent = function () {
    return this.runsSearch() ? this.descriptor().intent : null;
  };

  /** Étape sur laquelle ouvrir le modal. */
  WorkspaceModel.prototype.focusStep = function () { return this.descriptor().focus; };

  WorkspaceModel.prototype.describe = function () { return this.descriptor().label; };

  WorkspaceModel.prototype.toJSON = function () { return { mode: this.mode }; };

  WorkspaceModel.prototype.clone = function () { return new WorkspaceModel(this.toJSON()); };

  return { WorkspaceModel: WorkspaceModel, MODES: MODES, PLANNED: PLANNED,
    ENGINES: ENGINES, mode: mode };
});
