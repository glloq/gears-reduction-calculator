/* Placement de la vue « Géométrie 2D ».
 *
 * C'est une vue de DIMENSIONNEMENT : chaque membre est posé à sa cote réelle et
 * porte ses diamètres calculés. Aucune dimension n'est inventée — quand le
 * moteur ne fournit pas une cote, le membre ne la déclare pas.
 * UMD : testable sous Node (tests/geometry-layout.test.js).
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('../core/SceneBuilder.js') : root.GearSceneBuilder);
  if (common) module.exports = api; else root.GearGeometryLayout = api;
})(typeof self !== 'undefined' ? self : this, function (SceneBuilder) {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }
  function diameter(geometry) {
    return Math.max(finite(geometry.maxDiameter, 0), finite(geometry.ringDiameter, 0),
      finite(geometry.pitchDiameterInput, 0), finite(geometry.pitchDiameterOutput, 0));
  }
  function present(value) { return Number.isFinite(value) && value > 0 ? value : null; }

  /**
   * §9, §10 : « Couronne (R) · Fixe ». La vue affichait « R · couronne » —
   * le code d'abord, la fonction nulle part — si bien qu'on ne pouvait pas
   * lire sur le dessin quel organe était bloqué. Le nom et la fonction
   * viennent de la scène ; cette vue ne traduit rien elle-même.
   */
  function memberLabel(entry, code) {
    if (!entry) return code;
    var role = entry.localizedRole ? ' · ' + entry.localizedRole : '';
    return (entry.memberName || code) + ' (' + code + ')' + role;
  }

  /**
   * Membre positionné, construit à partir d'un MEMBRE DE LA SCÈNE.
   * `schematic` propage la provenance : une cote reconstruite ne doit pas être
   * cotée comme si le moteur l'avait calculée.
   */
  function place(entry, role, cx, cy, label, extra) {
    var g = entry ? entry.geometry : {};
    return Object.assign({
      memberId: entry ? entry.id : null,
      role: role, kind: entry ? entry.kind : 'gear', cx: cx, cy: cy, label: label,
      // La fonction et le nom viennent de la scène : la vue ne les redéduit pas.
      functionalRole: entry ? entry.functionalRole : null,
      memberName: entry ? entry.memberName : null,
      localizedRole: entry ? entry.localizedRole : null,
      rotationDisplayMode: entry ? entry.rotationDisplayMode : null,
      pitchDiameter: present(g.pitchDiameter), outsideDiameter: present(g.outsideDiameter),
      rootDiameter: present(g.rootDiameter), baseDiameter: present(g.baseDiameter),
      teeth: present(g.teeth), width: present(g.width),
      coneAngleDeg: Number.isFinite(g.coneAngleDeg) ? g.coneAngleDeg : null,
      travelPerRevolution: present(g.travelPerRevolution),
      schematic: !!(entry && entry.schematic),
      exact: entry ? entry.isExact.bind(entry) : function () { return false; }
    }, extra || {});
  }

  /**
   * Membres d'un étage, aux positions réelles issues de l'entraxe calculé.
   * Le repère local a pour origine le centre du membre d'entrée.
   */
  function members(scene, index, stage, x, y, centerDistance) {
    var byRole = {};
    scene.stageMembers(index).forEach(function (entry) { byRole[entry.role] = entry; });
    var type = stage.type === 'epicyclic' ? 'planetary' : stage.type;

    if (type === 'planetary') {
      var count = Math.max(2, Math.round(finite(byRole.P && byRole.P.count, 3)));
      var orbit = finite(byRole.P && byRole.P.orbitRadius, 0);
      var list = [
        place(byRole.R, 'ring', x, y, memberLabel(byRole.R, 'R')),
        place(byRole.S, 'sun', x, y, memberLabel(byRole.S, 'S'))
      ];
      for (var i = 0; i < count; i++) {
        var a = 2 * Math.PI * i / count;
        list.push(place(byRole.P, 'planet', x + Math.cos(a) * orbit, y + Math.sin(a) * orbit, memberLabel(byRole.P, 'P')));
      }
      list.push(place(byRole.C, 'carrier', x, y, memberLabel(byRole.C, 'C'),
        { pitchDiameter: orbit ? 2 * orbit : null, count: count }));
      return list;
    }
    if (type === 'rack') {
      var pinionD = finite(byRole.input && byRole.input.geometry.pitchDiameter, 20);
      return [
        place(byRole.input, 'input', x, y - pinionD / 2, 'Pignon'),
        place(byRole.rack, 'output', x, y, 'Crémaillère', { linearId: byRole.rack ? byRole.rack.id : null })
      ];
    }
    if (type === 'bevel') {
      var sigma = finite((scene.connections[index] || {}).shaftAngleDeg, 90);
      var d1 = finite(byRole.input && byRole.input.geometry.pitchDiameter, 20);
      var d2 = finite(byRole.output && byRole.output.geometry.pitchDiameter, 40);
      var input = place(byRole.input, 'input', x, y, 'Pignon conique', { shaftAngleDeg: sigma });
      var output = place(byRole.output, 'output',
        x + Math.cos(rad(sigma - 90)) * (d1 + d2) / 2,
        y + Math.sin(rad(sigma - 90)) * (d1 + d2) / 2 + d1 / 2, 'Roue conique');
      return [input, output];
    }
    if (type === 'worm') {
      // Axes perpendiculaires : la roue se place sous la vis, à l'entraxe réel.
      return [
        place(byRole.input, 'input', x, y, 'Vis'),
        place(byRole.output, 'output', x, y + centerDistance, 'Roue')
      ];
    }
    if (type === 'internal') {
      return [
        place(byRole.output, 'output', x, y, 'Couronne'),
        place(byRole.input, 'input', x + centerDistance, y, 'Pignon')
      ];
    }
    var flexible = type === 'belt' || type === 'chain';
    return [
      place(byRole.input, 'input', x, y, flexible ? 'Poulie/pignon entrée' : 'Entrée'),
      place(byRole.output, 'output', x + centerDistance, y, flexible ? 'Poulie/pignon sortie' : 'Sortie')
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
    var scene = opts.scene && opts.scene.member ? opts.scene : SceneBuilder.build(solution || {});
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
      item.exactCenterDistance = !!(scene.connections[index] && scene.connections[index].exactCenterDistance);
      item.schematic = scene.stageMembers(index).some(function (entry) { return entry.schematic; });
      item.members = members(scene, index, stage, item.x, item.y, center);
      item.dimensions = stageDimensions(stage, center);
      item.axis = { x1: item.x - size / 2 - margin * 0.3, x2: item.x + width + margin * 0.3, y: item.y };
      cursor += width + gap;
      bottom = Math.max(bottom, item.y + size / 2 + headroom * 1.6);
      return item;
    });
    var overall = (solution && solution.dimensions) || {};
    return { stages: stages, scene: scene, margin: margin, headroom: headroom,
      bounds: { x: 0, y: 0, width: Math.max(4 * margin, cursor - gap + margin), height: Math.max(3 * margin, bottom + margin) },
      envelope: { length: present(overall.length), maxDiameter: present(overall.maxDiameter), width: present(overall.width) } };
  }

  return { build: build, members: members, place: place, stageDimensions: stageDimensions };
});
