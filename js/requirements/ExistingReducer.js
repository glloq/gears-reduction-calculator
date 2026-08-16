// ExistingReducer.js - Le réducteur qu'on a déjà (P2, §G).
//
// « J'ai déjà un réducteur » était le seul point de départ que le logiciel ne
// savait pas entendre. Il savait tout calculer d'une chaîne d'étages — c'est
// exactement ce que fait `StageEditor` — mais uniquement APRÈS une recherche,
// donc jamais sur celui qu'on a sous les yeux.
//
// Ce modèle décrit cette chaîne AVANT toute recherche. Il ne recalcule rien
// lui-même : il construit des étages au format du moteur et laisse
// `StageEditorHelpers` les valider et les analyser, pour que le réducteur
// existant soit mesuré par exactement le même code que ses remplaçants.
// Deux jeux de formules donneraient deux vérités, et la comparaison
// « avant / après » n'en serait plus une.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(
    common ? require('../ui/StageEditor.js') : root.GearStageEditorHelpers,
    common ? require('../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry,
    common ? require('../core/Engineering.js') : root.GearEngineering,
    common ? require('../core/ManufacturingRules.js') : root.ManufacturingRules
  );
  if (common) module.exports = api;
  else {
    root.GearExistingReducer = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.ExistingReducer = api.ExistingReducer;
      root.GearApp.requirements.existingReducer = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function (Helpers, Registry, Engineering, ManufacturingRules) {
  'use strict';

  /**
   * Ce qu'on peut modifier sur un étage décrit à la main, par famille. Ce sont
   * les mêmes champs que l'éditeur d'étages : un réducteur décrit ici et un
   * réducteur trouvé par le moteur se manipulent de la même façon.
   */
  var FIELDS = {
    pair: [
      { path: 'input.teeth', label: 'Menante', unit: 'dents', min: 4, step: 1 },
      { path: 'output.teeth', label: 'Menée', unit: 'dents', min: 4, step: 1 }
    ],
    worm: [
      { path: 'wormStarts', label: 'Filets', unit: '', min: 1, max: 6, step: 1 },
      { path: 'wheelTeeth', label: 'Roue', unit: 'dents', min: 15, step: 1 }
    ],
    planetary: [
      { path: 'sunTeeth', label: 'Solaire', unit: 'dents', min: 6, step: 1 },
      { path: 'ringTeeth', label: 'Couronne', unit: 'dents', min: 20, step: 1 }
    ]
  };

  /** Ce qu'on cherche à gagner en repartant d'un réducteur existant. */
  // Les identifiants sont ceux d'`ExplorationPlanner.METRICS` : une seule
  // formule par performance, quel que soit le parcours qui la demande. Le
  // rapport n'y figure pas — à rapport égal, il n'y a rien à y gagner.
  var GOALS = [
    { id: 'compact', label: 'Plus compact', sort: 'compactness' },
    { id: 'efficiency', label: 'Meilleur rendement', sort: 'efficiency' },
    { id: 'torque', label: 'Plus de couple', sort: 'torque' },
    { id: 'simple', label: 'Plus simple', sort: 'stages' }
  ];

  function fieldsFor(type) {
    return FIELDS[Helpers.registryId(type)] || FIELDS.pair;
  }

  function get(stage, path) {
    return path.split('.').reduce(function (node, key) { return node == null ? null : node[key]; }, stage);
  }

  function set(stage, path, value) {
    var keys = path.split('.'), last = keys.pop();
    var node = keys.reduce(function (current, key) {
      if (!current[key]) current[key] = {};
      return current[key];
    }, stage);
    node[last] = value;
  }

  function ExistingReducer(seed) {
    this.stages = [];
    this.goal = 'compact';
    if (seed) this.merge(seed);
  }

  ExistingReducer.prototype.merge = function (seed) {
    if (Array.isArray(seed)) { this.stages = JSON.parse(JSON.stringify(seed)); return this; }
    if (seed.stages) this.stages = JSON.parse(JSON.stringify(seed.stages));
    if (seed.goal && goal(seed.goal)) this.goal = seed.goal;
    return this;
  };

  ExistingReducer.prototype.addStage = function (type, module) {
    this.stages.push(Helpers.defaultStage(type || 'spur', module));
    return this;
  };

  ExistingReducer.prototype.removeStage = function (index) {
    if (index >= 0 && index < this.stages.length) this.stages.splice(index, 1);
    return this;
  };

  /** Change la famille d'un étage sans perdre le module déjà saisi. */
  ExistingReducer.prototype.setType = function (index, type) {
    var stage = this.stages[index];
    if (!stage) return this;
    var module = stage.parameters && stage.parameters.module;
    this.stages[index] = Helpers.defaultStage(type, module);
    return this;
  };

  ExistingReducer.prototype.setField = function (index, path, value) {
    var stage = this.stages[index];
    if (stage) set(stage, path, value);
    return this;
  };

  ExistingReducer.prototype.setGoal = function (id) {
    if (goal(id)) this.goal = id;
    return this;
  };

  ExistingReducer.prototype.isDescribed = function () { return this.stages.length > 0; };

  /** Familles utilisées : le point de départ naturel d'une recherche d'équivalent. */
  ExistingReducer.prototype.families = function () {
    var out = [];
    this.stages.forEach(function (stage) {
      var id = Helpers.registryId(stage.type);
      if (out.indexOf(id) === -1) out.push(id);
    });
    return out;
  };

  /** Erreurs par étage, avant toute analyse — un réducteur décrit peut être faux. */
  ExistingReducer.prototype.validate = function () {
    return Helpers.validateStages(this.stages, Registry);
  };

  ExistingReducer.prototype.errors = function () {
    var out = [];
    this.validate().forEach(function (entry, index) {
      entry.errors.forEach(function (text) { out.push({ stage: index + 1, text: text }); });
    });
    return out;
  };

  /**
   * Le réducteur existant, analysé comme n'importe quelle solution : c'est ce
   * qui en fait une RÉFÉRENCE comparable, et pas une simple saisie.
   * @param {object} options options d'ingénierie (vitesse, couple, matériaux…)
   */
  ExistingReducer.prototype.analyze = function (options) {
    if (!this.stages.length) return null;
    if (this.errors().length) return null;
    var result = Helpers.reanalyze(this.stages, { engineeringOptions: options || {} }, {
      Registry: Registry, Engineering: Engineering, ManufacturingRules: ManufacturingRules
    });
    if (!result.solution) return null;
    // Rien n'a été visé : l'écart de rapport d'une référence n'a pas de sens.
    result.solution.errorPercent = 0;
    result.solution.isExisting = true;
    return result.solution;
  };

  /** Le rapport de la chaîne décrite, ou null si elle ne se calcule pas. */
  ExistingReducer.prototype.ratio = function () {
    if (!this.stages.length) return null;
    var total = 1, ok = true;
    this.stages.forEach(function (stage) {
      var definition = Registry.get(Helpers.registryId(stage.type));
      var value = null;
      try { value = definition && definition.calculateRatio(stage); } catch (ignore) { value = null; }
      if (!isFinite(value) || !value) ok = false; else total *= Math.abs(value);
    });
    return ok ? total : null;
  };

  ExistingReducer.prototype.describe = function () {
    if (!this.stages.length) return null;
    var ratio = this.ratio();
    return this.stages.length + (this.stages.length > 1 ? ' étages' : ' étage') +
      (ratio ? ', rapport ' + (Math.round(ratio * 100) / 100) + ':1' : '');
  };

  ExistingReducer.prototype.toJSON = function () {
    return { stages: JSON.parse(JSON.stringify(this.stages)), goal: this.goal };
  };

  ExistingReducer.prototype.clone = function () { return new ExistingReducer(this.toJSON()); };

  function goal(id) {
    for (var i = 0; i < GOALS.length; i++) if (GOALS[i].id === id) return GOALS[i];
    return null;
  }

  return { ExistingReducer: ExistingReducer, FIELDS: FIELDS, GOALS: GOALS,
    fieldsFor: fieldsFor, goal: goal, get: get };
});
