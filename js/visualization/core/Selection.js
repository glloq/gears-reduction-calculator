/* Sélection — ce que l'on désigne, dit une seule fois pour toute l'application.
 *
 * Le dessin ne savait désigner qu'un ÉTAGE. C'est la bonne maille pour lire un
 * rapport, et la mauvaise pour à peu près tout le reste : cliquer une roue
 * répondait « étage 2 » quand la question était « quelle roue ? », et il n'y
 * avait aucun moyen de désigner un arbre — l'objet dont on veut justement
 * savoir ce qu'il porte et à quelle vitesse il tourne.
 *
 * Plutôt que d'ajouter `selectedMember`, `selectedShaft`, `selectedMesh` à
 * côté de `selectedStage` dans chaque module — quatre états à synchroniser,
 * donc quatre occasions de diverger —, il n'y a qu'UNE sélection :
 *
 *     { type: 'stage' | 'member' | 'shaft' | 'mesh' | null, id, stageIndex }
 *
 * `null` est une valeur, pas une absence : c'est « l'ensemble », ce qu'on
 * désigne en cliquant le vide.
 *
 * Module pur, sans DOM : les vues lui apportent ce qu'elles ont trouvé, il
 * tranche. C'est ce qui permet de tester la règle de priorité sans navigateur.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearSelection = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Les types, du plus précis au plus large. L'ordre EST la règle de priorité. */
  var TYPES = ['mesh', 'member', 'shaft', 'stage'];

  /**
   * Les attributs de données qui portent chaque type dans le dessin. Un seul
   * endroit les nomme : ajouter un type ailleurs sans le déclarer ici serait
   * un type que la sélection ne saurait pas relire.
   */
  var ATTRIBUTES = { mesh: 'mesh', member: 'member', shaft: 'shaft', stage: 'stage' };

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }

  /**
   * Une sélection normalisée. `stageIndex` est l'étage AUQUEL APPARTIENT ce
   * qu'on désigne : un membre en a un, un arbre n'en a pas forcément — il en
   * traverse plusieurs, et c'est précisément ce qui le rend intéressant.
   */
  function of(type, id, extra) {
    if (!type || TYPES.indexOf(type) < 0) return none();
    var settings = extra || {};
    var stageIndex = finite(Number(settings.stageIndex), null);
    return { type: type, id: String(id),
      stageIndex: stageIndex === null || stageIndex < 0 ? null : stageIndex,
      // Un organe dessiné plusieurs fois — les satellites d'un planétaire —
      // porte son numéro d'exemplaire : sans lui, cinq pièces se répondraient
      // toutes en même temps.
      instance: finite(Number(settings.instance), null) };
  }

  /** L'ENSEMBLE : ce qu'on désigne en cliquant à côté. */
  function none() { return { type: null, id: null, stageIndex: null, instance: null }; }

  /** Deux sélections désignent-elles la même chose ? */
  function same(a, b) {
    var left = a || none(), right = b || none();
    return left.type === right.type && left.id === right.id && left.instance === right.instance;
  }

  /**
   * TRANCHER entre ce que le dessin a trouvé sous le curseur.
   *
   * Une roue vit dans un groupe d'étage, sur un arbre : cliquer dessus trouve
   * les trois. C'est le plus PRÉCIS qui gagne — on a cliqué la roue, pas la
   * région où elle se trouve. Sans cette règle, tout clic répondrait « étage »,
   * puisque l'étage englobe tout le reste.
   *
   * @param {Object} found  ce que la vue a relevé : {mesh, member, shaft, stage, instance}
   * @param {Object} [options] `only` restreint aux types acceptés par la vue
   */
  function resolve(found, options) {
    if (!found) return none();
    var allowed = options && options.only ? options.only : TYPES;
    for (var i = 0; i < TYPES.length; i++) {
      var type = TYPES[i];
      if (allowed.indexOf(type) < 0) continue;
      var value = found[ATTRIBUTES[type]];
      if (value == null || value === '') continue;
      return of(type, value, { stageIndex: found.stage, instance: found.instance });
    }
    return none();
  }

  /**
   * L'ÉTAGE concerné par une sélection, ou −1.
   *
   * Les commandes qui ne connaissent qu'un étage — cadrer, éditer, la
   * navigation d'étages — continuent de fonctionner : désigner une roue, c'est
   * aussi désigner l'étage où elle se trouve. Un arbre, lui, peut n'en
   * désigner aucun : il en traverse plusieurs.
   */
  function stageOf(selection) {
    var current = selection || none();
    if (current.type === 'stage') return Number(current.id);
    return current.stageIndex == null ? -1 : current.stageIndex;
  }

  /** Ce que la sélection désigne, en toutes lettres. */
  var NAMES = { stage: 'Étage', member: 'Organe', shaft: 'Arbre', mesh: 'Engrènement' };
  function describe(selection) {
    var current = selection || none();
    if (!current.type) return 'Ensemble';
    return NAMES[current.type] || current.type;
  }

  return { TYPES: TYPES, ATTRIBUTES: ATTRIBUTES, NAMES: NAMES,
    of: of, none: none, same: same, resolve: resolve, stageOf: stageOf, describe: describe };
});
