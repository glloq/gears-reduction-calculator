/**
 * @file ExportManager.js - Export SVG/PNG et contrôle d'animation
 * @description Gestionnaire d'exportation pour la visualisation SVG des engrenages.
 *              Permet l'export en fichiers SVG et PNG, le contrôle de l'animation
 *              du train d'engrenages et la réinitialisation de la vue.
 *              Utilise le moteur de rendu GearSVG comme dépendance injectable.
 * @namespace GearApp.ui.ExportManager
 */

(function (GearApp) {

  // ===== Constructeur =====

  /**
   * Crée une instance d'ExportManager.
   * Initialise sans moteur de rendu ; celui-ci doit être injecté via setRenderer().
   *
   * @constructor
   */
  function ExportManager() {
    /** @type {GearSVG|null} @private Référence vers le moteur de rendu SVG des engrenages */
    this._gearSvg = null;
  }

  // ===== Configuration =====

  /**
   * Définit le moteur de rendu SVG utilisé pour les exports et le contrôle d'animation.
   * Doit être appelé avant toute opération d'export.
   *
   * @param {GearSVG} gearSvg - Instance du moteur de rendu SVG des engrenages
   * @returns {void}
   */
  ExportManager.prototype.setRenderer = function (gearSvg) {
    this._gearSvg = gearSvg;
  };

  // ===== Export =====

  /**
   * Exporte le schéma d'engrenages courant au format SVG.
   * Récupère le contenu SVG brut depuis le moteur de rendu,
   * crée un Blob et déclenche le téléchargement du fichier.
   *
   * @returns {void}
   */
  ExportManager.prototype.exportSVG = function () {
    if (!this._gearSvg) return;
    var svgData = this._gearSvg.exportSVG();
    var blob = new Blob([svgData], { type: "image/svg+xml" });
    this._download(blob, "engrenages.svg");
  };

  /**
   * Exporte le schéma d'engrenages courant au format PNG.
   * Utilise le callback asynchrone du moteur de rendu pour obtenir
   * le Blob PNG, puis déclenche le téléchargement.
   *
   * @returns {void}
   */
  ExportManager.prototype.exportPNG = function () {
    if (!this._gearSvg) return;
    var self = this;
    // Le moteur de rendu convertit le SVG en PNG via un Canvas interne
    this._gearSvg.exportPNG(function (blob) {
      if (blob) self._download(blob, "engrenages.png");
    });
  };

  // ===== Contrôle de la visualisation =====

  /**
   * Bascule l'animation du train d'engrenages (démarrer/arrêter).
   * Délègue au moteur de rendu SVG.
   *
   * @returns {void}
   */
  ExportManager.prototype.toggleAnimation = function () {
    if (this._gearSvg) this._gearSvg.toggleAnimation();
  };

  /**
   * Réinitialise la vue du schéma SVG (zoom et position par défaut).
   * Délègue au moteur de rendu SVG.
   *
   * @returns {void}
   */
  ExportManager.prototype.resetView = function () {
    if (this._gearSvg) this._gearSvg.resetView();
  };

  // ===== Méthodes privées =====

  /**
   * Déclenche le téléchargement d'un fichier à partir d'un Blob.
   * Crée un lien temporaire <a> avec un Object URL, simule un clic,
   * puis nettoie le lien et libère l'URL.
   *
   * @private
   * @param {Blob} blob - Le contenu du fichier à télécharger
   * @param {string} filename - Le nom du fichier proposé au téléchargement
   * @returns {void}
   */
  ExportManager.prototype._download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    // Nettoyage : retirer le lien temporaire et libérer l'Object URL
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.ui.ExportManager = ExportManager;

})(GearApp);
