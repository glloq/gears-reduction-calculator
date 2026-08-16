// SolutionEvaluator.js - Le Pareto en interne, des mots en sortie.
//
// Choix 12C. Un score unique cache les compromis : deux solutions très
// différentes peuvent obtenir 0,71 et 0,70 sans que rien ne dise en quoi elles
// diffèrent. Un front de Pareto pur, à l'inverse, est rigoureux mais illisible.
//
// On calcule donc le front — l'ensemble des solutions qu'aucune autre ne bat
// sur TOUS les critères à la fois — puis on n'en montre que des catégories
// compréhensibles :
//
//   ★ Recommandée      le meilleur compromis selon les priorités
//   ↔ Plus compacte    ⚡ Meilleur rendement    ⚙ Plus simple    🛡 Plus robuste
//
// Une alternative n'est proposée que si elle est VRAIMENT différente de la
// recommandée : proposer un « plus compact » qui gagne 0,3 mm serait du bruit.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./TransmissionAdvisor.js') : root.GearTransmissionAdvisor);
  if (common) module.exports = api;
  else {
    root.GearSolutionEvaluator = api;
    if (root.GearApp) { root.GearApp.requirements = root.GearApp.requirements || {}; root.GearApp.requirements.SolutionEvaluator = api; }
  }
})(typeof self !== 'undefined' ? self : this, function (Advisor) {
  'use strict';

  /** Écart minimal pour qu'une alternative mérite d'être montrée. */
  var MEANINGFUL_GAIN = 0.08;

  function finite(value) { return typeof value === 'number' && isFinite(value); }

  function volume(solution) {
    var d = solution.dimensions || {};
    if (finite(d.x) && finite(d.y) && finite(d.z)) return d.x * d.y * d.z;
    if (finite(d.maxDiameter)) return Math.pow(d.maxDiameter, 3);
    return null;
  }

  function minSafety(solution) {
    var values = (solution.mechanical || []).map(function (entry) {
      return entry && entry.bending && entry.bending.safetyFactor;
    }).filter(finite);
    return values.length ? Math.min.apply(Math, values) : null;
  }

  /** Trait moyen de la chaîne, lu sur le savoir du conseiller — une seule source. */
  function familyTrait(solution, trait) {
    var stages = solution.stages || [];
    if (!stages.length) return null;
    var values = stages.map(function (stage) {
      var known = Advisor.KNOWLEDGE[stage.type === 'epicyclic' ? 'planetary' : stage.type];
      return known ? known[trait] : null;
    }).filter(finite);
    return values.length ? Math.min.apply(Math, values) : null;
  }

  // Objectifs DÉFINIS POUR TOUTE SOLUTION : ce sont les seuls admis dans le
  // front, sans quoi la dominance perdrait sa transitivité dès qu'une valeur
  // manque (une courroie n'a pas de coefficient de sécurité).
  var PARETO_OBJECTIVES = [
    { key: 'size', label: 'encombrement', lower: function (s) { return volume(s); } },
    { key: 'efficiency', label: 'rendement', lower: function (s) { return finite(s.efficiency) ? 1 - s.efficiency : null; } },
    { key: 'error', label: 'précision', lower: function (s) { return finite(s.errorPercent) ? Math.abs(s.errorPercent) : null; } },
    { key: 'stages', label: 'simplicité', lower: function (s) { return (s.stages || []).length || null; } }
  ];

  // Catégories montrées à l'utilisateur. `metric` : plus haut = meilleur.
  var CATEGORIES = [
    { id: 'compact', label: 'Plus compacte', reason: 'le plus petit encombrement du lot',
      metric: function (s) { var v = volume(s); return finite(v) ? -v : null; } },
    { id: 'efficient', label: 'Meilleur rendement', reason: 'le rendement le plus élevé',
      metric: function (s) { return finite(s.efficiency) ? s.efficiency : null; } },
    { id: 'simple', label: 'Plus simple', reason: 'le moins d’étages et de pièces',
      metric: function (s) { var n = (s.stages || []).length; return n ? -n : null; } },
    { id: 'robust', label: 'Plus robuste', reason: 'la plus grande marge de sécurité',
      metric: function (s) { return minSafety(s); } },
    { id: 'precise', label: 'Plus précise', reason: 'l’écart le plus faible au rapport demandé',
      metric: function (s) { return finite(s.errorPercent) ? -Math.abs(s.errorPercent) : null; } },
    { id: 'quiet', label: 'Plus silencieuse', reason: 'les familles les moins bruyantes',
      metric: function (s) { return familyTrait(s, 'quiet'); } }
  ];

  /** Normalisation min-max d'un objectif sur le vivier ; 0 quand tout est égal. */
  function normalizer(pool, read) {
    var values = pool.map(read).filter(finite);
    if (!values.length) return function () { return 0; };
    var min = Math.min.apply(Math, values), max = Math.max.apply(Math, values), span = max - min;
    return function (solution) {
      var value = read(solution);
      if (!finite(value)) return 0.5;      // inconnu : ni avantage ni pénalité
      return span ? (value - min) / span : 0;
    };
  }

  /** a domine b : au moins aussi bon partout, strictement meilleur quelque part. */
  function dominates(a, b) {
    var strictly = false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] > b[i] + 1e-12) return false;
      if (a[i] < b[i] - 1e-12) strictly = true;
    }
    return strictly;
  }

  /**
   * Analyse le vivier.
   * @param {Array} pool solutions calculées
   * @param {object} [preferences] PreferenceModel : pondère et signale les violations
   * @returns {{front, best, order, byIndex, scores, compliance}}
   */
  function evaluate(pool, preferences) {
    var solutions = Array.isArray(pool) ? pool : [];
    if (!solutions.length) return { front: [], best: {}, order: [], byIndex: {}, scores: [], compliance: [] };

    var readers = PARETO_OBJECTIVES.map(function (objective) { return normalizer(solutions, objective.lower); });
    var vectors = solutions.map(function (solution) {
      return readers.map(function (read) { return read(solution); });
    });

    var front = [];
    for (var i = 0; i < solutions.length; i++) {
      var dominated = false;
      for (var j = 0; j < solutions.length && !dominated; j++) {
        if (i !== j && dominates(vectors[j], vectors[i])) dominated = true;
      }
      if (!dominated) front.push(i);
    }

    // Score agrégé sur le front, pondéré par les priorités. Les poids du moteur
    // sont réutilisés tels quels : une seule définition de « ce qui compte ».
    var weights = preferences ? preferences.weights() : null;
    var axisWeight = {
      size: weights ? weights.size : 1, efficiency: weights ? weights.efficiency : 1,
      error: weights ? weights.ratio : 1, stages: weights ? weights.stages : 1
    };
    var scores = solutions.map(function (solution, index) {
      var total = 0, sum = 0;
      PARETO_OBJECTIVES.forEach(function (objective, k) {
        var weight = axisWeight[objective.key] || 1;
        total += weight * vectors[index][k]; sum += weight;
      });
      var base = sum ? total / sum : 0;
      // Une préférence non satisfaite dégrade le classement sans exclure.
      return base + (preferences ? preferences.penalty(solution) * 0.5 : 0);
    });

    var best = {};
    var frontOnly = front.slice();
    var recommended = frontOnly.reduce(function (bestIndex, index) {
      return bestIndex == null || scores[index] < scores[bestIndex] ? index : bestIndex;
    }, null);
    if (recommended != null) best.recommended = recommended;

    CATEGORIES.forEach(function (category) {
      var winner = null, winnerValue = null;
      frontOnly.forEach(function (index) {
        var value = category.metric(solutions[index]);
        if (!finite(value)) return;                       // critère non évalué : pas candidat
        if (winnerValue == null || value > winnerValue) { winner = index; winnerValue = value; }
      });
      if (winner == null || winner === recommended) return;
      // Ne montrer une alternative que si l'écart est perceptible.
      var reference = recommended != null ? category.metric(solutions[recommended]) : null;
      if (finite(reference)) {
        var scale = Math.max(Math.abs(reference), Math.abs(winnerValue), 1e-9);
        if ((winnerValue - reference) / scale < MEANINGFUL_GAIN) return;
      }
      best[category.id] = winner;
    });

    var byIndex = {};
    Object.keys(best).forEach(function (id) {
      var index = best[id];
      (byIndex[index] = byIndex[index] || []).push(id);
    });
    var order = Object.keys(byIndex).map(Number).sort(function (a, b) {
      if (a === recommended) return -1;
      if (b === recommended) return 1;
      return scores[a] - scores[b];
    });

    var compliance = solutions.map(function (solution) {
      return preferences ? preferences.violations(solution) : [];
    });

    return { front: front, best: best, order: order, byIndex: byIndex, scores: scores, compliance: compliance };
  }

  var LABELS = { recommended: 'Recommandée' };
  CATEGORIES.forEach(function (category) { LABELS[category.id] = category.label; });

  function label(id) { return LABELS[id] || id; }

  /** Justification en français, jamais un score nu. */
  function explain(solution, badges, violations) {
    var parts = [];
    (badges || []).forEach(function (id) {
      if (id === 'recommended') { parts.push('meilleur compromis pour vos priorités'); return; }
      for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) parts.push(CATEGORIES[i].reason);
    });
    if (!parts.length) {
      if (finite(solution.errorPercent)) parts.push('écart de ' + (Math.round(Math.abs(solution.errorPercent) * 100) / 100) + ' %');
      if (finite(solution.efficiency)) parts.push('rendement ' + Math.round(solution.efficiency * 100) + ' %');
    }
    var text = parts.length ? parts.join(', ') : 'solution valide';
    text = text.charAt(0).toUpperCase() + text.slice(1) + '.';
    if (violations && violations.length) {
      text += ' Ne respecte pas : ' + violations.map(function (v) { return v.meta.label.toLowerCase(); }).join(', ') + '.';
    } else if (violations) {
      text += ' Respecte toutes les contraintes.';
    }
    return text;
  }

  return {
    evaluate: evaluate, explain: explain, label: label,
    CATEGORIES: CATEGORIES, PARETO_OBJECTIVES: PARETO_OBJECTIVES, MEANINGFUL_GAIN: MEANINGFUL_GAIN
  };
});
