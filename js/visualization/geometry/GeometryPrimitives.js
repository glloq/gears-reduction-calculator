/* Primitives de la vue « Géométrie 2D ».
 *
 * Conventions de trait (portées par les classes CSS, pas par des styles inline) :
 *   trait continu fort  → géométrie physique (tête, jante, crémaillère)
 *   trait fin           → cercle primitif
 *   pointillé           → cercle de base
 *   tiret-point         → axes
 *   trait fin + flèches → cotation
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearGeometryPrimitives = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function node(tag, attrs, text) {
    var element = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (key) { element.setAttribute(key, attrs[key]); });
    if (text != null) element.textContent = text;
    return element;
  }
  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fmt(value, digits) { return Number.isFinite(value) ? value.toFixed(digits == null ? 2 : digits) : '—'; }

  /**
   * Étiquette ancrée en coordonnées monde mais DESSINÉE À TAILLE D'ÉCRAN.
   *
   * Le dessin étant en millimètres, un texte dimensionné en unités monde tombe
   * sous 2 px de fonte pour un réducteur de 150 mm : les navigateurs y perdent
   * le crénage et le texte devient illisible. On écrit donc à une taille de
   * fonte normale dans un groupe mis à l'échelle.
   */
  function label(group, x, y, content, className, options) {
    options = options || {};
    var scale = finite(options.scale, 1);
    var host = node('g', { class: 'viz-label', transform: 'translate(' + finite(x, 0).toFixed(2) + ' ' + finite(y, 0).toFixed(2) + ') scale(' + scale.toFixed(4) + ')' });
    var text = node('text', { x: 0, y: 0, class: className || 'geometry-dimension',
      'text-anchor': options.anchor || 'middle' }, content);
    // La taille est posée en style inline : elle doit primer sur les tailles
    // relatives (em) des classes, qui se rapportent au repère monde.
    text.style.fontSize = finite(options.fontSize, 11).toFixed(2) + 'px';
    if (options.dy) text.setAttribute('dy', options.dy);
    host.appendChild(text);
    group.appendChild(host);
    return host;
  }

  /**
   * L'image d'un cercle, telle qu'on la VOIT.
   *
   * Un cercle primitif était toujours tracé en `<circle>`. Un cercle n'est un
   * cercle que vu de face : de biais c'est une ellipse, et par la tranche un
   * segment. Coter un cercle là où la pièce se présente sur le champ, c'est
   * coter une figure absente du dessin. `apparent` porte les deux demi-axes et
   * l'inclinaison que la projection donne à ce cercle (ProjectedScene).
   */
  function apparentCircle(x, y, diameter, apparent, className, minimum) {
    var value = Number(diameter) || 0;
    var r = Math.max(finite(minimum, 0), value / 2);
    if (!apparent || Math.abs(apparent.major - apparent.minor) < 1e-9) {
      return node('circle', { cx: x, cy: y, r: r * (apparent ? apparent.major : 1),
        class: className, 'data-diameter-mm': value });
    }
    if (apparent.minor < 1e-9) {
      // Le plan du cercle passe par la tranche : il n'en reste qu'un segment,
      // le diamètre vu en vraie grandeur. Un cercle y serait un mensonge.
      var a = apparent.rotationDeg * Math.PI / 180;
      var dx = r * apparent.major * Math.cos(a), dy = r * apparent.major * Math.sin(a);
      return node('line', { x1: (x - dx).toFixed(3), y1: (y - dy).toFixed(3),
        x2: (x + dx).toFixed(3), y2: (y + dy).toFixed(3), class: className, 'data-diameter-mm': value });
    }
    return node('ellipse', { cx: x, cy: y,
      rx: (r * apparent.major).toFixed(3), ry: (r * apparent.minor).toFixed(3),
      transform: 'rotate(' + apparent.rotationDeg.toFixed(3) + ' ' + Number(x).toFixed(3) + ' ' + Number(y).toFixed(3) + ')',
      class: className, 'data-diameter-mm': value });
  }

  /**
   * Cercle primitif coté : c'est le repère de dimensionnement principal.
   * `label` est facultatif — le titre du membre est normalement porté par son
   * groupe, pour que la vis et le porte-satellites, qui n'ont pas de cercle,
   * soient lisibles comme les roues.
   */
  function circle(group, x, y, diameter, className, label, apparent) {
    var element = apparentCircle(x, y, diameter, apparent, className, 4);
    if (label) element.appendChild(node('title', {}, label + ' — Ø primitif ' + fmt(Number(diameter) || 0) + ' mm'));
    group.appendChild(element);
    return element;
  }

  /** Diamètre secondaire (tête, pied, base) : couche « pitch » activable. */
  function outline(group, x, y, diameter, className, label, apparent) {
    if (!Number.isFinite(diameter) || diameter <= 0) return null;
    var element = apparentCircle(x, y, diameter, apparent, className, 0);
    if (label) element.appendChild(node('title', {}, label + ' ' + fmt(diameter) + ' mm'));
    group.appendChild(element);
    return element;
  }

  /**
   * Une roue vue par la tranche : son encombrement est un rectangle b × Ø, et
   * son cercle primitif deux génératrices. C'est le dessin d'un cylindre vu de
   * côté — pas un disque, qui supposerait qu'on le regarde de face.
   */
  function profileBody(group, member, className) {
    var width = Math.max(1.5, finite(member.width, 4));
    var tip = finite(member.outsideDiameter, finite(member.pitchDiameter, 20));
    var angle = finite(member.axisAngleDeg, 0);
    var squeeze = finite(member.axialScale, 1);
    var host = node('g', { class: 'profile-body',
      transform: 'translate(' + finite(member.cx, 0).toFixed(3) + ' ' + finite(member.cy, 0).toFixed(3) +
        ') rotate(' + angle.toFixed(3) + ')' + (Math.abs(squeeze - 1) < 1e-6 ? '' : ' scale(' + squeeze.toFixed(4) + ' 1)') });
    host.appendChild(node('rect', { class: className, x: (-width / 2).toFixed(3), y: (-tip / 2).toFixed(3),
      width: width.toFixed(3), height: tip.toFixed(3), 'data-diameter-mm': tip }));
    var pitch = finite(member.pitchDiameter, 0);
    if (pitch > 0) {
      [-1, 1].forEach(function (side) {
        host.appendChild(node('line', { class: 'pitch-generatrix construction-circle',
          x1: (-width / 2 - 1).toFixed(3), y1: (side * pitch / 2).toFixed(3),
          x2: (width / 2 + 1).toFixed(3), y2: (side * pitch / 2).toFixed(3), 'data-diameter-mm': pitch }));
      });
    }
    group.appendChild(host);
    return host;
  }

  function axis(group, x1, y1, x2, y2) {
    return group.appendChild(node('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'shaft-axis construction-axis' }));
  }

  /** Crémaillère au pas réel π·m, sur toute la course calculée. */
  function rack(group, x, y, length, moduleValue) {
    var m = Math.max(0.1, finite(moduleValue, 1));
    var pitch = Math.PI * m;
    var start = x - length / 2;
    var points = [];
    for (var px = start; px <= start + length; px += pitch) {
      points.push(px.toFixed(2) + ',' + (y + 1.25 * m).toFixed(2));
      points.push((px + pitch / 4).toFixed(2) + ',' + (y - m).toFixed(2));
      points.push((px + 3 * pitch / 4).toFixed(2) + ',' + (y - m).toFixed(2));
      points.push((px + pitch).toFixed(2) + ',' + (y + 1.25 * m).toFixed(2));
    }
    return group.appendChild(node('polyline', { points: points.join(' '), class: 'rack-profile' }));
  }

  /** Silhouette conique : cône primitif au demi-angle réel. */
  function cone(group, x, y, pitchDiameter, coneAngleDeg, faceWidth, className) {
    var back = finite(pitchDiameter, 20) / 2;
    var delta = finite(coneAngleDeg, 45) * Math.PI / 180;
    var face = Math.max(4, finite(faceWidth, back / 2));
    var depth = Math.max(3, face * Math.cos(delta));
    var front = Math.max(1, back - face * Math.sin(delta));
    return group.appendChild(node('path', {
      class: className || 'geometry-member cone-member',
      d: 'M ' + x + ' ' + (y - back).toFixed(2) + ' L ' + (x + depth).toFixed(2) + ' ' + (y - front).toFixed(2) +
        ' L ' + (x + depth).toFixed(2) + ' ' + (y + front).toFixed(2) + ' L ' + x + ' ' + (y + back).toFixed(2) + ' Z'
    }));
  }

  /** Vis sans fin : corps cylindrique et axe, vus de côté. */
  /**
   * §15 : la vis est vue DE PROFIL. Son corps ne bouge pas et son axe non
   * plus ; ce sont ses filets qui défilent le long de l'axe. La vue Géométrie
   * y faisait tourner une aiguille radiale, comme si la vis était vue de face
   * — un mouvement que la pièce ne fait pas.
   *
   * La géométrie du filetage vient du même calcul que la vue Denture, pour que
   * les deux vues montrent le même nombre de filets au même pas.
   *
   * @returns {SVGElement} le groupe des filets, le seul à animer.
   */
  function worm(group, x, y, pitchDiameter, moduleValue, className, options) {
    options = options || {};
    var m = Math.max(0.1, finite(moduleValue, 1));
    var g = typeof GearTeethPrimitives !== 'undefined' && GearTeethPrimitives.wormGeometry
      ? GearTeethPrimitives.wormGeometry({ kind: 'worm', pitchD: finite(pitchDiameter, 10), module: m,
        teeth: options.starts, leadAngle: options.leadAngleDeg })
      : { radius: Math.max(2, finite(pitchDiameter, 10) / 2), length: Math.max(4 * finite(pitchDiameter, 10) / 2, 20 * m),
        module: m, starts: 1, pitch: Math.PI * m, lead: 0 };
    var r = g.radius, length = g.length;
    // Cylindre vu de côté : un rectangle. `rx = r` en faisait une capsule à
    // extrémités hémisphériques, une forme qu'aucune vis n'a.
    group.appendChild(node('rect', { class: className || 'geometry-member worm-member',
      x: (x - length / 2).toFixed(2), y: (y - r).toFixed(2), width: length.toFixed(2), height: (2 * r).toFixed(2) }));
    group.appendChild(node('line', { class: 'shaft-axis construction-axis',
      x1: (x - length / 2 - 3 * m).toFixed(2), y1: y, x2: (x + length / 2 + 3 * m).toFixed(2), y2: y }));

    // Les filets débordent de deux pas de chaque côté : sans ce débord, un
    // filet disparaîtrait d'un bord avant que le suivant n'entre par l'autre,
    // et la boucle sauterait à chaque tour.
    var margin = (typeof GearTeethPrimitives !== 'undefined' && GearTeethPrimitives.WORM_MARGIN_PITCHES ? GearTeethPrimitives.WORM_MARGIN_PITCHES : 2) * g.pitch;
    // Le débord doit être MASQUÉ, pas seulement dessiné : sans clip les filets
    // défilaient hors du corps, flottant devant l'arbre.
    // L'identifiant doit être unique PAR VIS : deux vis dans la même chaîne
    // partageaient sinon un masque dimensionné pour l'une des deux, et la
    // seconde se voyait tronquer aux bornes de la première.
    var clipId = (typeof GearTeethPrimitives !== 'undefined' && GearTeethPrimitives.wormClipId
      ? GearTeethPrimitives.wormClipId({ id: options.memberId }) : 'worm-clip') + '-geometry';
    var clip = node('clipPath', { id: clipId });
    clip.appendChild(node('rect', { x: (x - length / 2).toFixed(2), y: (y - r).toFixed(2),
      width: length.toFixed(2), height: (2 * r).toFixed(2) }));
    group.appendChild(clip);
    var clipped = node('g', { class: 'worm-thread-clip', 'clip-path': 'url(#' + clipId + ')' });
    var phase = node('g', { class: 'worm-thread-phase' });
    for (var start = -length / 2 - margin; start < length / 2 + margin; start += g.pitch) {
      for (var k = 0; k < g.starts; k++) {
        var offset = start + k * g.pitch / g.starts;
        var d = '';
        for (var i = 0; i <= 8; i++) {
          var t = i / 8;
          var px = x + offset + t * g.pitch / g.starts;
          var py = y - r * Math.cos(Math.PI * t) * Math.cos(g.lead);
          d += (d ? ' L ' : 'M ') + px.toFixed(2) + ' ' + py.toFixed(2);
        }
        phase.appendChild(node('path', { class: 'worm-thread', d: d }));
      }
    }
    clipped.appendChild(phase);
    group.appendChild(clipped);
    phase.dataset.pitch = g.pitch.toFixed(4);
    return phase;
  }

  /** Bras du porte-satellites : rend le membre C lisible sans l'animer. */
  /**
   * Les bras du porte-satellites. `basis` est la base de phase de son axe :
   * sans elle les bras décriraient un cercle d'écran, alors qu'ils suivent le
   * plan d'orbite — une ellipse de biais, un segment par la tranche.
   */
  function carrier(group, x, y, orbit, count, basis, angle) {
    var theta = Number.isFinite(angle) ? angle : 0;
    var d = '';
    for (var i = 0; i < count; i++) {
      var a = 2 * Math.PI * i / count + theta;
      var point = basis ? [orbit * (Math.cos(a) * basis.first[0] + Math.sin(a) * basis.second[0]),
        orbit * (Math.cos(a) * basis.first[1] + Math.sin(a) * basis.second[1])]
        : [Math.cos(a) * orbit, Math.sin(a) * orbit];
      d += ' M ' + x + ' ' + y + ' L ' + (x + point[0]).toFixed(2) + ' ' + (y + point[1]).toFixed(2);
    }
    return group.appendChild(node('path', { class: 'geometry-member carrier-member', d: d.trim() }));
  }

  return { node: node, label: label, circle: circle, outline: outline, apparentCircle: apparentCircle,
    profileBody: profileBody, axis: axis, rack: rack, cone: cone, worm: worm, carrier: carrier, format: fmt };
});
