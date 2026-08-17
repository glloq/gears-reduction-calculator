// MechanicalGraph.js - La transmission comme MÉCANISME, pas comme suite de dessins.
//
// Les trois vues descendaient chacune d'un placement à elles. La première
// posait les roues dans un plan XY et faisait avancer un curseur : pour une vis
// sans fin elle inclinait le couple de 90°, puis repartait du centre de la roue
// comme si de rien n'était. Cela dessine correctement un couple isolé et
// devient faux dès qu'il y a une suite, parce qu'un engrenage vu de face et une
// vis vue de profil ne peuvent pas être sur le même arbre.
//
// Ce module construit le niveau qui manquait : des AXES dans l'espace, des
// ARBRES portés par ces axes, des MEMBRES posés à une abscisse sur un arbre, et
// des MÉCANISMES qui relient tout cela par des ports. Il ne dessine rien et ne
// projette rien — c'est ce qui permet aux vues de le projeter chacune à sa
// façon sans jamais diverger sur la mécanique.
//
// Deux notions distinctes, et c'est essentiel :
//   AXE    — une droite de l'espace (origine + direction) ;
//   ARBRE  — un corps tournant porté par un axe.
// Un planétaire a UN axe et TROIS corps tournants coaxiaux — solaire, couronne,
// porte-satellites — dont l'un est généralement lié au bâti. Le modèle
// précédent n'avait qu'« arbre d'entrée » et « arbre de tout le reste ».
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./SceneBuilder.js') : root.GearSceneBuilder,
    common ? require('../../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry);
  if (common) module.exports = api; else root.GearMechanicalGraph = api;
})(typeof self !== 'undefined' ? self : this, function (SceneBuilder, Registry) {
  'use strict';

  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }

  // ===== Vecteurs =====

  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) { var n = norm(a); return n < 1e-9 ? [1, 0, 0] : scale(a, 1 / n); }
  function round(a) { return a.map(function (v) { return Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(9)); }); }

  /**
   * Une perpendiculaire canonique à `d` : celle qui reste stable quand `d`
   * tourne. Prendre systématiquement Z ou Y produirait un vecteur nul dès que
   * `d` s'aligne dessus.
   */
  function anyPerpendicular(d) {
    var reference = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    return unit(cross(d, reference));
  }

  /** Rotation de Rodrigues : `v` tourné de `angle` autour de l'axe unitaire `k`. */
  function rotateAround(v, k, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
  }

  // ===== Axes =====

  var ORIGIN_AXIS = { id: 'axis-0', origin: [0, 0, 0], direction: [1, 0, 0] };

  /**
   * L'axe de sortie d'un renvoi d'angle.
   *
   * L'AZIMUT est une propriété du mécanisme — dans quel plan le renvoi se
   * fait — et non une conséquence du rang de l'étage. La vue cinématique le
   * choisissait avec `nextPerpendicular(axis, index)`, c'est-à-dire selon la
   * parité : pratique pour éviter des superpositions, mais cela signifie que
   * deux réducteurs identiques dessinés à des rangs différents n'ont pas la
   * même géométrie. Ici il est lu sur l'étage, et vaut 0 par défaut : tous les
   * renvois se font alors dans le même plan, ce qu'un lecteur peut vérifier.
   */
  function perpendicularDirection(direction, azimuthDeg) {
    var base = anyPerpendicular(direction);
    return round(unit(rotateAround(base, unit(direction), finite(azimuthDeg, 0) * Math.PI / 180)));
  }

  function axisOffset(direction, distance, azimuthDeg) {
    if (!(Math.abs(distance) > 0)) return [0, 0, 0];
    return scale(perpendicularDirection(direction, azimuthDeg), distance);
  }

  // ===== Construction =====

  var GROUND_ID = 'ground';
  /** Les trois corps coaxiaux d'un planétaire, par leur code de schéma. */
  var BODY_ROLES = ['S', 'R', 'C'];
  var PLANET_ROLE = 'P';

  function shaftOf(graph, id) { return graph.byShaft[id] || null; }

  /**
   * Pose un membre sur un arbre, à une abscisse le long de l'axe.
   *
   * Deux roues successives d'un train composé sont sur le MÊME arbre — la roue
   * menée de l'étage n et le pignon menant de l'étage n+1. Sans abscisse elles
   * se retrouvaient au même point, donc superposées : le dessin montrait une
   * roue là où il y en a deux, et l'arbre n'avait pas de longueur.
   */
  function place(shaft, member, gap, at) {
    var width = finite(member.geometry && member.geometry.width, 0);
    var position = 0;
    if (Number.isFinite(at)) {
      position = at;
    } else if (shaft.members.length) {
      var last = shaft.members[shaft.members.length - 1];
      position = last.axialPosition + last.width / 2 + gap + width / 2;
    }
    var entry = { id: member.id, shaftId: shaft.id, memberRole: member.role,
      functionalRole: member.functionalRole, kind: member.kind,
      axialPosition: Number(position.toFixed(4)), width: width,
      geometry: member.geometry || {}, mechanical: member.mechanical || {} };
    shaft.members.push(entry);
    return entry;
  }

  function makeShaft(graph, axis, options) {
    options = options || {};
    var shaft = { id: options.id || ('shaft-' + graph.shafts.length), axisId: axis.id,
      role: options.role || 'intermediate',
      grounded: !!options.grounded,
      // La vitesse vient du moteur cinématique, jamais d'un calcul local.
      angularSpeed: options.grounded ? 0 : (options.angularSpeed == null ? null : options.angularSpeed),
      members: [] };
    graph.shafts.push(shaft);
    graph.byShaft[shaft.id] = shaft;
    return shaft;
  }

  function makeAxis(graph, origin, direction) {
    var axis = { id: 'axis-' + graph.axes.length, origin: round(origin), direction: round(unit(direction)) };
    graph.axes.push(axis);
    return axis;
  }

  function speedOf(member) {
    var rpm = member && member.mechanical && member.mechanical.rpm;
    return Number.isFinite(rpm) ? rpm : null;
  }

  /**
   * L'écart, le long de l'axe, entre le point de référence d'un organe et le
   * point où son axe rencontre celui de son partenaire.
   *
   * Il est nul pour tout ce qui est cylindrique — le plan d'engrènement passe
   * par le milieu de la denture. Un cône est l'exception : ses génératrices se
   * rejoignent en un SOMMET, situé à (d/2)/tan δ de sa grande face. Ignorer cet
   * écart posait les deux cônes d'un renvoi au même endroit, l'un dans l'autre.
   */
  function apexOffset(member) {
    if (!member || member.kind !== 'cone') return 0;
    var geometry = member.geometry || {};
    var delta = finite(geometry.coneAngleDeg, null);
    var diameter = finite(geometry.pitchDiameter, 0);
    if (delta === null || !(diameter > 0)) return 0;
    var slope = Math.tan(delta * Math.PI / 180);
    return Math.abs(slope) < 1e-6 ? 0 : (diameter / 2) / slope;
  }

  /**
   * Un étage à deux corps : engrenages, courroies, chaînes, vis sans fin.
   * Le membre menant reste sur l'arbre amont, le membre mené prend un arbre
   * neuf, sur un axe déduit de la relation d'axes de la famille.
   */
  function pairStage(graph, context, stage, index, members) {
    var relation = (stage.geometry && stage.geometry.axisRelation) ||
      (Registry && Registry.getAxisRelation ? Registry.getAxisRelation(stage) : 'parallel');
    var driving = members.filter(function (m) { return m.functionalRole === 'input'; })[0] || members[0];
    var driven = members.filter(function (m) { return m.functionalRole === 'output'; })[0] || members[members.length - 1];
    var inputAxis = graph.byAxis[context.shaft.axisId];
    var azimuth = stage.parameters && stage.parameters.azimuthDeg;
    var distance = finite(stage.geometry && stage.geometry.centerDistance, 0);

    // Le membre MENANT est posé d'abord, parce que c'est son abscisse qui dit
    // OÙ l'engrènement a lieu. Partir de l'abscisse du membre précédent — ce
    // que faisait `context.cursor` — plaçait la roue d'une vis sans fin en
    // face de l'entrée de l'arbre plutôt qu'en face du filet, et laissait deux
    // roues d'un même engrènement dans deux plans différents.
    var seated = place(context.shaft, driving, context.gap);
    var seat = seated.axialPosition + apexOffset(driving);
    var contact = add(inputAxis.origin, scale(inputAxis.direction, seat));

    var axis, drivenAt = apexOffset(driven);
    if (relation === 'coaxial') {
      // Même axe, autre corps tournant : le mené est concentrique au menant.
      axis = inputAxis;
      drivenAt = seat;
    } else if (relation === 'perpendicular') {
      // Le renvoi part du point de contact, sur l'axe d'entrée, et repart
      // perpendiculairement : c'est ce qui fait qu'un engrenage placé APRÈS un
      // renvoi n'est plus dans le plan du précédent.
      var turn = perpendicularDirection(inputAxis.direction, azimuth);
      axis = makeAxis(graph, add(contact, scale(turn, distance)), cross(inputAxis.direction, turn));
    } else {
      // Parallèle : même direction, décalé de l'entraxe, à la même abscisse.
      axis = makeAxis(graph, add(contact, axisOffset(inputAxis.direction, distance, azimuth)), inputAxis.direction);
    }

    var next = makeShaft(graph, axis, { angularSpeed: speedOf(driven) });
    members.forEach(function (member) {
      if (member === driving) return;
      place(next, member, context.gap, member === driven ? drivenAt : undefined);
    });

    graph.mechanisms.push({ id: 'mesh-' + index, stageIndex: index, type: stage.type,
      relation: relation, azimuthDeg: finite(azimuth, 0),
      inputPort: { memberId: driving.id, shaftId: context.shaft.id },
      outputPort: { memberId: driven.id, shaftId: next.id },
      fixedPort: null });
    return next;
  }

  /**
   * Un planétaire : UN axe, TROIS corps tournants coaxiaux, et des satellites
   * portés par le porte-satellites.
   *
   * C'est le cas que le modèle précédent ne pouvait pas représenter : il
   * rangeait le membre d'entrée sur l'arbre amont et TOUS les autres — couronne,
   * satellites, porte-satellites — sur un unique « arbre de sortie ». Or
   * l'organe bloqué ne tourne pas, les satellites tournent sur eux-mêmes tout
   * en orbitant, et un seul des trois continue vers l'étage suivant.
   */
  function planetaryStage(graph, context, stage, index, members) {
    var axis = graph.byAxis[context.shaft.axisId];
    var byRole = {};
    members.forEach(function (member) { byRole[member.role] = member; });

    // La scène nomme les organes par leur CODE de schéma — S, R, P, C — et
    // c'est elle qui fait foi : recopier « sun » ou « ring » ici créerait un
    // second vocabulaire, qui finirait par ne plus correspondre.
    var bodies = {}, ports = {};
    BODY_ROLES.forEach(function (role) {
      var member = byRole[role];
      if (!member) return;
      var functional = member.functionalRole;
      // L'organe d'ENTRÉE prolonge l'arbre amont : c'est le même corps tournant.
      if (functional === 'input') { bodies[role] = context.shaft; place(context.shaft, member, context.gap); return; }
      var grounded = functional === 'fixed';
      var shaft = makeShaft(graph, axis, {
        id: 'shaft-' + graph.shafts.length + '-' + role,
        role: grounded ? 'fixed' : functional === 'output' ? 'driven' : 'intermediate',
        grounded: grounded, angularSpeed: speedOf(member)
      });
      place(shaft, member, context.gap);
      bodies[role] = shaft;
      if (grounded) graph.ground.memberIds.push(member.id);
    });

    // Les satellites ne sont sur aucun des trois : ils tournent sur eux-mêmes
    // AUTOUR d'un axe qui orbite avec le porte-satellites.
    var carrier = bodies.C || context.shaft;
    members.filter(function (m) { return m.role === PLANET_ROLE; }).forEach(function (planet, n) {
      var orbit = makeAxis(graph, axis.origin, axis.direction);
      var shaft = makeShaft(graph, orbit, { id: 'shaft-' + graph.shafts.length + '-planet-' + n,
        role: 'planet', angularSpeed: speedOf(planet) });
      shaft.carriedBy = carrier.id;
      // Le rayon d'orbite est une propriété du MEMBRE, telle que la scène
      // l'établit — pas une cote de denture. Le chercher dans `geometry` le
      // rendait toujours nul, et les satellites se retrouvaient tous au centre.
      shaft.orbitRadius = finite(planet.orbitRadius, finite(planet.geometry && planet.geometry.orbitRadius, null));
      // La scène décrit les satellites par UN membre : le nombre réel est une
      // propriété du corps, que le renderer instanciera autant de fois.
      shaft.count = Math.max(2, Math.round(finite(stage.planetCount, 3)));
      place(shaft, planet, context.gap);
    });

    BODY_ROLES.forEach(function (role) {
      var member = byRole[role];
      if (!member || !bodies[role]) return;
      ports[member.functionalRole || 'intermediate'] = { memberId: member.id, shaftId: bodies[role].id };
    });

    graph.mechanisms.push({ id: 'planetary-' + index, stageIndex: index, type: stage.type,
      relation: 'coaxial', azimuthDeg: 0,
      inputPort: ports.input || null, outputPort: ports.output || null, fixedPort: ports.fixed || null });

    // C'est la SORTIE qui continue, quel que soit l'organe qui la porte : une
    // couronne de sortie entraîne l'étage suivant exactement comme un
    // porte-satellites de sortie.
    var out = ports.output && graph.byShaft[ports.output.shaftId];
    return out || bodies.C || context.shaft;
  }

  /** Une crémaillère : le pignon tourne, la crémaillère TRANSLATE. */
  function rackStage(graph, context, stage, index, members) {
    var axis = graph.byAxis[context.shaft.axisId];
    var pinion = members.filter(function (m) { return m.kind !== 'rack'; })[0] || members[0];
    var rack = members.filter(function (m) { return m.kind === 'rack'; })[0];
    place(context.shaft, pinion, context.gap);
    var slide = { id: 'slide-' + index, stageIndex: index,
      // La translation se fait perpendiculairement à l'axe du pignon, dans le
      // plan de son cercle primitif.
      direction: perpendicularDirection(axis.direction, (stage.parameters && stage.parameters.azimuthDeg) || 0),
      memberId: rack ? rack.id : null,
      travelPerRevolution: finite(stage.geometry && stage.geometry.travelPerRevolution, null) };
    graph.slides.push(slide);
    graph.mechanisms.push({ id: 'rack-' + index, stageIndex: index, type: stage.type,
      relation: 'linear', azimuthDeg: 0,
      inputPort: { memberId: pinion.id, shaftId: context.shaft.id },
      outputPort: rack ? { memberId: rack.id, slideId: slide.id } : null,
      fixedPort: null });
    return context.shaft;
  }

  /**
   * build(solution, scene) → graphe mécanique spatial.
   * La scène reste la source unique des géométries et des vitesses : ce module
   * ne recalcule aucune mécanique, il en organise la topologie dans l'espace.
   */
  function build(solution, scene) {
    solution = solution || {};
    scene = scene || (SceneBuilder && SceneBuilder.build ? SceneBuilder.build(solution) : null);
    var stages = solution.stages || [];
    var gap = finite(solution.shaftGapMm, 6);

    var graph = { axes: [], shafts: [], mechanisms: [], slides: [],
      ground: { id: GROUND_ID, memberIds: [] }, byShaft: {}, byAxis: {} };
    var first = makeAxis(graph, ORIGIN_AXIS.origin, ORIGIN_AXIS.direction);
    var inputShaft = makeShaft(graph, first, { id: 'shaft-in', role: 'input',
      angularSpeed: Number.isFinite(solution.inputSpeedRpm) ? solution.inputSpeedRpm : null });
    graph.axes.forEach(function (axis) { graph.byAxis[axis.id] = axis; });

    var context = { shaft: inputShaft, cursor: 0, gap: gap };
    stages.forEach(function (stage, index) {
      var members = (scene && scene.stageMembers ? scene.stageMembers(index) : []) || [];
      if (!members.length) return;
      var kind = stage.type === 'planetary' || stage.type === 'epicyclic' ? 'planetary'
        : stage.type === 'rack' ? 'rack' : 'pair';
      var next = kind === 'planetary' ? planetaryStage(graph, context, stage, index, members)
        : kind === 'rack' ? rackStage(graph, context, stage, index, members)
          : pairStage(graph, context, stage, index, members);
      // Le curseur avance le long de l'axe courant : c'est là que le renvoi
      // suivant prendra naissance.
      var last = context.shaft.members[context.shaft.members.length - 1];
      context.cursor = last ? last.axialPosition : context.cursor;
      context.shaft = next;
      graph.axes.forEach(function (axis) { graph.byAxis[axis.id] = axis; });
    });
    // La SORTIE est celle du dernier mécanisme, pas le dernier arbre créé :
    // sur un planétaire, les satellites sont créés après le porte-satellites et
    // le bâti après l'entrée. Prendre le dernier revenait à faire sortir la
    // puissance par les satellites.
    var lastMechanism = graph.mechanisms[graph.mechanisms.length - 1];
    var out = lastMechanism && lastMechanism.outputPort && graph.byShaft[lastMechanism.outputPort.shaftId];
    if (out && !out.grounded && out.role !== 'input') out.role = 'output';

    graph.byId = {};
    graph.shafts.forEach(function (shaft) {
      shaft.members.forEach(function (member) { graph.byId[member.id] = member; });
    });

    /** L'arbre qui porte ce membre — la question de base d'un train composé. */
    graph.shaftFor = function (memberId) {
      var member = graph.byId[memberId];
      return member ? shaftOf(graph, member.shaftId) : null;
    };
    /** Tout ce qui tourne AVEC ce membre : le corps rigide auquel il appartient. */
    graph.rigidBodyOf = function (memberId) {
      var shaft = graph.shaftFor(memberId);
      return shaft ? shaft.members.map(function (m) { return m.id; }) : [];
    };
    graph.axisFor = function (shaftId) {
      var shaft = shaftOf(graph, shaftId);
      return shaft ? graph.byAxis[shaft.axisId] : null;
    };
    /** Les corps tournants distincts, bâti exclu. */
    graph.rotatingBodies = function () {
      return graph.shafts.filter(function (shaft) { return !shaft.grounded && shaft.members.length; });
    };
    return graph;
  }

  return { build: build, GROUND_ID: GROUND_ID,
    // Exportés pour les tests : la géométrie vectorielle doit se vérifier seule.
    vector: { add: add, scale: scale, dot: dot, cross: cross, unit: unit, norm: norm,
      rotateAround: rotateAround, perpendicularDirection: perpendicularDirection } };
});
