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
    this._phaseMarks = [];
    this._orbits = [];
    this._arms = [];
    this._phases = [];
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
  /**
   * §4 : la lecture au survol porte sur le GROUPE du membre, pas sur sa
   * silhouette.
   *
   * Le titre était posé sur le cercle primitif, ce qui laissait muets les trois
   * organes qui n'en ont pas : la vis, le cône et le porte-satellites. Pointer
   * un bras de porte-satellites ne disait donc rien — et, une fois les
   * annotations rendues transparentes au pointeur, cela disait pire : la
   * grandeur du voisin situé dessous.
   *
   * Un seul titre par membre, sur le groupe, garantit aussi qu'on lit la même
   * chose où qu'on pointe dans le membre.
   */
  GeometryRenderer.prototype._memberTitle = function (member) {
    var speed = this.scene && member.memberId ? (this.scene.member(member.memberId) || {}).mechanical : null;
    return member.label +
      (member.teeth ? ' — Z=' + member.teeth : '') +
      (member.pitchDiameter ? '\nØ primitif ' + fmt(member.pitchDiameter, 2) + ' mm' : '') +
      (member.outsideDiameter && member.rootDiameter
        ? '\nØ tête ' + fmt(member.outsideDiameter, 2) + ' mm · Ø pied ' + fmt(member.rootDiameter, 2) + ' mm' : '') +
      (member.leadAngleDeg != null ? '\nAngle d’hélice ' + fmt(member.leadAngleDeg, 1) + '°' : '') +
      (speed && Number.isFinite(speed.relativeSpeed) ? '\nVitesse relative ' + fmt(speed.relativeSpeed, 3) + '×' : '');
  };

  /**
   * Le repère d'un organe COUCHÉ SUR SON AXE : on s'y place à sa position, on
   * tourne dans la direction de son arbre, puis on raccourcit ce qui suit
   * l'axe. Une silhouette dessinée en millimètres vrais dans une projection
   * annoncerait une longueur qu'on ne voit pas.
   */
  function axisSeat(member, extraTurn) {
    var angle = finite(member.axisAngleDeg, 0) + finite(extraTurn, 0);
    var squeeze = finite(member.axialScale, 1);
    return GearGeometryPrimitives.node('g', { class: 'axis-seat',
      transform: 'translate(' + finite(member.cx, 0).toFixed(3) + ' ' + finite(member.cy, 0).toFixed(3) +
        ') rotate(' + angle.toFixed(3) + ')' + (Math.abs(squeeze - 1) < 1e-6 ? '' : ' scale(' + squeeze.toFixed(4) + ' 1)') });
  }

  /** Le tracé des bras d'un porte-satellites, à l'angle où il se trouve. */
  function armsPath(entry, theta) {
    var d = '';
    for (var i = 0; i < entry.count; i++) {
      var a = 2 * Math.PI * i / entry.count + theta;
      var point = entry.basis
        ? GearProjectedScene.phasePoint(entry.basis, entry.orbit, a)
        : [Math.cos(a) * entry.orbit, Math.sin(a) * entry.orbit];
      d += ' M ' + entry.cx + ' ' + entry.cy + ' L ' + (entry.cx + point[0]).toFixed(2) + ' ' + (entry.cy + point[1]).toFixed(2);
    }
    return d.trim();
  }

  GeometryRenderer.prototype._member = function (group, item, member) {
    var p = GearGeometryPrimitives;
    var host = p.node('g', { class: 'geometry-member-group role-' + member.role, 'data-role': member.role });
    host.appendChild(p.node('title', {}, this._memberTitle(member)));
    group.appendChild(host);
    this._ground(item, member);
    // Un satellite orbite AVEC SON CORPS. Seule son aiguille d'indexation
    // tournait autour du centre d'étage : le disque restait sur place pendant
    // que son repère s'en allait faire le tour du dessin.
    if (member.role === 'planet' && member.orbitBasis) {
      this._orbits.push({ el: host, memberId: member.memberId, basis: member.orbitBasis,
        orbit: finite(member.orbit, 0), phase: finite(member.phase, 0),
        centreX: finite(member.orbitCenterX, member.cx), centreY: finite(member.orbitCenterY, member.cy),
        seatX: member.cx, seatY: member.cy });
    }

    if (member.kind === 'rack') {
      var geometry = item.stage.geometry || {};
      var length = Math.max(item.diameter * 2, finite(geometry.travelPerRevolution, 0));
      var moduleValue = finite(item.stage.parameters && item.stage.parameters.module, 1);
      // La crémaillère est posée SUR SA GLISSIÈRE, et y glisse. Elle était
      // dessinée à l'horizontale et translatée suivant l'axe X de l'écran :
      // une crémaillère verticale glissait donc de travers, à plat, au travers
      // de son pignon.
      var along = member.slideAlong && Math.hypot(member.slideAlong[0], member.slideAlong[1]) > 1e-9
        ? member.slideAlong : [1, 0];
      var slider = p.node('g', { class: 'linear-slider' });
      var seat = p.node('g', { class: 'slide-seat',
        transform: 'translate(' + finite(member.cx, 0).toFixed(3) + ' ' + finite(member.cy, 0).toFixed(3) +
          ') rotate(' + (Math.atan2(along[1], along[0]) * 180 / Math.PI).toFixed(3) + ')' });
      slider.appendChild(seat);
      host.appendChild(slider);
      p.rack(seat, 0, 0, length, moduleValue);
      this._linear.push({ el: slider, along: along, linearId: member.linearId || ('s' + item.index + '-rack') });
      return host;
    }
    // Vis, cônes et porte-satellites tournent aussi : ils reçoivent le même
    // repère d'indexation que les roues, sinon la vue Géométrie raconterait une
    // cinématique incomplète.
    if (member.kind === 'worm') {
      if (member.presentation === 'face') {
        // Regardée DANS SON AXE, une vis se voit par son bout : un cercle, et
        // une aiguille qui tourne. Le cylindre couché dessiné ici montrait une
        // longueur que cette vue ne voit pas.
        p.circle(host, member.cx, member.cy, member.pitchDiameter,
          'geometry-member worm-member worm-end ' + (member.role === 'input' ? 'input-member' : 'output-member'),
          null, member.apparent);
        this._indexMark(host, item, member, finite(member.pitchDiameter, 12) / 2);
        return host;
      }
      // §15 : la vis est vue de profil. Pas d'aiguille radiale — elle
      // prétendrait une rotation dans le plan du dessin, que la pièce ne fait
      // pas. Seuls les filets défilent, comme dans la vue Denture.
      // La vis est couchée SUR SON AXE : elle était toujours dessinée à
      // l'horizontale, quelle que soit la direction de son arbre.
      var wormSeat = axisSeat(member, 0);
      host.appendChild(wormSeat);
      var threads = p.worm(wormSeat, 0, 0, member.pitchDiameter,
        finite(item.stage.parameters && item.stage.parameters.module, 1), null,
        { starts: member.teeth, leadAngleDeg: member.leadAngleDeg,
          memberId: member.memberId || ('s' + item.index + '-' + member.role) });
      this._phases.push({ el: threads, memberId: member.memberId,
        pitch: Number(threads.dataset.pitch) || 1 });
      return host;
    }
    if (member.kind === 'cone') {
      var coneClass = 'geometry-member cone-member ' + (member.role === 'input' ? 'input-member' : 'output-member');
      if (member.presentation === 'face') {
        // Regardé dans l'axe, un cône primitif se voit par sa base : un cercle.
        // La silhouette de côté y montrait un profil que personne ne voit.
        p.circle(host, member.cx, member.cy, member.pitchDiameter, coneClass, null, member.apparent);
      } else {
        // La silhouette part du sommet vers la grande base : sans l'incliner
        // sur son axe, deux cônes à 90° seraient dessinés parallèles.
        // Le cône s'amincit vers le SOMMET du couple : `apexSide` dit de quel
        // côté de l'organe il se trouve, ce que le sens de l'axe ne dit pas.
        var tilt = axisSeat(member, member.apexSide < 0 ? 180 : 0);
        host.appendChild(tilt);
        p.cone(tilt, 0, 0, member.pitchDiameter, member.coneAngleDeg, member.width, coneClass);
      }
      this._indexMark(host, item, member, finite(member.pitchDiameter, 12) / 2);
      return host;
    }
    if (member.kind === 'carrier') {
      var count = Math.max(2, Math.round(finite(item.stage.planetCount, 3)));
      var spokes = p.carrier(host, member.cx, member.cy, finite(member.pitchDiameter, 20) / 2,
        count, member.orbitBasis, 0);
      // Les bras sont RETRACÉS à chaque angle : ils suivent le plan d'orbite,
      // qu'un `rotate()` d'écran ne saurait parcourir hors d'une vue de face.
      this._arms.push({ el: spokes, memberId: member.memberId, count: count,
        cx: member.cx, cy: member.cy, orbit: finite(member.pitchDiameter, 20) / 2,
        basis: member.orbitBasis });
      this._indexMark(host, item, member, finite(member.pitchDiameter, 20) / 2);
      return host;
    }

    var roleClass = member.role === 'input' ? 'input-member' : member.role === 'output' ? 'output-member' : member.role;
    var kindClass = member.kind === 'internal-ring' ? 'internal-ring' : member.kind;
    var construction = this._layers.pitch;
    // Le titre est porté par le groupe (voir _memberTitle) : le doubler ici
    // ferait dire deux choses différentes au même membre selon l'endroit pointé.
    if (member.presentation === 'profile') {
      // Vue par la tranche : un rectangle b × Ø tête, et le cercle primitif
      // réduit à ses deux génératrices. Le disque tracé ici affirmait que
      // toute roue est vue de face, y compris la roue d'une vis sans fin ou
      // le pignon d'un couple conique, qui ne le sont jamais tous les deux.
      p.profileBody(host, member, 'geometry-member ' + kindClass + ' ' + roleClass);
    } else {
      p.circle(host, member.cx, member.cy, member.pitchDiameter,
        'geometry-member ' + kindClass + ' ' + roleClass, null, member.apparent);
      // Couche « pitch » : tête, pied et base — masquables sans toucher au reste.
      p.outline(construction, member.cx, member.cy, member.outsideDiameter, 'construction-circle tip-circle', 'Ø tête', member.apparent);
      p.outline(construction, member.cx, member.cy, member.rootDiameter, 'construction-circle root-circle', 'Ø pied', member.apparent);
      p.outline(construction, member.cx, member.cy, member.baseDiameter, 'construction-circle base-circle', 'Ø de base', member.apparent);
    }

    this._indexMark(host, item, member, finite(member.pitchDiameter, 12) / 2);
    return host;
  };

  /**
   * §18 : les hachures de bâti d'un organe bloqué. Elles vont dans la couche
   * « envelope », sous les cotes : le blocage est un fait de montage, pas une
   * cote, et il doit rester lisible même quand on masque les cotations.
   */
  GeometryRenderer.prototype._ground = function (item, member) {
    if (member.functionalRole !== 'fixed') return;
    var radius = finite(member.outsideDiameter, finite(member.pitchDiameter, 0)) / 2;
    if (member.kind === 'carrier') radius = finite(member.pitchDiameter, 0) / 2 * 0.55;
    if (!(radius > 0)) return;
    var host = this._layers.envelope;
    GearGroundSymbol.ring(member.cx, member.cy, radius * 1.04, { length: radius * 0.16 })
      .forEach(function (shape) { host.appendChild(GearGeometryPrimitives.node(shape.tag, shape.attrs)); });
  };

  /**
   * Repère d'indexation animé, adressé par l'IDENTIFIANT DE MEMBRE : c'est la
   * pose du moteur cinématique qui lui donnera son angle, pas un calcul local.
   */
  GeometryRenderer.prototype._indexMark = function (host, item, member, radius) {
    var p = GearGeometryPrimitives;
    var r = Math.max(4, finite(radius, 6));
    // Une aiguille radiale qui tourne dans le plan du dessin affirme que la
    // pièce est vue de face. Dès qu'elle ne l'est plus, c'est un REPÈRE DE
    // PHASE qui porte le mouvement : il suit l'image du cercle décrit par un
    // point de la surface primitive — ellipse de biais, segment par la tranche.
    if (member.presentation && member.presentation !== 'face' && member.phaseBasis) {
      var mark = p.node('g', { class: 'phase-mark', 'data-member': member.memberId || '' });
      mark.appendChild(p.node('circle', { class: 'phase-dot', cx: 0, cy: 0,
        r: Math.max(0.6, finite(member.module, 1) * 0.7).toFixed(2) }));
      host.appendChild(mark);
      this._phaseMarks.push({ el: mark, memberId: member.memberId, basis: member.phaseBasis,
        radius: r, cx: member.cx, cy: member.cy });
      return mark;
    }
    var rotor = p.node('g', { class: 'index-rotor', 'data-member': member.memberId || '',
      transform: 'translate(' + member.cx.toFixed(2) + ' ' + member.cy.toFixed(2) + ')' });
    rotor.appendChild(p.node('line', { class: 'index-mark', x1: 0, y1: 0, x2: r.toFixed(2), y2: 0 }));
    host.appendChild(rotor);
    // L'orbite est portée par le GROUPE du satellite (voir _member) : le repère
    // d'indexation n'a plus qu'à tourner sur lui-même, à sa place.
    this._rotors.push({ el: rotor, cx: member.cx, cy: member.cy, memberId: member.memberId });
    return rotor;
  };

  /**
   * Brin flexible : la géométrie du PLAN DE COURROIE, projetée.
   *
   * Cette vue reconstruisait son propre tracé, avec `centre2 = (x + entraxe, y)` :
   * la deuxième poulie était donc forcée à l'horizontale, et le dessin coté
   * décrivait une courroie que la vue Transmission ne montrait pas. Il n'y a
   * plus qu'une géométrie, calculée une fois par `FlexibleDriveGeometry`.
   */
  GeometryRenderer.prototype._flexible = function (group, item) {
    var p = GearGeometryPrimitives;
    var exact = item.flexible;
    if (!exact || !exact.outline) return;
    group.appendChild(p.node('path', { d: exact.outline,
      class: item.stage.type === 'chain' ? 'chain-span' : 'belt-span' }));
    exact.tangentPoints.forEach(function (point) {
      group.appendChild(p.node('circle', { cx: point[0].toFixed(3), cy: point[1].toFixed(3), r: 1.6, class: 'tangency-point' }));
    });
    group.dataset.centerDistanceMm = exact.distance.toFixed(3);
    group.dataset.wrapAngleDeg = exact.wrapAngle1Deg.toFixed(2);
    group.dataset.crossed = String(exact.crossed);
    // Vue par la tranche, la courroie n'a plus de surface : l'annoncer évite de
    // laisser croire que l'enroulement dessiné est mesurable ici.
    group.dataset.beltPlane = exact.collapsed ? 'edge-on' : 'visible';
    group.appendChild(p.node('title', {}, 'Enroulement ' + fmt(exact.wrapAngle1Deg, 1) + '° / ' +
      fmt(exact.wrapAngle2Deg, 1) + '° — longueur développée ' + fmt(exact.length, 1) + ' mm'));
  };

  GeometryRenderer.prototype._stageGroup = function (layer, item, interactive) {
    var p = GearGeometryPrimitives;
    var group = p.node('g', { class: 'geometry-stage ' + item.type + (item.schematic ? ' schematic' : ''),
      'data-stage': item.index, 'data-schematic': String(!!item.schematic) });
    if (interactive) {
      var self = this;
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', 'Étage ' + (item.index + 1) + ' · ' + GearTransmissionRegistry.familyName(item.type));
      group.addEventListener('click', function () {
        if (self.viewport && self.viewport.dragged) { self.viewport.dragged = false; return; }
        self.selectStage(item.index);
      });
      // §7 : le double-clic cadre l'étage, dans les trois vues (voir
      // TrainRenderer). L'édition reste accessible depuis l'inspecteur.
      group.addEventListener('dblclick', function (event) {
        event.stopPropagation();
        self.selectStage(item.index);
        self.focusStage(item.index);
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
    this.layout = GearGeometryLayout.build(solution, { scene: this.scene, view: this.projection });
    this._rotors = [];
    this._phaseMarks = [];
    this._orbits = [];
    this._arms = [];
    this._phases = [];
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

      // L'axe d'un corps est le SEGMENT que son arbre projette, pas une croix
      // posée sur chaque organe : une croix ne dit ni la direction de l'arbre
      // ni ce qu'il porte. Vu en bout — et là seulement — l'axe redevient une
      // croix, qui est sa convention de dessin.
      (item.axes || []).forEach(function (mark) {
        if (mark.endOn) {
          p.axis(axes, mark.x - mark.reach, mark.y, mark.x + mark.reach, mark.y);
          p.axis(axes, mark.x, mark.y - mark.reach, mark.x, mark.y + mark.reach);
          return;
        }
        p.axis(axes, mark.x1, mark.y1, mark.x2, mark.y2);
      });
      if (item.type === 'belt' || item.type === 'chain') self._flexible(geometryGroup, item);
      (item.members || []).forEach(function (member) { self._member(geometryGroup, item, member); });
      GearDimensionRenderer.stage(dimensions, item, p, { fontSize: fontSize, scale: unit });

      var mech = (solution.mechanical || [])[item.index] || {};
      if (item.forceFrame) {
        GearForceOverlay.render(p.node, layers.force, mech.forces,
          { x: item.forceFrame.origin[0], y: item.forceFrame.origin[1] }, item.forceFrame);
      }
      GearWarningOverlay.render(p.node, labels, solution.warnings, item.index,
        { x: item.x + item.diameter / 2 + fontSize, y: item.y - item.diameter / 2 },
        function (stageIndex) { self.selectStage(stageIndex); });
      p.label(labels, item.x - item.diameter / 2, self.layout.margin * 0.7,
        'Étage ' + (item.index + 1) + ' · ' + GearTransmissionRegistry.familyName(item.type, 'short'), 'stage-label', { scale: unit, anchor: 'start', fontSize: 13 });
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
      rotor.el.setAttribute('transform', 'translate(' + rotor.cx.toFixed(2) + ' ' + rotor.cy.toFixed(2) +
        ') rotate(' + finite(posed.angle, 0).toFixed(2) + ')');
    });
    // Le repère de phase d'un organe vu autrement que de face : il parcourt
    // l'image du cercle primitif, sans jamais faire basculer la pièce.
    this._phaseMarks.forEach(function (entry) {
      var theta = finite((members[entry.memberId] || {}).angle, 0) * Math.PI / 180;
      var point = GearProjectedScene.phasePoint(entry.basis, entry.radius, theta);
      entry.el.setAttribute('transform', 'translate(' + (entry.cx + point[0]).toFixed(2) + ' ' + (entry.cy + point[1]).toFixed(2) + ')');
      // De l'autre côté de la pièce, le repère passe derrière : l'estomper le
      // dit sans prétendre le masquer.
      entry.el.setAttribute('opacity', Math.cos(theta) >= 0 ? '1' : '0.35');
    });
    // Les satellites suivent le plan d'orbite, pas un cercle d'écran.
    this._orbits.forEach(function (entry) {
      var theta = entry.phase + finite((members[entry.memberId] || {}).orbitAngle, 0) * Math.PI / 180;
      var seat = GearProjectedScene.phasePoint(entry.basis, entry.orbit, theta);
      entry.el.setAttribute('transform', 'translate(' +
        (entry.centreX + seat[0] - entry.seatX).toFixed(2) + ' ' +
        (entry.centreY + seat[1] - entry.seatY).toFixed(2) + ')');
    });
    this._arms.forEach(function (entry) {
      entry.el.setAttribute('d', armsPath(entry, finite((members[entry.memberId] || {}).angle, 0) * Math.PI / 180));
    });
    // §15 : la phase des filets d'une vis. Un tour d'entrée fait avancer le
    // motif d'exactement un pas, donc la boucle se referme sans saut.
    this._phases.forEach(function (entry) {
      var own = finite((members[entry.memberId] || {}).angle, 0);
      var pitch = entry.pitch > 0 ? entry.pitch : 1;
      var shift = ((own / 360 * pitch) % pitch + pitch) % pitch;
      entry.el.setAttribute('transform', 'translate(' + shift.toFixed(3) + ' 0)');
    });
    this._linear.forEach(function (entry) {
      // La course est en millimètres réels, le long de la GLISSIÈRE projetée.
      var travel = finite((linear[entry.linearId] || {}).position, 0);
      var along = entry.along || [1, 0];
      entry.el.setAttribute('transform', 'translate(' + (along[0] * travel).toFixed(2) + ' ' + (along[1] * travel).toFixed(2) + ')');
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

  /** §7 : cadrer un étage se fait pareil dans les trois vues. */
  GeometryRenderer.prototype.focusStage = function (index) {
    return !!this.viewport && this.viewport.focusElement(this.getStageElement(index));
  };

  GeometryRenderer.prototype._resolvedStyle = function (options) {
    // Les trois vues partageaient la même intention et trois copies du même
    // code : chaque renderer reconstruisait sa feuille de style d'export, donc
    // sa propre idée de ce qu'est un axe ou une cote. Le thème la produit une
    // fois, pour le style demandé.
    return GearDraftingTheme.css({ style: (options && options.style) || this.style || 'visual',
      tokens: GearDraftingTheme.tokensFrom(document.body) });
  };

  GeometryRenderer.prototype.exportSVG = function (options) {
    return this.svg ? GearSvgExport.serialize(this.svg, Object.assign({ styleText: this._resolvedStyle() }, options || {})) : '';
  };

  GeometryRenderer.prototype.exportPNG = function (callback) {
    GearSvgExport.toPNG(this.svg, { styleText: this._resolvedStyle(), width: 1600, height: 800 }, callback);
  };

  GearApp.visualization.GeometryRenderer = GeometryRenderer;
})(GearApp);
