// GeometryRenderer.js - Vue « Géométrie 2D » : vue de DIMENSIONNEMENT.
//
// Elle répond à « quelles sont les dimensions réelles de ce réducteur ? ».
// Comme la vue Denture, elle ne calcule rien : GeometryLayout place les membres
// aux cotes du moteur, DimensionRenderer les cote, KinematicsEngine fournit les
// vitesses, ViewportController le zoom/pan.
//
// Couches SVG activables indépendamment :
//   envelope · shaft · geometry · pitch · dimension · force · label
(function (GearApp) {
  'use strict';
  if (typeof document === 'undefined' || !GearApp) return;

  var LAYERS = ['envelope', 'shaft', 'geometry', 'pitch', 'dimension', 'force', 'label'];

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fmt(value, digits) { return Number.isFinite(value) ? value.toFixed(digits == null ? 2 : digits) : '—'; }

  function GeometryRenderer(container) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.svg = null;
    this.solution = null;
    this.layout = null;
    this.scene = null;
    this._rotors = [];
    this._linear = [];
    this._angle = 0;
    this._animating = false;
    var self = this;
    this.animation = new GearAnimationController({ onUpdate: function (angle) { self.setAnimationAngle(angle); } });
  }

  // ===== Membres =====

  /**
   * Chaque membre est posé dans un groupe « rotor » : le repère d'indexation
   * qu'il porte tourne à la vitesse relative réelle, donc la vue Géométrie
   * raconte la même cinématique que la Denture.
   */
  GeometryRenderer.prototype._member = function (group, item, member) {
    var p = GearGeometryPrimitives;
    var host = p.node('g', { class: 'geometry-member-group role-' + member.role, 'data-role': member.role });
    group.appendChild(host);

    if (member.kind === 'rack') {
      var geometry = item.stage.geometry || {};
      var length = Math.max(item.diameter * 2, finite(geometry.travelPerRevolution, 0));
      var moduleValue = finite(item.stage.parameters && item.stage.parameters.module, 1);
      var slider = p.node('g', { class: 'linear-slider' });
      host.appendChild(slider);
      p.rack(slider, member.cx, member.cy, length, moduleValue);
      this._linear.push({ el: slider, linearId: member.linearId || ('s' + item.index + '-rack') });
      return host;
    }
    // Vis, cônes et porte-satellites tournent aussi : ils reçoivent le même
    // repère d'indexation que les roues, sinon la vue Géométrie raconterait une
    // cinématique incomplète.
    if (member.kind === 'worm') {
      p.worm(host, member.cx, member.cy, member.pitchDiameter, finite(item.stage.parameters && item.stage.parameters.module, 1));
      this._indexMark(host, item, member, finite(member.pitchDiameter, 12) / 2);
      return host;
    }
    if (member.kind === 'cone') {
      p.cone(host, member.cx, member.cy, member.pitchDiameter, member.coneAngleDeg,
        member.width, 'geometry-member cone-member ' + (member.role === 'input' ? 'input-member' : 'output-member'));
      this._indexMark(host, item, member, finite(member.pitchDiameter, 12) / 2);
      return host;
    }
    if (member.kind === 'carrier') {
      p.carrier(host, member.cx, member.cy, finite(member.pitchDiameter, 20) / 2,
        Math.max(2, Math.round(finite(item.stage.planetCount, 3))));
      this._indexMark(host, item, member, finite(member.pitchDiameter, 20) / 2);
      return host;
    }

    var roleClass = member.role === 'input' ? 'input-member' : member.role === 'output' ? 'output-member' : member.role;
    var kindClass = member.kind === 'internal-ring' ? 'internal-ring' : member.kind;
    p.circle(host, member.cx, member.cy, member.pitchDiameter, 'geometry-member ' + kindClass + ' ' + roleClass, member.label);

    // Couche « pitch » : tête, pied et base — masquables sans toucher au reste.
    var construction = this._layers.pitch;
    p.outline(construction, member.cx, member.cy, member.outsideDiameter, 'construction-circle tip-circle', 'Ø tête');
    p.outline(construction, member.cx, member.cy, member.rootDiameter, 'construction-circle root-circle', 'Ø pied');
    p.outline(construction, member.cx, member.cy, member.baseDiameter, 'construction-circle base-circle', 'Ø de base');

    this._indexMark(host, item, member, finite(member.pitchDiameter, 12) / 2);
    return host;
  };

  /**
   * Repère d'indexation animé, adressé par l'IDENTIFIANT DE MEMBRE : c'est la
   * pose du moteur cinématique qui lui donnera son angle, pas un calcul local.
   */
  GeometryRenderer.prototype._indexMark = function (host, item, member, radius) {
    var p = GearGeometryPrimitives;
    var r = Math.max(4, finite(radius, 6));
    var rotor = p.node('g', { class: 'index-rotor', 'data-member': member.memberId || '',
      transform: 'translate(' + member.cx.toFixed(2) + ' ' + member.cy.toFixed(2) + ')' });
    rotor.appendChild(p.node('line', { class: 'index-mark', x1: 0, y1: 0, x2: r.toFixed(2), y2: 0 }));
    host.appendChild(rotor);
    this._rotors.push({ el: rotor, cx: member.cx, cy: member.cy, memberId: member.memberId,
      orbits: member.role === 'planet', orbitX: item.x, orbitY: item.y });
    return rotor;
  };

  /** Brin flexible exact : tangentes calculées, jamais un segment approché. */
  GeometryRenderer.prototype._flexible = function (group, item) {
    var p = GearGeometryPrimitives;
    var stage = item.stage, geometry = stage.geometry || {};
    var exact;
    try {
      exact = GearGeometryUtils.flexiblePath({ x: item.x, y: item.y }, { x: item.x + item.centerDistance, y: item.y },
        finite(geometry.pitchDiameterInput, 20) / 2, finite(geometry.pitchDiameterOutput, 40) / 2,
        !!(stage.parameters && stage.parameters.crossed));
    } catch (e) { return; }
    group.appendChild(p.node('path', { d: GearGeometryUtils.flexibleOutline(exact, finite(geometry.pitchDiameterInput, 20) / 2, finite(geometry.pitchDiameterOutput, 40) / 2),
      class: stage.type === 'chain' ? 'chain-span' : 'belt-span' }));
    exact.tangents.forEach(function (tangent) {
      [tangent.from, tangent.to].forEach(function (point) {
        group.appendChild(p.node('circle', { cx: point.x.toFixed(3), cy: point.y.toFixed(3), r: 1.6, class: 'tangency-point' }));
      });
    });
    group.dataset.centerDistanceMm = exact.distance.toFixed(3);
    group.dataset.wrapAngleDeg = (exact.wrapAngle1 * 180 / Math.PI).toFixed(2);
    group.dataset.crossed = String(exact.crossed);
    group.appendChild(p.node('title', {}, 'Enroulement ' + fmt(exact.wrapAngle1 * 180 / Math.PI, 1) + '° / ' +
      fmt(exact.wrapAngle2 * 180 / Math.PI, 1) + '° — longueur développée ' + fmt(exact.length, 1) + ' mm'));
  };

  GeometryRenderer.prototype._stageGroup = function (layer, item, interactive) {
    var p = GearGeometryPrimitives;
    var group = p.node('g', { class: 'geometry-stage ' + item.type + (item.schematic ? ' schematic' : ''),
      'data-stage': item.index, 'data-schematic': String(!!item.schematic) });
    if (interactive) {
      var self = this;
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', 'Étage ' + (item.index + 1) + ' · ' + item.type);
      group.addEventListener('click', function () {
        if (self.viewport && self.viewport.dragged) { self.viewport.dragged = false; return; }
        self.selectStage(item.index);
      });
      group.addEventListener('dblclick', function (event) {
        event.stopPropagation();
        self.container.dispatchEvent(new CustomEvent('viewer:stage-edit', { detail: { index: item.index } }));
      });
      group.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); self.selectStage(item.index); }
      });
    }
    layer.appendChild(group);
    return group;
  };

  // ===== Rendu =====

  GeometryRenderer.prototype.render = function (solution) {
    this.solution = solution;
    this.scene = GearSceneBuilder.build(solution);
    this.layout = GearGeometryLayout.build(solution, { scene: this.scene });
    this._rotors = [];
    this._linear = [];
    if (this.viewport) this.viewport.detach();

    var p = GearGeometryPrimitives;
    // Le dessin est en millimètres réels : textes et badges sont dimensionnés
    // en unités monde équivalant à une taille d'écran constante.
    var unit = GearViewportController.screenUnit(this.container, this.layout.bounds.width);
    var fontSize = 11 * unit;
    this._unit = unit;
    var svg = p.node('svg', { class: 'geometry-svg', role: 'img', 'aria-label': 'Géométrie 2D calculée' });
    var viewport = p.node('g', { class: 'geometry-viewport', 'font-size': fontSize.toFixed(3) });
    var layers = {};
    svg.appendChild(GearDimensionRenderer.defs(p, { fontSize: fontSize }));
    LAYERS.forEach(function (name) { layers[name] = p.node('g', { class: name + '-layer' }); viewport.appendChild(layers[name]); });
    this._layers = layers;
    var self = this;

    GearDimensionRenderer.envelope(layers.envelope, this.layout, p, { fontSize: fontSize, scale: unit });

    this.layout.stages.forEach(function (item) {
      var geometryGroup = self._stageGroup(layers.geometry, item, true);
      var dimensions = self._stageGroup(layers.dimension, item, false);
      var axes = self._stageGroup(layers.shaft, item, false);
      var labels = self._stageGroup(layers.label, item, false);

      p.axis(axes, item.axis.x1, item.axis.y, item.axis.x2, item.axis.y);
      if (item.type === 'belt' || item.type === 'chain') self._flexible(geometryGroup, item);
      (item.members || []).forEach(function (member) { self._member(geometryGroup, item, member); });
      GearDimensionRenderer.stage(dimensions, item, p, { fontSize: fontSize, scale: unit });

      var mech = (solution.mechanical || [])[item.index] || {};
      GearForceOverlay.render(p.node, layers.force, mech.forces, { x: item.x, y: item.y });
      GearWarningOverlay.render(p.node, labels, GearWarningOverlay.derive(item.stage, mech), item.index,
        { x: item.x + item.diameter / 2 + fontSize, y: item.y - item.diameter / 2 });
      p.label(labels, item.x - item.diameter / 2, self.layout.margin * 0.7,
        'Étage ' + (item.index + 1) + ' · ' + item.type, 'stage-label', { scale: unit, anchor: 'start', fontSize: 13 });
    });

    var box = '0 0 ' + this.layout.bounds.width.toFixed(1) + ' ' + this.layout.bounds.height.toFixed(1);
    svg.setAttribute('viewBox', box);
    svg.dataset.initialViewBox = box;
    svg.appendChild(viewport);
    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.svg = svg;
    GearViewportController.applyScreenScale(svg, unit);
    this.viewport = new GearViewportController(svg).attach();
    this.setAnimationAngle(0);
    if (this._animating) { this._animating = false; this.toggleAnimation(); }
    this.container.dispatchEvent(new CustomEvent('visualization:renderer', { detail: { renderer: this } }));
    return this;
  };

  // ===== Animation partagée =====

  GeometryRenderer.prototype.toggleAnimation = function () {
    this.animation.toggle();
    this._animating = this.animation.playing;
    if (this.svg) this.svg.classList.toggle('is-animated', this._animating);
  };

  GeometryRenderer.prototype.setAnimationAngle = function (inputAngle) {
    if (!this.svg || !this.svg.isConnected || !this.scene) return;
    this._angle = finite(inputAngle, 0);
    this.applyPose(GearKinematicsEngine.pose(this.scene.kinematics, this._angle));
  };

  /** applyPose(pose) — mêmes angles, mêmes translations que la vue Denture. */
  GeometryRenderer.prototype.applyPose = function (pose) {
    if (!this.svg || !pose) return;
    var members = pose.members || {}, linear = pose.linear || {};
    this._rotors.forEach(function (rotor) {
      var posed = members[rotor.memberId] || {};
      var transform = 'translate(' + rotor.cx.toFixed(2) + ' ' + rotor.cy.toFixed(2) + ') rotate(' + finite(posed.angle, 0).toFixed(2) + ')';
      if (rotor.orbits && Number.isFinite(posed.orbitAngle)) {
        transform = 'rotate(' + posed.orbitAngle.toFixed(2) + ' ' + rotor.orbitX.toFixed(2) + ' ' + rotor.orbitY.toFixed(2) + ') ' + transform;
      }
      rotor.el.setAttribute('transform', transform);
    });
    this._linear.forEach(function (entry) {
      entry.el.setAttribute('transform', 'translate(' + finite((linear[entry.linearId] || {}).position, 0).toFixed(2) + ' 0)');
    });
  };

  GeometryRenderer.prototype.setAnimationSpeed = function (speed) { this.animation.setSpeed(speed); };
  GeometryRenderer.prototype.setAnimationDirection = function (direction) { this.animation.setDirection(direction); };
  GeometryRenderer.prototype.setAnimationMode = function (mode) { this.animation.setMode(mode); };

  // ===== Interactions et exports =====

  GeometryRenderer.prototype.resetView = function () {
    if (this.viewport) this.viewport.reset();
    else if (this.svg) this.svg.setAttribute('viewBox', this.svg.dataset.initialViewBox);
  };

  GeometryRenderer.prototype.selectStage = function (index, silent) {
    if (!this.svg) return;
    Array.prototype.forEach.call(this.svg.querySelectorAll('.geometry-stage'), function (group) {
      group.classList.toggle('selected', Number(group.dataset.stage) === index);
    });
    if (!silent) this.container.dispatchEvent(new CustomEvent('viewer:stage-selected', { detail: { index: index } }));
  };

  GeometryRenderer.prototype.getStageElement = function (index) {
    return this.svg ? this.svg.querySelector('.geometry-layer .geometry-stage[data-stage="' + index + '"]') : null;
  };

  GeometryRenderer.prototype._resolvedStyle = function () {
    var cs = getComputedStyle(document.body);
    function v(name, fallback) { var value = cs.getPropertyValue(name).trim(); return value || fallback; }
    var ink = v('--ink', '#182335'), muted = v('--muted', '#5d6b81'), accent = v('--accent', '#2563eb'),
      success = v('--success', '#0c7f5c'), surface = v('--surface-1', '#ffffff');
    return '.geometry-member{fill:none;stroke:' + ink + ';stroke-width:1;vector-effect:non-scaling-stroke}' +
      '.geometry-member.input-member{stroke:' + accent + '}.geometry-member.output-member{stroke:' + success + '}' +
      '.construction-circle{fill:none;stroke:' + muted + ';stroke-width:.6;vector-effect:non-scaling-stroke}' +
      '.base-circle{stroke-dasharray:2 2}.tip-circle{stroke-dasharray:none}.root-circle{stroke-dasharray:4 2}' +
      '.shaft-axis{stroke:' + muted + ';stroke-width:.6;stroke-dasharray:10 3 2 3}' +
      '.dimension-line,.dimension-witness{stroke:' + muted + ';stroke-width:.6;fill:none}' +
      '.dimension-arrow{fill:' + muted + '}' +
      '.geometry-dimension,.stage-label{fill:' + muted + ';font:600 11px system-ui,sans-serif}' +
      '.geometry-envelope{fill:none;stroke:' + muted + ';stroke-dasharray:7 5;opacity:.55}' +
      '.belt-span,.chain-span{fill:none;stroke:' + ink + ';stroke-width:1.4}' +
      '.chain-span{stroke-dasharray:4 3}.tangency-point{fill:' + accent + '}' +
      '.rack-profile,.worm-member,.cone-member,.carrier-member{fill:none;stroke:' + ink + ';stroke-width:1}' +
      '.index-mark{stroke:' + accent + ';stroke-width:1}' +
      'svg{background:' + surface + '}';
  };

  GeometryRenderer.prototype.exportSVG = function (options) {
    return this.svg ? GearSvgExport.serialize(this.svg, Object.assign({ styleText: this._resolvedStyle() }, options || {})) : '';
  };

  GeometryRenderer.prototype.exportPNG = function (callback) {
    GearSvgExport.toPNG(this.svg, { styleText: this._resolvedStyle(), width: 1600, height: 800 }, callback);
  };

  GearApp.visualization.GeometryRenderer = GeometryRenderer;
})(GearApp);
