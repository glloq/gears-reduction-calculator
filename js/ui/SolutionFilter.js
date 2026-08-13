// SolutionFilter.js - Filtrage et tri instantanés du vivier de solutions.
// Module pur (aucun DOM) : testable sous Node, utilisé par SolutionExplorer.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearSolutionFilter = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function minFactor(solution, key) {
    return (solution.mechanical || []).reduce(function (min, stage) {
      var value = stage[key] && stage[key].safetyFactor;
      return Number.isFinite(value) ? Math.min(min, value) : min;
    }, Infinity);
  }

  function volume(solution) {
    var d = solution.dimensions || {};
    return (d.x || 0) * (d.y || 0) * Math.max(1, d.z || 0);
  }

  function stageTypes(solution) {
    return (solution.stages || []).map(function (stage) { return stage.type; });
  }

  /**
   * Bornes observées sur le vivier, pour initialiser les contrôles d'affinage.
   */
  function bounds(pool) {
    var result = {
      maxError: 0, minEfficiency: 1, maxDiameter: 0, maxLength: 0,
      maxStages: 1, minSF: Infinity, minSH: Infinity, types: []
    };
    var seen = {};
    (pool || []).forEach(function (solution) {
      if (Number.isFinite(solution.errorPercent)) result.maxError = Math.max(result.maxError, solution.errorPercent);
      if (Number.isFinite(solution.efficiency)) result.minEfficiency = Math.min(result.minEfficiency, solution.efficiency);
      var d = solution.dimensions || {};
      if (Number.isFinite(d.maxDiameter)) result.maxDiameter = Math.max(result.maxDiameter, d.maxDiameter);
      if (Number.isFinite(d.length)) result.maxLength = Math.max(result.maxLength, d.length);
      result.maxStages = Math.max(result.maxStages, (solution.stages || []).length);
      var sf = minFactor(solution, 'bending'), sh = minFactor(solution, 'contact');
      if (Number.isFinite(sf)) result.minSF = Math.min(result.minSF, sf);
      if (Number.isFinite(sh)) result.minSH = Math.min(result.minSH, sh);
      stageTypes(solution).forEach(function (type) {
        if (!seen[type]) { seen[type] = true; result.types.push(type); }
      });
    });
    return result;
  }

  // Comparateurs de tri. Chacun reçoit des paires {solution, index} ;
  // l'égalité retombe sur l'index d'origine pour un ordre déterministe.
  var comparators = {
    score: function (a, b) { return a.solution.score.value - b.solution.score.value; },
    error: function (a, b) { return a.solution.errorPercent - b.solution.errorPercent; },
    efficiency: function (a, b) { return b.solution.efficiency - a.solution.efficiency; },
    compactness: function (a, b) { return volume(a.solution) - volume(b.solution); },
    sf: function (a, b) {
      var sa = minFactor(a.solution, 'bending'), sb = minFactor(b.solution, 'bending');
      var fa = Number.isFinite(sa), fb = Number.isFinite(sb);
      if (fa && fb) return sb - sa;      // plus haut SF d'abord
      if (fa !== fb) return fa ? -1 : 1; // solutions sans SF en dernier
      return 0;
    },
    stages: function (a, b) {
      return a.solution.stages.length - b.solution.stages.length ||
        a.solution.errorPercent - b.solution.errorPercent;
    }
  };

  /**
   * Applique les critères au vivier. Un critère null/undefined laisse passer.
   * Contrat : renvoie des paires {solution, index} où index est TOUJOURS la
   * position dans le vivier d'origine.
   *
   * criteria = { maxErrorPercent, minEfficiency, minSF, minSH, maxDiameter,
   *              maxLength, maxStages, types: string[]|null, sort }
   * Note SF/SH : quand le critère est actif, les solutions sans facteur évalué
   * (courroie, chaîne, vis sans fin…) sont EXCLUES — cohérent avec la
   * sémantique UNSUPPORTED_* du moteur.
   */
  function apply(pool, criteria) {
    criteria = criteria || {};
    var view = (pool || []).map(function (solution, index) {
      return { solution: solution, index: index };
    }).filter(function (item) {
      var s = item.solution, d = s.dimensions || {};
      if (criteria.maxErrorPercent != null && !(s.errorPercent <= criteria.maxErrorPercent)) return false;
      if (criteria.minEfficiency != null && !(s.efficiency >= criteria.minEfficiency)) return false;
      if (criteria.maxDiameter != null && !(d.maxDiameter <= criteria.maxDiameter)) return false;
      if (criteria.maxLength != null && !(d.length <= criteria.maxLength)) return false;
      if (criteria.maxStages != null && !((s.stages || []).length <= criteria.maxStages)) return false;
      if (criteria.minSF != null) {
        var sf = minFactor(s, 'bending');
        if (!Number.isFinite(sf) || sf < criteria.minSF) return false;
      }
      if (criteria.minSH != null) {
        var sh = minFactor(s, 'contact');
        if (!Number.isFinite(sh) || sh < criteria.minSH) return false;
      }
      if (criteria.types && criteria.types.length) {
        var allowed = criteria.types;
        var ok = stageTypes(s).every(function (type) { return allowed.indexOf(type) !== -1; });
        if (!ok) return false;
      }
      return true;
    });

    var comparator = comparators[criteria.sort] || comparators.score;
    view.sort(function (a, b) { return comparator(a, b) || a.index - b.index; });
    return view;
  }

  return { bounds: bounds, apply: apply, comparators: comparators, minFactor: minFactor };
});
