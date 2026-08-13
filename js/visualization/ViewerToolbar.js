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
    this.geometry = new GearApp.visualization.GeometryRenderer(container);
    this.kinematic = GearApp.visualization.kinematicRenderer;
    // Vue denture réaliste : instance longue durée (elle reconstruit son svg à
    // chaque rendu, les autres vues vidant le conteneur).
    this.teeth = new GearApp.visualization.TrainRenderer(container);
  }

  ViewerToolbar.prototype.renderer = function () {
    if (this.currentView === 'kinematic') return this.kinematic;
    if (this.currentView === 'teeth') return this.teeth;
    return this.geometry;
  };

  ViewerToolbar.prototype.render = function (solution) {
    this.solution = solution;
    // La vue denture n'a pas de sens pour le solveur linéaire (crémaillère).
    if (this.currentView === 'teeth' && solution && solution.mode === 'rotationTranslation') {
      this.setView('geometry');
      return;
    }
    return this.renderer().render(solution);
  };

  ViewerToolbar.prototype.setView = function (view) {
    this.currentView = view === 'kinematic' ? 'kinematic' : view === 'teeth' ? 'teeth' : 'geometry';
    var current = this.currentView;
    document.querySelectorAll('.view-mode').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === current);
    });
    var section = this.container.closest('.viz-section');
    if (section) section.classList.toggle('kinematic-active', this.currentView === 'kinematic');
    if (this.solution) this.render(this.solution);
  };

  ViewerToolbar.prototype.bind = function () {
    var self = this, controls = document.querySelector('.viz-controls');
    if (!controls) return;
    controls.addEventListener('click', function (event) {
      var view = event.target.closest('.view-mode');
      if (view) { self.setView(view.dataset.view); return; }
      var renderer = self.renderer();
      if (event.target.id === 'viewerAnimate' && renderer.toggleAnimation) renderer.toggleAnimation();
      if (event.target.id === 'viewerReset' && renderer.resetView) renderer.resetView();
    });
  };

  GearApp.visualization.ViewerToolbar = ViewerToolbar;
})(GearApp);
