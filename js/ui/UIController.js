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
    // Schéma SVG
    this._drawSVGSchematic(solution);

    // Schéma legacy Canvas
    if (this._legacySchema) {
      this._legacySchema.displaySolution(solution);
    }

    // Analyse mécanique
    var modValue = this.paramForm.getModuleValue();
    var params = {
      module: modValue,
      vitesseEntree: this.paramForm.getVitesseEntree(),
      coupleEntree: this.paramForm.getCoupleEntree()
    };

    var typeParams = this.paramForm.getTypeSpecificParams();
    var materialParams = this.paramForm.getMaterialParams();
    for (var k in typeParams) { if (typeParams.hasOwnProperty(k)) params[k] = typeParams[k]; }
    for (var m in materialParams) { if (materialParams.hasOwnProperty(m)) params[m] = materialParams[m]; }

    var proMode = this.paramForm.isProMode();
    var analyse = this.mechanicalPanel.show(solution, params, proMode);

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
    var types = solution.map(function (s) {
      return '<span class="type-badge ' + (s[2] || 'spur') + '">' + registry.get(s[2] || 'spur').nomCourt + '</span>';
    }).join(' ');

    var rendClass = analyse.rendementTotal > 0.95 ? 'excellent' : analyse.rendementTotal > 0.90 ? 'good' : 'warning';

    card.innerHTML =
      '<div class="card-item"><span class="card-label">Solution #' + (index + 1) + '</span></div>' +
      '<div class="card-item"><span class="card-label">Rapport</span><span class="card-value">' + analyse.rapportTotal.toFixed(4) + '</span></div>' +
      '<div class="card-item"><span class="card-label">Rendement</span><span class="card-value ' + rendClass + '">' + (analyse.rendementTotal * 100).toFixed(1) + '%</span></div>' +
      '<div class="card-item"><span class="card-label">Étages</span><span class="card-value">' + analyse.nombreEtages + '</span></div>' +
      '<div class="card-item">' + types + '</div>';

    card.style.display = 'flex';
  };

  UIController.prototype._hideSolutionCard = function () {
    var card = document.getElementById('solutionCard');
    if (card) card.style.display = 'none';
  };

  UIController.prototype._drawSVGSchematic = function (solution) {
    var modValue = this.paramForm.getModuleValue() || 2;

    if (!this._gearSvg) {
      var container = document.getElementById("svgContainer");
      if (container) {
        this._gearSvg = new GearSVG("svgContainer");
        this.exportManager.setRenderer(this._gearSvg);
      }
    }

    if (this._gearSvg) {
      this._gearSvg.drawGearTrain(solution, modValue, 20);
    }
  };

  UIController.prototype._updateComparisonCharts = function (solutions, searchParams) {
    var charts = this._charts || window.GearCharts;
    if (!charts) return;

    var target = searchParams ? searchParams.rapportCible : parseFloat(document.getElementById("rapport").value);

    if (document.getElementById("ratioChart")) {
      charts.drawRatioComparison("ratioChart", solutions, target);
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
      var analyses = solutions.slice(0, 5).map(function (sol) {
        return GearApp.core.GearMechanics.analyserTrainEngrenages(sol, chartParams);
      });
      charts.drawMechanicalRadar("radarChart", analyses, target);
    }
  };

  UIController.prototype._updateAnalysisCharts = function (analyse, proMode) {
    var charts = this._charts || window.GearCharts;
    if (!charts) return;
    if (document.getElementById("cascadeChart")) {
      charts.drawTorqueSpeedCascade("cascadeChart", analyse);
    }
    if (document.getElementById("powerLossChart")) {
      charts.drawPowerLossBreakdown("powerLossChart", analyse);
    }
    // Safety factor chart (pro mode)
    if (proMode && document.getElementById("safetyChart")) {
      charts.drawSafetyFactors("safetyChart", analyse);
    }
  };

  GearApp.ui.UIController = UIController;

})(GearApp);
