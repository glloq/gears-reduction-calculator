/* Tracés de construction de la vue « Denture ».
 *
 * Ils n'apparaissent qu'au niveau de détail le plus fin (roue assez grande à
 * l'écran) : cercles primitif / de base / pied / tête, ligne d'action et point
 * de contact. Comme les primitives, tout est produit sous forme de descripteurs
 * {tag, attrs, text} : aucune dépendance au DOM.
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./TeethPrimitives.js') : root.GearTeethPrimitives);
  if (common) module.exports = api; else root.GearTeethOverlay = api;
})(typeof self !== 'undefined' ? self : this, function (Primitives) {
  'use strict';

  var LEVELS = Primitives.LEVELS;
  var MESHING = { spur: 1, helical: 1, internal: 1 };

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fixed(value, digits) { return finite(value, 0).toFixed(digits == null ? 2 : digits); }
  function node(tag, attrs, text) { return { tag: tag, attrs: attrs, text: text }; }

  /**
   * circles(wheel, lod) — repères concentriques, exprimés dans le repère de la
   * roue. Le primitif apparaît dès le niveau 2, le reste au niveau 3.
   */
  function circles(wheel, lod) {
    lod = finite(lod, LEVELS.INVOLUTE);
    if (lod < LEVELS.INVOLUTE || !wheel) return [];
    var r = Primitives.radii(wheel);
    var shapes = [];
    if (wheel.kind !== 'worm' && wheel.kind !== 'rack' && wheel.kind !== 'cone') {
      shapes.push(node('circle', { class: 'pitch-circle', r: fixed(r.pitch) }));
    }
    if (lod < LEVELS.TECHNICAL || wheel.kind === 'rack' || wheel.kind === 'worm' || wheel.kind === 'cone') return shapes;
    if (r.base > 0 && r.base < r.tip) shapes.push(node('circle', { class: 'base-circle', r: fixed(r.base) }));
    if (wheel.kind === 'gear') {
      shapes.push(node('circle', { class: 'root-circle', r: fixed(r.root) }));
      shapes.push(node('circle', { class: 'tip-circle', r: fixed(r.tip) }));
    }
    return shapes;
  }

  /**
   * Point primitif d'un engrènement : à r1 du centre menant, sur la ligne des
   * centres. En denture intérieure il est du côté opposé à la couronne.
   */
  function pitchPoint(a, b, internal) {
    var dx = b.cx - a.cx, dy = b.cy - a.cy;
    var distance = Math.hypot(dx, dy);
    if (!distance) return null;
    var ux = dx / distance, uy = dy / distance;
    var r1 = finite(a.pitchD, 0) / 2;
    var sign = internal ? -1 : 1;
    return { x: a.cx + sign * ux * r1, y: a.cy + sign * uy * r1, ux: ux, uy: uy, distance: distance };
  }

  /**
   * mesh(entry, lod) — ligne d'action inclinée de l'angle de pression sur la
   * tangente commune, et point de contact. Coordonnées absolues de l'étage.
   */
  function mesh(entry, lod) {
    if (finite(lod, 0) < LEVELS.TECHNICAL || !entry || !MESHING[entry.type]) return [];
    var a = entry.wheels && entry.wheels[0], b = entry.wheels && entry.wheels[1];
    if (!a || !b) return [];
    var point = pitchPoint(a, b, entry.type === 'internal');
    if (!point) return [];
    var alpha = finite(a.pressureAngle, 20) * Math.PI / 180;
    // Tangente commune = ligne des centres tournée de 90°, puis inclinée de α.
    var angle = Math.atan2(point.uy, point.ux) + Math.PI / 2 - alpha;
    var span = Math.max(finite(a.pitchD, 20), finite(b.pitchD, 20)) * 0.5;
    var dx = Math.cos(angle) * span, dy = Math.sin(angle) * span;
    return [
      node('path', { class: 'line-of-action',
        d: 'M ' + fixed(point.x - dx) + ' ' + fixed(point.y - dy) + ' L ' + fixed(point.x + dx) + ' ' + fixed(point.y + dy) }),
      node('circle', { class: 'contact-point', cx: fixed(point.x), cy: fixed(point.y),
        r: fixed(Math.max(0.5, finite(a.module, 1) * 0.45)) }),
      node('title', {}, 'Point primitif — angle de pression ' + fixed(finite(a.pressureAngle, 20), 1) + '°')
    ];
  }

  return { circles: circles, mesh: mesh, pitchPoint: pitchPoint, MESHING: MESHING };
});
