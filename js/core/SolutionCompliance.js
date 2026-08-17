// SolutionCompliance.js - Une seule réponse à « est-ce que ça tient ? ».
//
// Chaque écran répondait pour son compte. La carte affichait « ✓ Précision OK »
// et « ✓ Dimensions OK » en dur, sans avoir rien vérifié, puis « ✓ SF 0.82 » —
// une coche verte devant un facteur de sécurité insuffisant. Le viewer
// recalculait ses propres seuils. L'analyse montrait les codes internes. Quatre
// écrans, quatre verdicts possibles sur le même réducteur.
//
// Ce module ne calcule aucune mécanique : le moteur l'a déjà faite. Il traduit
// son résultat en états comparables, que tout le monde lit.
//
// Quatre états, et le quatrième est le plus important :
//   ok       — vérifié, conforme
//   warning  — vérifié, limite
//   danger   — vérifié, insuffisant
//   unknown  — PAS vérifié : pas de contrainte demandée, ou pas de couple
//              d'entrée. « Non vérifié » n'est pas « conforme ». C'est
//              précisément la confusion que les ✓ codés en dur entretenaient.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./Engineering.js') : root.GearEngineering);
  if (common) module.exports = api; else root.GearSolutionCompliance = api;
})(typeof self !== 'undefined' ? self : this, function (Engineering) {
  'use strict';

  var LIMITS = (Engineering && Engineering.LIMITS) || { bendingSafety: 1.3, contactSafety: 1.1 };

  var OK = 'ok', WARNING = 'warning', DANGER = 'danger', UNKNOWN = 'unknown';
  /** La marque dit l'état sans couleur : elle survit à l'impression et au SVG. */
  var MARKS = {};
  MARKS[OK] = '✓'; MARKS[WARNING] = '⚠'; MARKS[DANGER] = '✕'; MARKS[UNKNOWN] = '·';

  /**
   * Le catalogue des codes internes. Ils restent des identifiants dans le
   * code — comparables, testables, insensibles à la traduction — et ne
   * paraissent jamais tels quels à l'écran.
   */
  var CODES = {
    LOW_CONTACT_RATIO: { label: 'Rapport de conduite faible', level: WARNING },
    UNDERCUT: { label: 'Sous-coupe probable', level: WARNING },
    LOW_BENDING_SAFETY: { label: 'Sécurité en flexion insuffisante', level: DANGER },
    LOW_CONTACT_SAFETY: { label: 'Sécurité au contact insuffisante', level: DANGER },
    HIGH_AXIAL_LOAD: { label: 'Effort axial élevé', level: WARNING },
    THERMAL_RISK: { label: 'Échauffement probable', level: WARNING },
    LOW_EFFICIENCY: { label: 'Rendement global faible', level: WARNING },
    // Fabrication : règles du procédé.
    MODULE_TOO_SMALL: { label: 'Module sous la limite du procédé', level: WARNING },
    TOO_FEW_TEETH: { label: 'Dents sous la limite du procédé', level: WARNING },
    FACE_WIDTH_TOO_SMALL: { label: 'Largeur de denture insuffisante', level: WARNING },
    PRINTER_DIAMETER: { label: 'Ø supérieur au plateau d’impression', level: WARNING },
    // Modules écartés lors de la sélection automatique.
    BENDING_SAFETY_TOO_LOW: { label: 'sécurité en flexion insuffisante', level: DANGER },
    CONTACT_SAFETY_TOO_LOW: { label: 'sécurité au contact insuffisante', level: DANGER },
    UNSUPPORTED_BENDING_CHECK: { label: 'contrôle en flexion non supporté', level: UNKNOWN },
    UNSUPPORTED_CONTACT_CHECK: { label: 'contrôle au contact non supporté', level: UNKNOWN },
    RECOMMENDED_BACKLASH: { label: 'Jeu de denture recommandé', level: UNKNOWN }
  };

  /** Le libellé d'un code, ou le code lui-même s'il est inconnu — jamais rien. */
  function label(code) { return (CODES[code] && CODES[code].label) || String(code || ''); }
  function level(code) { return (CODES[code] && CODES[code].level) || WARNING; }

  function finite(value) { return Number.isFinite(value); }

  /** Le pire de deux états : un ensemble ne vaut pas mieux que son maillon faible. */
  var ORDER = {}; ORDER[UNKNOWN] = 0; ORDER[OK] = 1; ORDER[WARNING] = 2; ORDER[DANGER] = 3;
  function worst(a, b) { return ORDER[b] > ORDER[a] ? b : a; }

  /**
   * Un facteur de sécurité minimal sur les étages RÉELLEMENT évalués.
   * Un étage non évalué — faute de couple d'entrée — ne compte pas comme
   * conforme : il ne compte pas du tout, et si aucun ne l'est, l'état est
   * `unknown`.
   */
  function safety(solution, key, limit, name) {
    var stages = (solution && solution.mechanical) || [];
    var value = Infinity, evaluated = 0, unsupported = 0;
    stages.forEach(function (stage) {
      // Le statut est celui du CONTRÔLE, pas de l'étage : une vis sans fin
      // calcule ses efforts mais pas sa flexion. Confondre les deux revenait à
      // proposer de renseigner un couple déjà renseigné.
      if (stage && stage[key + 'Status'] === 'unsupported') { unsupported++; return; }
      var entry = stage && stage[key];
      if (!entry || !finite(entry.safetyFactor)) return;
      evaluated++;
      value = Math.min(value, entry.safetyFactor);
    });
    if (!evaluated) {
      return { state: UNKNOWN, value: null, limit: limit, label: name + ' non évalué',
        detail: unsupported ? 'Cette technologie ne fournit pas ce contrôle.'
          : 'Renseignez un couple d’entrée pour l’obtenir.' };
    }
    // Sous la limite c'est un refus, pas une réserve : la pièce casse ou pique.
    var state = value < limit ? DANGER : value < limit * 1.25 ? WARNING : OK;
    return { state: state, value: value, limit: limit,
      label: name + ' ' + value.toFixed(2),
      detail: 'Minimum requis ' + limit.toFixed(2) + ' sur ' + evaluated + ' étage' + (evaluated > 1 ? 's' : '') + ' évalué' + (evaluated > 1 ? 's' : '') + '.' };
  }

  /**
   * L'écart au rapport visé. Sans tolérance demandée, on donne le chiffre et
   * AUCUN verdict : conforme à quoi ? La tolérance appartient à l'utilisateur,
   * pas à ce module.
   */
  function ratio(solution, constraints) {
    var error = solution && solution.errorPercent;
    if (!finite(error)) return { state: UNKNOWN, value: null, label: 'Écart au rapport inconnu', detail: 'Aucun rapport visé.' };
    var tolerance = constraints && finite(constraints.tolerancePercent) ? constraints.tolerancePercent : null;
    var text = 'Écart ' + error.toFixed(2) + ' %';
    if (tolerance == null) {
      return { state: UNKNOWN, value: error, limit: null, label: text,
        detail: 'Aucune tolérance demandée : l’écart est donné, pas jugé.' };
    }
    return { state: error <= tolerance ? OK : error <= tolerance * 2 ? WARNING : DANGER,
      value: error, limit: tolerance, label: text,
      detail: 'Tolérance demandée ' + tolerance + ' %.' };
  }

  var SIZE_LABELS = { maxDiameter: 'Ø hors-tout', maxLength: 'longueur', maxWidth: 'largeur',
    maxCenterDistance: 'entraxe maximal', minCenterDistance: 'entraxe minimal' };

  /**
   * L'encombrement, jugé UNIQUEMENT contre les limites demandées. « Dimensions
   * OK » sans contrainte ne voulait rien dire : toute taille est acceptable
   * quand aucune n'est imposée.
   */
  function dimensions(solution, constraints) {
    var size = (solution && solution.dimensions) || {};
    var asked = ['maxDiameter', 'maxLength', 'maxWidth', 'maxCenterDistance', 'minCenterDistance']
      .filter(function (key) { return constraints && finite(constraints[key]); });
    var summary = finite(size.maxDiameter) && finite(size.length)
      ? 'Ø ' + size.maxDiameter.toFixed(0) + ' × ' + size.length.toFixed(0) + ' mm' : null;
    if (!asked.length) {
      return { state: UNKNOWN, label: summary ? 'Encombrement ' + summary : 'Encombrement inconnu',
        detail: 'Aucune limite d’encombrement demandée.' };
    }
    var check = Engineering && Engineering.validateDimensions
      ? Engineering.validateDimensions(size, constraints) : { valid: true, failures: [] };
    if (check.valid) {
      return { state: OK, label: 'Encombrement tenu', detail: (summary ? summary + ' — ' : '') +
        'dans les ' + asked.length + ' limite' + (asked.length > 1 ? 's' : '') + ' demandée' + (asked.length > 1 ? 's' : '') + '.' };
    }
    return { state: DANGER, label: 'Encombrement dépassé',
      detail: 'Hors limite : ' + check.failures.map(function (key) { return SIZE_LABELS[key] || key; }).join(', ') + '.' };
  }

  /** Les règles du procédé, telles que le module Fabrication les a jugées. */
  function fabrication(solution) {
    var manufacturing = solution && solution.manufacturing;
    if (!manufacturing) return { state: UNKNOWN, label: 'Fabrication non vérifiée', detail: 'Aucun procédé choisi.' };
    var mode = (manufacturing.rules && manufacturing.rules.mode) || 'standard';
    var failures = manufacturing.failures || [];
    if (!failures.length) return { state: OK, label: 'Fabrication ' + mode, detail: 'Règles du procédé respectées.' };
    return { state: worstOf(failures), label: 'Fabrication ' + mode,
      detail: failures.map(label).join(' · ') };
  }

  function worstOf(codes) {
    return (codes || []).reduce(function (state, code) { return worst(state, level(code)); }, OK);
  }

  /**
   * evaluate(solution, constraints) → l'état de chaque question, séparément.
   * `constraints` porte ce que l'utilisateur a DEMANDÉ (tolérance, encombrement)
   * — sans quoi la plupart des réponses restent `unknown`, ce qui est la vérité.
   */
  function evaluate(solution, constraints) {
    if (!solution) return null;
    return {
      ratio: ratio(solution, constraints),
      dimensions: dimensions(solution, constraints),
      bending: safety(solution, 'bending', LIMITS.bendingSafety, 'SF flexion'),
      contact: safety(solution, 'contact', LIMITS.contactSafety, 'SH contact'),
      fabrication: fabrication(solution)
    };
  }

  var ORDER_KEYS = ['ratio', 'dimensions', 'bending', 'contact', 'fabrication'];

  /**
   * badges(compliance) → de quoi peindre une ligne d'états, sans qu'aucun
   * écran n'ait à décider d'une marque ni d'une couleur.
   */
  function badges(compliance) {
    if (!compliance) return [];
    return ORDER_KEYS.map(function (key) {
      var entry = compliance[key];
      if (!entry) return null;
      return { key: key, state: entry.state, mark: MARKS[entry.state] || '',
        text: entry.label, title: entry.detail || '' };
    }).filter(Boolean);
  }

  /** L'état d'ensemble : le pire des états vérifiés. */
  function overall(compliance) {
    if (!compliance) return UNKNOWN;
    return ORDER_KEYS.reduce(function (state, key) {
      var entry = compliance[key];
      return entry ? worst(state, entry.state) : state;
    }, UNKNOWN);
  }

  /**
   * Les alertes d'un étage, telles que le MOTEUR les a émises. Le viewer ne
   * décide plus si une mécanique est dangereuse : il montre ce qui a été
   * déclaré, et une alerte de chaîne (rendement, thermique) ne se pose sur
   * aucun étage.
   */
  function stageWarnings(solution, index) {
    return ((solution && solution.warnings) || []).filter(function (entry) {
      var scope = entry && (finite(entry.stageIndex) ? entry.stageIndex
        : finite(entry.stage) ? entry.stage - 1 : null);
      return scope === index;
    });
  }

  return { evaluate: evaluate, badges: badges, overall: overall, stageWarnings: stageWarnings,
    label: label, level: level, worst: worst, codes: CODES, marks: MARKS, LIMITS: LIMITS,
    STATES: { ok: OK, warning: WARNING, danger: DANGER, unknown: UNKNOWN } };
});
