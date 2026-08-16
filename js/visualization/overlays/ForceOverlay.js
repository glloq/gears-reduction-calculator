/* Normalisation et rendu SVG des efforts mécaniques. */
(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearForceOverlay = api; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var AXES = [{ key: 'tangentialN', label: 'Ft', dx: 1, dy: 0 }, { key: 'radialN', label: 'Fr', dx: 0, dy: -1 }, { key: 'axialN', label: 'Fa', dx: .7, dy: .7 }];
  function vectors(forces, maxLength) { forces = forces || {}; maxLength = maxLength || 24; var max = AXES.reduce(function (m, a) { return Math.max(m, Math.abs(forces[a.key] || 0)); }, 0); return AXES.filter(function (a) { return Number.isFinite(forces[a.key]) && forces[a.key] !== 0; }).map(function (a) { var value = forces[a.key], length = max ? Math.max(7, Math.abs(value) / max * maxLength) : 0; return { key: a.key, label: a.label, value: value, x2: a.dx * length * Math.sign(value), y2: a.dy * length * Math.sign(value) }; }); }
  function render(create, host, forces, origin) { vectors(forces).forEach(function (v) { var g = create('g', { class: 'force-vector force-' + v.label.toLowerCase(), transform: 'translate(' + origin.x + ' ' + origin.y + ')' }); g.appendChild(create('line', { x1: 0, y1: 0, x2: v.x2.toFixed(2), y2: v.y2.toFixed(2) })); g.appendChild(create('text', { x: v.x2.toFixed(2), y: v.y2.toFixed(2) }, v.label)); g.appendChild(create('title', {}, v.label + ' ' + Math.abs(v.value).toFixed(0) + ' N')); host.appendChild(g); }); }
  return { vectors: vectors, render: render };
});
