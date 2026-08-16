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
