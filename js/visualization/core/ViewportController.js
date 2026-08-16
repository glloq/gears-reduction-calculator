(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearViewportController = api; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function ViewportController(svg, options) { this.svg = svg; this.options = options || {}; this.minZoom = this.options.minZoom || 0.1; this.maxZoom = this.options.maxZoom || 20; this.initial = this._read(); this.state = this.initial.slice(); }
  ViewportController.prototype._read = function () { return (this.svg.getAttribute('viewBox') || '0 0 800 400').split(/\s+/).map(Number); };
  ViewportController.prototype._apply = function () { this.svg.setAttribute('viewBox', this.state.join(' ')); return this; };
  ViewportController.prototype.getState = function () { return { viewBox: this.state.slice() }; };
  ViewportController.prototype.setState = function (state) { if (state && state.viewBox && state.viewBox.length === 4 && state.viewBox.every(Number.isFinite)) this.state = state.viewBox.slice(); return this._apply(); };
  ViewportController.prototype.reset = function () { this.state = this.initial.slice(); return this._apply(); };
  ViewportController.prototype.fit = function (bounds, padding) { return this.focus(bounds || this.options.bounds, padding); };
  ViewportController.prototype.focus = function (b, padding) { if (!b) return this; padding = padding == null ? 12 : padding; this.state = [b.x - padding, b.y - padding, Math.max(1, b.width + 2 * padding), Math.max(1, b.height + 2 * padding)]; return this._apply(); };
  ViewportController.prototype.pan = function (dx, dy) { this.state[0] += dx; this.state[1] += dy; return this._apply(); };
  ViewportController.prototype.zoomAt = function (x, y, factor) { factor = Math.max(this.minZoom, Math.min(this.maxZoom, Number(factor) || 1)); var oldW = this.state[2], oldH = this.state[3], newW = oldW / factor, newH = oldH / factor; this.state[0] = x - (x - this.state[0]) * newW / oldW; this.state[1] = y - (y - this.state[1]) * newH / oldH; this.state[2] = newW; this.state[3] = newH; return this._apply(); };
  return ViewportController;
});
