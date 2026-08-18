/* Efforts mécaniques : le repère dans lequel ils vivent, puis leur image.
 *
 * Les trois directions étaient écrites en dur, à l'écran :
 *
 *     Ft → ( 1, 0)    Fr → (0, −1)    Fa → (0.7, 0.7)
 *
 * Un effort tangentiel n'est horizontal que si la ligne des centres est
 * verticale ; un effort axial n'est jamais à 45°. Ces flèches ne montraient
 * donc pas la mécanique du couple mais une rosace fixe, la même pour une roue
 * droite, une vis sans fin et un couple conique, dans toutes les vues.
 *
 * Les efforts vivent dans le repère de l'engrènement :
 *
 *     A = axe de l'organe sur lequel les efforts sont calculés
 *     R = ligne des centres, ramenée perpendiculaire à A
 *     T = A × R
 *
 * Ft suit T, Fr suit −R (vers le centre de l'organe), Fa suit A. Chaque
 * direction est ensuite PROJETÉE comme le reste du dessin. Sans repère — un
 * étage dont on ne sait pas construire la ligne des centres —, aucune flèche
 * n'est tracée : mieux vaut ne rien montrer qu'une direction inventée.
 *
 * Les longueurs de flèches sont normalisées entre elles : elles comparent Ft,
 * Fr et Fa d'UN étage, jamais deux solutions entre elles. La valeur exacte en
 * newtons reste accessible en infobulle.
 *
 * Le groupe produit est ancré en coordonnées monde mais marqué
 * data-viewer-scale : le renderer lui applique l'échelle écran, sinon une
 * flèche de 24 « unités » vaudrait 24 mm et écraserait un pignon de 20 mm.
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('../core/ProjectionEngine.js') : root.GearProjectionEngine);
  if (common) module.exports = api; else root.GearForceOverlay = api;
})(typeof self !== 'undefined' ? self : this, function (Projection) {
  'use strict';

  var KEYS = [{ key: 'tangentialN', label: 'Ft' }, { key: 'radialN', label: 'Fr' }, { key: 'axialN', label: 'Fa' }];

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function unit(a) {
    var n = Math.hypot(a[0], a[1], a[2]);
    return n < 1e-9 ? null : [a[0] / n, a[1] / n, a[2] / n];
  }

  /**
   * frame({ axis, centre, mate, view, origin }) → le repère de l'engrènement,
   * dans le monde ET à l'écran, ou null si la ligne des centres n'existe pas.
   *
   * `origin` est le point d'application à l'écran — le point primitif, là où
   * les dents se touchent, et non le centre de la roue.
   */
  function frame(options) {
    var o = options || {};
    var view = typeof o.view === 'string' || o.view == null ? Projection.view(o.view) : o.view;
    // Sans axe, sans centre ou sans conjugué, il n'y a pas d'engrènement : on
    // ne fabrique pas de repère par défaut.
    var axis = o.axis ? unit(o.axis) : null;
    if (!axis || !o.centre || !o.mate) return null;
    var delta = [o.mate[0] - o.centre[0], o.mate[1] - o.centre[1], o.mate[2] - o.centre[2]];
    // La part de l'écart qui suit l'axe n'appartient pas au plan d'engrènement.
    var alongAxis = dot(delta, axis);
    var radial = unit([delta[0] - axis[0] * alongAxis, delta[1] - axis[1] * alongAxis, delta[2] - axis[2] * alongAxis]);
    if (!radial) return null;
    var tangential = cross(axis, radial);
    // Fr est dirigé VERS le centre de l'organe : la ligne des centres pointe
    // vers l'organe conjugué, l'effort radial en revient.
    var world = { tangentialN: tangential, radialN: [-radial[0], -radial[1], -radial[2]], axialN: axis };
    var screen = {};
    Object.keys(world).forEach(function (key) { screen[key] = Projection.project(world[key], view); });
    return { origin: o.origin || [0, 0], world: world, screen: screen, view: view, exact: true };
  }

  /**
   * vectors(forces, maxLength, mesh) → une entrée par effort réellement calculé.
   *
   * `foreshortening` dit combien la direction survit à la projection. En
   * dessous d'un seuil, la flèche pointerait vers l'œil : elle serait un point,
   * et on la remplace par le symbole du dessin technique — ⊙ vers nous, ⊗ vers
   * le fond. `towards` porte ce sens.
   */
  function vectors(forces, maxLength, mesh) {
    forces = forces || {};
    maxLength = maxLength || 24;
    if (!mesh || !mesh.screen) return [];
    var max = KEYS.reduce(function (m, a) { return Math.max(m, Math.abs(forces[a.key] || 0)); }, 0);
    return KEYS.filter(function (a) { return Number.isFinite(forces[a.key]) && forces[a.key] !== 0; })
      .map(function (a) {
        var value = forces[a.key];
        var sign = Math.sign(value);
        var direction = mesh.screen[a.key] || [0, 0];
        var seen = Math.hypot(direction[0], direction[1]);
        var length = max ? Math.max(7, Math.abs(value) / max * maxLength) : 0;
        var entry = { key: a.key, label: a.label, value: value, foreshortening: seen,
          x2: direction[0] * length * sign, y2: direction[1] * length * sign, towards: 0 };
        if (seen < 0.2) {
          // Vue quasiment dans l'axe de l'effort : la flèche n'a plus de
          // longueur à montrer, seulement un sens — vers l'œil ou vers le fond.
          var depth = dot(mesh.world[a.key], mesh.view.w) * sign;
          entry.towards = depth < 0 ? 1 : -1;
          entry.x2 = 0; entry.y2 = 0;
        }
        return entry;
      });
  }

  function render(create, host, forces, origin, mesh) {
    var list = vectors(forces, 24, mesh);
    if (!list.length) return null;
    var g = create('g', { class: 'force-overlay', 'data-viewer-scale': '',
      'data-anchor-x': origin.x, 'data-anchor-y': origin.y,
      transform: 'translate(' + origin.x + ' ' + origin.y + ')' });
    list.forEach(function (v) {
      var arrow = create('g', { class: 'force-vector force-' + v.label.toLowerCase() +
        (v.towards ? ' force-end-on' : ''), 'data-direction': v.towards ? 'end-on' : 'in-plane' });
      if (v.towards) {
        // ⊙ / ⊗ : la convention du dessin technique pour un vecteur qui sort
        // de la feuille ou qui y entre.
        arrow.appendChild(create('circle', { cx: 0, cy: 0, r: 3.2 }));
        if (v.towards > 0) arrow.appendChild(create('circle', { class: 'force-tip', cx: 0, cy: 0, r: 1.1 }));
        else {
          arrow.appendChild(create('line', { class: 'force-tail', x1: -2.3, y1: -2.3, x2: 2.3, y2: 2.3 }));
          arrow.appendChild(create('line', { class: 'force-tail', x1: -2.3, y1: 2.3, x2: 2.3, y2: -2.3 }));
        }
        arrow.appendChild(create('text', { x: 5, y: -4 }, v.label));
      } else {
        arrow.appendChild(create('line', { x1: 0, y1: 0, x2: v.x2.toFixed(2), y2: v.y2.toFixed(2) }));
        arrow.appendChild(create('text', { x: v.x2.toFixed(2), y: v.y2.toFixed(2) }, v.label));
      }
      arrow.appendChild(create('title', {}, v.label + ' ' + Math.abs(v.value).toFixed(0) + ' N' +
        (v.towards ? (v.towards > 0 ? ' — vers l’observateur' : ' — vers le fond') : '')));
      g.appendChild(arrow);
    });
    host.appendChild(g);
    return g;
  }

  return { vectors: vectors, render: render, frame: frame };
});
