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

  /**
   * LA ROBUSTESSE, C'EST LE MAILLON LE PLUS PROCHE DE SA LIMITE.
   *
   * On ne lisait que le coefficient de FLEXION. « Plus robuste » désignait donc
   * le meilleur SF de Lewis, et ignorait le contact — au point qu'une solution
   * à SF 3,0 / SH 1,12 pouvait être annoncée plus robuste qu'une SF 2,2 /
   * SH 2,0, alors que la première est à un cheveu de sa limite de pression.
   *
   * Deux nombres qui n'ont ni la même échelle ni le même seuil ne se comparent
   * pas tels quels : on les rapporte chacun à SON minimum, ce qui donne des
   * MARGES sans unité, et la robustesse est la plus faible des marges.
   *
   * Reste ce qui n'a pas été vérifié — une courroie n'a ni SF ni SH. Deux
   * réponses différentes pour deux questions différentes :
   *
   *   — pour CLASSER, la marge porte sur les contrôles qui ont eu lieu. Une
   *     solution partiellement vérifiée garde ainsi sa place sur le front.
   *   — pour DÉCERNER LE BADGE « plus robuste », non : `unknown` disqualifie.
   *     Une grandeur non vérifiée ne gagne jamais le titre de la grandeur
   *     qu'elle n'a pas vérifiée. Non vérifié n'est pas conforme.
   */
  var SAFETY_FLOOR = { bending: 1.3, contact: 1.1 };
  var SAFETY_LABEL = { bending: 'flexion', contact: 'contact' };

  function robustness(solution) {
    var stages = solution.mechanical || [];
    var worst = { margin: null, bending: null, contact: null, critical: null, unknown: [] };
    if (!stages.length) { worst.unknown.push('mécanique'); return worst; }
    stages.forEach(function (entry, index) {
      Object.keys(SAFETY_FLOOR).forEach(function (kind) {
        var value = entry && entry[kind] && entry[kind].safetyFactor;
        if (!finite(value)) { worst.unknown.push(SAFETY_LABEL[kind] + ' étage ' + (index + 1)); return; }
        var margin = value / SAFETY_FLOOR[kind];
        if (worst[kind] == null || margin < worst[kind]) worst[kind] = margin;
        if (worst.margin == null || margin < worst.margin) { worst.margin = margin; worst.critical = kind; }
      });
    });
    return worst;
  }

  /** Pour CLASSER : la marge sur ce qui a été vérifié. */
  function minSafety(solution) { return robustness(solution).margin; }

  /** Pour DÉCERNER : la même marge, mais seulement si rien ne manque. */
  function certifiedSafety(solution) {
    var seen = robustness(solution);
    return seen.unknown.length ? null : seen.margin;
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
      lower: function (s) { return finite(s.outputTorqueNm) ? -s.outputTorqueNm : null; } },
    // Le pendant linéaire du couple. Sans lui, une transmission rotation →
    // translation n'avait aucun axe de PERFORMANCE sur le front : elle n'y
    // était classée que par son encombrement et son écart de course.
    force: { key: 'force', label: 'force de sortie', weight: 'stress',
      lower: function (s) { return finite(s.outputForceN) ? -s.outputForceN : null; } }
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
    powerLoss: 'loss', pitchLineVelocity: 'velocity', outputForce: 'force'
  };

  /**
   * Les axes que le front DÉDUIT du cahier des charges.
   *
   * Le front ne connaissait que des axes nommés à l'avance, tous rotatifs. Une
   * demande de force de sortie ou de vitesse linéaire n'en faisait donc pas
   * partie : la préférence pesait bien sur le score final, mais la solution qui
   * la servait pouvait avoir été écartée AVANT, comme dominée sur les autres
   * axes. On classait sur ce qu'on savait nommer, pas sur ce qui était demandé.
   *
   * Tout critère posé par l'utilisateur devient donc un axe :
   *   — s'il a un sens d'amélioration, l'axe est la grandeur elle-même ;
   *   — s'il désigne une PLAGE, l'axe est la distance à cette plage, que
   *     `Quantity.shortfall` sait déjà mesurer. Zéro quand elle est tenue.
   *
   * Les grandeurs déjà portées par un axe de base — encombrement, rendement,
   * écart, étages — ne sont pas dédoublées : deux axes qui disent la même chose
   * gonflent le front sans rien y ajouter.
   */
  var COVERED_BY_BASE = {
    maxDiameter: true, maxLength: true, maxWidth: true,
    efficiency: true, ratioError: true, stages: true
  };

  function objectiveFromCriterion(entry) {
    var meta = entry.meta, quantity = entry.quantity;
    if (!meta || !meta.metric) return null;
    if (meta.better === 'lower') {
      return { key: 'req:' + entry.key, label: meta.label.toLowerCase(), weight: 'ratio',
        lower: function (s) { var v = meta.metric(s); return finite(v) ? v : null; } };
    }
    if (meta.better === 'higher') {
      return { key: 'req:' + entry.key, label: meta.label.toLowerCase(), weight: 'ratio',
        lower: function (s) { var v = meta.metric(s); return finite(v) ? -v : null; } };
    }
    // Une PLAGE n'a pas de direction : ce qui se minimise, c'est l'écart à la
    // plage demandée. Sans quantité déclarée, il n'y a rien à mesurer.
    if (!quantity || !quantity.isKnown || !quantity.isKnown()) return null;
    return { key: 'req:' + entry.key, label: 'écart ' + meta.label.toLowerCase(), weight: 'ratio',
      lower: function (s) {
        var v = meta.metric(s);
        if (!finite(v)) return null;
        if (meta.scale) v *= meta.scale;
        var gap = quantity.shortfall ? quantity.shortfall(v) : null;
        return finite(gap) ? Math.abs(gap) : 0;
      } };
  }

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
    preferences.list().forEach(function (entry) {
      if (CRITERION_OBJECTIVE[entry.key]) { add(CRITERION_OBJECTIVE[entry.key]); return; }
      if (COVERED_BY_BASE[entry.key] || seen['req:' + entry.key]) return;
      var derived = objectiveFromCriterion(entry);
      if (derived) { seen[derived.key] = true; objectives.push(derived); }
    });
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
    { id: 'robust', label: 'Plus robuste', reason: 'la plus grande marge sur son contrôle le plus juste',
      metric: function (s) { return certifiedSafety(s); } },
    { id: 'precise', label: 'Plus précise', reason: 'l’écart le plus faible au rapport demandé',
      metric: function (s) { return finite(s.errorPercent) ? -Math.abs(s.errorPercent) : null; } },
    // §11 : bruit, coût et fabricabilité ne sont pas CALCULÉS. Ce sont des
    // aptitudes moyennes par famille, et le libellé le dit — « potentiellement
    // plus silencieuse » n'est pas « plus silencieuse », qui laisserait croire
    // à un calcul acoustique.
    { id: 'quiet', label: 'Potentiellement plus silencieuse', reason: 'les familles les moins bruyantes',
      estimated: true, metric: function (s) { return familyTrait(s, 'quiet'); } },
    // §12 : l'utilisateur peut demander « économique » ou « fabricable » dans
    // ses priorités, et aucune alternative ne répondait jamais à ces mots-là.
    // Elles ne sont proposées que si la question a été posée : sinon, une
    // alternative « moins chère » répondrait à une question qu'on n'a pas.
    { id: 'manufacturable', label: 'Plus facile à fabriquer', reason: 'les familles les plus simples à produire',
      estimated: true, axis: 'manufacturable', metric: function (s) { return familyTrait(s, 'printable'); } },
    { id: 'cheap', label: 'Plus économique', reason: 'les familles les moins coûteuses',
      estimated: true, axis: 'cheap', metric: function (s) { return familyTrait(s, 'cost'); } }
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
    if (!solutions.length) {
      return { front: [], best: {}, order: [], byIndex: {}, scores: [], recommended: null,
        ranking: [], rank: {}, compliance: [], objectives: [] };
    }

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

    // Les axes que l'utilisateur a réellement exprimés : une catégorie liée à
    // une priorité ne se propose que si cette priorité existe.
    var wanted = {};
    if (preferences && preferences.activeAxes) {
      preferences.activeAxes().forEach(function (axis) { wanted[axis.id] = true; });
    }

    CATEGORIES.forEach(function (category) {
      if (category.axis && !wanted[category.axis]) return;
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

    // LE CLASSEMENT DÉCISIONNEL, publié.
    //
    // Il existait déjà — c'est lui qui élit la recommandée — mais il restait
    // enfermé ici : l'écran triait par le score ABSOLU d'Engineering, qui est
    // une autre grandeur, calculée sur d'autres axes, sans les priorités et
    // sans le vivier. La première carte et la carte ★ pouvaient donc être deux
    // cartes différentes. Le rang sort maintenant avec le reste, et c'est lui
    // que l'on trie.
    var ranking = solutions.map(function (_, index) { return index; }).sort(function (a, b) {
      if (a === recommended) return -1;
      if (b === recommended) return 1;
      return scores[a] - scores[b] || a - b;
    });
    var rank = {};
    ranking.forEach(function (index, position) { rank[index] = position + 1; });

    return { front: front, best: best, order: order, byIndex: byIndex, scores: scores,
      recommended: recommended == null ? null : recommended,
      ranking: ranking, rank: rank,
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
    robustness: robustness, certifiedSafety: certifiedSafety, SAFETY_FLOOR: SAFETY_FLOOR,
    LEAD_LABELS: LEAD_LABELS,
    CATEGORIES: CATEGORIES, PARETO_OBJECTIVES: PARETO_OBJECTIVES, MEANINGFUL_GAIN: MEANINGFUL_GAIN,
    objectivesFor: objectivesFor, BASE_OBJECTIVES: BASE_OBJECTIVES, OPTIONAL_OBJECTIVES: OPTIONAL_OBJECTIVES
  };
});
