(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearGeometryUtils = api; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function flexiblePath(c1, c2, r1, r2, crossed) {
    var dx = c2.x - c1.x, dy = c2.y - c1.y, distance = Math.hypot(dx, dy); if (distance <= 0) throw new RangeError('Distinct centres required');
    var ratio = (crossed ? r1 + r2 : r1 - r2) / distance; if (Math.abs(ratio) >= 1) throw new RangeError('Pulley geometry has no tangent');
    var base = Math.atan2(dy, dx), alpha = Math.acos(ratio), sign2 = crossed ? -1 : 1;
    var tangents = [-1, 1].map(function (side) { var a = base + side * alpha; return { from: { x: c1.x + r1 * Math.cos(a), y: c1.y + r1 * Math.sin(a) }, to: { x: c2.x + sign2 * r2 * Math.cos(a), y: c2.y + sign2 * r2 * Math.sin(a) } }; });
    var wrap1 = crossed ? Math.PI + 2 * Math.asin((r1 + r2) / distance) : Math.PI + 2 * Math.asin((r1 - r2) / distance);
    return { distance: distance, crossed: !!crossed, tangents: tangents, wrapAngle1: wrap1, wrapAngle2: crossed ? 2 * Math.PI - wrap1 : 2 * Math.PI - wrap1 };
  }
  return { flexiblePath: flexiblePath };
});
