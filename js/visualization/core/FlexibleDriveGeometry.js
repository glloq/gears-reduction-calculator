// FlexibleDriveGeometry.js - La courroie existe dans le mécanisme, pas dans l'écran.
//
// Le tracé d'une courroie était reconstruit dans chaque vue, à partir de deux
// centres posés à la main : `centre1 = (x, y)` et `centre2 = (x + entraxe, y)`.
// La deuxième poulie était donc forcée à l'horizontale, quelle que soit la
// position que le modèle spatial lui donnait. Une transmission par courroie
// inclinée à 30° se dessinait à plat, et les deux vues montraient deux
// mécanismes différents.
//
// Ici, la courroie est construite là où elle se trouve :
//
//     N = axe des poulies              (normale au plan de courroie)
//     F1 = direction centre 1 → centre 2, RAMENÉE dans le plan
//     F2 = N × F1
//
// Le plan de courroie est (F1, F2). Tangentes, arcs d'enroulement, points de
// tangence et longueur développée y sont calculés en millimètres réels — la
// géométrie exacte de GeometryUtils, mais dans le plan du mécanisme. Chaque
// point est ensuite transporté à l'écran par l'image de ce plan :
//
//     écran = centre 1 dessiné + a × S1 + b × S2
//
// S1 est l'image de la ligne des centres — celle que la vue a effectivement
// tracée, si bien que les brins touchent les poulies telles qu'elles sont
// dessinées —, S2 celle de la transverse, projetée. Un cercle devient donc une
// ellipse quand on regarde de biais, et un segment quand on regarde le plan de
// courroie par la tranche : c'est ce qu'on voit d'une vraie courroie.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./GeometryUtils.js') : root.GearGeometryUtils,
    common ? require('./ProjectionEngine.js') : root.GearProjectionEngine);
  if (common) module.exports = api; else root.GearFlexibleDriveGeometry = api;
})(typeof self !== 'undefined' ? self : this, function (GeometryUtils, Projection) {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function unit(a) {
    var n = Math.hypot(a[0], a[1], a[2]);
    return n < 1e-9 ? [0, 0, 1] : [a[0] / n, a[1] / n, a[2] / n];
  }
  function f2(v) { return v.toFixed(3); }

  /**
   * L'image d'un cercle par une application affine est une ellipse. Ses deux
   * demi-axes et son inclinaison sont les valeurs singulières de la matrice
   * [S1 S2] — décomposition analytique, exacte en 2×2.
   *
   * Le signe du déterminant dit si l'image conserve le sens de parcours : c'est
   * lui qui décide du drapeau `sweep` des arcs SVG. Un demi-axe nul signifie
   * que le plan de courroie est vu par la tranche ; SVG trace alors un segment,
   * ce qui est précisément le dessin juste.
   */
  function ellipseOf(s1, s2) {
    var a = s1[0], b = s2[0], c = s1[1], d = s2[1];
    var e = (a + d) / 2, g = (a - d) / 2, h = (c + b) / 2, k = (c - b) / 2;
    var q = Math.hypot(e, k), r = Math.hypot(g, h);
    return { major: q + r, minor: Math.abs(q - r),
      rotationDeg: (Math.atan2(k, e) + Math.atan2(h, g)) / 2 * 180 / Math.PI,
      det: a * d - b * c };
  }

  /**
   * build({ axis, centre1, centre2, r1, r2, crossed, view, drawn1, drawn2 })
   *   → la courroie, dans son plan et à l'écran, ou null si la géométrie ne
   *     tient pas (poulies confondues, entraxe trop court pour une tangente).
   *
   * `centre1`/`centre2` sont des positions MONDE, `drawn1`/`drawn2` les points
   * que la vue a réellement tracés — ils diffèrent en vue dépliée, qui restitue
   * les longueurs vraies. À défaut, la projection stricte est utilisée.
   */
  function build(options) {
    var o = options || {};
    // `view` accepte aussi bien un identifiant qu'une vue déjà résolue : la
    // passer telle quelle à `Projection.view()` retomberait silencieusement sur
    // la vue de face, et la courroie serait dessinée depuis un autre point de vue.
    var view = typeof o.view === 'string' || o.view == null ? Projection.view(o.view) : o.view;
    var c1 = o.centre1, c2 = o.centre2;
    var r1 = finite(o.r1, 0), r2 = finite(o.r2, 0);
    if (!c1 || !c2 || !(r1 > 0) || !(r2 > 0)) return null;

    var axis = unit(o.axis || [0, 0, 1]);
    var delta = [c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]];
    // La part de l'écart qui suit l'axe ne fait pas partie du plan de courroie :
    // deux poulies décalées axialement n'ont pas un entraxe plus grand.
    var axial = dot(delta, axis);
    var inPlane = [delta[0] - axis[0] * axial, delta[1] - axis[1] * axial, delta[2] - axis[2] * axial];
    var distance = Math.hypot(inPlane[0], inPlane[1], inPlane[2]);
    if (!(distance > 1e-9)) return null;

    var first = [inPlane[0] / distance, inPlane[1] / distance, inPlane[2] / distance];
    var second = cross(axis, first);

    var local;
    try {
      local = GeometryUtils.flexiblePath({ x: 0, y: 0 }, { x: distance, y: 0 }, r1, r2, !!o.crossed);
    } catch (e) { return null; }

    var origin = o.drawn1 || Projection.project(c1, view);
    var far = o.drawn2 || Projection.project(c2, view);
    var s1 = [(far[0] - origin[0]) / distance, (far[1] - origin[1]) / distance];
    var s2 = Projection.project(second, view);
    var ellipse = ellipseOf(s1, s2);

    var geometry = {
      local: local, view: view, origin: origin, first: s1, second: s2, ellipse: ellipse,
      axis: axis, planeFirst: first, planeSecond: second,
      distance: distance, axialOffset: axial, crossed: !!o.crossed,
      r1: r1, r2: r2,
      spanLength: local.spanLength, length: local.length,
      wrapAngle1Deg: local.wrapAngle1 * 180 / Math.PI,
      wrapAngle2Deg: local.wrapAngle2 * 180 / Math.PI,
      // Vu par la tranche, le plan de courroie n'a plus de surface : le dire
      // permet aux vues de ne pas prétendre montrer un enroulement.
      collapsed: ellipse.minor < 1e-6
    };
    geometry.toScreen = function (point) {
      return [origin[0] + point[0] * s1[0] + point[1] * s2[0],
        origin[1] + point[0] * s1[1] + point[1] * s2[1]];
    };
    /** Le point à l'abscisse curviligne `s`, comptée en mm RÉELS sur la courroie. */
    geometry.point = function (s) {
      var p = GeometryUtils.pointAlong(local, s);
      return p ? geometry.toScreen([p.x, p.y]) : null;
    };
    geometry.tangentPoints = local.tangents.reduce(function (list, tangent) {
      list.push(geometry.toScreen([tangent.from.x, tangent.from.y]));
      list.push(geometry.toScreen([tangent.to.x, tangent.to.y]));
      return list;
    }, []);
    geometry.centre1 = geometry.toScreen([0, 0]);
    geometry.centre2 = geometry.toScreen([distance, 0]);
    geometry.outline = outline(geometry);
    return geometry;
  }

  /**
   * Le circuit fermé, à l'écran : deux brins droits et deux arcs. Les brins
   * restent droits — une projection conserve les droites — et les arcs
   * deviennent des arcs d'ellipse, tous de même inclinaison et de même rapport
   * puisqu'ils vivent dans le même plan.
   */
  function outline(geometry) {
    var parts = GeometryUtils.segments(geometry.local);
    if (!parts) return '';
    var e = geometry.ellipse, d = '';
    parts.list.forEach(function (segment) {
      if (segment.kind === 'line') {
        if (!d) {
          var start = geometry.toScreen([segment.from.x, segment.from.y]);
          d = 'M ' + f2(start[0]) + ' ' + f2(start[1]);
        }
        var to = geometry.toScreen([segment.to.x, segment.to.y]);
        d += ' L ' + f2(to[0]) + ' ' + f2(to[1]);
        return;
      }
      var angle = segment.start + segment.delta;
      var end = geometry.toScreen([segment.centre.x + segment.radius * Math.cos(angle),
        segment.centre.y + segment.radius * Math.sin(angle)]);
      // Le sens de parcours à l'écran est celui du plan, retourné si l'image
      // retourne le plan : c'est le signe du déterminant qui le dit.
      var sweep = segment.delta * e.det > 0 ? 1 : 0;
      d += ' A ' + f2(segment.radius * e.major) + ' ' + f2(segment.radius * e.minor) + ' ' +
        f2(e.rotationDeg) + ' ' + (Math.abs(segment.delta) > Math.PI ? 1 : 0) + ' ' + sweep +
        ' ' + f2(end[0]) + ' ' + f2(end[1]);
    });
    return d ? d + ' Z' : '';
  }

  return { build: build, ellipseOf: ellipseOf };
});
