/* Regroupement des solutions par ARCHITECTURE.
 *
 * Une recherche rend couramment quatre-vingts solutions dont soixante sont
 * « Droit → Droit » à quelques dents près. Affichées à la suite, elles
 * remplissent trois pages sans rien apprendre : ce qui distingue vraiment deux
 * lignes, ce n'est pas Z20/60 contre Z18/54, c'est le fait de passer d'un train
 * droit à une vis sans fin, ou d'ajouter un étage.
 *
 * On regroupe donc par SUITE DE FAMILLES — la seule chose qui change la nature
 * du mécanisme — et l'on montre la meilleure de chaque groupe, avec le nombre
 * de variantes qui l'accompagnent. Le vivier n'est ni filtré ni trié
 * autrement : un groupe garde toutes ses solutions, et les déplier les rend
 * telles quelles.
 *
 * Module pur : aucun DOM, aucun tri d'affichage. Il répond « voici les familles
 * de solutions », la vue décide de ce qu'elle en montre.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.GearSolutionGrouping = api;
    if (root.GearApp && root.GearApp.core) root.GearApp.core.SolutionGrouping = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }

  /** La suite des familles d'une solution : son architecture. */
  function architecture(solution) {
    return ((solution && solution.stages) || []).map(function (stage) { return stage.type; });
  }

  /**
   * Le COÛT d'une solution, tel que le moteur l'a établi.
   *
   * Il sert à élire la meilleure de chaque groupe. On ne le recalcule pas : le
   * classement du vivier et celui des groupes doivent dire la même chose, sans
   * quoi la « meilleure » d'un groupe pourrait ne pas être celle que la liste
   * complète met en tête.
   */
  function costOf(solution) {
    var score = solution && solution.score;
    return finite(score && score.value, Infinity);
  }

  /**
   * group(solutions, options) → un groupe par architecture.
   *
   * Chaque groupe porte sa meilleure solution, ses variantes, et l'ÉTENDUE de
   * ce qui les sépare : c'est elle qui dit s'il vaut la peine de déplier. Vingt
   * six variantes qui tiennent toutes dans 0,02 % d'écart ne demandent pas
   * d'être lues une à une ; deux qui vont de 85 à 94 % de rendement, si.
   *
   * @param {Array} solutions le vivier, dans son ordre
   * @param {Object} [options] `indices` donne la position d'origine de chacune
   * @returns {Array} groupes, du meilleur au moins bon
   */
  function group(solutions, options) {
    var list = solutions || [];
    var indices = (options && options.indices) || null;
    var byKey = {};
    var order = [];
    list.forEach(function (solution, i) {
      var types = architecture(solution);
      var key = types.join('>');
      if (!byKey[key]) {
        byKey[key] = { key: key, types: types, members: [], count: 0, best: null, bestIndex: -1 };
        order.push(byKey[key]);
      }
      var entry = byKey[key];
      var index = indices ? indices[i] : i;
      entry.members.push({ solution: solution, index: index });
      entry.count++;
      if (!entry.best || costOf(solution) < costOf(entry.best)) {
        entry.best = solution;
        entry.bestIndex = index;
      }
    });
    order.forEach(function (entry) {
      // Du meilleur au moins bon À L'INTÉRIEUR du groupe : déplier doit donner
      // la même hiérarchie que la liste complète, sinon la deuxième ligne d'un
      // groupe ne voudrait rien dire.
      entry.members.sort(function (a, b) { return costOf(a.solution) - costOf(b.solution); });
      entry.spread = spreadOf(entry.members.map(function (item) { return item.solution; }));
    });
    // Les groupes suivent leur meilleure : c'est la seule mise en ordre qui ne
    // contredise pas la liste complète.
    return order.sort(function (a, b) { return costOf(a.best) - costOf(b.best); });
  }

  /**
   * CE QUI SÉPARE les variantes d'un groupe.
   *
   * Trois grandeurs suffisent à dire s'il vaut la peine de les lire une à une :
   * l'écart au rapport visé, le rendement et l'encombrement. Une seule
   * variante n'a pas d'étendue — c'est `null`, et non zéro, parce qu'il n'y a
   * rien à comparer.
   */
  var MEASURES = {
    error: function (solution) { return Math.abs(finite(solution.errorPercent, NaN)); },
    efficiency: function (solution) { return finite(solution.efficiency, NaN); },
    diameter: function (solution) {
      return finite(solution.dimensions && solution.dimensions.maxDiameter, NaN);
    }
  };
  function spreadOf(solutions) {
    if (!solutions || solutions.length < 2) return null;
    var spread = {};
    Object.keys(MEASURES).forEach(function (name) {
      var values = solutions.map(MEASURES[name]).filter(function (value) { return Number.isFinite(value); });
      if (!values.length) { spread[name] = null; return; }
      var low = Math.min.apply(null, values), high = Math.max.apply(null, values);
      spread[name] = { min: low, max: high, span: high - low };
    });
    return spread;
  }

  /**
   * Le groupe auquel appartient une solution — pour retrouver sa famille quand
   * on l'a choisie ailleurs, et déplier celle-là plutôt qu'une autre.
   */
  function keyOf(solution) { return architecture(solution).join('>'); }

  return { group: group, architecture: architecture, keyOf: keyOf, spreadOf: spreadOf, costOf: costOf };
});
