// TrainLayout.js - La vue « Transmission », lue sur le modèle spatial.
//
// Ce module ne place plus rien. Il l'a fait longtemps, et c'est précisément ce
// qui rendait le dessin faux dès qu'une chaîne changeait d'axe : un curseur 2D
// avançait d'étage en étage, une table d'angles candidats cherchait où poser la
// roue menée sans collision, et une vis sans fin inclinait son couple de 90°
// avant de repartir du centre de la roue comme si de rien n'était. Cela dessine
// correctement un couple isolé et ment sur toute suite, parce qu'un engrenage
// vu de face et une vis vue de profil ne peuvent pas être sur le même arbre.
//
// Les positions viennent maintenant d'un seul endroit :
//
//     MechanicalGraph  axes, arbres, membres, mécanismes — dans l'espace
//     SpatialLayout    chaque membre sur son axe, à son abscisse
//     ProjectionEngine d'où on regarde, et comment chaque organe se présente
//
// Il reste ici ce qui est propre au DESSIN de cette vue et à rien d'autre :
// instancier les satellites en autant d'exemplaires que le porte-satellites en
// porte, dérouler la courroie, et donner à chaque roue les cotes dont la
// primitive a besoin. Aucun mm n'y est décidé.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./core/SceneBuilder.js') : root.GearSceneBuilder,
    common ? require('./core/FlexibleDriveGeometry.js') : root.GearFlexibleDriveGeometry,
    common ? require('./core/MechanicalGraph.js') : root.GearMechanicalGraph,
    common ? require('./core/SpatialLayout.js') : root.GearSpatialLayout,
    common ? require('./core/ProjectionEngine.js') : root.GearProjectionEngine,
    common ? require('./core/ProjectedScene.js') : root.GearProjectedScene);
  if (common) module.exports = api; else root.GearTrainLayout = api;
})(typeof self !== 'undefined' ? self : this, function (SceneBuilder, FlexibleDrive, MechanicalGraph, SpatialLayout, Projection, ProjectedScene) {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }
  function deg(radians) { return radians * 180 / Math.PI; }

  /**
   * Roue de rendu construite à partir d'un MEMBRE DE LA SCÈNE. Les cotes
   * absentes restent absentes : `schematic` dit si le tracé repose sur des
   * valeurs reconstruites, pour que la vue puisse le signaler.
   */
  function wheelFromMember(entry, overrides) {
    var g = entry ? entry.geometry : {};
    var m = finite(g.module, 1);
    var pitch = finite(g.pitchDiameter, 20);
    return Object.assign({
      memberId: entry ? entry.id : null,
      role: entry ? entry.role : 'input',
      // `role` est surchargé plus bas par la classe CSS du dessin (sun, ring,
      // planet) : le code du schéma et le nommage voyagent donc à part, tels
      // que la scène les a établis. Aucune vue ne les recalcule (§9, §18).
      memberCode: entry ? entry.role : null,
      memberName: entry ? entry.memberName : null,
      localizedRole: entry ? entry.localizedRole : null,
      functionalRole: entry ? entry.functionalRole : null,
      rotationDisplayMode: entry ? entry.rotationDisplayMode : null,
      kind: entry ? entry.kind : 'gear',
      pitchD: pitch,
      outsideD: finite(g.outsideDiameter, pitch + 2 * m),
      rootD: Math.max(finite(g.rootDiameter, pitch - 2.5 * m), pitch * 0.3),
      baseD: finite(g.baseDiameter, pitch * Math.cos(rad(finite(g.pressureAngleDeg, 20)))),
      teeth: finite(g.teeth, 0),
      module: m,
      pressureAngle: finite(g.pressureAngleDeg, 20),
      profileShift: finite(g.profileShift, 0),
      faceWidth: finite(g.width, 10 * m),
      helixAngle: Number.isFinite(g.helixAngleDeg) ? g.helixAngleDeg : undefined,
      // Le sens vient de la scène, sous son nom canonique : la primitive lisait
      // `helixHand`, que personne ne posait.
      handedness: entry ? entry.handedness : undefined,
      leadAngle: Number.isFinite(g.leadAngleDeg) ? g.leadAngleDeg : undefined,
      coneAngleDeg: Number.isFinite(g.coneAngleDeg) ? g.coneAngleDeg : undefined,
      schematic: !!(entry && entry.schematic),
      speed: entry && Number.isFinite(entry.mechanical.relativeSpeed) ? entry.mechanical.relativeSpeed : 0,
      cx: 0, cy: 0, phase: 0
    }, overrides || {});
  }

  function sceneFor(stages, options) {
    if (options.scene && options.scene.member) return options.scene;
    return SceneBuilder.build({ inputRpm: 1, stages: stages });
  }

  /**
   * Le repère du dessin : où chaque membre tombe, et comment il se présente.
   *
   * `unfold` conserve les directions que la projection donne et les longueurs
   * vraies — c'est la convention du dessin d'ensemble de réducteur. La
   * PRÉSENTATION, elle, vient de la projection seule : elle dit si l'organe se
   * voit en disque, en rectangle, ou entre les deux.
   */
  function frameOf(solution, scene, options) {
    // Le repère porte déjà sa scène projetée : présentation, raccourci, côté,
    // profondeur et repères de phase sont calculés une fois pour les trois vues.
    return SpatialLayout.frame(MechanicalGraph.build(solution, scene), options);
  }

  /** Le vecteur unitaire de l'écran qui porte l'arbre de ce membre. */
  function alongOf(frame, memberId) {
    var seat = frame.seats.byId[memberId];
    var shaft = seat && frame.seats.shafts[seat.shaftId];
    return shaft ? shaft.along : [1, 0];
  }

  /**
   * Ce qu'il faut dire à la primitive pour qu'elle dessine cet organe tel qu'il
   * se voit : sa présentation, son raccourci, et l'inclinaison de son axe à
   * l'écran. Un organe vu de face n'a pas d'inclinaison — son axe pointe vers
   * l'œil — et lui en donner une ferait tourner ses étiquettes pour rien.
   */
  function orientation(frame, member) {
    var seen = frame.projected && frame.projected.member(member.id);
    if (!seen) return {};
    return { presentation: seen.presentation, foreshortening: seen.foreshortening,
      // De quel BOUT on regarde, et dans quel repère d'écran tourne ce qui
      // tourne : sans eux, l'animation suppose partout une roue vue de face.
      facing: seen.facing, phaseBasis: seen.basis, depth: seen.depth,
      axisAngleDeg: seen.axisAngleDeg };
  }

  function seatOf(frame, memberId) {
    return frame.seats.byId[memberId] || { x: 0, y: 0 };
  }

  /** Roue complète : cotes de la scène, place et orientation du modèle spatial. */
  function wheelAt(frame, member, overrides) {
    if (!member) return wheelFromMember(null, overrides);
    var seat = seatOf(frame, member.id);
    var placed = frame.spatial.byId[member.id];
    return wheelFromMember(member, Object.assign({ cx: seat.x, cy: seat.y,
      // Le CORPS auquel l'organe appartient : tout ce qui est sur cet arbre
      // tourne d'un bloc. C'est la question qu'un train composé pose sans
      // arrêt, et à laquelle le dessin ne répondait pas.
      bodyId: placed ? placed.shaftId : null,
      // §54 : l'abscisse est-elle mesurée, déduite d'un jeu par défaut, ou
      // purement conventionnelle ? La vue s'en sert pour qualifier ce qu'elle
      // montre au lieu de l'affirmer une fois pour toutes.
      axialProvenance: placed ? placed.axialPositionProvenance : null },
    orientation(frame, member), overrides || {}));
  }

  /**
   * La base de phase de l'axe d'orbite : c'est dans ce plan que les satellites
   * tournent. Vu de face l'orbite est un cercle ; obliquement une ellipse ; en
   * coupe un segment, et deux satellites se retrouvent l'un derrière l'autre —
   * ce que cette vue montre. C'est la MÊME base que celle qui donne sa phase à
   * une roue : une seule formule pour toutes les rotations du dessin.
   */
  function orbitBasis(frame, axisDirection) {
    return ProjectedScene.phaseBasis(axisDirection, frame.view);
  }

  // ===== Étages =====

  function planetaryStage(frame, scene, stage, index, byRole, entry) {
    var m = finite((byRole.S || { geometry: {} }).geometry.module, 1);
    var count = Math.max(2, Math.round(finite(byRole.P && byRole.P.count, 3)));
    entry.attach = 'coaxial';

    // Les rôles de rendu restent parlants (sun/ring/planet) : ce sont eux que
    // portent les classes CSS et la sélection.
    var sun = wheelAt(frame, byRole.S, { role: 'sun' });
    var ring = wheelAt(frame, byRole.R, { role: 'ring' });
    // La couronne enveloppe l'étage : sa jante fixe l'encombrement.
    ring.outsideD = Math.max(ring.pitchD + 6 * m, finite(byRole.R && byRole.R.geometry.rootDiameter, 0) + 2 * m);
    sun.chipR = ring.chipR = ring.outsideD / 2 + m;
    entry.wheels.push(sun, ring);

    var planetShaft = null;
    frame.graph.shafts.forEach(function (shaft) {
      if (!planetShaft && shaft.role === 'planet' && shaft.members.some(function (member) {
        return member.id === (byRole.P && byRole.P.id);
      })) planetShaft = shaft;
    });
    var orbit = finite(planetShaft && planetShaft.orbitRadius,
      finite(byRole.P && byRole.P.orbitRadius, 0));
    var centre = seatOf(frame, (byRole.C || byRole.S || {}).id);
    var orbitAxis = planetShaft && frame.graph.byAxis[planetShaft.axisId];
    var basis = orbitBasis(frame, orbitAxis ? orbitAxis.direction : [1, 0, 0]);
    for (var pi = 0; pi < count; pi++) {
      var a = 2 * Math.PI * pi / count;
      var seat = ProjectedScene.phasePoint(basis, orbit, a);
      entry.wheels.push(wheelAt(frame, byRole.P, {
        role: 'planet',
        cx: centre.x + seat[0], cy: centre.y + seat[1],
        // La base voyage avec le satellite : c'est elle, et non un `rotate()`
        // d'écran, qui donne sa place à chaque instant de l'animation.
        orbit: orbit, orbitCenterX: centre.x, orbitCenterY: centre.y, orbitBasis: basis,
        orbitSpeed: finite(byRole.P && byRole.P.mechanical.orbitRelativeSpeed, 0), phase: a
      }));
    }

    // La topologie est celle que la scène a établie, pas une relecture de
    // `stage.inputMember` : la vue n'a plus à savoir lire un étage (§31).
    entry.members = {};
    ['input', 'output', 'fixed'].forEach(function (functional) {
      var member = scene.functionalMember ? scene.functionalMember(index, functional) : null;
      if (member) entry.members[functional] = member.role;
    });
    entry.carrierSpeed = finite(byRole.C && byRole.C.mechanical.relativeSpeed, 0);
    entry.carrier = { memberId: 's' + index + '-C', cx: centre.x, cy: centre.y, orbit: orbit, count: count,
      speed: entry.carrierSpeed, basis: basis,
      bodyId: byRole.C && frame.spatial.byId[byRole.C.id] ? frame.spatial.byId[byRole.C.id].shaftId : null,
      functionalRole: byRole.C ? byRole.C.functionalRole : null,
      memberName: byRole.C ? byRole.C.memberName : null,
      localizedRole: byRole.C ? byRole.C.localizedRole : null };
    entry.stageRadius = ring.outsideD / 2;
  }

  function rackStage(frame, stage, index, byRole, entry) {
    var m = finite((byRole.input || { geometry: {} }).geometry.module, 1);
    var pinion = wheelAt(frame, byRole.input);
    var travel = finite(byRole.rack && byRole.rack.geometry.travelPerRevolution, Math.PI * pinion.pitchD);
    // La crémaillère n'est portée par aucun arbre : elle GLISSE. Sa ligne
    // primitive est tangente au cercle primitif du pignon, du côté que le
    // modèle donne à la glissière.
    var slide = (frame.graph.slides || []).filter(function (s) { return s.stageIndex === index; })[0];
    var direction = slide ? Projection.project(slide.direction, frame.view) : [0, 1];
    var length = Math.hypot(direction[0], direction[1]) || 1;
    var along = [direction[0] / length, direction[1] / length];
    var normal = [-along[1], along[0]];
    var rack = wheelFromMember(byRole.rack, {
      cx: pinion.cx + normal[0] * pinion.pitchD / 2,
      cy: pinion.cy + normal[1] * pinion.pitchD / 2,
      axisAngleDeg: deg(Math.atan2(along[1], along[0])),
      pitchD: 0, outsideD: 4 * m, rootD: m, module: m,
      teeth: Math.max(6, Math.round(travel / (Math.PI * m))), length: travel,
      // Le pignon entraîne la crémaillère : mm parcourus par radian d'entrée.
      mmPerRadian: finite(byRole.rack && byRole.rack.mechanical.mmPerRadian, pinion.pitchD / 2),
      pinionSpeed: pinion.speed, linearId: 's' + index + '-rack',
      slideAlong: along,
      // La puce SORTIE s'écarte de toute la demi-course, pas du seul profil.
      chipR: travel / 2 });
    entry.attach = 'linear';
    entry.wheels.push(pinion, rack);
    entry.stageRadius = Math.max(pinion.pitchD, travel) / 2;
  }

  function pairStage(frame, connection, stage, index, byRole, entry) {
    var isBeltLike = stage.type === 'belt' || stage.type === 'chain';
    var m = finite((byRole.input || { geometry: {} }).geometry.module, 1);
    entry.centerDistance = finite(connection.centerDistance, null);
    entry.exactCenterDistance = !!connection.exactCenterDistance;

    var wIn = wheelAt(frame, byRole.input);
    var wOut = wheelAt(frame, byRole.output);
    if (isBeltLike) {
      wIn.outsideD = wIn.pitchD + m; wOut.outsideD = wOut.pitchD + m;
      wIn.rootD = wIn.pitchD - m; wOut.rootD = wOut.pitchD - m;
    }
    // L'angle n'est plus CHOISI : c'est celui que la projection donne au
    // segment qui joint les deux centres. Une table d'angles candidats
    // rangeait les étages pour éviter les collisions du dessin ; elle
    // décidait donc de la géométrie d'un réducteur d'après son encombrement.
    entry.angleDeg = deg(Math.atan2(wOut.cy - wIn.cy, wOut.cx - wIn.cx));
    entry.attach = connection.axisRelation === 'coaxial' ? 'coaxial'
      : connection.axisRelation === 'perpendicular' ? 'break' : 'mesh';

    entry.wheels.push(wIn, wOut);
    if (isBeltLike) entry.links.push(flexibleLink(frame, connection, byRole, wIn, wOut, 's' + index + '-drive'));
    if (stage.type === 'bevel') {
      // Les deux axes se coupent en un POINT unique : le sommet commun des
      // cônes primitifs. Le modèle spatial le connaît — c'est lui qui a servi
      // à placer les deux roues.
      var apex = apexOf(frame, byRole);
      if (apex) {
        entry.apex = apex;
        entry.links.push({ kind: 'bevel-axes', x: apex.x, y: apex.y,
          shaftAngleDeg: finite(connection.shaftAngleDeg, 90),
          inAlong: alongOf(frame, byRole.input.id), outAlong: alongOf(frame, byRole.output.id),
          span: Math.max(apex.back1, apex.back2) + Math.max(wIn.pitchD, wOut.pitchD) / 2 });
      }
    }
    entry.stageRadius = Math.max(wIn.outsideD, wOut.outsideD) / 2;
  }

  /** Le sommet commun de deux cônes primitifs, dans le repère du dessin. */
  function apexOf(frame, byRole) {
    var input = byRole.input, output = byRole.output;
    if (!input || !output) return null;
    function back(member) {
      var delta = finite(member.geometry.coneAngleDeg, null);
      var d = finite(member.geometry.pitchDiameter, 0);
      if (delta === null || !(d > 0)) return null;
      var slope = Math.tan(rad(delta));
      return Math.abs(slope) < 1e-6 ? null : (d / 2) / slope;
    }
    var back1 = back(input), back2 = back(output);
    if (back1 === null || back2 === null) return null;
    var seat = seatOf(frame, input.id), along = alongOf(frame, input.id);
    return { x: seat.x + along[0] * back1, y: seat.y + along[1] * back1, back1: back1, back2: back2 };
  }

  // ===== Assemblage =====

  /**
   * layout(stages, mechanical, options) → {
   *   stages: [{ index, type, attach, angleDeg, centerDistance, wheels[], links[] }],
   *   wheels: toutes les roues à plat,
   *   shafts: les arbres, avec leur longueur réelle,
   *   view: la projection retenue,
   *   io: { input: wheel, output: wheel }
   * }
   * `options.scene` injecte la scène déjà construite par le renderer ;
   * `options.view` impose une projection ('front' | 'top' | 'side' | 'iso' |
   * 'auto'), à défaut de quoi on prend celle qui montre le plus de denture.
   * Toutes les coordonnées sont finies (les NaN dans les attributs SVG
   * produisent des erreurs console, fatales pour les e2e).
   */
  function layout(stages, mechanical, options) {
    stages = stages || [];
    options = options || {};
    var scene = sceneFor(stages, options);
    var solution = options.solution || { stages: stages, mechanical: mechanical || [] };
    var frame = frameOf(solution, scene, options);
    var out = [];

    stages.forEach(function (stage, index) {
      var connection = scene.connections[index] || {};
      var byRole = {};
      scene.stageMembers(index).forEach(function (member) { byRole[member.role] = member; });
      var inSpeed = (byRole.input || byRole.S || { mechanical: {} }).mechanical.relativeSpeed;
      var outSpeed = (byRole.output || byRole.C || { mechanical: {} }).mechanical.relativeSpeed;
      var entry = { index: index, type: stage.type, attach: 'mesh', angleDeg: 0, centerDistance: null,
        inputSpeed: finite(inSpeed, 1), outputSpeed: finite(outSpeed, 0),
        schematic: scene.stageMembers(index).some(function (member) { return member.schematic; }),
        wheels: [], links: [] };

      if (stage.type === 'rack') rackStage(frame, stage, index, byRole, entry);
      else if (stage.type === 'planetary' || stage.type === 'epicyclic') planetaryStage(frame, scene, stage, index, byRole, entry);
      else pairStage(frame, connection, stage, index, byRole, entry);

      out.push(entry);
    });

    var wheels = [];
    out.forEach(function (entry) { entry.wheels.forEach(function (w) { wheels.push(w); }); });

    // §17 : les puces Entrée/Sortie se posaient sur wheels[0] et wheels[1],
    // c'est-à-dire sur l'ORDRE de dessin. Pour un planétaire, wheels[1] est la
    // couronne : la sortie était donc affichée sur l'organe FIXE, y compris
    // dans la configuration par défaut. La scène sait quel membre porte quelle
    // fonction — on le lui demande.
    function anchorFor(stageIndex, functional, fallback) {
      var wanted = scene.functionalMember ? scene.functionalMember(stageIndex, functional) : null;
      if (!wanted) return fallback || null;
      for (var i = 0; i < wheels.length; i++) {
        if (wheels[i].memberId === wanted.id) return wheels[i];
      }
      // Le porte-satellites n'est pas une roue : il n'a pas de denture, donc
      // pas de `wheel`. Il peut pourtant parfaitement porter l'entrée ou la
      // sortie, et c'est même la configuration planétaire la plus courante.
      var stage = out[stageIndex];
      if (stage && stage.carrier && stage.carrier.memberId === wanted.id) {
        return { memberId: wanted.id, cx: stage.carrier.cx, cy: stage.carrier.cy,
          chipR: finite(stage.carrier.chipR, finite(stage.carrier.orbit, 10) * 1.15) };
      }
      return fallback || null;
    }

    var first = out[0], last = out[out.length - 1];
    return {
      stages: out,
      wheels: wheels,
      shafts: shaftSegments(frame, scene),
      view: frame.view,
      // 'unfolded' ou 'projected' : ce que la vue AFFIRME. La distinction
      // décide de ce qu'on a le droit de lire sur le dessin.
      mode: frame.mode,
      projected: frame.projected,
      graph: frame.graph,
      spatial: frame.spatial,
      scene: scene,
      kinematics: scene.kinematics,
      io: {
        input: anchorFor(0, 'input', first ? first.wheels[0] : null),
        output: anchorFor(out.length - 1, 'output', last ? last.wheels[0] : null)
      }
    };
  }

  /**
   * Les arbres, avec leur LONGUEUR. Le dessin n'en avait pas : il posait un
   * trait de liaison entre deux centres, et deux roues d'un même arbre
   * partageaient un point. Un arbre est ici un segment porté par son axe, qui
   * dépasse de part et d'autre des organes qu'il porte — et sur lequel on peut
   * enfin voir que deux roues sont solidaires.
   */
  function shaftSegments(frame, scene) {
    return frame.spatial.shafts.map(function (shaft) {
      var drawn = frame.seats.shafts[shaft.id] || { origin: [0, 0], along: [1, 0] };
      var first = frame.spatial.byId[shaft.memberIds[0]];
      var last = frame.spatial.byId[shaft.memberIds[shaft.memberIds.length - 1]];
      var from = first.axialPosition - first.width / 2 - SpatialLayout.SHAFT_OVERHANG;
      var to = last.axialPosition + last.width / 2 + SpatialLayout.SHAFT_OVERHANG;
      return { id: shaft.id, role: shaft.role, grounded: !!shaft.grounded,
        memberIds: shaft.memberIds.slice(),
        // Les noms viennent de la scène : le dessin ne nomme rien lui-même.
        memberNames: shaft.memberIds.map(function (id) {
          var member = scene && scene.member ? scene.member(id) : null;
          return member ? (member.memberName || member.role) : id;
        }),
        x1: drawn.origin[0] + drawn.along[0] * from, y1: drawn.origin[1] + drawn.along[1] * from,
        x2: drawn.origin[0] + drawn.along[0] * to, y2: drawn.origin[1] + drawn.along[1] * to,
        // Un arbre vu en bout n'est pas un trait : c'est un point, et le
        // dessiner comme un segment de longueur nulle serait une trace muette.
        endOn: Math.hypot(drawn.along[0], drawn.along[1]) < 1e-9 };
    });
  }

  /**
   * Brin flexible exact, construit DANS LE PLAN DE COURROIE puis projeté.
   *
   * Les deux centres étaient pris à l'écran, et la géométrie exacte calculée
   * sur cette image : la courroie était donc plate même quand le mécanisme ne
   * l'était pas, et son enroulement se lisait sur un cercle que la vue avait
   * déjà déformé. Tangentes, arcs et longueur développée sont maintenant
   * calculés en millimètres réels dans le plan des poulies ; seule leur image
   * arrive à l'écran.
   */
  function flexibleLink(frame, connection, byRole, wIn, wOut, driveId) {
    var link = { kind: connection.type === 'belt' ? 'belt-span' : 'chain-span',
      crossed: !!connection.crossed,
      x1: wIn.cx, y1: wIn.cy, r1: wIn.pitchD / 2,
      x2: wOut.cx, y2: wOut.cy, r2: wOut.pitchD / 2,
      pitch: finite(connection.pitch, Math.PI * finite(wIn.module, 1)),
      elements: finite(connection.elements, 0),
      driveId: driveId };
    var placedIn = byRole.input && frame.spatial.byId[byRole.input.id];
    var placedOut = byRole.output && frame.spatial.byId[byRole.output.id];
    if (!placedIn || !placedOut) return link;
    var geometry = FlexibleDrive.build({
      axis: placedIn.axis, centre1: placedIn.position, centre2: placedOut.position,
      r1: link.r1, r2: link.r2, crossed: link.crossed, view: frame.view,
      // La courroie doit toucher les poulies TELLES QUE LA VUE LES A POSÉES :
      // en vue dépliée, celles-ci ne sont pas à leur projection stricte.
      drawn1: [wIn.cx, wIn.cy], drawn2: [wOut.cx, wOut.cy] });
    if (!geometry) return link;
    link.geometry = geometry;
    link.outline = geometry.outline;
    link.tangents = geometry.tangentPoints;
    link.spanLength = geometry.spanLength;
    link.wrapAngle1Deg = geometry.wrapAngle1Deg;
    link.wrapAngle2Deg = geometry.wrapAngle2Deg;
    link.length = geometry.length;
    link.centerDistance = geometry.distance;
    // Plan de courroie vu par la tranche : il n'y a plus de surface enroulée à
    // montrer, et le dire évite de coter un enroulement qu'on ne voit pas.
    link.collapsed = geometry.collapsed;
    return link;
  }

  return { layout: layout, wheelFromMember: wheelFromMember, frameOf: frameOf };
});
