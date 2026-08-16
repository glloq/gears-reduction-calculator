// ExplorationPlanner.js - Chercher une performance, pas un rapport (P2).
//
// Le moteur sait répondre à « trouve-moi 12:1 ». Il ne sait pas répondre à
// « quel couple maximum tiens-je dans Ø 100 mm ? », et ce n'est pas un oubli :
// sans rapport cible, plus rien ne l'empêche d'analyser mécaniquement chaque
// chaîne rencontrée. Le filtre de rapport écarte aujourd'hui plus de 99 % des
// chaînes AVANT l'analyse ; le retirer ne rendrait pas la recherche plus large,
// il la rendrait irréalisable.
//
// D'où l'orchestrateur. Au lieu d'une recherche sans borne, N recherches
// bornées : l'espace de rapports est découpé en bandes espacées
// géométriquement, chacune interrogée comme une recherche ordinaire — rapide,
// éprouvée, inchangée — et leurs viviers sont réunis. Ce que l'utilisateur lit
// n'est plus « la solution à 12:1 » mais l'espace atteignable, classé par la
// performance qu'il a demandé de pousser.
//
// Le budget total ne change pas : la profondeur choisie est RÉPARTIE entre les
// bandes. « Approfondie » veut dire le même effort, réparti autrement, pas dix
// fois plus de calcul.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else {
    root.GearExplorationPlanner = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.ExplorationPlanner = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Largeur d'une bande, en facteur de rapport. Plus large, le filtre de
   * rapport cesse d'élaguer et chaque bande coûte trop cher ; plus étroite, il
   * faut trop de bandes pour couvrir l'espace.
   */
  var BAND_FACTOR = 1.6;

  /** Bornes de sécurité : au-delà, aucune bande n'a plus de sens physique. */
  var MIN_RATIO = 1;
  var MAX_RATIO = 2000;

  /** Nombre de bandes au-delà duquel on préfère élargir chaque bande. */
  var MAX_BANDS = 14;

  function finite(value) { return typeof value === 'number' && isFinite(value); }

  /**
   * Découpe [min, max] en bandes de rapport. La cible d'une bande est sa
   * moyenne ARITHMÉTIQUE et sa tolérance sa demi-largeur relative : c'est
   * exactement ce que le moteur applique, donc la bande couvre ses bornes sans
   * trou ni débordement.
   */
  function bands(min, max, options) {
    options = options || {};
    var lo = Math.max(MIN_RATIO, finite(min) ? min : MIN_RATIO);
    var hi = Math.min(MAX_RATIO, finite(max) ? max : MAX_RATIO);
    if (hi <= lo) return [band(lo, lo * 1.02)];

    var factor = options.factor || BAND_FACTOR;
    var count = Math.ceil(Math.log(hi / lo) / Math.log(factor));
    if (count > MAX_BANDS) { count = MAX_BANDS; factor = Math.pow(hi / lo, 1 / count); }
    if (count < 1) count = 1;

    var out = [], edge = lo;
    for (var i = 0; i < count; i++) {
      var next = i === count - 1 ? hi : edge * factor;
      out.push(band(edge, next));
      edge = next;
    }
    return out;
  }

  function band(lo, hi) {
    var target = (lo + hi) / 2;
    return { min: lo, max: hi, target: target, tolerancePercent: (hi - lo) / 2 / target * 100 };
  }

  /**
   * Ce qu'on cherche à pousser. Les mots vivent dans `SearchIntentModel`, les
   * nombres ici : une seule source pour chacun. Un score PLUS GRAND est
   * toujours meilleur, ce qui rend le classement final trivial et non ambigu.
   */
  var METRICS = {
    torque: function (s) { return finite(s.outputTorqueNm) ? s.outputTorqueNm : null; },
    ratio: function (s) { return finite(s.ratio) ? s.ratio : null; },
    efficiency: function (s) { return finite(s.efficiency) ? s.efficiency : null; },
    compact: function (s) {
      var d = s.dimensions || {};
      if (finite(d.x) && finite(d.y) && finite(d.z)) return -(d.x * d.y * Math.max(1, d.z));
      return finite(d.maxDiameter) ? -Math.pow(d.maxDiameter, 3) : null;
    },
    simple: function (s) { return (s.stages || []).length ? -s.stages.length : null; }
  };

  function metric(objective) { return METRICS[objective] || METRICS.torque; }

  /**
   * Les jeux de paramètres à exécuter, un par bande.
   * @param {object} params paramètres moteur de référence (déjà compilés)
   * @param {object} span   {min, max} rapports à balayer
   * @param {object} [options] `factor`, `clone`
   */
  function plan(params, span, options) {
    options = options || {};
    var copy = options.clone || shallowClone;
    var list = bands(span && span.min, span && span.max, options);
    // Le budget de la profondeur est RÉPARTI, pas multiplié : sinon choisir
    // « Exhaustive » demanderait dix fois le calcul annoncé.
    var iterations = Math.max(20000, Math.floor((params.maxIterations || 500000) / list.length));
    var solutions = Math.max(20, Math.ceil((params.maxSolutions || 100) / list.length) * 2);

    return list.map(function (entry) {
      var next = copy(params);
      next.rapportCible = entry.target;
      next.precision = entry.tolerancePercent;
      next.precisionToleree = entry.tolerancePercent;
      next.maxIterations = iterations;
      next.maxSolutions = solutions;
      // « Le moins d'étages » s'arrête à la première profondeur qui donne
      // quelque chose : pour explorer, c'est précisément ce qu'il ne faut pas.
      if (!next.searchMode || next.searchMode === 'minimumStages') next.searchMode = 'global';
      next.explorationBand = entry;
      return next;
    });
  }

  function shallowClone(params) {
    var out = Object.create(Object.getPrototypeOf(params) || Object.prototype);
    Object.keys(params).forEach(function (key) { out[key] = params[key]; });
    return out;
  }

  /** Signature d'une architecture : deux bandes voisines peuvent la retrouver. */
  function signature(solution) {
    return (solution.stages || []).map(function (stage) {
      var p = stage.parameters || {};
      return [stage.type, stage.input && stage.input.teeth, stage.output && stage.output.teeth,
        stage.sunTeeth, stage.ringTeeth, stage.wormStarts, stage.wheelTeeth, p.module].join(':');
    }).join('|');
  }

  /**
   * Réunit les viviers des bandes, écarte les doublons et classe par la
   * performance poursuivie. Une solution sans valeur mesurable pour cette
   * performance passe derrière : on ne la jette pas, on ne la classe pas.
   */
  function merge(pools, objective, limit) {
    var read = metric(objective), seen = {}, out = [];
    (pools || []).forEach(function (pool) {
      (pool || []).forEach(function (solution) {
        var key = signature(solution);
        if (seen[key]) return;
        seen[key] = true;
        // Aucune cible n'a été visée : l'écart de rapport n'a plus de référent.
        // Le laisser à la distance au centre de la bande ferait annoncer
        // « écart de 2,5 % » par rapport à un nombre que personne n'a demandé.
        solution.errorPercent = 0;
        out.push(solution);
      });
    });
    out.sort(function (a, b) {
      var va = read(a), vb = read(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va;
    });
    return limit ? out.slice(0, limit) : out;
  }

  return {
    plan: plan, bands: bands, merge: merge, metric: metric, signature: signature,
    METRICS: METRICS, BAND_FACTOR: BAND_FACTOR, MAX_BANDS: MAX_BANDS,
    MIN_RATIO: MIN_RATIO, MAX_RATIO: MAX_RATIO
  };
});
