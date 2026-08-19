// ProjectedScene.js - Tout ce qu'une vue a besoin de savoir, calculé une fois.
//
// Chaque renderer récupérait quelques éléments de la projection puis complétait
// lui-même ce qui manquait : l'un déduisait l'inclinaison d'un axe, l'autre
// recalculait une base d'orbite, un troisième animait une rotation en supposant
// que la roue était vue de face. C'est la source des divergences — non pas
// parce que les calculs étaient faux, mais parce qu'ils étaient trois.
//
// Ce module produit la SCÈNE PROJETÉE : pour chaque organe, où il tombe, à
// quelle profondeur, comment il se présente, de quel bout on le regarde, et —
// le point qui manquait le plus — dans quel repère d'écran tourne ce qui tourne
// autour de son axe.
//
//     basis = [ e1 projeté, e2 projeté ]
//
// Un point à l'angle θ et au rayon R autour de l'axe se trouve exactement à
//
//     centre + R · (cos θ · e1 + sin θ · e2)
//
// et cette seule formule répond à quatre questions qui étaient traitées
// séparément, chacune en supposant une vue de face : la phase de rotation d'une
// roue, l'orbite d'un satellite, les bras d'un porte-satellites, et le repère de
// phase d'un cône ou d'une vis. Vue de face, elle donne un cercle ; vue de
// profil, un segment ; obliquement, une ellipse. C'est ce que la projection dit,
// pas une approximation.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./ProjectionEngine.js') : root.GearProjectionEngine,
    common ? require('./MechanicalGraph.js') : root.GearMechanicalGraph);
  if (common) module.exports = api; else root.GearProjectedScene = api;
})(typeof self !== 'undefined' ? self : this, function (Projection, MechanicalGraph) {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function deg(radians) { return radians * 180 / Math.PI; }

  /**
   * Le repère d'écran du plan perpendiculaire à un axe.
   *
   * Son DÉTERMINANT porte une information qu'on cherchait ailleurs sans la
   * trouver : le sens apparent de rotation. Il change de signe quand on passe
   * de l'autre côté du réducteur, ce qui est exactement ce qu'on observe — une
   * roue vue de son autre extrémité tourne, à l'écran, dans l'autre sens.
   */
  function phaseBasis(axisDirection, view) {
    var vector = MechanicalGraph.vector;
    // L'axe est NORMALISÉ ici : `cross(axe, e1)` hérite sinon de la norme de
    // l'axe, la base cesse d'être orthonormée, et l'ellipse apparente sort avec
    // un grand axe de 2,41 pour un cercle de rayon 1. Les axes du graphe sont
    // unitaires, mais une source de vérité ne doit pas en dépendre.
    var axis = vector.unit(axisDirection);
    var e1 = vector.perpendicularDirection(axis, 0);
    var e2 = vector.cross(axis, e1);
    var p1 = Projection.project(e1, view);
    var p2 = Projection.project(e2, view);
    var determinant = p1[0] * p2[1] - p1[1] * p2[0];
    return { first: p1, second: p2,
      // Le repère GARDE ses deux directions d'espace et ce qu'elles pèsent en
      // profondeur. Sans elles, un point de ce plan ne peut être situé qu'à
      // l'écran : quatre satellites sur une même orbite héritaient tous de la
      // profondeur de leur axe, donc de la même, alors que deux d'entre eux
      // sont devant et deux derrière.
      e1: e1, e2: e2, axis: axis,
      depth1: Projection.depth(e1, view), depth2: Projection.depth(e2, view),
      // +1 ou −1 : le sens dans lequel les angles croissants tournent à
      // l'écran. 0 quand le plan est vu par la tranche — il n'y a alors plus
      // de sens à montrer, seulement un va-et-vient.
      spin: Math.abs(determinant) < 1e-9 ? 0 : (determinant > 0 ? 1 : -1) };
  }

  /**
   * L'image d'un cercle unité par l'application [u v] : une ellipse.
   *
   * Ses deux demi-axes et son inclinaison sont les valeurs singulières de la
   * matrice — décomposition analytique, exacte en 2×2. C'est ce qui permet de
   * dessiner un cercle primitif vu de biais comme une VRAIE ellipse plutôt que
   * comme un cercle, et de le voir se replier sur un segment quand son plan
   * passe par la tranche : un demi-axe nul, ce que SVG trace comme une droite.
   */
  function ellipseOf(u, v) {
    var a = u[0], b = v[0], c = u[1], d = v[1];
    var e = (a + d) / 2, g = (a - d) / 2, h = (c + b) / 2, k = (c - b) / 2;
    var q = Math.hypot(e, k), r = Math.hypot(g, h);
    return { major: q + r, minor: Math.abs(q - r),
      rotationDeg: (Math.atan2(k, e) + Math.atan2(h, g)) / 2 * 180 / Math.PI,
      det: a * d - b * c };
  }

  /**
   * UN CERCLE PROJETÉ — la description partagée d'un cercle porté par un axe.
   *
   * Roue, poulie, surface primitive, surface de tête, arc de courroie : tout
   * cela n'est qu'un cercle de rayon R dans le plan perpendiculaire à un axe.
   * Chaque couche en tirait sa propre image — l'une du raccourci, l'autre d'une
   * base projetée —, si bien qu'une roue elliptique se retrouvait cerclée de
   * cercles parfaits. Il n'y a plus qu'une description, et elle porte de quoi
   * tracer directement l'ellipse : `rx`/`ry` dans le repère local de l'organe,
   * `rotationDeg` pour qui travaille en coordonnées d'écran.
   */
  function projectedCircle(centre, radius, apparent) {
    var seen = apparent || { major: 1, minor: 1, rotationDeg: 0, det: 1 };
    var r = finite(radius, 0);
    return { centre: centre || [0, 0], radius: r,
      major: seen.major, minor: seen.minor, rotationDeg: seen.rotationDeg,
      // Repère LOCAL de l'organe : le petit axe suit l'axe projeté (+X).
      rx: r * seen.minor, ry: r * seen.major,
      // Vu par la tranche, le cercle n'a plus de surface : c'est un segment.
      collapsed: seen.minor < 1e-9 };
  }

  /** Le point à l'angle θ et au rayon R autour d'un axe, tel qu'on le voit. */
  function phasePoint(basis, radius, theta) {
    var c = Math.cos(theta), s = Math.sin(theta);
    return [radius * (c * basis.first[0] + s * basis.second[0]),
      radius * (c * basis.first[1] + s * basis.second[1])];
  }

  /**
   * UN POINT D'ORBITE — où il se dessine, ET à quelle profondeur il est.
   *
   * `phasePoint` ne rend que l'écran. C'est suffisant pour placer un satellite,
   * pas pour savoir s'il passe devant ou derrière la couronne : la profondeur
   * d'un point de l'orbite varie avec l'angle, et un satellite à midi n'est pas
   * à la même distance de l'œil qu'un satellite à six heures.
   *
   * `depth` est RELATIF au centre de l'orbite : l'appelant y ajoute la
   * profondeur de cet axe, comme il ajoute déjà son abscisse et son ordonnée.
   */
  function orbitPoint(basis, radius, theta) {
    var c = Math.cos(theta), s = Math.sin(theta);
    var seat = phasePoint(basis, radius, theta);
    return { x: seat[0], y: seat[1],
      depth: radius * (c * finite(basis.depth1, 0) + s * finite(basis.depth2, 0)) };
  }

  /**
   * build(spatial, frame) → la scène telle que cette vue la montre.
   *
   * `frame` vient de SpatialLayout : il porte le point de vue ET le système —
   * dépliée ou projetée. Les POSITIONS viennent de lui, parce que c'est lui qui
   * tranche entre longueurs vraies et longueurs projetées. Tout le reste — la
   * présentation, le raccourci, le côté, la profondeur, les repères de phase —
   * est une propriété du regard, et se calcule ici pour tout le monde.
   */
  function build(spatial, frame) {
    var view = frame.view;
    var members = {}, shafts = {}, order = [];

    (spatial.members || []).forEach(function (member) {
      var seat = frame.seats.byId[member.id] || { x: 0, y: 0 };
      var basis = phaseBasis(member.axis, view);
      var raw = Projection.project(member.axis, view);
      var length = Math.hypot(raw[0], raw[1]);
      var presentation = Projection.presentation(member.axis, view);
      // LA DIRECTION D'ÉCRAN DE L'AXE vient de l'ARBRE, pas de la projection.
      //
      // Les deux coïncident dans une projection — c'est la même image du même
      // axe. Elles divergent dans la vue DÉPLIÉE, qui reconstruit les
      // directions pour conserver les angles vrais : après un renvoi à 90°,
      // l'arbre repart à 90° à l'écran, là où l'image de son axe partirait
      // ailleurs. Prendre l'image dans les deux cas couchait l'organe dans un
      // plan que son propre arbre ne suivait pas — la roue conique se
      // retrouvait de travers sur son axe, et le sommet des deux cônes ne
      // tombait plus au même endroit.
      var seated = frame.seats.shafts[member.shaftId];
      var drawn = seated && Math.hypot(seated.along[0], seated.along[1]) > 1e-9 ? seated.along : null;
      var along = drawn || (length < 1e-9 ? [0, 0] : [raw[0] / length, raw[1] / length]);
      members[member.id] = {
        id: member.id, shaftId: member.shaftId,
        x: seat.x, y: seat.y,
        // La profondeur vient TOUJOURS du monde, même en vue dépliée : c'est
        // une propriété du mécanisme et du regard, pas du placement retenu.
        depth: Projection.depth(member.position, view),
        presentation: presentation,
        foreshortening: Projection.foreshortening(member.axis, view),
        facing: Projection.facing(member.axis, view),
        along: along,
        // Un axe SANS DIRECTION À L'ÉCRAN n'a pas d'inclinaison : il pointe vers
        // l'œil, et lui en donner une ferait tourner ses étiquettes pour rien.
        // En projection, c'est exactement le cas d'un organe vu de face.
        axisAngleDeg: Math.hypot(along[0], along[1]) > 1e-9 ? deg(Math.atan2(along[1], along[0])) : undefined,
        basis: basis,
        // L'ellipse apparente d'un cercle porté par cet axe : c'est elle que
        // toute vue doit tracer au lieu d'un cercle, dès qu'on ne regarde plus
        // l'organe de face.
        apparent: ellipseOf(basis.first, basis.second)
      };
      order.push(member.id);
    });

    (spatial.shafts || []).forEach(function (shaft) {
      var drawn = frame.seats.shafts[shaft.id] || { origin: [0, 0], along: [1, 0] };
      var first = spatial.byId[shaft.memberIds[0]];
      var last = spatial.byId[shaft.memberIds[shaft.memberIds.length - 1]];
      if (!first || !last) return;
      var from = first.axialPosition - first.width / 2 - 8;
      var to = last.axialPosition + last.width / 2 + 8;
      // En projection, l'axe se raccourcit comme le reste ; en vue dépliée, sa
      // longueur reste vraie. `foreshortened` porte la différence, et vaut 1
      // quand il n'y a rien à raccourcir.
      var squeeze = finite(drawn.foreshortened, 1);
      shafts[shaft.id] = {
        id: shaft.id, role: shaft.role, grounded: !!shaft.grounded,
        memberIds: shaft.memberIds.slice(),
        origin: drawn.origin, along: drawn.along,
        x1: drawn.origin[0] + drawn.along[0] * from * squeeze,
        y1: drawn.origin[1] + drawn.along[1] * from * squeeze,
        x2: drawn.origin[0] + drawn.along[0] * to * squeeze,
        y2: drawn.origin[1] + drawn.along[1] * to * squeeze,
        endOn: Math.hypot(drawn.along[0], drawn.along[1]) < 1e-9,
        depth: Projection.depth(shaft.start, view),
        // UN ARBRE N'EST PAS À UNE SEULE PROFONDEUR. Croisé par rapport au
        // regard, il plonge : son premier bout est devant les roues qu'il
        // traverse, son second derrière. Ses deux profondeurs sont donc
        // portées séparément, et la vue peut le découper pour l'intercaler.
        depthStart: Projection.depth(shaft.start, view),
        depthEnd: Projection.depth(shaft.end, view),
        // Là où l'arbre TRAVERSE un des organes qu'il porte, il est dans le
        // métal : on ne le voit pas. Ces intervalles sont donnés en abscisse
        // normalisée le long du segment dessiné, pour que la vue puisse
        // n'émettre que ce qui sort réellement des roues.
        hidden: to - from < 1e-9 ? [] : shaft.memberIds.map(function (id) {
          var placed = spatial.byId[id];
          if (!placed) return null;
          return [(placed.axialPosition - placed.width / 2 - from) / (to - from),
            (placed.axialPosition + placed.width / 2 - from) / (to - from)];
        }).filter(Boolean),
        basis: phaseBasis(shaft.direction, view)
      };
    });

    // Du plus lointain au plus proche : l'ordre dans lequel il faut peindre
    // pour qu'une pièce éloignée ne recouvre pas celle qui est devant. Les
    // positions 3D étaient justes, mais le SVG était peint dans l'ordre des
    // étages — ce qui ne dit rien de la profondeur.
    order.sort(function (a, b) { return members[b].depth - members[a].depth; });

    return { view: view, mode: frame.mode, members: members, shafts: shafts, order: order,
      member: function (id) { return members[id] || null; },
      shaft: function (id) { return shafts[id] || null; } };
  }

  return { build: build, phaseBasis: phaseBasis, phasePoint: phasePoint, orbitPoint: orbitPoint, ellipseOf: ellipseOf,
    projectedCircle: projectedCircle };
});
