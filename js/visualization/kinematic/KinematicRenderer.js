// KinematicRenderer.js - Vue « Cinématique » : schéma symbolique.
//
// Elle répond à « comment les mouvements et les arbres sont-ils organisés ? ».
// L'ARBRE est l'élément visuel principal : deux roues sur le même arbre doivent
// se lire immédiatement. Les symboles d'engrènement viennent ensuite.
//
// Comme les deux autres vues, elle ne calcule aucune vitesse : tout vient de
// KinematicsEngine via SceneBuilder.
(function (GearApp) {
  'use strict';
  if (typeof document === 'undefined' || !GearApp) return;
  var NS = 'http://www.w3.org/2000/svg';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fmt(value, digits) { return Number.isFinite(value) ? value.toFixed(digits == null ? 2 : digits) : '—'; }

  function KinematicRenderer(container, options) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.layoutEngine = new KinematicLayoutEngine();
    this.projection = (options && options.projection) || 'auto';
    this.solution = null;
    this.scene = null;
    this._spins = [];
    this._angle = 0;
    this._animating = false;
    var self = this;
    this.animation = new GearAnimationController({ onUpdate: function (angle) { self.setAnimationAngle(angle); } });
  }

  KinematicRenderer.prototype.setProjection = function (value) {
    this.projection = value;
    return this.solution ? this.render(this.solution) : this;
  };

  // ===== Arbres =====

  /**
   * Vitesse relative d'un arbre, lue dans la SCÈNE : ce sont les mêmes arbres
   * que ceux du modèle canonique, pas une reconstruction locale.
   */
  KinematicRenderer.prototype._shaftSpeed = function (shaft) {
    if (!this.scene) return shaft.stageIndex == null ? 1 : 0;
    var record = shaft.stageIndex == null ? this.scene.shafts[0] : this.scene.shaftFor(shaft.stageIndex);
    return record && Number.isFinite(record.relativeSpeed) ? record.relativeSpeed : 0;
  };

  /** Identifiant du membre dont la rotation représente cet arbre. */
  KinematicRenderer.prototype._shaftMember = function (shaft) {
    if (shaft.stageIndex == null) return 's0-input';
    return 's' + shaft.stageIndex + '-output';
  };

  /**
   * Nœud d'arbre : le trait d'axe, le repère de rotation animé et l'étiquette
   * « S1 · 500 rpm ↺ ». C'est la colonne vertébrale de la lecture.
   */
  KinematicRenderer.prototype._drawShaft = function (host, overlay, shaft, inputRpm) {
    var vertical = shaft.orientation === 'Z' || shaft.orientation === 'LINEAR';
    var length = vertical ? 82 : 112;
    var group = KinematicPrimitives.element('g', { class: 'kinematic-shaft-node' + (shaft.coaxial ? ' coaxial' : ''), 'data-shaft': shaft.id });
    group.appendChild(KinematicPrimitives.element('line', vertical
      ? { x1: shaft.x, y1: shaft.y - length / 2, x2: shaft.x, y2: shaft.y + length / 2, class: 'kinematic-shaft' }
      : { x1: shaft.x - length / 2, y1: shaft.y, x2: shaft.x + length / 2, y2: shaft.y, class: 'kinematic-shaft' }));
    group.appendChild(KinematicPrimitives.element('circle', { cx: shaft.x, cy: shaft.y, r: 4.5, class: 'shaft-bearing' }));
    host.appendChild(group);

    // Repère de rotation et étiquette au-dessus des symboles : sinon le disque
    // opaque d'un engrenage les masquerait complètement.
    var speed = this._shaftSpeed(shaft);
    var rpm = Number.isFinite(inputRpm) ? inputRpm * speed : null;
    var spin = KinematicPrimitives.spinMark(shaft.x, shaft.y, vertical ? 28 : 40);
    overlay.appendChild(spin);
    this._spins.push({ el: spin, x: shaft.x, y: shaft.y, memberId: this._shaftMember(shaft) });

    var text = 'S' + shaft.id + (shaft.coaxial ? '′' : '');
    if (rpm != null) text += ' · ' + fmt(Math.abs(rpm), 0) + ' rpm ' + (speed < 0 ? '↻' : '↺');
    var label = KinematicPrimitives.element('text', { x: shaft.x, y: finite(shaft.labelY, shaft.y - 52),
      'text-anchor': 'middle', class: 'shaft-label shaft-rpm' }, text);
    label.appendChild(KinematicPrimitives.element('title', {},
      'Arbre S' + shaft.id + ' — vitesse relative ' + fmt(speed, 4) + '× l\'entrée'));
    overlay.appendChild(label);
    return group;
  };

  // ===== Rendu =====

  KinematicRenderer.prototype.render = function (solution) {
    this.solution = solution;
    this.scene = GearSceneBuilder.build(solution);
    this._spins = [];
    if (this.viewport) this.viewport.detach();

    var stages = solution.stages || solution;
    var layout = this.layoutEngine.layout(stages, this.projection);
    var svg = document.createElementNS(NS, 'svg');
    var viewport = document.createElementNS(NS, 'g');
    var self = this;
    svg.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + layout.height);
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('data-projection', layout.projection);
    svg.classList.add('kinematic-svg');
    viewport.classList.add('kinematic-viewport');
    // Le schéma est symbolique mais son viewBox reste large : les textes sont
    // dimensionnés en unités monde équivalant à une taille d'écran constante.
    viewport.setAttribute('font-size', (11 * GearViewportController.screenUnit(this.container, layout.width)).toFixed(3));

    // 1. Le flux de puissance, animable, tout au fond.
    if (layout.nodes.length) {
      var points = [layout.nodes[0].input].concat(layout.nodes.map(function (node) { return node.output; }));
      var d = 'M ' + points.map(function (point) { return point.x + ' ' + point.y; }).join(' L ');
      viewport.appendChild(KinematicPrimitives.element('path', { d: d, class: 'power-flow' }));
      var pulse = KinematicPrimitives.element('circle', { r: 4, class: 'power-pulse', cx: points[0].x, cy: points[0].y });
      viewport.appendChild(pulse);
      this._flow = { el: pulse, points: points };
    } else {
      this._flow = null;
    }

    // 2. Les symboles d'engrènement.
    layout.nodes.forEach(function (node) { viewport.appendChild(self._drawStage(node, solution)); });

    // 3. Les arbres par-dessus : ce sont eux qu'on doit lire en premier, et une
    // roue montée sur le même arbre doit rester immédiatement identifiable.
    var shaftLayer = KinematicPrimitives.element('g', { class: 'kinematic-shaft-layer' });
    var overlay = KinematicPrimitives.element('g', { class: 'kinematic-overlay-layer' });
    var inputRpm = Number(solution.inputSpeedRpm);
    layout.projectedShafts.concat(layout.coaxialShafts || []).forEach(function (shaft) {
      self._drawShaft(shaftLayer, overlay, shaft, inputRpm);
    });
    viewport.appendChild(shaftLayer);
    viewport.appendChild(overlay);

    var input = layout.nodes[0] && layout.nodes[0].input;
    var output = layout.nodes.length && layout.nodes[layout.nodes.length - 1].output;
    if (input) overlay.appendChild(KinematicPrimitives.element('text', { x: input.x, y: input.y + 84, class: 'role-label input-role' }, 'INPUT'));
    if (output) overlay.appendChild(KinematicPrimitives.element('text', { x: output.x, y: output.y + 84, class: 'role-label output-role' }, 'OUTPUT'));
    viewport.appendChild(KinematicPrimitives.axisIndicator(layout.width - 62, layout.height - 62, layout.projection));

    svg.appendChild(viewport);
    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.svg = svg;
    this.viewport = new GearViewportController(svg).attach();
    this.setAnimationAngle(0);
    if (this._animating) { this._animating = false; this.toggleAnimation(); }
    this.container.dispatchEvent(new CustomEvent('visualization:renderer', { detail: { renderer: this } }));
    return this;
  };

  KinematicRenderer.prototype._drawStage = function (node, solution) {
    var self = this;
    var type = node.stage.type || node.stage[2] || 'spur';
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'kinematic-stage ' + type);
    g.setAttribute('data-stage', node.index);
    g.setAttribute('data-relation', node.relation);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', 'Étage ' + (node.index + 1) + ' ' + type);
    KinematicPrimitives.draw(type, g, node);

    // Cartouche de l'étage : au-dessus du symbole, pas au sommet du cadre, pour
    // qu'un train de six étages reste lisible.
    var mechanical = solution.mechanical && solution.mechanical[node.index];
    var middle = (node.input.x + node.output.x) / 2;
    var top = Math.min(node.input.y, node.output.y) - 78;
    g.appendChild(KinematicPrimitives.relationBadge(type, middle, top - 4));
    g.appendChild(KinematicPrimitives.element('text', { x: middle + 16, y: top,
      'text-anchor': 'start', class: 'stage-label' }, 'Étage ' + (node.index + 1) + ' · ' + type));
    // Le rapport est un texte distinct : le menu « Affichage » peut le masquer
    // sans faire disparaître l'identification de l'étage.
    if (mechanical && Number.isFinite(mechanical.ratio)) {
      g.appendChild(KinematicPrimitives.element('text', { x: middle + 16, y: top + 15,
        'text-anchor': 'start', class: 'stage-ratio' }, 'i = ' + fmt(mechanical.ratio, 3)));
    }

    // Rôles S/R/C d'un planétaire : les trois marquages, pas seulement FIXED.
    if (type === 'planetary' || type === 'epicyclic') {
      [['INPUT', node.stage.inputMember || 'S', 'input-role'],
        ['OUTPUT', node.stage.outputMember || 'C', 'output-role'],
        ['FIXED', node.stage.fixed || 'R', 'fixed-role']].forEach(function (role, index) {
        g.appendChild(KinematicPrimitives.element('text', { x: node.input.x, y: node.input.y + 78 + index * 16,
          'text-anchor': 'middle', class: 'role-label ' + role[2] }, role[0] + ' ' + role[1]));
      });
    }

    var metadata;
    if (type === 'rack') {
      var geometry = node.stage.geometry || (mechanical && mechanical.geometry) || {};
      metadata = 'pignon ' + node.stage.pinionTeeth + ' dents · module ' + (node.stage.parameters && node.stage.parameters.module) +
        ' mm · Ø ' + fmt(geometry.pitchDiameterInput) + ' mm · course ' + fmt(geometry.travelPerRevolution) + ' mm/tr' +
        (Number.isFinite(solution.outputForceN) ? ' · force ' + fmt(solution.outputForceN, 1) + ' N' : '');
    } else {
      metadata = 'rapport ' + (mechanical && Number.isFinite(mechanical.ratio) ? mechanical.ratio.toFixed(3) : 'indisponible');
    }
    g.appendChild(KinematicPrimitives.element('title', {}, 'Étage ' + (node.index + 1) + ' — ' + type + ' — ' + metadata));
    g.addEventListener('click', function () {
      if (self.viewport && self.viewport.dragged) { self.viewport.dragged = false; return; }
      self.selectStage(node.index);
    });
    g.addEventListener('dblclick', function (event) {
      event.stopPropagation();
      self.container.dispatchEvent(new CustomEvent('viewer:stage-edit', { detail: { index: node.index } }));
    });
    g.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); self.selectStage(node.index); }
    });
    return g;
  };

  // ===== Animation minimaliste (repères + flux) =====

  KinematicRenderer.prototype.toggleAnimation = function () {
    this.animation.toggle();
    this._animating = this.animation.playing;
    if (this.svg) this.svg.classList.toggle('is-animated', this._animating);
  };

  KinematicRenderer.prototype.setAnimationAngle = function (inputAngle) {
    if (!this.svg || !this.svg.isConnected || !this.scene) return;
    this._angle = finite(inputAngle, 0);
    this.applyPose(GearKinematicsEngine.pose(this.scene.kinematics, this._angle));
  };

  /** applyPose(pose) — mêmes angles que la Denture et la Géométrie. */
  KinematicRenderer.prototype.applyPose = function (pose) {
    if (!this.svg || !pose) return;
    var members = pose.members || {};
    var angle = finite(pose.inputAngle, 0);
    this._spins.forEach(function (spin) {
      var posed = members[spin.memberId] || {};
      spin.el.setAttribute('transform', 'rotate(' + finite(posed.angle, 0).toFixed(2) + ' ' + spin.x.toFixed(2) + ' ' + spin.y.toFixed(2) + ')');
    });
    // Point lumineux parcourant la chaîne entrée → sortie.
    if (this._flow && this._flow.points.length > 1) {
      var points = this._flow.points;
      var t = ((angle / 360) % 1 + 1) % 1 * (points.length - 1);
      var i = Math.min(points.length - 2, Math.floor(t));
      var local = t - i;
      this._flow.el.setAttribute('cx', (points[i].x + (points[i + 1].x - points[i].x) * local).toFixed(2));
      this._flow.el.setAttribute('cy', (points[i].y + (points[i + 1].y - points[i].y) * local).toFixed(2));
    }
  };

  KinematicRenderer.prototype.setAnimationSpeed = function (speed) { this.animation.setSpeed(speed); };
  KinematicRenderer.prototype.setAnimationDirection = function (direction) { this.animation.setDirection(direction); };
  KinematicRenderer.prototype.setAnimationMode = function (mode) { this.animation.setMode(mode); };

  // ===== Interactions et exports =====

  KinematicRenderer.prototype.resetView = function () { if (this.viewport) this.viewport.reset(); };

  // Le surlignage de la ligne du panneau mécanique est centralisé dans
  // UIController._syncMechanicalRow (via l'évènement) : source unique pour
  // toutes les vues.
  KinematicRenderer.prototype.selectStage = function (index, silent) {
    if (!this.svg) return;
    Array.prototype.forEach.call(this.svg.querySelectorAll('.kinematic-stage'), function (g) {
      g.classList.toggle('selected', Number(g.dataset.stage) === index);
    });
    if (!silent) this.container.dispatchEvent(new CustomEvent('viewer:stage-selected', { detail: { index: index } }));
  };

  KinematicRenderer.prototype.getStageElement = function (index) {
    return this.svg ? this.svg.querySelector('.kinematic-stage[data-stage="' + index + '"]') : null;
  };

  KinematicRenderer.prototype._resolvedStyle = function () {
    var cs = getComputedStyle(document.body);
    function v(name, fallback) { var value = cs.getPropertyValue(name).trim(); return value || fallback; }
    var ink = v('--ink', '#182335'), muted = v('--muted', '#5d6b81'), accent = v('--accent', '#2563eb'),
      success = v('--success', '#0c7f5c'), danger = v('--danger', '#b3261e'), surface = v('--surface-1', '#ffffff');
    return '.kinematic-shaft{stroke:' + ink + ';stroke-width:4;stroke-linecap:round}' +
      '.shaft-bearing{fill:' + surface + ';stroke:' + ink + ';stroke-width:1.5}' +
      '.gear-symbol,.pulley,.worm-wheel,.internal-ring,.sun,.ring,.planet,.bevel-symbol{fill:none;stroke:' + ink + ';stroke-width:1.5}' +
      '.symbol-line,.helix-mark,.worm-thread,.rack-line,.rack-tooth,.carrier{fill:none;stroke:' + ink + ';stroke-width:1.2}' +
      '.belt-span,.chain-span{fill:none;stroke:' + ink + ';stroke-width:1.5}.chain-span{stroke-dasharray:5 3}' +
      '.power-flow{fill:none;stroke:' + accent + ';stroke-width:2;stroke-dasharray:7 7}' +
      '.power-pulse{fill:' + accent + '}' +
      '.spin-mark{fill:none;stroke:' + accent + ';stroke-width:1.4}' +
      '.shaft-label,.stage-label,.member-label,.stage-ratio{fill:' + muted + ';font:600 11px system-ui,sans-serif}' +
      '.role-label{font:700 10px system-ui,sans-serif;fill:' + muted + '}' +
      '.input-role{fill:' + success + '}.output-role{fill:' + danger + '}' +
      '.relation-badge{fill:' + surface + ';stroke:' + muted + ';stroke-width:1}' +
      '.relation-glyph{fill:' + muted + ';font:700 11px system-ui,sans-serif}' +
      'svg{background:' + surface + '}';
  };

  KinematicRenderer.prototype.exportSVG = function (options) {
    return this.svg ? GearSvgExport.serialize(this.svg, Object.assign({ styleText: this._resolvedStyle() }, options || {})) : '';
  };

  KinematicRenderer.prototype.exportPNG = function (callback) {
    GearSvgExport.toPNG(this.svg, { styleText: this._resolvedStyle(), width: 1600, height: 800 }, callback);
  };

  GearApp.visualization.KinematicRenderer = KinematicRenderer;

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('svgContainer');
    var renderer = new KinematicRenderer(container);
    GearApp.visualization.kinematicRenderer = renderer;

    document.addEventListener('click', function (e) {
      var current = GearApp.currentSolution;
      var projection = e.target.closest && e.target.closest('[data-projection]');
      if (projection && current) {
        document.querySelectorAll('[data-projection]').forEach(function (b) {
          b.classList.toggle('active', b === projection);
        });
        renderer.setProjection(projection.dataset.projection);
      }
      if (e.target.id === 'kinematicReset') renderer.resetView();
    });
  });
})(GearApp);
