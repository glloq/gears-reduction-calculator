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
    this._download(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}), 'gear-solution.json');
  };

  ExportManager.prototype.exportCSV = function (solution) {
    var rows=['stage,type,input,output'];
    (solution||[]).forEach(function(s,i){rows.push([i+1,s[2]||'spur',s[0],s[1]].join(','));});
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
