// Logger.js - Gestion des logs et messages de statut

(function (GearApp) {

  function Logger(logContainerId, statusElementId, mirrorElementId) {
    this._logContainer = document.getElementById(logContainerId);
    this._statusElement = document.getElementById(statusElementId);
    // Le même statut, à l'endroit où on le lit pendant l'attente. L'en-tête des
    // résultats n'est affiché que sous `body.has-results` : avant la première
    // solution, « Calcul en cours… » n'atteignait personne. Un second élément
    // plutôt qu'un second message : deux textes finiraient par diverger.
    this._mirrorElement = mirrorElementId ? document.getElementById(mirrorElementId) : null;
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
    if (this._mirrorElement) this._mirrorElement.innerText = message;
  };

  Logger.prototype.toggle = function () {
    if (!this._logContainer) return;
    this._logContainer.style.display = this._logContainer.style.display === "none" ? "block" : "none";
  };

  GearApp.ui.Logger = Logger;

})(GearApp);
