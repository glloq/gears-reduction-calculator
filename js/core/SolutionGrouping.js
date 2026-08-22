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

  // ===== FAMILLE ET CONFIGURATION SONT DEUX CHOSES =====
  //
  // On regroupait sur la seule suite des TYPES. « Épicycloïdal » réunissait
  // donc, dans une même ligne, un train solaire-entrée / couronne-fixe /
  // porte-satellites-sortie et un porte-satellites-entrée / solaire-fixe /
  // couronne-sortie : mêmes dentures, rapports différents, parfois de signe
  // opposé. Ce ne sont pas deux variantes l'une de l'autre, ce sont deux
  // mécanismes. Même chose pour une courroie ouverte et une courroie croisée —
  // qui tournent en sens inverse — et pour deux renvois coniques d'angles
  // différents.
  //
  // Deux niveaux, donc : la FAMILLE dit de quoi c'est fait, la CONFIGURATION
  // dit comment c'est monté. On regroupe sur la seconde.

  function familySignature(stage) {
    var type = stage && stage.type;
    return type === 'epicyclic' ? 'planetary' : String(type || '?');
  }

  /** Ce qui, à famille égale, fait un AUTRE mécanisme. */
  function configurationSignature(stage) {
    var family = familySignature(stage);
    if (!stage) return family;
    // Une signature ne s'invente pas : quand ce qui distinguerait deux montages
    // n'est pas renseigné, on s'en tient à la famille. Un « ? » dans la clé
    // séparerait des solutions sur une ABSENCE d'information.
    if (family === 'planetary') {
      // Qui mène, qui est tenu, qui sort : c'est cela le mécanisme.
      if (!stage.inputMember && !stage.fixed && !stage.outputMember) return family;
      return family + ':' + [stage.inputMember || '?', stage.fixed || '?', stage.outputMember || '?'].join('');
    }
    if (family === 'belt') {
      // Croisée, la poulie menée tourne à l'envers : ce n'est pas une variante.
      var crossed = stage.crossed || (stage.parameters && stage.parameters.crossed);
      // Ouverte est le montage par défaut : seule la courroie CROISÉE se
      // distingue, sans quoi toute courroie ordinaire changerait de clé.
      return crossed ? family + ':croisee' : family;
    }
    if (family === 'bevel') {
      // Un renvoi à 45° et un renvoi à 90° n'occupent pas le même volume et ne
      // se montent pas de la même façon.
      var angle = (stage.parameters && stage.parameters.shaftAngle) ||
        (stage.geometry && stage.geometry.shaftAngleDeg);
      // 90° est le renvoi par défaut : il garde la clé de sa famille, et seuls
      // les autres angles s'en détachent.
      if (!Number.isFinite(angle) || Math.round(angle) === 90) return family;
      return family + ':' + Math.round(angle) + '°';
    }
    if (family === 'worm') {
      // Ce qui change le MÉCANISME, c'est l'irréversibilité : une vis à un
      // seul filet ne se laisse pas entraîner par sa roue, les autres si. Le
      // nombre exact de filets, lui, est un réglage de rapport comme un nombre
      // de dents — le prendre dans la signature éclaterait en six groupes ce
      // que le regroupement est justement là pour réunir.
      return stage.wormStarts === 1 ? family + ':1f' : family;
    }
    // Le sens d'hélice reste une variante : il change la poussée axiale, pas la
    // façon dont le mécanisme est monté ni ce qu'il rend. Le distinguer ici
    // doublerait chaque groupe hélicoïdal sans répondre à une question posée.
    return family;
  }

  /** La signature de configuration d'une solution entière. */
  function configuration(solution) {
    return ((solution && solution.stages) || []).map(configurationSignature);
  }

  /** Ce qu'on écrit à côté du nom de famille, quand la configuration le mérite. */
  function describe(stage, memberName) {
    var family = familySignature(stage);
    var name = memberName || function (code) { return code; };
    if (family === 'planetary') {
      var roles = [];
      if (stage.inputMember) roles.push(name(stage.inputMember) + ' entrée');
      if (stage.fixed) roles.push(name(stage.fixed) + ' fixe');
      if (stage.outputMember) roles.push(name(stage.outputMember) + ' sortie');
      return roles.join(' · ');
    }
    if (family === 'belt') {
      return (stage.crossed || (stage.parameters && stage.parameters.crossed)) ? 'croisée' : '';
    }
    if (family === 'bevel') {
      var angle = (stage.parameters && stage.parameters.shaftAngle) ||
        (stage.geometry && stage.geometry.shaftAngleDeg);
      return Number.isFinite(angle) && Math.round(angle) !== 90 ? Math.round(angle) + '°' : '';
    }
    if (family === 'worm') return stage.wormStarts === 1 ? 'irréversible' : '';
    return '';
  }

  /** La description d'une solution entière, étage par étage. */
  function describeAll(solution, memberName) {
    return ((solution && solution.stages) || []).map(function (stage) {
      return describe(stage, memberName);
    }).filter(Boolean).join(' · ');
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
      // La clé est la CONFIGURATION, pas la seule suite des familles.
      var key = configuration(solution).join('>');
      if (!byKey[key]) {
        byKey[key] = { key: key, types: types, family: types.join('>'),
          configuration: configuration(solution), members: [], count: 0, best: null, bestIndex: -1 };
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
  function keyOf(solution) { return configuration(solution).join('>'); }

  /** La seule suite des familles — pour un regroupement plus grossier. */
  function familyKeyOf(solution) { return architecture(solution).join('>'); }

  return { group: group, architecture: architecture, configuration: configuration,
    configurationSignature: configurationSignature, familySignature: familySignature,
    describe: describe, describeAll: describeAll,
    keyOf: keyOf, familyKeyOf: familyKeyOf, spreadOf: spreadOf, costOf: costOf };
});
