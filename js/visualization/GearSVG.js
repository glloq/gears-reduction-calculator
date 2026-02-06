// GearSVG.js - Visualisation SVG interactive des engrenages
// Relocalisé dans visualization/ - classe inchangée, namespace mis à jour

(function (GearApp) {

  // La classe GearSVG complète est définie dans le fichier original js/GearSVG.js
  // On la re-exporte ici en l'enregistrant dans le namespace
  // NOTE : le fichier original est conservé pour compatibilité, ce fichier
  // est un proxy qui s'appuie sur la classe chargée par js/GearSVG.js

  // Attacher au namespace après chargement
  function registerIfReady() {
    if (window.GearSVG) {
      GearApp.visualization.GearSVG = window.GearSVG;
    }
  }

  // Vérifier immédiatement et aussi au DOMContentLoaded
  registerIfReady();
  document.addEventListener('DOMContentLoaded', registerIfReady);

})(GearApp);
