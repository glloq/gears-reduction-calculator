// SpatialLayout.js - Où chaque pièce se trouve, dans l'espace, une fois pour toutes.
//
// Entre le graphe mécanique — qui dit quels axes et quels corps existent — et
// les vues — qui dessinent —, il manquait l'étape qui donne à chaque organe une
// POSITION. Elle était refaite trois fois, différemment : la première vue avec
// un curseur 2D, la vue de cotation en alignant les étages côte à côte, la
// cinématique avec un troisième repère. Trois placements, donc trois
// mécanismes possibles pour la même solution.
//
// Ici, une seule règle : un membre est sur son axe, à son abscisse.
//
//     position = axe.origine + axe.direction × abscisse
//
// Rien d'autre. Les vues n'ont plus qu'à projeter (ProjectionEngine), ce qui
// garantit qu'aucune ne peut inventer une géométrie que les autres ignorent.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./MechanicalGraph.js') : root.GearMechanicalGraph,
    common ? require('./ProjectionEngine.js') : root.GearProjectionEngine);
  if (common) module.exports = api; else root.GearSpatialLayout = api;
})(typeof self !== 'undefined' ? self : this, function (MechanicalGraph, Projection) {
  'use strict';

  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

  /** La marge d'arbre de part et d'autre des organes qu'il porte. */
  var SHAFT_OVERHANG = 8;

  /**
   * build(graph) → placements monde.
   *
   * Chaque membre reçoit sa position, la direction de son axe, et le rayon qui
   * décide de son encombrement. Chaque arbre reçoit ses deux extrémités : c'est
   * cela qui donne enfin une LONGUEUR aux arbres, au lieu d'un trait de liaison
   * entre deux centres.
   */
  function build(graph) {
    if (!graph || !graph.shafts) return { members: [], shafts: [], bounds: null, graph: graph };

    var members = [], shafts = [];
    graph.shafts.forEach(function (shaft) {
      var axis = graph.byAxis[shaft.axisId];
      if (!axis) return;
      var placed = shaft.members.map(function (member) {
        var radius = finite(member.geometry.outsideDiameter, finite(member.geometry.pitchDiameter, 20)) / 2;
        var entry = {
          id: member.id, shaftId: shaft.id, axisId: axis.id,
          position: add(axis.origin, scale(axis.direction, member.axialPosition)),
          axis: axis.direction,
          axialPosition: member.axialPosition,
          radius: radius, width: finite(member.width, 0),
          kind: member.kind, memberRole: member.memberRole,
          functionalRole: member.functionalRole,
          grounded: !!shaft.grounded,
          geometry: member.geometry, mechanical: member.mechanical
        };
        members.push(entry);
        return entry;
      });
      // Un arbre sans organe n'a pas d'étendue : lui en donner une dessinerait
      // un morceau de métal qui ne porte rien.
      if (!placed.length) return;
      var first = placed[0], last = placed[placed.length - 1];
      var from = first.axialPosition - first.width / 2 - SHAFT_OVERHANG;
      var to = last.axialPosition + last.width / 2 + SHAFT_OVERHANG;
      shafts.push({ id: shaft.id, axisId: axis.id, role: shaft.role, grounded: !!shaft.grounded,
        angularSpeed: shaft.angularSpeed, carriedBy: shaft.carriedBy || null, count: shaft.count || 1,
        direction: axis.direction,
        start: add(axis.origin, scale(axis.direction, from)),
        end: add(axis.origin, scale(axis.direction, to)),
        length: to - from,
        memberIds: placed.map(function (m) { return m.id; }) });
    });

    return { members: members, shafts: shafts, graph: graph,
      byId: members.reduce(function (map, m) { map[m.id] = m; return map; }, {}) };
  }

  /**
   * project(layout, view) → la même scène, vue de quelque part.
   *
   * Les positions ne changent JAMAIS : seule leur image change. C'est
   * exactement ce qu'on veut pouvoir affirmer d'une vue technique — et ce qu'un
   * placement par vue ne permettait pas de garantir.
   */
  function project(layout, viewId) {
    var view = Projection.view(viewId);
    var members = layout.members.map(function (member) {
      var xy = Projection.project(member.position, view);
      return Object.assign({}, member, {
        cx: xy[0], cy: xy[1],
        presentation: Projection.presentation(member.axis, view),
        foreshortening: Projection.foreshortening(member.axis, view),
        // L'axe projeté : c'est lui qui oriente un organe vu de profil.
        axis2d: Projection.project(member.axis, view)
      });
    });
    var shafts = layout.shafts.map(function (shaft) {
      var a = Projection.project(shaft.start, view), b = Projection.project(shaft.end, view);
      return Object.assign({}, shaft, { x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    });
    return { view: view, members: members, shafts: shafts, bounds: bounds(members, shafts),
      byId: members.reduce(function (map, m) { map[m.id] = m; return map; }, {}) };
  }

  function bounds(members, shafts) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    members.forEach(function (m) {
      // Un organe vu de profil occupe sa largeur, pas son diamètre : le prendre
      // pour un disque gonflerait le cadrage d'un facteur dix sur une vis.
      var halfX = m.presentation === 'profile' ? Math.max(m.width, 2) / 2 : m.radius;
      var halfY = m.radius;
      minX = Math.min(minX, m.cx - halfX); maxX = Math.max(maxX, m.cx + halfX);
      minY = Math.min(minY, m.cy - halfY); maxY = Math.max(maxY, m.cy + halfY);
    });
    shafts.forEach(function (s) {
      minX = Math.min(minX, s.x1, s.x2); maxX = Math.max(maxX, s.x1, s.x2);
      minY = Math.min(minY, s.y1, s.y2); maxY = Math.max(maxY, s.y1, s.y2);
    });
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 100, height: 60 };
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  /**
   * DÉPLIER : les angles viennent de la projection, les longueurs restent vraies.
   *
   * Projeter tout, positions comprises, est géométriquement irréprochable et
   * illisible ici : une vue oblique raccourcit les entraxes, et deux roues
   * dessinées en cercles à un entraxe raccourci se chevauchent — un engrènement
   * qu'on lit comme cassé. Le faire proprement demanderait de dessiner chaque
   * roue en ellipse, ce qui est un autre chantier.
   *
   * L'alternative retenue est la convention du dessin d'ensemble de réducteur :
   * on conserve les DIRECTIONS que la projection donne — c'est elles qui
   * portent l'information spatiale, un renvoi à 90° reste un renvoi à 90° — et
   * on garde les LONGUEURS vraies, si bien qu'aucun engrènement ne se décolle
   * et qu'aucun entraxe n'est dessiné plus court qu'il n'est.
   *
   * La cohérence tient à une seule chose : rien n'est ancré indépendamment. La
   * chaîne se construit de proche en proche, chaque arbre à partir de celui
   * dont il descend. Ancrer chaque étage sur sa position projetée pendant que
   * ses longueurs restent vraies faisait dériver les raccords — deux organes
   * d'un même arbre ne se rejoignaient plus.
   */
  function unfold(layout, viewId) {
    var view = Projection.view(viewId);
    var graph = layout && layout.graph;
    if (!graph) return { view: view, byId: {}, shafts: {} };

    function direction2d(vector, fallback) {
      var xy = Projection.project(vector, view);
      var length = Math.hypot(xy[0], xy[1]);
      // Un axe vu en bout n'a pas de direction à l'écran : ses organes se
      // superposent, ce qui est la vérité de cette vue et non un défaut.
      return length < 1e-9 ? (fallback || [0, 0]) : [xy[0] / length, xy[1] / length];
    }

    var shafts = {}, byId = {};
    function draw(shaft, origin, along) {
      shafts[shaft.id] = { origin: origin, along: along };
      shaft.members.forEach(function (member) {
        byId[member.id] = { x: origin[0] + along[0] * member.axialPosition,
          y: origin[1] + along[1] * member.axialPosition, shaftId: shaft.id };
      });
    }

    var first = graph.shafts[0];
    if (!first) return { view: view, byId: byId, shafts: shafts };
    draw(first, [0, 0], direction2d(graph.byAxis[first.axisId].direction, [1, 0]));

    graph.mechanisms.forEach(function (mechanism) {
      var input = mechanism.inputPort, output = mechanism.outputPort;
      if (!input || !output || !output.shaftId) return;
      var source = byId[input.memberId], host = shafts[input.shaftId];
      var target = graph.byShaft[output.shaftId];
      if (!source || !host || !target || shafts[target.id]) return;

      var inAxis = graph.byAxis[graph.byShaft[input.shaftId].axisId];
      var outAxis = graph.byAxis[target.axisId];
      var along = direction2d(outAxis.direction, host.along);

      // La direction de l'engrènement est celle que la projection donne à
      // l'écart entre les deux axes ; sa longueur reste l'entraxe vrai.
      var offset = [outAxis.origin[0] - inAxis.origin[0], outAxis.origin[1] - inAxis.origin[1],
        outAxis.origin[2] - inAxis.origin[2]];
      var span = Math.sqrt(offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2]);
      var toward = direction2d(offset, [-host.along[1], host.along[0]]);
      var driven = graph.byId[output.memberId];
      var seat = [source.x + toward[0] * span, source.y + toward[1] * span];
      draw(target, [seat[0] - along[0] * (driven ? driven.axialPosition : 0),
        seat[1] - along[1] * (driven ? driven.axialPosition : 0)], along);
    });

    // Les corps qu'aucun mécanisme ne relie — couronne bloquée, satellites —
    // partagent l'axe de leur étage : ils se dessinent sur le même tracé.
    graph.shafts.forEach(function (shaft) {
      if (shafts[shaft.id]) return;
      var sibling = null;
      graph.shafts.forEach(function (other) {
        if (!sibling && other.axisId === shaft.axisId && shafts[other.id]) sibling = other;
      });
      var host = sibling ? shafts[sibling.id] : { origin: [0, 0], along: [1, 0] };
      draw(shaft, host.origin, host.along);
    });

    return { view: view, byId: byId, shafts: shafts };
  }

  /** La vue conseillée pour cette transmission — voir ProjectionEngine.auto. */
  function autoView(layout) {
    var axes = (layout && layout.graph && layout.graph.axes) || [];
    return Projection.auto(axes);
  }

  return { build: build, project: project, unfold: unfold, autoView: autoView, bounds: bounds,
    SHAFT_OVERHANG: SHAFT_OVERHANG };
});
