(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearGeometryPrimitives = api; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict'; var NS = 'http://www.w3.org/2000/svg';
  function node(tag, attrs, text) { var element = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (key) { element.setAttribute(key, attrs[key]); }); if (text != null) element.textContent = text; return element; }
  function circle(group, x, y, diameter, className, label) { var value = Number(diameter) || 0, element = node('circle', { cx: x, cy: y, r: Math.max(4, value / 2), class: className, 'data-diameter-mm': value }); element.appendChild(node('title', {}, label + ' — Ø primitif ' + value.toFixed(2) + ' mm')); group.appendChild(element); return element; }
  function axis(group, x1, y1, x2, y2) { return group.appendChild(node('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'shaft-axis construction-axis' })); }
  function rack(group, x, y, length, moduleValue) { var pitch = Math.PI * moduleValue, points = [], start = x - length / 2; for (var px = start; px <= start + length; px += pitch / 2) points.push(px + ',' + y, (px + pitch / 4) + ',' + (y - 7)); return group.appendChild(node('polyline', { points: points.join(' '), class: 'rack-profile' })); }
  return { node: node, circle: circle, axis: axis, rack: rack };
});
