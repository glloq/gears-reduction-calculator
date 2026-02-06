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
