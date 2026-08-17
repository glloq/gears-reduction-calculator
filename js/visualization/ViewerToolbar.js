// ViewerToolbar.js - Chef d'orchestre des trois vues du schéma.
//
// Il détient l'ÉTAT PARTAGÉ — vue courante, étage sélectionné, lecture et
// vitesse d'animation, overlays — et le réapplique à chaque changement de vue.
// Les renderers ne détiennent aucun de ces états : passer de Denture à
// Géométrie puis à Cinématique conserve la sélection, l'animation et les
// options d'affichage.
//
// Contrat d'évènements unique pour les trois vues :
//   viewer:stage-selected · viewer:stage-edit · viewer:view-changed
//   viewer:overlay-changed · viewer:animation-changed
(function (GearApp) {
  'use strict';

  // Overlays par vue : le menu « Affichage » n'expose que ceux qui ont un sens
  // dans la vue courante (le balisage porte data-views).
  var DEFAULT_OVERLAYS = {
    autoDetails: true, pitchCircles: true, lineOfAction: false, dimensions: true, axes: true,
    envelope: false, forces: false, rpm: true, ratios: true, powerFlow: true, spatialAxes: true, labels: true
  };

  /**
   * §3 : quatre INTENTIONS de lecture, plutôt que onze cases.
   *
   * Les overlays individuels sont un bon découpage technique — chacun a un sens
   * propre et se teste seul — mais ils font payer à l'utilisateur un travail qui
   * n'est pas le sien : décider, case par case, ce qu'il faut voir pour
   * répondre à une question. Or les questions sont peu nombreuses et connues :
   * de quoi c'est fait, comment ça bouge, quelle taille ça fait, est-ce que ça
   * tient. Chaque préréglage est la réponse d'usage à l'une d'elles.
   *
   * Un préréglage donne l'état COMPLET, pas seulement ce qu'il ajoute : sinon
   * passer de « Mécanique » à « Simple » laisserait traîner la ligne d'action —
   * exactement le piège des dispositions, déjà corrigé une fois.
   */
  var PRESETS = [
    { id: 'simple', label: 'Simple', help: 'De quoi c’est fait : les étages, l’entrée et la sortie.',
      overlays: { autoDetails: true, pitchCircles: false, lineOfAction: false, dimensions: false,
        axes: false, envelope: false, forces: false, rpm: false, ratios: true,
        powerFlow: false, spatialAxes: false, labels: true } },
    { id: 'motion', label: 'Mouvement', help: 'Comment ça bouge : sens, vitesses, chemin de la puissance.',
      overlays: { autoDetails: true, pitchCircles: false, lineOfAction: false, dimensions: false,
        axes: true, envelope: false, forces: false, rpm: true, ratios: true,
        powerFlow: true, spatialAxes: true, labels: true } },
    { id: 'sizing', label: 'Dimensionnement', help: 'Quelle taille ça fait : cotes, axes, encombrement.',
      overlays: { autoDetails: true, pitchCircles: true, lineOfAction: false, dimensions: true,
        axes: true, envelope: true, forces: false, rpm: false, ratios: false,
        powerFlow: false, spatialAxes: true, labels: true } },
    { id: 'mechanical', label: 'Mécanique', help: 'Est-ce que ça tient : efforts, contact, alertes.',
      overlays: { autoDetails: true, pitchCircles: true, lineOfAction: true, dimensions: false,
        axes: false, envelope: false, forces: true, rpm: true, ratios: false,
        powerFlow: false, spatialAxes: false, labels: true } }
  ];

  function preset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  function kebab(name) { return name.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }); }

  function ViewerToolbar(container) {
    this.container = container;
    // La denture réaliste est la vue par défaut : elle supporte désormais tous
    // les types, crémaillère comprise.
    this.currentView = 'teeth';
    this.selectedStage = -1;
    this.animationSpeed = 1;
    this.animationDirection = 1;
    this.animationPlaying = false;
    this.animationAngle = 0;
    // Cadence : 'pedagogical' (lisible, constante) ou 'relative' (proportionnelle
    // au régime réel d'entrée). Les poses sont identiques dans les deux cas.
    this.animationMode = 'pedagogical';
    this.overlays = Object.assign({}, DEFAULT_OVERLAYS);
    // Aucun préréglage actif au départ : l'état d'usine n'en est pas un, et
    // allumer un bouton qui ne décrit pas l'écran serait un mensonge de plus.
    this.preset = null;
    this.geometry = new GearApp.visualization.GeometryRenderer(container);
    this.kinematic = GearApp.visualization.kinematicRenderer;
    // Instances longue durée : chaque vue reconstruit son svg à chaque rendu.
    this.teeth = new GearApp.visualization.TrainRenderer(container);
    var self = this;
    this.inspector = new GearStageInspector.Inspector(container, {
      registry: GearTransmissionRegistry,
      onEdit: function (index) { self.container.dispatchEvent(new CustomEvent('viewer:stage-edit', { detail: { index: index } })); },
      onClose: function () { self.selectedStage = -1; self._syncFraming(); }
    });
  }

  ViewerToolbar.prototype.renderer = function () {
    if (this.currentView === 'kinematic') return this.kinematic;
    if (this.currentView === 'teeth') return this.teeth;
    return this.geometry;
  };

  ViewerToolbar.prototype.render = function (solution) {
    this.solution = solution;
    var rendered = this.renderer().render(solution);
    // L'inspecteur lit la scène de la vue courante : mêmes vitesses, même
    // instant, quelle que soit la vue affichée.
    this.inspector.setSolution(solution, rendered && rendered.scene);
    this._applyState(rendered);
    this._renderFidelity(rendered);
    this._syncZoomTier();
    this._syncFraming();
    return rendered;
  };

  /**
   * §7 : les trois cadrages disent ce qu'ils peuvent faire, à l'instant présent.
   *
   * « Cadrer l'étage » sans étage sélectionné, et « 1:1 » sur un schéma
   * symbolique, sont deux boutons qui ne peuvent pas tenir leur promesse. Les
   * laisser cliquables et sans effet serait la même faute que les cartes sans
   * effet déjà retirées ailleurs : ils se désactivent, en disant pourquoi.
   */
  ViewerToolbar.prototype._syncFraming = function () {
    var focus = document.getElementById('viewerFocus');
    if (focus) {
      var selected = this.selectedStage >= 0;
      focus.disabled = !selected;
      focus.title = selected ? 'Cadrer l’étage ' + (this.selectedStage + 1)
        : 'Sélectionnez d’abord un étage sur le dessin';
    }
    var actual = document.getElementById('viewerActualSize');
    if (actual) {
      // La Cinématique n'est pas en millimètres : « 1:1 » n'y voudrait rien dire.
      var metric = this.currentView !== 'kinematic';
      actual.disabled = !metric;
      actual.title = metric
        ? 'Échelle réelle : un millimètre dessiné occupe un millimètre d’écran'
        : 'Le schéma cinématique est symbolique : il n’a pas d’échelle réelle';
    }
    return this;
  };

  /**
   * §22, §23 : ce que la vue courante montre à l'ÉCHELLE, et ce qu'elle ne
   * fait que suggérer.
   *
   * Les trois vues n'ont pas le même statut, et rien ne le disait : la
   * Cinématique est un schéma symbolique — ses distances ne veulent rien dire
   * — tandis que la Géométrie est une vue cotée. Lire la première comme la
   * seconde, c'est mesurer un encombrement sur un dessin qui n'en porte
   * aucun. À quoi s'ajoute le cas particulier d'une solution dont le moteur
   * n'a pas fourni toutes les cotes : la scène l'a déjà noté membre par
   * membre, encore fallait-il le dire.
   */
  var FIDELITY = {
    teeth: 'Dentures et entraxes à l’échelle réelle ; la longueur des arbres est schématique.',
    geometry: 'Vue cotée : diamètres, entraxes et courses sont ceux du calcul.',
    kinematic: 'Schéma symbolique : les positions et les tailles ne sont pas à l’échelle, seuls les liens et les vitesses ont un sens.'
  };

  ViewerToolbar.prototype._renderFidelity = function (rendered) {
    var host = document.getElementById('viewerFidelity');
    if (!host) return;
    var text = FIDELITY[this.currentView] || '';
    var scene = rendered && rendered.scene;
    // Une cote reconstruite faute de mieux ne doit pas être lue comme une cote
    // calculée : la scène marque ces membres, la vue le répercute.
    var derived = scene && scene.members
      ? scene.members.filter(function (member) { return member.schematic; })
      : [];
    // §20 : cote par cote, ce qui est calculé et ce qui est reconstruit. La
    // phrase générale dit le statut de la VUE ; le détail dit celui de chaque
    // grandeur, ce qui est la question d'un ingénieur devant un plan.
    host.title = this._fidelityDetail(scene);
    if (derived.length) {
      var names = derived.map(function (member) { return member.memberName || member.role; });
      var unique = names.filter(function (name, i) { return names.indexOf(name) === i; });
      text += ' Cotes reconstruites, non calculées, pour : ' + unique.join(', ') + '.';
    }
    host.textContent = text;
    host.hidden = !text;
    host.classList.toggle('has-derived', derived.length > 0);
  };

  /** Réapplique l'état partagé à la vue qui vient d'être rendue. */
  ViewerToolbar.prototype._applyState = function (rendered) {
    if (!rendered) return;
    if (rendered.setAnimationSpeed) rendered.setAnimationSpeed(this.animationSpeed);
    if (rendered.setAnimationDirection) rendered.setAnimationDirection(this.animationDirection);
    if (rendered.setAutoDetails) rendered.setAutoDetails(this.overlays.autoDetails);
    if (rendered.setAnimationMode) rendered.setAnimationMode(this.animationMode);
    // L'animation reprend au même angle : les trois vues racontent la même
    // cinématique, au même instant.
    if (rendered.setAnimationAngle) rendered.setAnimationAngle(this.animationAngle);
    if (this.animationPlaying && rendered.animation && !rendered.animation.playing) {
      if (rendered.animation.seek) rendered.animation.seek(this.animationAngle);
      rendered.toggleAnimation();
    }
    this._applyOverlayClasses();
    if (this.selectedStage >= 0 && rendered.selectStage) {
      rendered.selectStage(this.selectedStage, true);
      this.inspector.show(this.selectedStage);
    }
  };

  /**
   * Applique un préréglage. Il pose l'état complet et devient le préréglage
   * actif ; toucher ensuite une case individuelle le quitte — l'écran ne doit
   * pas prétendre « Mécanique » quand on vient d'éteindre les efforts.
   */
  ViewerToolbar.prototype.setPreset = function (id) {
    var entry = preset(id);
    if (!entry) return this;
    this.preset = id;
    Object.keys(entry.overlays).forEach(function (name) {
      this.overlays[name] = entry.overlays[name];
    }, this);
    var renderer = this.renderer();
    if (renderer && renderer.setAutoDetails) renderer.setAutoDetails(this.overlays.autoDetails);
    this._applyOverlayClasses();
    this._syncOverlayInputs();
    this._markPreset();
    this.container.dispatchEvent(new CustomEvent('viewer:preset-changed', { detail: { preset: id } }));
    return this;
  };

  /** Les cases doivent refléter l'état : sinon elles décrivent le précédent. */
  ViewerToolbar.prototype._syncOverlayInputs = function () {
    var overlays = this.overlays;
    document.querySelectorAll('#viewerDisplayMenu [data-overlay]').forEach(function (input) {
      var wanted = !!overlays[input.dataset.overlay];
      if (input.checked !== wanted) input.checked = wanted;
    });
  };

  ViewerToolbar.prototype._markPreset = function () {
    var current = this.preset;
    document.querySelectorAll('[data-preset]').forEach(function (button) {
      var mine = button.dataset.preset === current;
      button.classList.toggle('active', mine);
      button.setAttribute('aria-pressed', String(mine));
    });
  };

  /**
   * Reporte le palier de lecture sur le conteneur. Le tracé, lui, garde sa
   * finesse calculée par roue : un seuil global se tromperait sur une roue de
   * 8 dents à côté d'une de 200.
   */
  ViewerToolbar.prototype._syncZoomTier = function () {
    var renderer = this.renderer();
    var viewport = renderer && renderer.viewport;
    var tier = viewport && viewport.zoomTier ? viewport.zoomTier() : null;
    var classes = this.container.classList;
    GearViewportController.ZOOM_TIERS.forEach(function (entry) {
      classes.toggle('zoom-' + entry.name, !!tier && tier.id === entry.id);
    });
    this.container.dataset.zoomTier = tier ? tier.name : '';
    return this;
  };

  ViewerToolbar.prototype._applyOverlayClasses = function () {
    var container = this.container, overlays = this.overlays;
    Object.keys(overlays).forEach(function (name) {
      container.classList.toggle('hide-' + kebab(name), !overlays[name]);
    });
  };

  ViewerToolbar.prototype.setView = function (view) {
    // Mémorise l'angle courant pour que la vue suivante reparte au même instant.
    var current = this.renderer();
    if (current && Number.isFinite(current._angle)) this.animationAngle = current._angle;
    if (current && current.animation && current.animation.playing) current.animation.pause();

    this.currentView = view === 'kinematic' ? 'kinematic' : view === 'teeth' ? 'teeth' : 'geometry';
    var name = this.currentView;
    document.querySelectorAll('.view-mode').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === name);
    });
    var section = this.container.closest('.viz-section');
    if (section) section.classList.toggle('kinematic-active', name === 'kinematic');
    document.querySelectorAll('#viewerDisplayMenu [data-views]').forEach(function (label) {
      label.hidden = label.dataset.views.split(' ').indexOf(name) < 0;
    });
    // Un intertitre sans ligne en dessous n'annonce rien : il se retire avec
    // elles quand la vue courante n'en propose aucune.
    document.querySelectorAll('#viewerDisplayMenu .display-menu-group').forEach(function (heading) {
      var next = heading.nextElementSibling, visible = false;
      while (next && !next.classList.contains('display-menu-group')) {
        if (!next.hidden) visible = true;
        next = next.nextElementSibling;
      }
      heading.hidden = !visible;
    });
    if (this.solution) this.render(this.solution);
    this.container.dispatchEvent(new CustomEvent('viewer:view-changed', { detail: { view: name } }));
  };

  /** Libellés des cotes, pour un détail lisible plutôt qu'un nom de champ. */
  var DIMENSION_LABELS = {
    pitchDiameter: 'Diamètre primitif', outsideDiameter: 'Diamètre extérieur',
    rootDiameter: 'Diamètre de pied', baseDiameter: 'Diamètre de base',
    centerDistance: 'Entraxe', width: 'Largeur', module: 'Module',
    teeth: 'Nombre de dents', orbitRadius: 'Rayon d’orbite',
    travelPerRevolution: 'Course par tour', coneAngleDeg: 'Angle de cône',
    leadAngleDeg: 'Angle d’avance', helixAngleDeg: 'Angle d’hélice'
  };

  /**
   * §20 : ● calculé, ○ déduit. Une cote reconstruite faute de mieux ne se lit
   * pas comme une cote calculée — sur un outil d'ingénierie, c'est la première
   * chose à savoir avant de reporter une valeur sur un plan.
   */
  ViewerToolbar.prototype._fidelityDetail = function (scene) {
    if (!scene || !scene.members) return '';
    var engine = {}, derived = {};
    scene.members.forEach(function (member) {
      Object.keys(member.provenance || {}).forEach(function (key) {
        (member.provenance[key] === 'engine' ? engine : derived)[key] = true;
      });
    });
    function list(marks, bucket) {
      return Object.keys(bucket).map(function (key) {
        return marks + ' ' + (DIMENSION_LABELS[key] || key);
      });
    }
    var lines = list('●', engine).concat(list('○', derived));
    if (!lines.length) return '';
    return '● calculé par le moteur · ○ reconstruit faute de mieux\n' + lines.join('\n');
  };

  ViewerToolbar.prototype.toggleAnimation = function () {
    var renderer = this.renderer();
    if (!renderer || !renderer.toggleAnimation) return;
    renderer.toggleAnimation();
    this.animationPlaying = !!(renderer.animation && renderer.animation.playing);
    var button = document.getElementById('viewerAnimate');
    if (button) {
      button.setAttribute('aria-pressed', String(this.animationPlaying));
      button.textContent = this.animationPlaying ? '❚❚' : '▶';
    }
    this.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { playing: this.animationPlaying } }));
  };

  ViewerToolbar.prototype.setOverlay = function (name, enabled) {
    this.overlays[name] = !!enabled;
    // Régler une case à la main quitte le préréglage : le contraire ferait
    // dire « Mécanique » à un écran dont on vient d'éteindre les efforts.
    this.preset = null;
    this._markPreset();
    this.container.classList.toggle('hide-' + kebab(name), !enabled);
    if (name === 'autoDetails') {
      var renderer = this.renderer();
      if (renderer && renderer.setAutoDetails) renderer.setAutoDetails(enabled);
    }
    this.container.dispatchEvent(new CustomEvent('viewer:overlay-changed',
      { detail: { overlay: name, enabled: !!enabled, view: this.currentView } }));
  };

  ViewerToolbar.prototype.bind = function () {
    var self = this, controls = document.querySelector('.viz-controls');
    // §4 : lire une roue au survol, tout de suite. L'information est déjà dans
    // les `<title>` ; seule sa consultation était lente.
    if (GearApp.visualization.ViewerHUD && !this.hud) {
      this.hud = new GearApp.visualization.ViewerHUD(this.container).bind();
    }
    // §2 : le palier de lecture suit le zoom, dans les trois vues. Il est porté
    // par une classe du conteneur, ce qui laisse chaque vue décider en CSS de
    // ce qu'elle montre à quel palier — sans qu'aucune n'ait à connaître les
    // seuils.
    this.container.addEventListener('viewport:changed', function () { self._syncZoomTier(); });
    if (!controls) return;
    controls.addEventListener('click', function (event) {
      var view = event.target.closest('.view-mode');
      if (view) { self.setView(view.dataset.view); return; }
      var chosen = event.target.closest('[data-preset]');
      if (chosen) { self.setPreset(chosen.dataset.preset); return; }
      var renderer = self.renderer();
      if (event.target.id === 'viewerAnimate') { self.toggleAnimation(); return; }
      if (event.target.id === 'viewerReverse') {
        self.animationDirection = self.animationDirection === -1 ? 1 : -1;
        if (renderer.setAnimationDirection) renderer.setAnimationDirection(self.animationDirection);
        event.target.setAttribute('aria-pressed', String(self.animationDirection === -1));
        self.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { direction: self.animationDirection } }));
      }
      if (event.target.id === 'viewerMode') {
        self.animationMode = self.animationMode === 'relative' ? 'pedagogical' : 'relative';
        if (renderer.setAnimationMode) renderer.setAnimationMode(self.animationMode);
        event.target.setAttribute('aria-pressed', String(self.animationMode === 'relative'));
        event.target.textContent = self.animationMode === 'relative' ? 'Cadence réelle' : 'Cadence pédagogique';
        self.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { mode: self.animationMode } }));
      }
      if (event.target.id === 'viewerReset' && renderer.resetView) renderer.resetView();
      if (event.target.id === 'viewerFocus' && renderer.focusStage) renderer.focusStage(self.selectedStage);
      if (event.target.id === 'viewerActualSize' && renderer.viewport) renderer.viewport.actualSize();
    });
    controls.addEventListener('change', function (event) {
      if (event.target.id === 'viewerSpeed') {
        var renderer = self.renderer(), speed = Number(event.target.value);
        self.animationSpeed = speed;
        if (renderer.setAnimationSpeed) renderer.setAnimationSpeed(speed);
        // Le résumé du menu porte la vitesse : une seule commande visible en
        // permanence, sans perdre l'information.
        var summary = document.querySelector('#viewerAnimationMenu > summary');
        if (summary) summary.textContent = event.target.options[event.target.selectedIndex].textContent;
        self.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { speed: speed } }));
      }
      if (event.target.matches('[data-overlay]')) self.setOverlay(event.target.dataset.overlay, event.target.checked);
    });
    this.container.addEventListener('viewer:stage-selected', function (event) {
      self.selectedStage = event.detail.index;
      self.inspector.show(event.detail.index);
      self._syncFraming();
    });
    this._applyOverlayClasses();
  };

  ViewerToolbar.DEFAULT_OVERLAYS = DEFAULT_OVERLAYS;
  ViewerToolbar.PRESETS = PRESETS;
  ViewerToolbar.preset = preset;
  GearApp.visualization.ViewerToolbar = ViewerToolbar;
})(GearApp);
