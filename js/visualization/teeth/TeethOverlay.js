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
   * surfaces(wheel, lod, options) — les surfaces de construction d'une roue,
   * TELLES QU'ON LES VOIT.
   *
   * Elles étaient toujours tracées en `<circle>`. Un cercle porté par un axe
   * qui ne pointe pas vers l'œil ne se voit pas comme un cercle : c'est ce qui
   * mettait, autour d'une roue elliptique en iso, trois cercles fantômes qui
   * n'appartenaient à aucune pièce. Elles suivent maintenant la MÊME ellipse
   * apparente que le corps — celle que ProjectedScene a calculée pour l'axe.
   *
   *   face      cercles
   *   oblique   ellipses (repère local : voir le contrat de TeethPrimitives)
   *   profile   génératrices — deux droites parallèles à l'axe
   *
   * Le primitif apparaît dès le niveau 2, le reste au niveau 3.
   */
  function surfaces(wheel, lod, options) {
    lod = finite(lod, LEVELS.INVOLUTE);
    if (!wheel) return [];
    options = options || {};
    var presentation = options.presentation || wheel.presentation || 'face';
    // Par la tranche, la surface primitive est le seul trait qui distingue une
    // roue d'un simple cylindre : elle apparaît donc dès que la silhouette est
    // dessinée, comme le corps le faisait avant que les surfaces ne soient
    // rassemblées ici. De face ou de biais, le contour suffit d'abord.
    if (lod < (presentation === 'profile' ? LEVELS.SIMPLIFIED : LEVELS.INVOLUTE)) return [];
    var apparent = options.apparent || wheel.apparent || null;
    var r = Primitives.radii(wheel);
    var shapes = [];
    var flat = presentation === 'profile';
    var span = flat ? Primitives.faceWidthOf(wheel, r) : 0;

    // Vue par la tranche, une surface de révolution n'a plus de contour fermé :
    // il en reste ses deux génératrices, à ±R de l'axe. Le contour de tête est
    // alors la silhouette elle-même, et un cercle de base n'a plus d'arête
    // visible : les tracer doublerait le dessin au lieu de l'informer.
    function generatrices(radius, className) {
      if (!(radius > 0)) return;
      shapes.push(node('path', { class: className,
        d: 'M ' + fixed(-span / 2) + ' ' + fixed(-radius) + ' H ' + fixed(span / 2) +
           ' M ' + fixed(-span / 2) + ' ' + fixed(radius) + ' H ' + fixed(span / 2) }));
    }
    function surface(radius, className) {
      if (!(radius > 0)) return;
      if (!apparent || Math.abs(apparent.major - apparent.minor) < 1e-9) {
        shapes.push(node('circle', { class: className, r: fixed(radius * (apparent ? apparent.major : 1)) }));
        return;
      }
      shapes.push(Primitives.apparentEllipse(radius, apparent, { class: className }));
    }

    if (flat) {
      if (wheel.kind === 'worm' || wheel.kind === 'rack' || wheel.kind === 'cone') return shapes;
      generatrices(r.pitch, 'pitch-line');
      if (lod >= LEVELS.INVOLUTE && wheel.kind === 'gear') generatrices(r.root, 'root-line');
      return shapes;
    }
    if (wheel.kind !== 'worm' && wheel.kind !== 'rack' && wheel.kind !== 'cone') surface(r.pitch, 'pitch-circle');
    if (lod < LEVELS.TECHNICAL || wheel.kind === 'rack' || wheel.kind === 'worm' || wheel.kind === 'cone') return shapes;
    if (r.base > 0 && r.base < r.tip) surface(r.base, 'base-circle');
    if (wheel.kind === 'gear') {
      surface(r.root, 'root-circle');
      surface(r.tip, 'tip-circle');
    }
    return shapes;
  }

  /** Compatibilité : une roue sans présentation est une roue vue de face. */
  function circles(wheel, lod) { return surfaces(wheel, lod, { presentation: 'face' }); }

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
    // La ligne d'action est construite À L'ÉCRAN : la ligne des centres, un
    // quart de tour, moins l'angle de pression. Cette construction ne vaut que
    // si le plan d'engrènement est vu de face — là, un angle mécanique de 20°
    // est bien un angle de 20° sur la feuille. Vu de biais, tourner un vecteur
    // d'écran de 20° ne représente plus rien : le dessin affirmerait un angle
    // de pression qu'il ne mesure pas. Tant qu'il n'existe pas de construction
    // dans le repère mécanique de l'engrènement, on préfère ne rien tracer.
    if ((a.presentation && a.presentation !== 'face') || (b.presentation && b.presentation !== 'face')) return [];
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

  return { circles: circles, surfaces: surfaces, mesh: mesh, pitchPoint: pitchPoint, MESHING: MESHING };
});
