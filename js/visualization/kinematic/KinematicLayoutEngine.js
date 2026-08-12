(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KinematicLayoutEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PERPENDICULAR = { bevel: true, worm: true };
  var COAXIAL = { planetary: true, epicyclic: true, internal: true };
  var AXES = [
    { x: 1, y: 0, z: 0, name: 'X' },
    { x: 0, y: 1, z: 0, name: 'Y' },
    { x: 0, y: 0, z: 1, name: 'Z' }
  ];

  function typeOf(stage) { return stage.type || stage[2] || 'spur'; }
  function relation(stage) {
    var type = typeOf(stage);
    if (type === 'rack') return 'linear';
    if (PERPENDICULAR[type]) return 'perpendicular';
    if (COAXIAL[type]) return 'coaxial';
    return 'parallel';
  }
  function copy(point) { return { id: point.id, x: point.x, y: point.y, z: point.z, axis: point.axis, role: point.role }; }
  function nextPerpendicular(axis, index) {
    var current = AXES.findIndex(function (candidate) { return candidate.name === axis.name; });
    return AXES[(current + 1 + (index % 2)) % AXES.length];
  }
  function project(point, projection, origin) {
    var horizontal = projection === 'orthogonal' ? point.x : point.x + point.z * 0.45;
    var vertical = projection === 'orthogonal' ? point.z : point.y - point.z * 0.3;
    return { id: point.id, x: origin.x + horizontal, y: origin.y + vertical, z: point.z, axis: point.axis, orientation: point.axis.name, role: point.role };
  }

  function KinematicLayoutEngine(options) {
    options = options || {};
    this.shaftSpacing = options.shaftSpacing || 105;
    this.stageSpacing = options.stageSpacing || 145;
    this.origin = options.origin || { x: 85, y: 145 };
  }

  KinematicLayoutEngine.prototype.layout = function (stages, projectionName) {
    var projection = projectionName || 'main', self = this;
    var current = { id: 0, x: 0, y: 0, z: 0, axis: AXES[0], role: 'INPUT' };
    var shafts = [current], worldNodes = [];

    stages.forEach(function (stage, index) {
      var mode = relation(stage), input = current, output = copy(input);
      if (mode === 'coaxial') {
        output.id = input.id;
      } else if (mode === 'perpendicular') {
        output.id = index + 1;
        output.axis = nextPerpendicular(input.axis, index);
        output.x += self.stageSpacing;
        output.y += input.axis.name === 'Z' ? self.shaftSpacing : 0;
        output.z += input.axis.name === 'X' ? self.shaftSpacing : 0;
      } else if (mode === 'linear') {
        output.id = index + 1;
        output.axis = { x: input.axis.x, y: input.axis.y, z: input.axis.z, name: 'LINEAR' };
        output.x += self.stageSpacing;
      } else {
        output.id = index + 1;
        output.axis = input.axis;
        output.x += self.stageSpacing;
        if (input.axis.name === 'Z') output.z += (index % 2 ? 1 : -1) * self.shaftSpacing;
        else output.y += (index % 2 ? 1 : -1) * self.shaftSpacing;
      }
      shafts.push(output); current = output;
      worldNodes.push({ index: index, stage: stage, relation: mode, input: input, output: output });
    });
    if (current) current.role = 'OUTPUT';

    var nodes = worldNodes.map(function (node) {
      return { index: node.index, stage: node.stage, relation: node.relation,
        input: project(node.input, projection, self.origin), output: project(node.output, projection, self.origin), projection: projection };
    });
    return { nodes: nodes, shafts: shafts, worldNodes: worldNodes,
      width: Math.max(460, stages.length * this.stageSpacing + 220), height: 330, projection: projection };
  };

  KinematicLayoutEngine.relation = relation;
  KinematicLayoutEngine.project = project;
  return KinematicLayoutEngine;
});
