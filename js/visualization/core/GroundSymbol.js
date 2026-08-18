/* Symbole de bâti — §18 : dire qu'un organe est FIXE, en le dessinant.
 *
 * Un train épicycloïdal ne se lit pas sans savoir lequel de ses trois organes
 * est bloqué : c'est ce blocage qui décide du rapport, du sens et de la plage
 * accessible. Or les vues ne le disaient qu'en toutes lettres, dans une
 * étiquette — et l'étiquette disparaît dès qu'on masque les libellés, dès
 * qu'on exporte, dès qu'on dézoome. Sur un schéma de mécanique, un organe
 * immobilisé porte des HACHURES de bâti. C'est ce que produit ce module.
 *
 * Descripteurs purs {tag, attrs} : aucune dépendance au DOM, donc les trois
 * vues partagent le même symbole au lieu d'en inventer chacune un.
 * UMD : testable sous Node (tests/functional-roles.test.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearGroundSymbol = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fixed(value, digits) { return finite(value, 0).toFixed(digits == null ? 2 : digits); }

  /** Espacement angulaire des hachures : assez serré pour se lire, assez lâche pour rester net. */
  var STEP_DEG = 18;
  /** Inclinaison des traits par rapport à la normale au contour, comme au trait de bâti. */
  var LEAN_DEG = 45;

  /**
   * Hachures de bâti tout autour d'un contour circulaire, dirigées vers
   * l'extérieur — le côté « matière fixe ».
   *
   * @param {number} cx centre
   * @param {number} cy centre
   * @param {number} radius rayon du contour à hachurer
   * @param {object} [options] length, stepDeg, leanDeg, className
   * @returns {Array} descripteurs {tag, attrs}
   */
  function ring(cx, cy, radius, options) {
    options = options || {};
    var r = finite(radius, 0);
    if (!(r > 0)) return [];
    var length = Math.max(1.2, finite(options.length, r * 0.16));
    var step = Math.max(6, finite(options.stepDeg, STEP_DEG));
    var lean = finite(options.leanDeg, LEAN_DEG) * Math.PI / 180;
    var count = Math.max(6, Math.round(360 / step));
    var css = options.className ? ' ' + options.className : '';
    // Le contour hachuré est celui de la PIÈCE, telle qu'on la voit : un cercle
    // de face, l'ellipse apparente de biais. Un anneau de hachures circulaire
    // autour d'un organe elliptique désignerait un contour qui n'existe pas.
    var seen = options.apparent || { major: 1, minor: 1 };
    var rx = r * finite(seen.minor, 1), ry = r * finite(seen.major, 1);
    var round = Math.abs(rx - ry) < 1e-9;
    var out = [round
      ? { tag: 'circle', attrs: { class: 'ground-boundary' + css, cx: fixed(cx), cy: fixed(cy), r: fixed(r) } }
      : { tag: 'ellipse', attrs: { class: 'ground-boundary' + css, cx: fixed(cx), cy: fixed(cy),
        rx: fixed(Math.max(0.2, rx)), ry: fixed(Math.max(0.2, ry)) } }];
    for (var i = 0; i < count; i++) {
      var a = 2 * Math.PI * i / count;
      var x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      // Le trait part du contour et fuit vers l'EXTÉRIEUR, incliné de `lean`
      // par rapport à la normale — c'est le peigne caractéristique du bâti.
      // Sur une ellipse, la normale n'est plus le rayon : (ry·cos, rx·sin).
      var nx = ry * Math.cos(a), ny = rx * Math.sin(a);
      var norm = Math.hypot(nx, ny) || 1;
      var normal = Math.atan2(ny / norm, nx / norm) + lean;
      out.push({ tag: 'line', attrs: { class: 'ground-hatch' + css,
        x1: fixed(x), y1: fixed(y),
        x2: fixed(x + Math.cos(normal) * length), y2: fixed(y + Math.sin(normal) * length) } });
    }
    return out;
  }

  /**
   * Hachures le long d'un segment, pour les vues qui représentent l'organe fixe
   * par un trait plutôt que par un cercle (schéma cinématique).
   */
  function line(x1, y1, x2, y2, options) {
    options = options || {};
    var dx = x2 - x1, dy = y2 - y1, span = Math.hypot(dx, dy);
    if (!(span > 0)) return [];
    var length = Math.max(1.2, finite(options.length, 6));
    var count = Math.max(2, Math.round(span / Math.max(2, finite(options.spacing, length))));
    // Normale au segment, du côté demandé : les hachures d'un bâti sont
    // toujours d'un seul côté du trait, jamais des deux.
    var side = finite(options.side, 1) < 0 ? -1 : 1;
    var nx = -dy / span * side, ny = dx / span * side;
    var lean = finite(options.leanDeg, LEAN_DEG) * Math.PI / 180;
    var lx = nx * Math.cos(lean) - ny * Math.sin(lean);
    var ly = nx * Math.sin(lean) + ny * Math.cos(lean);
    var css = options.className ? ' ' + options.className : '';
    var out = [{ tag: 'line', attrs: { class: 'ground-boundary' + css,
      x1: fixed(x1), y1: fixed(y1), x2: fixed(x2), y2: fixed(y2) } }];
    for (var i = 0; i <= count; i++) {
      var t = i / count;
      var px = x1 + dx * t, py = y1 + dy * t;
      out.push({ tag: 'line', attrs: { class: 'ground-hatch' + css,
        x1: fixed(px), y1: fixed(py),
        x2: fixed(px + lx * length), y2: fixed(py + ly * length) } });
    }
    return out;
  }

  return { ring: ring, line: line, STEP_DEG: STEP_DEG, LEAN_DEG: LEAN_DEG };
});
