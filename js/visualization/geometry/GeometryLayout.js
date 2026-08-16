/* Placement de la vue « Géométrie 2D ».
 *
 * C'est une vue de DIMENSIONNEMENT : chaque membre est posé à sa cote réelle et
 * porte ses diamètres calculés. Aucune dimension n'est inventée — quand le
 * moteur ne fournit pas une cote, le membre ne la déclare pas.
 * UMD : testable sous Node (tests/geometry-layout.test.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearGeometryLayout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }
  function diameter(geometry) {
    return Math.max(finite(geometry.maxDiameter, 0), finite(geometry.ringDiameter, 0),
      finite(geometry.pitchDiameterInput, 0), finite(geometry.pitchDiameterOutput, 0));
  }
  function present(value) { return Number.isFinite(value) && value > 0 ? value : null; }

  function member(role, kind, cx, cy, sizes, label) {
    return { role: role, kind: kind, cx: cx, cy: cy, label: label,
      pitchDiameter: present(sizes.pitch), outsideDiameter: present(sizes.outside),
      rootDiameter: present(sizes.root), baseDiameter: present(sizes.base),
      teeth: present(sizes.teeth), width: present(sizes.width) };
  }

  /**
   * Membres d'un étage, aux positions réelles issues de l'entraxe calculé.
   * Le repère local a pour origine le centre du membre d'entrée.
   */
  function members(stage, x, y, centerDistance) {
    var g = stage.geometry || {};
    var p = stage.parameters || {};
    var m = finite(p.module, 1);
    var width = finite(g.width, null);
    var type = stage.type === 'epicyclic' ? 'planetary' : stage.type;

    if (type === 'planetary') {
      var sun = finite(g.sunDiameter, m * finite(stage.sunTeeth, 12));
      var ring = finite(g.ringDiameter, m * finite(stage.ringTeeth, 48));
      var planet = finite(g.planetDiameter, (ring - sun) / 2);
      var count = Math.max(2, Math.round(finite(stage.planetCount, 3)));
      var orbit = (sun + planet) / 2;
      var list = [
        member('ring', 'internal-ring', x, y, { pitch: ring, outside: ring + 2 * m, teeth: stage.ringTeeth, width: width }, 'R · couronne'),
        member('sun', 'gear', x, y, { pitch: sun, outside: sun + 2 * m, root: sun - 2.5 * m, teeth: stage.sunTeeth, width: width }, 'S · solaire')
      ];
      for (var i = 0; i < count; i++) {
        var a = 2 * Math.PI * i / count;
        list.push(member('planet', 'gear', x + Math.cos(a) * orbit, y + Math.sin(a) * orbit,
          { pitch: planet, outside: planet + 2 * m, root: planet - 2.5 * m, teeth: stage.planetTeeth, width: width }, 'P · satellite'));
      }
      list.push(member('carrier', 'carrier', x, y, { pitch: 2 * orbit }, 'C · porte-satellites'));
      return list;
    }
    if (type === 'rack') {
      var pinion = finite(g.pitchDiameterInput, m * finite(stage.pinionTeeth, 20));
      return [
        member('input', 'gear', x, y - pinion / 2, { pitch: pinion, outside: finite(g.maxDiameter, pinion + 2 * m),
          root: pinion - 2.5 * m, teeth: stage.pinionTeeth, width: width }, 'Pignon'),
        member('output', 'rack', x, y, { pitch: null, width: width }, 'Crémaillère')
      ];
    }
    if (type === 'bevel') {
      var sigma = finite(g.shaftAngleDeg, 90);
      var d1 = finite(g.pitchDiameterInput, 20), d2 = finite(g.pitchDiameterOutput, 40);
      var out = member('output', 'cone', x + Math.cos(rad(sigma - 90)) * (d1 + d2) / 2,
        y + Math.sin(rad(sigma - 90)) * (d1 + d2) / 2 + d1 / 2,
        { pitch: d2, outside: g.outerDiameterOutput, teeth: stage.output && stage.output.teeth, width: width }, 'Roue conique');
      out.coneAngleDeg = finite(g.pitchConeAngleOutput, 45);
      var input = member('input', 'cone', x, y,
        { pitch: d1, outside: g.outerDiameterInput, teeth: stage.input && stage.input.teeth, width: width }, 'Pignon conique');
      input.coneAngleDeg = finite(g.pitchConeAngleInput, 45);
      input.shaftAngleDeg = sigma;
      return [input, out];
    }
    if (type === 'worm') {
      // Axes perpendiculaires : la roue se place sous la vis, à l'entraxe réel.
      return [
        member('input', 'worm', x, y, { pitch: finite(g.pitchDiameterInput, 10), teeth: stage.wormStarts, width: width }, 'Vis'),
        member('output', 'gear', x, y + centerDistance, { pitch: finite(g.pitchDiameterOutput, 40),
          outside: finite(g.maxDiameter, null), teeth: stage.wheelTeeth, width: width }, 'Roue')
      ];
    }
    if (type === 'internal') {
      return [
        member('output', 'internal-ring', x, y, { pitch: finite(g.pitchDiameterOutput, 60),
          outside: g.outsideDiameterOutput, base: g.baseDiameterOutput, teeth: stage.output && stage.output.teeth, width: width }, 'Couronne'),
        member('input', 'gear', x + centerDistance, y, { pitch: finite(g.pitchDiameterInput, 20),
          outside: g.outsideDiameterInput, root: g.rootDiameterInput, base: g.baseDiameterInput,
          teeth: stage.input && stage.input.teeth, width: width }, 'Pignon')
      ];
    }
    var flexible = type === 'belt' || type === 'chain';
    return [
      member('input', flexible ? (type === 'belt' ? 'pulley' : 'sprocket') : 'gear', x, y,
        { pitch: finite(g.pitchDiameterInput, 20), outside: g.outsideDiameterInput, root: g.rootDiameterInput,
          base: g.baseDiameterInput, teeth: stage.input && stage.input.teeth, width: width },
        flexible ? 'Poulie/pignon entrée' : 'Entrée'),
      member('output', flexible ? (type === 'belt' ? 'pulley' : 'sprocket') : 'gear', x + centerDistance, y,
        { pitch: finite(g.pitchDiameterOutput, 40), outside: g.outsideDiameterOutput, root: g.rootDiameterOutput,
          base: g.baseDiameterOutput, teeth: stage.output && stage.output.teeth, width: width },
        flexible ? 'Poulie/pignon sortie' : 'Sortie')
    ];
  }

  /** Cotes remarquables d'un étage, uniquement celles réellement calculées. */
  function stageDimensions(stage, centerDistance) {
    var g = stage.geometry || {};
    var p = stage.parameters || {};
    var list = [];
    if (present(centerDistance)) list.push({ key: 'centerDistance', label: 'c', value: centerDistance, unit: 'mm' });
    if (present(g.width)) list.push({ key: 'width', label: 'b', value: g.width, unit: 'mm' });
    if (present(p.module)) list.push({ key: 'module', label: 'm', value: p.module, unit: 'mm' });
    if (present(g.travelPerRevolution)) list.push({ key: 'travel', label: 'course/tr', value: g.travelPerRevolution, unit: 'mm' });
    if (present(g.actualLength)) list.push({ key: 'length', label: 'L', value: g.actualLength, unit: 'mm' });
    if (present(g.wrapAngleDeg)) list.push({ key: 'wrap', label: 'enroulement', value: g.wrapAngleDeg, unit: '°' });
    if (present(g.beltTeeth)) list.push({ key: 'beltTeeth', label: 'dents courroie', value: g.beltTeeth, unit: '' });
    if (present(g.links)) list.push({ key: 'links', label: 'maillons', value: g.links, unit: '' });
    if (present(g.coneDistance)) list.push({ key: 'coneDistance', label: 'R', value: g.coneDistance, unit: 'mm' });
    return list;
  }

  function build(solution, options) {
    var opts = options || {};
    // Marges et écarts PROPORTIONNELS au réducteur : un train de pignons de
    // 20 mm et un convoyeur de 2 m doivent occuper la même part du dessin.
    var span = (solution && solution.stages || []).reduce(function (max, stage) {
      return Math.max(max, diameter(stage.geometry || {}));
    }, 20);
    var margin = finite(opts.margin, span * 0.45);
    var gap = finite(opts.stageGap, span * 0.6);
    var headroom = margin * 0.65;
    var cursor = margin, bottom = margin;
    var stages = (solution && solution.stages || []).map(function (stage, index) {
      var geometry = stage.geometry || {};
      var size = Math.max(20, diameter(geometry));
      var center = finite(geometry.correctedCenterDistance, finite(geometry.centerDistance, 0));
      var width = Math.max(size, center + finite(geometry.pitchDiameterInput, 0) / 2 + finite(geometry.pitchDiameterOutput, 0) / 2);
      if (stage.type === 'rack') width = Math.max(width, finite(geometry.travelPerRevolution, size * 2));
      var item = { index: index, stage: stage, type: stage.type, x: cursor + size / 2, y: margin + size / 2 + headroom,
        width: width, height: size + 2 * headroom, diameter: size, centerDistance: center };
      item.members = members(stage, item.x, item.y, center);
      item.dimensions = stageDimensions(stage, center);
      item.axis = { x1: item.x - size / 2 - margin * 0.3, x2: item.x + width + margin * 0.3, y: item.y };
      cursor += width + gap;
      bottom = Math.max(bottom, item.y + size / 2 + headroom * 1.6);
      return item;
    });
    var overall = (solution && solution.dimensions) || {};
    return { stages: stages, margin: margin, headroom: headroom,
      bounds: { x: 0, y: 0, width: Math.max(4 * margin, cursor - gap + margin), height: Math.max(3 * margin, bottom + margin) },
      envelope: { length: present(overall.length), maxDiameter: present(overall.maxDiameter), width: present(overall.width) } };
  }

  return { build: build, members: members, stageDimensions: stageDimensions };
});
