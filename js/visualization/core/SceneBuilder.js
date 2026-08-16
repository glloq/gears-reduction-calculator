/* Modèle graphique canonique, exclusivement dérivé des résultats du moteur. */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./KinematicsEngine.js') : root.GearKinematicsEngine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearSceneBuilder = api;
})(typeof self !== 'undefined' ? self : this, function (Kinematics) {
  'use strict';
  function compact(object) { Object.keys(object).forEach(function (k) { if (object[k] == null) delete object[k]; }); return object; }
  function build(solution) {
    solution = solution || {};
    var kinematics = Kinematics.build(solution), members = [], shafts = [], connections = [];
    (solution.stages || []).forEach(function (stage, index) {
      var g = stage.geometry || {}, mech = (solution.mechanical || [])[index] || {};
      var roles = stage.type === 'planetary' ? ['S', 'R', 'C'] : stage.type === 'rack' ? ['input', 'rack'] : ['input', 'output'];
      roles.forEach(function (role) {
        var suffix = role === 'rack' ? 'rack' : role;
        var km = kinematics.members['s' + index + '-' + suffix] || kinematics.linear['s' + index + '-' + suffix] || {};
        var input = role === 'input';
        members.push({ id: 's' + index + '-' + suffix, stageIndex: index, role: role,
          type: role === 'rack' ? 'rack' : (stage.type === 'belt' ? 'pulley' : stage.type === 'chain' ? 'sprocket' : 'gear'),
          geometry: compact({ pitchDiameter: input ? g.pitchDiameterInput : g.pitchDiameterOutput, outsideDiameter: input ? g.outsideDiameterInput : g.outsideDiameterOutput, rootDiameter: input ? g.rootDiameterInput : g.rootDiameterOutput, width: g.width }),
          mechanical: compact({ rpm: km.omega, relativeSpeed: km.omega / (kinematics.inputOmega || 1), torque: mech.outputTorqueNm || mech.torqueNm }) });
      });
      shafts.push({ id: 'shaft-' + index, stageIndex: index, memberIds: roles.map(function (r) { return 's' + index + '-' + r; }) });
      connections.push({ id: 'connection-' + index, stageIndex: index, type: stage.type, axisRelation: g.axisRelation });
    });
    var dims = solution.dimensions || {};
    return { stages: (solution.stages || []).map(function (s, i) { return { index: i, type: s.type, geometry: s.geometry || {}, warnings: s.warnings || [] }; }), members: members, shafts: shafts, connections: connections,
      dimensions: dims, bounds: solution.bounds || {}, input: solution.input || {}, output: solution.output || {}, kinematics: kinematics, warnings: solution.warnings || [] };
  }
  return { build: build };
});
