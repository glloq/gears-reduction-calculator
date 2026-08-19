/* Placement des étiquettes — dire où poser un texte sans recouvrir le dessin.
 *
 * Les libellés d'étage étaient rangés en deux COULOIRS : les pairs au-dessus du
 * dessin, les impairs en dessous, poussés horizontalement quand deux se
 * gênaient. C'est simple, et cela tient tant que les étages sont rangés côte à
 * côte. Depuis qu'ils s'empilent sur leurs axes réels — quatre planétaires
 * coaxiaux, une chaîne qui change d'axe deux fois —, deux étages peuvent
 * partager la même abscisse : la poussée les met alors bout à bout très loin de
 * ce qu'ils désignent, et la ligne de rappel traverse tout le mécanisme.
 *
 * Un placement se pose autrement. Chaque étiquette a :
 *
 *     une ANCRE       le point qu'elle désigne ;
 *     une PRIORITÉ    ce qu'on sacrifie en dernier ;
 *     une BOÎTE       ce qu'elle occupe ;
 *     le droit ou non à une LIGNE DE RAPPEL.
 *
 * On essaie plusieurs positions autour de l'ancre, de la plus proche à la plus
 * lointaine, et l'on retient la première qui ne heurte rien. Si aucune ne
 * convient, on prend la moins encombrée — et l'on n'abandonne une étiquette que
 * lorsqu'elle est de faible priorité ET qu'il ne reste vraiment aucune place :
 * une étiquette déplacée reste lisible, une étiquette posée sur une autre ne
 * l'est plus, ni l'une ni l'autre.
 *
 * Module pur, sans DOM : les vues lui donnent des boîtes, il rend des places.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearLabelLayout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }

  /**
   * LES DIRECTIONS ESSAYÉES, dans l'ordre.
   *
   * Le haut et le bas d'abord — un dessin de mécanisme est plus large que haut,
   * et c'est là qu'il reste de la place. Puis les côtés, puis les diagonales.
   * `[dx, dy]` est la direction du décalage depuis l'ancre ; `anchor` est
   * l'ancrage du texte qui va avec, pour qu'une étiquette posée à gauche se
   * termine près de sa pièce au lieu d'en partir.
   */
  var DIRECTIONS = [
    { dx: 0, dy: -1, anchor: 'middle' },
    { dx: 0, dy: 1, anchor: 'middle' },
    { dx: 1, dy: 0, anchor: 'start' },
    { dx: -1, dy: 0, anchor: 'end' },
    { dx: 0.7, dy: -0.7, anchor: 'start' },
    { dx: -0.7, dy: -0.7, anchor: 'end' },
    { dx: 0.7, dy: 0.7, anchor: 'start' },
    { dx: -0.7, dy: 0.7, anchor: 'end' }
  ];

  /**
   * Les distances essayées, en multiples de la hauteur de l'étiquette.
   *
   * L'échelle va jusqu'à très loin, et c'est nécessaire : sur un dessin dense —
   * quatre planétaires coaxiaux vus de biais — les pièces couvrent tout, et il
   * faut sortir franchement du mécanisme pour trouver une place propre. Un
   * libellé posé loin avec sa ligne de rappel reste lisible ; posé sur une
   * denture, il ne l'est pas, et il rend la denture illisible avec lui.
   */
  var RINGS = [1.2, 2.1, 3.2, 4.6, 6.4, 8.8, 12, 16];

  function overlap(a, b) {
    var wide = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    var high = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return wide > 0 && high > 0 ? wide * high : 0;
  }

  /** La boîte d'une étiquette posée dans cette direction, à cette distance. */
  function boxAt(label, direction, distance) {
    var reach = label.height * distance;
    var centreX = label.anchor.x + direction.dx * (reach + label.width / 2) *
      (Math.abs(direction.dx) > 0.01 ? 1 : 0);
    var centreY = label.anchor.y + direction.dy * reach;
    // Un décalage purement vertical garde l'étiquette centrée sur son ancre ;
    // un décalage horizontal la pousse de sa demi-largeur, sinon elle
    // chevaucherait la pièce qu'elle désigne.
    if (Math.abs(direction.dx) <= 0.01) centreX = label.anchor.x;
    return { x: centreX - label.width / 2, y: centreY - label.height / 2,
      width: label.width, height: label.height, centreX: centreX, centreY: centreY };
  }

  /**
   * place(labels, options) → où poser chacune.
   *
   * `obstacles` sont les boîtes que rien ne doit recouvrir : les pièces. Les
   * étiquettes déjà posées s'y ajoutent au fur et à mesure — c'est ce qui fait
   * qu'une seconde étiquette évite la première, et non l'inverse.
   *
   * @param {Array} labels {id, anchor:{x,y}, width, height, priority, leader}
   * @param {Object} [options] {obstacles, bounds, minLeader}
   * @returns {Array} {id, x, y, textAnchor, leader, distance, dropped}
   */
  function place(labels, options) {
    var settings = options || {};
    var taken = (settings.obstacles || []).map(function (box) {
      return { x: box.x, y: box.y, width: box.width, height: box.height, solid: true };
    });
    var placed = [];
    // De la plus prioritaire à la moins : la première servie a le choix, et
    // c'est l'ordre qui décide de qui cède la place. Sans lui, l'étiquette
    // posée en premier gagnerait — c'est-à-dire l'ordre du document.
    var queue = (labels || []).map(function (label, index) {
      return { label: label, index: index, priority: finite(label.priority, 5) };
    }).sort(function (a, b) {
      return a.priority - b.priority || a.index - b.index;
    });

    queue.forEach(function (entry) {
      var label = entry.label;
      var best = null;
      for (var r = 0; r < RINGS.length && (!best || best.cost > 0); r++) {
        for (var d = 0; d < DIRECTIONS.length; d++) {
          var box = boxAt(label, DIRECTIONS[d], RINGS[r]);
          var cost = 0;
          taken.forEach(function (other) {
            // Recouvrir une PIÈCE coûte plus cher que recouvrir une étiquette :
            // on peut lire deux textes voisins, pas un texte posé sur une
            // denture.
            cost += overlap(box, other) * (other.solid ? 1.6 : 1);
          });
          // Sortir du cadre coûte, sans être interdit : une étiquette hors
          // champ reste rattrapable par le cadrage, une étiquette illisible non.
          if (settings.bounds) cost += outside(box, settings.bounds) * 0.8;
          if (!best || cost < best.cost) {
            best = { cost: cost, box: box, direction: DIRECTIONS[d], distance: RINGS[r] };
          }
          if (cost === 0) break;
        }
      }
      if (!best) return;
      // Une étiquette de faible priorité qui ne trouve AUCUNE place propre est
      // abandonnée : deux textes superposés n'en font pas un lisible, ils en
      // font zéro. Les prioritaires — entrée, sortie, alerte — restent quoi
      // qu'il arrive.
      // On n'abandonne que si la MEILLEURE place reste franchement encombrée :
      // à un seuil trop bas, un dessin dense fait disparaître tous les
      // libellés d'un coup, ce qui est pire que de les poser un peu loin.
      var crowded = best.cost > label.width * label.height * 0.55;
      if (crowded && entry.priority >= finite(settings.dropAbove, 3)) {
        placed.push({ id: label.id, dropped: true });
        return;
      }
      taken.push({ x: best.box.x, y: best.box.y, width: best.box.width, height: best.box.height, solid: false });
      placed.push({
        id: label.id, dropped: false,
        x: best.box.centreX, y: best.box.centreY,
        textAnchor: best.direction.anchor,
        distance: best.distance,
        // La ligne de rappel n'a de sens que si l'étiquette s'est éloignée :
        // posée juste à côté, elle désigne déjà sans qu'on ait à la relier.
        leader: label.leader === false || best.distance <= RINGS[0] ? null
          : { x1: best.box.centreX, y1: best.box.centreY, x2: label.anchor.x, y2: label.anchor.y }
      });
    });

    // Rendu dans l'ordre d'ENTRÉE : l'appelant a donné ses étiquettes dans un
    // ordre qui lui appartient, et les lui rendre triées par priorité
    // l'obligerait à les retrouver.
    var byId = {};
    placed.forEach(function (item) { byId[item.id] = item; });
    return (labels || []).map(function (label) { return byId[label.id] || { id: label.id, dropped: true }; });
  }

  /** De combien une boîte déborde du cadre, en aire. */
  function outside(box, bounds) {
    var inside = overlap(box, bounds);
    return Math.max(0, box.width * box.height - inside);
  }

  return { place: place, overlap: overlap, DIRECTIONS: DIRECTIONS, RINGS: RINGS };
});
