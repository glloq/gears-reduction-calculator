// TrainLayout.js - Placement pur de la vue « Denture réaliste ».
//
// TrainLayout ne fait QUE du placement. Il ne lit pas `stage.geometry` et ne
// calcule aucun rapport : il consomme la SCÈNE (SceneBuilder), qui porte la
// géométrie de chaque membre et sa vitesse relative. Produit des positions
// monde en millimètres réels, sans DOM. UMD : testable sous Node.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./core/SceneBuilder.js') : root.GearSceneBuilder,
    common ? require('./core/GeometryUtils.js') : root.GearGeometryUtils);
  if (common) module.exports = api; else root.GearTrainLayout = api;
})(typeof self !== 'undefined' ? self : this, function (SceneBuilder, GeometryUtils) {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }

  // Angles candidats pour poser la roue de sortie autour de la roue d'entrée :
  // horizontal d'abord, puis zigzag alterné pour éviter les collisions.
  var MESH_ANGLES = [0, 35, -35, 65, -65, 90, -90];

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
      leadAngle: Number.isFinite(g.leadAngleDeg) ? g.leadAngleDeg : undefined,
      coneAngleDeg: Number.isFinite(g.coneAngleDeg) ? g.coneAngleDeg : undefined,
      schematic: !!(entry && entry.schematic),
      speed: entry && Number.isFinite(entry.mechanical.relativeSpeed) ? entry.mechanical.relativeSpeed : 0,
      cx: 0, cy: 0, phase: 0
    }, overrides || {});
  }

  /** Rayon d'encombrement du premier membre d'un étage (pose après rupture). */
  function inputRadius(scene, index) {
    var members = scene.stageMembers(index);
    return members.reduce(function (max, entry) {
      var g = entry.geometry;
      var d = Math.max(finite(g.outsideDiameter, 0), finite(g.pitchDiameter, 0), finite(g.rootDiameter, 0));
      return Math.max(max, d / 2);
    }, 10);
  }

  function collides(cx, cy, r, placed, clearance) {
    return placed.some(function (w) {
      var dx = cx - w.cx, dy = cy - w.cy;
      var minD = r + w.outsideD / 2 + clearance;
      return dx * dx + dy * dy < minD * minD;
    });
  }

  function sceneFor(stages, options) {
    if (options.scene && options.scene.member) return options.scene;
    return SceneBuilder.build({ inputRpm: 1, stages: stages });
  }

  /**
   * layout(stages, mechanical, options) → {
   *   stages: [{ index, type, attach, angleDeg, centerDistance, wheels[], links[] }],
   *   wheels: toutes les roues à plat (collisions/fit),
   *   io: { input: wheel, output: wheel }
   * }
   * `options.scene` injecte la scène déjà construite par le renderer.
   * Toutes les coordonnées sont finies (les NaN dans les attributs SVG
   * produisent des erreurs console, fatales pour les e2e).
   */
  function layout(stages, mechanical, options) {
    stages = stages || [];
    options = options || {};
    var scene = sceneFor(stages, options);
    var placed = [];
    var out = [];
    var cursor = { x: 0, y: 0 };
    var preferSign = 1;
    var maxX = 0;

    stages.forEach(function (stage, index) {
      var prefix = 's' + index + '-';
      var connection = scene.connections[index] || {};
      var byRole = {};
      scene.stageMembers(index).forEach(function (entry) { byRole[entry.role] = entry; });
      var m = finite((byRole.input || byRole.S || {}).geometry && (byRole.input || byRole.S).geometry.module, 1);
      var inSpeed = (byRole.input || byRole.S || { mechanical: {} }).mechanical.relativeSpeed;
      var outSpeed = (byRole.output || byRole.C || { mechanical: {} }).mechanical.relativeSpeed;
      var entry = { index: index, type: stage.type, attach: 'mesh', angleDeg: 0, centerDistance: null,
        inputSpeed: finite(inSpeed, 1), outputSpeed: finite(outSpeed, 0),
        schematic: scene.stageMembers(index).some(function (e) { return e.schematic; }),
        wheels: [], links: [] };

      if (stage.type === 'rack') {
        var pinion = wheelFromMember(byRole.input, { cx: cursor.x, cy: cursor.y });
        pinion.cy = cursor.y - pinion.pitchD / 2;
        var travel = finite(byRole.rack && byRole.rack.geometry.travelPerRevolution, Math.PI * pinion.pitchD);
        var rack = wheelFromMember(byRole.rack, {
          cx: cursor.x, cy: cursor.y, pitchD: 0, outsideD: 4 * m, rootD: m, module: m,
          teeth: Math.max(6, Math.round(travel / (Math.PI * m))), length: travel,
          // Le pignon entraîne la crémaillère : mm parcourus par radian d'entrée.
          mmPerRadian: finite(byRole.rack && byRole.rack.mechanical.mmPerRadian, pinion.pitchD / 2),
          pinionSpeed: pinion.speed, linearId: prefix + 'rack',
          // La puce SORTIE s'écarte de toute la demi-course, pas du seul profil.
          chipR: travel / 2 });
        entry.attach = 'linear';
        entry.wheels.push(pinion, rack);
        entry.stageRadius = Math.max(pinion.pitchD, travel) / 2;
        placed.push(pinion);
        maxX = Math.max(maxX, cursor.x + travel / 2);
        cursor = { x: cursor.x + travel / 2, y: pinion.cy };
      } else if (stage.type === 'planetary' || stage.type === 'epicyclic') {
        // Étage coaxial complet centré au curseur, aux diamètres réels.
        var count = Math.max(2, Math.round(finite(byRole.P && byRole.P.count, 3)));
        var orbit = finite(byRole.P && byRole.P.orbitRadius, 0);
        entry.attach = 'coaxial';

        // Les rôles de rendu restent parlants (sun/ring/planet) : ce sont eux
        // que portent les classes CSS et la sélection.
        var sun = wheelFromMember(byRole.S, { role: 'sun', cx: cursor.x, cy: cursor.y });
        var ring = wheelFromMember(byRole.R, { role: 'ring', cx: cursor.x, cy: cursor.y });
        // La couronne enveloppe l'étage : sa jante fixe l'encombrement.
        ring.outsideD = Math.max(ring.pitchD + 6 * m, finite(byRole.R && byRole.R.geometry.rootDiameter, 0) + 2 * m);
        sun.chipR = ring.chipR = ring.outsideD / 2 + m;
        entry.wheels.push(sun, ring);
        for (var pi = 0; pi < count; pi++) {
          var a = 2 * Math.PI * pi / count;
          entry.wheels.push(wheelFromMember(byRole.P, {
            role: 'planet',
            cx: cursor.x + Math.cos(a) * orbit, cy: cursor.y + Math.sin(a) * orbit,
            orbit: orbit, orbitCenterX: cursor.x, orbitCenterY: cursor.y,
            orbitSpeed: finite(byRole.P && byRole.P.mechanical.orbitRelativeSpeed, 0), phase: a
          }));
        }
        entry.members = { input: stage.inputMember || 'S', output: stage.outputMember || 'C', fixed: stage.fixed || 'R' };
        entry.carrierSpeed = finite(byRole.C && byRole.C.mechanical.relativeSpeed, 0);
        entry.carrier = { memberId: prefix + 'C', cx: cursor.x, cy: cursor.y, orbit: orbit, count: count,
          speed: entry.carrierSpeed };
        entry.stageRadius = ring.outsideD / 2;
        placed.push(ring);
        maxX = Math.max(maxX, cursor.x + ring.outsideD / 2);

        if (index < stages.length - 1) {
          var nextR = inputRadius(scene, index + 1);
          var gap = Math.max(20, 6 * m);
          entry.links.push({ kind: 'shaft-break', x1: cursor.x + ring.outsideD / 2, y1: cursor.y,
            x2: maxX + gap, y2: cursor.y });
          cursor = { x: maxX + gap + nextR, y: cursor.y };
        }
      } else if (stage.type === 'bevel') {
        // Deux cônes primitifs aux angles réels, dont les axes se croisent en un
        // POINT unique : c'est ce sommet commun qui rend le montage lisible.
        var sigma = finite(connection.shaftAngleDeg, 90);
        var input = wheelFromMember(byRole.input, { cx: cursor.x, cy: cursor.y, axisAngleDeg: 0 });
        var output = wheelFromMember(byRole.output);
        var delta1 = finite(input.coneAngleDeg, 45), delta2 = finite(output.coneAngleDeg, 45);
        // Distance de la grande face au sommet, le long de chaque axe.
        var back1 = (input.pitchD / 2) / Math.max(1e-6, Math.tan(rad(delta1)));
        var back2 = (output.pitchD / 2) / Math.max(1e-6, Math.tan(rad(delta2)));
        var apexX = cursor.x + back1, apexY = cursor.y;
        var outAxis = rad(180 - sigma);
        output.cx = apexX + Math.cos(outAxis) * back2;
        output.cy = apexY + Math.sin(outAxis) * back2;
        output.axisAngleDeg = (outAxis * 180 / Math.PI) + 180;   // pointe vers le sommet

        entry.attach = 'break';
        entry.angleDeg = sigma;
        entry.apex = { x: apexX, y: apexY };
        entry.wheels.push(input, output);
        entry.links.push({ kind: 'bevel-axes', x: apexX, y: apexY, shaftAngleDeg: sigma,
          span: Math.max(back1, back2) + Math.max(input.pitchD, output.pitchD) / 2 });
        placed.push(input, output);
        maxX = Math.max(maxX, output.cx + output.outsideD / 2, cursor.x + input.outsideD / 2);
        if (index < stages.length - 1) {
          var nextR2 = inputRadius(scene, index + 1);
          var gap2 = Math.max(20, 6 * m);
          entry.links.push({ kind: 'shaft-break', x1: maxX, y1: output.cy, x2: maxX + gap2, y2: output.cy });
          cursor = { x: maxX + gap2 + nextR2, y: output.cy };
        } else {
          cursor = { x: output.cx, y: output.cy };
        }
      } else {
        // Paires : droit/hélicoïdal (externe), interne, vis sans fin,
        // courroie/chaîne — entraxe RÉEL porté par la connexion de la scène.
        var isBeltLike = stage.type === 'belt' || stage.type === 'chain';
        var isInternal = stage.type === 'internal';
        var isWorm = stage.type === 'worm';
        var c = finite(connection.centerDistance, 40);
        entry.centerDistance = c;
        entry.exactCenterDistance = !!connection.exactCenterDistance;

        var wIn = wheelFromMember(byRole.input, { cx: cursor.x, cy: cursor.y });
        var wOut = wheelFromMember(byRole.output);
        if (isBeltLike) {
          wIn.outsideD = wIn.pitchD + m; wOut.outsideD = wOut.pitchD + m;
          wIn.rootD = wIn.pitchD - m; wOut.rootD = wOut.pitchD - m;
        }

        var angle = 0;
        if (isWorm) {
          angle = 90; // roue sous la vis (axes perpendiculaires)
        } else if (!isBeltLike) {
          // Premier angle candidat sans collision, préférence alternée.
          var rOut = wOut.outsideD / 2;
          var clearance = Math.max(4, 2 * m);
          for (var ai = 0; ai < MESH_ANGLES.length; ai++) {
            var candidate = MESH_ANGLES[ai] * preferSign;
            var cxTry = cursor.x + Math.cos(rad(candidate)) * c;
            var cyTry = cursor.y + Math.sin(rad(candidate)) * c;
            if (!collides(cxTry, cyTry, isInternal ? 0 : rOut, placed, isInternal ? 0 : clearance)) { angle = candidate; break; }
          }
          preferSign = -preferSign;
        }
        entry.angleDeg = angle;
        wOut.cx = cursor.x + Math.cos(rad(angle)) * c;
        wOut.cy = cursor.y + Math.sin(rad(angle)) * c;

        entry.wheels.push(wIn, wOut);
        if (isBeltLike) entry.links.push(flexibleLink(connection, wIn, wOut, prefix + 'drive'));
        placed.push(wIn, wOut);
        maxX = Math.max(maxX, wIn.cx + wIn.outsideD / 2, wOut.cx + wOut.outsideD / 2);
        cursor = { x: wOut.cx, y: wOut.cy };
      }

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
      scene: scene,
      kinematics: scene.kinematics,
      io: {
        input: anchorFor(0, 'input', first ? first.wheels[0] : null),
        output: anchorFor(out.length - 1, 'output', last ? last.wheels[0] : null)
      }
    };
  }

  /**
   * Brin flexible exact : tangentes calculées, longueur développée et angles
   * d'enroulement réels. En cas de géométrie dégénérée on retombe sur les deux
   * segments sommet-à-sommet, qui restent finis.
   */
  function flexibleLink(connection, wIn, wOut, driveId) {
    var link = { kind: connection.type === 'belt' ? 'belt-span' : 'chain-span',
      crossed: !!connection.crossed,
      x1: wIn.cx, y1: wIn.cy, r1: wIn.pitchD / 2,
      x2: wOut.cx, y2: wOut.cy, r2: wOut.pitchD / 2,
      pitch: finite(connection.pitch, Math.PI * finite(wIn.module, 1)),
      elements: finite(connection.elements, 0),
      driveId: driveId };
    try {
      var path = GeometryUtils.flexiblePath({ x: link.x1, y: link.y1 }, { x: link.x2, y: link.y2 }, link.r1, link.r2, link.crossed);
      // Le chemin complet est conservé : c'est lui, et non les seuls brins
      // droits, qui porte l'abscisse curviligne des éléments animés.
      link.path = path;
      link.tangents = path.tangents;
      link.spanLength = path.spanLength;
      link.wrapAngle1Deg = path.wrapAngle1 * 180 / Math.PI;
      link.wrapAngle2Deg = path.wrapAngle2 * 180 / Math.PI;
      link.length = path.length;
      link.outline = GeometryUtils.flexibleOutline(path, link.r1, link.r2);
    } catch (e) {
      link.tangents = null;
    }
    return link;
  }

  return { layout: layout, inputRadius: inputRadius, wheelFromMember: wheelFromMember, MESH_ANGLES: MESH_ANGLES };
});
