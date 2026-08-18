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
    common ? require('../core/SpatialLayout.js') : root.GearSpatialLayout,
    common ? require('../core/FlexibleDriveGeometry.js') : root.GearFlexibleDriveGeometry,
    common ? require('../core/ProjectedScene.js') : root.GearProjectedScene,
    common ? require('../overlays/ForceOverlay.js') : root.GearForceOverlay);
  if (common) module.exports = api; else root.GearGeometryLayout = api;
})(typeof self !== 'undefined' ? self : this, function (SceneBuilder, MechanicalGraph, SpatialLayout, FlexibleDrive, ProjectedScene, ForceOverlay) {
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
  /**
   * Comment cet organe SE PRÉSENTE dans la vue courante. La vue cotée dessinait
   * toute roue en cercle : de biais un cercle primitif est une ellipse, et par
   * la tranche un segment. Coter un cercle là où la pièce se voit sur le champ,
   * c'est coter une figure que le dessin ne montre pas.
   */
  function orientation(frame, id) {
    var seen = frame.projected && frame.projected.member(id);
    if (!seen) return {};
    // Ce qui suit l'axe se RACCOURCIT ; ce qui le traverse garde sa longueur.
    // Le grand axe de l'ellipse apparente vaut toujours 1 — c'est la direction
    // où un diamètre se mesure —, et son petit axe est le cosinus de l'axe sur
    // le regard : la longueur apparente de l'axe en est le sinus. En vue
    // dépliée, rien ne se raccourcit : c'est ce qu'elle promet.
    var minor = seen.apparent ? seen.apparent.minor : 1;
    return { presentation: seen.presentation, foreshortening: seen.foreshortening,
      facing: seen.facing, phaseBasis: seen.basis, apparent: seen.apparent,
      axisAngleDeg: seen.axisAngleDeg, depth: seen.depth,
      axialScale: frame.mode === 'unfolded' ? 1 : Math.sqrt(Math.max(0, 1 - minor * minor)) };
  }

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
      var placed = place(entry, role, at.x, at.y, label, Object.assign(orientation(frame, entry.id), extra || {}));
      list.push(placed);
      return placed;
    }

    if (type === 'planetary') {
      var count = Math.max(2, Math.round(finite(byRole.P && byRole.P.count, 3)));
      var orbit = finite(byRole.P && byRole.P.orbitRadius, 0);
      put(byRole.R, 'ring', memberLabel(byRole.R, 'R'));
      put(byRole.S, 'sun', memberLabel(byRole.S, 'S'));
      // Les satellites tournent AUTOUR de l'axe, dans le plan perpendiculaire
      // à celui-ci. Ils étaient répartis en cos/sin d'écran : un cercle, même
      // quand la vue montre leur plan de biais ou par la tranche.
      var hub = (byRole.C || byRole.S || {}).id;
      var centre = seat(hub);
      var placedHub = frame.spatial.byId[hub];
      var basis = ProjectedScene.phaseBasis(placedHub ? placedHub.axis : [1, 0, 0], frame.view);
      var orbiting = { orbit: orbit, orbitCenterX: centre.x, orbitCenterY: centre.y, orbitBasis: basis };
      for (var i = 0; i < count; i++) {
        var a = 2 * Math.PI * i / count;
        var offset = ProjectedScene.phasePoint(basis, orbit, a);
        list.push(place(byRole.P, 'planet', centre.x + offset[0], centre.y + offset[1],
          memberLabel(byRole.P, 'P'), Object.assign(orientation(frame, byRole.P.id), { phase: a }, orbiting)));
      }
      if (byRole.C) {
        list.push(place(byRole.C, 'carrier', centre.x, centre.y, memberLabel(byRole.C, 'C'),
          Object.assign(orientation(frame, byRole.C.id),
            { pitchDiameter: orbit ? 2 * orbit : null, count: count }, orbiting)));
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
          'Crémaillère', Object.assign(orientation(frame, byRole.rack.id),
            { linearId: byRole.rack.id, slideAlong: direction })));
      }
      return list;
    }

    var labels = LABELS[type] || LABELS.pair;
    // Couple conique : de quel côté de chaque organe se trouve le sommet
    // commun. Sans cette réponse, l'un des deux cônes est dessiné pointe en
    // dehors du couple, et le dessin montre deux cônes qui se tournent le dos.
    var apex = coneSides(frame, byRole.input, byRole.output);
    // La couronne d'un train intérieur enveloppe son pignon : on la dessine
    // d'abord, pour que le pignon reste lisible par-dessus.
    if (type === 'internal') {
      put(byRole.output, 'output', labels.output);
      put(byRole.input, 'input', labels.input,
        { shaftAngleDeg: finite((scene.connections[index] || {}).shaftAngleDeg, null) });
    } else {
      put(byRole.input, 'input', labels.input,
        { shaftAngleDeg: finite((scene.connections[index] || {}).shaftAngleDeg, null),
          apexSide: apex ? apex.sideA : null });
      put(byRole.output, 'output', labels.output, { apexSide: apex ? apex.sideB : null });
    }
    return list;
  }

  /**
   * Le repère mécanique des efforts d'un étage, et leur point d'application —
   * le point primitif, sur la ligne des centres dessinée. Sans ligne des
   * centres, pas de repère, et donc aucune flèche : une direction inventée
   * vaut moins que rien sur un dessin coté.
   */
  function forceFrameOf(frame, scene, index, list) {
    var vector = MechanicalGraph.vector;
    var byRole = {};
    scene.stageMembers(index).forEach(function (entry) { byRole[entry.role] = entry; });
    function placed(entry) { return entry && frame.spatial.byId[entry.id]; }
    var driver = placed(byRole.input) || placed(byRole.S);
    if (!driver) return null;
    var driven = placed(byRole.output) || placed(byRole.P);
    var mate = driven ? driven.position : null;
    var planet = list.filter(function (m) { return m.role === 'planet'; })[0];
    // Un satellite n'a pas encore de position propre dans le modèle spatial :
    // sa ligne des centres est le rayon d'orbite qui sert à le dessiner.
    if (mate && planet && planet.orbit > 0) {
      var offset = [mate[0] - driver.position[0], mate[1] - driver.position[1], mate[2] - driver.position[2]];
      var alongAxis = vector.dot(offset, driver.axis);
      var across = vector.norm([offset[0] - driver.axis[0] * alongAxis,
        offset[1] - driver.axis[1] * alongAxis, offset[2] - driver.axis[2] * alongAxis]);
      if (across < 1e-9) {
        mate = vector.add(driver.position,
          vector.scale(vector.perpendicularDirection(driver.axis, 0), planet.orbit));
      }
    }
    if (!mate) {
      var slide = (frame.graph.slides || []).filter(function (s) { return s.stageIndex === index; })[0];
      if (!slide) return null;
      mate = vector.add(driver.position, vector.cross(driver.axis, slide.direction));
    }
    function drawn(id) { return list.filter(function (m) { return m.memberId === id; })[0] || null; }
    var from = drawn(byRole.input ? byRole.input.id : (byRole.S || {}).id) ||
      list.filter(function (m) { return m.role === 'sun'; })[0];
    var to = planet || drawn(byRole.output ? byRole.output.id : null) ||
      list.filter(function (m) { return m.kind === 'rack'; })[0];
    if (!from) return null;
    var origin = [from.cx, from.cy];
    if (to) {
      var dx = to.cx - from.cx, dy = to.cy - from.cy;
      var span = Math.hypot(dx, dy);
      if (span > 1e-9) {
        var reach = Math.min(finite(from.pitchDiameter, 0) / 2, span);
        origin = [from.cx + dx / span * reach, from.cy + dy / span * reach];
      }
    }
    return ForceOverlay.frame({ axis: driver.axis, centre: driver.position, mate: mate,
      view: frame.view, origin: origin });
  }

  /** Les deux côtés du sommet commun d'un couple conique, ou null. */
  function coneSides(frame, input, output) {
    if (!input || !output) return null;
    function cone(entry) {
      var placed = frame.spatial.byId[entry.id];
      var back = SpatialLayout.coneBack(finite(entry.geometry.pitchDiameter, 0), entry.geometry.coneAngleDeg);
      return placed && back ? { position: placed.position, axis: placed.axis, back: back } : null;
    }
    var apex = SpatialLayout.coneApex(cone(input), cone(output));
    // Deux sommets qui ne se rejoignent pas ne sont pas un sommet : mieux vaut
    // ne rien orienter que d'orienter d'après une coïncidence approximative.
    return apex && apex.gap < 1e-6 * Math.max(1, Math.hypot(apex.point[0], apex.point[1], apex.point[2])) ? apex : null;
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
      cluster.list.forEach(function (member) {
        member.cx += shiftX; member.cy += shiftY;
        // Le centre d'orbite voyage avec l'amas : sans cela, les satellites
        // tourneraient autour du point où l'étage se trouvait avant d'être posé.
        if (Number.isFinite(member.orbitCenterX)) { member.orbitCenterX += shiftX; member.orbitCenterY += shiftY; }
      });

      var anchor = cluster.list.filter(function (m) { return m.functionalRole === 'input'; })[0] || cluster.list[0];
      var item = { index: index, stage: stage, type: stage.type,
        x: anchor ? anchor.cx : cursor + width / 2, y: anchor ? anchor.cy : margin + headroom + height / 2,
        width: width, height: height + 2 * headroom,
        diameter: Math.max(20, diameter(geometry)), centerDistance: center };
      item.exactCenterDistance = !!(scene.connections[index] && scene.connections[index].exactCenterDistance);
      item.schematic = scene.stageMembers(index).some(function (entry) { return entry.schematic; });
      item.members = cluster.list;
      item.dimensions = stageDimensions(stage, center);
      item.axes = axesOf(frame, cluster.list);
      // La courroie de cette vue était reconstruite à l'horizontale, à partir
      // de `x` et de l'entraxe : la deuxième poulie s'y retrouvait toujours à
      // droite de la première, quelle que soit la position que le modèle lui
      // donnait. C'est la MÊME géométrie que la vue Transmission qui la décrit
      // maintenant — un seul plan de courroie, un seul enroulement.
      item.flexible = flexibleOf(frame, stage, cluster.list);
      // Les efforts vivent dans le repère de l'engrènement, pas dans celui de
      // l'écran : la vue cotée dessinait la même rosace Ft/Fr/Fa que la vue
      // Transmission, et toutes deux se trompaient de la même façon.
      item.forceFrame = forceFrameOf(frame, scene, index, cluster.list);
      cursor += width + gap;
      bottom = Math.max(bottom, margin + headroom + height + headroom * 0.6);
      return item;
    });

    var overall = (solution && solution.dimensions) || {};
    return { stages: stages, scene: scene, frame: frame, view: frame.view, margin: margin, headroom: headroom,
      bounds: { x: 0, y: 0, width: Math.max(4 * margin, cursor - gap + margin), height: Math.max(3 * margin, bottom + margin) },
      envelope: { length: present(overall.length), maxDiameter: present(overall.maxDiameter), width: present(overall.width) } };
  }

  /**
   * Les axes d'un étage : le SEGMENT que chaque arbre projette, et non une
   * croix posée sur chaque organe.
   *
   * Une croix ne dit ni la direction de l'arbre, ni quels organes il porte —
   * or c'est précisément ce qu'une vue cotée doit montrer d'un train composé.
   * Les organes d'un même arbre se retrouvent ici sur un seul trait ; ceux qui
   * partagent l'arbre mais pas la ligne — les satellites, tous portés par le
   * même corps à des places différentes — gardent chacun le leur.
   */
  function axesOf(frame, list) {
    var groups = [];
    list.forEach(function (member) {
      var seen = frame.projected && frame.projected.member(member.memberId);
      if (!seen || !seen.shaftId) return;
      var along = seen.along || [0, 0];
      var endOn = Math.hypot(along[0], along[1]) < 1e-9;
      // Deux organes ne partagent une ligne d'axe que s'ils sont sur le même
      // arbre ET à la même distance de cette ligne.
      var offset = endOn ? member.cx.toFixed(2) + ',' + member.cy.toFixed(2)
        : (member.cx * -along[1] + member.cy * along[0]).toFixed(2);
      var key = seen.shaftId + '#' + offset;
      var found = null;
      groups.forEach(function (group) { if (group.key === key) found = group; });
      if (!found) { found = { key: key, along: along, endOn: endOn, members: [] }; groups.push(found); }
      found.members.push(member);
    });
    return groups.map(function (group) {
      var reach = group.members.reduce(function (max, member) { return Math.max(max, reachOf(member)); }, 4);
      var base = group.members[0];
      if (group.endOn) return { endOn: true, x: base.cx, y: base.cy, reach: reach * 1.18 };
      var along = group.along;
      var abscissa = group.members.map(function (m) { return m.cx * along[0] + m.cy * along[1]; });
      var origin = base.cx * along[0] + base.cy * along[1];
      var from = Math.min.apply(null, abscissa) - origin - reach * 0.55;
      var to = Math.max.apply(null, abscissa) - origin + reach * 0.55;
      return { endOn: false, reach: reach,
        x1: base.cx + along[0] * from, y1: base.cy + along[1] * from,
        x2: base.cx + along[0] * to, y2: base.cy + along[1] * to };
    });
  }

  /**
   * La courroie d'un étage, dans son plan de poulies puis à l'écran. Les
   * organes ont déjà été translatés d'un bloc : leurs positions dessinées sont
   * donc celles qu'il faut relier, tandis que le plan reste celui du monde.
   */
  function flexibleOf(frame, stage, list) {
    if (stage.type !== 'belt' && stage.type !== 'chain') return null;
    function at(role) { return list.filter(function (m) { return m.role === role; })[0] || null; }
    var a = at('input'), b = at('output');
    var placedA = a && frame.spatial.byId[a.memberId];
    var placedB = b && frame.spatial.byId[b.memberId];
    if (!placedA || !placedB) return null;
    return FlexibleDrive.build({
      axis: placedA.axis, centre1: placedA.position, centre2: placedB.position,
      r1: finite(a.pitchDiameter, 0) / 2, r2: finite(b.pitchDiameter, 0) / 2,
      crossed: !!(stage.parameters && stage.parameters.crossed),
      view: frame.view, drawn1: [a.cx, a.cy], drawn2: [b.cx, b.cy] });
  }

  return { build: build, members: members, place: place, stageDimensions: stageDimensions,
    flexibleOf: flexibleOf, axesOf: axesOf };
});
