// TrainRenderer.js - Vue « Transmission » : comment le mécanisme est assemblé.
//
// Elle s'appelait « Denture », et ne montrait effectivement qu'une denture.
// Elle montre aujourd'hui l'assemblage : les arbres et leur longueur, les
// orientations, les engrènements, les corps solidaires, le mouvement. Le nom
// suivait un contenu qu'elle avait dépassé ; les identifiants internes, eux,
// restent `teeth` — les renommer n'aurait rien appris à personne.
//
// Le renderer est un ORCHESTRATEUR : il ne calcule ni rapport, ni sens, ni
// profil de dent. Il assemble ce que produisent
//   SceneBuilder / KinematicsEngine → vitesses et membres,
//   TrainLayout                     → positions monde en millimètres réels,
//   TeethPrimitives / TeethOverlay  → géométrie des dents et tracés de construction,
//   ViewportController              → zoom/pan partagé avec les autres vues,
//   AnimationController             → horloge d'animation partagée.
//
// Contrat ViewerToolbar : render(solution), toggleAnimation(), resetView(),
// exportSVG(), exportPNG(cb) + dispatch CustomEvent 'visualization:renderer'.
// Évènements DOM émis sur le conteneur : 'viewer:stage-selected {index}' et
// 'viewer:stage-edit {index}'.
(function (GearApp) {
  'use strict';
  if (typeof document === 'undefined' || !GearApp) return;

  var NS = 'http://www.w3.org/2000/svg';
  var FALLBACK_VIEWBOX = '0 0 800 400';
  var LEVELS = { SILHOUETTE: 0, SIMPLIFIED: 1, INVOLUTE: 2, TECHNICAL: 3 };

  function n(tag, attrs, text) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (text != null) el.textContent = text;
    return el;
  }
  /**
   * Les primitives décrivent le SVG sans le construire — elles restent ainsi
   * testables hors navigateur. Un descripteur peut porter des enfants : c'est
   * ce qui permet à la vis sans fin de grouper ses filets à part de son corps.
   */
  function materialize(descriptor) {
    var element = n(descriptor.tag, descriptor.attrs, descriptor.text);
    (descriptor.children || []).forEach(function (child) { element.appendChild(materialize(child)); });
    return element;
  }
  function appendAll(host, descriptors) { (descriptors || []).forEach(function (d) { host.appendChild(materialize(d)); }); }
  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }
  function fmt(value, digits) { return Number.isFinite(value) ? value.toFixed(digits == null ? 2 : digits) : '—'; }

  /**
   * « Solaire (S) · Entrée ». Le nom vient de la scène — le renderer ne
   * traduit rien lui-même — et la fonction n'est rappelée que lorsqu'elle
   * apporte quelque chose : dire « Menant · Entrée » serait redondant.
   */
  function memberTitle(wheel) {
    var name = wheel.memberName || wheel.role || '';
    // Seuls les organes d'un planétaire ont un code de schéma ; « Menant
    // (input) » n'aiderait personne.
    var code = /^[SRPC]$/.test(wheel.memberCode) ? ' (' + wheel.memberCode + ')' : '';
    var role = wheel.localizedRole && wheel.localizedRole !== name ? ' · ' + wheel.localizedRole : '';
    return name + code + role;
  }

  function TrainRenderer(container) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.svg = null;
    this.solution = null;
    this.scene = null;
    this._wheels = [];      // { wheel, group, rotor, orbit, lod }
    this._flexible = [];    // { link, path, markers }
    this._linear = [];      // { wheel, group }
    this._animating = false;
    this._angle = 0;
    this._lastUid = undefined;
    this._savedViewBox = null;
    this._selected = -1;
    this._autoDetails = true;
    var self = this;
    this.animation = new GearAnimationController({ onUpdate: function (angle) { self.setAnimationAngle(angle); } });
  }

  // ===== Rendu =====

  TrainRenderer.prototype.render = function (solution) {
    this._stopAnimation();
    var keepView = solution && this.solution && solution.uid !== undefined && solution.uid === this._lastUid;
    this.solution = solution;
    this._lastUid = solution ? solution.uid : undefined;
    this._wheels = [];
    this._flexible = [];
    this._linear = [];
    this._meshOverlays = [];
    this._selected = -1;
    if (this.viewport) this.viewport.detach();
    this.scene = GearSceneBuilder.build(solution);
    this.animation.setScene(this.scene);

    var model = GearTrainLayout.layout(solution.stages || [], solution.mechanical || [],
      { scene: this.scene, solution: solution, view: this.projection });
    this.model = model;
    var svg = n('svg', { class: 'train-svg', role: 'img',
      'data-view': model.view.id,
      'aria-label': 'Transmission, ' + model.view.label.toLowerCase() + ' — ' + (solution.stages || []).length + ' étage(s)' });
    var viewport = n('g', { class: 'train-viewport' });
    svg.appendChild(viewport);
    var self = this;

    // Les arbres se peignent SOUS les dentures : ils les traversent.
    this._drawShafts(viewport, model);
    model.stages.forEach(function (entry, index) {
      viewport.appendChild(self._buildStage(entry, solution, index));
    });
    this._drawIOChips(viewport, model);

    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.svg = svg;

    // Les corps de roues sont peints AVANT le cadrage : _fit mesure la boîte
    // englobante réelle, et un premier rendu au niveau intermédiaire évite de
    // cadrer sur un dessin encore vide.
    this._wheels.forEach(function (record) { self._paintWheel(record, LEVELS.INVOLUTE); });
    this._fit(keepView);
    this._bindViewport();
    this._bindStageInteractions();
    this._bindRigidBodies();
    this._refreshDetail(true);
    this.setAnimationAngle(0);
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
      'aria-label': 'Étage ' + (index + 1) + ' · ' + GearTransmissionRegistry.familyName(entry.type) + ' — rapport ' + fmt(mech.ratio, 3)
    });
    if (Number.isFinite(entry.centerDistance)) group.setAttribute('data-center-distance-mm', entry.centerDistance.toFixed(2));
    if (Number.isFinite(mech.ratio)) group.setAttribute('data-ratio', mech.ratio.toFixed(4));

    var links = n('g', { class: 'stage-links' });
    group.appendChild(links);
    entry.links.forEach(function (link) { self._drawLink(links, link, entry); });

    if (entry.carrier) this._drawCarrier(group, entry);

    entry.wheels.forEach(function (wheel) {
      group.appendChild(self._buildWheel(wheel, entry));
    });

    // Tracés de construction de l'engrènement (niveau technique seulement).
    var meshOverlay = n('g', { class: 'mesh-overlay' });
    group.appendChild(meshOverlay);
    this._meshOverlays.push({ entry: entry, host: meshOverlay, lod: -1 });

    var anchor = entry.wheels[0] || { cx: 0, cy: 0, outsideD: 20 };
    GearForceOverlay.render(n, group, mech.forces, { x: anchor.cx, y: anchor.cy });
    // Les badges d'alerte se posent AU-DESSUS de l'étage, jamais sur les
    // dentures : ils signalent sans masquer ce qu'ils commentent.
    var top = entry.wheels.reduce(function (best, wheel) {
      return Math.min(best, finite(wheel.cy, 0) - finite(wheel.outsideD, 20) / 2);
    }, Infinity);
    var middle = entry.wheels.reduce(function (sum, wheel) { return sum + finite(wheel.cx, 0); }, 0) / (entry.wheels.length || 1);
    // Les alertes viennent du moteur, pas d'un calcul local : le dessin dit
    // exactement ce que dit l'analyse.
    GearWarningOverlay.render(n, group, (this.solution || {}).warnings, index,
      { x: middle, y: Number.isFinite(top) ? top : anchor.cy },
      function (stageIndex) { self.selectStage(stageIndex); });

    // Décor : libellé d'étage (couloirs anti-collision posés dans _placeLabels)
    // et cote d'entraxe.
    var decor = n('g', { class: 'stage-decor' });
    var ratioText = Number.isFinite(mech.ratio) ? ' — i=' + fmt(mech.ratio, 2) : '';
    // §21 : tout texte du viewer passe par le registre. « Étage 2 · planetary »
    // laissait un identifiant interne à l'écran.
    var label = n('text', { class: 'train-label', 'data-label-stage': index }, 'Étage ' + (index + 1) + ' · ' + GearTransmissionRegistry.familyName(entry.type, 'short') + ratioText);
    decor.appendChild(label);
    if (Number.isFinite(entry.centerDistance) && entry.wheels.length >= 2 && entry.type !== 'planetary') {
      this._drawDim(decor, entry);
    }
    group.appendChild(decor);

    var title = 'Étage ' + (index + 1) + ' · ' + GearTransmissionRegistry.familyName(entry.type) +
      (Number.isFinite(mech.ratio) ? '\nRapport : ' + fmt(mech.ratio, 4) : '') +
      (Number.isFinite(entry.centerDistance) ? '\nEntraxe : ' + fmt(entry.centerDistance, 2) + ' mm' : '');
    group.appendChild(n('title', {}, title));
    return group;
  };

  TrainRenderer.prototype._buildWheel = function (wheel, entry) {
    var roleClass = wheel.role === 'input' ? 'input-member' : wheel.role === 'output' ? 'output-member' : wheel.role;
    // Un satellite reçoit deux transformations gigognes : orbite (autour du
    // porte-satellites) puis rotation propre.
    var orbit = null;
    var host = n('g', { class: 'train-wheel ' + roleClass, 'data-role': wheel.role });
    if (wheel.memberId) host.setAttribute('data-member', wheel.memberId);
    if (wheel.bodyId) host.setAttribute('data-body', wheel.bodyId);
    if (Number.isFinite(wheel.orbit) && wheel.orbit > 0) {
      orbit = n('g', { class: 'planet-orbit' });
      orbit.appendChild(n('g', { class: 'planet-seat', transform: 'translate(' + finite(wheel.cx, 0).toFixed(2) + ' ' + finite(wheel.cy, 0).toFixed(2) + ')' }));
      host.appendChild(orbit);
    } else {
      // Un cône est posé SUR SON AXE : sans cette rotation, deux roues coniques
      // à 90° seraient dessinées parallèles, ce qui ne veut rien dire.
      var axis = Number.isFinite(wheel.axisAngleDeg) && wheel.axisAngleDeg
        ? ' rotate(' + wheel.axisAngleDeg.toFixed(2) + ')' : '';
      host.setAttribute('transform', 'translate(' + finite(wheel.cx, 0).toFixed(2) + ' ' + finite(wheel.cy, 0).toFixed(2) + ')' + axis);
    }
    var seat = orbit ? orbit.firstChild : host;
    var rotor = n('g', { class: 'rotor' });
    seat.appendChild(rotor);
    // Les repères et étiquettes compensent l'inclinaison de l'axe : un « Z=40 »
    // couché sur le flanc d'un cône serait illisible.
    var construction = n('g', { class: 'construction' });
    if (Number.isFinite(wheel.axisAngleDeg) && wheel.axisAngleDeg) {
      construction.setAttribute('transform', 'rotate(' + (-wheel.axisAngleDeg).toFixed(2) + ')');
    }
    seat.appendChild(construction);

    // §9, §10 : la scène nomme déjà l'organe ET sa fonction. Le renderer n'en
    // garde pas de copie, et n'affiche plus « S » tout court : « Solaire (S) ·
    // Entrée » dit à la fois de quel organe il s'agit et ce qu'il fait.
    seat.appendChild(n('title', {}, memberTitle(wheel) +
      (wheel.teeth ? ' — Z=' + wheel.teeth : '') +
      '\nØ primitif ' + fmt(wheel.pitchD, 2) + ' mm' +
      (wheel.kind === 'gear' ? '\nØ tête ' + fmt(wheel.outsideD, 2) + ' mm · Ø pied ' + fmt(wheel.rootD, 2) + ' mm' : '') +
      '\nVitesse relative ' + fmt(wheel.speed, 3) + '×' +
      this._solidarity(wheel)));

    // Un cône ne peut pas tourner dans le plan du dessin, mais son mouvement
    // doit rester visible : un repère de phase tourne sur sa grande face.
    var phase = null;
    if (wheel.kind === 'cone') {
      var back = finite(wheel.pitchD, 20) / 2;
      phase = n('g', { class: 'cone-phase' });
      phase.appendChild(n('circle', { class: 'phase-dot', cx: (back * 0.55).toFixed(2), cy: '0',
        r: Math.max(0.5, finite(wheel.module, 1) * 0.55).toFixed(2) }));
      seat.appendChild(phase);
    }

    var record = { wheel: wheel, entry: entry, group: host, seat: seat, rotor: rotor, construction: construction, orbit: orbit, phase: phase, lod: -1 };
    if (wheel.kind === 'rack') this._linear.push(record);
    this._wheels.push(record);
    return host;
  };

  /**
   * « Solidaire de : … ». Un train composé pose sans arrêt la question de
   * savoir ce qui tourne d'un bloc, et le dessin n'y répondait pas : deux
   * roues montées sur le même arbre n'étaient reliées par rien de visible.
   * La réponse existe dans le graphe mécanique — on ne fait que la dire.
   */
  TrainRenderer.prototype._solidarity = function (wheel) {
    var body = (this.model && this.model.shafts || []).filter(function (shaft) {
      return shaft.id === wheel.bodyId;
    })[0];
    if (!body || body.memberIds.length < 2) return '';
    var others = body.memberNames.filter(function (name, index) {
      return body.memberIds[index] !== wheel.memberId;
    });
    return others.length ? '\nSolidaire de ' + others.join(', ') : '';
  };

  /** (Re)construit le corps d'une roue pour un niveau de détail donné. */
  TrainRenderer.prototype._paintWheel = function (record, lod, force) {
    if (record.lod === lod && !force) return;
    record.lod = lod;
    record.rotor.textContent = '';
    record.construction.textContent = '';
    // La PRÉSENTATION vient du modèle spatial, pas d'une supposition : une roue
    // n'est un disque que lorsque son axe pointe vers l'œil. Le dessin faisait
    // partout l'hypothèse inverse, ce qui interdisait de montrer un engrenage et
    // une vis sur le même arbre.
    var built = GearTeethPrimitives.build(record.wheel, { lod: lod,
      presentation: record.wheel.presentation, foreshortening: record.wheel.foreshortening,
      style: this.style });
    appendAll(record.rotor, built.rotor);
    // Les cercles de construction — primitif, base, pied — sont des CERCLES :
    // ils n'ont de sens que sur une roue vue de face. Tracés sur un organe vu
    // par la tranche, ils dessinaient une ellipse fantôme autour d'un
    // rectangle, sans rien coter.
    // La représentation conventionnelle porte DÉJÀ les surfaces : y superposer
    // les cercles de construction doublerait chaque trait.
    if (record.wheel.presentation !== 'profile' && !built.conventional) {
      appendAll(record.construction, GearTeethOverlay.circles(record.wheel, lod));
    }
    appendAll(record.construction, built.fixed);
    // Les textes portés par la roue sont plafonnés à la taille d'écran commune :
    // ils restent proportionnés à la roue, sans jamais devenir illisibles.
    if (Number.isFinite(this._fontSize)) {
      var cap = this._fontSize;
      Array.prototype.forEach.call(record.construction.querySelectorAll('text'), function (text) {
        var own = Number(text.getAttribute('font-size'));
        text.setAttribute('font-size', Math.min(own || cap, cap).toFixed(3));
      });
    }
    record.seat.setAttribute('data-lod', lod);
  };

  /**
   * Les arbres, avec leur longueur réelle.
   *
   * Le dessin n'en avait pas : deux roues solidaires partageaient un point, et
   * un trait de liaison muni d'une double barre disait « la suite est ailleurs »
   * sans jamais dire de quoi elle descendait. Un arbre est ici un segment porté
   * par son axe — et quand cet axe pointe vers l'œil, ce n'est plus un segment
   * mais un point : on le marque alors d'une croix d'axe, comme le veut le
   * dessin technique, plutôt que de tracer un trait de longueur nulle.
   */
  TrainRenderer.prototype._drawShafts = function (viewport, model) {
    var host = n('g', { class: 'train-shafts' });
    (model.shafts || []).forEach(function (shaft) {
      var group = n('g', { class: 'train-shaft' + (shaft.grounded ? ' grounded' : ''),
        'data-shaft': shaft.id, 'data-role': shaft.role });
      if (shaft.endOn) {
        var reach = 0;
        (shaft.memberIds || []).forEach(function (id) {
          var wheel = (model.wheels || []).filter(function (w) { return w.memberId === id; })[0];
          if (wheel) reach = Math.max(reach, finite(wheel.outsideD, 0) / 2);
        });
        var arm = Math.max(2, reach * 0.16);
        group.appendChild(n('path', { class: 'shaft-centre',
          d: 'M ' + (shaft.x1 - arm).toFixed(2) + ' ' + shaft.y1.toFixed(2) + ' H ' + (shaft.x1 + arm).toFixed(2) +
            ' M ' + shaft.x1.toFixed(2) + ' ' + (shaft.y1 - arm).toFixed(2) + ' V ' + (shaft.y1 + arm).toFixed(2) }));
      } else {
        group.appendChild(n('line', { class: 'shaft-body',
          x1: shaft.x1.toFixed(2), y1: shaft.y1.toFixed(2), x2: shaft.x2.toFixed(2), y2: shaft.y2.toFixed(2) }));
      }
      host.appendChild(group);
    });
    viewport.appendChild(host);
    return host;
  };

  /** Porte-satellites : bras reliant le centre à chaque satellite. */
  TrainRenderer.prototype._drawCarrier = function (group, entry) {
    var carrier = entry.carrier;
    var host = n('g', { class: 'planet-carrier' });
    if (carrier.bodyId) host.setAttribute('data-body', carrier.bodyId);
    if (carrier.memberId) host.setAttribute('data-member', carrier.memberId);
    var d = '';
    for (var i = 0; i < carrier.count; i++) {
      var a = 2 * Math.PI * i / carrier.count;
      d += ' M 0 0 L ' + (Math.cos(a) * carrier.orbit).toFixed(2) + ' ' + (Math.sin(a) * carrier.orbit).toFixed(2);
    }
    var arms = n('g', { class: 'carrier-arms', transform: 'translate(' + carrier.cx.toFixed(2) + ' ' + carrier.cy.toFixed(2) + ')' });
    arms.appendChild(n('path', { d: d.trim() }));
    arms.appendChild(n('circle', { class: 'carrier-hub', r: Math.max(1.5, carrier.orbit * 0.12).toFixed(2) }));
    host.appendChild(arms);
    // §18 : un porte-satellites bloqué est un bâti. Les hachures se posent sur
    // le groupe FIXE, pas sur les bras — c'est justement qu'ils ne tournent pas.
    if (carrier.functionalRole === 'fixed') {
      appendAll(host, GearGroundSymbol.ring(carrier.cx, carrier.cy,
        Math.max(2, carrier.orbit * 0.28), { length: Math.max(1.5, carrier.orbit * 0.14) }));
    }
    group.appendChild(host);
    entry.carrierElement = arms;
    return host;
  };

  TrainRenderer.prototype._drawLink = function (host, link, entry) {
    if (link.kind === 'belt-span' || link.kind === 'chain-span') {
      var cls = link.kind === 'belt-span' ? 'belt-line' : 'chain-line';
      var d = link.outline;
      if (!d) {
        // Géométrie dégénérée : on garde deux brins finis plutôt qu'un NaN.
        d = 'M ' + link.x1 + ' ' + (link.y1 - link.r1) + ' L ' + link.x2 + ' ' + (link.y2 - link.r2) +
          ' M ' + link.x1 + ' ' + (link.y1 + link.r1) + ' L ' + link.x2 + ' ' + (link.y2 + link.r2);
      }
      var span = n('path', { class: cls, d: d });
      host.appendChild(span);
      var markers = n('g', { class: link.kind === 'belt-span' ? 'belt-markers' : 'chain-markers' });
      host.appendChild(markers);
      this._flexible.push({ link: link, entry: entry, path: span, markers: markers, built: 0 });
    } else if (link.kind === 'bevel-axes') {
      // Les deux axes se coupent au sommet commun des cônes. Leurs directions
      // ne sont plus déduites de l'angle d'arbre — elles viennent du modèle
      // spatial, qui les a projetées : un renvoi à 60° se dessine à 60°.
      var span2 = finite(link.span, 40);
      [link.inAlong, link.outAlong].forEach(function (along) {
        if (!along || !Math.hypot(along[0], along[1])) return;
        host.appendChild(n('path', { class: 'stage-axis',
          d: 'M ' + (link.x - along[0] * span2).toFixed(2) + ' ' + (link.y - along[1] * span2).toFixed(2) +
            ' L ' + (link.x + along[0] * span2).toFixed(2) + ' ' + (link.y + along[1] * span2).toFixed(2) }));
      });
      host.appendChild(n('circle', { class: 'cone-apex-point', cx: link.x.toFixed(2), cy: link.y.toFixed(2), r: 1.2 }));
    }
  };

  /**
   * Marqueurs de courroie/chaîne : un élément par pas réel, répartis sur la
   * LONGUEUR DÉVELOPPÉE — brins droits ET arcs d'enroulement. Un maillon
   * contourne les poulies, il ne saute pas d'un brin à l'autre.
   */
  TrainRenderer.prototype._buildMarkers = function (record, lod) {
    var link = record.link;
    if (record.built === lod) return;
    record.built = lod;
    record.markers.textContent = '';
    record.marks = [];
    if (lod <= LEVELS.SILHOUETTE || !link.path || !(link.length > 0)) return;
    var pitch = Math.max(1.5, finite(link.pitch, 4));
    var count = Math.min(lod === LEVELS.SIMPLIFIED ? 32 : 90, Math.max(6, Math.round(link.length / pitch)));
    var chain = link.kind === 'chain-span';
    for (var i = 0; i < count; i++) {
      var mark = chain
        ? n('circle', { class: 'chain-link', r: Math.max(0.6, pitch * 0.18).toFixed(2) })
        : n('rect', { class: 'belt-tooth', x: (-pitch * 0.18).toFixed(2), y: (-pitch * 0.22).toFixed(2),
          width: (pitch * 0.36).toFixed(2), height: (pitch * 0.44).toFixed(2) });
      record.markers.appendChild(mark);
      record.marks.push({ el: mark, s: link.length * i / count });
    }
  };

  TrainRenderer.prototype._drawDim = function (host, entry) {
    var a = entry.wheels[0], b = entry.wheels[1];
    // Un entraxe vu en bout se projette en un point : la cote n'aurait ni
    // longueur ni sens, et deux traits de rappel superposés ne diraient rien.
    if (Math.hypot(b.cx - a.cx, b.cy - a.cy) < 1e-6) return;
    var below = Math.max(a.cy + a.outsideD / 2, b.cy + b.outsideD / 2) + Math.max(6, 3 * a.module);
    var g = n('g', { class: 'train-dim' });
    g.appendChild(n('line', { x1: a.cx, y1: a.cy, x2: a.cx, y2: below, class: 'dim-leader' }));
    g.appendChild(n('line', { x1: b.cx, y1: b.cy, x2: b.cx, y2: below, class: 'dim-leader' }));
    g.appendChild(n('line', { x1: a.cx, y1: below, x2: b.cx, y2: below }));
    var text = 'c = ' + fmt(entry.centerDistance, 2) + ' mm';
    if (Number.isFinite(entry.links[0] && entry.links[0].wrapAngle1Deg)) {
      text += ' · enroulement ' + fmt(entry.links[0].wrapAngle1Deg, 0) + '°/' + fmt(entry.links[0].wrapAngle2Deg, 0) + '°';
    }
    g.appendChild(n('text', {
      x: (a.cx + b.cx) / 2, y: below + Math.max(4, 2 * a.module),
      'text-anchor': 'middle', 'font-size': Math.max(3.5, Math.min(4 * a.module, 10))
    }, text));
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

    // Le dessin est en millimètres réels : les textes et badges sont
    // dimensionnés en unités monde correspondant à une taille d'écran fixe.
    var unit = GearViewportController.screenUnit(svg, bbox.width);
    var fontSize = 11 * unit;
    this._fontSize = fontSize;
    svg.querySelector('.train-viewport').setAttribute('font-size', fontSize.toFixed(3));
    GearViewportController.applyScreenScale(svg, unit);

    // Couloirs d'étiquettes : pairs au-dessus du dessin, impairs en dessous,
    // poussée horizontale si chevauchement dans un couloir.
    var labels = Array.from(svg.querySelectorAll('.train-label'));
    var lanes = { top: -Infinity, bottom: -Infinity };
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

    // Puces ENTRÉE/SORTIE et cotes : même unité écran que les étiquettes.
    Array.from(svg.querySelectorAll('.io-chip text')).forEach(function (t) { t.setAttribute('font-size', (fontSize * 0.95).toFixed(3)); });
    Array.from(svg.querySelectorAll('.train-dim text')).forEach(function (t) { t.setAttribute('font-size', (fontSize * 0.85).toFixed(3)); });
    Array.from(svg.querySelectorAll('.tooth-count')).forEach(function (t) {
      // Z=n suit la roue : plafonné pour ne jamais déborder du moyeu.
      var own = Number(t.getAttribute('font-size'));
      t.setAttribute('font-size', Math.min(own || fontSize, fontSize).toFixed(3));
    });

    try { bbox = svg.getBBox(); } catch (e) { /* garde */ }
    var pad = Math.max(12, Math.max(bbox.width, bbox.height) * 0.05);
    var vb = [bbox.x - pad, bbox.y - pad, Math.max(1, bbox.width + 2 * pad), Math.max(1, bbox.height + 2 * pad)];
    var vbString = vb.map(function (v) { return v.toFixed(1); }).join(' ');
    svg.dataset.initialViewBox = vbString;
    svg.setAttribute('viewBox', keepView && this._savedViewBox ? this._savedViewBox : vbString);
    if (!keepView) this._savedViewBox = null;
  };

  // ===== Viewport partagé =====

  TrainRenderer.prototype._bindViewport = function () {
    var self = this;
    this.viewport = new GearViewportController(this.svg, {
      onChange: function (state) {
        self._savedViewBox = state.viewBox.map(function (v) { return v.toFixed(2); }).join(' ');
        self._scheduleDetail();
      }
    });
    if (this._savedViewBox) this.viewport.setState({ viewBox: this._savedViewBox.split(/\s+/).map(Number) });
    this.viewport.attach();
    // Le niveau de détail dépend de la taille RÉELLE à l'écran : il doit être
    // réévalué quand le conteneur est redimensionné — ou simplement quand il
    // devient visible, le premier rendu pouvant avoir lieu à largeur nulle.
    if (typeof ResizeObserver === 'function') {
      if (this._resizeObserver) this._resizeObserver.disconnect();
      var observer = new ResizeObserver(function () { self._scheduleDetail(); });
      observer.observe(this.container);
      this._resizeObserver = observer;
    }
  };

  TrainRenderer.prototype.resetView = function () {
    if (!this.svg) return;
    this._savedViewBox = null;
    if (this.viewport) this.viewport.reset(); else this.svg.setAttribute('viewBox', this.svg.dataset.initialViewBox || FALLBACK_VIEWBOX);
    this._refreshDetail();
  };

  // ===== Niveau de détail piloté par la taille à l'écran =====

  TrainRenderer.prototype.setAutoDetails = function (enabled) {
    this._autoDetails = enabled !== false;
    this._refreshDetail(true);
  };

  TrainRenderer.prototype._scheduleDetail = function () {
    var self = this;
    if (this._detailPending || typeof requestAnimationFrame !== 'function') return;
    this._detailPending = requestAnimationFrame(function () { self._detailPending = null; self._refreshDetail(); });
  };

  TrainRenderer.prototype._refreshDetail = function (force) {
    if (!this.svg || !this.svg.isConnected) return;
    var ppu = this.viewport ? this.viewport.pixelsPerUnit() : 1;
    var self = this;
    this._wheels.forEach(function (record) {
      // Le niveau de détail suit la taille APPARENTE : une roue vue par la
      // tranche n'a pas besoin d'une développante exacte pour trente pixels.
      var lod = GearTeethPrimitives.levelFor(record.wheel, ppu,
        { presentation: record.wheel.presentation, foreshortening: record.wheel.foreshortening,
          style: self.style });
      // « Détails automatiques » désactivé : on plafonne à la développante nue.
      if (!self._autoDetails) lod = Math.min(lod, LEVELS.INVOLUTE);
      if (force || lod !== record.lod) self._paintWheel(record, lod, force);
    });
    this._flexible.forEach(function (record) {
      var reference = record.entry.wheels[1] || record.entry.wheels[0];
      var lod = GearTeethPrimitives.levelFor(reference, ppu);
      if (!self._autoDetails) lod = Math.min(lod, LEVELS.INVOLUTE);
      self._buildMarkers(record, lod);
    });
    (this._meshOverlays || []).forEach(function (record) {
      var reference = record.entry.wheels[0];
      var lod = GearTeethPrimitives.levelFor(reference, ppu);
      if (!self._autoDetails) lod = Math.min(lod, LEVELS.INVOLUTE);
      if (!force && lod === record.lod) return;
      record.lod = lod;
      record.host.textContent = '';
      // La ligne d'action se lit dans le plan de l'engrènement. Vue par la
      // tranche, elle traverserait le dessin en diagonale sans rien montrer.
      var flat = record.entry.wheels.some(function (wheel) { return wheel.presentation === 'profile'; });
      if (!flat) appendAll(record.host, GearTeethOverlay.mesh(record.entry, lod));
    });
    this.setAnimationAngle(this._angle);
  };

  // ===== Animation (toutes les familles de transmission) =====

  TrainRenderer.prototype.toggleAnimation = function () {
    this.animation.toggle();
    this._animating = this.animation.playing;
    if (this.svg) this.svg.classList.toggle('is-animated', this._animating);
  };

  /**
   * setAnimationAngle(inputAngle) — inputAngle en degrés d'arbre d'entrée.
   * Le renderer ne calcule RIEN : il demande la pose au moteur cinématique et
   * se contente de l'appliquer. C'est la garantie que les trois vues montrent
   * exactement la même cinématique, au même instant.
   */
  TrainRenderer.prototype.setAnimationAngle = function (inputAngle) {
    if (!this.svg || !this.svg.isConnected || !this.scene) return;
    this._angle = finite(inputAngle, 0);
    this.applyPose(GearKinematicsEngine.pose(this.scene.kinematics, this._angle));
  };

  /** applyPose(pose) — seul point qui touche aux transformations animées. */
  TrainRenderer.prototype.applyPose = function (pose) {
    if (!this.svg || !pose) return;
    var members = pose.members || {}, linear = pose.linear || {}, flexible = pose.flexible || {};
    function angleOf(id) { var m = members[id]; return m && Number.isFinite(m.angle) ? m.angle : 0; }

    this._wheels.forEach(function (record) {
      var wheel = record.wheel;
      var posed = members[wheel.memberId] || {};
      var own = finite(posed.angle, 0);
      if (record.orbit) {
        // Satellite : orbite du porte-satellites, puis rotation propre. La pose
        // porte les deux angles ; le renderer ne fait que les composer.
        var orbit = finite(posed.orbitAngle, 0);
        record.orbit.setAttribute('transform',
          'rotate(' + orbit.toFixed(2) + ' ' + finite(wheel.orbitCenterX, 0).toFixed(2) + ' ' + finite(wheel.orbitCenterY, 0).toFixed(2) + ')');
        // La rotation propre est comptée dans le repère fixe : on retire
        // l'entraînement de l'orbite déjà appliqué par le groupe parent.
        record.rotor.setAttribute('transform', 'rotate(' + (own - orbit).toFixed(2) + ')');
        return;
      }
      if (wheel.kind === 'rack') {
        // La translation vient de la pose, en millimètres réels, et se fait le
        // long de la GLISSIÈRE. Elle se faisait suivant l'axe horizontal de
        // l'écran, et cette transformation écrasait au passage l'orientation
        // du profil : une crémaillère verticale glissait donc de travers, à
        // plat, au travers de son pignon.
        var travel = finite((linear[wheel.linearId] || {}).position, 0);
        var slide = wheel.slideAlong || [1, 0];
        var turn = Number.isFinite(wheel.axisAngleDeg) && wheel.axisAngleDeg
          ? ' rotate(' + wheel.axisAngleDeg.toFixed(2) + ')' : '';
        record.group.setAttribute('transform',
          'translate(' + (finite(wheel.cx, 0) + slide[0] * travel).toFixed(2) + ' ' +
          (finite(wheel.cy, 0) + slide[1] * travel).toFixed(2) + ')' + turn);
        return;
      }
      if (wheel.kind === 'cone') {
        // Faire pivoter une silhouette conique dans le plan du dessin serait un
        // contresens : c'est un repère de phase, posé sur la grande face, qui
        // porte le mouvement.
        if (record.phase) record.phase.setAttribute('transform', 'rotate(' + (own % 360).toFixed(2) + ')');
        return;
      }
      if (wheel.kind === 'worm') {
        // §11 : le groupe ENTIER était translaté — corps, axe et filets — donc
        // la vis se déplaçait le long de son arbre. Elle tourne autour de son
        // axe : le corps ne bouge pas, seuls les filets défilent.
        var geometry = GearTeethPrimitives.wormGeometry ? GearTeethPrimitives.wormGeometry(wheel) : null;
        var pitch = geometry ? geometry.pitch
          : Math.max(1e-6, Math.PI * finite(wheel.module, 1) * Math.max(1, finite(wheel.teeth, 1)));
        var threads = record.rotor.querySelector('.worm-thread-phase');
        record.rotor.removeAttribute('transform');
        if (threads) {
          // Modulo le pas : la phase revient exactement sur elle-même à
          // chaque tour, sans saut, grâce aux filets dessinés en débord.
          var phase = ((own / 360 * pitch) % pitch + pitch) % pitch;
          threads.setAttribute('transform', 'translate(' + phase.toFixed(3) + ' 0)');
        }
        return;
      }
      record.rotor.setAttribute('transform', 'rotate(' + own.toFixed(2) + ')');
    });

    (this.model && this.model.stages || []).forEach(function (entry) {
      if (entry.carrierElement && entry.carrier) {
        entry.carrierElement.setAttribute('transform',
          'translate(' + entry.carrier.cx.toFixed(2) + ' ' + entry.carrier.cy.toFixed(2) + ') rotate(' + angleOf(entry.carrier.memberId).toFixed(2) + ')');
      }
    });

    this._flexible.forEach(function (record) {
      var link = record.link;
      // Défilement en millimètres réels issu de la pose : aucun produit
      // rayon × vitesse n'est refait ici.
      var offset = finite((flexible[link.driveId] || {}).offset, 0);
      if (record.marks && link.path) {
        record.marks.forEach(function (mark) {
          var point = GearGeometryUtils.pointAlong(link.path, mark.s + offset);
          if (point) mark.el.setAttribute('transform', 'translate(' + point.x.toFixed(2) + ' ' + point.y.toFixed(2) + ')');
        });
      }
      record.path.setAttribute('stroke-dashoffset', (-offset).toFixed(1));
    });
  };

  TrainRenderer.prototype.setAnimationSpeed = function (speed) { this.animation.setSpeed(speed); };
  TrainRenderer.prototype.setAnimationDirection = function (direction) { this.animation.setDirection(direction); };
  TrainRenderer.prototype.setAnimationMode = function (mode) { this.animation.setMode(mode); };

  TrainRenderer.prototype._stopAnimation = function () {
    this.animation.pause();
    this._animating = false;
    if (this.svg) this.svg.classList.remove('is-animated');
  };

  // ===== Sélection d'étage + inspecteur =====

  TrainRenderer.prototype._bindStageInteractions = function () {
    var self = this;
    Array.from(this.svg.querySelectorAll('.train-stage')).forEach(function (group) {
      var index = Number(group.dataset.stage);
      group.addEventListener('click', function (event) {
        if (self.viewport && self.viewport.dragged) { self.viewport.dragged = false; return; }
        event.stopPropagation();
        self.selectStage(index);
      });
      // §7 : le double-clic CADRE l'étage. C'était le geste d'édition, mais
      // dans un dessin qu'on explore c'est « montre-moi ça de plus près » qui
      // revient à chaque instant, alors que modifier un étage est un acte
      // délibéré — et l'inspecteur porte déjà le bouton qui le fait.
      group.addEventListener('dblclick', function (event) {
        event.stopPropagation();
        self.selectStage(index);
        self.focusStage(index);
      });
      group.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); self.selectStage(index); }
      });
    });
  };

  /**
   * Éclairer ce qui tourne d'un bloc.
   *
   * Deux roues montées sur le même arbre n'étaient reliées par rien de
   * visible : sur un train composé, savoir laquelle entraîne laquelle demandait
   * de relire les étages un à un. Le graphe mécanique connaît les corps
   * rigides ; il suffit de les rendre lisibles au survol, sans rien recalculer.
   *
   * Le surlignage est purement visuel et ne remplace pas la sélection : on
   * survole pour comprendre, on clique pour choisir.
   */
  TrainRenderer.prototype._bindRigidBodies = function () {
    var self = this;
    function light(bodyId) {
      if (self._litBody === bodyId) return;
      self._litBody = bodyId;
      Array.prototype.forEach.call(self.svg.querySelectorAll('[data-body]'), function (part) {
        part.classList.toggle('rigid-highlight', !!bodyId && part.dataset.body === bodyId);
      });
      Array.prototype.forEach.call(self.svg.querySelectorAll('.train-shaft'), function (shaft) {
        shaft.classList.toggle('rigid-highlight', !!bodyId && shaft.dataset.shaft === bodyId);
      });
    }
    // Un seul écouteur sur le SVG : un par organe ne survivrait pas au re-rendu
    // et coûterait cher sur un train de six étages.
    this.svg.addEventListener('mousemove', function (event) {
      var owner = event.target.closest ? event.target.closest('[data-body], .train-shaft') : null;
      light(owner ? (owner.dataset.body || owner.dataset.shaft) : null);
    });
    this.svg.addEventListener('mouseleave', function () { light(null); });
    this._litBody = null;
  };

  TrainRenderer.prototype.getStageElement = function (index) {
    return this.svg ? this.svg.querySelector('.train-stage[data-stage="' + index + '"]') : null;
  };

  TrainRenderer.prototype.selectStage = function (index, silent) {
    if (!this.svg) return;
    this._selected = index;
    Array.from(this.svg.querySelectorAll('.train-stage')).forEach(function (group) {
      group.classList.toggle('selected', Number(group.dataset.stage) === index);
    });
    if (!silent) this.container.dispatchEvent(new CustomEvent('viewer:stage-selected', { detail: { index: index } }));
  };

  /**
   * Cadrage sur un étage : utilisé par la sélection croisée entre vues.
   *
   * Cadrer un étage, c'est cadrer ses PIÈCES. Son étiquette, elle, est posée
   * en marge du dessin entier, et sa ligne de rappel court jusque-là : les
   * compter revenait à demander le dessin entier. Tant que les étages étaient
   * rangés côte à côte, cela restait sans conséquence visible ; depuis qu'ils
   * s'empilent sur leurs axes réels, c'est exactement ce qu'on obtenait — un
   * double-clic qui ne rapprochait de rien.
   */
  TrainRenderer.prototype.focusStage = function (index) {
    if (!this.viewport) return false;
    var entry = this.model && this.model.stages && this.model.stages[index];
    if (!entry || !entry.wheels.length) return this.viewport.focusElement(this.getStageElement(index));
    var box = null;
    entry.wheels.forEach(function (wheel) {
      // L'encombrement d'un organe est celui de sa denture ; une crémaillère
      // occupe sa course, qui n'a rien d'un diamètre.
      var reach = Math.max(finite(wheel.length, 0) / 2,
        Math.max(finite(wheel.outsideD, 0), finite(wheel.pitchD, 0)) / 2, 2);
      var x = finite(wheel.cx, 0), y = finite(wheel.cy, 0);
      var own = { left: x - reach, top: y - reach, right: x + reach, bottom: y + reach };
      box = box ? { left: Math.min(box.left, own.left), top: Math.min(box.top, own.top),
        right: Math.max(box.right, own.right), bottom: Math.max(box.bottom, own.bottom) } : own;
    });
    this.viewport.focus({ x: box.left, y: box.top,
      width: box.right - box.left, height: box.bottom - box.top });
    return true;
  };

  // ===== Exports autonomes (jetons résolus) =====

  TrainRenderer.prototype._resolvedStyle = function (options) {
    // Les trois vues partageaient la même intention et trois copies du même
    // code : chaque renderer reconstruisait sa feuille de style d'export, donc
    // sa propre idée de ce qu'est un axe ou une cote. Le thème la produit une
    // fois, pour le style demandé.
    return GearDraftingTheme.css({ style: (options && options.style) || this.style || 'visual',
      tokens: GearDraftingTheme.tokensFrom(document.body) });
  };

  TrainRenderer.prototype.exportSVG = function (options) {
    if (!this.svg) return '';
    return GearSvgExport.serialize(this.svg, Object.assign({ styleText: this._resolvedStyle() }, options || {}));
  };

  TrainRenderer.prototype.exportPNG = function (callback) {
    if (!this.svg) { callback(null); return; }
    GearSvgExport.toPNG(this.svg, { styleText: this._resolvedStyle(), width: 1600, height: 800 }, callback);
  };

  GearApp.visualization.TrainRenderer = TrainRenderer;

})(typeof GearApp !== 'undefined' ? GearApp : null);
