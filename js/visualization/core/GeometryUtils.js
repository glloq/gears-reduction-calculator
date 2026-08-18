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
      centre1: { x: c1.x, y: c1.y }, centre2: { x: c2.x, y: c2.y }, radius1: r1, radius2: r2,
      wrapAngle1: wrap1, wrapAngle2: wrap2, length: 2 * span + r1 * wrap1 + r2 * wrap2 };
  }

  /**
   * Découpage cinématique du circuit fermé, dans l'ordre du défilement :
   *   brin 1 → arc sur la poulie 2 → brin 2 → arc sur la poulie 1.
   * C'est ce découpage — et non les seuls brins droits — qui donne l'abscisse
   * curviligne réelle : un maillon de chaîne contourne les pignons, il ne
   * « saute » pas d'un brin à l'autre.
   */
  function segments(path) {
    if (path._segments) return path._segments;
    var t = path.tangents;
    if (!t || t.length !== 2 || !(path.spanLength > 0)) return null;
    function angleOf(centre, point) { return Math.atan2(point.y - centre.y, point.x - centre.x); }
    // Sens de parcours : celui qui mène du brin 1 au brin 2 en tournant du côté
    // enroulé, donc en couvrant exactement l'angle d'enroulement calculé.
    function arc(centre, radius, from, to, wrap) {
      var start = angleOf(centre, from), end = angleOf(centre, to);
      var delta = end - start;
      while (delta <= 0) delta += 2 * Math.PI;
      var direction = 1;
      if (Math.abs(delta - wrap) > Math.abs((delta - 2 * Math.PI) + wrap)) { delta = delta - 2 * Math.PI; direction = -1; }
      return { kind: 'arc', centre: centre, radius: radius, start: start, delta: delta,
        length: Math.abs(delta) * radius, direction: direction };
    }
    function line(from, to) {
      return { kind: 'line', from: from, to: to, length: Math.hypot(to.x - from.x, to.y - from.y) };
    }
    var list = [
      line(t[0].from, t[0].to),
      arc(path.centre2, path.radius2, t[0].to, t[1].to, path.wrapAngle2),
      line(t[1].to, t[1].from),
      arc(path.centre1, path.radius1, t[1].from, t[0].from, path.wrapAngle1)
    ];
    var total = list.reduce(function (sum, segment) { return sum + segment.length; }, 0);
    path._segments = { list: list, total: total };
    return path._segments;
  }

  /**
   * Position d'un point à l'abscisse curviligne `s` le long du circuit COMPLET,
   * arcs d'enroulement compris. `s = path.length` ramène au point de départ.
   */
  function pointAlong(path, s) {
    var parts = segments(path);
    if (!parts || !(parts.total > 0)) return null;
    var u = ((s % parts.total) + parts.total) % parts.total;
    for (var i = 0; i < parts.list.length; i++) {
      var segment = parts.list[i];
      if (u > segment.length && i < parts.list.length - 1) { u -= segment.length; continue; }
      var local = segment.length > 0 ? Math.min(1, u / segment.length) : 0;
      if (segment.kind === 'line') {
        return { x: segment.from.x + (segment.to.x - segment.from.x) * local,
          y: segment.from.y + (segment.to.y - segment.from.y) * local };
      }
      var angle = segment.start + segment.delta * local;
      return { x: segment.centre.x + segment.radius * Math.cos(angle),
        y: segment.centre.y + segment.radius * Math.sin(angle) };
    }
    return null;
  }

  return { flexiblePath: flexiblePath, pointAlong: pointAlong, segments: segments };
});
