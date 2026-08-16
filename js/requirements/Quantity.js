// Quantity.js - Une grandeur du cahier des charges, avec son INTENTION.
//
// L'ancien formulaire ne savait dire qu'une chose : « rpm_sortie_cible = 100 ».
// Or « 100 » ne veut pas dire la même chose selon l'utilisateur :
//
//   = 100      exactement 100, sans discussion
//   ≈ 100      autour de 100, une tolérance est acceptable
//   ≥ 100      au moins 100
//   ≤ 100      au plus 100
//   80 → 120   n'importe où dans cette plage
//   ?          non renseigné, au solveur de choisir
//
// Toute la suite (compilation vers le moteur, conseiller de technologies,
// diagnostic de relaxation) s'appuie sur cette distinction : sans elle il est
// impossible de dire « votre plage est trop étroite » ou « 84 mm au lieu de 80
// débloquerait 23 solutions ».
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else {
    root.GearQuantity = api;
    if (root.GearApp) { root.GearApp.requirements = root.GearApp.requirements || {}; root.GearApp.requirements.Quantity = api; }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KINDS = ['unknown', 'exact', 'target', 'min', 'max', 'range'];

  /** Tolérance par défaut d'une valeur « ≈ », en pourcentage. */
  var DEFAULT_TOLERANCE_PERCENT = 5;

  function finite(value) { return typeof value === 'number' && isFinite(value); }

  function Quantity(kind, spec) {
    spec = spec || {};
    this.kind = KINDS.indexOf(kind) === -1 ? 'unknown' : kind;
    this.value = finite(spec.value) ? spec.value : null;
    this.min = finite(spec.min) ? spec.min : null;
    this.max = finite(spec.max) ? spec.max : null;
    this.tolerancePercent = finite(spec.tolerancePercent) ? spec.tolerancePercent : null;
    this.unit = spec.unit || '';
    // `soft` marque une PRÉFÉRENCE : la grandeur ne filtre pas, elle classe.
    // C'est le choix 4B — deux niveaux seulement, contrainte ou préférence.
    this.soft = !!spec.soft;
    if (this.kind === 'target' && this.tolerancePercent == null) this.tolerancePercent = DEFAULT_TOLERANCE_PERCENT;
    if (this.kind === 'range' && this.min != null && this.max != null && this.min > this.max) {
      var swap = this.min; this.min = this.max; this.max = swap;
    }
  }

  Quantity.prototype.isKnown = function () { return this.kind !== 'unknown'; };
  Quantity.prototype.isHard = function () { return this.isKnown() && !this.soft; };

  /**
   * Bornes effectives, nulles quand la grandeur ne borne pas de ce côté.
   * `target` se traduit en plage : c'est ce qui permet au moteur, qui ne connaît
   * que des bornes, de recevoir une intention « ≈ ».
   */
  Quantity.prototype.bounds = function () {
    switch (this.kind) {
      case 'exact': return { min: this.value, max: this.value };
      case 'target': {
        var margin = Math.abs(this.value) * (this.tolerancePercent / 100);
        return { min: this.value - margin, max: this.value + margin };
      }
      case 'min': return { min: this.value, max: null };
      case 'max': return { min: null, max: this.value };
      case 'range': return { min: this.min, max: this.max };
      default: return { min: null, max: null };
    }
  };

  /**
   * Valeur représentative, utilisée pour dériver une autre grandeur (un rapport
   * depuis une vitesse par exemple). Le milieu d'une plage, pas une de ses
   * bornes : viser une borne revient à n'accepter qu'une moitié de la plage.
   */
  Quantity.prototype.nominal = function () {
    var b = this.bounds();
    if (this.kind === 'exact' || this.kind === 'target' || this.kind === 'min' || this.kind === 'max') return this.value;
    if (b.min != null && b.max != null) return (b.min + b.max) / 2;
    return b.min != null ? b.min : b.max;
  };

  /** Une grandeur non renseignée n'exclut rien. */
  Quantity.prototype.satisfies = function (value) {
    if (!this.isKnown() || !finite(value)) return true;
    var b = this.bounds(), epsilon = 1e-9;
    if (b.min != null && value < b.min - epsilon) return false;
    if (b.max != null && value > b.max + epsilon) return false;
    return true;
  };

  /**
   * De combien la valeur rate la grandeur, dans son unité — 0 si elle passe.
   * C'est la mesure sur laquelle repose la relaxation chiffrée : « la meilleure
   * solution fait 83,6 mm » n'est rien d'autre que ce dépassement rapporté à
   * la borne.
   */
  Quantity.prototype.shortfall = function (value) {
    if (!this.isKnown() || !finite(value)) return 0;
    var b = this.bounds();
    if (b.min != null && value < b.min) return b.min - value;
    if (b.max != null && value > b.max) return value - b.max;
    return 0;
  };

  /**
   * Distance normalisée à la grandeur, utilisable pour CLASSER (préférences).
   * 0 = parfaitement satisfait, 1 = raté de 100 % de la borne.
   */
  Quantity.prototype.penalty = function (value) {
    var miss = this.shortfall(value);
    if (!miss) return 0;
    var b = this.bounds(), reference = Math.abs(b.max != null ? b.max : b.min) || 1;
    return miss / reference;
  };

  /** Applique une nouvelle borne du côté qui bloquait — utilisé par la relaxation. */
  Quantity.prototype.relaxedTo = function (value) {
    var spec = { value: this.value, min: this.min, max: this.max, tolerancePercent: this.tolerancePercent, unit: this.unit, soft: this.soft };
    switch (this.kind) {
      case 'max': spec.value = value; return new Quantity('max', spec);
      case 'min': spec.value = value; return new Quantity('min', spec);
      case 'range':
        if (value > this.max) spec.max = value; else spec.min = value;
        return new Quantity('range', spec);
      case 'exact':
      case 'target': {
        // Une valeur exacte qui doit céder devient une plage : c'est le seul
        // assouplissement qui garde l'intention d'origine visible.
        var lo = Math.min(this.value, value), hi = Math.max(this.value, value);
        return new Quantity('range', { min: lo, max: hi, unit: this.unit, soft: this.soft });
      }
      default: return this;
    }
  };

  var SYMBOLS = { exact: '=', target: '≈', min: '≥', max: '≤' };

  Quantity.prototype.describe = function (format) {
    var show = format || function (v) { return String(Math.round(v * 100) / 100); };
    if (!this.isKnown()) return '?';
    var unit = this.unit ? ' ' + this.unit : '';
    if (this.kind === 'range') return show(this.min) + ' → ' + show(this.max) + unit;
    return SYMBOLS[this.kind] + ' ' + show(this.value) + unit;
  };

  // ===== Constructeurs =====

  Quantity.unknown = function (unit) { return new Quantity('unknown', { unit: unit }); };
  Quantity.exact = function (value, unit) { return new Quantity('exact', { value: value, unit: unit }); };
  Quantity.target = function (value, tolerancePercent, unit) { return new Quantity('target', { value: value, tolerancePercent: tolerancePercent, unit: unit }); };
  Quantity.atLeast = function (value, unit) { return new Quantity('min', { value: value, unit: unit }); };
  Quantity.atMost = function (value, unit) { return new Quantity('max', { value: value, unit: unit }); };
  Quantity.between = function (min, max, unit) { return new Quantity('range', { min: min, max: max, unit: unit }); };

  /** Recompose une grandeur depuis sa forme sérialisée (URL, preset, stockage). */
  Quantity.from = function (raw, unit) {
    if (raw instanceof Quantity) return raw;
    if (raw == null || raw === '') return Quantity.unknown(unit);
    if (typeof raw === 'number') return Quantity.exact(raw, unit);
    if (typeof raw === 'string') return Quantity.parse(raw, unit);
    var spec = { value: raw.value, min: raw.min, max: raw.max, tolerancePercent: raw.tolerancePercent, unit: raw.unit || unit, soft: raw.soft };
    return new Quantity(raw.kind, spec);
  };

  /**
   * Lecture d'une saisie libre. L'utilisateur tape « 20-40 », « >=80 », « ~100 »
   * ou simplement « 100 » ; il n'a pas à ouvrir un sélecteur pour ça.
   */
  Quantity.parse = function (text, unit) {
    var raw = String(text == null ? '' : text).trim().replace(',', '.');
    if (!raw || raw === '?') return Quantity.unknown(unit);
    var range = raw.match(/^(-?[\d.]+)\s*(?:->|→|\.\.|–|—|-|à|to)\s*(-?[\d.]+)$/i);
    if (range) return Quantity.between(parseFloat(range[1]), parseFloat(range[2]), unit);
    var prefixed = raw.match(/^(>=|≥|>|<=|≤|<|~|≈|=)\s*(-?[\d.]+)\s*(?:±\s*([\d.]+)\s*%)?$/);
    if (prefixed) {
      var value = parseFloat(prefixed[2]);
      switch (prefixed[1]) {
        case '>=': case '≥': case '>': return Quantity.atLeast(value, unit);
        case '<=': case '≤': case '<': return Quantity.atMost(value, unit);
        case '~': case '≈': return Quantity.target(value, prefixed[3] ? parseFloat(prefixed[3]) : null, unit);
        default: return Quantity.exact(value, unit);
      }
    }
    var plain = parseFloat(raw);
    return isFinite(plain) ? Quantity.exact(plain, unit) : Quantity.unknown(unit);
  };

  Quantity.prototype.toJSON = function () {
    if (!this.isKnown()) return null;
    var out = { kind: this.kind };
    if (this.value != null) out.value = this.value;
    if (this.min != null) out.min = this.min;
    if (this.max != null) out.max = this.max;
    if (this.kind === 'target' && this.tolerancePercent != null) out.tolerancePercent = this.tolerancePercent;
    if (this.soft) out.soft = true;
    return out;
  };

  /**
   * Propage une grandeur à travers un rapport monotone : `y = factor / x` quand
   * `invert`, `y = factor * x` sinon. Une plage de vitesse de sortie devient
   * ainsi une plage de rapports, ce qu'aucun champ unique ne savait exprimer.
   */
  Quantity.prototype.mapLinear = function (factor, invert, unit) {
    if (!this.isKnown() || !finite(factor) || factor === 0) return Quantity.unknown(unit);
    var b = this.bounds();
    var apply = function (v) { return v == null || v === 0 ? null : (invert ? factor / v : factor * v); };
    var lo = apply(b.min), hi = apply(b.max);
    if (invert) { var swap = lo; lo = hi; hi = swap; }   // l'inversion retourne l'ordre
    if (lo != null && hi != null) {
      if (Math.abs(hi - lo) < 1e-9) return Quantity.exact(lo, unit);
      return Quantity.between(lo, hi, unit);
    }
    if (lo != null) return Quantity.atLeast(lo, unit);
    if (hi != null) return Quantity.atMost(hi, unit);
    return Quantity.unknown(unit);
  };

  Quantity.KINDS = KINDS;
  Quantity.DEFAULT_TOLERANCE_PERCENT = DEFAULT_TOLERANCE_PERCENT;
  return Quantity;
});
