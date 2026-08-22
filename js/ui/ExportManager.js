// ExportManager.js - Export SVG/PNG et contrôle d'animation

(function (GearApp) {

  function ExportManager() {
    this._gearSvg = null;
  }

  ExportManager.prototype.setRenderer = function (gearSvg) {
    this._gearSvg = gearSvg;
  };

  ExportManager.prototype.exportSVG = function () {
    if (!this._gearSvg) return;
    var svgData = this._gearSvg.exportSVG();
    var blob = new Blob([svgData], { type: "image/svg+xml" });
    this._download(blob, "engrenages.svg");
  };

  // Export technique : cotations et tracés de construction forcés visibles,
  // même s'ils sont masqués à l'écran par le menu « Affichage ».
  ExportManager.prototype.exportTechnicalSVG = function () {
    if (!this._gearSvg) return;
    var svgData = this._gearSvg.exportSVG({ technical: true });
    this._download(new Blob([svgData], { type: 'image/svg+xml' }), 'engrenages-technique.svg');
  };

  ExportManager.prototype.exportPNG = function () {
    if (!this._gearSvg) return;
    var self = this;
    this._gearSvg.exportPNG(function (blob) {
      if (blob) self._download(blob, "engrenages.png");
    });
  };

  ExportManager.prototype.toggleAnimation = function () {
    if (this._gearSvg) this._gearSvg.toggleAnimation();
  };

  ExportManager.prototype.resetView = function () {
    if (this._gearSvg) this._gearSvg.resetView();
  };

  ExportManager.prototype.exportJSON = function (payload) {
    var solution=payload&&payload.solution?payload.solution:payload;
    var model=solution&&solution.stages?{schemaVersion:1,generatedBy:'gears-reduction-calculator',input:{inputSpeedRpm:solution.inputSpeedRpm,inputTorqueNm:solution.inputTorqueNm},constraints:(payload&&payload.constraints)||{},solution:solution,stages:solution.stages,geometry:solution.stages.map(function(s){return s.geometry;}),mechanical:solution.mechanical,materials:solution.materials||(payload&&payload.materials)||{},fatigue:solution.fatigue||null,shaft:solution.shaft||null,manufacturing:solution.manufacturing||null,score:solution.score,warnings:solution.warnings,searchStats:solution.stats}:payload;
    this._download(new Blob([JSON.stringify(model, null, 2)], {type:'application/json'}), 'gear-solution.json');
  };

  ExportManager.prototype.exportCSV = function (solution) {
    if(solution&&solution.mode==='rotationTranslation'){var linear=['travel_mm_per_rev,linear_speed_mm_min,output_force_n,efficiency',[solution.travelPerRevolutionMm,solution.outputLinearSpeedMmMin,solution.outputForceN,solution.efficiency].join(',')];this._download(new Blob([linear.join('\n')],{type:'text/csv;charset=utf-8'}),'gear-linear-solution.csv');return;}
    var rows=['stage,type,input,output,ratio,module,pitch_diameter_input,pitch_diameter_output,center_distance,efficiency,Ft,Fr,Fa,SF,SH'];
    if(solution&&solution.stages)solution.stages.forEach(function(s,i){var m=solution.mechanical[i],g=s.geometry||{},input=s.input?s.input.teeth:s.wormStarts||s.sunTeeth,output=s.output?s.output.teeth:s.wheelTeeth||s.ringTeeth;rows.push([i+1,s.type,input,output,m.ratio,s.parameters.module,g.pitchDiameterInput||g.sunDiameter,g.pitchDiameterOutput||g.ringDiameter,g.centerDistance,m.efficiency,m.forces.tangentialN,m.forces.radialN,m.forces.axialN,m.bending&&m.bending.safetyFactor,m.contact&&m.contact.safetyFactor].join(','));});
    this._download(new Blob([rows.join('\n')], {type:'text/csv;charset=utf-8'}), 'gear-solution.csv');
  };

  /**
   * §P2.5 : LE RAPPORT DE DÉCISION.
   *
   * Les exports décrivaient une SOLUTION — géométrie, efforts, matériaux — et
   * jamais le choix. Or ce qu'on doit pouvoir transmettre, archiver ou défendre
   * en revue, c'est précisément le choix : quelle solution, à quel rang, sur
   * quel domaine, avec quels contrôles vérifiés, ce qu'elle gagne et ce qu'elle
   * coûte face aux autres, et ce qui n'a PAS été vérifié.
   *
   * Rien n'est recalculé ici : c'est le verdict de `DecisionAssessment`, mis en
   * forme. Un rapport qui recalculerait pourrait contredire l'écran dont il
   * prétend rendre compte.
   */
  ExportManager.prototype.exportDecisionReport = function (assessment, context) {
    if (!assessment || !assessment.entries.length) return null;
    var meta = context || {};
    var report = {
      schemaVersion: 1,
      generatedBy: 'gears-reduction-calculator',
      // La PORTÉE d'abord : un classement sur un domaine tronqué n'a pas la
      // valeur d'un optimum, et un rapport doit le dire avant ses conclusions.
      scope: assessment.scope,
      requirement: meta.requirement || null,
      priorities: meta.priorities || null,
      objectives: assessment.objectives,
      recommended: describeEntry(assessment.byIndex[assessment.recommended]),
      alternatives: (assessment.decision.order || [])
        .filter(function (index) { return index !== assessment.recommended; })
        .map(function (index) { return describeEntry(assessment.byIndex[index]); }),
      ranking: (assessment.decision.ranking || []).slice(0, 25).map(function (index) {
        var entry = assessment.byIndex[index];
        return { rank: entry.decision.rank, architecture: architectureOf(entry.solution),
          pareto: entry.decision.pareto, engineeringIndex: entry.engineering,
          compliance: entry.compliance.overall };
      })
    };
    this._download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      'gear-decision-report.json');
    return report;
  };

  function architectureOf(solution) {
    return ((solution && solution.stages) || []).map(function (stage) { return stage.type; }).join(' → ');
  }

  /** Une solution, telle que le verdict la décrit — sans rien y ajouter. */
  function describeEntry(entry) {
    if (!entry) return null;
    return {
      rank: entry.decision.rank,
      recommended: entry.decision.recommended,
      pareto: entry.decision.pareto,
      badges: entry.badges,
      architecture: architectureOf(entry.solution),
      ratio: entry.solution.ratio,
      errorPercent: entry.solution.errorPercent,
      efficiency: entry.solution.efficiency,
      dimensions: entry.solution.dimensions,
      engineeringIndex: entry.engineering,
      dominantFactor: entry.dominant ? entry.dominant.label : null,
      contributions: entry.contributions,
      compliance: { overall: entry.compliance.overall,
        checks: entry.compliance.checks.map(function (check) {
          return { key: check.key, state: check.state, text: check.text };
        }) },
      // Ce qui n'a pas été vérifié fait partie du rapport : un choix défendu
      // sans ses angles morts n'est pas défendable.
      unverified: entry.uncertainty.mechanical.concat(entry.uncertainty.checks),
      strengths: entry.strengths.map(function (item) { return item.text; }),
      compromises: entry.compromises.map(function (item) { return item.text; }),
      alerts: entry.alerts.list.map(function (alert) {
        return { level: alert.level, label: alert.label };
      }),
      assumptions: entry.context
    };
  }

  ExportManager.prototype._download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  GearApp.ui.ExportManager = ExportManager;

})(GearApp);
