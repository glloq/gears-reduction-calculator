/**
 * @file Logger.js - Gestion des logs et messages de statut
 * @description Composant UI responsable de l'affichage des messages de log dans un conteneur
 *              dédié et de la mise à jour d'un élément de statut. Utilisé principalement
 *              pour afficher la progression et les messages de la recherche d'engrenages.
 * @namespace GearApp.ui.Logger
 */

(function (GearApp) {

  // ===== Constructeur =====

  /**
   * Crée une instance de Logger.
   * Récupère les éléments DOM par leurs identifiants pour l'affichage
   * des messages de log et du statut.
   *
   * @constructor
   * @param {string} logContainerId - Identifiant de l'élément DOM conteneur des logs
   * @param {string} statusElementId - Identifiant de l'élément DOM affichant le statut
   */
  function Logger(logContainerId, statusElementId) {
    /** @type {HTMLElement|null} @private Conteneur DOM pour les messages de log */
    this._logContainer = document.getElementById(logContainerId);
    /** @type {HTMLElement|null} @private Élément DOM pour le message de statut */
    this._statusElement = document.getElementById(statusElementId);
  }

  // ===== Méthodes publiques =====

  /**
   * Ajoute un message de log dans le conteneur.
   * Crée un élément <p> avec le texte du message et fait défiler
   * le conteneur vers le bas pour afficher le dernier message.
   *
   * @param {string} message - Le message à afficher dans le log
   * @returns {void}
   */
  Logger.prototype.log = function (message) {
    if (!this._logContainer) return;
    var p = document.createElement("p");
    p.innerText = message;
    this._logContainer.appendChild(p);
    // Défilement automatique vers le bas pour garder le dernier message visible
    this._logContainer.scrollTop = this._logContainer.scrollHeight;
  };

  /**
   * Efface tous les messages du conteneur de logs.
   * Réinitialise le contenu HTML du conteneur.
   *
   * @returns {void}
   */
  Logger.prototype.clear = function () {
    if (this._logContainer) this._logContainer.innerHTML = "";
  };

  /**
   * Met à jour le texte de l'élément de statut.
   * Utilisé pour afficher l'état courant de la recherche
   * (ex: "Recherche en cours...", "Terminé", etc.).
   *
   * @param {string} message - Le message de statut à afficher
   * @returns {void}
   */
  Logger.prototype.setStatus = function (message) {
    if (this._statusElement) this._statusElement.innerText = message;
  };

  /**
   * Bascule la visibilité du conteneur de logs (afficher/masquer).
   * Alterne entre display "none" et "block".
   *
   * @returns {void}
   */
  Logger.prototype.toggle = function () {
    if (!this._logContainer) return;
    this._logContainer.style.display = this._logContainer.style.display === "none" ? "block" : "none";
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.ui.Logger = Logger;

})(GearApp);
