/**
 * @module visualization/GearCharts
 * @description Proxy de namespace pour l'instance singleton GearCharts.
 *
 * Ce fichier fait partie de l'architecture modulaire à base d'IIFE et de namespace
 * (GearApp.visualization). Il ne contient PAS la logique des graphiques Chart.js,
 * qui est entièrement définie dans le fichier principal js/Charts.js.
 *
 * Pattern proxy :
 *   Le fichier js/Charts.js instancie un singleton GearCharts et l'expose sur
 *   window (window.GearCharts). Ce fichier proxy récupère cette instance globale
 *   et l'enregistre dans le namespace structuré GearApp.visualization.GearCharts,
 *   permettant ainsi l'accès via :
 *     - window.GearCharts (legacy, compatibilité directe)
 *     - GearApp.visualization.GearCharts (namespace organisé)
 *
 * Différence avec le proxy GearSVG :
 *   Contrairement à GearSVG qui expose une classe (constructeur), Charts.js expose
 *   une instance déjà construite (singleton). Le proxy enregistre donc l'instance,
 *   pas la classe.
 *
 * Stratégie d'enregistrement :
 *   L'enregistrement est tenté immédiatement (cas où js/Charts.js est chargé avant)
 *   et aussi au DOMContentLoaded (cas où l'ordre de chargement n'est pas garanti).
 *
 * @see {@link module:GearCharts} pour la classe complète
 * @see js/namespace.js pour la définition du namespace GearApp
 */
(function (GearApp) {

  /**
   * Enregistre l'instance GearCharts dans le namespace si elle est disponible.
   * Vérifie l'existence de window.GearCharts avant de l'assigner.
   * @private
   */
  function registerIfReady() {
    if (window.GearCharts) {
      GearApp.visualization.GearCharts = window.GearCharts;
    }
  }

  // Tentative d'enregistrement immédiate (si le script principal est déjà chargé)
  registerIfReady();
  // Tentative au DOMContentLoaded (garantit que tous les scripts sont chargés)
  document.addEventListener('DOMContentLoaded', registerIfReady);

})(GearApp);
