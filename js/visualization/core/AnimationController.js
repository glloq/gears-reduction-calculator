(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearAnimationController = api; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function AnimationController(options) { options = options || {}; this.speed = 1; this.direction = 1; this.mode = 'pedagogical'; this.angle = 0; this.playing = false; this._request = options.request || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(globalThis) : null); this._cancel = options.cancel || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(globalThis) : null); this.onUpdate = options.onUpdate || function () {}; }
  AnimationController.prototype.setScene = function (scene) { this.scene = scene; this.seek(0); return this; };
  AnimationController.prototype.setSpeed = function (speed) { this.speed = Math.max(0, Number(speed) || 0); return this; };
  AnimationController.prototype.setDirection = function (direction) { this.direction = direction < 0 ? -1 : 1; return this; };
  AnimationController.prototype.setMode = function (mode) { this.mode = mode === 'relative' ? 'relative' : 'pedagogical'; return this; };
  AnimationController.prototype.seek = function (angle) { this.angle = Number(angle) || 0; this.onUpdate(this.angle, this.scene); return this; };
  AnimationController.prototype.play = function () { if (this.playing || !this._request) return this; this.playing = true; this._last = 0; var self = this; function tick(ts) { if (!self.playing) return; var dt = self._last ? (ts - self._last) / 1000 : 0; self._last = ts; self.seek(self.angle + 120 * self.speed * self.direction * dt); self._raf = self._request(tick); } this._raf = this._request(tick); return this; };
  AnimationController.prototype.pause = function () { this.playing = false; if (this._raf && this._cancel) this._cancel(this._raf); this._raf = null; return this; };
  AnimationController.prototype.toggle = function () { return this.playing ? this.pause() : this.play(); };
  return AnimationController;
});
