// TrainLayout.js - Placement pur de la vue « Denture réaliste ».
// Consomme les étages structurés (stage.geometry calculée par le moteur) et
// produit des positions monde en millimètres réels : aucune géométrie
// inventée, aucun DOM. UMD : testable sous Node (tests/train-layout.test.js).
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports
    ? require('../transmissions/TransmissionRegistry.js')
    : root.GearTransmissionRegistry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearTrainLayout = api;
})(typeof self !== 'undefined' ? self : this, function (Registry) {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }

  // Angles candidats pour poser la roue de sortie autour de la roue d'entrée :
  // horizontal d'abord, puis zigzag alterné pour éviter les collisions.
  var MESH_ANGLES = [0, 35, -35, 65, -65, 90, -90];

  function wheelModel(stage, side) {
    var g = stage.geometry || {};
    var m = finite(stage.parameters && stage.parameters.module, 1);
    var isInput = side === 'input';
    var pitch = finite(isInput ? g.pitchDiameterInput : g.pitchDiameterOutput, 20);
    var outside = finite(isInput ? g.outsideDiameterInput : g.outsideDiameterOutput, pitch + 2 * m);
    var roots = finite(isInput ? g.rootDiameterInput : g.rootDiameterOutput, pitch - 2.5 * m);
    var teeth = stage.type === 'worm'
      ? (isInput ? stage.wormStarts : stage.wheelTeeth)
      : (stage[side] && stage[side].teeth);
    return {
      role: side, kind: 'gear',
      pitchD: pitch, outsideD: outside, rootD: Math.max(roots, pitch * 0.3),
      teeth: finite(teeth, 0), module: m,
      pressureAngle: finite(g.pressureAngleDeg, 20),
      cx: 0, cy: 0, speed: 0, phase: 0
    };
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

  /**
   * layout(stages, mechanical) → {
   *   stages: [{ index, type, attach, angleDeg, centerDistance, wheels[], links[] }],
   *   wheels: toutes les roues à plat (collisions/fit),
   *   io: { input: wheel, output: wheel }
   * }
   * Toutes les coordonnées sont finies (les NaN dans les attributs SVG
   * produisent des erreurs console, fatales pour les e2e).
   */
  function layout(stages, mechanical) {
    stages = stages || [];
    mechanical = mechanical || [];
    var placed = [];
    var out = [];
    var cursor = { x: 0, y: 0 };
    var speed = 1;   // vitesse relative de l'arbre d'entrée de l'étage courant
    var dir = 1;     // sens de rotation de cet arbre
    var preferSign = 1;
    var maxX = 0;

    stages.forEach(function (stage, index) {
      var g = stage.geometry || {};
      var m = finite(stage.parameters && stage.parameters.module, 1);
      var mech = mechanical[index] || {};
      var ratio = Math.max(1e-9, finite(mech.ratio, Math.abs(finite(g.pitchDiameterOutput, 40) / Math.max(1e-9, finite(g.pitchDiameterInput, 20)))));
      var signedSign = finite(mech.signedRatio, -ratio) < 0 ? -1 : 1;
      var outSpeed = speed / ratio;
      var outDir = dir * signedSign;
      var entry = { index: index, type: stage.type, attach: 'mesh', angleDeg: 0, centerDistance: null, wheels: [], links: [] };

      if (stage.type === 'rack') {
        var rackD = finite(g.pitchDiameterInput, m * finite(stage.pinionTeeth, 20));
        var rackLength = finite(g.travelPerRevolution, Math.PI * rackD);
        var pinion = { role: 'input', kind: 'gear', cx: cursor.x, cy: cursor.y - rackD / 2, pitchD: rackD, outsideD: finite(g.maxDiameter, rackD + 2 * m), rootD: Math.max(m, rackD - 2.5 * m), teeth: finite(stage.pinionTeeth, 20), module: m, pressureAngle: finite(g.pressureAngleDeg, 20), speed: speed * dir };
        var rack = { role: 'output', kind: 'rack', cx: cursor.x, cy: cursor.y, pitchD: 0, outsideD: 2 * m, rootD: m, teeth: Math.max(6, Math.round(rackLength / (Math.PI * m))), module: m, pressureAngle: finite(g.pressureAngleDeg, 20), speed: speed * dir, length: rackLength };
        entry.attach = 'linear';
        entry.wheels.push(pinion, rack);
        entry.stageRadius = Math.max(rackD, rackLength) / 2;
        placed.push(pinion);
        maxX = Math.max(maxX, cursor.x + rackLength / 2);
      } else if (stage.type === 'planetary') {
        // Étage coaxial complet centré au curseur, aux diamètres réels.
        var sunD = finite(g.sunDiameter, m * finite(stage.sunTeeth, 12));
        var ringD = finite(g.ringDiameter, m * finite(stage.ringTeeth, 48));
        var planetD = finite(g.planetDiameter, (ringD - sunD) / 2);
        var count = Math.max(2, Math.round(finite(stage.planetCount, 3)));
        var orbit = (sunD + planetD) / 2;
        var speeds = null;
        try { speeds = Registry.get('planetary').calculateSpeeds(stage, speed * dir).speeds; } catch (e) { speeds = null; }
        var wS = speeds ? finite(speeds.S, 0) : speed * dir;
        var wR = speeds ? finite(speeds.R, 0) : 0;
        var wC = speeds ? finite(speeds.C, 0) : outSpeed * outDir;
        var zp = Math.max(1, finite(stage.planetTeeth, (finite(stage.ringTeeth, 48) - finite(stage.sunTeeth, 12)) / 2));
        var wP = wC - (finite(stage.sunTeeth, 12) / zp) * (wS - wC);

        entry.attach = 'coaxial';
        var sun = { role: 'sun', kind: 'gear', cx: cursor.x, cy: cursor.y, pitchD: sunD, outsideD: sunD + 2 * m, rootD: Math.max(sunD - 2.5 * m, sunD * 0.4), teeth: finite(stage.sunTeeth, 0), module: m, pressureAngle: 20, speed: wS, orbit: 0, chipR: ringD / 2 + 3 * m };
        var ring = { role: 'ring', kind: 'internal-ring', cx: cursor.x, cy: cursor.y, pitchD: ringD, outsideD: ringD + 3 * m, rootD: ringD - 2 * m, teeth: finite(stage.ringTeeth, 0), module: m, pressureAngle: 20, speed: wR, chipR: ringD / 2 + 3 * m };
        entry.wheels.push(sun, ring);
        for (var p = 0; p < count; p++) {
          var a = 2 * Math.PI * p / count;
          entry.wheels.push({
            role: 'planet', kind: 'gear',
            cx: cursor.x + Math.cos(a) * orbit, cy: cursor.y + Math.sin(a) * orbit,
            pitchD: planetD, outsideD: planetD + 2 * m, rootD: Math.max(planetD - 2.5 * m, planetD * 0.4),
            teeth: zp, module: m, pressureAngle: 20, speed: wP,
            orbit: orbit, orbitCenterX: cursor.x, orbitCenterY: cursor.y, carrierSpeed: wC, phase: a
          });
        }
        entry.members = { input: stage.inputMember || 'S', output: stage.outputMember || 'C', fixed: stage.fixed || 'R' };
        entry.carrierSpeed = wC;
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
        // Deux cônes silhouettes, axes à l'angle réel ; rupture d'axe après.
        var sigma = finite(g.shaftAngleDeg, 90);
        var d1 = finite(g.pitchDiameterInput, 20), d2 = finite(g.pitchDiameterOutput, 40);
        var input = wheelModel(stage, 'input'); input.kind = 'cone'; input.cx = cursor.x; input.cy = cursor.y; input.speed = speed * dir;
        var output = wheelModel(stage, 'output'); output.kind = 'cone';
        var offset = (d1 + d2) / 2;
        output.cx = cursor.x + Math.cos(rad(sigma - 90)) * offset;
        output.cy = cursor.y + Math.sin(rad(sigma - 90)) * offset + d1 / 2;
        output.speed = outSpeed * outDir;
        entry.attach = 'break';
        entry.angleDeg = sigma;
        entry.wheels.push(input, output);
        entry.links.push({ kind: 'bevel-axes', x: cursor.x, y: cursor.y, shaftAngleDeg: sigma, span: Math.max(d1, d2) });
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
        if (isBeltLike) { wIn.kind = wOut.kind = stage.type === 'belt' ? 'pulley' : 'sprocket'; wIn.outsideD = wIn.pitchD + m; wOut.outsideD = wOut.pitchD + m; wIn.rootD = wIn.pitchD - m; wOut.rootD = wOut.pitchD - m; }
        if (isInternal) wOut.kind = 'internal-ring';
        if (isWorm) { wIn.kind = 'worm'; wIn.leadAngle = finite(stage.parameters && stage.parameters.leadAngle, 20); }

        wIn.cx = cursor.x; wIn.cy = cursor.y;
        wIn.speed = speed * dir;

        var angle = 0;
        if (isWorm) {
          angle = 90; // roue sous la vis (axes perpendiculaires)
        } else if (!isBeltLike) {
          // Premier angle candidat sans collision, préférence alternée.
          var rOut = (isInternal ? wOut.outsideD : wOut.outsideD) / 2;
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
        wOut.speed = outSpeed * outDir;

        entry.wheels.push(wIn, wOut);
        if (isBeltLike) {
          entry.links.push({
            kind: stage.type === 'belt' ? 'belt-span' : 'chain-span',
            crossed: !!(stage.parameters && stage.parameters.crossed),
            x1: wIn.cx, y1: wIn.cy, r1: wIn.pitchD / 2,
            x2: wOut.cx, y2: wOut.cy, r2: wOut.pitchD / 2
          });
        }
        placed.push(wIn, wOut);
        maxX = Math.max(maxX, wIn.cx + wIn.outsideD / 2, wOut.cx + wOut.outsideD / 2);
        cursor = { x: wOut.cx, y: wOut.cy };
      }

      out.push(entry);
      speed = outSpeed;
      dir = outDir;
    });

    var wheels = [];
    out.forEach(function (entry) { entry.wheels.forEach(function (w) { wheels.push(w); }); });
    var first = out[0], last = out[out.length - 1];
    return {
      stages: out,
      wheels: wheels,
      io: {
        input: first ? first.wheels[0] : null,
        // Pour un planétaire, wheels[1] est la couronne (repère visuel de sortie).
        output: last ? (last.wheels[1] || last.wheels[0]) : null
      }
    };
  }

  return { layout: layout, inputRadius: inputRadius, MESH_ANGLES: MESH_ANGLES };
});
