// DecisionAssessment.js - UNE SEULE VÉRITÉ DÉCISIONNELLE.
//
// Le verdict était réparti. Le moteur produisait un indice technique, le front
// de Pareto élisait une recommandée, la conformité jugeait les contrôles, les
// préférences comptaient leurs violations, la carte fabriquait ses deltas, la
// bande d'identité refaisait son badge, le tableau comptait ses avertissements.
// Sept endroits, sept occasions de ne pas dire la même chose du même réducteur.
//
// Cette couche répond une fois, pour tout le monde :
//
//   Workbench · ResultsTable · ComparePanel · SolutionHeader · Charts · Exports
//
// ne calculent plus aucun verdict. Ils REPRÉSENTENT celui-ci.
//
// Ce qu'elle assemble, et ce qu'elle n'invente pas :
//   — `engineering`  l'indice absolu, tel que le moteur l'a calculé
//   — `decision`     rang, score, front, recommandation — SolutionEvaluator
//   — `compliance`   les contrôles vérifiés — SolutionCompliance
//   — `violations`   ce que le cahier des charges demandait — PreferenceModel
//   — `uncertainty`  ce qui n'a PAS été vérifié, nommé plutôt que tu
//   — `strengths` / `compromises`  ce qu'on gagne et ce qu'on perd face à la
//                  référence : une aide au choix doit répondre aux deux
//   — `contributions` d'où vient l'indice, critère par critère, avec sa source
//   — `context`      les hypothèses de calcul, pour ne pas comparer l'incomparable
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(
    common ? require('./SolutionEvaluator.js') : root.GearSolutionEvaluator,
    common ? require('../core/SolutionCompliance.js') : root.GearSolutionCompliance,
    common ? require('./TransmissionAdvisor.js') : root.GearTransmissionAdvisor);
  if (common) module.exports = api;
  else {
    root.GearDecisionAssessment = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.DecisionAssessment = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function (Evaluator, Compliance, Advisor) {
  'use strict';

  function finite(value) { return typeof value === 'number' && isFinite(value); }
  function round(value, digits) {
    var factor = Math.pow(10, digits == null ? 2 : digits);
    return Math.round(value * factor) / factor;
  }

  // ===== L'INDICE, DÉCOMPOSÉ =====

  /**
   * Le mode expert affichait `JSON.stringify(solution.score)`. Le moteur fournit
   * pourtant tout ce qu'il faut pour l'expliquer : la pénalité de chaque
   * critère, son poids, sa source et sa confiance. On rend donc la
   * CONTRIBUTION de chacun — pénalité × poids / somme des poids — dont la somme
   * est exactement l'indice affiché. Un utilisateur peut alors voir pourquoi
   * deux solutions sont classées différemment, au lieu de le deviner.
   */
  var METRIC_LABELS = {
    ratio: 'Précision', size: 'Encombrement', efficiency: 'Rendement',
    stress: 'Risque mécanique', stages: 'Étages', noise: 'Bruit',
    manufacturing: 'Fabrication', cost: 'Coût'
  };

  function contributions(solution) {
    var score = solution && solution.score;
    var metrics = score && score.metrics;
    if (!metrics) return [];
    var weights = score.weights || {};
    var total = 0;
    Object.keys(metrics).forEach(function (key) { total += finite(weights[key]) ? weights[key] : 1; });
    if (!total) total = Object.keys(metrics).length || 1;
    return Object.keys(metrics).map(function (key) {
      var entry = metrics[key];
      var penalty = entry && typeof entry === 'object' ? entry.value : entry;
      var weight = finite(weights[key]) ? weights[key] : 1;
      return {
        key: key, label: METRIC_LABELS[key] || key,
        penalty: finite(penalty) ? penalty : null,
        weight: weight,
        contribution: finite(penalty) ? penalty * weight / total : null,
        source: (entry && entry.source) || 'calculation',
        confidence: (entry && entry.confidence) || 'high'
      };
    }).sort(function (a, b) { return (b.contribution || 0) - (a.contribution || 0); });
  }

  /** Le critère qui pèse le plus dans l'indice — la réponse à « pourquoi si bas ? ». */
  function dominantFactor(list) {
    var best = null;
    (list || []).forEach(function (entry) {
      if (!finite(entry.contribution)) return;
      if (!best || entry.contribution > best.contribution) best = entry;
    });
    return best;
  }

  // ===== CE QUI N'A PAS ÉTÉ VÉRIFIÉ =====

  /**
   * Une grandeur inconnue était normalisée à 0,5 dans le front : ni avantage ni
   * pénalité. C'est commode et transitif, mais invisible — une courroie sans
   * contrôle de flexion s'y comportait comme une transmission de robustesse
   * moyenne. Ce qui manque est donc nommé, et remonte jusqu'à la carte.
   */
  var UNCERTAINTY = { none: 0, low: 1, medium: 2, high: 3 };

  function uncertainty(compliance, robustness) {
    var missing = [];
    if (compliance) {
      Object.keys(compliance).forEach(function (key) {
        var entry = compliance[key];
        if (entry && entry.state === 'unknown') missing.push(entry.label || key);
      });
    }
    var mechanical = (robustness && robustness.unknown) || [];
    var level = 'none';
    // Un contrôle MÉCANIQUE manquant ne pèse pas comme une tolérance non
    // demandée : le premier laisse ignorer si la pièce casse.
    if (mechanical.length) level = mechanical.length > 1 ? 'high' : 'medium';
    else if (missing.length) level = 'low';
    return { level: level, rank: UNCERTAINTY[level], checks: missing, mechanical: mechanical };
  }

  // ===== CE QU'ON GAGNE, CE QU'ON PERD =====

  /**
   * §9. La carte disait « Plus compacte. » et s'arrêtait là. Une aide au choix
   * doit répondre à deux questions, pas une : pourquoi la prendre, ET qu'est-ce
   * qu'on perd en la prenant. Les deux se lisent sur les mêmes grandeurs, face
   * à la solution de référence ; seul le SIGNE les sépare.
   */
  var TRADE_METRICS = [
    { key: 'efficiency', label: 'rendement', better: 'higher', digits: 1, unit: ' pt',
      read: function (s) { return finite(s.efficiency) ? s.efficiency * 100 : null; } },
    { key: 'diameter', label: 'Ø', better: 'lower', digits: 0, unit: ' mm',
      read: function (s) { return s.dimensions && s.dimensions.maxDiameter; } },
    { key: 'length', label: 'longueur', better: 'lower', digits: 0, unit: ' mm',
      read: function (s) { return s.dimensions && s.dimensions.length; } },
    { key: 'stages', label: 'étage', better: 'lower', digits: 0, unit: '',
      read: function (s) { return (s.stages || []).length; } },
    { key: 'error', label: 'écart', better: 'lower', digits: 2, unit: ' %',
      read: function (s) { return s.errorPercent; } },
    { key: 'torque', label: 'couple', better: 'higher', digits: 1, unit: ' N·m',
      read: function (s) { return s.outputTorqueNm; } },
    { key: 'force', label: 'force', better: 'higher', digits: 0, unit: ' N',
      read: function (s) { return s.outputForceN; } },
    { key: 'robustness', label: 'marge mécanique', better: 'higher', digits: 2, unit: '×',
      read: function (s) { return Evaluator.robustness(s).margin; } }
  ];

  /** Un écart n'est montré que s'il se voit : 0,2 mm sur 90 mm n'aide personne. */
  var MEANINGFUL = 0.03;

  function trades(solution, reference) {
    var gains = [], losses = [];
    if (!reference || solution === reference) return { strengths: gains, compromises: losses };
    TRADE_METRICS.forEach(function (metric) {
      var mine = metric.read(solution), theirs = metric.read(reference);
      if (!finite(mine) || !finite(theirs)) return;
      var gap = mine - theirs;
      if (!gap) return;
      var scale = Math.max(Math.abs(theirs), Math.abs(mine), 1e-9);
      if (Math.abs(gap) / scale < MEANINGFUL) return;
      var better = metric.better === 'higher' ? gap > 0 : gap < 0;
      var text = (gap > 0 ? '+' : '−') + round(Math.abs(gap), metric.digits).toFixed(metric.digits) +
        metric.unit + (metric.unit === '' ? ' ' + metric.label + (Math.abs(gap) > 1 ? 's' : '') : ' de ' + metric.label);
      var item = { key: metric.key, label: metric.label, delta: round(gap, metric.digits), text: text };
      (better ? gains : losses).push(item);
    });
    // Le plus parlant d'abord : un écart de rendement de 4 points passe avant
    // un millimètre de diamètre.
    var byWeight = function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); };
    return { strengths: gains.sort(byWeight), compromises: losses.sort(byWeight) };
  }

  // ===== LES HYPOTHÈSES DE CALCUL =====

  /**
   * §19. Les épingles survivent aux recherches — c'est utile, et c'est un
   * piège : deux solutions peuvent avoir été calculées sous un couple, un
   * régime, un matériau ou un procédé différents. Comparer leurs SF ou leurs
   * pertes revient alors à comparer deux mesures prises avec deux étalons.
   * L'empreinte permet de le DIRE au lieu de le laisser passer.
   */
  function fingerprint(solution) {
    if (!solution) return '';
    var materials = solution.materials || {};
    var manufacturing = (solution.manufacturing && solution.manufacturing.rules &&
      solution.manufacturing.rules.mode) || '?';
    return [
      finite(solution.inputSpeedRpm) ? Math.round(solution.inputSpeedRpm) : '?',
      finite(solution.inputTorqueNm) ? round(solution.inputTorqueNm, 3) : '?',
      materials.input || '?', materials.output || '?',
      finite(materials.additiveDerating) ? round(materials.additiveDerating, 3) : '?',
      manufacturing
    ].join('|');
  }

  /** Ce que l'empreinte cache, en français, quand deux d'entre elles diffèrent. */
  var CONTEXT_LABELS = ['régime d’entrée', 'couple d’entrée', 'matériau menant',
    'matériau mené', 'déclassement', 'procédé'];

  function contextDifferences(a, b) {
    var left = String(a || '').split('|'), right = String(b || '').split('|');
    var out = [];
    CONTEXT_LABELS.forEach(function (label, index) {
      if (left[index] !== right[index]) out.push(label);
    });
    return out;
  }

  // ===== LES ALERTES, PAR GRAVITÉ =====

  /**
   * §13/§20. « Warnings = 3 » ne dit pas si l'une d'elles est un refus. Un
   * danger prime sur n'importe quel nombre de réserves, et les alertes se
   * lisent dans cet ordre — sinon la coupe à trois en cache la plus grave.
   */
  var SEVERITY = { danger: 0, warning: 1, unknown: 2 };

  function alerts(solution) {
    var list = ((solution && solution.warnings) || []).map(function (entry) {
      var code = entry && entry.code;
      var level = entry && entry.level ? entry.level : Compliance.level(code);
      return {
        code: code, level: level, mark: Compliance.marks[level] || '',
        label: (entry && entry.message) || Compliance.label(code),
        advice: (entry && entry.action) || '',
        stageIndex: finite(entry && entry.stageIndex) ? entry.stageIndex : null
      };
    });
    // `SEVERITY.danger` vaut ZÉRO : un `|| 9` de repli le renvoyait en dernier,
    // c'est-à-dire exactement là où il ne doit jamais être.
    function rank(level) { return SEVERITY[level] == null ? 9 : SEVERITY[level]; }
    list.sort(function (a, b) { return rank(a.level) - rank(b.level); });
    var counts = { danger: 0, warning: 0, unknown: 0 };
    list.forEach(function (entry) { if (counts[entry.level] != null) counts[entry.level]++; });
    return { list: list, counts: counts,
      // Une clé de tri qui range d'abord par gravité, puis par nombre.
      severity: counts.danger * 1e6 + counts.warning * 1e3 + counts.unknown,
      summary: [counts.danger ? '✕ ' + counts.danger : null,
        counts.warning ? '⚠ ' + counts.warning : null].filter(Boolean).join(' · ') || '—' };
  }

  // ===== LA COMPLEXITÉ RÉELLE =====

  /**
   * §10. « Plus simple — le moins d'étages et de pièces » ne comptait que les
   * ÉTAGES. Un planétaire à un étage porte un solaire, une couronne, trois à
   * cinq satellites et un porte-satellites ; un couple droit porte deux roues.
   * Les deux obtenaient la même simplicité. On compte donc les organes, les
   * arbres et ce que le procédé coûte en plus.
   */
  var SPECIAL_MACHINING = { bevel: 2, worm: 2, internal: 1, helical: 1 };

  function complexity(solution) {
    var stages = (solution && solution.stages) || [];
    if (!stages.length) return null;
    var parts = 0, shafts = 1, flexible = 0, carriers = 0, machining = 0;
    stages.forEach(function (stage) {
      var type = stage.type === 'epicyclic' ? 'planetary' : stage.type;
      machining += SPECIAL_MACHINING[type] || 0;
      if (type === 'planetary') {
        var planets = Math.max(1, Math.round(stage.planetCount || 3));
        parts += 2 + planets;                    // solaire + couronne + satellites
        carriers += 1;
        shafts += 1;
      } else if (type === 'belt' || type === 'chain') {
        parts += 2; flexible += 1; shafts += 1;
      } else if (type === 'rack') {
        parts += 2; shafts += 1;
      } else {
        parts += 2; shafts += 1;
      }
    });
    // Deux roulements par arbre : une estimation, et elle est nommée comme telle.
    var bearings = shafts * 2;
    return { parts: parts, shafts: shafts, bearings: bearings, carriers: carriers,
      flexible: flexible, machining: machining,
      value: parts + shafts + bearings + carriers + flexible + machining };
  }

  // ===== L'ASSEMBLAGE =====

  /**
   * build(pool, options) → le verdict complet, une fois.
   * @param {Array} pool           les solutions calculées
   * @param {object} [options]     { preferences, selection, constraints, intent }
   */
  function build(pool, options) {
    options = options || {};
    var solutions = Array.isArray(pool) ? pool : [];
    var decision = Evaluator.evaluate(solutions, options.preferences || null, options.selection || null);
    var reference = decision.recommended != null ? solutions[decision.recommended] : null;

    var entries = solutions.map(function (solution, index) {
      var checks = Compliance.evaluate(solution, options.constraints || {});
      var strength = Evaluator.robustness(solution);
      var gaps = trades(solution, reference);
      var list = contributions(solution);
      var badges = decision.byIndex[index] || [];
      return {
        index: index,
        solution: solution,
        engineering: solution && solution.score ? solution.score.value : null,
        contributions: list,
        dominant: dominantFactor(list),
        decision: {
          rank: decision.rank[index] || null,
          score: decision.scores[index],
          pareto: decision.front.indexOf(index) >= 0,
          recommended: index === decision.recommended
        },
        badges: badges,
        compliance: { overall: Compliance.overall(checks), checks: Compliance.badges(checks), detail: checks },
        violations: decision.compliance[index] || [],
        robustness: strength,
        uncertainty: uncertainty(checks, strength),
        strengths: gaps.strengths,
        compromises: gaps.compromises,
        alerts: alerts(solution),
        complexity: complexity(solution),
        context: fingerprint(solution)
      };
    });

    var byIndex = {};
    entries.forEach(function (entry) { byIndex[entry.index] = entry; });
    return {
      entries: entries, byIndex: byIndex, decision: decision,
      recommended: decision.recommended, reference: reference,
      // Le vivier a-t-il été tronqué ? §17 : une recommandation calculée sur
      // 400 solutions retenues parmi 8 000 valides n'a pas la même portée
      // qu'une optimisation exhaustive, et cela doit se lire.
      scope: scopeOf(solutions, options.stats),
      objectives: decision.objectives
    };
  }

  /**
   * §16 : LA SÉLECTION — ce qui sert vraiment à décider.
   *
   * Le vivier peut garder quatre cents solutions, et l'espace de travail les
   * rendait toutes. Ce n'est pas seulement une question de performance :
   * personne ne compare correctement cent quatre-vingts cartes, et sur
   * téléphone elles sont la seule représentation disponible.
   *
   * Ce qui aide à choisir tient en une poignée :
   *   — la recommandée ;
   *   — la meilleure alternative de chaque compromis significatif ;
   *   — puis, s'il reste de la place, la meilleure de chaque ARCHITECTURE
   *     encore absente : c'est là que se trouvent les solutions réellement
   *     différentes, pas dans la trois-centième variante de denture.
   *
   * @returns {number[]} des positions dans le vivier, la recommandée en tête
   */
  function shortlist(assessment, options) {
    options = options || {};
    var limit = finite(options.limit) ? options.limit : 8;
    var grouping = options.grouping || null;
    var out = [], seen = {};
    function take(index) {
      if (index == null || seen[index]) return;
      seen[index] = true; out.push(index);
    }
    var decision = assessment && assessment.decision;
    if (!decision) return out;
    take(decision.recommended);
    // `order` range déjà les porteurs de badge par mérite décisionnel.
    (decision.order || []).forEach(take);

    if (grouping && grouping.keyOf && out.length < limit) {
      var families = {};
      out.forEach(function (index) {
        var solution = assessment.entries[index] && assessment.entries[index].solution;
        if (solution) families[grouping.keyOf(solution)] = true;
      });
      // Le vivier est parcouru dans l'ordre du CLASSEMENT : la meilleure de
      // chaque architecture, et non la première venue.
      (decision.ranking || []).forEach(function (index) {
        if (out.length >= limit || seen[index]) return;
        var solution = assessment.entries[index] && assessment.entries[index].solution;
        if (!solution) return;
        var key = grouping.keyOf(solution);
        if (families[key]) return;
        families[key] = true;
        take(index);
      });
    }
    // Une sélection de deux cartes devant un vivier de trois cents donne
    // l'impression que la recherche n'a rien trouvé. On complète par les
    // suivantes du CLASSEMENT — ce sont des variantes proches, et c'est
    // assumé : elles disent où va la suite de la liste.
    var floor = finite(options.minimum) ? options.minimum : 5;
    (decision.ranking || []).forEach(function (index) {
      if (out.length >= Math.min(floor, limit)) return;
      take(index);
    });
    return out.slice(0, limit);
  }

  function scopeOf(solutions, stats) {
    var kept = solutions.length;
    var valid = stats && finite(stats.valid) ? stats.valid : null;
    var truncated = valid != null && valid > kept;
    return { kept: kept, valid: valid, truncated: truncated,
      label: truncated
        ? 'Classement calculé sur les ' + kept + ' solutions conservées, sur ' + valid + ' valides — domaine tronqué'
        : kept + ' solution' + (kept > 1 ? 's' : '') + ' analysée' + (kept > 1 ? 's' : '') + ' pour le classement' };
  }

  return {
    build: build, contributions: contributions, dominantFactor: dominantFactor,
    trades: trades, uncertainty: uncertainty, alerts: alerts, complexity: complexity,
    shortlist: shortlist,
    fingerprint: fingerprint, contextDifferences: contextDifferences, scopeOf: scopeOf,
    METRIC_LABELS: METRIC_LABELS, TRADE_METRICS: TRADE_METRICS, SEVERITY: SEVERITY,
    CONTEXT_LABELS: CONTEXT_LABELS, MEANINGFUL: MEANINGFUL
  };
});
