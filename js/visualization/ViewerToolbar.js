// ViewerToolbar.js - Bascule entre les trois vues du schéma :
// géométrie 2D calculée, schéma cinématique, et denture réaliste (GearSVG,
// profil en développante avec zoom/pan/tooltips/animation).
(function (GearApp) {
  'use strict';

  function ViewerToolbar(container) {
    this.container = container;
    // La denture réaliste est la vue par défaut (le rendu linéaire retombe
    // sur la géométrie 2D via la garde de render()).
    this.currentView = 'teeth';
    this.selectedStage = -1;
    this.animationSpeed = 1;
    this.animationDirection = 1;
    this.overlays = { autoDetails: true, pitchCircles: true, dimensions: true, axes: true, envelope: false, forces: false, rpm: true, powerFlow: true, spatialAxes: true, labels: true };
    this.geometry = new GearApp.visualization.GeometryRenderer(container);
    this.kinematic = GearApp.visualization.kinematicRenderer;
    // Vue denture réaliste : instance longue durée (elle reconstruit son svg à
    // chaque rendu, les autres vues vidant le conteneur).
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
    this.inspector.setSolution(solution);
    var rendered = this.renderer().render(solution);
    if (rendered.setAnimationSpeed) rendered.setAnimationSpeed(this.animationSpeed);
    if (rendered.setAnimationDirection) rendered.setAnimationDirection(this.animationDirection);
    if (this.selectedStage >= 0 && rendered.selectStage) { rendered.selectStage(this.selectedStage, true); this.inspector.show(this.selectedStage); }
    return rendered;
  };

  ViewerToolbar.prototype.setView = function (view) {
    this.currentView = view === 'kinematic' ? 'kinematic' : view === 'teeth' ? 'teeth' : 'geometry';
    var current = this.currentView;
    document.querySelectorAll('.view-mode').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === current);
    });
    var section = this.container.closest('.viz-section');
    if (section) section.classList.toggle('kinematic-active', this.currentView === 'kinematic');
    document.querySelectorAll('#viewerDisplayMenu [data-views]').forEach(function (label) {
      label.hidden = label.dataset.views.split(' ').indexOf(current) < 0;
    });
    if (this.solution) this.render(this.solution);
    this.container.dispatchEvent(new CustomEvent('viewer:view-changed', { detail: { view: this.currentView } }));
  };

  ViewerToolbar.prototype.bind = function () {
    var self = this, controls = document.querySelector('.viz-controls');
    if (!controls) return;
    controls.addEventListener('click', function (event) {
      var view = event.target.closest('.view-mode');
      if (view) { self.setView(view.dataset.view); return; }
      var renderer = self.renderer();
      if (event.target.id === 'viewerAnimate' && renderer.toggleAnimation) renderer.toggleAnimation();
      if (event.target.id === 'viewerAnimate') {
        event.target.setAttribute('aria-pressed', String(!!(renderer.animation && renderer.animation.playing)));
        event.target.textContent = renderer.animation && renderer.animation.playing ? '❚❚' : '▶';
        self.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { playing: !!(renderer.animation && renderer.animation.playing) } }));
      }
      if (event.target.id === 'viewerReverse') {
        self.animationDirection = self.animationDirection === -1 ? 1 : -1;
        if (renderer.setAnimationDirection) renderer.setAnimationDirection(self.animationDirection);
        event.target.setAttribute('aria-pressed', String(self.animationDirection === -1));
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
      if (event.target.matches('[data-overlay]')) {
        var name = event.target.dataset.overlay;
        self.overlays[name] = event.target.checked;
        self.container.classList.toggle('hide-' + name.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }), !event.target.checked);
        self.container.dispatchEvent(new CustomEvent('viewer:overlay-changed', { detail: { overlay: name, enabled: event.target.checked, view: self.currentView } }));
      }
    });
    this.container.addEventListener('viewer:stage-selected', function (event) { self.selectedStage = event.detail.index; self.inspector.show(event.detail.index); });
  };

  GearApp.visualization.ViewerToolbar = ViewerToolbar;
})(GearApp);
