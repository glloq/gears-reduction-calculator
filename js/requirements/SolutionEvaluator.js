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

  // Axes toujours présents : ils décrivent tout réducteur, quel qu'il soit.
  var BASE_OBJECTIVES = [
    { key: 'size', label: 'encombrement', weight: 'size', lower: function (s) { return volume(s); } },
    { key: 'efficiency', label: 'rendement', weight: 'efficiency', lower: function (s) { return finite(s.efficiency) ? 1 - s.efficiency : null; } },
    { key: 'error', label: 'précision', weight: 'ratio', lower: function (s) { return finite(s.errorPercent) ? Math.abs(s.errorPercent) : null; } },
    { key: 'stages', label: 'simplicité', weight: 'stages', lower: function (s) { return (s.stages || []).length || null; } }
  ];

  // Axes AJOUTÉS selon le cahier des charges. Un front figé sur quatre critères
  // écartait des solutions décisives : une architecture un peu plus grosse mais
  // deux fois plus sûre était « dominée », donc invisible — alors même que
  // l'utilisateur avait demandé la robustesse. Le front doit dépendre de ce
  // qu'on cherche.
  var OPTIONAL_OBJECTIVES = {
    robust: { key: 'robust', label: 'robustesse', weight: 'stress',
      lower: function (s) { var v = minSafety(s); return finite(v) ? -v : null; } },
    quiet: { key: 'quiet', label: 'silence', weight: 'noise',
      lower: function (s) { var v = familyTrait(s, 'quiet'); return finite(v) ? -v : null; } },
    cost: { key: 'cost', label: 'coût', weight: 'cost',
      lower: function (s) { var v = familyTrait(s, 'cost'); return finite(v) ? -v : null; } },
    manufacturing: { key: 'manufacturing', label: 'fabricabilité', weight: 'manufacturing',
      lower: function (s) { var v = familyTrait(s, 'printable'); return finite(v) ? -v : null; } },
    loss: { key: 'loss', label: 'pertes', weight: 'efficiency',
      lower: function (s) { return finite(s.lossPowerW) ? s.lossPowerW : null; } },
    velocity: { key: 'velocity', label: 'vitesse périphérique', weight: 'noise',
      lower: function (s) { return pitchLineVelocity(s); } },
    torque: { key: 'torque', label: 'couple de sortie', weight: 'stress',
      lower: function (s) { return finite(s.outputTorqueNm) ? -s.outputTorqueNm : null; } }
  };

  /** Vitesse au primitif maximale, recalculée ici pour rester sans dépendance. */
  function pitchLineVelocity(solution) {
    var speed = solution.inputSpeedRpm;
    if (!finite(speed)) return null;
    var best = null;
    (solution.mechanical || []).forEach(function (stage) {
      var diameter = stage.geometry && stage.geometry.pitchDiameterInput;
      if (finite(diameter)) {
        var value = Math.PI * diameter * Math.abs(speed) / 60000;
        if (best == null || value > best) best = value;
      }
      speed /= Math.abs(stage.ratio) || 1;
    });
    return best;
  }

  /** Ce qu'une priorité ajoute au front. */
  var AXIS_OBJECTIVE = {
    robust: 'robust', quiet: 'quiet', cheap: 'cost',
    manufacturable: 'manufacturing', efficiency: 'loss'
  };

  /** Ce qu'un critère posé ajoute au front : on ne classe que ce qui compte. */
  var CRITERION_OBJECTIVE = {
    bendingSafety: 'robust', contactSafety: 'robust', outputTorque: 'torque',
    powerLoss: 'loss', pitchLineVelocity: 'velocity'
  };

  /**
   * Les axes du front pour CE cahier des charges.
   * Une valeur manquante (une courroie n'a pas de coefficient de sécurité) est
   * normalisée à 0,5 : ni avantage ni pénalité, et la dominance reste
   * transitive puisque c'est une constante.
   */
  function objectivesFor(preferences) {
    var objectives = BASE_OBJECTIVES.slice();
    var seen = {};
    objectives.forEach(function (objective) { seen[objective.key] = true; });

    function add(key) {
      var objective = OPTIONAL_OBJECTIVES[key];
      if (objective && !seen[key]) { seen[key] = true; objectives.push(objective); }
    }
    if (!preferences) return objectives;
    preferences.activeAxes().forEach(function (axis) { add(AXIS_OBJECTIVE[axis.id]); });
    preferences.list().forEach(function (entry) { add(CRITERION_OBJECTIVE[entry.key]); });
    return objectives;
  }

  /** Conservé pour compatibilité : les axes systématiques. */
  var PARETO_OBJECTIVES = BASE_OBJECTIVES;

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
  function evaluate(pool, preferences, selection) {
    var solutions = Array.isArray(pool) ? pool : [];
    if (!solutions.length) return { front: [], best: {}, order: [], byIndex: {}, scores: [], compliance: [], objectives: [] };

    var objectives = objectivesFor(preferences);
    var readers = objectives.map(function (objective) { return normalizer(solutions, objective.lower); });
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

    // Score agrégé sur les MÊMES axes que le front, pondéré par les priorités :
    // classer sur quatre critères un front qui en compte six reviendrait à
    // ignorer précisément ce que l'utilisateur a demandé.
    var weights = preferences ? preferences.weights() : null;
    var scores = solutions.map(function (solution, index) {
      var total = 0, sum = 0;
      objectives.forEach(function (objective, k) {
        var weight = weights ? (weights[objective.weight] || 1) : 1;
        total += weight * vectors[index][k]; sum += weight;
      });
      var base = sum ? total / sum : 0;
      // Une préférence non satisfaite dégrade le classement sans exclure ;
      // une famille explicitement préférée l'améliore, sans rien exclure non plus.
      var penalty = preferences ? preferences.penalty(solution) * 0.5 : 0;
      var bonus = selection && selection.preferenceBonus ? selection.preferenceBonus(solution) * 0.15 : 0;
      return base + penalty - bonus;
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

    return { front: front, best: best, order: order, byIndex: byIndex, scores: scores,
      compliance: compliance, objectives: objectives.map(function (o) { return o.key; }) };
  }

  var LABELS = { recommended: 'Recommandée' };
  CATEGORIES.forEach(function (category) { LABELS[category.id] = category.label; });

  /**
   * §17 : « Recommandée » répond à « quel est le meilleur compromis ? ». Ce
   * n'est pas la question posée quand on a demandé le couple maximum, ni quand
   * on cherche à battre un réducteur existant. Le vocabulaire des résultats
   * doit suivre la question, sinon la réponse semble porter sur autre chose.
   */
  var LEAD_LABELS = {
    maximize: { torque: 'Couple maximum', ratio: 'Rapport maximum', efficiency: 'Rendement maximum',
      compact: 'Le plus compact', simple: 'Le plus simple' },
    improve: { compact: 'Meilleure amélioration', efficiency: 'Meilleure amélioration',
      torque: 'Meilleure amélioration', simple: 'Meilleure amélioration' }
  };

  /**
   * Libellé du badge de tête pour cette intention.
   * @param {object} [intent] `{mode, objective}` — sans lui, le compromis.
   */
  function leadLabel(intent) {
    if (!intent) return LABELS.recommended;
    var table = LEAD_LABELS[intent.mode];
    return (table && table[intent.objective]) || LABELS.recommended;
  }

  function label(id, intent) {
    if (id === 'recommended') return leadLabel(intent);
    return LABELS[id] || id;
  }

  /** Pourquoi cette solution mène, dans les termes de la question posée. */
  function leadReason(intent) {
    if (intent && intent.mode === 'maximize') {
      var target = LEAD_LABELS.maximize[intent.objective];
      return target ? target.toLowerCase() + ' de l’espace exploré' : 'meilleur de l’espace exploré';
    }
    if (intent && intent.mode === 'improve') return 'meilleur gain face au réducteur décrit';
    return 'meilleur compromis pour vos priorités';
  }

  /** Justification en français, jamais un score nu. */
  function explain(solution, badges, violations, intent) {
    var parts = [];
    (badges || []).forEach(function (id) {
      if (id === 'recommended') { parts.push(leadReason(intent)); return; }
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
    evaluate: evaluate, explain: explain, label: label, leadLabel: leadLabel,
    LEAD_LABELS: LEAD_LABELS,
    CATEGORIES: CATEGORIES, PARETO_OBJECTIVES: PARETO_OBJECTIVES, MEANINGFUL_GAIN: MEANINGFUL_GAIN,
    objectivesFor: objectivesFor, BASE_OBJECTIVES: BASE_OBJECTIVES, OPTIONAL_OBJECTIVES: OPTIONAL_OBJECTIVES
  };
});
