// SolutionThumbnail.js — la SILHOUETTE d'une solution, à la taille d'une vignette.
//
// La comparaison alignait des nombres. Or deux lignes qui se ressemblent —
// même rapport, même rendement, même encombrement — peuvent être deux
// mécanismes qui n'ont rien de commun : un train à deux étages parallèles et
// un planétaire coaxial, une courroie de 150 mm d'entraxe et un couple
// conique. Le chiffre ne le dit pas ; la forme, oui, et immédiatement.
//
// CE QUE LA VIGNETTE PROMET, ET CE QU'ELLE NE PROMET PAS.
// Elle ne dessine ni denture, ni corps, ni arbre : uniquement les SURFACES
// PRIMITIVES et le trajet des liens souples, aux positions du calcul. C'est
// une silhouette, au sens du contrat de fidélité — le niveau où l'on dessine
// beaucoup de pièces et où seul le contour porte l'information.
//
// Ce qu'elle ne fait surtout pas : recalculer quoi que ce soit. Les positions,
// les diamètres et les raccourcis viennent de `TrainLayout`, c'est-à-dire de
// la même chaîne que le visualiseur. Une vignette qui contredirait le dessin
// qu'elle annonce serait pire que pas de vignette.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./TrainLayout.js') : root.GearTrainLayout);
  if (common) module.exports = api;
  else {
    root.GearSolutionThumbnail = api;
    if (root.GearApp && root.GearApp.visualization) root.GearApp.visualization.SolutionThumbnail = api;
  }
})(typeof self !== 'undefined' ? self : this, function (TrainLayout) {
  'use strict';

  var PAD = 0.06;          // de la plus grande dimension, pour que rien ne touche le bord
  var MIN_SPAN = 4;        // un mécanisme minuscule ne doit pas être agrandi à l'infini

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fixed(value) { return (Math.round(value * 100) / 100).toString(); }

  /** Le rôle mécanique, réduit aux trois que la vignette sait colorer. */
  function roleOf(wheel) {
    var role = wheel.functionalRole;
    return role === 'input' || role === 'output' || role === 'fixed' ? role : 'intermediate';
  }

  /**
   * Une roue vue de biais est une ELLIPSE, et son petit axe porte le raccourci
   * que la projection a calculé. La reprendre en cercle ferait mentir la
   * vignette sur l'orientation de l'arbre — précisément ce qu'on vient y lire.
   */
  function wheelShape(wheel) {
    var radius = finite(wheel.pitchD, 0) / 2;
    if (!(radius > 0)) return null;
    var seen = wheel.apparent || {};
    var major = finite(seen.major, 1), minor = finite(seen.minor, 1);
    return {
      tag: 'ellipse', role: roleOf(wheel), kind: wheel.kind,
      cx: finite(wheel.cx, 0), cy: finite(wheel.cy, 0),
      // Repère LOCAL de la pièce : +X porte l'axe, donc le petit axe apparent.
      rx: Math.max(0.2, radius * minor), ry: Math.max(0.2, radius * major),
      rotate: finite(wheel.axisAngleDeg, 0)
    };
  }

  /** Une crémaillère n'a pas de diamètre : elle a une course et une direction. */
  function rackShape(wheel) {
    var length = finite(wheel.length, 0);
    if (!(length > 0)) return null;
    var along = wheel.slideAlong || [1, 0];
    var norm = Math.hypot(along[0], along[1]) || 1;
    var half = length / 2;
    return {
      tag: 'line', role: roleOf(wheel), kind: 'rack',
      x1: finite(wheel.cx, 0) - along[0] / norm * half, y1: finite(wheel.cy, 0) - along[1] / norm * half,
      x2: finite(wheel.cx, 0) + along[0] / norm * half, y2: finite(wheel.cy, 0) + along[1] / norm * half
    };
  }

  /** L'étendue d'une forme, pour le cadrage. Une ellipse tournée passe par sa boîte. */
  function extend(box, shape) {
    var points = [];
    if (shape.tag === 'ellipse') {
      var reach = Math.max(shape.rx, shape.ry);
      points.push([shape.cx - reach, shape.cy - reach], [shape.cx + reach, shape.cy + reach]);
    } else if (shape.tag === 'line') {
      points.push([shape.x1, shape.y1], [shape.x2, shape.y2]);
    } else if (shape.tag === 'path') {
      // Les nombres du chemin suffisent : c'est un tracé d'arcs et de segments
      // dont les points de contrôle sont tous dans la zone utile.
      var numbers = String(shape.d).match(/-?\d+(\.\d+)?/g) || [];
      for (var i = 0; i + 1 < numbers.length; i += 2) points.push([Number(numbers[i]), Number(numbers[i + 1])]);
    }
    points.forEach(function (p) {
      box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]);
      box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
    });
  }

  /**
   * build(solution, options) → { viewBox, shapes } dans les coordonnées du
   * dessin, déjà cadrées. `options.view` choisit le point de vue, comme dans
   * le visualiseur ; la vue dépliée est celle qui montre le mieux une
   * ARCHITECTURE, parce qu'elle garde les entraxes et les angles vrais.
   */
  function build(solution, options) {
    options = options || {};
    if (!solution || !solution.stages || !solution.stages.length) return null;
    var layout;
    try {
      layout = TrainLayout.layout(solution.stages, solution.mechanical,
        { solution: solution, view: options.view || 'unfolded' });
    } catch (error) { return null; }
    if (!layout || !layout.stages) return null;

    var shapes = [];
    layout.stages.forEach(function (entry) {
      // Les liens souples d'abord : la courroie passe DERRIÈRE ses poulies.
      (entry.links || []).forEach(function (link) {
        if (link && link.outline) shapes.push({ tag: 'path', role: 'link', kind: link.kind, d: link.outline });
      });
      (entry.wheels || []).forEach(function (wheel) {
        var shape = wheel.kind === 'rack' ? rackShape(wheel) : wheelShape(wheel);
        if (shape) shapes.push(shape);
      });
    });
    if (!shapes.length) return null;

    var box = [Infinity, Infinity, -Infinity, -Infinity];
    shapes.forEach(function (shape) { extend(box, shape); });
    if (!Number.isFinite(box[0]) || !Number.isFinite(box[2])) return null;
    var width = Math.max(MIN_SPAN, box[2] - box[0]), height = Math.max(MIN_SPAN, box[3] - box[1]);
    var pad = Math.max(width, height) * PAD;
    return {
      shapes: shapes,
      viewBox: [box[0] - pad, box[1] - pad, width + 2 * pad, height + 2 * pad],
      stages: layout.stages.length
    };
  }

  /** Le même contenu, en balisage — c'est ce que le panneau insère. */
  function markup(solution, options) {
    var plan = build(solution, options);
    if (!plan) return '';
    var body = plan.shapes.map(function (shape) {
      var role = ' class="thumb-' + shape.tag + ' thumb-' + shape.role + '"';
      if (shape.tag === 'path') return '<path' + role + ' d="' + shape.d + '"/>';
      if (shape.tag === 'line') {
        return '<line' + role + ' x1="' + fixed(shape.x1) + '" y1="' + fixed(shape.y1) +
          '" x2="' + fixed(shape.x2) + '" y2="' + fixed(shape.y2) + '"/>';
      }
      var turn = shape.rotate
        ? ' transform="rotate(' + fixed(shape.rotate) + ' ' + fixed(shape.cx) + ' ' + fixed(shape.cy) + ')"'
        : '';
      return '<ellipse' + role + ' cx="' + fixed(shape.cx) + '" cy="' + fixed(shape.cy) +
        '" rx="' + fixed(shape.rx) + '" ry="' + fixed(shape.ry) + '"' + turn + '/>';
    }).join('');
    return '<svg class="solution-thumbnail" viewBox="' + plan.viewBox.map(fixed).join(' ') +
      '" role="img" aria-label="Silhouette du mécanisme — surfaces primitives à l’échelle, sans denture">' +
      body + '</svg>';
  }

  return { build: build, markup: markup, PAD: PAD };
});
