/* Géométrie exacte des liaisons flexibles (courroie, chaîne).
 * Les tangentes, les arcs d'enroulement et la longueur développée sont calculés,
 * jamais approximés par un simple segment sommet-à-sommet.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearGeometryUtils = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * flexiblePath(c1, c2, r1, r2, crossed) → tangentes exactes + enroulements.
   * Courroie ouverte : tangentes extérieures, sens conservé.
   * Courroie croisée : tangentes intérieures, sens inversé.
   */
  function flexiblePath(c1, c2, r1, r2, crossed) {
    var dx = c2.x - c1.x, dy = c2.y - c1.y, distance = Math.hypot(dx, dy);
    if (!(distance > 0)) throw new RangeError('Distinct centres required');
    var ratio = (crossed ? r1 + r2 : r1 - r2) / distance;
    if (Math.abs(ratio) >= 1) throw new RangeError('Pulley geometry has no tangent');
    var base = Math.atan2(dy, dx), alpha = Math.acos(ratio), sign2 = crossed ? -1 : 1;
    var tangents = [-1, 1].map(function (side) {
      var a = base + side * alpha;
      return { from: { x: c1.x + r1 * Math.cos(a), y: c1.y + r1 * Math.sin(a) },
        to: { x: c2.x + sign2 * r2 * Math.cos(a), y: c2.y + sign2 * r2 * Math.sin(a) } };
    });
    var span = Math.hypot(tangents[0].to.x - tangents[0].from.x, tangents[0].to.y - tangents[0].from.y);
    // Enroulements : croisée, les deux poulies enroulent le même angle ;
    // ouverte, la petite poulie enroule moins que π et la grande davantage.
    var wrap1 = crossed
      ? Math.PI + 2 * Math.asin(Math.min(1, (r1 + r2) / distance))
      : Math.PI + 2 * Math.asin(Math.max(-1, Math.min(1, (r1 - r2) / distance)));
    var wrap2 = crossed ? wrap1 : 2 * Math.PI - wrap1;
    return { distance: distance, crossed: !!crossed, tangents: tangents, spanLength: span,
      wrapAngle1: wrap1, wrapAngle2: wrap2, length: 2 * span + r1 * wrap1 + r2 * wrap2 };
  }

  /**
   * Chemin fermé de la courroie : deux brins droits reliés par les arcs
   * d'enroulement. C'est ce tracé que parcourent les marqueurs animés.
   */
  function flexibleOutline(path, r1, r2) {
    var t = path.tangents;
    if (!t || t.length !== 2) return '';
    function arc(radius, to, sweep) {
      return ' A ' + radius.toFixed(3) + ' ' + radius.toFixed(3) + ' 0 ' + (path.crossed ? 1 : 0) + ' ' + sweep +
        ' ' + to.x.toFixed(3) + ' ' + to.y.toFixed(3);
    }
    return 'M ' + t[0].from.x.toFixed(3) + ' ' + t[0].from.y.toFixed(3) +
      ' L ' + t[0].to.x.toFixed(3) + ' ' + t[0].to.y.toFixed(3) +
      arc(r2, t[1].to, path.crossed ? 0 : 1) +
      ' L ' + t[1].from.x.toFixed(3) + ' ' + t[1].from.y.toFixed(3) +
      arc(r1, t[0].from, path.crossed ? 0 : 1) + ' Z';
  }

  /** Position d'un point à l'abscisse curviligne `s` le long des deux brins. */
  function pointAlong(path, s) {
    var t = path.tangents, total = 2 * path.spanLength;
    if (!t || !(total > 0)) return null;
    var u = ((s % total) + total) % total;
    var strand = u < path.spanLength ? t[0] : t[1];
    var local = (u < path.spanLength ? u : u - path.spanLength) / path.spanLength;
    var from = u < path.spanLength ? strand.from : strand.to;
    var to = u < path.spanLength ? strand.to : strand.from;
    return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
  }

  return { flexiblePath: flexiblePath, flexibleOutline: flexibleOutline, pointAlong: pointAlong };
});
