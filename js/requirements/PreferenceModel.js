// PreferenceModel.js - Ce qui filtre, et ce qui classe.
//
// Choix 4B : deux niveaux seulement, et la différence est opérationnelle, pas
// décorative.
//
//   CONTRAINTE  Ø ≤ 80 mm      → une solution à 82 mm est ÉCARTÉE
//   PRÉFÉRENCE  Ø ≈ 70 mm      → une solution à 82 mm est GARDÉE, mais moins bien classée
//
// Techniquement c'est la même `Quantity`, avec `soft` à vrai pour une
// préférence. L'utilisateur bascule de l'un à l'autre d'un clic sur la chip,
// sans ressaisir sa valeur.
//
// Choix 9B : au lieu de huit curseurs, une priorité principale et une
// secondaire. Les huit poids du moteur en sont dérivés — ils existent toujours,
// mais plus personne n'a à les régler à la main.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./Quantity.js') : root.GearQuantity);
  if (common) module.exports = api;
  else {
    root.GearPreferenceModel = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.PreferenceModel = api.PreferenceModel;
      root.GearApp.requirements.preferences = api;          // catalogue et axes
    }
  }
})(typeof self !== 'undefined' ? self : this, function (Quantity) {
  'use strict';

  // `metric` : comment lire la grandeur sur une solution calculée. `better`
  // indique le sens d'amélioration, ce dont le front de Pareto a besoin.
  var CRITERIA = [
    { key: 'maxDiameter', label: 'Diamètre hors-tout', unit: 'mm', category: 'dimensions', better: 'lower', defaultKind: 'max',
      metric: function (s) { return s.dimensions && s.dimensions.maxDiameter; } },
    { key: 'maxLength', label: 'Longueur', unit: 'mm', category: 'dimensions', better: 'lower', defaultKind: 'max',
      metric: function (s) { return s.dimensions && (s.dimensions.length != null ? s.dimensions.length : s.dimensions.x); } },
    { key: 'maxWidth', label: 'Largeur', unit: 'mm', category: 'dimensions', better: 'lower', defaultKind: 'max',
      metric: function (s) { return s.dimensions && s.dimensions.y; } },
    { key: 'efficiency', label: 'Rendement', unit: '%', category: 'performance', better: 'higher', defaultKind: 'min', scale: 100,
      metric: function (s) { return s.efficiency; } },
    { key: 'outputTorque', label: 'Couple de sortie', unit: 'N·m', category: 'performance', better: 'higher', defaultKind: 'min',
      metric: function (s) { return s.outputTorqueNm; } },
    { key: 'outputSpeed', label: 'Vitesse de sortie', unit: 'rpm', category: 'performance', better: null, defaultKind: 'range',
      metric: function (s) { return s.outputSpeedRpm; } },
    { key: 'ratioError', label: 'Écart de rapport', unit: '%', category: 'performance', better: 'lower', defaultKind: 'max',
      metric: function (s) { return s.errorPercent; } },
    { key: 'bendingSafety', label: 'Coefficient de flexion', unit: '', category: 'robustesse', better: 'higher', defaultKind: 'min',
      metric: function (s) { return safety(s, 'bending'); } },
    { key: 'contactSafety', label: 'Coefficient de pression', unit: '', category: 'robustesse', better: 'higher', defaultKind: 'min',
      metric: function (s) { return safety(s, 'contact'); } },
    { key: 'stages', label: 'Nombre d’étages', unit: '', category: 'architecture', better: 'lower', defaultKind: 'max',
      metric: function (s) { return (s.stages || []).length; } },
    { key: 'outputForce', label: 'Force de sortie', unit: 'N', category: 'performance', better: 'higher', defaultKind: 'min', linear: true,
      metric: function (s) { return s.outputForceN; } },
    // `linearSpeedMmMin` est le nom que porte la GÉOMÉTRIE d'un étage ; une
    // solution, elle, publie `outputLinearSpeedMmMin`. Le critère lisait le
    // premier sur la seconde et ne récoltait donc jamais qu'`undefined` : la
    // préférence de vitesse linéaire était sans effet, silencieusement.
    { key: 'linearSpeed', label: 'Vitesse linéaire', unit: 'mm/min', category: 'performance', better: null, defaultKind: 'range', linear: true,
      metric: function (s) { return s.outputLinearSpeedMmMin; } },
    { key: 'centerDistance', label: 'Entraxe', unit: 'mm', category: 'architecture', better: null, defaultKind: 'range',
      metric: function (s) { return s.dimensions && s.dimensions.maxCenterDistance; } },

    // §20 : des grandeurs que le moteur calcule déjà, mais que rien n'exposait.
    // `engineFiltered: false` signale celles que le compilateur ne sait pas
    // traduire — la session les applique alors elle-même, plutôt que de les
    // laisser silencieusement sans effet.
    { key: 'outputDirection', label: 'Sens de sortie', unit: '', category: 'architecture', better: null,
      defaultKind: 'exact', engineFiltered: false,
      metric: function (s) { return s.totalDirection; } },
    { key: 'powerLoss', label: 'Pertes (échauffement)', unit: 'W', category: 'performance', better: 'lower',
      defaultKind: 'max', engineFiltered: false,
      metric: function (s) { return s.lossPowerW; } },
    { key: 'pitchLineVelocity', label: 'Vitesse périphérique', unit: 'm/s', category: 'performance', better: 'lower',
      defaultKind: 'max', engineFiltered: false,
      metric: function (s) { return pitchLineVelocity(s); } }
  ];

  /**
   * Vitesse au primitif la plus élevée de la chaîne, en m/s : v = π·d·n / 60000.
   * C'est elle qui décide du régime de lubrification et pèse sur le bruit ;
   * elle se déduit exactement de la géométrie et du régime d'entrée.
   */
  function pitchLineVelocity(solution) {
    var speed = solution.inputSpeedRpm;
    if (typeof speed !== 'number' || !isFinite(speed)) return null;
    var best = null;
    (solution.mechanical || []).forEach(function (stage) {
      var diameter = stage.geometry && stage.geometry.pitchDiameterInput;
      if (typeof diameter === 'number' && isFinite(diameter)) {
        var value = Math.PI * diameter * Math.abs(speed) / 60000;
        if (best == null || value > best) best = value;
      }
      var ratio = Math.abs(stage.ratio) || 1;
      speed /= ratio;
    });
    return best;
  }

  // §9 : le catalogue ne doit pas être le même dans tous les cas. Une vis sans
  // fin appelle un rendement minimum ; une courroie appelle un entraxe. Proposer
  // les trente critères à chaque fois oblige l'utilisateur à savoir lesquels
  // comptent — c'est précisément ce qu'on lui épargne.
  var SUGGESTIONS = {
    planetary: ['maxDiameter', 'stages', 'efficiency', 'outputTorque'],
    worm:      ['efficiency', 'powerLoss', 'ratioError', 'outputTorque'],
    belt:      ['centerDistance', 'maxLength', 'pitchLineVelocity', 'maxDiameter'],
    chain:     ['centerDistance', 'maxLength', 'outputTorque', 'ratioError'],
    bevel:     ['centerDistance', 'maxDiameter', 'maxLength', 'ratioError'],
    rack:      ['outputForce', 'linearSpeed', 'maxDiameter', 'ratioError'],
    spur:      ['maxDiameter', 'maxLength', 'efficiency', 'stages'],
    helical:   ['maxDiameter', 'pitchLineVelocity', 'efficiency', 'bendingSafety'],
    internal:  ['maxDiameter', 'stages', 'efficiency', 'outputTorque']
  };

  /** Critères de repli quand aucune famille n'est encore décidée. */
  var GENERIC_SUGGESTIONS = ['maxDiameter', 'maxLength', 'efficiency', 'stages'];

  /**
   * Les quelques critères qui comptent ici et maintenant, sans jamais fermer
   * l'accès au catalogue complet.
   * @param {string[]} families familles réellement explorées
   * @param {boolean} linear problème linéaire
   * @param {object} [active] critères déjà posés, à ne pas reproposer
   */
  function suggest(families, linear, active) {
    var taken = active || {};
    var ordered = [];
    (families && families.length ? families : []).forEach(function (family) {
      (SUGGESTIONS[family] || []).forEach(function (key) {
        if (ordered.indexOf(key) === -1) ordered.push(key);
      });
    });
    GENERIC_SUGGESTIONS.forEach(function (key) { if (ordered.indexOf(key) === -1) ordered.push(key); });
    return ordered.filter(function (key) {
      if (taken[key]) return false;
      var meta = criterion(key);
      if (!meta) return false;
      return linear ? (meta.linear || !meta.rotaryOnly) : !meta.linear;
    }).slice(0, 5);
  }

  function safety(solution, kind) {
    var values = (solution.mechanical || []).map(function (entry) {
      return entry && entry[kind] && entry[kind].safetyFactor;
    }).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    return values.length ? Math.min.apply(Math, values) : null;
  }

  // Choix 9B. `weights` est la traduction vers les huit poids du moteur, qui
  // restent le mécanisme de score existant : on change l'interface, pas le calcul.
  var AXES = [
    { id: 'balanced', label: 'Équilibré', searchMode: 'global', help: 'Aucun critère ne domine : le meilleur compromis global.',
      weights: { ratio: 5, size: 5, efficiency: 5, stress: 5, stages: 5, noise: 4, manufacturing: 5, cost: 5 } },
    { id: 'compact', label: 'Compact', searchMode: 'compact', help: 'Le plus petit encombrement, quitte à ajouter un étage.',
      weights: { size: 10 } },
    { id: 'efficiency', label: 'Rendement', searchMode: 'efficiency', help: 'Le moins de pertes dans la chaîne.',
      weights: { efficiency: 10 } },
    { id: 'robust', label: 'Robuste', searchMode: 'robust', help: 'Les plus grandes marges de sécurité.',
      weights: { stress: 10 } },
    { id: 'simple', label: 'Simple', searchMode: 'minimumStages', help: 'Le moins de pièces et d’étages possible.',
      weights: { stages: 10 } },
    { id: 'precise', label: 'Précis', searchMode: 'precision', help: 'L’écart le plus faible au rapport demandé.',
      weights: { ratio: 10 } },
    { id: 'quiet', label: 'Silencieux', searchMode: 'global', help: 'Dentures et familles les moins bruyantes.',
      weights: { noise: 10 } },
    { id: 'manufacturable', label: 'Facile à fabriquer', searchMode: 'manufacturing', help: 'Modules courants, géométries simples.',
      weights: { manufacturing: 10 } },
    { id: 'cheap', label: 'Économique', searchMode: 'global', help: 'Le moins de matière et de pièces coûteuses.',
      weights: { cost: 10 } }
  ];

  var WEIGHT_KEYS = ['ratio', 'size', 'efficiency', 'stress', 'stages', 'noise', 'manufacturing', 'cost'];
  var BASE_WEIGHT = 3;          // socle commun : aucun critère n'est jamais ignoré
  var SECONDARY_SHARE = 0.5;    // la secondaire pèse la moitié de la principale

  function axis(id) {
    for (var i = 0; i < AXES.length; i++) if (AXES[i].id === id) return AXES[i];
    return null;
  }

  function criterion(key) {
    for (var i = 0; i < CRITERIA.length; i++) if (CRITERIA[i].key === key) return CRITERIA[i];
    return null;
  }

  function PreferenceModel(seed) {
    this.entries = {};            // key → Quantity (soft = préférence)
    this.primary = 'balanced';
    this.secondary = null;
    if (seed) this.merge(seed);
  }

  PreferenceModel.prototype.merge = function (seed) {
    var self = this;
    if (seed.entries) Object.keys(seed.entries).forEach(function (key) {
      var meta = criterion(key);
      if (meta) self.entries[key] = Quantity.from(seed.entries[key], meta.unit);
    });
    if (seed.primary && axis(seed.primary)) this.primary = seed.primary;
    if (seed.secondary !== undefined) this.secondary = axis(seed.secondary) ? seed.secondary : null;
    return this;
  };

  /** Pose une exigence. `soft` la rend préférence plutôt que contrainte. */
  PreferenceModel.prototype.require = function (key, quantity, soft) {
    var meta = criterion(key);
    if (!meta) return this;
    var value = Quantity.from(quantity, meta.unit);
    if (!value.isKnown()) { delete this.entries[key]; return this; }
    value.soft = !!soft;
    this.entries[key] = value;
    return this;
  };

  PreferenceModel.prototype.drop = function (key) { delete this.entries[key]; return this; };

  /** Bascule contrainte ↔ préférence sans perdre la valeur saisie. */
  PreferenceModel.prototype.toggleSoft = function (key) {
    var entry = this.entries[key];
    if (entry) entry.soft = !entry.soft;
    return this;
  };

  PreferenceModel.prototype.get = function (key) { return this.entries[key] || Quantity.unknown(); };

  PreferenceModel.prototype.list = function (soft) {
    return Object.keys(this.entries)
      .filter(function (key) { return soft === undefined || !!this.entries[key].soft === !!soft; }, this)
      .map(function (key) { return { key: key, meta: criterion(key), quantity: this.entries[key] }; }, this);
  };

  PreferenceModel.prototype.constraints = function () { return this.list(false); };
  PreferenceModel.prototype.preferences = function () { return this.list(true); };

  /** Contraintes que le compilateur ne sait pas traduire pour le moteur. */
  PreferenceModel.prototype.clientConstraints = function () {
    return this.constraints().filter(function (entry) { return entry.meta.engineFiltered === false; });
  };

  /**
   * Une solution passe-t-elle les contraintes DURES ? Les préférences n'ont
   * volontairement aucun effet ici : elles ne servent qu'au classement.
   */
  PreferenceModel.prototype.accepts = function (solution) {
    return this.violations(solution).length === 0;
  };

  PreferenceModel.prototype.violations = function (solution) {
    return this.constraints().reduce(function (list, entry) {
      var value = entry.meta.metric(solution);
      if (value == null) return list;                       // non évalué : on n'invente pas
      if (entry.meta.scale) value *= entry.meta.scale;
      if (!entry.quantity.satisfies(value)) {
        list.push({ key: entry.key, meta: entry.meta, quantity: entry.quantity, value: value, shortfall: entry.quantity.shortfall(value) });
      }
      return list;
    }, []);
  };

  /** Pénalité de classement issue des seules préférences, dans [0, 1]. */
  PreferenceModel.prototype.penalty = function (solution) {
    var soft = this.preferences();
    if (!soft.length) return 0;
    var total = soft.reduce(function (sum, entry) {
      var value = entry.meta.metric(solution);
      if (value == null) return sum;
      if (entry.meta.scale) value *= entry.meta.scale;
      return sum + Math.min(1, entry.quantity.penalty(value));
    }, 0);
    return total / soft.length;
  };

  /**
   * Les huit poids du moteur, dérivés des deux priorités. L'utilisateur ne les
   * voit plus ; ils restent exacts pour que le score existant garde son sens.
   */
  PreferenceModel.prototype.weights = function () {
    var weights = {};
    WEIGHT_KEYS.forEach(function (key) { weights[key] = BASE_WEIGHT; });
    var primary = axis(this.primary) || axis('balanced');
    var apply = function (source, share) {
      Object.keys(source.weights).forEach(function (key) {
        if (weights[key] === undefined) return;
        weights[key] = Math.max(weights[key], BASE_WEIGHT + (source.weights[key] - BASE_WEIGHT) * share);
      });
    };
    apply(primary, 1);
    var secondary = this.secondary && this.secondary !== this.primary ? axis(this.secondary) : null;
    if (secondary) apply(secondary, SECONDARY_SHARE);
    return weights;
  };

  PreferenceModel.prototype.searchMode = function () {
    return (axis(this.primary) || axis('balanced')).searchMode;
  };

  /** Axes que le classement doit vraiment considérer, priorité en tête. */
  PreferenceModel.prototype.activeAxes = function () {
    var list = [this.primary];
    if (this.secondary && this.secondary !== this.primary) list.push(this.secondary);
    return list.map(axis).filter(Boolean);
  };

  PreferenceModel.prototype.describe = function () {
    var primary = axis(this.primary), secondary = this.secondary ? axis(this.secondary) : null;
    if (!primary) return '';
    return secondary ? primary.label + ', puis ' + secondary.label.toLowerCase() : primary.label;
  };

  PreferenceModel.prototype.toJSON = function () {
    var entries = {};
    Object.keys(this.entries).forEach(function (key) { entries[key] = this.entries[key].toJSON(); }, this);
    return { entries: entries, primary: this.primary, secondary: this.secondary };
  };

  return {
    PreferenceModel: PreferenceModel, CRITERIA: CRITERIA, AXES: AXES, WEIGHT_KEYS: WEIGHT_KEYS,
    criterion: criterion, axis: axis, suggest: suggest, SUGGESTIONS: SUGGESTIONS,
    pitchLineVelocity: pitchLineVelocity
  };
});
