// TransmissionAdvisor.js - Un vrai conseiller, pas une case « tout cocher ».
//
// Choix 5C. Jusqu'ici « Automatique » voulait dire « activer les huit familles
// rotatives », sans jamais se demander si elles avaient un sens. Le conseiller
// répond à la seule question utile :
//
//   Besoin  →  quelles familles, dans quel ordre, et POURQUOI
//
// Il ne décide pas à la place de l'utilisateur : il classe, il justifie, et
// l'utilisateur garde le droit de choisir lui-même. Les faits chiffrés
// (rapport maximal par étage, relation entre axes) viennent du registre, qui
// reste la source unique ; ce module n'ajoute que les traits qualitatifs qu'un
// solveur ne peut pas déduire — bruit, coût, aptitude à l'impression.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else {
    root.GearTransmissionAdvisor = api;
    if (root.GearApp) { root.GearApp.requirements = root.GearApp.requirements || {}; root.GearApp.requirements.TransmissionAdvisor = api; }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Traits normalisés dans [0, 1], « plus haut = mieux ». `quiet` est une
  // qualité de silence, pas un niveau de bruit : les huit axes se lisent alors
  // tous dans le même sens.
  var KNOWLEDGE = {
    spur:      { name: 'Engrenage droit',       axis: 'parallel',      ratioPerStage: 8,   efficiency: 0.97, quiet: 0.50, cost: 0.90, printable: 0.90, compact: 0.55, robust: 0.85, selfLocking: false },
    helical:   { name: 'Engrenage hélicoïdal',  axis: 'parallel',      ratioPerStage: 10,  efficiency: 0.98, quiet: 0.85, cost: 0.70, printable: 0.60, compact: 0.55, robust: 0.90, selfLocking: false },
    internal:  { name: 'Engrenage intérieur',   axis: 'parallel',      ratioPerStage: 12,  efficiency: 0.98, quiet: 0.60, cost: 0.60, printable: 0.80, compact: 0.85, robust: 0.80, selfLocking: false },
    bevel:     { name: 'Engrenage conique',     axis: 'perpendicular', ratioPerStage: 6,   efficiency: 0.96, quiet: 0.50, cost: 0.50, printable: 0.50, compact: 0.60, robust: 0.75, selfLocking: false },
    planetary: { name: 'Train épicycloïdal',    axis: 'coaxial',       ratioPerStage: 12,  efficiency: 0.97, quiet: 0.60, cost: 0.45, printable: 0.70, compact: 0.95, robust: 0.95, selfLocking: false },
    worm:      { name: 'Vis sans fin',          axis: 'perpendicular', ratioPerStage: 120, efficiency: 0.65, quiet: 0.90, cost: 0.60, printable: 0.35, compact: 0.80, robust: 0.70, selfLocking: true },
    belt:      { name: 'Courroie',              axis: 'parallel',      ratioPerStage: 10,  efficiency: 0.98, quiet: 0.95, cost: 0.80, printable: 0.50, compact: 0.30, robust: 0.50, selfLocking: false, spansDistance: true },
    chain:     { name: 'Chaîne',                axis: 'parallel',      ratioPerStage: 12,  efficiency: 0.97, quiet: 0.30, cost: 0.70, printable: 0.30, compact: 0.30, robust: 0.85, selfLocking: false, spansDistance: true },
    rack:      { name: 'Pignon-crémaillère',    axis: 'linear',        ratioPerStage: Infinity, efficiency: 0.97, quiet: 0.55, cost: 0.80, printable: 0.75, compact: 0.60, robust: 0.75, selfLocking: false, linear: true }
  };

  var ROTARY = Object.keys(KNOWLEDGE).filter(function (id) { return !KNOWLEDGE[id].linear; });

  /** Étages minimum pour atteindre le rapport avec cette seule famille. */
  function stagesFor(id, ratio) {
    var perStage = KNOWLEDGE[id].ratioPerStage;
    if (!isFinite(ratio) || ratio <= 1) return 1;
    if (!isFinite(perStage)) return 1;
    return Math.ceil(Math.log(ratio) / Math.log(perStage));
  }

  function clamp01(value) { return Math.max(0, Math.min(1, value)); }

  /**
   * Évalue une famille contre le besoin.
   * @returns {{id, name, score, verdict, reasons}} verdict ∈ recommended|possible|excluded
   */
  function evaluate(id, context) {
    var traits = KNOWLEDGE[id], reasons = [], blockers = [];
    var architecture = context.architecture, ratio = context.ratio, maxStages = context.maxStages || 4;

    // --- Éliminations franches : dire non, et dire pourquoi. ---
    if (context.linear && !traits.linear) blockers.push('Ne produit pas de mouvement linéaire.');
    if (!context.linear && traits.linear) blockers.push('Ne convient qu’à une sortie linéaire.');
    if (architecture.selfLocking === 'forbidden' && traits.selfLocking) {
      blockers.push('Irréversible : la sortie ne pourrait pas entraîner l’entrée.');
    }
    if (context.minimumEfficiency != null && traits.efficiency < context.minimumEfficiency) {
      blockers.push('Rendement typique ' + Math.round(traits.efficiency * 100) + ' %, sous le minimum demandé de ' + Math.round(context.minimumEfficiency * 100) + ' %.');
    }
    var needed = stagesFor(id, ratio);
    if (isFinite(ratio) && ratio > 1 && needed > maxStages) {
      blockers.push('Demanderait ' + needed + ' étages pour ce rapport, au-delà de la limite de ' + maxStages + '.');
    }
    if (blockers.length) {
      return { id: id, name: traits.name, score: 0, verdict: 'excluded', reasons: blockers.map(function (t) { return { level: 'blocker', text: t }; }) };
    }

    // --- Notation : chaque terme laisse une trace lisible. ---
    var score = 0, total = 0;
    function weigh(weight, value, pro, con) {
      if (!weight) return;
      score += weight * clamp01(value); total += weight;
      if (value >= 0.8 && pro) reasons.push({ level: 'pro', text: pro });
      else if (value <= 0.45 && con) reasons.push({ level: 'con', text: con });
    }

    // Aptitude au rapport : une famille qui y arrive en un étage est précieuse.
    var compactness = needed <= 1 ? 1 : needed >= maxStages ? 0.3 : 1 - (needed - 1) / maxStages;
    weigh(3, compactness,
      isFinite(ratio) && ratio > 3 ? 'Atteint ' + round(ratio) + ':1 en ' + needed + (needed > 1 ? ' étages.' : ' seul étage.') : null,
      'Demanderait ' + needed + ' étages pour ce rapport.');

    // Architecture demandée : c'est là qu'une famille devient indispensable.
    if (architecture.axisAngle === 90) {
      var turns = traits.axis === 'perpendicular';
      weigh(3, turns ? 1 : 0.35,
        turns ? 'Réalise le renvoi d’angle à 90°.' : null,
        'Ne change pas l’orientation des axes : il faudra l’associer à un renvoi.');
    }
    if (architecture.coaxial === 'required') {
      var coaxial = traits.axis === 'coaxial';
      weigh(3, coaxial ? 1 : 0.3, coaxial ? 'Sortie coaxiale à l’entrée.' : null, 'Décale l’axe de sortie.');
    }
    if (architecture.selfLocking === 'required') {
      weigh(3, traits.selfLocking ? 1 : 0.25, traits.selfLocking ? 'Irréversible : maintient la charge à l’arrêt.' : null, 'Ne bloque pas la charge à l’arrêt.');
    }

    // Socle : même sans priorité déclarée, les familles ne se valent pas. Sans
    // ce terme le conseiller redeviendrait un « tout cocher » déguisé, puisque
    // presque toutes les familles atteignent un rapport modeste.
    // Chaque terme laisse sa trace : une liste où toutes les familles donnent
    // la même raison n'explique rien.
    weigh(1, traits.efficiency, 'Rendement élevé (' + Math.round(traits.efficiency * 100) + ' %).', 'Pertes notables (' + Math.round(traits.efficiency * 100) + ' %).');
    weigh(1, traits.compact, 'Très compact.', 'Encombrant.');
    weigh(1, traits.cost, 'Peu coûteux.', 'Coûteux à réaliser.');
    weigh(0.5, traits.quiet, 'Fonctionnement silencieux.', 'Bruyant.');
    weigh(0.5, traits.robust, 'Tient des couples élevés.', 'Capacité de couple limitée.');

    // Priorités de l'utilisateur : elles pèsent, mais n'éliminent pas.
    (context.axes || []).forEach(function (axisId, index) {
      var weight = index === 0 ? 2.5 : 1.25;
      switch (axisId) {
        case 'balanced':
          weigh(weight * 0.4, traits.efficiency, null, null);
          weigh(weight * 0.4, traits.compact, null, null);
          weigh(weight * 0.4, traits.cost, null, null);
          weigh(weight * 0.4, traits.printable, null, null);
          break;
        case 'efficiency': weigh(weight, (traits.efficiency - 0.6) / 0.4, 'Rendement élevé (' + Math.round(traits.efficiency * 100) + ' %).', 'Rendement modeste (' + Math.round(traits.efficiency * 100) + ' %).'); break;
        case 'compact': weigh(weight, traits.compact, 'Très compact.', 'Encombrant.'); break;
        case 'quiet': weigh(weight, traits.quiet, 'Fonctionnement silencieux.', 'Bruyant.'); break;
        case 'cheap': weigh(weight, traits.cost, 'Peu coûteux.', 'Coûteux à réaliser.'); break;
        case 'robust': weigh(weight, traits.robust, 'Tient des couples élevés.', 'Capacité de couple limitée.'); break;
        case 'manufacturable': weigh(weight, traits.printable, 'Géométrie simple à produire.', 'Fabrication délicate.'); break;
        case 'simple': weigh(weight, compactness, null, 'Multiplierait les étages.'); break;
        default: break;
      }
    });

    if (context.process === 'printing3d') {
      weigh(2, traits.printable, 'Se prête bien à l’impression 3D.', 'Difficile à imprimer avec une qualité suffisante.');
    }
    if (traits.spansDistance && context.spanRequired) {
      reasons.push({ level: 'pro', text: 'Franchit une distance entre arbres sans train intermédiaire.' });
    }

    var normalized = total ? score / total : 0.5;
    return {
      id: id, name: traits.name, score: normalized,
      verdict: 'possible',                      // arbitré plus bas, en relatif
      reasons: dedupe(reasons), stagesNeeded: needed
    };
  }

  /** Écart au meilleur en deçà duquel une famille reste « recommandée ». */
  var RECOMMENDATION_MARGIN = 0.08;
  /** Une recommandation qui liste huit familles n'en est plus une. */
  var MAX_RECOMMENDED = 4;

  function round(value) { return Math.round(value * 10) / 10; }

  function dedupe(reasons) {
    var seen = {};
    return reasons.filter(function (reason) {
      if (seen[reason.text]) return false;
      seen[reason.text] = true;
      return true;
    });
  }

  /**
   * Contexte d'évaluation, extrait du besoin et des préférences.
   * Rien n'est deviné : ce qui n'est pas renseigné reste absent.
   */
  function contextFrom(requirement, preferences) {
    var problem = requirement.inferProblem();
    var ratioQuantity = requirement.ratioRequirement();
    var efficiency = preferences && preferences.constraints().filter(function (e) { return e.key === 'efficiency'; })[0];
    var stagesEntry = preferences && preferences.constraints().filter(function (e) { return e.key === 'stages'; })[0];
    return {
      linear: problem.mode === 'rotationTranslation',
      ratio: ratioQuantity.isKnown() ? Math.abs(ratioQuantity.nominal()) : NaN,
      architecture: requirement.architecture,
      process: requirement.fabrication.process,
      maxStages: (stagesEntry && stagesEntry.quantity.bounds().max) || requirement.architecture.maxStages || 4,
      minimumEfficiency: efficiency ? (efficiency.quantity.bounds().min || null) / 100 : null,
      axes: preferences ? preferences.activeAxes().map(function (a) { return a.id; }) : [],
      spanRequired: false
    };
  }

  /**
   * Le conseil complet.
   * @returns {{recommended, possible, excluded, selection, coverage}}
   */
  function advise(requirement, preferences) {
    var context = contextFrom(requirement, preferences);
    var families = context.linear ? ['rack'] : ROTARY;
    var evaluated = families.map(function (id) { return evaluate(id, context); })
      .sort(function (a, b) { return b.score - a.score; });

    // « Recommandé » se juge en RELATIF : les familles qui suivent la meilleure
    // de près, et pas plus de quatre. Un seuil absolu laissait passer tout le
    // catalogue dès que le besoin était facile — le défaut qu'on corrige ici.
    var usable = evaluated.filter(function (e) { return e.verdict !== 'excluded'; });
    var top = usable.length ? usable[0].score : 0;
    usable.forEach(function (entry, rank) {
      entry.verdict = (rank < MAX_RECOMMENDED && entry.score >= top - RECOMMENDATION_MARGIN) ? 'recommended' : 'possible';
    });

    var recommended = evaluated.filter(function (e) { return e.verdict === 'recommended'; });
    var possible = evaluated.filter(function (e) { return e.verdict === 'possible'; });
    var excluded = evaluated.filter(function (e) { return e.verdict === 'excluded'; });

    // Une sélection vide bloquerait la recherche : on retient alors les
    // meilleures candidates restantes plutôt que de renvoyer l'utilisateur
    // vers un formulaire vide.
    var selection = recommended.map(function (e) { return e.id; });
    if (!selection.length) selection = possible.slice(0, 3).map(function (e) { return e.id; });
    if (!selection.length && context.linear) selection = ['rack'];

    return {
      recommended: recommended, possible: possible, excluded: excluded,
      selection: selection, coverage: coverage(context, selection), context: context
    };
  }

  /**
   * Ce que la sélection ne sait PAS faire. C'est l'information qui manquait le
   * plus : une liste de familles ne dit rien tant qu'on ignore si, ensemble,
   * elles répondent à l'architecture demandée.
   */
  function coverage(context, selection) {
    var gaps = [];
    var traits = selection.map(function (id) { return KNOWLEDGE[id]; }).filter(Boolean);
    if (context.architecture.axisAngle === 90 && !traits.some(function (t) { return t.axis === 'perpendicular'; })) {
      gaps.push({ code: 'angle', text: 'Aucune famille retenue ne réalise le renvoi d’angle à 90°.' });
    }
    if (context.architecture.coaxial === 'required' && !traits.some(function (t) { return t.axis === 'coaxial'; })) {
      gaps.push({ code: 'coaxial', text: 'Aucune famille retenue ne donne une sortie coaxiale.' });
    }
    if (context.architecture.selfLocking === 'required' && !traits.some(function (t) { return t.selfLocking; })) {
      gaps.push({ code: 'selflock', text: 'Aucune famille retenue n’est irréversible.' });
    }
    if (isFinite(context.ratio) && context.ratio > 1 && traits.length) {
      var best = Math.min.apply(Math, selection.map(function (id) { return stagesFor(id, context.ratio); }));
      if (best > context.maxStages) gaps.push({ code: 'ratio', text: 'Le rapport demandé dépasse ce que la sélection atteint en ' + context.maxStages + ' étages.' });
    }
    return gaps;
  }

  return { advise: advise, evaluate: evaluate, RECOMMENDATION_MARGIN: RECOMMENDATION_MARGIN, MAX_RECOMMENDED: MAX_RECOMMENDED, contextFrom: contextFrom, stagesFor: stagesFor, KNOWLEDGE: KNOWLEDGE, ROTARY: ROTARY };
});
