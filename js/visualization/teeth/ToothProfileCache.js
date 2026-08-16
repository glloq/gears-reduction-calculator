(function (root, factory) { var api = factory(typeof module === 'object' && module.exports ? require('./ToothProfile.js') : root.GearToothProfile); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearToothProfileCache = api; })(typeof self !== 'undefined' ? self : this, function (Profile) {
  'use strict'; var cache = new Map();
  function key(o) { return [o.type || 'spur', o.teeth, 'm' + (o.module || 1), 'pa' + (o.pressureAngle || 20), 'ha' + (o.helixAngle || 0), 'x' + (o.profileShift || 0), o.internal ? 'i' : 'e'].join(':'); }
  function get(options) { var k = key(options); if (!cache.has(k)) { var pitchR = options.pitchRadius || options.teeth * (options.module || 1) / 2; cache.set(k, options.internal ? Profile.toothedRingPath(options.teeth, options.outerRadius, options.innerRadius) : Profile.gearPath(options.teeth, pitchR, options.tipRadius || pitchR + (options.module || 1), options.rootRadius || Math.max(1, pitchR - 1.25 * (options.module || 1)), options.pressureAngle)); } return cache.get(k); }
  return { get: get, key: key, clear: function () { cache.clear(); }, size: function () { return cache.size; } };
});
