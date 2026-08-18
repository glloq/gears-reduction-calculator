/* Placement de la vue « Géométrie 2D ».
 *
 * C'est une vue de DIMENSIONNEMENT : chaque membre est posé à sa cote réelle et
 * porte ses diamètres calculés. Aucune dimension n'est inventée — quand le
 * moteur ne fournit pas une cote, le membre ne la déclare pas.
 * UMD : testable sous Node (tests/geometry-layout.test.js).
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('../core/SceneBuilder.js') : root.GearSceneBuilder,
    common ? require('../core/MechanicalGraph.js') : root.GearMechanicalGraph,
    common ? require('../core/SpatialLayout.js') : root.GearSpatialLayout);
  if (common) module.exports = api; else root.GearGeometryLayout = api;
})(typeof self !== 'undefined' ? self : this, function (SceneBuilder, MechanicalGraph, SpatialLayout) {
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
      leadAngleDeg: Number.isFinite(g.leadAngleDeg) ? g.leadAngleDeg : null,
      module: present(g.module),
      travelPerRevolution: present(g.travelPerRevolution),
      schematic: !!(entry && entry.schematic),
      exact: entry ? entry.isExact.bind(entry) : function () { return false; }
    }, extra || {});
  }

  /**
   * Membres d'un étage, aux positions que le MODÈLE SPATIAL leur donne.
   *
   * Cette fonction contenait un placement par famille : la roue d'une vis sans
   * fin « sous » la vis, la couronne d'un train intérieur à gauche de son
   * pignon, la roue conique décalée d'une demi-somme de diamètres augmentée
   * d'un demi-diamètre — une formule sans justification mécanique. C'était le
   * troisième placement du projet, avec ses propres conventions, donc sa propre
   * façon de se tromper : rien ne garantissait que la vue cotée et la vue de
   * denture décrivent le même mécanisme.
   *
   * Les positions viennent maintenant de là où viennent celles des autres vues.
   * Ne reste ici que ce qui appartient à une vue de COTATION : les étages sont
   * posés côte à côte, chacun lisible seul, au lieu d'être empilés sur leurs
   * axes réels comme le veut un dessin d'ensemble.
   */
  function members(scene, frame, index, stage) {
    var byRole = {};
    scene.stageMembers(index).forEach(function (entry) { byRole[entry.role] = entry; });
    var type = stage.type === 'epicyclic' ? 'planetary' : stage.type;
    var seat = function (id) { return (frame.seats.byId[id] || { x: 0, y: 0 }); };

    var list = [];
    function put(entry, role, label, extra) {
      if (!entry) return null;
      var at = seat(entry.id);
      var placed = place(entry, role, at.x, at.y, label, extra);
      list.push(placed);
      return placed;
    }

    if (type === 'planetary') {
      var count = Math.max(2, Math.round(finite(byRole.P && byRole.P.count, 3)));
      var orbit = finite(byRole.P && byRole.P.orbitRadius, 0);
      put(byRole.R, 'ring', memberLabel(byRole.R, 'R'));
      put(byRole.S, 'sun', memberLabel(byRole.S, 'S'));
      // Les satellites tournent AUTOUR de l'axe : c'est la seule répartition
      // que la cotation demande de voir, et son rayon vient de la scène.
      var centre = seat((byRole.C || byRole.S || {}).id);
      for (var i = 0; i < count; i++) {
        var a = 2 * Math.PI * i / count;
        list.push(place(byRole.P, 'planet', centre.x + Math.cos(a) * orbit, centre.y + Math.sin(a) * orbit,
          memberLabel(byRole.P, 'P')));
      }
      if (byRole.C) {
        list.push(place(byRole.C, 'carrier', centre.x, centre.y, memberLabel(byRole.C, 'C'),
          { pitchDiameter: orbit ? 2 * orbit : null, count: count }));
      }
      return list;
    }

    if (type === 'rack') {
      // La crémaillère n'est portée par aucun arbre : elle glisse, tangente au
      // cercle primitif du pignon, du côté que le modèle donne à sa glissière.
      var pinion = put(byRole.input, 'input', 'Pignon');
      var slide = (frame.graph.slides || []).filter(function (s) { return s.stageIndex === index; })[0];
      var direction = slide ? Projection2d(slide.direction, frame) : [0, 1];
      var normal = [-direction[1], direction[0]];
      var reach = finite(byRole.input && byRole.input.geometry.pitchDiameter, 20) / 2;
      if (byRole.rack && pinion) {
        list.push(place(byRole.rack, 'output', pinion.cx + normal[0] * reach, pinion.cy + normal[1] * reach,
          'Crémaillère', { linearId: byRole.rack.id, slideAlong: direction }));
      }
      return list;
    }

    var labels = LABELS[type] || LABELS.pair;
    // La couronne d'un train intérieur enveloppe son pignon : on la dessine
    // d'abord, pour que le pignon reste lisible par-dessus.
    if (type === 'internal') {
      put(byRole.output, 'output', labels.output);
      put(byRole.input, 'input', labels.input,
        { shaftAngleDeg: finite((scene.connections[index] || {}).shaftAngleDeg, null) });
    } else {
      put(byRole.input, 'input', labels.input,
        { shaftAngleDeg: finite((scene.connections[index] || {}).shaftAngleDeg, null) });
      put(byRole.output, 'output', labels.output);
    }
    return list;
  }

  /** La direction d'une glissière, telle que la vue courante la projette. */
  function Projection2d(vector, frame) {
    var view = frame.view;
    var x = vector[0] * view.u[0] + vector[1] * view.u[1] + vector[2] * view.u[2];
    var y = vector[0] * view.v[0] + vector[1] * view.v[1] + vector[2] * view.v[2];
    var length = Math.hypot(x, y);
    return length < 1e-9 ? [0, 1] : [x / length, y / length];
  }

  /** Les noms d'organes propres à chaque famille — ils ne se déduisent pas. */
  var LABELS = {
    pair: { input: 'Entrée', output: 'Sortie' },
    belt: { input: 'Poulie/pignon entrée', output: 'Poulie/pignon sortie' },
    chain: { input: 'Poulie/pignon entrée', output: 'Poulie/pignon sortie' },
    worm: { input: 'Vis', output: 'Roue' },
    bevel: { input: 'Pignon conique', output: 'Roue conique' },
    internal: { input: 'Pignon', output: 'Couronne' }
  };

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

  /** L'encombrement dessiné d'un organe : sa denture, ou la course d'un coulisseau. */
  function reachOf(member) {
    return Math.max(finite(member.outsideDiameter, 0), finite(member.pitchDiameter, 0),
      finite(member.travelPerRevolution, 0), 8) / 2;
  }

  function build(solution, options) {
    var opts = options || {};
    var scene = opts.scene && opts.scene.member ? opts.scene : SceneBuilder.build(solution || {});
    var frame = SpatialLayout.frame(MechanicalGraph.build(solution || {}, scene), opts);

    // Marges et écarts PROPORTIONNELS au réducteur : un train de pignons de
    // 20 mm et un convoyeur de 2 m doivent occuper la même part du dessin.
    var span = (solution && solution.stages || []).reduce(function (max, stage) {
      return Math.max(max, diameter(stage.geometry || {}));
    }, 20);
    var margin = finite(opts.margin, span * 0.45);
    var gap = finite(opts.stageGap, span * 0.6);
    var headroom = margin * 0.65;

    // Chaque étage est un AMAS d'organes, à leurs positions réelles les uns par
    // rapport aux autres. On mesure l'amas, puis on le pose : la largeur d'un
    // étage n'est plus devinée d'une formule par famille, elle est celle de ce
    // qu'il contient.
    var clusters = (solution && solution.stages || []).map(function (stage, index) {
      var list = members(scene, frame, index, stage);
      var box = null;
      list.forEach(function (member) {
        var reach = reachOf(member);
        var own = { left: member.cx - reach, top: member.cy - reach,
          right: member.cx + reach, bottom: member.cy + reach };
        box = box ? { left: Math.min(box.left, own.left), top: Math.min(box.top, own.top),
          right: Math.max(box.right, own.right), bottom: Math.max(box.bottom, own.bottom) } : own;
      });
      if (!box) box = { left: 0, top: 0, right: 20, bottom: 20 };
      return { list: list, box: box };
    });

    var cursor = margin, bottom = margin;
    var stages = (solution && solution.stages || []).map(function (stage, index) {
      var cluster = clusters[index];
      var geometry = stage.geometry || {};
      var width = cluster.box.right - cluster.box.left;
      var height = cluster.box.bottom - cluster.box.top;
      var center = finite(geometry.correctedCenterDistance, finite(geometry.centerDistance, 0));
      // L'amas est translaté d'un bloc : ses positions RELATIVES sont celles du
      // modèle, et poser un étage à côté d'un autre n'en change aucune.
      var shiftX = cursor - cluster.box.left;
      var shiftY = margin + headroom - cluster.box.top;
      cluster.list.forEach(function (member) { member.cx += shiftX; member.cy += shiftY; });

      var anchor = cluster.list.filter(function (m) { return m.functionalRole === 'input'; })[0] || cluster.list[0];
      var item = { index: index, stage: stage, type: stage.type,
        x: anchor ? anchor.cx : cursor + width / 2, y: anchor ? anchor.cy : margin + headroom + height / 2,
        width: width, height: height + 2 * headroom,
        diameter: Math.max(20, diameter(geometry)), centerDistance: center };
      item.exactCenterDistance = !!(scene.connections[index] && scene.connections[index].exactCenterDistance);
      item.schematic = scene.stageMembers(index).some(function (entry) { return entry.schematic; });
      item.members = cluster.list;
      item.dimensions = stageDimensions(stage, center);
      // Un seul trait d'axe horizontal par étage supposait que tous ses organes
      // soient alignés. Ils ne le sont pas dès qu'il y a un entraxe : chaque
      // corps porte donc sa propre marque d'axe, à sa place.
      var marks = [];
      cluster.list.forEach(function (member) {
        var key = member.cx.toFixed(2) + ',' + member.cy.toFixed(2);
        if (marks.some(function (mark) { return mark.key === key; })) return;
        marks.push({ key: key, x: member.cx, y: member.cy, reach: reachOf(member) * 1.18 });
      });
      item.axes = marks;
      cursor += width + gap;
      bottom = Math.max(bottom, margin + headroom + height + headroom * 0.6);
      return item;
    });

    var overall = (solution && solution.dimensions) || {};
    return { stages: stages, scene: scene, frame: frame, view: frame.view, margin: margin, headroom: headroom,
      bounds: { x: 0, y: 0, width: Math.max(4 * margin, cursor - gap + margin), height: Math.max(3 * margin, bottom + margin) },
      envelope: { length: present(overall.length), maxDiameter: present(overall.maxDiameter), width: present(overall.width) } };
  }

  return { build: build, members: members, place: place, stageDimensions: stageDimensions };
});
