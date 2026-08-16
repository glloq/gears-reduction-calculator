/* Source unique de la cinématique des trois vues. Aucun accès au DOM.
 *
 * build(solution) → état permanent : une entrée par membre mécanique, avec sa
 * vitesse relative signée (ω). Les satellites portent en plus la vitesse du
 * porte-satellites (orbitOmega) : leur mouvement est la composition d'une
 * orbite et d'une rotation propre.
 * pose(state, inputAngle) → état instantané : angles, translations et défilements
 * pour un angle d'entrée donné (en degrés). Aucun renderer ne recalcule un
 * rapport, un sens ou une relation de Willis.
 */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports
    ? require('../../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearKinematicsEngine = api;
})(typeof self !== 'undefined' ? self : this, function (Registry) {
  'use strict';
  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }
  function teeth(stage, input) {
    if (stage.type === 'worm') return input ? stage.wormStarts : stage.wheelTeeth;
    if (stage.type === 'rack') return stage.pinionTeeth;
    return finite(stage[input ? 'input' : 'output'] && stage[input ? 'input' : 'output'].teeth, 1);
  }
  function member(id, omega, extra) {
    return Object.assign({ id: id, omega: finite(omega, 0), direction: Math.sign(finite(omega, 0)) }, extra || {});
  }
  // Rayon primitif du membre menant, en millimètres réels lorsque la géométrie
  // est disponible : il convertit une rotation en déplacement linéaire.
  function drivingRadius(stage) {
    var g = stage.geometry || {};
    var m = finite(stage.parameters && stage.parameters.module, 1);
    return finite(g.pitchDiameterInput, m * finite(teeth(stage, true), 20)) / 2;
  }

  function build(solution) {
    solution = solution || {};
    var state = { members: {}, carriers: {}, linear: {}, flexible: {}, stages: [] };
    var inputOmega = finite(solution.input && solution.input.rpm, finite(solution.inputRpm, finite(solution.inputSpeedRpm, 1)));
    if (!inputOmega) inputOmega = 1;
    var omega = inputOmega;
    (solution.stages || []).forEach(function (stage, index) {
      var prefix = 's' + index + '-';
      var definition = Registry && Registry.get(stage.type === 'epicyclic' ? 'planetary' : stage.type);
      var input = member(prefix + 'input', omega, { stageIndex: index, role: 'input' });
      var outputOmega;
      if (stage.type === 'planetary' || stage.type === 'epicyclic') {
        var speeds = definition.calculateSpeeds(stage, omega).speeds;
        ['S', 'R', 'C'].forEach(function (role) {
          state.members[prefix + role] = member(prefix + role, speeds[role], { stageIndex: index, role: role });
        });
        state.carriers[prefix + 'C'] = state.members[prefix + 'C'];
        // Willis appliqué au satellite : ωP = ωC − (ZS/ZP)·(ωS − ωC).
        var zs = finite(stage.sunTeeth, 12);
        var zp = Math.max(1, finite(stage.planetTeeth, (finite(stage.ringTeeth, 48) - zs) / 2));
        var carrier = finite(speeds.C, 0);
        state.members[prefix + 'P'] = member(prefix + 'P', carrier - (zs / zp) * (finite(speeds.S, 0) - carrier),
          { stageIndex: index, role: 'planet', orbitOmega: carrier, count: Math.max(2, Math.round(finite(stage.planetCount, 3))) });
        outputOmega = speeds[stage.outputMember || 'C'];
      } else if (stage.type === 'rack') {
        var radius = drivingRadius(stage);
        outputOmega = 0;
        // `pose` reçoit un angle d'entrée : la relation géométrique exacte est
        // x = r · θ, indépendamment de l'unité temporelle choisie en amont.
        state.linear[prefix + 'rack'] = { id: prefix + 'rack', stageIndex: index, omega: omega,
          velocity: omega * radius, mmPerRadian: radius };
      } else {
        var ratio = teeth(stage, true) / Math.max(1e-9, teeth(stage, false));
        var direction = definition && definition.rotationDirection ? definition.rotationDirection(stage) : -1;
        outputOmega = omega * ratio * (direction < 0 ? -1 : 1);
        if (stage.type === 'belt' || stage.type === 'chain') {
          state.flexible[prefix + 'drive'] = { id: prefix + 'drive', stageIndex: index, omega: omega,
            crossed: !!(stage.parameters && stage.parameters.crossed),
            velocity: omega * drivingRadius(stage), mmPerRadian: drivingRadius(stage),
            pitch: finite(stage.parameters && stage.parameters.pitch, 0),
            length: finite(stage.geometry && (stage.geometry.actualLength || stage.geometry.length), 0) };
        }
      }
      state.members[input.id] = input;
      state.members[prefix + 'output'] = member(prefix + 'output', outputOmega, { stageIndex: index, role: 'output' });
      state.stages.push({ index: index, type: stage.type, input: input.id, output: prefix + 'output',
        inputOmega: omega, outputOmega: finite(outputOmega, 0),
        ratio: finite(outputOmega, 0) ? omega / outputOmega : null,
        axisRelation: (stage.geometry && stage.geometry.axisRelation) ||
          (Registry && Registry.getAxisRelation ? Registry.getAxisRelation(stage) : 'parallel') });
      omega = outputOmega;
    });
    state.inputOmega = inputOmega;
    state.outputOmega = omega;
    return state;
  }

  // Vitesse relative d'un membre, normalisée par l'entrée : c'est elle qui pilote
  // les rotations SVG (l'entrée fait toujours un tour par tour d'animation).
  function relative(state, id) {
    var m = (state.members || {})[id];
    return m ? m.omega / (finite(state.inputOmega, 1) || 1) : 0;
  }

  /**
   * pose(state, inputAngle) — inputAngle est l'angle de l'arbre d'entrée, EN DEGRÉS.
   * Rotations : angle(membre) = ω(membre)/ω(entrée) × inputAngle, en degrés.
   * Translations et défilements : x = r · θ(rad) du membre menant, en millimètres
   * réels. Un tour d'entrée (360°) fait donc avancer une crémaillère de π·d.
   */
  function pose(state, inputAngle) {
    var scale = finite(inputAngle, 0) / (finite(state.inputOmega, 1) || 1);
    var posed = { members: {}, carriers: {}, linear: {}, flexible: {}, inputAngle: finite(inputAngle, 0) };
    Object.keys(state.members || {}).forEach(function (id) {
      var m = state.members[id];
      var entry = Object.assign({}, m, { angle: m.omega * scale });
      if (Number.isFinite(m.orbitOmega)) entry.orbitAngle = m.orbitOmega * scale;
      posed.members[id] = entry;
    });
    Object.keys(state.carriers || {}).forEach(function (id) { posed.carriers[id] = posed.members[id]; });
    // Déplacements en millimètres réels : x = r · θ(rad) du membre menant.
    function travel(entry) { return finite(entry.mmPerRadian, 0) * finite(entry.omega, 0) * scale * Math.PI / 180; }
    Object.keys(state.linear || {}).forEach(function (id) {
      posed.linear[id] = Object.assign({}, state.linear[id], { position: travel(state.linear[id]) });
    });
    Object.keys(state.flexible || {}).forEach(function (id) {
      posed.flexible[id] = Object.assign({}, state.flexible[id], { offset: travel(state.flexible[id]) });
    });
    return posed;
  }

  return { build: build, pose: pose, relative: relative };
});
