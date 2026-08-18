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
    common ? require('./ProjectionEngine.js') : root.GearProjectionEngine,
    common ? require('./ProjectedScene.js') : root.GearProjectedScene);
  if (common) module.exports = api; else root.GearSpatialLayout = api;
})(typeof self !== 'undefined' ? self : this, function (MechanicalGraph, Projection, ProjectedScene) {
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
          axialPositionProvenance: member.axialPositionProvenance || 'exact',
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
   * Le sommet commun de deux cônes primitifs, et DE QUEL CÔTÉ de chaque organe
   * il se trouve.
   *
   * Un cône se dessine en s'amincissant vers son sommet. Le supposer toujours
   * dans le sens de l'axe revient à parier sur l'orientation que le graphe a
   * donnée à cet axe : sur un couple conique, l'un des deux cônes se dessinait
   * donc à l'envers, pointe tournée vers l'extérieur du couple. Les deux
   * sommets doivent coïncider — c'est ce qui décide du sens, et rien d'autre.
   *
   * `gap` dit à quelle distance les deux sommets tombent l'un de l'autre : au
   * delà d'un cheveu, le couple n'est pas un vrai couple conique et la vue ne
   * doit rien affirmer de son sommet.
   */
  function coneApex(a, b) {
    if (!a || !b || !(a.back > 0) || !(b.back > 0)) return null;
    var best = null;
    [1, -1].forEach(function (sideA) {
      [1, -1].forEach(function (sideB) {
        var pa = add(a.position, scale(a.axis, sideA * a.back));
        var pb = add(b.position, scale(b.axis, sideB * b.back));
        var gap = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
        if (!best || gap < best.gap) best = { gap: gap, point: pa, sideA: sideA, sideB: sideB };
      });
    });
    return best;
  }

  /** La distance sommet-organe d'un cône primitif, sur son axe. */
  function coneBack(pitchDiameter, coneAngleDeg) {
    if (!Number.isFinite(coneAngleDeg) || !(pitchDiameter > 0)) return null;
    var slope = Math.tan(coneAngleDeg * Math.PI / 180);
    return Math.abs(slope) < 1e-6 ? null : (pitchDiameter / 2) / slope;
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

    // Un axe vu en bout n'a pas de direction à l'écran : ses organes se
    // superposent, ce qui est la VÉRITÉ de cette vue et non un défaut. Deux
    // roues solidaires vues de face sont concentriques ; les écarter le long
    // d'une direction inventée pour qu'on les distingue mieux reviendrait à
    // dessiner un arbre là où on n'en voit pas la longueur.
    function direction2d(vector, fallback) {
      var xy = Projection.project(vector, view);
      var length = Math.hypot(xy[0], xy[1]);
      return length < 1e-9 ? (fallback || [0, 0]) : [xy[0] / length, xy[1] / length];
    }

    /**
     * La direction de repli d'un axe vu en bout.
     *
     * Un axe qui pointe vers l'œil n'a plus de direction à l'écran : il faut
     * bien en choisir une pour ranger les organes qu'il porte. Reprendre celle
     * de l'arbre amont, comme on le faisait, fait lire un renvoi à 90° comme
     * un montage coaxial — le pignon et sa roue conique s'alignaient. On
     * conserve donc l'ANGLE que les deux axes font réellement : deux axes
     * parallèles restent parallèles, un renvoi reste un renvoi.
     */
    function turned(along, fromAxis, toAxis) {
      var cosine = Math.max(-1, Math.min(1, fromAxis.direction[0] * toAxis.direction[0]
        + fromAxis.direction[1] * toAxis.direction[1] + fromAxis.direction[2] * toAxis.direction[2]));
      var sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
      return [along[0] * cosine - along[1] * sine, along[0] * sine + along[1] * cosine];
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
    draw(first, [0, 0], direction2d(graph.byAxis[first.axisId].direction));

    graph.mechanisms.forEach(function (mechanism) {
      var input = mechanism.inputPort, output = mechanism.outputPort;
      if (!input || !output || !output.shaftId) return;
      var host = shafts[input.shaftId];
      var target = graph.byShaft[output.shaftId];
      if (!host || !target || shafts[target.id]) return;

      var inAxis = graph.byAxis[graph.byShaft[input.shaftId].axisId];
      var outAxis = graph.byAxis[target.axisId];
      // Si l'axe mené est vu en bout, ses organes se superposent ; s'il est
      // visible mais que l'axe MENANT ne l'est pas, on garde tout de même
      // l'angle vrai entre les deux, faute de quoi un renvoi à 90° se lirait
      // comme un montage coaxial.
      var along = direction2d(outAxis.direction, turned(host.along, inAxis, outAxis));

      // L'écart entre les deux axes se lit en DEUX termes, et les confondre
      // était une erreur : l'un dit à quelle hauteur de l'arbre amont le
      // mécanisme se trouve, l'autre est l'entraxe. Les additionner en une
      // seule distance dessinait la roue d'une vis sans fin trop loin, et
      // écartait deux cônes qui, eux, partagent leur sommet.
      var offset = [outAxis.origin[0] - inAxis.origin[0], outAxis.origin[1] - inAxis.origin[1],
        outAxis.origin[2] - inAxis.origin[2]];
      var axial = offset[0] * inAxis.direction[0] + offset[1] * inAxis.direction[1] + offset[2] * inAxis.direction[2];
      var across = [offset[0] - inAxis.direction[0] * axial, offset[1] - inAxis.direction[1] * axial,
        offset[2] - inAxis.direction[2] * axial];
      var span = Math.sqrt(across[0] * across[0] + across[1] * across[1] + across[2] * across[2]);
      // La direction de l'engrènement est celle que la projection donne à
      // l'entraxe ; sa longueur reste vraie.
      var toward = direction2d(across, [-host.along[1], host.along[0]]);
      draw(target, [host.origin[0] + host.along[0] * axial + toward[0] * span,
        host.origin[1] + host.along[1] * axial + toward[1] * span], along);
    });

    // Les corps qu'aucun mécanisme ne relie — couronne bloquée, satellites —
    // partagent l'axe de leur étage : ils se dessinent sur le même tracé.
    function sameLine(a, b) {
      if (!a || !b) return false;
      for (var i = 0; i < 3; i++) {
        if (Math.abs(a.origin[i] - b.origin[i]) > 1e-6) return false;
        if (Math.abs(a.direction[i] - b.direction[i]) > 1e-6) return false;
      }
      return true;
    }
    graph.shafts.forEach(function (shaft) {
      if (shafts[shaft.id]) return;
      var axis = graph.byAxis[shaft.axisId];
      // Comparer les IDENTIFIANTS d'axes ne suffit pas : un satellite tourne
      // autour d'un axe qui lui est propre, mais confondu avec celui de son
      // étage. Faute de le reconnaître, il se rangeait le long d'une direction
      // inventée, et son arbre traversait un dessin où tous les autres étaient
      // vus en bout.
      var sibling = null;
      graph.shafts.forEach(function (other) {
        if (!sibling && shafts[other.id] && sameLine(graph.byAxis[other.axisId], axis)) sibling = other;
      });
      var host = sibling ? shafts[sibling.id]
        : shaft.carriedBy && shafts[shaft.carriedBy] ? shafts[shaft.carriedBy]
          : { origin: [0, 0], along: direction2d(axis && axis.direction ? axis.direction : [1, 0, 0]) };
      draw(shaft, host.origin, host.along);
    });

    return { view: view, byId: byId, shafts: shafts };
  }

  /** La vue conseillée pour cette transmission — voir ProjectionEngine.auto. */
  function autoView(layout) {
    var axes = (layout && layout.graph && layout.graph.axes) || [];
    return Projection.auto(axes);
  }

  /**
   * Le repère de dessin d'un graphe : placement, point de vue, et sièges
   * dépliés. Les vues qui dessinent une géométrie réelle le demandent ici
   * plutôt que d'enchaîner elles-mêmes build → choix de vue → unfold : trois
   * appels recopiés, c'est trois occasions de diverger sur le point de vue.
   *
   * `options.view` impose une projection ; 'auto' demande celle qui perd le
   * moins du mécanisme ; sans rien, celle qui montre le plus de denture.
   */
  /**
   * Les SIÈGES d'une vraie projection : la position de chaque organe est
   * l'image de sa position, et rien d'autre.
   *
   * C'est la différence avec le dépliage, et elle est entière. Une distance qui
   * possède une composante en profondeur DOIT apparaître raccourcie ; la
   * rétablir à sa valeur vraie produit un dessin qu'aucun point de vue ne peut
   * voir. Ici, un entraxe oblique se dessine plus court qu'il n'est — et c'est
   * la cote, jamais le trait, qui en donne la valeur.
   */
  function projectedSeats(layout, viewId) {
    var view = Projection.view(viewId);
    var byId = {}, shafts = {};
    (layout.members || []).forEach(function (member) {
      var xy = Projection.project(member.position, view);
      byId[member.id] = { x: xy[0], y: xy[1], shaftId: member.shaftId,
        depth: Projection.depth(member.position, view) };
    });
    (layout.shafts || []).forEach(function (shaft) {
      var axis = layout.graph && layout.graph.byAxis[shaft.axisId];
      var origin = axis ? Projection.project(axis.origin, view) : [0, 0];
      var raw = axis ? Projection.project(axis.direction, view) : [0, 0];
      var length = Math.hypot(raw[0], raw[1]);
      shafts[shaft.id] = {
        origin: origin,
        // `along` reste UNITAIRE : c'est une direction d'écran, elle sert à
        // orienter un corps vu par la tranche. Le raccourcissement, lui, est
        // déjà dans les positions — l'appliquer deux fois les décalerait.
        along: length < 1e-9 ? [0, 0] : [raw[0] / length, raw[1] / length],
        foreshortened: length
      };
    });
    return { view: view, byId: byId, shafts: shafts, mode: 'projected' };
  }

  /**
   * Le repère de dessin d'un graphe — et le CHOIX qui vient avec.
   *
   * Deux systèmes coexistaient sous un même nom. `front`, `top`, `side` et
   * `iso` nommaient des projections, mais toutes passaient ensuite par le
   * dépliage : on en gardait les directions et on rétablissait les longueurs.
   * « Dessus » n'était donc pas une vue de dessus, et « Iso » pas une
   * isométrie — c'étaient des vues dépliées orientées par ces regards. Le
   * mélange se voyait à un détail qui aurait dû alerter : l'entraxe dessiné
   * restait égal à l'entraxe vrai jusque dans l'axonométrie, ce qui ne peut
   * pas arriver dans une projection.
   *
   * Les deux systèmes sont maintenant nommés :
   *
   *   'unfolded'                le dessin d'ensemble de réducteur — angles de
   *                             la projection, longueurs vraies. Fait pour
   *                             COMPRENDRE une transmission d'un coup d'œil ;
   *   'front' | 'top' | 'side' | 'iso'
   *                             une projection orthographique, sans le moindre
   *                             rétablissement. Fait pour MESURER.
   */
  function frame(graph, options) {
    options = options || {};
    var spatial = build(graph);
    var asked = options.view || 'unfolded';
    var result;
    if (asked === 'unfolded' || asked === 'auto' || asked === '') {
      // Le dépliage a tout de même besoin d'un regard : c'est lui qui donne
      // les DIRECTIONS. `auto` retient la vue la moins perdante, à défaut
      // celle qui montre le plus de denture.
      var basis = asked === 'auto' ? autoView(spatial) : Projection.engagement((graph && graph.axes) || []);
      var seats = unfold(spatial, basis.id);
      seats.mode = 'unfolded';
      result = { graph: graph, spatial: spatial, view: basis, mode: 'unfolded', seats: seats };
    } else {
      var view = Projection.view(asked);
      result = { graph: graph, spatial: spatial, view: view, mode: 'projected',
        seats: projectedSeats(spatial, view.id) };
    }
    // Comment chaque pièce SE PRÉSENTE — de face, de profil, de biais, de quel
    // côté, à quelle profondeur, et dans quel repère elle tourne — appartient
    // au point de vue, pas à la vue qui dessine. Une seule vue le calculait,
    // les autres le redemandaient au moteur de projection, chacune à sa façon.
    result.projected = ProjectedScene.build(spatial, result);
    return result;
  }

  return { build: build, project: project, unfold: unfold, autoView: autoView, frame: frame,
    projectedSeats: projectedSeats, coneApex: coneApex, coneBack: coneBack,
    bounds: bounds, SHAFT_OVERHANG: SHAFT_OVERHANG };
});
