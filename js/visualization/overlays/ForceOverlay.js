/* Normalisation et rendu SVG des efforts mécaniques.
 *
 * Les longueurs de flèches sont normalisées entre elles : elles comparent Ft, Fr
 * et Fa d'UN étage, jamais deux solutions entre elles. La valeur exacte en
 * newtons reste accessible en infobulle.
 *
 * Le groupe produit est ancré en coordonnées monde mais marqué
 * data-viewer-scale : le renderer lui applique l'échelle écran, sinon une
 * flèche de 24 « unités » vaudrait 24 mm et écraserait un pignon de 20 mm.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearForceOverlay = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var AXES = [
    { key: 'tangentialN', label: 'Ft', dx: 1, dy: 0 },
    { key: 'radialN', label: 'Fr', dx: 0, dy: -1 },
    { key: 'axialN', label: 'Fa', dx: .7, dy: .7 }
  ];

  function vectors(forces, maxLength) {
    forces = forces || {};
    maxLength = maxLength || 24;
    var max = AXES.reduce(function (m, a) { return Math.max(m, Math.abs(forces[a.key] || 0)); }, 0);
    return AXES.filter(function (a) { return Number.isFinite(forces[a.key]) && forces[a.key] !== 0; })
      .map(function (a) {
        var value = forces[a.key];
        var length = max ? Math.max(7, Math.abs(value) / max * maxLength) : 0;
        return { key: a.key, label: a.label, value: value,
          x2: a.dx * length * Math.sign(value), y2: a.dy * length * Math.sign(value) };
      });
  }

  function render(create, host, forces, origin) {
    var list = vectors(forces);
    if (!list.length) return null;
    var g = create('g', { class: 'force-overlay', 'data-viewer-scale': '',
      'data-anchor-x': origin.x, 'data-anchor-y': origin.y,
      transform: 'translate(' + origin.x + ' ' + origin.y + ')' });
    list.forEach(function (v) {
      var arrow = create('g', { class: 'force-vector force-' + v.label.toLowerCase() });
      arrow.appendChild(create('line', { x1: 0, y1: 0, x2: v.x2.toFixed(2), y2: v.y2.toFixed(2) }));
      arrow.appendChild(create('text', { x: v.x2.toFixed(2), y: v.y2.toFixed(2) }, v.label));
      arrow.appendChild(create('title', {}, v.label + ' ' + Math.abs(v.value).toFixed(0) + ' N'));
      g.appendChild(arrow);
    });
    host.appendChild(g);
    return g;
  }

  return { vectors: vectors, render: render };
});
