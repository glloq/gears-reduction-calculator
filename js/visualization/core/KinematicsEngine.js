/* Source unique de la cinématique des trois vues. Aucun accès au DOM. */
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
  function build(solution) {
    solution = solution || {};
    var state = { members: {}, carriers: {}, linear: {}, flexible: {}, stages: [] };
    var inputOmega = finite(solution.input && solution.input.rpm, finite(solution.inputRpm, 1));
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
        outputOmega = speeds[stage.outputMember || 'C'];
      } else if (stage.type === 'rack') {
        var radius = finite(stage.geometry && stage.geometry.pitchDiameterInput, finite(stage.parameters && stage.parameters.module, 1) * teeth(stage, true)) / 2;
        outputOmega = 0;
        // `pose` reçoit un angle d'entrée : la relation géométrique exacte est
        // x = r * theta, indépendamment de l'unité temporelle choisie en amont.
        state.linear[prefix + 'rack'] = { id: prefix + 'rack', stageIndex: index, velocity: omega * radius, mmPerRadian: radius };
      } else {
        var ratio = teeth(stage, true) / Math.max(1e-9, teeth(stage, false));
        var direction = definition && definition.rotationDirection ? definition.rotationDirection(stage) : -1;
        outputOmega = omega * ratio * (direction < 0 ? -1 : 1);
        if (stage.type === 'belt' || stage.type === 'chain') state.flexible[prefix + 'drive'] = { id: prefix + 'drive', stageIndex: index, crossed: !!(stage.parameters && stage.parameters.crossed), velocity: omega * finite(stage.geometry && stage.geometry.pitchDiameterInput, 0) / 2 };
      }
      state.members[input.id] = input;
      state.members[prefix + 'output'] = member(prefix + 'output', outputOmega, { stageIndex: index, role: 'output' });
      state.stages.push({ index: index, type: stage.type, input: input.id, output: prefix + 'output' });
      omega = outputOmega;
    });
    state.inputOmega = inputOmega;
    state.outputOmega = omega;
    return state;
  }
  function pose(state, inputAngle) {
    var scale = finite(inputAngle, 0) / (finite(state.inputOmega, 1) || 1);
    var posed = { members: {}, carriers: {}, linear: {}, flexible: {} };
    Object.keys(state.members || {}).forEach(function (id) {
      var m = state.members[id]; posed.members[id] = Object.assign({}, m, { angle: m.omega * scale });
    });
    Object.keys(state.carriers || {}).forEach(function (id) { posed.carriers[id] = posed.members[id]; });
    Object.keys(state.linear || {}).forEach(function (id) { var l = state.linear[id]; posed.linear[id] = Object.assign({}, l, { position: l.velocity * scale }); });
    Object.keys(state.flexible || {}).forEach(function (id) { var f = state.flexible[id]; posed.flexible[id] = Object.assign({}, f, { offset: f.velocity * scale }); });
    return posed;
  }
  return { build: build, pose: pose };
});
