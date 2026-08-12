// UIController.js - Orchestrateur UI principal
// Coordonne tous les sous-composants UI via EventBus

(function (GearApp) {

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

    this._bindEvents();
    var controller=this,visualContainer=document.getElementById('svgContainer');if(visualContainer)visualContainer.addEventListener('visualization:renderer',function(event){controller.exportManager.setRenderer(event.detail.renderer);});
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
      this.mechanicalPanel.hide();
      this._hideSolutionCard();
      return;
    }

    this._updateComparisonCharts(solutions, searchParams);
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

    card.innerHTML =
      '<div class="card-item"><span class="card-label">Solution #' + (index + 1) + '</span></div>' +
      '<div class="card-item"><span class="card-label">' + (solution.mode==='rotationTranslation'?'Course':'Rapport') + '</span><span class="card-value">' + (solution.mode==='rotationTranslation'?solution.travelPerRevolutionMm.toFixed(2)+' mm/tr':solution.ratio.toFixed(4)) + '</span></div>' +
      '<div class="card-item"><span class="card-label">Rendement</span><span class="card-value ' + rendClass + '">' + (solution.efficiency * 100).toFixed(1) + '%</span></div>' +
      '<div class="card-item"><span class="card-label">Étages</span><span class="card-value">' + solution.stages.length + '</span></div>' +
      '<div class="card-item">' + types + '</div>';

    card.style.display = 'flex';
  };

  UIController.prototype._hideSolutionCard = function () {
    var card = document.getElementById('solutionCard');
    if (card) card.style.display = 'none';
  };

  UIController.prototype._drawSVGSchematic = function (solution) {
    var modValue = this.paramForm.getModuleValue() || 2;
    if(solution.mode==='rotationTranslation'&&GearApp.visualization.kinematicRenderer){var section=document.getElementById('svgContainer').closest('.viz-section');if(section)section.classList.add('kinematic-active');GearApp.visualization.kinematicRenderer.render(solution);return;}

    if (!this._gearSvg) {
      var container = document.getElementById("svgContainer");
      if (container) {
        this._gearSvg = new GearSVG("svgContainer");
        this.exportManager.setRenderer(this._gearSvg);
      }
    }

    if (this._gearSvg) {
      this._gearSvg.drawGearTrain(solution.stages.map(GearTransmissionRegistry.toLegacy), modValue, 20);
    }
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
