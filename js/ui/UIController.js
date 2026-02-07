/**
 * @file UIController.js - Orchestrateur UI principal
 * @description Coordonne tous les sous-composants UI via l'EventBus (pub/sub).
 *
 *   Architecture du flux d'événements :
 *   ┌──────────┐   search:log     ┌────────┐
 *   │  Engine   │ ───────────────> │ Logger │
 *   └──────────┘   search:progress └────────┘
 *        │                              │
 *        │ search:partial               │
 *        ▼                              │
 *   ┌──────────────┐                   │
 *   │ ResultsTable  │ <────────────────┘
 *   └──────────────┘
 *        │ solution:selected
 *        ▼
 *   ┌──────────────────┐
 *   │   UIController    │ ──> GearSVG, MechanicalPanel, Charts
 *   └──────────────────┘
 *
 *   Le UIController :
 *   - Instancie Logger, ResultsTable, MechanicalPanel, ParameterForm, ExportManager
 *   - S'abonne aux événements de l'EventBus pour coordonner les mises à jour
 *   - Gère la sélection d'une solution : dessin SVG, analyse mécanique, graphiques
 *   - Reçoit les composants de visualisation (GearSVG, Charts) depuis l'extérieur
 *
 * @namespace GearApp.ui.UIController
 */

(function (GearApp) {

  // ===== Constructeur =====

  /**
   * Crée une instance de UIController.
   * Instancie tous les sous-composants UI et lie les événements de l'EventBus.
   *
   * @constructor
   * @param {GearApp.core.EventBus} [eventBus=GearApp.eventBus] - Instance de l'EventBus pour la communication inter-composants
   */
  function UIController(eventBus) {
    /** @type {GearApp.core.EventBus} @private Bus d'événements pour la communication inter-composants */
    this._eventBus = eventBus || GearApp.eventBus;

    /** @type {GearApp.ui.Logger} Logger pour les messages de recherche */
    this.logger = new GearApp.ui.Logger('logs', 'status');
    /** @type {GearApp.ui.ResultsTable} Tableau de résultats triable et filtrable */
    this.resultsTable = new GearApp.ui.ResultsTable('resultats', this._eventBus);
    /** @type {GearApp.ui.MechanicalPanel} Panneau d'analyse mécanique détaillée */
    this.mechanicalPanel = new GearApp.ui.MechanicalPanel('mechanicalPanel');
    /** @type {GearApp.ui.ParameterForm} Formulaire de paramètres et sliders */
    this.paramForm = new GearApp.ui.ParameterForm();
    /** @type {GearApp.ui.ExportManager} Gestionnaire d'export SVG/PNG */
    this.exportManager = new GearApp.ui.ExportManager();

    /** @type {GearSVG|null} @private Moteur de rendu SVG des engrenages */
    this._gearSvg = null;
    /** @type {Object|null} @private Schéma Canvas legacy (rétrocompatibilité) */
    this._legacySchema = null;
    /** @type {Object|null} @private Instance de GearCharts pour les graphiques */
    this._charts = null;

    this._bindEvents();
  }

  // ===== Configuration des composants de visualisation =====

  /**
   * Injecte les composants de visualisation externes.
   * Appelé après l'initialisation, une fois que GearSVG et Charts sont prêts.
   *
   * @param {GearSVG|null} gearSvg - Moteur de rendu SVG interactif des engrenages
   * @param {Object|null} legacySchema - Schéma Canvas legacy (rétrocompatibilité)
   * @param {Object|null} charts - Instance de GearCharts (Chart.js) pour les graphiques
   * @returns {void}
   */
  UIController.prototype.setVisualizationComponents = function (gearSvg, legacySchema, charts) {
    this._gearSvg = gearSvg;
    this._legacySchema = legacySchema;
    this._charts = charts;
    this.exportManager.setRenderer(gearSvg);
  };

  // ===== Liaison des événements =====

  /**
   * Lie les gestionnaires d'événements de l'EventBus.
   * Écoute les événements de recherche (log, progress, partial) et de sélection.
   *
   * @private
   * @returns {void}
   */
  UIController.prototype._bindEvents = function () {
    var self = this;

    // Événement : message de log provenant du moteur de recherche
    this._eventBus.on('search:log', function (data) {
      self.logger.log(data.message);
    });

    // Événement : progression de la recherche (mise à jour de la barre de progression)
    this._eventBus.on('search:progress', function (data) {
      var bar = document.getElementById('progress-bar');
      if (bar) bar.style.width = data.percent + '%';
    });

    // Événement : une solution a été sélectionnée dans le tableau de résultats
    this._eventBus.on('solution:selected', function (data) {
      self._onSolutionSelected(data.index, data.solution);
    });

    // Événement : résultats incrémentaux pendant la recherche (affichage progressif)
    this._eventBus.on('search:partial', function (data) {
      if (data.solutions && data.solutions.length > 0) {
        self._eventBus.emit('search:log', {
          message: data.totalSolutions + ' solutions en cours... affichage partiel.'
        });
        self.resultsTable.display(data.solutions, self._lastSearchParams);
      }
    });
  };

  // ===== Affichage des résultats =====

  /**
   * Affiche les résultats d'une recherche dans le tableau et met à jour les graphiques.
   * Si aucune solution n'est trouvée, masque le panneau mécanique.
   *
   * @param {Array<Array>} solutions - Liste des solutions trouvées (tuples [A, B, typeId] par étage)
   * @param {GearApp.models.SearchParams} searchParams - Paramètres de recherche utilisés
   * @returns {void}
   */
  UIController.prototype.afficherResultats = function (solutions, searchParams) {
    /** @type {GearApp.models.SearchParams} @private Derniers paramètres de recherche (pour les résultats partiels) */
    this._lastSearchParams = searchParams;
    this.resultsTable.display(solutions, searchParams);

    if (solutions.length === 0) {
      this.mechanicalPanel.hide();
      return;
    }

    // Mise à jour des graphiques de comparaison (ratio et radar)
    this._updateComparisonCharts(solutions, searchParams);
  };

  // ===== Gestion de la sélection d'une solution =====

  /**
   * Gestionnaire appelé lorsqu'une solution est sélectionnée dans le tableau.
   * Enchaîne : dessin SVG, schéma legacy, analyse mécanique et graphiques d'analyse.
   *
   * @private
   * @param {number} index - Index de la solution dans le tableau original
   * @param {Array<Array>} solution - Solution sélectionnée (tuples [A, B, typeId] par étage)
   * @returns {void}
   */
  UIController.prototype._onSolutionSelected = function (index, solution) {
    // Dessin du schéma SVG interactif
    this._drawSVGSchematic(solution);

    // Schéma legacy Canvas (rétrocompatibilité)
    if (this._legacySchema) {
      this._legacySchema.displaySolution(solution);
    }

    // Construction des paramètres pour l'analyse mécanique
    // Combine les paramètres de base (module, vitesse, couple) avec les paramètres
    // spécifiques au type et les paramètres matériaux du mode pro
    var modValue = this.paramForm.getModuleValue();
    var params = {
      module: modValue,
      vitesseEntree: this.paramForm.getVitesseEntree(),
      coupleEntree: this.paramForm.getCoupleEntree()
    };

    // Enrichissement avec les paramètres pro (type-spécifiques + matériaux)
    var typeParams = this.paramForm.getTypeSpecificParams();
    var materialParams = this.paramForm.getMaterialParams();
    for (var k in typeParams) { if (typeParams.hasOwnProperty(k)) params[k] = typeParams[k]; }
    for (var m in materialParams) { if (materialParams.hasOwnProperty(m)) params[m] = materialParams[m]; }

    var proMode = this.paramForm.isProMode();
    var analyse = this.mechanicalPanel.show(solution, params, proMode);

    // Mise à jour des graphiques d'analyse si l'analyse a été calculée
    if (analyse) {
      this._updateAnalysisCharts(analyse);
    }
  };

  // ===== Dessin SVG =====

  /**
   * Dessine le schéma SVG interactif du train d'engrenages.
   * Crée l'instance GearSVG à la première utilisation si le conteneur existe.
   *
   * @private
   * @param {Array<Array>} solution - Solution à dessiner (tuples [A, B, typeId] par étage)
   * @returns {void}
   */
  UIController.prototype._drawSVGSchematic = function (solution) {
    var modValue = this.paramForm.getModuleValue() || 2;

    // Création paresseuse de l'instance GearSVG si nécessaire
    if (!this._gearSvg) {
      var container = document.getElementById("svgContainer");
      if (container) {
        this._gearSvg = new GearSVG("svgContainer");
        this.exportManager.setRenderer(this._gearSvg);
      }
    }

    if (this._gearSvg) {
      // Paramètres : solution, module, angle de pression par défaut (20°)
      this._gearSvg.drawGearTrain(solution, modValue, 20);
    }
  };

  // ===== Mise à jour des graphiques =====

  /**
   * Met à jour les graphiques de comparaison entre solutions.
   * Dessine le graphique de comparaison des rapports et le radar mécanique
   * pour les 5 premières solutions.
   *
   * @private
   * @param {Array<Array>} solutions - Liste des solutions à comparer
   * @param {GearApp.models.SearchParams} searchParams - Paramètres de recherche (pour le rapport cible)
   * @returns {void}
   */
  UIController.prototype._updateComparisonCharts = function (solutions, searchParams) {
    var charts = this._charts || window.GearCharts;
    if (!charts) return;

    var target = searchParams ? searchParams.rapportCible : parseFloat(document.getElementById("rapport").value);

    // Graphique de comparaison des rapports obtenus vs cible
    if (document.getElementById("ratioChart")) {
      charts.drawRatioComparison("ratioChart", solutions, target);
    }

    // Graphique radar mécanique (pour les 5 premières solutions uniquement)
    var modValue = this.paramForm.getModuleValue();
    if (modValue && document.getElementById("radarChart")) {
      var chartParams = {
        module: modValue,
        vitesseEntree: this.paramForm.getVitesseEntree(),
        coupleEntree: this.paramForm.getCoupleEntree()
      };
      // Fusionner les paramètres type-spécifiques et matériaux
      var tp = this.paramForm.getTypeSpecificParams();
      var mp = this.paramForm.getMaterialParams();
      for (var ck in tp) { if (tp.hasOwnProperty(ck)) chartParams[ck] = tp[ck]; }
      for (var cm in mp) { if (mp.hasOwnProperty(cm)) chartParams[cm] = mp[cm]; }
      // Analyser mécaniquement les 5 premières solutions pour le radar
      var analyses = solutions.slice(0, 5).map(function (sol) {
        return GearApp.core.GearMechanics.analyserTrainEngrenages(sol, chartParams);
      });
      charts.drawMechanicalRadar("radarChart", analyses, target);
    }
  };

  /**
   * Met à jour les graphiques d'analyse d'une solution sélectionnée.
   * Dessine la cascade couple/vitesse et la répartition des pertes de puissance.
   *
   * @private
   * @param {Object} analyse - Objet d'analyse mécanique retourné par GearMechanics.analyserTrainEngrenages()
   * @returns {void}
   */
  UIController.prototype._updateAnalysisCharts = function (analyse) {
    var charts = this._charts || window.GearCharts;
    if (!charts) return;
    // Graphique cascade : évolution du couple et de la vitesse à travers les étages
    if (document.getElementById("cascadeChart")) {
      charts.drawTorqueSpeedCascade("cascadeChart", analyse);
    }
    // Graphique de répartition des pertes de puissance par étage
    if (document.getElementById("powerLossChart")) {
      charts.drawPowerLossBreakdown("powerLossChart", analyse);
    }
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.ui.UIController = UIController;

})(GearApp);
