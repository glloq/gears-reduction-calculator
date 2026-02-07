/**
 * @module visualization/GearSVG
 * @description Proxy de namespace pour la classe GearSVG.
 *
 * Ce fichier fait partie de l'architecture modulaire à base d'IIFE et de namespace
 * (GearApp.visualization). Il ne contient PAS la logique de visualisation SVG,
 * qui est entièrement définie dans le fichier principal js/GearSVG.js.
 *
 * Pattern proxy :
 *   Le fichier js/GearSVG.js expose la classe GearSVG sur window (window.GearSVG)
 *   pour assurer la compatibilité avec le chargement par balises <script>.
 *   Ce fichier proxy récupère cette classe globale et l'enregistre dans le namespace
 *   structuré GearApp.visualization.GearSVG, permettant ainsi l'accès via :
 *     - window.GearSVG (legacy, compatibilité directe)
 *     - GearApp.visualization.GearSVG (namespace organisé)
 *
 * Stratégie d'enregistrement :
 *   L'enregistrement est tenté immédiatement (cas où js/GearSVG.js est chargé avant)
 *   et aussi au DOMContentLoaded (cas où l'ordre de chargement n'est pas garanti).
 *
 * @see {@link module:GearSVG} pour la classe complète
 * @see js/namespace.js pour la définition du namespace GearApp
 */
(function (GearApp) {

  /**
   * Enregistre la classe GearSVG dans le namespace si elle est disponible.
   * Vérifie l'existence de window.GearSVG avant de l'assigner.
   * @private
   */
  function registerIfReady() {
    if (window.GearSVG) {
      GearApp.visualization.GearSVG = window.GearSVG;
    }
  }

  // Tentative d'enregistrement immédiate (si le script principal est déjà chargé)
  registerIfReady();
  // Tentative au DOMContentLoaded (garantit que tous les scripts sont chargés)
  document.addEventListener('DOMContentLoaded', registerIfReady);

})(GearApp);
