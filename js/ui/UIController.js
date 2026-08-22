// UIController.js - Orchestrateur UI principal
// Coordonne tous les sous-composants UI via EventBus

(function (GearApp) {

  /**
   * §21 : la classe visuelle d'un rendement.
   *
   * Une couleur de résultat doit dépendre des LIMITES du moteur quand il existe
   * une limite physique, de la DEMANDE quand il existe une contrainte, et
   * rester neutre sinon. Le barème 95/90 codé en dur faisait passer pour
   * excellente une solution qui ratait l'exigence de l'utilisateur.
   */
  /**
   * Les alertes d'une solution : par gravité, coupées à trois, et le reste
   * annoncé plutôt que tu.
   */
  function alertBadges(solution) {
    var Assessment = GearApp.requirements && GearApp.requirements.DecisionAssessment;
    var alerts = Assessment ? Assessment.alerts(solution) : null;
    if (!alerts || !alerts.list.length) return '';
    var shown = alerts.list.slice(0, 3).map(function (entry) {
      return '<span class="status-badge state-' + entry.level + '" title="' +
        escapeAttribute(entry.advice || '') + '">' + entry.mark + ' ' + escapeText(entry.label) + '</span>';
    }).join('');
    var rest = alerts.list.length - 3;
    if (rest > 0) {
      shown += '<span class="status-badge state-unknown" title="' +
        escapeAttribute(alerts.list.slice(3).map(function (entry) { return entry.label; }).join(' · ')) +
        '">+ ' + rest + ' autre' + (rest > 1 ? 's' : '') + '</span>';
    }
    return shown;
  }

  function efficiencyClass(efficiency, asked) {
    if (!Number.isFinite(efficiency)) return 'unknown';
    var wanted = asked && asked.constraints && asked.constraints.minimumEfficiency;
    if (Number.isFinite(wanted)) {
      if (efficiency < wanted) return 'warning';
      return efficiency >= wanted * 1.02 ? 'excellent' : 'good';
    }
    var floor = (window.GearEngineering && GearEngineering.LIMITS && GearEngineering.LIMITS.efficiency) || 0.8;
    if (efficiency < floor) return 'warning';
    return efficiency > 0.95 ? 'excellent' : efficiency > 0.90 ? 'good' : 'neutral';
  }


  /**
   * Une valeur de service peut être NON RENSEIGNÉE : une chaîne analysée sans
   * régime n'a ni vitesse de sortie ni couple. `toFixed` sur un `null` faisait
   * tomber la carte entière, et avec elle tout ce qui suivait dans la page.
   */
  function num(value, digits, unit) {
    return (Number.isFinite(value) ? value.toFixed(digits) : '—') + (unit || '');
  }

  /**
   * Les libellés de conformité viennent d'un catalogue, mais un procédé
   * personnalisé peut porter un nom saisi par l'utilisateur : cette carte est
   * construite par concaténation, elle doit donc échapper ce qu'elle insère.
   */
  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttribute(value) { return escapeText(value).replace(/"/g, '&quot;'); }

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

  /**
   * Plus aucune solution sélectionnée — filtre trop serré, vivier vide.
   *
   * Cette méthode ne cachait que le panneau mécanique et la carte. Tout le
   * reste survivait : le dessin, l'identité, les puces d'étage, la chaîne
   * cinématique, l'inspecteur. On pouvait donc lire « aucune des 50 solutions
   * ne passe vos filtres » au-dessus d'un mécanisme entièrement détaillé —
   * exactement la contradiction que tout le reste du travail cherche à
   * supprimer. Effacer un détail, c'est effacer TOUT ce qui le décrit.
   */
  UIController.prototype.clearDetail = function () {
    this.mechanicalPanel.hide();
    this._hideSolutionCard();
    if (this._viewer && this._viewer.clear) this._viewer.clear();
    if (this._solutionHeader && this._solutionHeader.clear) this._solutionHeader.clear();
    if (this.resultsTable && this.resultsTable.setSelectedIndex) this.resultsTable.setSelectedIndex(-1);
    this._syncMechanicalRow(-1);
    this._eventBus.emit('solution:cleared', {});
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

    // §21 : LA COULEUR SUIT LA DEMANDE, PAS UN BARÈME MAISON.
    //
    // 95 % était « excellent » et 90 % « bon », quoi qu'on ait demandé. Un
    // utilisateur qui impose 98 % voyait donc en vert une solution à 96 % qui
    // ne répond pas à sa demande. Quand une exigence existe, c'est elle qui
    // décide ; sinon on retombe sur les seuils du moteur, qui, eux, décrivent
    // une physique et non une intention.
    var rendClass = efficiencyClass(solution.efficiency, this._lastSearchParams);

    var sf = (solution.mechanical || []).reduce(function(min, stage) { var value=stage.bending&&stage.bending.safetyFactor;return Number.isFinite(value)?Math.min(min,value):min; }, Infinity);
    var sh = (solution.mechanical || []).reduce(function(min, stage) { var value=stage.contact&&stage.contact.safetyFactor;return Number.isFinite(value)?Math.min(min,value):min; }, Infinity);

    // La conformité vient d'UN SEUL endroit. Cette carte affichait « ✓ Précision
    // OK » et « ✓ Dimensions OK » codés en dur — sans avoir rien vérifié — puis
    // « ✓ SF 0.82 », une coche verte devant une sécurité insuffisante. Elle ne
    // décide plus : elle peint des états déjà établis.
    var asked = this._lastSearchParams || {};
    var compliance = GearSolutionCompliance.evaluate(solution,
      Object.assign({ tolerancePercent: Number.isFinite(asked.precision) ? asked.precision : null },
        asked.constraints || {}));

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
      '<div class="status-badges">' +
        GearSolutionCompliance.badges(compliance).map(function (badge) {
          return '<span class="status-badge state-' + badge.state + '" data-compliance="' + badge.key +
            '" title="' + escapeAttribute(badge.title) + '">' + badge.mark + ' ' + escapeText(badge.text) + '</span>';
        }).join('') +
        // §20 : LES PLUS GRAVES D'ABORD, ET LE RESTE ANNONCÉ.
        //
        // Trois alertes s'affichaient, dans l'ordre où le moteur les avait
        // émises, et rien ne disait qu'il en existait d'autres. Une sécurité au
        // contact insuffisante pouvait donc être la quatrième — c'est-à-dire
        // invisible — derrière trois réserves. Les alertes sont libellées en
        // français par le moteur ; le code interne ne paraît jamais à l'écran.
        alertBadges(solution) + '</div>';

    card.hidden = false;
  };

  UIController.prototype._hideSolutionCard = function () {
    var card = document.getElementById('solutionCard');
    // Vidée, pas seulement cachée : c'est une région `aria-live`, dont le
    // contenu resterait annonçable après la disparition de la solution.
    if (card) { card.textContent = ''; card.hidden = true; }
  };

  UIController.prototype._drawSVGSchematic = function (solution) {
    var section = document.getElementById('svgContainer').closest('.viz-section');
    if (section) section.classList.remove('kinematic-active');
    if (!this._viewer) {
      this._viewer = new GearApp.visualization.ViewerToolbar(document.getElementById('svgContainer'));
      this._viewer.bind();
      GearApp.visualization.viewerToolbar = this._viewer;
      // §14, §15 : l'identité de la solution et la navigation par étage vivent
      // juste au-dessus du dessin, et pilotent le même viewer.
      if (GearApp.ui.SolutionHeader) {
        this._solutionHeader = new GearApp.ui.SolutionHeader(null,
          { bus: this._eventBus, viewer: this._viewer }).bind();
        GearApp.ui.solutionHeader = this._solutionHeader;
      }
    }
    this._viewer.render(solution);
  };

  UIController.prototype._updateComparisonCharts = function (solutions, searchParams) {
    var charts = this._charts || window.GearCharts;
    if (!charts) return;

    var target = searchParams ? searchParams.rapportCible : parseFloat(document.getElementById("rapport").value);

    if (solutions.length&&solutions[0].mode==='rotationTranslation') { if(document.getElementById('radarChart'))charts.drawStructuredScore('radarChart',solutions[0]); return; }
    // Les solutions telles quelles : le graphique lit `ratio` et `errorPercent`
    // du modèle. Il recevait auparavant des triplets `[A, B, type]` et
    // recalculait le rapport lui-même, ce qui le faisait diverger du chiffre
    // affiché à côté dès qu'un étage n'était pas un simple couple de roues.
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
