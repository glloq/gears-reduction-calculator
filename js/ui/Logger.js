// Logger.js - Gestion des logs et messages de statut

(function (GearApp) {

  function Logger(logContainerId, statusElementId) {
    this._logContainer = document.getElementById(logContainerId);
    this._statusElement = document.getElementById(statusElementId);
  }

  Logger.prototype.log = function (message) {
    if (!this._logContainer) return;
    var p = document.createElement("p");
    p.innerText = message;
    this._logContainer.appendChild(p);
    this._logContainer.scrollTop = this._logContainer.scrollHeight;
  };

  Logger.prototype.clear = function () {
    if (this._logContainer) this._logContainer.innerHTML = "";
  };

  Logger.prototype.setStatus = function (message) {
    if (this._statusElement) this._statusElement.innerText = message;
  };

  Logger.prototype.toggle = function () {
    if (!this._logContainer) return;
    this._logContainer.style.display = this._logContainer.style.display === "none" ? "block" : "none";
  };

  GearApp.ui.Logger = Logger;

})(GearApp);
