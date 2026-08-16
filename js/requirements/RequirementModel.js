// RequirementModel.js - Le besoin, modélisé pour lui-même.
//
// Choix 2C : l'utilisateur ne choisit plus un « mode de solveur ». Il remplit
// une fiche entrée / sortie, aussi complète ou aussi lacunaire qu'il veut, et
// c'est le modèle qui en déduit le problème à résoudre :
//
//   RPM entrée + RPM sortie  → besoin mécanique
//   rapport seul             → recherche de rapport
//   course ou force          → rotation / translation
//   couple entrée + sortie   → rapport dérivé, à défaut de vitesses
//
// Le modèle porte AUSSI les faits d'architecture (angle des axes, réversibilité,
// sens de rotation) : ils ne contraignent pas une dimension, ils décident quelles
// familles de transmission ont un sens — c'est la matière du conseiller.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./Quantity.js') : root.GearQuantity);
  if (common) module.exports = api;
  else {
    root.GearRequirementModel = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.RequirementModel = api.RequirementModel;
      root.GearApp.requirements.requirement = api;          // description des champs
    }
  }
})(typeof self !== 'undefined' ? self : this, function (Quantity) {
  'use strict';

  /** Les grandeurs de la fiche, avec leur unité et le rôle qu'elles tiennent. */
  var FIELDS = [
    { path: 'input.speed', label: 'Vitesse d’entrée', unit: 'rpm', side: 'input', essential: true },
    { path: 'input.torque', label: 'Couple d’entrée', unit: 'N·m', side: 'input', essential: true },
    { path: 'output.speed', label: 'Vitesse de sortie', unit: 'rpm', side: 'output' },
    { path: 'output.torque', label: 'Couple de sortie', unit: 'N·m', side: 'output' },
    { path: 'output.force', label: 'Force de sortie', unit: 'N', side: 'output', linear: true },
    { path: 'output.travelPerRev', label: 'Course par tour', unit: 'mm', side: 'output', linear: true },
    { path: 'output.linearSpeed', label: 'Vitesse linéaire', unit: 'mm/min', side: 'output', linear: true },
    { path: 'ratio', label: 'Rapport de réduction', unit: ':1', side: 'ratio' }
  ];

  var ARCHITECTURE_DEFAULTS = {
    axisAngle: 0,            // 0 = axes parallèles, 90 = renvoi d'angle
    coaxial: 'any',          // any | required | avoid
    selfLocking: 'any',      // any | required (irréversible) | forbidden (réversible)
    direction: 'any',        // any | same | reverse
    maxStages: null
  };

  var FABRICATION_DEFAULTS = { process: 'standard' };

  function get(object, path) {
    var parts = path.split('.'), node = object;
    for (var i = 0; i < parts.length; i++) { if (node == null) return null; node = node[parts[i]]; }
    return node;
  }

  function set(object, path, value) {
    var parts = path.split('.'), node = object;
    for (var i = 0; i < parts.length - 1; i++) { if (!node[parts[i]]) node[parts[i]] = {}; node = node[parts[i]]; }
    node[parts[parts.length - 1]] = value;
  }

  function RequirementModel(seed) {
    this.input = {};
    this.output = {};
    this.ratio = Quantity.unknown(':1');
    FIELDS.forEach(function (field) { set(this, field.path, Quantity.unknown(field.unit)); }, this);
    this.architecture = Object.assign({}, ARCHITECTURE_DEFAULTS);
    this.fabrication = Object.assign({}, FABRICATION_DEFAULTS);
    if (seed) this.merge(seed);
  }

  RequirementModel.prototype.merge = function (seed) {
    var self = this;
    FIELDS.forEach(function (field) {
      var raw = get(seed, field.path);
      if (raw !== undefined && raw !== null) set(self, field.path, Quantity.from(raw, field.unit));
    });
    if (seed.architecture) Object.assign(this.architecture, seed.architecture);
    if (seed.fabrication) Object.assign(this.fabrication, seed.fabrication);
    return this;
  };

  RequirementModel.prototype.get = function (path) { return get(this, path) || Quantity.unknown(); };

  RequirementModel.prototype.set = function (path, quantity) {
    var field = RequirementModel.field(path);
    set(this, path, Quantity.from(quantity, field ? field.unit : ''));
    return this;
  };

  RequirementModel.prototype.clear = function (path) {
    var field = RequirementModel.field(path);
    set(this, path, Quantity.unknown(field ? field.unit : ''));
    return this;
  };

  RequirementModel.prototype.known = function () {
    return FIELDS.filter(function (field) { return this.get(field.path).isKnown(); }, this).map(function (f) { return f.path; });
  };

  // ===== Déduction du problème (2C) =====

  /**
   * Quel problème l'utilisateur pose-t-il réellement ? Il ne l'a jamais dit :
   * il a rempli des cases. `mode` reste le vocabulaire du moteur actuel, mais
   * il n'apparaît plus nulle part dans l'interface.
   */
  RequirementModel.prototype.inferProblem = function () {
    var out = this.output, input = this.input;
    if (out.travelPerRev.isKnown() || out.force.isKnown() || out.linearSpeed.isKnown()) {
      return { mode: 'rotationTranslation', reason: 'Une course ou une force de sortie décrit un mouvement linéaire.' };
    }
    if (out.speed.isKnown() && input.speed.isKnown()) {
      return { mode: 'need', reason: 'Vitesse d’entrée et vitesse de sortie déterminent le rapport à atteindre.' };
    }
    if (this.ratio.isKnown()) {
      return { mode: 'ratio', reason: 'Le rapport est donné directement.' };
    }
    if (out.torque.isKnown() && input.torque.isKnown()) {
      return { mode: 'ratio', reason: 'À défaut de vitesses, le rapport est estimé depuis les couples.', derivedFrom: 'torque' };
    }
    return { mode: null, reason: 'Il manque de quoi déterminer le rapport : une vitesse de sortie, un rapport ou une course.' };
  };

  /**
   * Le rapport demandé, sous forme de grandeur — donc avec son intention.
   * Une sortie « 20 → 40 rpm » à 1500 rpm d'entrée devient « 37,5 → 75:1 »,
   * ce qu'aucun champ « rapport cible » unique ne pouvait exprimer.
   */
  RequirementModel.prototype.ratioRequirement = function () {
    // L'ordre suit exactement `inferProblem` : une vitesse de sortie renseignée
    // décrit le besoin plus directement qu'un rapport laissé là. L'inverse
    // laisserait le mode et la valeur cherchée se contredire.
    var inputSpeed = this.input.speed.nominal();
    if (this.output.speed.isKnown() && inputSpeed) {
      return this.output.speed.mapLinear(inputSpeed, true, ':1');
    }
    if (this.ratio.isKnown()) return this.ratio;
    var inputTorque = this.input.torque.nominal();
    if (this.output.torque.isKnown() && inputTorque) {
      // Rapport idéal : le rendement réel le fera manquer, c'est pourquoi le
      // couple de sortie est AUSSI compilé en contrainte dure. Le moteur, lui,
      // calcule le couple réel et écarte les solutions qui ne tiennent pas.
      return this.output.torque.mapLinear(1 / inputTorque, false, ':1');
    }
    return Quantity.unknown(':1');
  };

  /** Course par tour, dérivée de la vitesse linéaire quand elle seule est donnée. */
  RequirementModel.prototype.travelRequirement = function () {
    if (this.output.travelPerRev.isKnown()) return this.output.travelPerRev;
    var outputSpeed = this.output.speed.nominal();
    if (this.output.linearSpeed.isKnown() && outputSpeed) {
      return this.output.linearSpeed.mapLinear(1 / outputSpeed, false, 'mm');
    }
    return Quantity.unknown('mm');
  };

  /** Réduction ou multiplication ? Utile au conseiller comme au diagnostic. */
  RequirementModel.prototype.isReduction = function () {
    var ratio = this.ratioRequirement();
    if (!ratio.isKnown()) return null;
    var nominal = ratio.nominal();
    return nominal == null ? null : nominal >= 1;
  };

  // ===== Diagnostic vivant, sans lancer le solveur (10C) =====

  RequirementModel.prototype.diagnose = function () {
    var notes = [], problem = this.inferProblem(), ratio = this.ratioRequirement();

    if (!problem.mode) {
      notes.push({ level: 'error', code: 'no-problem', text: problem.reason });
    } else {
      notes.push({ level: 'ok', code: 'problem', text: problem.reason });
    }

    if (!this.input.speed.isKnown()) {
      notes.push({ level: 'warn', code: 'no-input-speed', text: 'Sans vitesse d’entrée, les vitesses de sortie affichées seront approximatives.' });
    }
    if (!this.input.torque.isKnown()) {
      notes.push({ level: 'warn', code: 'no-input-torque', text: 'Sans couple d’entrée, la tenue mécanique ne peut pas être vérifiée.' });
    }

    if (ratio.isKnown()) {
      var nominal = ratio.nominal(), bounds = ratio.bounds();
      if (nominal != null && nominal > 0 && nominal < 1) {
        notes.push({ level: 'warn', code: 'multiplier', text: 'Le rapport demandé est un multiplicateur : la sortie tournera plus vite que l’entrée.' });
      }
      if (nominal != null && nominal > 200) {
        notes.push({ level: 'warn', code: 'very-high-ratio', text: 'Rapport très élevé : il demandera plusieurs étages, ou une vis sans fin.' });
      }
      // Seule une INTENTION de plage peut être trop étroite. Un rapport donné
      // comme exact n'est pas un intervalle resserré, c'est une valeur.
      if (ratio.kind === 'range' && bounds.min != null && bounds.max != null && bounds.min > 0) {
        var span = (bounds.max - bounds.min) / bounds.min;
        if (span < 0.005) notes.push({ level: 'warn', code: 'tight-ratio', text: 'La plage de rapport est très étroite : peu de combinaisons de dentures tomberont dedans.' });
      }
    }

    if (this.architecture.axisAngle === 90 && this.architecture.coaxial === 'required') {
      notes.push({ level: 'error', code: 'axis-conflict', text: 'Un renvoi d’angle et une sortie coaxiale s’excluent.' });
    }
    if (this.architecture.selfLocking === 'required' && this.architecture.direction === 'any' && this.fabrication.process === 'printing3d') {
      notes.push({ level: 'warn', code: 'printed-worm', text: 'L’irréversibilité passe par une vis sans fin, difficile à imprimer avec un bon rendement.' });
    }
    return notes;
  };

  RequirementModel.prototype.isComplete = function () {
    return this.diagnose().every(function (note) { return note.level !== 'error'; }) && !!this.inferProblem().mode;
  };

  RequirementModel.prototype.toJSON = function () {
    var out = { architecture: Object.assign({}, this.architecture), fabrication: Object.assign({}, this.fabrication) };
    FIELDS.forEach(function (field) {
      var quantity = this.get(field.path);
      if (quantity.isKnown()) set(out, field.path, quantity.toJSON());
    }, this);
    return out;
  };

  RequirementModel.field = function (path) {
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].path === path) return FIELDS[i];
    return null;
  };

  return { RequirementModel: RequirementModel, FIELDS: FIELDS, ARCHITECTURE_DEFAULTS: ARCHITECTURE_DEFAULTS };
});
