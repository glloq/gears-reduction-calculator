// TechnicalSettingsModel.js - Les réglages techniques, enfin modélisés (§14).
//
// C'était le dernier morceau lu directement dans l'ancien formulaire : plages
// de dentures, module, matériaux, fabrication, fatigue, arbres, paramètres par
// famille. Les regrouper ici ne veut PAS dire les afficher au même endroit —
// c'est l'inverse : une fois nommés et groupés, chacun peut être montré auprès
// de ce qu'il modifie (§15), au lieu d'un grand panneau « réglages avancés ».
//
// Chaque groupe sait dire s'il a été touché : c'est ce qui permet de n'afficher
// que ce que l'utilisateur a réellement décidé, et de distinguer « non
// renseigné » de « laissé par défaut ».
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry);
  if (common) module.exports = api;
  else {
    root.GearTechnicalSettingsModel = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.TechnicalSettingsModel = api.TechnicalSettingsModel;
      root.GearApp.requirements.technicalSettings = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function (Registry) {
  'use strict';

  // §8 : « 500 000 itérations » ne dit rien à personne. La profondeur nomme
  // l'arbitrage réel — qualité du balayage contre temps de calcul — et les
  // nombres restent en dessous, dans les options techniques.
  var DEPTHS = [
    { id: 'quick', label: 'Rapide', help: 'Aperçu et dimensionnement initial.', maxSolutions: 40, maxIterations: 120000 },
    { id: 'standard', label: 'Standard', help: 'Comparaison complète, recommandé.', maxSolutions: 100, maxIterations: 500000 },
    { id: 'deep', label: 'Approfondie', help: 'Explore davantage d’architectures.', maxSolutions: 200, maxIterations: 1500000 },
    { id: 'exhaustive', label: 'Exhaustive', help: 'Privilégie la qualité au temps de calcul.', maxSolutions: 400, maxIterations: 5000000 }
  ];

  function depth(id) {
    for (var i = 0; i < DEPTHS.length; i++) if (DEPTHS[i].id === id) return DEPTHS[i];
    return null;
  }

  var DEFAULTS = {
    search: { depth: 'standard', maxSolutions: 100, maxIterations: 500000 },
    // `teethInventory` et `module.list` énumèrent ce qu'on POSSÈDE : une plage
    // dit « entre 20 et 60 dents », un inventaire dit « 20, 24, 40 et 60 », et
    // aucune plage ne saura jamais exprimer le second.
    gearing: { drivingMin: 10, drivingMax: 30, drivenMin: 20, drivenMax: 50, drivingFixed: null, drivenFixed: null, reductionOnly: true, teethInventory: [] },
    module: { mode: 'fixed', fixed: 1, min: null, max: null, list: [] },
    manufacturing: { process: 'standard', minimumModule: null, minimumTeeth: null, minimumFaceWidth: null, printerDiameter: null, additiveDerating: 1 },
    materials: { input: 'C45', output: 'C45' },
    fatigue: { enabled: false, hoursPerDay: 8, daysPerYear: 250, years: 10, loadType: 'constant' },
    shaft: { supportDistanceMm: null, allowableShearMPa: 80 }
  };

  /** Dérating par défaut d'une pièce imprimée, appliqué dès qu'on choisit ce procédé. */
  var ADDITIVE_DERATING = 0.55;

  function clone(value) {
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }

  function TechnicalSettingsModel(seed) {
    Object.keys(DEFAULTS).forEach(function (group) { this[group] = clone(DEFAULTS[group]); }, this);
    // Paramètres propres à chaque famille : le registre en est la définition.
    this.typeParameters = defaultTypeParameters();
    if (seed) this.merge(seed);
  }

  function defaultTypeParameters() {
    var out = {};
    if (!Registry || !Registry.parameterDefinitions) return out;
    Object.keys(Registry.parameterDefinitions).forEach(function (typeId) {
      var values = {};
      var definitions = Registry.parameterDefinitions[typeId];
      Object.keys(definitions).forEach(function (key) { values[key] = definitions[key].default; });
      out[typeId] = values;
    });
    return out;
  }

  TechnicalSettingsModel.prototype.merge = function (seed) {
    Object.keys(DEFAULTS).forEach(function (group) {
      if (seed[group]) Object.assign(this[group], seed[group]);
    }, this);
    if (seed.typeParameters) {
      Object.keys(seed.typeParameters).forEach(function (typeId) {
        this.typeParameters[typeId] = Object.assign({}, this.typeParameters[typeId], seed.typeParameters[typeId]);
      }, this);
    }
    return this;
  };

  /**
   * Choisit une profondeur. Les nombres suivent, sauf s'ils ont été réglés à
   * la main : une valeur choisie explicitement ne doit pas être écrasée par un
   * bouton qui ne prétend qu'à un ordre de grandeur.
   */
  TechnicalSettingsModel.prototype.setDepth = function (id) {
    var preset = depth(id);
    if (!preset) return this;
    var current = depth(this.search.depth);
    var untouched = !current ||
      (this.search.maxSolutions === current.maxSolutions && this.search.maxIterations === current.maxIterations);
    this.search.depth = id;
    if (untouched) {
      this.search.maxSolutions = preset.maxSolutions;
      this.search.maxIterations = preset.maxIterations;
    }
    return this;
  };

  /** La profondeur nommée, ou null si les nombres n'en décrivent aucune. */
  TechnicalSettingsModel.prototype.depth = function () {
    for (var i = 0; i < DEPTHS.length; i++) {
      if (DEPTHS[i].maxSolutions === this.search.maxSolutions && DEPTHS[i].maxIterations === this.search.maxIterations) {
        return DEPTHS[i];
      }
    }
    return null;
  };

  TechnicalSettingsModel.prototype.set = function (group, key, value) {
    if (!this[group]) return this;
    this[group][key] = value;
    // Choisir l'impression 3D applique son abattement, tant que personne ne
    // l'a réglé à la main : sinon la tenue mécanique serait surévaluée.
    if (group === 'manufacturing' && key === 'process') {
      if (value === 'printing3d' && this.manufacturing.additiveDerating === DEFAULTS.manufacturing.additiveDerating) {
        this.manufacturing.additiveDerating = ADDITIVE_DERATING;
      } else if (value !== 'printing3d' && this.manufacturing.additiveDerating === ADDITIVE_DERATING) {
        this.manufacturing.additiveDerating = DEFAULTS.manufacturing.additiveDerating;
      }
    }
    return this;
  };

  TechnicalSettingsModel.prototype.setTypeParameter = function (typeId, key, value) {
    if (!this.typeParameters[typeId]) this.typeParameters[typeId] = {};
    this.typeParameters[typeId][key] = value;
    return this;
  };

  /** Ce groupe a-t-il été touché ? Sert à n'afficher que les décisions réelles. */
  TechnicalSettingsModel.prototype.isCustomised = function (group) {
    var reference = DEFAULTS[group];
    if (!reference) return false;
    return Object.keys(reference).some(function (key) {
      var value = this[group][key], base = reference[key];
      // Un inventaire est cloné à la construction : comparer les références
      // ferait déclarer « modifié » tout groupe qui en contient un.
      if (Array.isArray(base)) return (value || []).length !== base.length;
      return value !== base;
    }, this);
  };

  TechnicalSettingsModel.prototype.customisedGroups = function () {
    return Object.keys(DEFAULTS).filter(function (group) { return this.isCustomised(group); }, this);
  };

  /**
   * Traduit vers la forme plate attendue par LegacySearchAdapter. Le nommage
   * historique reste confiné ici, ce qui laisse le modèle lisible.
   */
  TechnicalSettingsModel.prototype.toAdapterSettings = function () {
    var belt = this.typeParameters.belt;
    if (belt && Registry && Registry.beltPitches) {
      belt.pitch = Registry.beltPitches[belt.profile] || 2;
      belt.beltType = 'timing';
    }
    // Le moteur lit le module dans les paramètres de chaque famille.
    var typeParameters = {};
    Object.keys(this.typeParameters).forEach(function (typeId) {
      typeParameters[typeId] = Object.assign({ module: this.module.fixed }, this.typeParameters[typeId]);
    }, this);

    return {
      dentMenanteMin: this.gearing.drivingMin, dentMenanteMax: this.gearing.drivingMax,
      dentMeneeMin: this.gearing.drivenMin, dentMeneeMax: this.gearing.drivenMax,
      dentMenanteFixe: this.gearing.drivingFixed, dentMeneeFixe: this.gearing.drivenFixed,
      reductionOnly: this.gearing.reductionOnly,
      teethInventory: (this.gearing.teethInventory || []).slice(),
      maxSolutions: this.search.maxSolutions, maxIterations: this.search.maxIterations,
      module: this.module.fixed, moduleMode: this.module.mode,
      moduleMin: this.module.min, moduleMax: this.module.max,
      moduleList: (this.module.list || []).slice(),
      inputMaterial: this.materials.input, outputMaterial: this.materials.output,
      additiveDerating: this.manufacturing.additiveDerating,
      manufacturing: {
        mode: this.manufacturing.process,
        minimumModule: this.manufacturing.minimumModule || undefined,
        minimumTeeth: this.manufacturing.minimumTeeth || undefined,
        minimumFaceWidth: this.manufacturing.minimumFaceWidth || undefined,
        printerDiameter: this.manufacturing.printerDiameter || undefined
      },
      fatigue: {
        enabled: this.fatigue.enabled, hoursPerDay: this.fatigue.hoursPerDay,
        daysPerYear: this.fatigue.daysPerYear, years: this.fatigue.years, loadType: this.fatigue.loadType
      },
      shaft: { supportDistanceMm: this.shaft.supportDistanceMm, allowableShearMPa: this.shaft.allowableShearMPa },
      typeParameters: typeParameters
    };
  };

  TechnicalSettingsModel.prototype.toJSON = function () {
    var out = { typeParameters: clone(this.typeParameters) };
    Object.keys(DEFAULTS).forEach(function (group) { out[group] = clone(this[group]); }, this);
    return out;
  };

  TechnicalSettingsModel.prototype.clone = function () { return new TechnicalSettingsModel(this.toJSON()); };

  /** Définitions de paramètres d'une famille, pour l'éditeur contextuel (§15). */
  TechnicalSettingsModel.definitionsFor = function (typeId) {
    if (!Registry || !Registry.parameterDefinitions) return null;
    return Registry.parameterDefinitions[typeId === 'planetary' ? 'planetary' : typeId] || null;
  };

  return { TechnicalSettingsModel: TechnicalSettingsModel, DEFAULTS: DEFAULTS,
    ADDITIVE_DERATING: ADDITIVE_DERATING, DEPTHS: DEPTHS, depth: depth };
});
