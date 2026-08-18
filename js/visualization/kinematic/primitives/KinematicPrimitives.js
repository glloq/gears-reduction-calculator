/* Symboles de la vue « Cinématique ».
 *
 * Vue volontairement SYMBOLIQUE : les tailles sont des constantes graphiques,
 * pas des cotes. Ce qui doit être exact ici, c'est la SÉMANTIQUE — quel type de
 * liaison, quels membres, quels rôles — pas les millimètres, que porte la vue
 * Géométrie.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KinematicPrimitives = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function circle(g, cx, cy, r, cls) { g.appendChild(el('circle', { cx: cx, cy: cy, r: r, class: cls || 'gear-symbol' })); }
  function line(g, x1, y1, x2, y2, cls) { g.appendChild(el('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: cls || 'symbol-line' })); }

  function pair(g, n) { circle(g, n.input.x, n.input.y, 24); circle(g, n.output.x, n.output.y, 34); }

  var draw = {
    spur: pair,
    helical: function (g, n) {
      pair(g, n);
      line(g, n.input.x - 16, n.input.y + 16, n.input.x + 16, n.input.y - 16, 'helix-mark');
      line(g, n.output.x - 22, n.output.y + 22, n.output.x + 22, n.output.y - 22, 'helix-mark');
    },
    internal: function (g, n) {
      circle(g, n.input.x, n.input.y, 20);
      circle(g, n.input.x, n.input.y, 48, 'internal-ring');
      circle(g, n.input.x, n.input.y, 39, 'internal-ring inner');
    },
    bevel: function (g, n) {
      g.appendChild(el('path', { d: 'M' + (n.input.x - 28) + ' ' + (n.input.y - 22) + ' L' + (n.input.x + 28) + ' ' + n.input.y +
        ' L' + (n.input.x - 28) + ' ' + (n.input.y + 22) + ' Z', class: 'bevel-symbol' }));
      g.appendChild(el('path', { d: 'M' + n.output.x + ' ' + (n.output.y - 28) + ' L' + (n.output.x + 22) + ' ' + (n.output.y + 28) +
        ' L' + (n.output.x - 22) + ' ' + (n.output.y + 28) + ' Z', class: 'bevel-symbol' }));
    },
    worm: function (g, n) {
      for (var i = -2; i <= 2; i++) line(g, n.input.x - 28 + i * 7, n.input.y - 15, n.input.x - 14 + i * 7, n.input.y + 15, 'worm-thread');
      circle(g, n.output.x, n.output.y, 35, 'worm-wheel');
    },
    belt: function (g, n) {
      circle(g, n.input.x, n.input.y, 23, 'pulley');
      circle(g, n.output.x, n.output.y, 33, 'pulley');
      line(g, n.input.x, n.input.y - 23, n.output.x, n.output.y - 33, 'belt-span');
      line(g, n.input.x, n.input.y + 23, n.output.x, n.output.y + 33, 'belt-span');
    },
    chain: function (g, n) {
      draw.belt(g, n);
      Array.prototype.forEach.call(g.querySelectorAll('.belt-span'), function (x) { x.setAttribute('class', 'chain-span'); });
    },
    planetary: function (g, n) {
      var x = n.input.x, y = n.input.y;
      var count = Math.max(2, Number(n.stage.planetCount) || 3);
      var points = [];
      circle(g, x, y, 18, 'sun');
      circle(g, x, y, 55, 'ring');
      for (var i = 0; i < count; i++) {
        var angle = -Math.PI / 2 + i * Math.PI * 2 / count;
        var p = [x + 34 * Math.cos(angle), y + 34 * Math.sin(angle)];
        points.push(p);
        circle(g, p[0], p[1], 10, 'planet');
      }
      g.appendChild(el('polygon', { points: points.map(function (p) { return p.join(','); }).join(' '), class: 'carrier' }));
      g.appendChild(el('text', { x: x, y: y + 4, 'text-anchor': 'middle', class: 'member-label' }, 'S'));
      g.appendChild(el('text', { x: x + 47, y: y - 37, 'text-anchor': 'middle', class: 'member-label' }, 'R'));
      g.appendChild(el('text', { x: x, y: y + 72, 'text-anchor': 'middle', class: 'member-label' }, 'C'));
    },
    rack: function (g, n) {
      circle(g, n.input.x, n.input.y, 25);
      line(g, n.input.x - 20, n.input.y + 28, n.output.x + 45, n.output.y + 28, 'rack-line');
      for (var x = n.input.x - 18; x < n.output.x + 45; x += 12) line(g, x, n.input.y + 28, x + 6, n.input.y + 20, 'rack-tooth');
      g.appendChild(el('path', { d: 'M' + (n.output.x + 30) + ' ' + (n.output.y + 40) + ' h 22 m 0 0 l -6 -4 m 6 4 l -6 4', class: 'linear-arrow' }));
    }
  };
  draw.epicyclic = draw.planetary;

  /** Repère de rotation d'un arbre : arc + pointe, animé par le renderer. */
  function spinMark(cx, cy, r) {
    var g = el('g', { class: 'spin-mark' });
    g.appendChild(el('path', { d: 'M ' + (cx + r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + cx + ' ' + (cy + r) }));
    g.appendChild(el('path', { d: 'M ' + cx + ' ' + (cy + r) + ' l 4 -4 m -4 4 l 4 4' }));
    return g;
  }

  // Glyphes de relation : une pastille dit d'un coup d'œil quelle liaison relie
  // les deux arbres, sans avoir à décoder le symbole complet.
  var GLYPHS = { spur: '⚙', helical: '⚙', internal: '◎', belt: '║', chain: '⛓', bevel: '⊥', worm: '⊥',
    planetary: '◉', epicyclic: '◉', rack: '⇆' };

  function relationBadge(type, x, y) {
    var g = el('g', { class: 'relation-badge-group', 'data-relation-type': type });
    g.appendChild(el('circle', { cx: x, cy: y, r: 10, class: 'relation-badge' }));
    g.appendChild(el('text', { x: x, y: y, dy: '.35em', 'text-anchor': 'middle', class: 'relation-glyph' }, GLYPHS[type] || '⚙'));
    g.appendChild(el('title', {}, 'Liaison ' + type));
    return g;
  }

  /**
   * Trièdre de repérage : rappelle d'où l'on regarde.
   *
   * Il était écrit en dur, deux jeux de flèches pour deux projections
   * codées à la main. Les branches se DÉDUISENT du point de vue : on projette
   * les trois axes du monde, et celui qui pointe vers l'œil se réduit à un
   * point — ce qu'un trièdre doit justement montrer.
   */
  function axisIndicator(x, y, projection) {
    var g = el('g', { class: 'axis-indicator', transform: 'translate(' + x + ' ' + y + ')' });
    var view = typeof GearProjectionEngine !== 'undefined' ? GearProjectionEngine.view(projection) : null;
    var arm = 26;
    [['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]].forEach(function (axis) {
      var screen = view ? GearProjectionEngine.project(axis[1], view) : [0, 0];
      var dx = screen[0] * arm, dy = screen[1] * arm;
      if (Math.hypot(dx, dy) < 1) {
        // Axe vu en bout : un point, marqué comme tel plutôt qu'omis.
        g.appendChild(el('circle', { cx: 0, cy: 0, r: 2.4, class: 'axis-arrow end-on' }));
        return;
      }
      g.appendChild(el('line', { x1: 0, y1: 0, x2: dx.toFixed(2), y2: dy.toFixed(2), class: 'axis-arrow' }));
      g.appendChild(el('text', { x: (dx * 1.25).toFixed(2), y: (dy * 1.25).toFixed(2), dy: '.35em',
        'text-anchor': 'middle', class: 'axis-name' }, axis[0]));
    });
    g.appendChild(el('title', {}, 'Vue ' + (view ? view.label.toLowerCase() : projection)));
    return g;
  }

  return {
    draw: function (type, g, node) { (draw[type] || pair)(g, node); },
    element: el, spinMark: spinMark, relationBadge: relationBadge, axisIndicator: axisIndicator,
    glyphs: GLYPHS, types: Object.keys(draw)
  };
});
