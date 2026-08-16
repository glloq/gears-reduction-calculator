// TrainLayout.js - Placement pur de la vue « Denture réaliste ».
// Consomme les étages structurés (stage.geometry calculée par le moteur) et
// produit des positions monde en millimètres réels : aucune géométrie
// inventée, aucun DOM. UMD : testable sous Node (tests/train-layout.test.js).
//
// Les vitesses ne sont PAS recalculées ici : elles viennent de KinematicsEngine,
// source unique partagée par les trois vues. TrainLayout ne fait que du placement.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry,
    common ? require('./core/KinematicsEngine.js') : root.GearKinematicsEngine,
    common ? require('./core/GeometryUtils.js') : root.GearGeometryUtils);
  if (common) module.exports = api; else root.GearTrainLayout = api;
})(typeof self !== 'undefined' ? self : this, function (Registry, Kinematics, GeometryUtils) {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }

  // Angles candidats pour poser la roue de sortie autour de la roue d'entrée :
  // horizontal d'abord, puis zigzag alterné pour éviter les collisions.
  var MESH_ANGLES = [0, 35, -35, 65, -65, 90, -90];

  function wheelModel(stage, side) {
    var g = stage.geometry || {};
    var p = stage.parameters || {};
    var m = finite(p.module, 1);
    var isInput = side === 'input';
    var pitch = finite(isInput ? g.pitchDiameterInput : g.pitchDiameterOutput, 20);
    var outside = finite(isInput ? g.outsideDiameterInput : g.outsideDiameterOutput, pitch + 2 * m);
    var roots = finite(isInput ? g.rootDiameterInput : g.rootDiameterOutput, pitch - 2.5 * m);
    var teeth = stage.type === 'worm'
      ? (isInput ? stage.wormStarts : stage.wheelTeeth)
      : (stage[side] && stage[side].teeth);
    var model = {
      role: side, kind: 'gear',
      pitchD: pitch, outsideD: outside, rootD: Math.max(roots, pitch * 0.3),
      baseD: finite(isInput ? g.baseDiameterInput : g.baseDiameterOutput, pitch * Math.cos(rad(finite(g.pressureAngleDeg, 20)))),
      teeth: finite(teeth, 0), module: m,
      pressureAngle: finite(g.pressureAngleDeg, 20),
      profileShift: finite(isInput ? p.profileShiftInput : p.profileShiftOutput, 0),
      faceWidth: finite(g.width, 10 * m),
      cx: 0, cy: 0, speed: 0, phase: 0
    };
    // L'hélice n'est portée que par les dentures hélicoïdales : c'est elle qui
    // distingue visuellement l'étage d'un engrenage droit.
    if (stage.type === 'helical') {
      model.helixAngle = finite(p.helixAngle, 20);
      model.helixHand = isInput ? (p.helixHand || 'right') : (p.helixHand === 'left' ? 'right' : 'left');
    }
    return model;
  }

  // Rayon utile de la première roue d'un étage (pour poser après une rupture).
  function inputRadius(stage) {
    var g = stage.geometry || {};
    var m = finite(stage.parameters && stage.parameters.module, 1);
    if (stage.type === 'planetary') return finite(g.ringDiameter, 60) / 2 + m;
    if (stage.type === 'worm') return finite(g.pitchDiameterInput, 10) / 2 + m;
    return finite(g.outsideDiameterInput, finite(g.pitchDiameterInput, 20) + 2 * m) / 2;
  }

  function collides(cx, cy, r, placed, clearance) {
    return placed.some(function (w) {
      var dx = cx - w.cx, dy = cy - w.cy;
      var minD = r + w.outsideD / 2 + clearance;
      return dx * dx + dy * dy < minD * minD;
    });
  }

  // Vitesses relatives : l'arbre d'entrée vaut 1, tout le reste en découle.
  function speeds(stages, injected) {
    if (injected && injected.members) return injected;
    try { return Kinematics.build({ inputRpm: 1, stages: stages }); }
    catch (e) { return { members: {}, linear: {}, flexible: {}, inputOmega: 1 }; }
  }
  function omega(state, id, fallback) {
    var scale = finite(state.inputOmega, 1) || 1;
    var member = (state.members || {})[id];
    return member ? member.omega / scale : finite(fallback, 0);
  }

  /**
   * layout(stages, mechanical, options) → {
   *   stages: [{ index, type, attach, angleDeg, centerDistance, wheels[], links[] }],
   *   wheels: toutes les roues à plat (collisions/fit),
   *   io: { input: wheel, output: wheel }
   * }
   * options.kinematics permet d'injecter l'état cinématique déjà construit par
   * la scène, pour éviter de le reconstruire.
   * Toutes les coordonnées sont finies (les NaN dans les attributs SVG
   * produisent des erreurs console, fatales pour les e2e).
   */
  function layout(stages, mechanical, options) {
    stages = stages || [];
    options = options || {};
    var kinematics = speeds(stages, options.kinematics);
    var placed = [];
    var out = [];
    var cursor = { x: 0, y: 0 };
    var preferSign = 1;
    var maxX = 0;

    stages.forEach(function (stage, index) {
      var g = stage.geometry || {};
      var p = stage.parameters || {};
      var m = finite(p.module, 1);
      var prefix = 's' + index + '-';
      var inSpeed = omega(kinematics, prefix + 'input', 1);
      var outSpeed = omega(kinematics, prefix + 'output', 0);
      var entry = { index: index, type: stage.type, attach: 'mesh', angleDeg: 0, centerDistance: null,
        inputSpeed: inSpeed, outputSpeed: outSpeed, wheels: [], links: [] };

      if (stage.type === 'rack') {
        var rackD = finite(g.pitchDiameterInput, m * finite(stage.pinionTeeth, 20));
        var rackLength = finite(g.travelPerRevolution, Math.PI * rackD);
        var pinion = { role: 'input', kind: 'gear', cx: cursor.x, cy: cursor.y - rackD / 2, pitchD: rackD,
          outsideD: finite(g.maxDiameter, rackD + 2 * m), rootD: Math.max(m, rackD - 2.5 * m),
          baseD: rackD * Math.cos(rad(finite(g.pressureAngleDeg, 20))),
          teeth: finite(stage.pinionTeeth, 20), module: m, pressureAngle: finite(g.pressureAngleDeg, 20),
          faceWidth: finite(g.width, 10 * m), speed: inSpeed };
        var rack = { role: 'output', kind: 'rack', cx: cursor.x, cy: cursor.y, pitchD: 0, outsideD: 4 * m, rootD: m,
          teeth: Math.max(6, Math.round(rackLength / (Math.PI * m))), module: m,
          pressureAngle: finite(g.pressureAngleDeg, 20), speed: 0, length: rackLength,
          // Le pignon entraîne la crémaillère : mm parcourus par radian d'entrée.
          mmPerRadian: rackD / 2, pinionSpeed: inSpeed, travelPerRevolution: rackLength, linearId: prefix + 'rack',
          // La puce SORTIE s'écarte de toute la demi-course, pas du seul profil.
          chipR: rackLength / 2 };
        entry.attach = 'linear';
        entry.wheels.push(pinion, rack);
        entry.stageRadius = Math.max(rackD, rackLength) / 2;
        placed.push(pinion);
        maxX = Math.max(maxX, cursor.x + rackLength / 2);
        cursor = { x: cursor.x + rackLength / 2, y: pinion.cy };
      } else if (stage.type === 'planetary') {
        // Étage coaxial complet centré au curseur, aux diamètres réels.
        var sunD = finite(g.sunDiameter, m * finite(stage.sunTeeth, 12));
        var ringD = finite(g.ringDiameter, m * finite(stage.ringTeeth, 48));
        var planetD = finite(g.planetDiameter, (ringD - sunD) / 2);
        var count = Math.max(2, Math.round(finite(stage.planetCount, 3)));
        var orbit = (sunD + planetD) / 2;
        var wS = omega(kinematics, prefix + 'S', inSpeed);
        var wR = omega(kinematics, prefix + 'R', 0);
        var wC = omega(kinematics, prefix + 'C', outSpeed);
        var wP = omega(kinematics, prefix + 'P', 0);
        var zp = Math.max(1, finite(stage.planetTeeth, (finite(stage.ringTeeth, 48) - finite(stage.sunTeeth, 12)) / 2));

        entry.attach = 'coaxial';
        var sun = { role: 'sun', kind: 'gear', cx: cursor.x, cy: cursor.y, pitchD: sunD, outsideD: sunD + 2 * m,
          rootD: Math.max(sunD - 2.5 * m, sunD * 0.4), baseD: sunD * Math.cos(rad(20)),
          teeth: finite(stage.sunTeeth, 0), module: m, pressureAngle: 20, faceWidth: finite(g.width, 10 * m),
          speed: wS, orbit: 0, chipR: ringD / 2 + 3 * m };
        var ring = { role: 'ring', kind: 'internal-ring', cx: cursor.x, cy: cursor.y, pitchD: ringD,
          outsideD: ringD + 6 * m, rootD: ringD - 2 * m, baseD: ringD * Math.cos(rad(20)),
          teeth: finite(stage.ringTeeth, 0), module: m, pressureAngle: 20, faceWidth: finite(g.width, 10 * m),
          speed: wR, chipR: ringD / 2 + 3 * m };
        entry.wheels.push(sun, ring);
        for (var pi = 0; pi < count; pi++) {
          var a = 2 * Math.PI * pi / count;
          entry.wheels.push({
            role: 'planet', kind: 'gear',
            cx: cursor.x + Math.cos(a) * orbit, cy: cursor.y + Math.sin(a) * orbit,
            pitchD: planetD, outsideD: planetD + 2 * m, rootD: Math.max(planetD - 2.5 * m, planetD * 0.4),
            baseD: planetD * Math.cos(rad(20)),
            teeth: zp, module: m, pressureAngle: 20, faceWidth: finite(g.width, 10 * m), speed: wP,
            orbit: orbit, orbitCenterX: cursor.x, orbitCenterY: cursor.y, orbitSpeed: wC, phase: a
          });
        }
        entry.members = { input: stage.inputMember || 'S', output: stage.outputMember || 'C', fixed: stage.fixed || 'R' };
        entry.carrierSpeed = wC;
        entry.carrier = { cx: cursor.x, cy: cursor.y, orbit: orbit, count: count, speed: wC };
        entry.stageRadius = ring.outsideD / 2;
        placed.push(ring);
        maxX = Math.max(maxX, cursor.x + ring.outsideD / 2);

        // Sortie coaxiale : rupture d'axe avant l'étage suivant.
        if (index < stages.length - 1) {
          var nextR = inputRadius(stages[index + 1]);
          var gap = Math.max(20, 6 * m);
          var startX = cursor.x + ring.outsideD / 2;
          var nextX = maxX + gap + nextR;
          entry.links.push({ kind: 'shaft-break', x1: startX, y1: cursor.y, x2: nextX - nextR, y2: cursor.y });
          cursor = { x: nextX, y: cursor.y };
        }
      } else if (stage.type === 'bevel') {
        // Deux cônes primitifs aux angles réels, dont les axes se croisent en un
        // POINT unique : c'est ce sommet commun qui rend le montage lisible.
        var sigma = finite(g.shaftAngleDeg, 90);
        var d1 = finite(g.pitchDiameterInput, 20), d2 = finite(g.pitchDiameterOutput, 40);
        var delta1 = finite(g.pitchConeAngleInput, 45), delta2 = finite(g.pitchConeAngleOutput, 45);
        // Distance de la grande face au sommet, le long de chaque axe.
        var back1 = (d1 / 2) / Math.max(1e-6, Math.tan(rad(delta1)));
        var back2 = (d2 / 2) / Math.max(1e-6, Math.tan(rad(delta2)));
        var apexX = cursor.x + back1, apexY = cursor.y;

        var input = wheelModel(stage, 'input');
        input.kind = 'cone'; input.cx = cursor.x; input.cy = cursor.y; input.speed = inSpeed;
        input.coneAngleDeg = delta1;
        input.axisAngleDeg = 0;                       // se rétrécit vers le sommet
        input.outsideD = finite(g.outerDiameterInput, d1 + 2 * m);

        // Axe de sortie : σ mesuré depuis l'axe d'entrée, dans le plan du dessin.
        var outAxis = rad(180 - sigma);
        var output = wheelModel(stage, 'output');
        output.kind = 'cone';
        output.coneAngleDeg = delta2;
        output.outsideD = finite(g.outerDiameterOutput, d2 + 2 * m);
        output.cx = apexX + Math.cos(outAxis) * back2;
        output.cy = apexY + Math.sin(outAxis) * back2;
        output.axisAngleDeg = (outAxis * 180 / Math.PI) + 180;   // pointe vers le sommet
        output.speed = outSpeed;

        entry.attach = 'break';
        entry.angleDeg = sigma;
        entry.apex = { x: apexX, y: apexY };
        entry.wheels.push(input, output);
        entry.links.push({ kind: 'bevel-axes', x: apexX, y: apexY, shaftAngleDeg: sigma,
          span: Math.max(back1, back2) + Math.max(d1, d2) / 2 });
        placed.push(input, output);
        maxX = Math.max(maxX, output.cx + output.outsideD / 2, cursor.x + input.outsideD / 2);
        if (index < stages.length - 1) {
          var nextR2 = inputRadius(stages[index + 1]);
          var gap2 = Math.max(20, 6 * m);
          var nextX2 = maxX + gap2 + nextR2;
          entry.links.push({ kind: 'shaft-break', x1: maxX, y1: output.cy, x2: nextX2 - nextR2, y2: output.cy });
          cursor = { x: nextX2, y: output.cy };
        } else {
          cursor = { x: output.cx, y: output.cy };
        }
      } else {
        // Paires : droit/hélicoïdal (externe), interne, vis sans fin,
        // courroie/chaîne — entraxe RÉEL de la géométrie calculée.
        var isBeltLike = stage.type === 'belt' || stage.type === 'chain';
        var isInternal = stage.type === 'internal';
        var isWorm = stage.type === 'worm';
        var c = finite(g.correctedCenterDistance, finite(g.centerDistance, 40));
        entry.centerDistance = c;

        var wIn = wheelModel(stage, 'input');
        var wOut = wheelModel(stage, 'output');
        if (isBeltLike) {
          wIn.kind = wOut.kind = stage.type === 'belt' ? 'pulley' : 'sprocket';
          wIn.outsideD = wIn.pitchD + m; wOut.outsideD = wOut.pitchD + m;
          wIn.rootD = wIn.pitchD - m; wOut.rootD = wOut.pitchD - m;
        }
        if (isInternal) wOut.kind = 'internal-ring';
        if (isWorm) {
          wIn.kind = 'worm';
          wIn.leadAngle = finite(p.leadAngle, 20);
          wIn.teeth = finite(stage.wormStarts, 1);
        }

        wIn.cx = cursor.x; wIn.cy = cursor.y;
        wIn.speed = inSpeed;

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
        wOut.speed = outSpeed;

        entry.wheels.push(wIn, wOut);
        if (isBeltLike) entry.links.push(flexibleLink(stage, wIn, wOut, kinematics.flexible && kinematics.flexible[prefix + 'drive']));
        placed.push(wIn, wOut);
        maxX = Math.max(maxX, wIn.cx + wIn.outsideD / 2, wOut.cx + wOut.outsideD / 2);
        cursor = { x: wOut.cx, y: wOut.cy };
      }

      out.push(entry);
    });

    var wheels = [];
    out.forEach(function (entry) { entry.wheels.forEach(function (w) { wheels.push(w); }); });
    var first = out[0], last = out[out.length - 1];
    return {
      stages: out,
      wheels: wheels,
      kinematics: kinematics,
      io: {
        input: first ? first.wheels[0] : null,
        // Pour un planétaire, wheels[1] est la couronne (repère visuel de sortie).
        output: last ? (last.wheels[1] || last.wheels[0]) : null
      }
    };
  }

  /**
   * Brin flexible exact : tangentes calculées, longueur développée et angles
   * d'enroulement réels. En cas de géométrie dégénérée on retombe sur les deux
   * segments sommet-à-sommet, qui restent finis.
   */
  function flexibleLink(stage, wIn, wOut, drive) {
    var link = { kind: stage.type === 'belt' ? 'belt-span' : 'chain-span',
      crossed: !!(stage.parameters && stage.parameters.crossed),
      x1: wIn.cx, y1: wIn.cy, r1: wIn.pitchD / 2,
      x2: wOut.cx, y2: wOut.cy, r2: wOut.pitchD / 2,
      pitch: finite(stage.parameters && stage.parameters.pitch, Math.PI * finite(wIn.module, 1)),
      elements: finite(stage.geometry && (stage.geometry.beltTeeth || stage.geometry.links), 0),
      driveId: drive && drive.id };
    try {
      var path = GeometryUtils.flexiblePath({ x: link.x1, y: link.y1 }, { x: link.x2, y: link.y2 }, link.r1, link.r2, link.crossed);
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

  return { layout: layout, inputRadius: inputRadius, wheelModel: wheelModel, MESH_ANGLES: MESH_ANGLES };
});
