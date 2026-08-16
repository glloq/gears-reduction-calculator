// ResultRecommendations.js - Aider à CHOISIR, pas seulement à lire des chiffres.
//
// Les badges sont dérivés du vivier déjà calculé : aucun nouveau parcours du
// moteur, aucune analyse Pareto. Une même solution peut porter plusieurs badges
// — c'est même le signal le plus utile : « la plus compacte est aussi la
// recommandée » vaut mieux que quatre cartes identiques.
//
// Module pur (aucun DOM) : testable sous Node.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearResultRecommendations = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function finite(value) { return Number.isFinite(value) ? value : null; }

  function minSafety(solution, key) {
    return (solution.mechanical || []).reduce(function (min, stage) {
      var value = stage[key] && stage[key].safetyFactor;
      return Number.isFinite(value) ? Math.min(min, value) : min;
    }, Infinity);
  }

  function volume(solution) {
    var d = solution.dimensions || {};
    return (d.x || 0) * (d.y || 0) * Math.max(1, d.z || 0);
  }

  /** Simplicité de fabrication : peu d'étages, pas de famille exotique. */
  var HARD_TO_MAKE = { worm: 2, planetary: 2, epicyclic: 2, bevel: 1.5, internal: 1.5 };
  function manufacturingCost(solution) {
    return (solution.stages || []).reduce(function (total, stage) {
      return total + (HARD_TO_MAKE[stage.type] || 1);
    }, 0);
  }

  // Chaque badge : un critère, une direction, une phrase qui l'explique.
  var BADGES = [
    { id: 'recommended', label: 'Recommandée', primary: true,
      value: function (s) { return s.score && Number.isFinite(s.score.value) ? s.score.value : Infinity; },
      reason: 'Meilleur compromis selon la priorité choisie.' },
    { id: 'compact', label: 'Plus compacte',
      value: function (s) { return volume(s) || Infinity; },
      reason: 'Encombrement calculé le plus faible du vivier.' },
    { id: 'efficient', label: 'Plus efficace',
      value: function (s) { return Number.isFinite(s.efficiency) ? -s.efficiency : Infinity; },
      reason: 'Meilleur rendement global de la chaîne.' },
    { id: 'simple', label: 'Plus simple à fabriquer',
      value: function (s) { return manufacturingCost(s) || Infinity; },
      reason: 'Le moins d’étages et les familles les plus courantes.' },
    { id: 'robust', label: 'Plus robuste',
      value: function (s) {
        var sf = minSafety(s, 'bending');
        return Number.isFinite(sf) ? -sf : Infinity;   // sans SF évalué : jamais « robuste »
      },
      reason: 'Marge de sécurité en flexion la plus élevée.' }
  ];

  /**
   * annotate(pool) → { badges: {uid|index → [badgeId]}, best: {badgeId → index} }
   * L'index renvoyé est TOUJOURS la position dans le vivier reçu : c'est le
   * contrat de sélection utilisé partout dans l'application.
   */
  function annotate(pool) {
    pool = pool || [];
    var best = {}, byIndex = {};
    if (!pool.length) return { best: best, byIndex: byIndex, order: [] };

    BADGES.forEach(function (badge) {
      var bestIndex = -1, bestValue = Infinity;
      pool.forEach(function (solution, index) {
        var value = badge.value(solution);
        if (!Number.isFinite(value)) return;
        // L'égalité retombe sur l'ordre du vivier : résultat déterministe.
        if (value < bestValue) { bestValue = value; bestIndex = index; }
      });
      if (bestIndex >= 0) best[badge.id] = bestIndex;
    });

    Object.keys(best).forEach(function (id) {
      var index = best[id];
      (byIndex[index] = byIndex[index] || []).push(id);
    });

    // Ordre d'affichage : la recommandée d'abord, puis les alternatives
    // réellement différentes — une solution n'apparaît jamais deux fois.
    var order = [], seen = {};
    BADGES.forEach(function (badge) {
      var index = best[badge.id];
      if (index === undefined || seen[index]) return;
      seen[index] = true;
      order.push(index);
    });

    return { best: best, byIndex: byIndex, order: order };
  }

  function badge(id) {
    for (var i = 0; i < BADGES.length; i++) if (BADGES[i].id === id) return BADGES[i];
    return null;
  }

  /**
   * Phrase de justification d'une solution : pourquoi la propose-t-on ?
   * S'appuie sur ses badges, puis sur ses caractéristiques mesurées.
   */
  function explain(solution, badgeIds) {
    var reasons = (badgeIds || []).map(function (id) {
      var entry = badge(id);
      return entry ? entry.reason : null;
    }).filter(Boolean);
    if (reasons.length) return reasons[0];

    var bits = [];
    var error = finite(solution.errorPercent);
    if (error !== null) bits.push(error < 0.5 ? 'très proche de la cible' : 'écart de ' + error.toFixed(1) + ' % à la cible');
    var efficiency = finite(solution.efficiency);
    if (efficiency !== null) bits.push('rendement ' + (efficiency * 100).toFixed(0) + ' %');
    var stages = (solution.stages || []).length;
    if (stages) bits.push(stages + ' étage' + (stages > 1 ? 's' : ''));
    return bits.length ? bits.join(', ').replace(/^./, function (c) { return c.toUpperCase(); }) + '.' : '';
  }

  return { annotate: annotate, explain: explain, BADGES: BADGES, badge: badge,
    minSafety: minSafety, volume: volume, manufacturingCost: manufacturingCost };
});
