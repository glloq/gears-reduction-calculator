/* Horloge d'animation partagée par les trois vues.
 *
 * Elle ne connaît que l'angle de l'ARBRE D'ENTRÉE, en degrés : tout le reste
 * découle de KinematicsEngine.pose(). Deux modes :
 *
 *   pédagogique — l'entrée tourne à une cadence lisible et CONSTANTE
 *                 (120°/s à 1×), quel que soit le régime réel. C'est le mode
 *                 par défaut : on vient lire des rapports, pas des tours/minute.
 *   relatif     — la cadence suit le régime réel d'entrée. Un moteur à 3000 rpm
 *                 tourne visiblement deux fois plus vite qu'à 1500 rpm. Borné,
 *                 parce qu'afficher réellement 15 000 rpm ne montrerait rien.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearAnimationController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PEDAGOGICAL_DEG_PER_SECOND = 120;
  var REFERENCE_RPM = 1500;          // régime de référence du mode relatif
  var RELATIVE_MIN = 20;             // °/s : en deçà, l'écran semble figé
  var RELATIVE_MAX = 720;            // °/s : au-delà, l'œil ne suit plus

  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }

  function AnimationController(options) {
    options = options || {};
    this.speed = 1;
    this.direction = 1;
    this.mode = 'pedagogical';
    this.angle = 0;
    this.playing = false;
    this.inputRpm = null;
    this._request = options.request || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(globalThis) : null);
    this._cancel = options.cancel || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(globalThis) : null);
    this.onUpdate = options.onUpdate || function () {};
  }

  AnimationController.prototype.setScene = function (scene) {
    this.scene = scene;
    // Le régime d'entrée réel n'est utile qu'au mode relatif ; il est lu ici une
    // fois pour toutes, jamais recalculé image par image.
    var kinematics = scene && scene.kinematics;
    this.inputRpm = kinematics && Number.isFinite(kinematics.inputOmega) ? Math.abs(kinematics.inputOmega) : null;
    this.seek(0);
    return this;
  };
  AnimationController.prototype.setSpeed = function (speed) { this.speed = Math.max(0, Number(speed) || 0); return this; };
  AnimationController.prototype.setDirection = function (direction) { this.direction = direction < 0 ? -1 : 1; return this; };
  AnimationController.prototype.setMode = function (mode) { this.mode = mode === 'relative' ? 'relative' : 'pedagogical'; return this; };

  /**
   * Cadence de l'arbre d'entrée, en degrés par seconde, pour le mode courant.
   * C'est LE point où les deux modes diffèrent — nulle part ailleurs.
   */
  AnimationController.prototype.degreesPerSecond = function () {
    if (this.mode !== 'relative') return PEDAGOGICAL_DEG_PER_SECOND * this.speed;
    var rpm = finite(this.inputRpm, REFERENCE_RPM) || REFERENCE_RPM;
    var raw = PEDAGOGICAL_DEG_PER_SECOND * (rpm / REFERENCE_RPM) * this.speed;
    if (!this.speed) return 0;
    return Math.min(RELATIVE_MAX * this.speed, Math.max(RELATIVE_MIN * this.speed, raw));
  };

  AnimationController.prototype.seek = function (angle) {
    this.angle = Number(angle) || 0;
    this.onUpdate(this.angle, this.scene);
    return this;
  };

  AnimationController.prototype.play = function () {
    if (this.playing || !this._request) return this;
    this.playing = true;
    this._last = 0;
    var self = this;
    function tick(ts) {
      if (!self.playing) return;
      var dt = self._last ? (ts - self._last) / 1000 : 0;
      self._last = ts;
      self.seek(self.angle + self.degreesPerSecond() * self.direction * dt);
      self._raf = self._request(tick);
    }
    this._raf = this._request(tick);
    return this;
  };

  AnimationController.prototype.pause = function () {
    this.playing = false;
    if (this._raf && this._cancel) this._cancel(this._raf);
    this._raf = null;
    return this;
  };

  AnimationController.prototype.toggle = function () { return this.playing ? this.pause() : this.play(); };

  AnimationController.PEDAGOGICAL_DEG_PER_SECOND = PEDAGOGICAL_DEG_PER_SECOND;
  AnimationController.REFERENCE_RPM = REFERENCE_RPM;
  AnimationController.RELATIVE_MIN = RELATIVE_MIN;
  AnimationController.RELATIVE_MAX = RELATIVE_MAX;
  return AnimationController;
});
