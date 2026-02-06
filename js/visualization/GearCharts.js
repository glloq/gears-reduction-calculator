// GearCharts.js - Graphiques Chart.js
// Relocalisé dans visualization/ - proxy vers l'instance chargée par js/Charts.js

(function (GearApp) {

  function registerIfReady() {
    if (window.GearCharts) {
      GearApp.visualization.GearCharts = window.GearCharts;
    }
  }

  registerIfReady();
  document.addEventListener('DOMContentLoaded', registerIfReady);

})(GearApp);
