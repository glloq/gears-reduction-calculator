/* Zoom/pan partagé par les trois vues : même comportement en Denture, en
 * Géométrie et en Cinématique. Le viewBox est la seule source de vérité (aucun
 * transform concurrent), ce qui garde les exports fidèles à l'écran.
 *
 * Le contrôleur est utilisable sans DOM : attach() est optionnel et toutes les
 * transformations (fit, focus, pan, zoomAt) restent de simples calculs.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearViewportController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DRAG_THRESHOLD = 4; // px : en deçà, l'évènement reste un clic de sélection

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }

  function ViewportController(svg, options) {
    this.svg = svg;
    this.options = options || {};
    this.minScale = finite(this.options.minScale, 1 / 3);   // × la vue ajustée
    this.maxScale = finite(this.options.maxScale, 40);
    this.onChange = this.options.onChange || function () {};
    this.initial = this._read();
    this.state = this.initial.slice();
    this.dragged = false;
    this._listeners = [];
  }

  ViewportController.prototype._read = function () {
    var raw = (this.svg && (this.svg.dataset && this.svg.dataset.initialViewBox || this.svg.getAttribute('viewBox'))) || '0 0 800 400';
    var parts = raw.trim().split(/[\s,]+/).map(Number);
    return parts.length === 4 && parts.every(Number.isFinite) ? parts : [0, 0, 800, 400];
  };

  ViewportController.prototype._apply = function () {
    if (this.svg) this.svg.setAttribute('viewBox', this.state.map(function (v) { return v.toFixed(2); }).join(' '));
    this.onChange(this.getState());
    // §2 : le palier de lecture se lit sur le zoom. Le signaler ici évite que
    // chaque renderer ait à relayer son propre changement de cadrage — et donc
    // qu'un seul l'oublie.
    if (this.svg && this.svg.dispatchEvent) {
      this.svg.dispatchEvent(new CustomEvent('viewport:changed', { bubbles: true, detail: this.getState() }));
    }
    return this;
  };

  // Le zoom est borné relativement à la vue ajustée : impossible de perdre le
  // dessin, quelle que soit l'échelle réelle du réducteur.
  ViewportController.prototype._clampWidth = function (width) {
    return Math.min(Math.max(width, this.initial[2] / this.maxScale), this.initial[2] / this.minScale);
  };

  ViewportController.prototype.getState = function () { return { viewBox: this.state.slice(), scale: this.initial[2] / this.state[2] }; };
  ViewportController.prototype.setState = function (state) {
    if (state && state.viewBox && state.viewBox.length === 4 && state.viewBox.every(Number.isFinite)) this.state = state.viewBox.slice();
    return this._apply();
  };
  ViewportController.prototype.setInitial = function (viewBox) {
    if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)) this.initial = viewBox.slice();
    return this;
  };
  ViewportController.prototype.reset = function () { this.state = this.initial.slice(); return this._apply(); };
  ViewportController.prototype.focus = function (bounds, padding) {
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return this;
    padding = padding == null ? Math.max(12, Math.max(bounds.width, bounds.height) * 0.05) : padding;
    this.state = [bounds.x - padding, bounds.y - padding,
      Math.max(1, bounds.width + 2 * padding), Math.max(1, bounds.height + 2 * padding)];
    return this._apply();
  };
  ViewportController.prototype.fit = function (bounds, padding) {
    this.focus(bounds || this.options.bounds || { x: this.initial[0], y: this.initial[1], width: this.initial[2], height: this.initial[3] }, padding);
    this.initial = this.state.slice();
    if (this.svg) this.svg.dataset.initialViewBox = this.state.map(function (v) { return v.toFixed(2); }).join(' ');
    return this;
  };
  ViewportController.prototype.pan = function (dx, dy) { this.state[0] += dx; this.state[1] += dy; return this._apply(); };

  /** zoomAt(x, y, factor) : facteur > 1 = rapprochement, ancré au point monde (x, y). */
  ViewportController.prototype.zoomAt = function (x, y, factor) {
    factor = finite(factor, 1);
    if (factor <= 0) return this;
    var width = this._clampWidth(this.state[2] / factor);
    var height = this.state[3] * (width / this.state[2]);
    this.state = [x - (x - this.state[0]) * width / this.state[2], y - (y - this.state[1]) * height / this.state[3], width, height];
    return this._apply();
  };

  /** Conversion pointeur écran → coordonnées monde du viewBox courant. */
  ViewportController.prototype.toWorld = function (clientX, clientY) {
    var rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: this.state[0], y: this.state[1] };
    return { x: this.state[0] + (clientX - rect.left) / rect.width * this.state[2],
      y: this.state[1] + (clientY - rect.top) / rect.height * this.state[3] };
  };

  /** Millimètres visibles par pixel écran : c'est la mesure qui pilote le LOD. */
  /**
   * §2 : le PALIER de lecture. Chaque vue a ses propres unités monde — la
   * cinématique est symbolique, la géométrie en millimètres — si bien qu'aucun
   * seuil en pixels par unité ne peut être partagé. Le zoom RELATIF au cadrage
   * initial, lui, a le même sens partout : « je vois l'ensemble » vaut 1,
   * « je regarde une dent » vaut 12.
   *
   * Les paliers gouvernent la densité d'ANNOTATION, pas la finesse du tracé :
   * celle-ci reste calculée par roue, d'après sa taille réelle à l'écran, ce
   * qui est plus juste qu'un seuil global — une roue de 8 dents et une de 200
   * n'ont pas la même lisibilité au même zoom.
   */
  var ZOOM_TIERS = [
    { id: 0, name: 'overview', from: 0 },
    { id: 1, name: 'medium', from: 1.8 },
    { id: 2, name: 'close', from: 4.5 },
    { id: 3, name: 'technical', from: 11 }
  ];

  ViewportController.prototype.zoomTier = function () {
    var scale = this.getState().scale;
    var tier = ZOOM_TIERS[0];
    for (var i = 0; i < ZOOM_TIERS.length; i++) if (scale >= ZOOM_TIERS[i].from) tier = ZOOM_TIERS[i];
    return tier;
  };

  ViewportController.prototype.pixelsPerUnit = function () {
    var rect = this.svg ? this.svg.getBoundingClientRect() : null;
    if (!rect || !rect.width || !this.state[2]) return 1;
    return rect.width / this.state[2];
  };

  ViewportController.prototype._on = function (target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._listeners.push([target, type, handler, options]);
  };

  ViewportController.prototype.detach = function () {
    this._listeners.forEach(function (entry) { entry[0].removeEventListener(entry[1], entry[2], entry[3]); });
    this._listeners = [];
    return this;
  };

  /** Molette ancrée, glissement au pointeur, pincement tactile à deux doigts. */
  ViewportController.prototype.attach = function () {
    var self = this, svg = this.svg;
    if (!svg || !svg.addEventListener) return this;

    this._on(svg, 'wheel', function (event) {
      event.preventDefault();
      var point = self.toWorld(event.clientX, event.clientY);
      self.zoomAt(point.x, point.y, event.deltaY < 0 ? 1.2 : 1 / 1.2);
    }, { passive: false });

    // La capture n'est prise qu'au-delà du seuil : sinon le clic serait
    // retargetté vers le <svg> et les étages ne recevraient jamais la sélection.
    var pointers = new Map();
    var drag = null;
    var pinch = null;

    this._on(svg, 'pointerdown', function (event) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      self.dragged = false;
      if (pointers.size === 2) {
        var points = Array.from(pointers.values());
        pinch = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), viewBox: self.state.slice() };
        drag = null;
      } else if (pointers.size === 1) {
        drag = { x: event.clientX, y: event.clientY, viewBox: self.state.slice(), id: event.pointerId, captured: false };
      }
    });

    this._on(svg, 'pointermove', function (event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size === 2) {
        var points = Array.from(pointers.values());
        var distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        if (pinch.distance > 0 && distance > 0) {
          self.dragged = true;
          var center = self.toWorld((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
          self.zoomAt(center.x, center.y, distance / pinch.distance);
          pinch.distance = distance;
        }
        return;
      }
      if (!drag) return;
      var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.captured) {
        if (Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD) return;
        drag.captured = true;
        self.dragged = true;
        try { svg.setPointerCapture(drag.id); } catch (e) { /* garde : pointeur déjà relâché */ }
      }
      var rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      self.state = [drag.viewBox[0] - dx * drag.viewBox[2] / rect.width,
        drag.viewBox[1] - dy * drag.viewBox[3] / rect.height, drag.viewBox[2], drag.viewBox[3]];
      self._apply();
    });

    function release(event) {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) drag = null;
    }
    this._on(svg, 'pointerup', release);
    this._on(svg, 'pointercancel', release);
    this._on(svg, 'pointerleave', release);
    return this;
  };

  /**
   * screenUnit(svg, worldWidth) — combien d'unités monde vaut un pixel écran.
   * Les vues dessinent en millimètres réels : sans cette conversion, un texte de
   * « 12 » mesurerait 12 mm, soit un titre géant sur un pignon de 20 mm et un
   * texte illisible sur un convoyeur de 2 m. Tout ce qui doit garder une taille
   * d'écran constante (étiquettes, cotes, badges) est dimensionné avec elle.
   */
  ViewportController.screenUnit = function (svg, worldWidth) {
    var rect = svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    var pixels = rect && rect.width ? rect.width : 900;
    var world = Number.isFinite(worldWidth) && worldWidth > 0 ? worldWidth : pixels;
    return world / pixels;
  };

  /**
   * Applique cette échelle aux groupes marqués data-viewer-scale : ils sont
   * ancrés en coordonnées monde mais dessinés à taille d'écran constante.
   */
  ViewportController.applyScreenScale = function (svg, unit) {
    if (!svg || !svg.querySelectorAll) return;
    Array.prototype.forEach.call(svg.querySelectorAll('[data-viewer-scale]'), function (group) {
      var x = Number(group.dataset.anchorX) || 0, y = Number(group.dataset.anchorY) || 0;
      group.setAttribute('transform', 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') scale(' + unit.toFixed(4) + ')');
    });
  };

  ViewportController.DRAG_THRESHOLD = DRAG_THRESHOLD;
  ViewportController.ZOOM_TIERS = ZOOM_TIERS;
  return ViewportController;
});
