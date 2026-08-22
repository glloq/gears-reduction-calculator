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
    common ? require('./core/ProjectedScene.js') : root.GearProjectedScene,
    common ? require('./overlays/ForceOverlay.js') : root.GearForceOverlay);
  if (common) module.exports = api; else root.GearTrainLayout = api;
})(typeof self !== 'undefined' ? self : this, function (SceneBuilder, FlexibleDrive, MechanicalGraph, SpatialLayout, Projection, ProjectedScene, ForceOverlay) {
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
      axisAngleDeg: seen.axisAngleDeg,
      // L'ELLIPSE APPARENTE de tout cercle porté par cet axe. C'est la seule
      // description de la forme projetée : les surfaces primitives, de tête et
      // de pied s'y accrochent au lieu que chaque couche redérive la sienne du
      // raccourci — d'où, en iso, une roue elliptique cerclée de trois cercles.
      apparent: seen.apparent };
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
    // La profondeur de l'AXE d'orbite : c'est autour d'elle que les satellites
    // se répartissent, l'un devant, l'autre derrière.
    var seenPlanet = frame.projected.member(byRole.P && byRole.P.id);
    var orbitDepth = seenPlanet ? finite(seenPlanet.depth, 0) : 0;
    for (var pi = 0; pi < count; pi++) {
      var a = 2 * Math.PI * pi / count;
      var seat = ProjectedScene.orbitPoint(basis, orbit, a);
      entry.wheels.push(wheelAt(frame, byRole.P, {
        role: 'planet',
        // Un organe dessiné PLUSIEURS fois : le numéro d'exemplaire est la
        // seule chose qui distingue quatre satellites portant le même
        // identifiant de membre, et le tri en profondeur les mélange.
        instance: pi,
        cx: centre.x + seat.x, cy: centre.y + seat.y,
        // Chaque satellite a SA position dans l'espace, donc SA profondeur.
        // Ils héritaient tous de celle de leur axe commun : quatre satellites
        // à la même profondeur, alors que deux sont devant la couronne et deux
        // derrière — le tri global n'avait alors rien à trier.
        depth: orbitDepth + seat.depth,
        // La base voyage avec le satellite : c'est elle, et non un `rotate()`
        // d'écran, qui donne sa place à chaque instant de l'animation.
        orbit: orbit, orbitCenterX: centre.x, orbitCenterY: centre.y, orbitBasis: basis,
        orbitDepth: orbitDepth,
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
    var carrierSeen = byRole.C && frame.projected.member(byRole.C.id);
    entry.carrier = { memberId: 's' + index + '-C', cx: centre.x, cy: centre.y, orbit: orbit, count: count,
      speed: entry.carrierSpeed, basis: basis,
      // La profondeur du porte-satellites : c'est elle qui décide s'il passe
      // devant ou derrière une pièce voisine, comme pour toute autre pièce.
      depth: carrierSeen ? carrierSeen.depth : 0,
      // Le porte-satellites tourne autour du MÊME axe que l'étage : son moyeu
      // se voit donc sous la même ellipse que le solaire et la couronne.
      apparent: carrierSeen ? carrierSeen.apparent : null,
      axisAngleDeg: carrierSeen ? carrierSeen.axisAngleDeg : 0,
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
    // La ligne primitive de la crémaillère est TANGENTE au cercle primitif du
    // pignon. Elle se pose donc à un rayon primitif du centre — un rayon porté
    // par l'espace, qu'il faut projeter comme le reste. Reporté tel quel sur la
    // normale d'écran, il laissait le pignon flotter à côté de sa crémaillère
    // dès que la vue n'était plus de face.
    var offset = slide && slide.contact
      ? screenOffset(frame, slide.contact, pinion.pitchD / 2)
      : [-along[1] * pinion.pitchD / 2, along[0] * pinion.pitchD / 2];
    // La COURSE aussi se raccourcit : c'est une longueur de l'espace, portée
    // par la glissière.
    var drawnTravel = frame.mode === 'unfolded' ? travel : travel * length;
    var rack = wheelFromMember(byRole.rack, {
      cx: pinion.cx + offset[0],
      cy: pinion.cy + offset[1],
      axisAngleDeg: deg(Math.atan2(along[1], along[0])),
      pitchD: 0, outsideD: 4 * m, rootD: m, module: m,
      teeth: Math.max(6, Math.round(travel / (Math.PI * m))), length: drawnTravel,
      // Le pignon entraîne la crémaillère : mm parcourus par radian d'entrée.
      mmPerRadian: finite(byRole.rack && byRole.rack.mechanical.mmPerRadian, pinion.pitchD / 2),
      pinionSpeed: pinion.speed, linearId: 's' + index + '-rack',
      slideAlong: along,
      // La puce SORTIE s'écarte de toute la demi-course, pas du seul profil.
      chipR: drawnTravel / 2 });
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

    // Un cône s'amincit vers le SOMMET COMMUN du couple. Le supposer toujours
    // dans le sens de l'axe revient à parier sur l'orientation que le graphe a
    // donnée à cet axe : l'un des deux cônes se dessinait donc pointe tournée
    // vers l'extérieur du couple, sur toutes les vues.
    var coneApexSides = stage.type === 'bevel' ? coneSides(frame, byRole.input, byRole.output) : null;
    if (coneApexSides) { wIn.apexSide = coneApexSides.sideA; wOut.apexSide = coneApexSides.sideB; }
    entry.wheels.push(wIn, wOut);
    if (isBeltLike) entry.links.push(flexibleLink(frame, connection, byRole, wIn, wOut, 's' + index + '-drive'));
    if (stage.type === 'bevel') {
      // Les deux axes se coupent en un POINT unique : le sommet commun des
      // cônes primitifs. Le modèle spatial le connaît — c'est lui qui a servi
      // à placer les deux roues.
      var apex = apexOf(frame, byRole, coneApexSides);
      if (apex) {
        entry.apex = apex;
        entry.links.push({ kind: 'bevel-axes', x: apex.x, y: apex.y,
          shaftAngleDeg: finite(connection.shaftAngleDeg, 90),
          inAlong: alongOf(frame, byRole.input.id), outAlong: alongOf(frame, byRole.output.id),
          inSpan: apex.inSpan, outSpan: apex.outSpan,
          span: Math.max(apex.inSpan, apex.outSpan) });
      }
    }
    entry.stageRadius = Math.max(wIn.outsideD, wOut.outsideD) / 2;
  }

  /** De quel côté de chaque organe se trouve le sommet commun d'un couple. */
  function coneSides(frame, input, output) {
    if (!input || !output) return null;
    function cone(entry) {
      var placed = frame.spatial.byId[entry.id];
      var back = SpatialLayout.coneBack(finite(entry.geometry.pitchDiameter, 0), entry.geometry.coneAngleDeg);
      return placed && back ? { position: placed.position, axis: placed.axis, back: back } : null;
    }
    var a = cone(input), b = cone(output);
    var apex = SpatialLayout.coneApex(a, b);
    // Deux sommets qui ne se rejoignent pas ne sont pas un sommet : mieux vaut
    // ne rien orienter que d'orienter d'après une coïncidence approximative.
    //
    // L'écart se juge À L'ÉCHELLE DU COUPLE — un millième de la plus courte des
    // deux distances sommet-organe. Un seuil absolu rapporté à la distance à
    // l'origine se resserrait près du repère et se relâchait au loin, et un
    // renvoi à 60°, dont les cosinus ne tombent pas juste, passait à quelques
    // microns de le manquer : les deux cônes se seraient alors amincis du même
    // côté, pointes tournées vers l'extérieur du couple.
    if (!apex) return null;
    var scale = Math.max(1e-6, Math.min(a.back, b.back));
    return apex.gap < scale * 1e-3 ? apex : null;
  }

  /**
   * CE QUI RESTE d'une longueur portée par l'axe, une fois projetée.
   *
   * La vue dépliée conserve les longueurs vraies — c'est sa définition. Une
   * projection, elle, raccourcit ce qui a de la profondeur : `minor² + axialScale² = 1`
   * relie exactement ce raccourci à l'ouverture de l'ellipse apparente, si bien
   * qu'une seule valeur décrit les deux et qu'elles ne peuvent pas se contredire.
   */
  /**
   * LE VECTEUR D'ÉCRAN d'un déplacement de `distance` dans la direction
   * `direction` de l'espace.
   *
   * C'est la seule règle à connaître pour poser un point qui n'est pas un
   * organe — un sommet de cône, une ligne primitive de crémaillère. Les deux
   * systèmes de dessin y répondent différemment, et c'est tout le contrat :
   * la vue DÉPLIÉE conserve la longueur vraie et ne prend de la projection que
   * la direction ; une PROJECTION raccourcit la longueur avec elle. Reporter
   * une longueur vraie sur une direction projetée — ce que faisait le sommet
   * des cônes — revient à mélanger les deux, et rien ne tombe plus en face.
   */
  function scaled(vector, factor) {
    return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
  }

  function screenOffset(frame, direction, distance, fallback) {
    if (!direction) return [0, 0];
    var xy = Projection.project(direction, frame.view);
    var length = Math.hypot(xy[0], xy[1]);
    // Une direction sans image à l'écran ne dit plus de quel côté aller. En vue
    // DÉPLIÉE, l'arbre en porte pourtant une : c'est celle le long de laquelle
    // ses organes sont rangés, et c'est donc elle qui vaut. Sans ce repli, le
    // sommet d'un cône dont l'axe pointe vers l'œil retombait sur le centre de
    // la roue — à quarante millimètres de là où les deux axes se coupent.
    if (!(length > 1e-9)) {
      if (!fallback || frame.mode !== 'unfolded') return [0, 0];
      return [fallback[0] * distance, fallback[1] * distance];
    }
    var factor = frame.mode === 'unfolded' ? distance / length : distance;
    return [xy[0] * factor, xy[1] * factor];
  }

  function axialScaleOf(frame, memberId) {
    if (frame.mode === 'unfolded') return 1;
    var seen = frame.projected && frame.projected.member(memberId);
    var minor = seen && seen.apparent && seen.apparent.major > 0
      ? seen.apparent.minor / seen.apparent.major : 0;
    return Math.sqrt(Math.max(0, 1 - minor * minor));
  }

  /**
   * Le sommet commun de deux cônes primitifs, dans le repère du dessin.
   *
   * La distance sommet-organe est une longueur VRAIE, portée par l'axe : la
   * reporter telle quelle sur la direction d'écran de l'arbre revient à ignorer
   * le raccourci de la projection. Le sommet tombait donc trop loin — en
   * isométrie, une fois et demie trop loin — et les deux cônes, chacun dessiné
   * autour du sien, ne se rejoignaient plus.
   */
  function apexOf(frame, byRole, sides) {
    var input = byRole.input, output = byRole.output;
    if (!input || !output) return null;
    function back(member) {
      return SpatialLayout.coneBack(finite(member.geometry.pitchDiameter, 0),
        finite(member.geometry.coneAngleDeg, null));
    }
    var back1 = back(input), back2 = back(output);
    if (back1 === null || back2 === null) return null;
    // De quel CÔTÉ de l'organe se trouve le sommet : c'est le COUPLE qui le
    // dit — le point où les deux axes se coupent —, pas le sens que le graphe a
    // donné à l'axe d'entrée.
    var sign = sides && sides.sideA < 0 ? -1 : 1;
    var placed = frame.spatial.byId[input.id];
    var seat = seatOf(frame, input.id);
    var drawn = alongOf(frame, input.id);
    var reach = screenOffset(frame, placed ? scaled(placed.axis, sign) : [1, 0, 0], back1,
      [drawn[0] * sign, drawn[1] * sign]);
    return { x: seat.x + reach[0], y: seat.y + reach[1],
      back1: back1, back2: back2,
      // Les DEMI-LONGUEURS d'axe à tracer, chacune dans son propre raccourci :
      // un axe de construction dépasse la pièce qu'il porte, il ne traverse pas
      // le dessin entier.
      inSpan: (back1 + finite(input.geometry.width, back1 * 0.2)) * axialScaleOf(frame, input.id),
      outSpan: (back2 + finite(output.geometry.width, back2 * 0.2)) * axialScaleOf(frame, output.id) };
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

      // Le repère des efforts, une fois l'étage placé : il a besoin des roues
      // dessinées pour savoir OÙ les flèches s'appliquent.
      entry.forceFrame = forceFrameOf(frame, index, byRole, entry);
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
      // Non nul quand le dessin est ÉCLATÉ : la vue doit alors l'annoncer, et
      // personne ne doit prendre une distance axiale sur ce dessin.
      exploded: frame.exploded || null,
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
   * Le repère mécanique dans lequel vivent Ft, Fr et Fa, et le point où ils
   * s'appliquent : le point primitif, là où les dents se touchent.
   *
   * Les trois directions étaient écrites en dur à l'écran — Ft horizontal, Fr
   * vertical, Fa à 45° —, la même rosace pour toutes les familles et tous les
   * points de vue. Elle vient maintenant de l'axe de l'organe menant et de la
   * ligne des centres. Un étage dont on ne sait pas construire cette ligne n'a
   * pas de repère, et ne reçoit donc aucune flèche.
   */
  /** Ce qui sépare deux points UNE FOIS l'écart le long de l'axe retiré. */
  function distanceOffAxis(driver, mate) {
    var vector = MechanicalGraph.vector;
    var delta = [mate[0] - driver.position[0], mate[1] - driver.position[1], mate[2] - driver.position[2]];
    var along = vector.dot(delta, driver.axis);
    return vector.norm([delta[0] - driver.axis[0] * along, delta[1] - driver.axis[1] * along,
      delta[2] - driver.axis[2] * along]);
  }

  function forceFrameOf(frame, index, byRole, entry) {
    var vector = MechanicalGraph.vector;
    function placed(member) { return member && frame.spatial.byId[member.id]; }
    var driver = placed(byRole.input) || placed(byRole.S);
    if (!driver) return null;
    var driven = placed(byRole.output) || placed(byRole.P);
    var mate = driven ? driven.position : null;
    // Un satellite est placé sur l'axe du porte-satellites : le modèle spatial
    // ne lui donne pas encore de position propre (les ports du planétaire
    // restent à faire). Sa ligne des centres est celle qui sert à le DESSINER
    // — le premier rayon d'orbite —, pas une direction inventée pour l'occasion.
    if (mate && entry.carrier && entry.carrier.orbit > 0 &&
        distanceOffAxis(driver, mate) < 1e-9) {
      mate = vector.add(driver.position,
        vector.scale(vector.perpendicularDirection(driver.axis, 0), entry.carrier.orbit));
    }
    if (!mate) {
      // Une crémaillère n'a pas de centre : sa ligne des centres est la
      // perpendiculaire commune à l'axe du pignon et à la glissière.
      var slide = (frame.graph.slides || []).filter(function (s) { return s.stageIndex === index; })[0];
      if (!slide) return null;
      mate = vector.add(driver.position, vector.cross(driver.axis, slide.direction));
    }
    // Le point d'application, à l'écran : sur la ligne des centres DESSINÉE, à
    // un rayon primitif du centre menant.
    var from = entry.wheels[0];
    var to = entry.wheels.filter(function (wheel) { return wheel.role === 'planet'; })[0] || entry.wheels[1];
    var origin = [finite(from && from.cx, 0), finite(from && from.cy, 0)];
    if (from && to) {
      var dx = to.cx - from.cx, dy = to.cy - from.cy;
      var span = Math.hypot(dx, dy);
      if (span > 1e-9) {
        var reach = Math.min(finite(from.pitchD, 0) / 2, span);
        origin = [from.cx + dx / span * reach, from.cy + dy / span * reach];
      }
    }
    return ForceOverlay.frame({ axis: driver.axis, centre: driver.position, mate: mate,
      view: frame.view, origin: origin });
  }

  /**
   * Les arbres, avec leur LONGUEUR. Le dessin n'en avait pas : il posait un
   * trait de liaison entre deux centres, et deux roues d'un même arbre
   * partageaient un point. Un arbre est ici un segment porté par son axe, qui
   * dépasse de part et d'autre des organes qu'il porte — et sur lequel on peut
   * enfin voir que deux roues sont solidaires.
   */
  /**
   * Un arbre découpé en portions, du plus loin au plus près.
   *
   * Un arbre perpendiculaire au regard est à une seule profondeur : le
   * découper n'apporterait rien, et une portion suffit. Un arbre CROISÉ plonge
   * dans la profondeur — son premier bout passe devant les roues qu'il
   * traverse, son second derrière. Le dessin le posait d'un bloc au fond, sous
   * toutes les dentures : un arbre qui sort vers l'observateur s'enfonçait
   * quand même derrière sa propre roue.
   */
  var SHAFT_PARTS = 8;
  function shaftParts(seen) {
    if (seen.endOn) return [];
    var from = finite(seen.depthStart, finite(seen.depth, 0));
    var to = finite(seen.depthEnd, from);
    // Ce qui sort des roues : là où l'arbre les traverse, il est dans le métal.
    // Le dessin y posait quand même son trait, en travers du moyeu.
    var spans = visibleSpans(seen.hidden || []);
    var flat = Math.abs(to - from) < 1e-6;
    var list = [];
    spans.forEach(function (span) {
      // Un arbre perpendiculaire au regard est à une seule profondeur : le
      // découper n'apprendrait rien. Un arbre croisé plonge, et chaque tronçon
      // prend sa place dans le tri.
      // Un tronçon d'arbre croisé est toujours coupé au moins en deux : même
      // court, il plonge, et ses deux moitiés ne se trient pas au même endroit.
      var slices = flat ? 1 : Math.max(2, Math.round(SHAFT_PARTS * (span[1] - span[0])));
      for (var i = 0; i < slices; i++) {
        var a = span[0] + (span[1] - span[0]) * i / slices;
        var b = span[0] + (span[1] - span[0]) * (i + 1) / slices;
        list.push({
          x1: seen.x1 + (seen.x2 - seen.x1) * a, y1: seen.y1 + (seen.y2 - seen.y1) * a,
          x2: seen.x1 + (seen.x2 - seen.x1) * b, y2: seen.y1 + (seen.y2 - seen.y1) * b,
          // La profondeur du MILIEU du tronçon : c'est elle qui le situe.
          depth: from + (to - from) * (a + b) / 2 });
      }
    });
    return list;
  }

  /** [0, 1] moins les intervalles cachés, fusionnés et bornés. */
  function visibleSpans(hidden) {
    var blocks = hidden.map(function (span) {
      return [Math.max(0, Math.min(1, span[0])), Math.max(0, Math.min(1, span[1]))];
    }).filter(function (span) { return span[1] - span[0] > 1e-6; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var spans = [], cursor = 0;
    blocks.forEach(function (span) {
      if (span[0] > cursor + 1e-6) spans.push([cursor, span[0]]);
      cursor = Math.max(cursor, span[1]);
    });
    if (cursor < 1 - 1e-6) spans.push([cursor, 1]);
    return spans;
  }

  function shaftSegments(frame, scene) {
    return frame.spatial.shafts.map(function (shaft) {
      // Les extrémités viennent de la SCÈNE PROJETÉE, telles quelles. Elles
      // étaient recalculées ici à partir de l'origine et de la direction, en
      // millimètres réels : l'arbre gardait donc sa longueur vraie là où tout
      // le reste du dessin était raccourci, et un arbre oblique dépassait de
      // ses propres roues. Deux géométries concurrentes pour une seule pièce.
      var seen = frame.projected.shaft(shaft.id) || { x1: 0, y1: 0, x2: 0, y2: 0, endOn: true };
      return { id: shaft.id, role: shaft.role, grounded: !!shaft.grounded,
        memberIds: shaft.memberIds.slice(),
        // Les noms viennent de la scène : le dessin ne nomme rien lui-même.
        memberNames: shaft.memberIds.map(function (id) {
          var member = scene && scene.member ? scene.member(id) : null;
          return member ? (member.memberName || member.role) : id;
        }),
        x1: seen.x1, y1: seen.y1, x2: seen.x2, y2: seen.y2,
        along: seen.along, depth: seen.depth,
        // Les PORTIONS de l'arbre, chacune avec sa profondeur : c'est ce qui
        // permet de l'intercaler entre les roues qu'il traverse au lieu de le
        // poser en bloc au fond du dessin.
        parts: shaftParts(seen),
        // Un arbre vu en bout n'est pas un trait : c'est un point, et le
        // dessiner comme un segment de longueur nulle serait une trace muette.
        endOn: seen.endOn };
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
