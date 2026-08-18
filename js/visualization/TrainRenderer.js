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

    // Trois calques : ce qui EXISTE, ce qui COMMENTE, ce qui S'ADRESSE au
    // lecteur. Voir _buildStage.
    var geometryLayer = n('g', { class: 'geometry-layer' });
    var engineeringLayer = n('g', { class: 'engineering-overlay-layer' });
    var annotationLayer = n('g', { class: 'annotation-layer' });
    viewport.appendChild(geometryLayer);
    viewport.appendChild(engineeringLayer);
    viewport.appendChild(annotationLayer);

    // Les arbres se peignent SOUS les dentures : ils les traversent de part en
    // part, et un arbre posé par-dessus ses propres roues n'aurait pas de sens.
    this._drawShafts(geometryLayer, model);
    var bodies = [];
    model.stages.forEach(function (entry, index) {
      bodies = bodies.concat(self._buildStage(entry, solution, index,
        { engineering: engineeringLayer, annotation: annotationLayer }));
    });
    // Du plus lointain au plus proche, TOUS ÉTAGES CONFONDUS. Le SVG peint dans
    // l'ordre du document, qui était celui des étages — un ordre qui ne dit
    // rien de la profondeur, et qui faisait passer la poulie d'un étage
    // derrière la roue avec laquelle elle partage pourtant son arbre.
    bodies.sort(function (a, b) { return b.depth - a.depth; })
      .forEach(function (part) { geometryLayer.appendChild(part.el); });
    this._drawIOChips(annotationLayer, model);

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

  /**
   * Un étage se répartit sur TROIS CALQUES.
   *
   * Tout vivait dans un seul groupe : dentures, tracés d'engrènement, flèches
   * d'effort, badges d'alerte, libellés. Impossible alors de trier les corps
   * par profondeur sans enterrer une alerte sous la denture du voisin — c'est
   * ce qui limitait le tri à l'intérieur d'un étage.
   *
   *   geometry-layer               ce qui EXISTE dans le mécanisme, et qui se
   *                                trie donc par profondeur, tous étages
   *                                confondus ;
   *   engineering-overlay-layer    ce qui commente la mécanique : ligne
   *                                d'action, efforts ;
   *   annotation-layer             ce qui s'adresse au lecteur : alertes,
   *                                libellés, cotes, puces ENTRÉE/SORTIE.
   *
   * Les trois portent `data-stage` : la sélection, le survol et le clic
   * continuent de désigner un étage entier, quel que soit le calque touché.
   */
  TrainRenderer.prototype._buildStage = function (entry, solution, index, layers) {
    var self = this;
    var mech = (solution.mechanical || [])[index] || {};
    var title = 'Étage ' + (index + 1) + ' · ' + GearTransmissionRegistry.familyName(entry.type) +
      (Number.isFinite(mech.ratio) ? '\nRapport : ' + fmt(mech.ratio, 4) : '') +
      (Number.isFinite(entry.centerDistance) ? '\nEntraxe : ' + fmt(entry.centerDistance, 2) + ' mm' : '');

    function stamp(element) {
      element.setAttribute('data-stage', index);
      element.setAttribute('data-type', entry.type);
      if (Number.isFinite(entry.centerDistance)) element.setAttribute('data-center-distance-mm', entry.centerDistance.toFixed(2));
      if (Number.isFinite(mech.ratio)) element.setAttribute('data-ratio', mech.ratio.toFixed(4));
      return element;
    }
    // `.train-stage` ne désigne QU'UN SEUL groupe par étage — celui des
    // annotations, qui porte son libellé et ses alertes. C'est lui l'élément
    // adressable d'un étage. Les autres calques sont repérés par `data-stage`,
    // comme les pièces elles-mêmes : deux éléments portant la même classe et
    // le même étage rendraient tout sélecteur ambigu.
    function stageGroup(host, className, focusable) {
      var group = stamp(n('g', { class: className + ' ' + entry.type }));
      if (focusable) {
        group.setAttribute('tabindex', 0);
        group.setAttribute('role', 'button');
        group.setAttribute('aria-label', 'Étage ' + (index + 1) + ' · ' +
          GearTransmissionRegistry.familyName(entry.type) + ' — rapport ' + fmt(mech.ratio, 3));
      }
      group.appendChild(n('title', {}, title));
      host.appendChild(group);
      return group;
    }

    // ===== Géométrie : à plat, pour pouvoir être triée par profondeur =====
    var bodies = [];
    function body(element, depth) {
      if (!element) return;
      stamp(element);
      // Une pièce qui se nomme déjà garde son propre nom : celui de l'étage ne
      // vient qu'à défaut. Le poser par-dessus faisait dire « Étage 2 · Droit »
      // à une roue qui savait dire de quel corps elle est solidaire.
      if (!element.querySelector('title')) element.appendChild(n('title', {}, title));
      bodies.push({ el: element, depth: finite(depth, 0) });
    }
    entry.links.forEach(function (link) {
      // Une courroie n'est pas UNE pièce à une profondeur : ses deux brins et
      // ses deux arcs vivent à des profondeurs différentes, et c'est ce qui
      // lui permet de passer derrière la roue qui porte sa poulie puis devant
      // la suivante. Chaque portion prend donc sa place dans le tri.
      self._drawLink(link, entry).forEach(function (piece) { body(piece.el, piece.depth); });
    });
    if (entry.carrier) body(this._drawCarrier(entry), entry.carrier.depth);
    entry.wheels.forEach(function (wheel) { body(self._buildWheel(wheel, entry), wheel.depth); });

    // ===== Commentaires d'ingénierie =====
    var engineering = stageGroup(layers.engineering, 'stage-overlay', false);
    var meshOverlay = n('g', { class: 'mesh-overlay' });
    engineering.appendChild(meshOverlay);
    this._meshOverlays.push({ entry: entry, host: meshOverlay, lod: -1 });
    // Les efforts s'appliquent AU POINT PRIMITIF, dans le repère de
    // l'engrènement : le modèle le donne, le renderer ne l'invente plus.
    if (entry.forceFrame) {
      GearForceOverlay.render(n, engineering, mech.forces,
        { x: entry.forceFrame.origin[0], y: entry.forceFrame.origin[1] }, entry.forceFrame);
    }

    // ===== Annotations =====
    var annotation = stageGroup(layers.annotation, 'train-stage', true);
    // Les badges d'alerte se posent AU-DESSUS de l'étage, jamais sur les
    // dentures : ils signalent sans masquer ce qu'ils commentent.
    var top = entry.wheels.reduce(function (best, wheel) {
      return Math.min(best, finite(wheel.cy, 0) - finite(wheel.outsideD, 20) / 2);
    }, Infinity);
    var middle = entry.wheels.reduce(function (sum, wheel) { return sum + finite(wheel.cx, 0); }, 0) / (entry.wheels.length || 1);
    // Les alertes viennent du moteur, pas d'un calcul local : le dessin dit
    // exactement ce que dit l'analyse.
    GearWarningOverlay.render(n, annotation, (this.solution || {}).warnings, index,
      { x: middle, y: Number.isFinite(top) ? top : 0 },
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
    annotation.appendChild(decor);
    return bodies;
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
    // Deux groupes, et deux règles.
    //
    // `construction` porte de la GÉOMÉTRIE — surfaces primitives, de tête, de
    // pied, hachures de bâti. Elle suit la pièce, exactement comme son corps.
    // `annotation` porte ce qui doit rester LISIBLE — les textes —, et se
    // contre-tourne pour cela. Les deux vivaient dans un seul groupe
    // contre-tourné : la géométrie y prenait donc une orientation que la pièce
    // n'a pas, et les cercles de construction se retrouvaient tournés à
    // l'envers de l'ellipse qu'ils étaient censés épouser.
    var construction = n('g', { class: 'construction' });
    seat.appendChild(construction);
    var annotation = n('g', { class: 'wheel-annotation' });
    if (Number.isFinite(wheel.axisAngleDeg) && wheel.axisAngleDeg) {
      annotation.setAttribute('transform', 'rotate(' + (-wheel.axisAngleDeg).toFixed(2) + ')');
    }
    seat.appendChild(annotation);

    // §9, §10 : la scène nomme déjà l'organe ET sa fonction. Le renderer n'en
    // garde pas de copie, et n'affiche plus « S » tout court : « Solaire (S) ·
    // Entrée » dit à la fois de quel organe il s'agit et ce qu'il fait.
    seat.appendChild(n('title', {}, memberTitle(wheel) +
      (wheel.teeth ? ' — Z=' + wheel.teeth : '') +
      '\nØ primitif ' + fmt(wheel.pitchD, 2) + ' mm' +
      (wheel.kind === 'gear' ? '\nØ tête ' + fmt(wheel.outsideD, 2) + ' mm · Ø pied ' + fmt(wheel.rootD, 2) + ' mm' : '') +
      '\nVitesse relative ' + fmt(wheel.speed, 3) + '×' +
      this._solidarity(wheel)));

    var phase = null;

    // Un organe vu autrement que de face ne peut pas tourner dans le plan du
    // dessin : son corps reste fixe, et c'est un repère de phase qui porte le
    // mouvement. Il suit la projection du cercle décrit par un point de la
    // surface primitive — cercle de face, ellipse obliquement, segment par la
    // tranche. Le faire tourner comme un disque, c'était affirmer que toute
    // roue est vue de face, ce que le dessin ne suppose plus depuis longtemps.
    // Une vis porte déjà sa phase dans ses filets, qui défilent : lui ajouter
    // un repère revenait à poser sur le dessin une puce que rien n'anime.
    if (wheel.presentation && wheel.presentation !== 'face' && wheel.kind !== 'rack' && wheel.kind !== 'worm') {
      phase = n('g', { class: 'phase-mark' });
      phase.appendChild(n('circle', { class: 'phase-dot', cx: '0', cy: '0',
        r: Math.max(0.5, finite(wheel.module, 1) * 0.7).toFixed(2) }));
      seat.appendChild(phase);
    }

    var record = { wheel: wheel, entry: entry, group: host, seat: seat, rotor: rotor,
      construction: construction, annotation: annotation, orbit: orbit, phase: phase, lod: -1 };
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
    record.annotation.textContent = '';
    // La PRÉSENTATION vient du modèle spatial, pas d'une supposition : une roue
    // n'est un disque que lorsque son axe pointe vers l'œil. Le dessin faisait
    // partout l'hypothèse inverse, ce qui interdisait de montrer un engrenage et
    // une vis sur le même arbre.
    var built = GearTeethPrimitives.build(record.wheel, { lod: lod,
      presentation: record.wheel.presentation, foreshortening: record.wheel.foreshortening,
      // L'ellipse apparente vient de ProjectedScene : le corps, les surfaces de
      // construction et la courroie décrivent ainsi le MÊME cercle projeté.
      apparent: record.wheel.apparent, style: this.style });
    appendAll(record.rotor, built.rotor);
    // La représentation conventionnelle porte DÉJÀ les surfaces : y superposer
    // les cercles de construction doublerait chaque trait.
    if (!built.conventional) {
      appendAll(record.construction, GearTeethOverlay.surfaces(record.wheel, lod,
        { presentation: record.wheel.presentation, apparent: record.wheel.apparent }));
    }
    appendAll(record.construction, built.fixed);
    appendAll(record.annotation, built.upright);
    // Les textes portés par la roue sont plafonnés à la taille d'écran commune :
    // ils restent proportionnés à la roue, sans jamais devenir illisibles.
    if (Number.isFinite(this._fontSize)) {
      var cap = this._fontSize;
      Array.prototype.forEach.call(record.annotation.querySelectorAll('text'), function (text) {
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

  /**
   * Les bras du porte-satellites, à l'angle où il se trouve.
   *
   * Ils étaient tracés en `cos(a)·orbite / sin(a)·orbite` : un cercle d'écran,
   * qui ignorait la base d'orbite que le modèle spatial fournit pourtant. Vus
   * de biais, les bras d'un porte-satellites parcourent une ellipse, et vus par
   * la tranche ils se replient sur un segment — un `rotate()` d'écran ne sait
   * représenter ni l'un ni l'autre.
   */
  TrainRenderer.prototype._carrierArms = function (carrier, angleDeg) {
    var theta = finite(angleDeg, 0) * Math.PI / 180;
    var orbit = finite(carrier.orbit, 0), d = '';
    for (var i = 0; i < carrier.count; i++) {
      var a = 2 * Math.PI * i / carrier.count + theta;
      var point = carrier.basis
        ? GearProjectedScene.phasePoint(carrier.basis, orbit, a)
        : [Math.cos(a) * orbit, Math.sin(a) * orbit];
      d += ' M 0 0 L ' + point[0].toFixed(2) + ' ' + point[1].toFixed(2);
    }
    return d.trim();
  };

  /**
   * Les bras du porte-satellites, à l'angle où il se trouve.
   *
   * Ils étaient tracés en `cos(a)·orbite / sin(a)·orbite` : un cercle d'écran,
   * qui ignorait la base d'orbite que le modèle spatial fournit pourtant. Vus
   * de biais, les bras d'un porte-satellites parcourent une ellipse, et vus par
   * la tranche ils se replient sur un segment — un `rotate()` d'écran ne sait
   * représenter ni l'un ni l'autre.
   */
  TrainRenderer.prototype._carrierArms = function (carrier, angleDeg) {
    var theta = finite(angleDeg, 0) * Math.PI / 180;
    var orbit = finite(carrier.orbit, 0), d = '';
    for (var i = 0; i < carrier.count; i++) {
      var a = 2 * Math.PI * i / carrier.count + theta;
      var point = carrier.basis
        ? GearProjectedScene.phasePoint(carrier.basis, orbit, a)
        : [Math.cos(a) * orbit, Math.sin(a) * orbit];
      d += ' M 0 0 L ' + point[0].toFixed(2) + ' ' + point[1].toFixed(2);
    }
    return d.trim();
  };

  /** Porte-satellites : bras reliant le centre à chaque satellite. */
  TrainRenderer.prototype._drawCarrier = function (entry) {
    var carrier = entry.carrier;
    var host = n('g', { class: 'planet-carrier' });
    if (carrier.bodyId) host.setAttribute('data-body', carrier.bodyId);
    if (carrier.memberId) host.setAttribute('data-member', carrier.memberId);
    var arms = n('g', { class: 'carrier-arms', transform: 'translate(' + carrier.cx.toFixed(2) + ' ' + carrier.cy.toFixed(2) + ')' });
    var spokes = n('path', { d: this._carrierArms(carrier, 0) });
    arms.appendChild(spokes);
    arms.appendChild(n('circle', { class: 'carrier-hub', r: Math.max(1.5, carrier.orbit * 0.12).toFixed(2) }));
    host.appendChild(arms);
    // §18 : un porte-satellites bloqué est un bâti. Les hachures se posent sur
    // le groupe FIXE, pas sur les bras — c'est justement qu'ils ne tournent pas.
    if (carrier.functionalRole === 'fixed') {
      appendAll(host, GearGroundSymbol.ring(carrier.cx, carrier.cy,
        Math.max(2, carrier.orbit * 0.28), { length: Math.max(1.5, carrier.orbit * 0.14) }));
    }
    entry.carrierElement = arms;
    entry.carrierSpokes = spokes;
    return host;
  };

  /** _drawLink(link, entry) → les morceaux à poser, chacun à sa profondeur. */
  TrainRenderer.prototype._drawLink = function (link, entry) {
    var pieces = [];
    var middle = entry.wheels.reduce(function (sum, wheel) {
      return sum + finite(wheel.depth, 0) / (entry.wheels.length || 1);
    }, 0);
    if (link.kind === 'belt-span' || link.kind === 'chain-span') {
      var cls = link.kind === 'belt-span' ? 'belt-line' : 'chain-line';
      var strands = [];
      var parts = link.geometry && link.geometry.parts;
      if (parts && parts.length) {
        parts.forEach(function (part) {
          var piece = n('path', { class: cls + ' belt-part', d: part.d, 'data-part': part.kind });
          strands.push({ el: piece, start: part.start });
          pieces.push({ el: piece, depth: part.depth });
        });
      } else {
        // Géométrie dégénérée : on garde deux brins finis plutôt qu'un NaN.
        var fallback = link.outline ||
          ('M ' + link.x1 + ' ' + (link.y1 - link.r1) + ' L ' + link.x2 + ' ' + (link.y2 - link.r2) +
           ' M ' + link.x1 + ' ' + (link.y1 + link.r1) + ' L ' + link.x2 + ' ' + (link.y2 + link.r2));
        var whole = n('path', { class: cls, d: fallback });
        strands.push({ el: whole, start: 0 });
        pieces.push({ el: whole, depth: middle });
      }
      // Un porteur de marqueurs PAR PORTION, à la profondeur de celle-ci : une
      // dent de courroie doit disparaître avec le brin qu'elle suit, et non
      // flotter devant la roue qui cache pourtant ce brin.
      var markers = (parts && parts.length ? parts : [{ depth: middle }]).map(function (part) {
        var host = n('g', { class: link.kind === 'belt-span' ? 'belt-markers' : 'chain-markers' });
        pieces.push({ el: host, depth: part.depth });
        return { host: host, start: part.start || 0, length: part.length || Infinity };
      });
      this._flexible.push({ link: link, entry: entry, strands: strands, markers: markers, built: 0 });
    } else if (link.kind === 'bevel-axes') {
      // Les deux axes se coupent au sommet commun des cônes. Leurs directions
      // ne sont plus déduites de l'angle d'arbre — elles viennent du modèle
      // spatial, qui les a projetées : un renvoi à 60° se dessine à 60°.
      var host = n('g', { class: 'stage-axes' });
      var span = finite(link.span, 40);
      [link.inAlong, link.outAlong].forEach(function (along) {
        if (!along || !Math.hypot(along[0], along[1])) return;
        host.appendChild(n('path', { class: 'stage-axis',
          d: 'M ' + (link.x - along[0] * span).toFixed(2) + ' ' + (link.y - along[1] * span).toFixed(2) +
            ' L ' + (link.x + along[0] * span).toFixed(2) + ' ' + (link.y + along[1] * span).toFixed(2) }));
      });
      host.appendChild(n('circle', { class: 'cone-apex-point', cx: link.x.toFixed(2), cy: link.y.toFixed(2), r: 1.2 }));
      pieces.push({ el: host, depth: middle });
    }
    return pieces;
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
    record.markers.forEach(function (group) { group.host.textContent = ''; });
    record.marks = [];
    if (lod <= LEVELS.SILHOUETTE || !link.geometry || !(link.length > 0)) return;
    var pitch = Math.max(1.5, finite(link.pitch, 4));
    var count = Math.min(lod === LEVELS.SIMPLIFIED ? 32 : 90, Math.max(6, Math.round(link.length / pitch)));
    var chain = link.kind === 'chain-span';
    for (var i = 0; i < count; i++) {
      var mark = chain
        ? n('circle', { class: 'chain-link', r: Math.max(0.6, pitch * 0.18).toFixed(2) })
        : n('rect', { class: 'belt-tooth', x: (-pitch * 0.18).toFixed(2), y: (-pitch * 0.22).toFixed(2),
          width: (pitch * 0.36).toFixed(2), height: (pitch * 0.44).toFixed(2) });
      record.markers[0].host.appendChild(mark);
      record.marks.push({ el: mark, s: link.length * i / count, host: 0 });
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

  /**
   * ENTRÉE et SORTIE, LE LONG DE LEUR ARBRE.
   *
   * Les deux flèches étaient toujours horizontales — l'une à gauche de sa
   * roue, l'autre à droite — quelle que soit la direction réelle des arbres.
   * En iso, deux flèches horizontales désignaient donc des arbres obliques :
   * le lecteur ne pouvait plus dire par où le couple entre.
   *
   * La flèche suit maintenant la projection de l'arbre qui porte l'organe, et
   * pointe vers l'extérieur du mécanisme pour la sortie, vers lui pour
   * l'entrée. Le TEXTE, lui, reste horizontal : c'est une annotation d'écran,
   * pas une géométrie, et un mot couché à 30° ne se lit plus.
   */
  TrainRenderer.prototype._drawIOChips = function (viewport, model) {
    if (!model.io.input || !model.io.output) return;
    // Le centre du dessin : il dit de quel côté d'une roue se trouve le
    // dehors, et donc dans quel sens poser la flèche sur son arbre.
    var middle = (model.wheels || []).reduce(function (sum, wheel) {
      return [sum[0] + finite(wheel.cx, 0) / model.wheels.length,
        sum[1] + finite(wheel.cy, 0) / model.wheels.length];
    }, [0, 0]);

    function alongOf(wheel) {
      var carrier = (model.shafts || []).filter(function (shaft) {
        return shaft.memberIds.indexOf(wheel.memberId) >= 0;
      })[0];
      var along = carrier && carrier.along ? carrier.along : null;
      // Arbre vu en bout : il n'a plus de direction à l'écran. La flèche
      // reprend alors l'horizontale, faute de mieux — et parce qu'une flèche
      // de longueur nulle ne désignerait rien.
      if (!along || Math.hypot(along[0], along[1]) < 1e-9) return null;
      var outward = (finite(wheel.cx, 0) - middle[0]) * along[0] + (finite(wheel.cy, 0) - middle[1]) * along[1];
      var sign = Math.abs(outward) < 1e-9 ? 1 : Math.sign(outward);
      return [along[0] * sign, along[1] * sign];
    }

    function chip(cls, text, wheel, side) {
      // chipR : rayon d'évitement (la couronne entière pour un planétaire).
      var r = finite(wheel.chipR, finite(wheel.outsideD, 20) / 2);
      var cx = finite(wheel.cx, 0), cy = finite(wheel.cy, 0);
      var away = alongOf(wheel) || [side === 'in' ? -1 : 1, 0];
      var near = side === 'in' ? r + 6 : r + 5;
      var far = side === 'in' ? r + 16 : r + 15;
      // L'entrée pointe VERS la roue, la sortie s'en éloigne.
      var tail = side === 'in' ? far : near;
      var head = side === 'in' ? near : far;
      var g = n('g', { class: 'io-chip ' + cls, 'data-along': away[0].toFixed(4) + ',' + away[1].toFixed(4) });
      var from = [cx + away[0] * tail, cy + away[1] * tail];
      var to = [cx + away[0] * head, cy + away[1] * head];
      var back = [from[0] - to[0], from[1] - to[1]];
      var span = Math.hypot(back[0], back[1]) || 1;
      var unit = [back[0] / span, back[1] / span];
      var wing = [-unit[1], unit[0]];
      g.appendChild(n('path', { class: 'io-arrow',
        d: 'M ' + from[0].toFixed(2) + ' ' + from[1].toFixed(2) +
           ' L ' + to[0].toFixed(2) + ' ' + to[1].toFixed(2) +
           ' M ' + (to[0] + unit[0] * 4 + wing[0] * 3).toFixed(2) + ' ' + (to[1] + unit[1] * 4 + wing[1] * 3).toFixed(2) +
           ' L ' + to[0].toFixed(2) + ' ' + to[1].toFixed(2) +
           ' L ' + (to[0] + unit[0] * 4 - wing[0] * 3).toFixed(2) + ' ' + (to[1] + unit[1] * 4 - wing[1] * 3).toFixed(2) }));
      var label = [cx + away[0] * (far + 4), cy + away[1] * (far + 4)];
      g.appendChild(n('text', { x: label[0].toFixed(2), y: label[1].toFixed(2),
        'text-anchor': away[0] < -1e-6 ? 'end' : 'start', dy: '0.34em' }, text));
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
    var self = this;
    labels.forEach(function (label, i) {
      // L'étiquette vit dans le calque d'annotations : la boîte de son groupe
      // ne dirait donc plus que la taille du texte. Elle vient du MODÈLE — les
      // pièces de l'étage —, ce qui est de toute façon ce qu'elle désigne.
      var stageBox = self._stageBox(Number(label.dataset.labelStage)) || bbox;
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
      // La ligne d'action se lit dans le plan de l'engrènement, vu de face.
      // C'est TeethOverlay qui refuse maintenant de la construire ailleurs :
      // le filtre était ici, il ne couvrait que la tranche, et laissait donc
      // passer les vues obliques — où un angle d'écran de 20° ne représente
      // aucun angle de pression.
      appendAll(record.host, GearTeethOverlay.mesh(record.entry, lod));
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
    var self = this;
    var members = pose.members || {}, linear = pose.linear || {}, flexible = pose.flexible || {};
    function angleOf(id) { var m = members[id]; return m && Number.isFinite(m.angle) ? m.angle : 0; }

    this._wheels.forEach(function (record) {
      var wheel = record.wheel;
      var posed = members[wheel.memberId] || {};
      var own = finite(posed.angle, 0);
      if (record.orbit) {
        // Satellite : l'orbite était un `rotate(angle cx cy)` d'écran, qui fait
        // décrire un CERCLE au satellite. Vue de biais, une orbite est une
        // ellipse, et vue par la tranche un va-et-vient sur un segment : le
        // satellite quittait donc son plan dès qu'on changeait de point de vue.
        // Sa place vient maintenant de la base d'orbite, comme sa phase.
        var theta = finite(wheel.phase, 0) + finite(posed.orbitAngle, 0) * Math.PI / 180;
        var radius = finite(wheel.orbit, 0);
        var seat = wheel.orbitBasis
          ? GearProjectedScene.phasePoint(wheel.orbitBasis, radius, theta)
          : [Math.cos(theta) * radius, Math.sin(theta) * radius];
        record.seat.setAttribute('transform',
          'translate(' + (finite(wheel.orbitCenterX, 0) + seat[0]).toFixed(2) + ' ' +
          (finite(wheel.orbitCenterY, 0) + seat[1]).toFixed(2) + ')');
        // La rotation propre est comptée dans le repère fixe, et le groupe
        // parent ne tourne plus : il n'y a donc plus rien à en retrancher.
        self._spin(record, own);
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
      if (wheel.kind === 'worm' && wheel.presentation !== 'face') {
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
      self._spin(record, own);
    });

    (this.model && this.model.stages || []).forEach(function (entry) {
      // Les bras suivent la même base que les satellites qu'ils portent : ils
      // sont retracés à leur angle, jamais tournés dans le plan de l'écran.
      if (entry.carrierSpokes && entry.carrier) {
        entry.carrierSpokes.setAttribute('d', self._carrierArms(entry.carrier, angleOf(entry.carrier.memberId)));
      }
    });

    this._flexible.forEach(function (record) {
      var link = record.link;
      // Défilement en millimètres réels issu de la pose : aucun produit
      // rayon × vitesse n'est refait ici.
      var offset = finite((flexible[link.driveId] || {}).offset, 0);
      if (record.marks && link.geometry) {
        var length = finite(link.length, 0);
        record.marks.forEach(function (mark) {
          // La portion sur laquelle ce marqueur se trouve à cet instant : c'est
          // elle qui dit s'il passe devant ou derrière une pièce voisine.
          if (length > 0 && record.markers.length > 1) {
            var s = ((mark.s + offset) % length + length) % length;
            var host = 0;
            for (var i = 0; i < record.markers.length; i++) {
              if (s >= record.markers[i].start) host = i;
            }
            if (host !== mark.host) { record.markers[host].host.appendChild(mark.el); mark.host = host; }
          }
          // L'abscisse est comptée sur la courroie RÉELLE, en millimètres :
          // c'est le plan de courroie qui transporte ensuite le point à
          // l'écran. Un maillon ne parcourt donc pas un tracé d'écran, dont la
          // longueur change avec le point de vue.
          var point = link.geometry.point(mark.s + offset);
          if (point) mark.el.setAttribute('transform', 'translate(' + point[0].toFixed(2) + ' ' + point[1].toFixed(2) + ')');
        });
      }
      // Le motif reste continu d'une portion à l'autre : chaque morceau décale
      // sa phase de son abscisse de départ sur la courroie.
      (record.strands || []).forEach(function (strand) {
        strand.el.setAttribute('stroke-dashoffset', (strand.start - offset).toFixed(1));
      });
    });
  };

  /**
   * La rotation d'un organe, telle qu'on la VOIT.
   *
   * Le renderer appliquait `rotate(angle)` à toute roue sans exception. Sur une
   * roue vue par la tranche — dessinée en rectangle de largeur b — cela faisait
   * basculer le rectangle en diagonale : mécaniquement absurde, et d'autant
   * plus visible que le modèle spatial place désormais correctement les
   * organes de profil.
   *
   * Trois cas, une seule source :
   *
   *   de face      le disque tourne réellement dans le plan, dans le sens que
   *                le repère projeté donne — vue de l'autre bout, une roue
   *                tourne à l'écran dans l'autre sens ;
   *   de profil    le corps ne bouge pas ; un repère de phase va et vient le
   *                long du segment que devient le cercle primitif ;
   *   obliquement  le corps ne bouge pas ; le repère suit l'ellipse.
   *
   * Les deux derniers cas sont la même formule, et c'est la projection qui
   * décide de laquelle il s'agit.
   */
  TrainRenderer.prototype._spin = function (record, angle) {
    var wheel = record.wheel;
    var theta = finite(angle, 0) * Math.PI / 180;
    if (wheel.presentation === 'face' || !wheel.phaseBasis) {
      // `spin` porte le côté : sans lui, les deux extrémités d'un réducteur
      // tourneraient dans le même sens à l'écran.
      var sense = wheel.phaseBasis && wheel.phaseBasis.spin ? wheel.phaseBasis.spin : 1;
      record.rotor.setAttribute('transform', 'rotate(' + (finite(angle, 0) * sense).toFixed(2) + ')');
      return;
    }
    record.rotor.removeAttribute('transform');
    if (!record.phase) return;
    var point = GearProjectedScene.phasePoint(wheel.phaseBasis, finite(wheel.pitchD, 20) / 2, theta);
    record.phase.setAttribute('transform', 'translate(' + point[0].toFixed(2) + ' ' + point[1].toFixed(2) + ')');
    // Devant ou derrière : un repère qui passe de l'autre côté de l'organe
    // s'estompe, faute de quoi rien ne distingue l'aller du retour.
    record.phase.setAttribute('opacity', Math.cos(theta) >= 0 ? '1' : '0.35');
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
    // Tous les calques : cliquer une pièce, sa flèche d'effort ou son libellé
    // désigne le même étage.
    Array.from(this.svg.querySelectorAll('[data-stage]')).forEach(function (group) {
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
    if (!this.svg) return null;
    // La géométrie d'abord : c'est elle qu'on veut cadrer ou faire défiler.
    return this.svg.querySelector('.geometry-layer [data-stage="' + index + '"]') ||
      this.svg.querySelector('[data-stage="' + index + '"]');
  };

  TrainRenderer.prototype.selectStage = function (index, silent) {
    if (!this.svg) return;
    this._selected = index;
    Array.from(this.svg.querySelectorAll('[data-stage]')).forEach(function (group) {
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
  /**
   * L'encombrement DESSINÉ d'un étage, lu sur le modèle.
   *
   * Le mesurer sur le DOM revenait à mesurer aussi son étiquette, posée en
   * marge du dessin entier : le double-clic ne rapprochait alors de rien. Et
   * depuis que les pièces sont réparties par profondeur, un étage n'a même
   * plus de groupe géométrique à mesurer.
   */
  TrainRenderer.prototype._stageBox = function (index) {
    var entry = this.model && this.model.stages && this.model.stages[index];
    if (!entry || !entry.wheels.length) return null;
    // En vue dépliée, rien ne se raccourcit ; en projection, ce qui suit l'axe
    // se réduit du sinus de l'angle de l'axe sur le regard.
    var unfolded = this.model.mode === 'unfolded';
    var box = null;
    entry.wheels.forEach(function (wheel) {
      var radius = Math.max(finite(wheel.outsideD, 0), finite(wheel.pitchD, 0)) / 2;
      var half, across;
      if (!wheel.apparent || wheel.kind === 'rack') {
        // Une crémaillère occupe sa course, qui n'a rien d'un diamètre.
        half = across = Math.max(finite(wheel.length, 0) / 2, radius, 2);
      } else {
        // L'encombrement DESSINÉ d'un cylindre : son ellipse apparente balayée
        // le long de l'axe projeté. Le mesurer au diamètre dans les deux
        // directions donnait une boîte trop grande d'un organe vu par la
        // tranche, et un cadrage qui laissait du vide autour de lui.
        var axial = unfolded ? 1 : Math.sqrt(Math.max(0, 1 - wheel.apparent.minor * wheel.apparent.minor));
        half = Math.max(finite(wheel.faceWidth, 0) / 2 * axial + radius * wheel.apparent.minor, 2);
        across = Math.max(radius * wheel.apparent.major, 2);
      }
      var theta = finite(wheel.axisAngleDeg, 0) * Math.PI / 180;
      var cos = Math.abs(Math.cos(theta)), sin = Math.abs(Math.sin(theta));
      var reachX = cos * half + sin * across;
      var reachY = sin * half + cos * across;
      var x = finite(wheel.cx, 0), y = finite(wheel.cy, 0);
      var own = { left: x - reachX, top: y - reachY, right: x + reachX, bottom: y + reachY };
      box = box ? { left: Math.min(box.left, own.left), top: Math.min(box.top, own.top),
        right: Math.max(box.right, own.right), bottom: Math.max(box.bottom, own.bottom) } : own;
    });
    return { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top };
  };

  TrainRenderer.prototype.focusStage = function (index) {
    if (!this.viewport) return false;
    var box = this._stageBox(index);
    if (!box) return this.viewport.focusElement(this.getStageElement(index));
    this.viewport.focus(box);
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
