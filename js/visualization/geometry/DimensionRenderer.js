/* Cotation de la vue « Géométrie 2D ».
 *
 * Deux niveaux :
 *   - par étage  : Ø primitif, Ø extérieur, entraxe, largeur, module ;
 *   - global     : longueur, hauteur, largeur, enveloppe.
 * Aucune cote n'est fabriquée : chaque valeur vient de stage.geometry ou de
 * solution.dimensions, et une cote absente n'est simplement pas tracée.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearDimensionRenderer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fmt(value, digits) { return Number.isFinite(value) ? value.toFixed(digits == null ? 2 : digits) : '—'; }
  function has(value) { return Number.isFinite(value) && value > 0; }

  /** Cote linéaire avec lignes d'attache et flèches aux extrémités. */
  function linear(group, primitives, x1, y1, x2, y2, text, extend, scale) {
    var p = primitives;
    if (extend) {
      // Les lignes d'attache joignent la pièce à sa cote, où que celle-ci soit
      // posée : les faire partir d'une ordonnée seule supposait une cote à plat.
      var fromX = Number.isFinite(extend.fromX) ? extend.fromX : x1;
      var toX = Number.isFinite(extend.toX) ? extend.toX : x2;
      var fromY = Number.isFinite(extend.fromY) ? extend.fromY : extend.from;
      var toY = Number.isFinite(extend.toY) ? extend.toY : extend.to;
      group.appendChild(p.node('line', { x1: fromX, y1: fromY, x2: x1, y2: y1, class: 'dimension-witness' }));
      group.appendChild(p.node('line', { x1: toX, y1: toY, x2: x2, y2: y2, class: 'dimension-witness' }));
    }
    group.appendChild(p.node('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'dimension-line', 'marker-start': 'url(#dimension-arrow-start)', 'marker-end': 'url(#dimension-arrow-end)' }));
    p.label(group, (x1 + x2) / 2, (y1 + y2) / 2 - finite(scale, 1) * 4, text, 'geometry-dimension', { scale: scale });
    return group;
  }

  /** Cote de diamètre : trait traversant le cercle et valeur au bord. */
  function diameter(group, primitives, member, value, prefix, className, offset, scale) {
    if (!has(value)) return null;
    var r = value / 2;
    var g = primitives.node('g', { class: 'diameter-dimension ' + (className || '') });
    g.appendChild(primitives.node('line', { x1: (member.cx - r).toFixed(2), y1: member.cy, x2: (member.cx + r).toFixed(2), y2: member.cy,
      class: 'dimension-line', 'marker-start': 'url(#dimension-arrow-start)', 'marker-end': 'url(#dimension-arrow-end)' }));
    primitives.label(g, member.cx, member.cy + finite(offset, -3), (prefix || 'Ø') + ' ' + fmt(value) + ' mm', 'geometry-dimension', { scale: scale });
    group.appendChild(g);
    return g;
  }

  /**
   * stage(group, item, primitives) — cotation complète d'un étage : entraxe,
   * diamètres primitifs et extérieurs, puis le bloc textuel des cotes scalaires
   * (module, largeur, longueur développée, enroulement…).
   */
  function stage(group, item, primitives, options) {
    var members = item.members || [];
    // Le pas de texte est exprimé en unités monde équivalant à une hauteur
    // d'écran fixe : les cotes restent lisibles à toutes les échelles.
    var scale = finite(options && options.scale, 1);
    var step = finite(options && options.fontSize, 11) * 1.35;
    var baseline = item.y + item.diameter / 2 + step * 2;

    if (has(item.centerDistance)) {
      var exactCenter = item.exactCenterDistance !== false;
      var a = members[0], b = members[1];
      var text = (exactCenter ? 'c = ' : '~ c = ') + fmt(item.centerDistance) + ' mm';
      if (a && b) {
        // La cote d'entraxe se posait à plat, entre les abscisses des deux
        // centres : elle supposait qu'un entraxe est horizontal. Il ne l'est
        // que dans certaines vues, et depuis que le placement vient du modèle
        // spatial elle se réduisait à un point au milieu de la roue. Elle suit
        // maintenant le segment qui joint les deux centres, décalée de côté.
        var dx = b.cx - a.cx, dy = b.cy - a.cy;
        var span = Math.hypot(dx, dy);
        if (span < 1e-6) {
          // Deux organes concentriques : leur entraxe est nul, il n'y a rien à
          // coter, et un trait de longueur nulle ne dirait rien de plus.
          primitives.label(group, a.cx, baseline, text, 'geometry-dimension', { scale: scale });
        } else {
          var off = (item.diameter / 2 + step * 1.6);
          var nx = -dy / span * off, ny = dx / span * off;
          linear(group, primitives, a.cx + nx, a.cy + ny, b.cx + nx, b.cy + ny, text,
            { fromX: a.cx, fromY: a.cy, toX: b.cx, toY: b.cy }, scale);
        }
      } else {
        linear(group, primitives, item.x, baseline, item.x + item.centerDistance, baseline, text, null, scale);
      }
    }

    // Les cotes de diamètre sont empilées : deux roues concentriques (ou
    // simplement proches) ne doivent jamais superposer leurs valeurs.
    // Une cote RECONSTRUITE est marquée « ~ » et prend la classe `schematic` :
    // sur un plan, une valeur non calculée ne doit pas se lire comme une cote.
    // Le centre de gravité de l'étage : les cotes de diamètre extérieur se
    // posent du côté OPPOSÉ, pour qu'un petit pignon n'écrive pas sa valeur
    // sur la grande roue qu'il touche. Les poser toujours au-dessus supposait
    // que les organes d'un étage sont côte à côte.
    var cotable = members.filter(function (member) { return member.role !== 'planet' && member.role !== 'carrier'; });
    var focus = cotable.reduce(function (sum, member) {
      return { x: sum.x + member.cx / cotable.length, y: sum.y + member.cy / cotable.length };
    }, { x: 0, y: 0 });
    cotable.forEach(function (member, index) {
        var exactPitch = member.exact ? member.exact('pitchDiameter') : true;
        diameter(group, primitives, member, member.pitchDiameter, exactPitch ? 'Ø' : '~ Ø',
          'pitch-diameter' + (exactPitch ? '' : ' schematic'), -step * (index + 0.4), scale);
        if (has(member.outsideDiameter) && Math.abs(member.outsideDiameter - member.pitchDiameter) > 0.05) {
          var exactTip = member.exact ? member.exact('outsideDiameter') : true;
          // Vers le haut par défaut ; vers le bas si c'est là que l'étage laisse
          // de la place.
          var away = member.cy > focus.y || (member.cy === focus.y && cotable.length < 2) ? 1 : -1;
          primitives.label(group, member.cx,
            member.cy + away * (member.outsideDiameter / 2 + step * (index + 0.5)),
            (exactTip ? 'Ø tête ' : '~ Ø tête ') + fmt(member.outsideDiameter) + ' mm',
            'geometry-dimension outside-diameter' + (exactTip ? '' : ' schematic'), { scale: scale });
        }
      });

    // Cotes scalaires : une ligne par valeur réellement calculée.
    (item.dimensions || []).filter(function (entry) { return entry.key !== 'centerDistance'; })
      .forEach(function (entry, index) {
        primitives.label(group, item.x - item.diameter / 2, baseline + step * (1.4 + index),
          entry.label + ' = ' + fmt(entry.value, entry.unit === '' ? 0 : 2) + (entry.unit ? ' ' + entry.unit : ''),
          'geometry-dimension', { scale: scale, anchor: 'start' });
      });
    return group;
  }

  /** Enveloppe globale : cadre + longueur, hauteur et largeur du réducteur. */
  function envelope(group, layout, primitives, options) {
    var b = layout.bounds;
    var inset = finite(options && options.fontSize, 11);
    group.appendChild(primitives.node('rect', { x: inset, y: inset, width: Math.max(1, b.width - 2 * inset), height: Math.max(1, b.height - 2 * inset), class: 'geometry-envelope' }));
    var overall = layout.envelope || {};
    var parts = [];
    if (has(overall.length)) parts.push('longueur ' + fmt(overall.length, 0) + ' mm');
    if (has(overall.maxDiameter)) parts.push('Ø max ' + fmt(overall.maxDiameter, 0) + ' mm');
    if (has(overall.width)) parts.push('largeur ' + fmt(overall.width, 0) + ' mm');
    var label = parts.length ? 'Encombrement — ' + parts.join(' · ')
      : 'Encombrement du dessin ' + fmt(b.width, 0) + ' × ' + fmt(b.height, 0);
    primitives.label(group, b.width / 2, b.height - inset * 1.6, label, 'geometry-dimension', { scale: finite(options && options.scale, 1) });
    return group;
  }

  /**
   * Marqueurs de flèche partagés par toutes les cotes de la vue.
   * Dimensionnés en unités monde (userSpaceOnUse) à partir de la taille de
   * texte : avec markerUnits="strokeWidth", une flèche vaudrait plusieurs
   * millimètres et écraserait la cote qu'elle borne.
   */
  function defs(primitives, options) {
    var size = finite(options && options.fontSize, 11) * 0.55;
    var host = primitives.node('defs', {});
    [['dimension-arrow-start', 'M 6 0 L 0 2 L 6 4 Z', 6], ['dimension-arrow-end', 'M 0 0 L 6 2 L 0 4 Z', 0]].forEach(function (entry) {
      var marker = primitives.node('marker', { id: entry[0], viewBox: '0 0 6 4', refX: entry[2], refY: 2,
        markerWidth: size.toFixed(3), markerHeight: (size * 0.7).toFixed(3), orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
      marker.appendChild(primitives.node('path', { d: entry[1], class: 'dimension-arrow' }));
      host.appendChild(marker);
    });
    return host;
  }

  return { stage: stage, envelope: envelope, linear: linear, diameter: diameter, defs: defs };
});
