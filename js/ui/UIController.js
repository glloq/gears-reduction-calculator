// UIController.js - Orchestrateur UI principal
// Coordonne tous les sous-composants UI via EventBus

(function (GearApp) {

  /**
   * Une valeur de service peut être NON RENSEIGNÉE : une chaîne analysée sans
   * régime n'a ni vitesse de sortie ni couple. `toFixed` sur un `null` faisait
   * tomber la carte entière, et avec elle tout ce qui suivait dans la page.
   */
  function num(value, digits, unit) {
    return (Number.isFinite(value) ? value.toFixed(digits) : '—') + (unit || '');
  }

  function UIController(eventBus) {
    this._eventBus = eventBus || GearApp.eventBus;
    this.logger = new GearApp.ui.Logger('logs', 'status');
    this.resultsTable = new GearApp.ui.ResultsTable('resultats', this._eventBus);
    this.mechanicalPanel = new GearApp.ui.MechanicalPanel('mechanicalPanel');
    this.paramForm = new GearApp.ui.ParameterForm();
    this.exportManager = new GearApp.ui.ExportManager();

    this._gearSvg = null;
    this._legacySchema = null;
    this._charts = null;
    this._viewer = null;

    this._bindEvents();
    var controller=this,visualContainer=document.getElementById('svgContainer');if(visualContainer){visualContainer.addEventListener('visualization:renderer',function(event){controller.exportManager.setRenderer(event.detail.renderer);});
    // Sélection d'un étage dans le schéma (denture ou cinématique) :
    // surligne la ligne correspondante du panneau mécanique et focalise la
    // ligne de l'éditeur.
    function onStageSelected(event){controller._syncMechanicalRow(event.detail.index);controller._eventBus.emit('editor:focus-stage',{stage:event.detail.index});}
    visualContainer.addEventListener('viewer:stage-selected',onStageSelected);
    // Double-clic / bouton « Modifier cet étage » : ouvre l'onglet éditeur puis
    // focalise la ligne (dans un rAF, l'onglet doit être visible pour scroller).
    visualContainer.addEventListener('viewer:stage-edit',function(event){
      var tab=document.querySelector('.detail-tabs [data-detail="editeur"]');
      if(tab)tab.click();
      requestAnimationFrame(function(){controller._eventBus.emit('editor:focus-stage',{stage:event.detail.index});});
    });}
  }

  UIController.prototype.setVisualizationComponents = function (gearSvg, legacySchema, charts) {
    this._gearSvg = gearSvg;
    this._legacySchema = legacySchema;
    this._charts = charts;
    this.exportManager.setRenderer(gearSvg);
  };

  UIController.prototype._bindEvents = function () {
    var self = this;

    this._eventBus.on('search:log', function (data) {
      self.logger.log(data.message);
    });

    this._eventBus.on('search:progress', function (data) {
      var bar = document.getElementById('progress-bar');
      if (bar) {
        bar.style.width = data.percent + '%';
        var container = bar.parentElement;
        if (container) container.setAttribute('aria-valuenow', Math.round(data.percent));
      }
    });

    this._eventBus.on('search:stats', function (stats) {
      self._lastStats = stats;
      var element = document.getElementById('searchStats'); if (!element) return;
      var rejected = stats.rejections || {}, ratio = Number.isFinite(stats.currentRatio) ? stats.currentRatio.toFixed(3) : '—';
      element.innerHTML = '<strong>Branches :</strong> ' + (stats.tested || 0) +
        ' · <strong>Profondeur :</strong> ' + (stats.depth || 0) +
        ' · <strong>Rapport courant :</strong> ' + ratio +
        ' · <strong>Valides :</strong> ' + (stats.valid || 0) +
        ' · <strong>Rejets :</strong> ratio ' + (rejected.ratio || 0) +
        ', géométrie ' + (rejected.geometry || 0) + ', dimensions ' + (rejected.dimensions || 0) +
        ', mécanique ' + (rejected.mechanics || 0) + ', fabrication ' + (rejected.manufacturing || 0) +
        ' · <strong>Temps :</strong> ' + ((stats.elapsedMs || 0) / 1000).toFixed(2) + ' s';
    });

    this._eventBus.on('solution:selected', function (data) {
      self._onSolutionSelected(data.index, data.solution);
    });

    this._eventBus.on('search:partial', function (data) {
      if (data.solutions && data.solutions.length > 0) {
        self._eventBus.emit('search:log', {
          message: data.totalSolutions + ' solutions en cours... affichage partiel.'
        });
        self.resultsTable.display(data.solutions, self._lastSearchParams);
      }
    });
  };

  UIController.prototype.afficherResultats = function (solutions, searchParams) {
    this._lastSearchParams = searchParams;
    this.resultsTable.display(solutions, searchParams);

    if (solutions.length === 0) {
      this.clearDetail();
      return;
    }

    this._updateComparisonCharts(solutions, searchParams);
    // Le premier résultat est immédiatement exploitable : résumé,
    // visualisation, analyse mécanique et graphiques restent synchronisés.
    this._eventBus.emit('solution:selected', { index: 0, solution: solutions[0] });
  };

  // Statistiques de la dernière recherche (payload search:stats le plus récent).
  UIController.prototype.lastStats = function () { return this._lastStats || null; };

  // Graphiques calculés sur le vivier complet (appelé par SolutionExplorer à
  // chaque nouvelle recherche, jamais pendant l'affinage).
  UIController.prototype.updatePoolCharts = function (solutions, searchParams) {
    this._lastSearchParams = searchParams;
    this._updateComparisonCharts(solutions, searchParams);
  };

  UIController.prototype.clearDetail = function () {
    this.mechanicalPanel.hide();
    this._hideSolutionCard();
  };

  // Source unique du surlignage de ligne du panneau mécanique : dé-sélectionne
  // toujours la ligne précédente (l'ancien code cinématique ne le faisait pas).
  UIController.prototype._syncMechanicalRow = function (index) {
    var panel = document.getElementById('mechanicalPanel');
    if (!panel) return;
    panel.querySelectorAll('tr.selected').forEach(function (row) { row.classList.remove('selected'); });
    var row = document.getElementById('mechanical-stage-' + index);
    if (row) {
      row.classList.add('selected');
      if (panel.offsetParent !== null) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  UIController.prototype._onSolutionSelected = function (index, solution) {
    window.GearApp.currentSolution = solution;
    // Schéma SVG
    this._drawSVGSchematic(solution);

    // Schéma legacy Canvas
    var legacyStages = solution.mode==='rotationTranslation'?[]:solution.stages.map(GearTransmissionRegistry.toLegacy);
    if (this._legacySchema && legacyStages.length) {
      this._legacySchema.displaySolution(legacyStages);
    }

    var proMode = this.paramForm.isProMode();
    var analyse = this.mechanicalPanel.show(solution, null, proMode);

    // Carte résumé
    this._updateSolutionCard(solution, analyse, index);

    // Graphiques d'analyse
    if (analyse) {
      this._updateAnalysisCharts(analyse, proMode);
    }
  };

  // ===== Solution card =====

  UIController.prototype._updateSolutionCard = function (solution, analyse, index) {
    var card = document.getElementById('solutionCard');
    if (!card) return;

    if (!analyse) {
      this._hideSolutionCard();
      return;
    }

    var registry = GearApp.models.typeRegistry;
    var types = solution.stages.map(function (s) {
      var id=s.type==='planetary'?'epicyclic':s.type;
      return '<span class="type-badge ' + id + '">' + registry.get(id).nomCourt + '</span>';
    }).join(' ');

    var rendClass = solution.efficiency > 0.95 ? 'excellent' : solution.efficiency > 0.90 ? 'good' : 'warning';

    var sf = (solution.mechanical || []).reduce(function(min, stage) { var value=stage.bending&&stage.bending.safetyFactor;return Number.isFinite(value)?Math.min(min,value):min; }, Infinity);
    var sh = (solution.mechanical || []).reduce(function(min, stage) { var value=stage.contact&&stage.contact.safetyFactor;return Number.isFinite(value)?Math.min(min,value):min; }, Infinity);

    // Constructibilité : procédé appliqué et échecs éventuels (variantes d'éditeur).
    var MANUFACTURING_LABELS = { standard:'Standard', CNC:'CNC', laser:'Laser', printing3d:'Impression 3D', custom:'Personnalisé' };
    var FAILURE_LABELS = { MODULE_TOO_SMALL:'Module sous la limite du procédé', TOO_FEW_TEETH:'Dents sous la limite du procédé', FACE_WIDTH_TOO_SMALL:'Largeur de denture insuffisante', PRINTER_DIAMETER:'Ø supérieur au plateau d’impression' };
    var manufacturingBadges = '';
    if (solution.manufacturing) {
      var processLabel = MANUFACTURING_LABELS[solution.manufacturing.rules && solution.manufacturing.rules.mode] || 'Standard';
      manufacturingBadges = (solution.manufacturing.failures && solution.manufacturing.failures.length)
        ? solution.manufacturing.failures.map(function (code) { return '<span class="status-badge warning">⚠ ' + (FAILURE_LABELS[code] || code) + '</span>'; }).join('')
        : '<span class="status-badge">✓ Fabrication ' + processLabel + '</span>';
    }

    // Module retenu (fixe, automatique ou édité manuellement).
    var stats = solution.stats || {};
    var moduleValue = Number.isFinite(stats.selectedModule) ? stats.selectedModule + ' mm' : '—';
    var moduleSuffix = stats.moduleMode === 'automatic' ? ' (auto)' : stats.moduleMode === 'manual' ? ' (édité)' : '';
    var moduleTitle = solution.moduleSelection && solution.moduleSelection.tested && solution.moduleSelection.tested.length > 1
      ? 'Modules testés : ' + solution.moduleSelection.tested.join(', ') + ' mm' : '';
    var mode = document.getElementById('search_mode');
    var modeLabel = mode ? mode.options[mode.selectedIndex].textContent : 'classement';
    var warnings = solution.warnings || [];
    var linear=solution.mode==='rotationTranslation';
    var outputs=linear
      ? '<div class="card-item"><span class="card-label">Course / tour</span><span class="card-value">'+num(solution.travelPerRevolutionMm,2)+' mm/tr</span></div><div class="card-item"><span class="card-label">Vitesse linéaire</span><span class="card-value">'+num(solution.outputLinearSpeedMmMin,0)+' mm/min</span></div><div class="card-item"><span class="card-label">Force sortie</span><span class="card-value">'+num(solution.outputForceN,1)+' N</span></div>'
      : '<div class="card-item"><span class="card-label">Rapport</span><span class="card-value">'+num(solution.ratio,4)+'</span></div><div class="card-item"><span class="card-label">RPM sortie</span><span class="card-value">'+num(solution.outputSpeedRpm,1)+' rpm</span></div><div class="card-item"><span class="card-label">Couple sortie</span><span class="card-value">'+num(solution.outputTorqueNm,1)+' N·m</span></div>';
    var title = index >= 0 ? 'Solution du vivier n° ' + (index + 1) : 'Solution épinglée / variante';
    card.innerHTML =
      '<div class="solution-summary-title"><div><span class="card-label">Résultat sélectionné</span><h2>' + title + '</h2></div><span class="type-badge">Classement : ' + modeLabel + '</span></div>' +
      outputs +
      '<div class="card-item"><span class="card-label">Rendement</span><span class="card-value ' + rendClass + '">' + num(solution.efficiency * 100, 1) + '%</span></div>' +
      '<div class="card-item"><span class="card-label">Architecture</span><span class="card-value">' + types + '</span></div>' +
      '<div class="card-item"><span class="card-label">Dimensions</span><span class="card-value">' + num(solution.dimensions.length,0)+' × '+num(solution.dimensions.maxDiameter,0)+' × '+num(solution.dimensions.width,0)+' mm</span></div>' +
      '<div class="card-item"><span class="card-label">SF min</span><span class="card-value">' + (Number.isFinite(sf)?sf.toFixed(2):'—') + '</span></div>' +
      '<div class="card-item"><span class="card-label">SH min</span><span class="card-value">' + (Number.isFinite(sh)?sh.toFixed(2):'—') + '</span></div>' +
      '<div class="card-item" title="' + moduleTitle + '"><span class="card-label">Module</span><span class="card-value">' + moduleValue + moduleSuffix + '</span></div>' +
      '<div class="status-badges"><span class="status-badge">✓ Précision OK</span><span class="status-badge">✓ Dimensions OK</span>' + manufacturingBadges + (Number.isFinite(sf)?'<span class="status-badge">✓ SF '+sf.toFixed(2)+'</span>':'') + (Number.isFinite(sh)?'<span class="status-badge">✓ SH '+sh.toFixed(2)+'</span>':'') + warnings.slice(0,3).map(function(w){var code=w&&w.code||'WARNING',message=w&&w.message||String(w);return '<span class="status-badge warning" title="'+(w&&w.recommendation||'')+'">⚠ '+code+' — '+message+'</span>';}).join('') + '</div>';

    card.hidden = false;
  };

  UIController.prototype._hideSolutionCard = function () {
    var card = document.getElementById('solutionCard');
    if (card) card.hidden = true;
  };

  UIController.prototype._drawSVGSchematic = function (solution) {
    var section = document.getElementById('svgContainer').closest('.viz-section');
    if (section) section.classList.remove('kinematic-active');
    if (!this._viewer) {
      this._viewer = new GearApp.visualization.ViewerToolbar(document.getElementById('svgContainer'));
      this._viewer.bind();
      GearApp.visualization.viewerToolbar = this._viewer;
    }
    this._viewer.render(solution);
  };

  UIController.prototype._updateComparisonCharts = function (solutions, searchParams) {
    var charts = this._charts || window.GearCharts;
    if (!charts) return;

    var target = searchParams ? searchParams.rapportCible : parseFloat(document.getElementById("rapport").value);

    if (solutions.length&&solutions[0].mode==='rotationTranslation') { if(document.getElementById('radarChart'))charts.drawStructuredScore('radarChart',solutions[0]); return; }
    if (document.getElementById("ratioChart")) {
      charts.drawRatioComparison("ratioChart", solutions.map(function(s){return s.stages.map(GearTransmissionRegistry.toLegacy);}), target);
    }

    var modValue = this.paramForm.getModuleValue();
    if (modValue && document.getElementById("radarChart")) {
      var chartParams = {
        module: modValue,
        vitesseEntree: this.paramForm.getVitesseEntree(),
        coupleEntree: this.paramForm.getCoupleEntree()
      };
      var tp = this.paramForm.getTypeSpecificParams();
      var mp = this.paramForm.getMaterialParams();
      for (var ck in tp) { if (tp.hasOwnProperty(ck)) chartParams[ck] = tp[ck]; }
      for (var cm in mp) { if (mp.hasOwnProperty(cm)) chartParams[cm] = mp[cm]; }
      if (solutions.length) charts.drawStructuredScore("radarChart", solutions[0]);
    }
  };

  UIController.prototype._updateAnalysisCharts = function (analyse, proMode) {
    var charts = this._charts || window.GearCharts;
    if (!charts) return;
    charts.drawStructuredCascade('cascadeChart', analyse);
    charts.drawStructuredLosses('powerLossChart', analyse);
    if (proMode) charts.drawStructuredSafety('safetyChart', analyse);
  };

  GearApp.ui.UIController = UIController;

})(GearApp);
