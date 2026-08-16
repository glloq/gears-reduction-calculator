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
    this.geometry = new GearApp.visualization.GeometryRenderer(container);
    this.kinematic = GearApp.visualization.kinematicRenderer;
    // Instances longue durée : chaque vue reconstruit son svg à chaque rendu.
    this.teeth = new GearApp.visualization.TrainRenderer(container);
    var self = this;
    this.inspector = new GearStageInspector.Inspector(container, {
      registry: GearTransmissionRegistry,
      onEdit: function (index) { self.container.dispatchEvent(new CustomEvent('viewer:stage-edit', { detail: { index: index } })); },
      onClose: function () { self.selectedStage = -1; }
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
    return rendered;
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
    if (this.solution) this.render(this.solution);
    this.container.dispatchEvent(new CustomEvent('viewer:view-changed', { detail: { view: name } }));
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
    if (!controls) return;
    controls.addEventListener('click', function (event) {
      var view = event.target.closest('.view-mode');
      if (view) { self.setView(view.dataset.view); return; }
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
    });
    controls.addEventListener('change', function (event) {
      if (event.target.id === 'viewerSpeed') {
        var renderer = self.renderer(), speed = Number(event.target.value);
        self.animationSpeed = speed;
        if (renderer.setAnimationSpeed) renderer.setAnimationSpeed(speed);
        self.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { speed: speed } }));
      }
      if (event.target.matches('[data-overlay]')) self.setOverlay(event.target.dataset.overlay, event.target.checked);
    });
    this.container.addEventListener('viewer:stage-selected', function (event) {
      self.selectedStage = event.detail.index;
      self.inspector.show(event.detail.index);
    });
    this._applyOverlayClasses();
  };

  ViewerToolbar.DEFAULT_OVERLAYS = DEFAULT_OVERLAYS;
  GearApp.visualization.ViewerToolbar = ViewerToolbar;
})(GearApp);
