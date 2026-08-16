(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearGeometryLayout = api; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function diameter(geometry) { return Math.max(finite(geometry.maxDiameter, 0), finite(geometry.ringDiameter, 0), finite(geometry.pitchDiameterInput, 0), finite(geometry.pitchDiameterOutput, 0)); }
  function build(solution, options) {
    var opts = options || {}, margin = finite(opts.margin, 70), gap = finite(opts.stageGap, 90), cursor = margin, bottom = margin;
    var stages = (solution && solution.stages || []).map(function (stage, index) {
      var geometry = stage.geometry || {}, size = Math.max(20, diameter(geometry)), center = finite(geometry.correctedCenterDistance, finite(geometry.centerDistance, 0));
      var width = Math.max(size, center + finite(geometry.pitchDiameterInput, 0) / 2 + finite(geometry.pitchDiameterOutput, 0) / 2);
      if (stage.type === 'rack') width = Math.max(width, finite(geometry.travelPerRevolution, size * 2));
      var item = { index: index, stage: stage, type: stage.type, x: cursor + size / 2, y: margin + size / 2 + 45, width: width, height: size + 100, diameter: size, centerDistance: center };
      cursor += width + gap; bottom = Math.max(bottom, item.y + size / 2 + 80); return item;
    });
    return { stages: stages, bounds: { x: 0, y: 0, width: Math.max(300, cursor - gap + margin), height: Math.max(260, bottom + margin) } };
  }
  return { build: build };
});
