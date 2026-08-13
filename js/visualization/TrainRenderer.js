// TrainRenderer.js - Vue « Denture réaliste » : profils en développante aux
// cotes réelles (stage.geometry), thémable (100 % classes CSS + jetons),
// zoom ancré au pointeur, animation par rotor, sélection d'étage.
//
// Contrat ViewerToolbar : render(solution), toggleAnimation(), resetView(),
// exportSVG(), exportPNG(cb) + dispatch CustomEvent 'visualization:renderer'.
//
// Points d'extension pour l'édition graphique future :
// - chaque roue porte data-stage / data-role, chaque étage data-stage ;
// - API publique selectStage(index), getStageElement(index) ;
// - toutes les interactions passent par _bindStageInteractions() ;
// - évènements DOM émis sur le conteneur : 'viewer:stage-selected {index}'
//   et 'viewer:stage-edit {index}'.
(function (GearApp) {
  'use strict';
  if (typeof document === 'undefined' || !GearApp) return;

  var NS = 'http://www.w3.org/2000/svg';
  var FALLBACK_VIEWBOX = '0 0 800 400';

  function n(tag, attrs, text) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (text != null) el.textContent = text;
    return el;
  }
  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }
  function fmt(value, digits) { return Number.isFinite(value) ? value.toFixed(digits == null ? 2 : digits) : '—'; }

  // ===== Profil en développante (adapté de l'ancien GearSVG, 8 pts/flanc) =====

  function involutePoints(rb, ra, baseAngle, direction, count) {
    var pts = [];
    var tMax = Math.sqrt(Math.max(0, (ra / rb) * (ra / rb) - 1));
    for (var i = 0; i <= count; i++) {
      var t = tMax * i / count;
      var r = rb * Math.sqrt(1 + t * t);
      if (r > ra + 1e-9) break;
      var angle = baseAngle + direction * (t - Math.atan(t));
      pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
    }
    return pts;
  }

  function gearPath(teeth, pitchR, tipR, rootR, pressureAngleDeg) {
    teeth = Math.max(3, Math.round(finite(teeth, 12)));
    var baseR = pitchR * Math.cos(rad(finite(pressureAngleDeg, 20)));
    var startR = Math.max(baseR, rootR);
    var pitch = 2 * Math.PI / teeth;
    var half = pitch / 4;
    var d = '';
    for (var i = 0; i < teeth; i++) {
      var a = i * pitch;
      var left = involutePoints(startR, tipR, a - half, 1, 8);
      var right = involutePoints(startR, tipR, a + half, -1, 8);
      if (!left.length || !right.length) continue;
      var gap = a - pitch / 2;
      d += (d ? ' L ' : 'M ') + (rootR * Math.cos(gap)).toFixed(2) + ' ' + (rootR * Math.sin(gap)).toFixed(2);
      d += ' L ' + (rootR * Math.cos(a - half)).toFixed(2) + ' ' + (rootR * Math.sin(a - half)).toFixed(2);
      left.forEach(function (p) { d += ' L ' + p.x.toFixed(2) + ' ' + p.y.toFixed(2); });
      d += ' L ' + (tipR * Math.cos(a)).toFixed(2) + ' ' + (tipR * Math.sin(a)).toFixed(2);
      right.reverse().forEach(function (p) { d += ' L ' + p.x.toFixed(2) + ' ' + p.y.toFixed(2); });
      d += ' L ' + (rootR * Math.cos(a + half)).toFixed(2) + ' ' + (rootR * Math.sin(a + half)).toFixed(2);
    }
    return d ? d + ' Z' : '';
  }

  // Denture trapézoïdale simple (poulies crantées, pignons de chaîne,
  // couronne intérieure) — robuste pour tous les Z.
  function toothedRingPath(teeth, outerR, innerR, dutyCycle) {
    teeth = Math.max(4, Math.round(finite(teeth, 12)));
    var pitch = 2 * Math.PI / teeth;
    var w = pitch * (dutyCycle || 0.35) / 2;
    var parts = [];
    for (var i = 0; i < teeth; i++) {
      var a = i * pitch;
      [[innerR, a - pitch / 2], [innerR, a - w], [outerR, a - w * 0.6], [outerR, a + w * 0.6], [innerR, a + w]].forEach(function (p) {
        parts.push((p[0] * Math.cos(p[1])).toFixed(2) + ' ' + (p[0] * Math.sin(p[1])).toFixed(2));
      });
    }
    return parts.length ? 'M ' + parts.join(' L ') + ' Z' : '';
  }

  function TrainRenderer(container) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.svg = null;
    this.solution = null;
    this._rotors = [];
    this._spans = [];
    this._animating = false;
    this._raf = null;
    this._lastTs = 0;
    this._lastUid = undefined;
    this._savedViewBox = null;
    this._dragged = false;
    this._selected = -1;
  }

  // ===== Rendu =====

  TrainRenderer.prototype.render = function (solution) {
    this._stopAnimation();
    var keepView = solution && this.solution && solution.uid !== undefined && solution.uid === this._lastUid;
    this.solution = solution;
    this._lastUid = solution ? solution.uid : undefined;
    this._rotors = [];
    this._spans = [];
    this._selected = -1;

    var model = GearTrainLayout.layout(solution.stages || [], solution.mechanical || []);
    var svg = n('svg', { class: 'train-svg', role: 'img', 'aria-label': 'Denture réaliste — ' + (solution.stages || []).length + ' étage(s)' });
    var viewport = n('g', { class: 'train-viewport' });
    svg.appendChild(viewport);
    var self = this;

    model.stages.forEach(function (entry, index) {
      viewport.appendChild(self._buildStage(entry, solution, index));
    });
    this._drawIOChips(viewport, model);

    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.svg = svg;

    this._fit(keepView);
    this._bindPanZoom();
    this._bindStageInteractions();
    this._hideInspector();
    if (this._animating) { this._animating = false; this.toggleAnimation(); }

    this.container.dispatchEvent(new CustomEvent('visualization:renderer', { detail: { renderer: this } }));
    return this;
  };

  TrainRenderer.prototype._buildStage = function (entry, solution, index) {
    var self = this;
    var mech = (solution.mechanical || [])[index] || {};
    var stage = (solution.stages || [])[index] || {};
    var group = n('g', {
      class: 'train-stage ' + entry.type,
      'data-stage': index,
      'data-type': entry.type,
      tabindex: 0,
      role: 'button',
      'aria-label': 'Étage ' + (index + 1) + ' · ' + entry.type + ' — rapport ' + fmt(mech.ratio, 3)
    });
    if (Number.isFinite(entry.centerDistance)) group.setAttribute('data-center-distance-mm', entry.centerDistance.toFixed(2));
    if (Number.isFinite(mech.ratio)) group.setAttribute('data-ratio', mech.ratio.toFixed(4));

    var links = n('g', { class: 'stage-links' });
    group.appendChild(links);
    entry.links.forEach(function (link) { self._drawLink(links, link); });

    entry.wheels.forEach(function (wheel) {
      group.appendChild(self._buildWheel(wheel, entry));
    });

    // Décor : libellé d'étage (couloirs anti-collision posés dans _placeLabels)
    // et cote d'entraxe.
    var decor = n('g', { class: 'stage-decor' });
    var ratioText = Number.isFinite(mech.ratio) ? ' — i=' + fmt(mech.ratio, 2) : '';
    var label = n('text', { class: 'train-label', 'data-label-stage': index }, 'Étage ' + (index + 1) + ' · ' + entry.type + ratioText);
    decor.appendChild(label);
    if (Number.isFinite(entry.centerDistance) && entry.wheels.length >= 2 && entry.type !== 'planetary') {
      this._drawDim(decor, entry);
    }
    group.appendChild(decor);

    var title = 'Étage ' + (index + 1) + ' · ' + entry.type +
      (Number.isFinite(mech.ratio) ? '\nRapport : ' + fmt(mech.ratio, 4) : '') +
      (Number.isFinite(entry.centerDistance) ? '\nEntraxe : ' + fmt(entry.centerDistance, 2) + ' mm' : '');
    group.appendChild(n('title', {}, title));
    return group;
  };

  TrainRenderer.prototype._buildWheel = function (wheel, entry) {
    var roleClass = wheel.role === 'input' ? 'input-member' : wheel.role === 'output' ? 'output-member' : wheel.role;
    var g = n('g', { class: 'train-wheel ' + roleClass, 'data-role': wheel.role, transform: 'translate(' + finite(wheel.cx, 0).toFixed(2) + ' ' + finite(wheel.cy, 0).toFixed(2) + ')' });
    var rotor = n('g', { class: 'rotor' });
    g.appendChild(rotor);

    var pitchR = finite(wheel.pitchD, 20) / 2;
    var tipR = finite(wheel.outsideD, wheel.pitchD + 2) / 2;
    var rootR = Math.max(1, finite(wheel.rootD, wheel.pitchD - 2.5) / 2);
    var m = finite(wheel.module, 1);

    if (wheel.kind === 'gear') {
      rotor.appendChild(n('path', { class: 'tooth-profile', d: gearPath(wheel.teeth, pitchR, tipR, rootR, wheel.pressureAngle) }));
      rotor.appendChild(n('circle', { class: 'pitch-circle', r: pitchR.toFixed(2) }));
      var hubR = Math.max(1.2, Math.min(rootR * 0.35, 6 * m));
      rotor.appendChild(n('circle', { class: 'gear-hub', r: hubR.toFixed(2) }));
      rotor.appendChild(n('path', { class: 'hub-cross', d: 'M ' + (-hubR) + ' 0 H ' + hubR + ' M 0 ' + (-hubR) + ' V ' + hubR }));
    } else if (wheel.kind === 'internal-ring') {
      // Anneau à denture intérieure : jante externe + trou denté (evenodd).
      // Le contour du trou reste à (pas + creux) et plonge vers le centre
      // jusqu'à (pas − saillie) : dents pointées vers l'intérieur.
      var ringOuter = tipR;
      var teethPath = toothedRingPath(wheel.teeth, pitchR - m, pitchR + 1.25 * m, 0.45);
      rotor.appendChild(n('path', {
        class: 'tooth-profile ring-profile', 'fill-rule': 'evenodd',
        d: 'M ' + ringOuter + ' 0 A ' + ringOuter + ' ' + ringOuter + ' 0 1 0 ' + (-ringOuter) + ' 0 A ' + ringOuter + ' ' + ringOuter + ' 0 1 0 ' + ringOuter + ' 0 Z ' + teethPath
      }));
      rotor.appendChild(n('circle', { class: 'pitch-circle', r: pitchR.toFixed(2) }));
    } else if (wheel.kind === 'pulley' || wheel.kind === 'sprocket') {
      rotor.appendChild(n('path', { class: 'tooth-profile', d: toothedRingPath(wheel.teeth, tipR, rootR, wheel.kind === 'sprocket' ? 0.22 : 0.45) }));
      rotor.appendChild(n('circle', { class: 'pitch-circle', r: pitchR.toFixed(2) }));
      var hub2 = Math.max(1.2, Math.min(rootR * 0.3, 5 * m));
      rotor.appendChild(n('circle', { class: 'gear-hub', r: hub2.toFixed(2) }));
    } else if (wheel.kind === 'worm') {
      // Vis : capsule le long de l'axe X + filets inclinés à l'angle d'avance.
      var len = Math.max(pitchR * 4, 24);
      var r = Math.max(2, pitchR);
      rotor.appendChild(n('rect', { class: 'tooth-profile worm-body', x: (-len / 2).toFixed(2), y: (-r).toFixed(2), width: len.toFixed(2), height: (2 * r).toFixed(2), rx: r.toFixed(2) }));
      var lead = rad(finite(wheel.leadAngle, 20));
      var step = Math.max(3, 2 * m);
      var threads = 'M 0 0';
      for (var x = -len / 2 + step; x < len / 2 - step / 2; x += step) {
        var dx = Math.tan(lead) * r;
        threads += ' M ' + (x - dx / 2).toFixed(2) + ' ' + r.toFixed(2) + ' L ' + (x + dx / 2).toFixed(2) + ' ' + (-r).toFixed(2);
      }
      rotor.appendChild(n('path', { class: 'worm-thread', d: threads }));
      rotor.appendChild(n('path', { class: 'stage-axis', d: 'M ' + (-len / 2 - 3 * m) + ' 0 H ' + (len / 2 + 3 * m) }));
    } else if (wheel.kind === 'cone') {
      // Silhouette conique simple, base = diamètre primitif.
      var w = Math.max(4, 5 * m);
      rotor.appendChild(n('path', {
        class: 'tooth-profile cone-body',
        d: 'M 0 ' + (-pitchR).toFixed(2) + ' L ' + w + ' ' + (-pitchR * 0.72).toFixed(2) + ' L ' + w + ' ' + (pitchR * 0.72).toFixed(2) + ' L 0 ' + pitchR.toFixed(2) + ' Z'
      }));
      rotor.appendChild(n('path', { class: 'pitch-circle', d: 'M 0 ' + (-pitchR) + ' V ' + pitchR }));
    }

    // Z=n au-dessus du moyeu (hors rotor : ne tourne pas), omis si trop petit.
    // Décalé du centre pour rester lisible sur les arbres composés (deux roues
    // concentriques) et ne pas heurter la croix du moyeu.
    if (wheel.teeth > 0 && rootR > 9 && wheel.kind !== 'worm' && wheel.kind !== 'internal-ring') {
      g.appendChild(n('text', { class: 'tooth-count', 'text-anchor': 'middle', y: (-rootR * 0.5).toFixed(1), 'font-size': Math.max(3.2, Math.min(rootR * 0.3, 10)).toFixed(1) }, 'Z=' + wheel.teeth));
    }
    if (wheel.teeth > 0 && wheel.kind === 'internal-ring') {
      g.appendChild(n('text', { class: 'tooth-count', 'text-anchor': 'middle', y: (-(pitchR + 2.4 * m)).toFixed(1), 'font-size': Math.max(3.2, Math.min(4 * m, 10)).toFixed(1) }, 'Z=' + wheel.teeth));
    }
    var roleNames = { input: 'Entrée', output: 'Sortie', sun: 'Solaire', ring: 'Couronne', planet: 'Satellite' };
    g.appendChild(n('title', {}, (roleNames[wheel.role] || wheel.role) +
      (wheel.teeth ? ' — Z=' + wheel.teeth : '') +
      '\nØ primitif ' + fmt(wheel.pitchD, 2) + ' mm' +
      (wheel.kind === 'gear' ? '\nØ tête ' + fmt(wheel.outsideD, 2) + ' mm · Ø pied ' + fmt(wheel.rootD, 2) + ' mm' : '')));

    this._rotors.push({ el: rotor, speed: finite(wheel.speed, 0), angle: 0 });
    return g;
  };

  TrainRenderer.prototype._drawLink = function (host, link) {
    if (link.kind === 'belt-span' || link.kind === 'chain-span') {
      var cls = link.kind === 'belt-span' ? 'belt-line' : 'chain-line';
      var d;
      if (link.crossed) {
        d = 'M ' + (link.x1) + ' ' + (link.y1 - link.r1) + ' L ' + link.x2 + ' ' + (link.y2 + link.r2) +
          ' M ' + link.x1 + ' ' + (link.y1 + link.r1) + ' L ' + link.x2 + ' ' + (link.y2 - link.r2);
      } else {
        d = 'M ' + link.x1 + ' ' + (link.y1 - link.r1) + ' L ' + link.x2 + ' ' + (link.y2 - link.r2) +
          ' M ' + link.x1 + ' ' + (link.y1 + link.r1) + ' L ' + link.x2 + ' ' + (link.y2 + link.r2);
      }
      var span = n('path', { class: cls, d: d });
      host.appendChild(span);
      this._spans.push({ el: span });
    } else if (link.kind === 'shaft-break') {
      // Continuité d'arbre : trait + double barre oblique.
      var midX = (link.x1 + link.x2) / 2;
      host.appendChild(n('path', { class: 'shaft-link', d: 'M ' + link.x1 + ' ' + link.y1 + ' H ' + link.x2 }));
      host.appendChild(n('path', { class: 'shaft-link', d: 'M ' + (midX - 3) + ' ' + (link.y1 + 5) + ' l 6 -10 M ' + (midX + 3) + ' ' + (link.y1 + 5) + ' l 6 -10' }));
    } else if (link.kind === 'bevel-axes') {
      var span2 = finite(link.span, 40);
      host.appendChild(n('path', { class: 'stage-axis', d: 'M ' + (link.x - span2) + ' ' + link.y + ' H ' + (link.x + span2 * 0.4) }));
      var a = rad(finite(link.shaftAngleDeg, 90) - 90);
      host.appendChild(n('path', {
        class: 'stage-axis',
        d: 'M ' + link.x + ' ' + link.y + ' L ' + (link.x + Math.cos(a) * span2) + ' ' + (link.y + Math.sin(a) * span2 + span2 * 0.5)
      }));
    }
  };

  TrainRenderer.prototype._drawDim = function (host, entry) {
    var a = entry.wheels[0], b = entry.wheels[1];
    var below = Math.max(a.cy + a.outsideD / 2, b.cy + b.outsideD / 2) + Math.max(6, 3 * a.module);
    var g = n('g', { class: 'train-dim' });
    g.appendChild(n('line', { x1: a.cx, y1: a.cy, x2: a.cx, y2: below, class: 'dim-leader' }));
    g.appendChild(n('line', { x1: b.cx, y1: b.cy, x2: b.cx, y2: below, class: 'dim-leader' }));
    g.appendChild(n('line', { x1: a.cx, y1: below, x2: b.cx, y2: below }));
    g.appendChild(n('text', {
      x: (a.cx + b.cx) / 2, y: below + Math.max(4, 2 * a.module),
      'text-anchor': 'middle', 'font-size': Math.max(3.5, Math.min(4 * a.module, 10))
    }, 'c = ' + fmt(entry.centerDistance, 2) + ' mm'));
    host.appendChild(g);
  };

  TrainRenderer.prototype._drawIOChips = function (viewport, model) {
    if (!model.io.input || !model.io.output) return;
    function chip(cls, text, wheel, side) {
      // chipR : rayon d'évitement (la couronne entière pour un planétaire).
      // Entrée à gauche de sa roue, sortie à droite : jamais superposées,
      // même sur un train mono-étage.
      var r = finite(wheel.chipR, finite(wheel.outsideD, 20) / 2);
      var cx = finite(wheel.cx, 0), cy = finite(wheel.cy, 0);
      var g = n('g', { class: 'io-chip ' + cls });
      if (side === 'in') {
        g.appendChild(n('path', { class: 'io-arrow', d: 'M ' + (cx - r - 16) + ' ' + cy + ' h 10 m 0 0 l -4 -3 m 4 3 l -4 3' }));
        g.appendChild(n('text', { x: cx - r - 19, y: cy, 'text-anchor': 'end', dy: '0.34em' }, text));
      } else {
        g.appendChild(n('path', { class: 'io-arrow', d: 'M ' + (cx + r + 5) + ' ' + cy + ' h 10 m 0 0 l -4 -3 m 4 3 l -4 3' }));
        g.appendChild(n('text', { x: cx + r + 19, y: cy, 'text-anchor': 'start', dy: '0.34em' }, text));
      }
      return g;
    }
    viewport.appendChild(chip('in', 'ENTRÉE', model.io.input, 'in'));
    viewport.appendChild(chip('out', 'SORTIE', model.io.output, 'out'));
  };

  // ===== Étiquettes en couloirs (anti-chevauchement) + cadrage =====

  TrainRenderer.prototype._fit = function (keepView) {
    var svg = this.svg;
    var bbox;
    try { bbox = svg.getBBox(); } catch (e) { bbox = null; }
    if (!bbox || (!bbox.width && !bbox.height)) {
      svg.setAttribute('viewBox', FALLBACK_VIEWBOX);
      svg.dataset.initialViewBox = FALLBACK_VIEWBOX;
      return;
    }

    // Couloirs d'étiquettes : pairs au-dessus du dessin, impairs en dessous,
    // poussée horizontale si chevauchement dans un couloir.
    var labels = Array.from(svg.querySelectorAll('.train-label'));
    var fontSize = Math.max(4, Math.min(bbox.width * 0.018, 12));
    var lanes = { top: -Infinity, bottom: -Infinity };
    var self = this;
    labels.forEach(function (label, i) {
      var stageGroup = label.closest('.train-stage');
      var stageBox; try { stageBox = stageGroup.getBBox(); } catch (e) { stageBox = bbox; }
      var top = i % 2 === 0;
      var y = top ? bbox.y - fontSize * 1.6 : bbox.y + bbox.height + fontSize * 2.2;
      var x = stageBox.x + stageBox.width / 2;
      var width = label.textContent.length * fontSize * 0.62;
      var lane = top ? 'top' : 'bottom';
      if (x - width / 2 < lanes[lane]) x = lanes[lane] + width / 2 + fontSize;
      lanes[lane] = x + width / 2;
      label.setAttribute('x', x.toFixed(1));
      label.setAttribute('y', y.toFixed(1));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', fontSize.toFixed(1));
      // Ligne de rappel vers le centre de l'étage.
      var leader = n('line', {
        class: 'label-leader',
        x1: x, y1: top ? y + fontSize * 0.5 : y - fontSize,
        x2: stageBox.x + stageBox.width / 2, y2: top ? stageBox.y : stageBox.y + stageBox.height
      });
      label.parentNode.insertBefore(leader, label);
    });

    // Tailles des puces ENTRÉE/SORTIE proportionnées au dessin.
    Array.from(svg.querySelectorAll('.io-chip text')).forEach(function (t) { t.setAttribute('font-size', (fontSize * 0.9).toFixed(1)); });
    Array.from(svg.querySelectorAll('.train-dim text')).forEach(function (t) { t.setAttribute('font-size', Math.max(3.5, fontSize * 0.8).toFixed(1)); });

    try { bbox = svg.getBBox(); } catch (e) { /* garde */ }
    var pad = Math.max(12, Math.max(bbox.width, bbox.height) * 0.05);
    var vb = [bbox.x - pad, bbox.y - pad, Math.max(1, bbox.width + 2 * pad), Math.max(1, bbox.height + 2 * pad)];
    var vbString = vb.map(function (v) { return v.toFixed(1); }).join(' ');
    svg.dataset.initialViewBox = vbString;
    svg.setAttribute('viewBox', keepView && this._savedViewBox ? this._savedViewBox : vbString);
    if (!keepView) this._savedViewBox = null;
  };

  // ===== Zoom ancré + pan (pointer events) =====

  TrainRenderer.prototype._viewBox = function () {
    return this.svg.getAttribute('viewBox').split(/\s+/).map(Number);
  };

  TrainRenderer.prototype._setViewBox = function (vb) {
    var value = vb.map(function (v) { return v.toFixed(2); }).join(' ');
    this.svg.setAttribute('viewBox', value);
    this._savedViewBox = value;
  };

  TrainRenderer.prototype._bindPanZoom = function () {
    var self = this, svg = this.svg;
    var fit = svg.dataset.initialViewBox.split(/\s+/).map(Number);

    svg.addEventListener('wheel', function (event) {
      event.preventDefault();
      var vb = self._viewBox();
      var rect = svg.getBoundingClientRect();
      var px = vb[0] + (event.clientX - rect.left) / rect.width * vb[2];
      var py = vb[1] + (event.clientY - rect.top) / rect.height * vb[3];
      var k = event.deltaY < 0 ? 1 / 1.2 : 1.2;
      var w = Math.min(Math.max(vb[2] * k, fit[2] / 10), fit[2] * 3);
      var h = vb[3] * (w / vb[2]);
      self._setViewBox([px - (px - vb[0]) * (w / vb[2]), py - (py - vb[1]) * (h / vb[3]), w, h]);
    }, { passive: false });

    // La capture de pointeur ne démarre qu'au-delà du seuil de glissement :
    // capturer dès le pointerdown retargetterait le click vers le svg et les
    // groupes d'étages ne recevraient jamais la sélection.
    var start = null;
    svg.addEventListener('pointerdown', function (event) {
      start = { x: event.clientX, y: event.clientY, vb: self._viewBox(), id: event.pointerId, captured: false };
      self._dragged = false;
    });
    svg.addEventListener('pointermove', function (event) {
      if (!start) return;
      var dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!start.captured) {
        if (Math.abs(dx) + Math.abs(dy) <= 4) return; // simple clic : ne pas voler l'évènement
        start.captured = true;
        self._dragged = true;
        try { svg.setPointerCapture(start.id); } catch (e) { /* garde */ }
      }
      var rect = svg.getBoundingClientRect();
      var vb = start.vb;
      self._setViewBox([vb[0] - dx * vb[2] / rect.width, vb[1] - dy * vb[3] / rect.height, vb[2], vb[3]]);
    });
    function up() { start = null; }
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  };

  TrainRenderer.prototype.resetView = function () {
    if (!this.svg) return;
    this.svg.setAttribute('viewBox', this.svg.dataset.initialViewBox || FALLBACK_VIEWBOX);
    this._savedViewBox = null;
  };

  // ===== Animation (delta-time, rotors seuls) =====

  TrainRenderer.prototype.toggleAnimation = function () {
    if (this._animating) { this._stopAnimation(); return; }
    this._animating = true;
    if (this.svg) this.svg.classList.add('is-animated');
    var self = this;
    this._lastTs = 0;
    var BASE_DEG_PER_S = 120; // vitesse visuelle de l'arbre d'entrée
    function tick(ts) {
      if (!self._animating) return;
      if (!self.svg || !self.svg.isConnected) { self._stopAnimation(); return; }
      var dt = self._lastTs ? (ts - self._lastTs) / 1000 : 0;
      self._lastTs = ts;
      self._rotors.forEach(function (rotor) {
        rotor.angle = (rotor.angle + BASE_DEG_PER_S * rotor.speed * dt) % 360;
        rotor.el.setAttribute('transform', 'rotate(' + rotor.angle.toFixed(2) + ')');
      });
      self._spans.forEach(function (span, i) {
        var offset = (parseFloat(span.el.dataset.offset || '0') + 30 * dt) % 1000;
        span.el.dataset.offset = offset;
        span.el.setAttribute('stroke-dashoffset', (-offset).toFixed(1));
      });
      self._raf = requestAnimationFrame(tick);
    }
    this._raf = requestAnimationFrame(tick);
  };

  TrainRenderer.prototype._stopAnimation = function () {
    this._animating = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this.svg) this.svg.classList.remove('is-animated');
  };

  // ===== Sélection d'étage + inspecteur =====

  TrainRenderer.prototype._bindStageInteractions = function () {
    var self = this;
    Array.from(this.svg.querySelectorAll('.train-stage')).forEach(function (group) {
      var index = Number(group.dataset.stage);
      group.addEventListener('click', function (event) {
        if (self._dragged) { self._dragged = false; return; }
        event.stopPropagation();
        self.selectStage(index);
      });
      group.addEventListener('dblclick', function (event) {
        event.stopPropagation();
        self._requestEdit(index);
      });
      group.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); self.selectStage(index); }
      });
    });
  };

  TrainRenderer.prototype.getStageElement = function (index) {
    return this.svg ? this.svg.querySelector('.train-stage[data-stage="' + index + '"]') : null;
  };

  TrainRenderer.prototype.selectStage = function (index) {
    if (!this.svg) return;
    this._selected = index;
    Array.from(this.svg.querySelectorAll('.train-stage')).forEach(function (group) {
      group.classList.toggle('selected', Number(group.dataset.stage) === index);
    });
    this.container.dispatchEvent(new CustomEvent('viewer:stage-selected', { detail: { index: index } }));
    this._showInspector(index);
  };

  TrainRenderer.prototype._requestEdit = function (index) {
    this.container.dispatchEvent(new CustomEvent('viewer:stage-edit', { detail: { index: index } }));
  };

  TrainRenderer.prototype._inspector = function () {
    var card = document.getElementById('stageInspector');
    if (!card) {
      card = document.createElement('aside');
      card.id = 'stageInspector';
      card.className = 'stage-inspector';
      card.hidden = true;
      card.setAttribute('aria-live', 'polite');
      this.container.appendChild(card);
    }
    return card;
  };

  TrainRenderer.prototype._hideInspector = function () {
    var card = document.getElementById('stageInspector');
    if (card) card.hidden = true;
  };

  TrainRenderer.prototype._showInspector = function (index) {
    var solution = this.solution;
    if (!solution) return;
    var stage = (solution.stages || [])[index];
    var mech = (solution.mechanical || [])[index] || {};
    if (!stage) return;
    var card = this._inspector();
    var g = stage.geometry || {};
    var teeth = [];
    try { teeth = GearTransmissionRegistry.getToothCounts(stage); } catch (e) { teeth = []; }
    var typeName = stage.type;
    try { typeName = GearApp.models.typeRegistry.get(stage.type === 'planetary' ? 'epicyclic' : stage.type).nomCourt; } catch (e) { /* garde */ }

    function row(label, value) {
      return value == null || value === '' ? '' : '<div><span>' + label + '</span><strong>' + value + '</strong></div>';
    }
    var sf = mech.bending && mech.bending.safetyFactor;
    var sh = mech.contact && mech.contact.safetyFactor;
    card.innerHTML =
      '<header><span class="type-badge ' + stage.type + '">' + (index + 1) + ' · ' + typeName + '</span>' +
      '<button type="button" class="btn-small" id="stageInspectorClose" aria-label="Fermer">✕</button></header>' +
      '<div class="inspector-grid">' +
      row('Dents', teeth.filter(Boolean).join(' / ')) +
      row('Rapport', fmt(mech.ratio, 3) + ':1') +
      row('Rendement', Number.isFinite(mech.efficiency) ? fmt(mech.efficiency * 100, 1) + ' %' : null) +
      row('Entraxe', Number.isFinite(g.centerDistance) ? fmt(g.centerDistance, 2) + ' mm' : null) +
      row('Module', stage.parameters && Number.isFinite(stage.parameters.module) ? stage.parameters.module + ' mm' : null) +
      row('SF / SH', (Number.isFinite(sf) ? fmt(sf, 2) : '—') + ' / ' + (Number.isFinite(sh) ? fmt(sh, 2) : '—')) +
      '</div>' +
      '<button type="button" class="btn-small btn-primary" id="stageInspectorEdit">Modifier cet étage</button>';
    card.hidden = false;

    var self = this;
    card.querySelector('#stageInspectorClose').addEventListener('click', function () {
      card.hidden = true;
      self._selected = -1;
      Array.from(self.svg.querySelectorAll('.train-stage.selected')).forEach(function (s) { s.classList.remove('selected'); });
    });
    card.querySelector('#stageInspectorEdit').addEventListener('click', function () { self._requestEdit(index); });
  };

  // ===== Exports autonomes (jetons résolus) =====

  TrainRenderer.prototype._resolvedStyle = function () {
    var cs = getComputedStyle(document.body);
    function v(name, fallback) { var value = cs.getPropertyValue(name).trim(); return value || fallback; }
    var ink = v('--ink', '#182335'), muted = v('--muted', '#5d6b81'), accent = v('--accent', '#2563eb'),
      success = v('--success', '#0c7f5c'), surface = v('--surface-1', '#ffffff'), line = v('--line', '#dbe2ec'),
      danger = v('--danger', '#b3261e');
    return '.tooth-profile{fill:' + accent + '22;stroke:' + ink + ';stroke-width:.6;stroke-linejoin:round}' +
      '.train-wheel.output-member .tooth-profile{fill:' + success + '22}' +
      '.pitch-circle{fill:none;stroke:' + muted + ';stroke-width:.5;stroke-dasharray:4 3}' +
      '.gear-hub{fill:' + surface + ';stroke:' + ink + ';stroke-width:.5}' +
      '.hub-cross,.shaft-link,.stage-axis,.dim-leader,.label-leader{stroke:' + muted + ';stroke-width:.5;fill:none}' +
      '.worm-thread{stroke:' + ink + ';stroke-width:.5;fill:none}' +
      '.belt-line{stroke:' + ink + ';stroke-width:1.4;fill:none}' +
      '.chain-line{stroke:' + ink + ';stroke-width:1.4;fill:none;stroke-dasharray:3 2.2}' +
      '.train-dim line{stroke:' + muted + ';stroke-width:.5}' +
      '.train-dim text,.train-label{fill:' + muted + ';font-family:system-ui,sans-serif}' +
      '.tooth-count{fill:' + ink + ';font-weight:600;font-family:system-ui,sans-serif}' +
      '.io-chip text{font-weight:700;font-family:system-ui,sans-serif}' +
      '.io-chip.in text{fill:' + success + '}.io-chip.out text{fill:' + danger + '}' +
      '.io-arrow{stroke:' + muted + ';fill:none}' +
      'svg{background:' + surface + '}';
  };

  TrainRenderer.prototype.exportSVG = function () {
    if (!this.svg) return '';
    var copy = this.svg.cloneNode(true);
    copy.setAttribute('xmlns', NS);
    var style = document.createElementNS(NS, 'style');
    style.textContent = this._resolvedStyle();
    copy.insertBefore(style, copy.firstChild);
    return new XMLSerializer().serializeToString(copy);
  };

  TrainRenderer.prototype.exportPNG = function (callback) {
    if (!this.svg) { callback(null); return; }
    var background = getComputedStyle(document.body).getPropertyValue('--surface-1').trim() || '#ffffff';
    var blob = new Blob([this.exportSVG()], { type: 'image/svg+xml' });
    var url = URL.createObjectURL(blob);
    var image = new Image();
    image.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = 1600; canvas.height = 800;
      var context = canvas.getContext('2d');
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(callback, 'image/png');
    };
    image.src = url;
  };

  GearApp.visualization.TrainRenderer = TrainRenderer;

})(typeof GearApp !== 'undefined' ? GearApp : null);
