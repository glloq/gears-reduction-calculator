// app.js - Point d'entrée de l'application
// Bootstrap, câblage des composants et gestion du cycle de recherche

(function (GearApp) {

  var engine, ui, legacySchema, comparisonManager;
  var isSearching = false;

  function init() {
    // Instanciation du moteur de recherche
    engine = new GearApp.core.Engine(GearApp.eventBus);

    // Instanciation du contrôleur UI
    ui = new GearApp.ui.UIController(GearApp.eventBus);

    // Schéma legacy Canvas
    legacySchema = new GearApp.visualization.LegacySchema('gearCanvas');

    // Comparaison multi-sorties
    comparisonManager = new GearApp.ui.ComparisonManager('comparisonPanel', GearApp.eventBus);
    comparisonManager.setEngine(engine);
    GearApp._engine = engine; // expose pour ComparisonManager fallback

    // Connecter les composants de visualisation
    ui.setVisualizationComponents(null, legacySchema, window.GearCharts || null);

    // Initialiser le formulaire
    ui.paramForm.initSliders();
    ui.paramForm.restore();
    ui.paramForm.restoreTheme();
    ui.paramForm.restoreProMode();

    // Raccourcis clavier
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        lancerRecherche();
      }
      if (e.key === 'Escape' && isSearching) {
        arreterRecherche();
      }
    });
  }

  function lancerRecherche() {
    if (isSearching) {
      arreterRecherche();
      return;
    }

    ui.logger.clear();

    var btn = document.getElementById("startStopBtn");
    btn.innerText = "Arrêter";
    btn.classList.add("running");
    isSearching = true;

    var progressBar = document.getElementById("progress-bar");
    progressBar.style.width = "0%";
    progressBar.style.display = "block";
    ui.logger.setStatus("Calcul en cours...");

    var searchParams = ui.paramForm.getSearchParams();
    var validation = searchParams.validate();
    if (!validation.valid) {
      ui.logger.setStatus(validation.message);
      _resetButton();
      return;
    }

    engine.rechercher(searchParams).then(function (resultats) {
      ui.afficherResultats(resultats, searchParams);
      progressBar.style.width = "100%";
      ui.logger.setStatus(resultats.length > 0
        ? 'Calcul terminé - ' + resultats.length + ' solution(s) trouvée(s)'
        : "Aucun engrenage trouvé"
      );
      _resetButton();
    }).catch(function (err) {
      ui.logger.setStatus("Erreur lors du calcul");
      console.error(err);
      _resetButton();
    });
  }

  function arreterRecherche() {
    engine.arreter();
    ui.logger.setStatus("Recherche interrompue");
    _resetButton();
  }

  function _resetButton() {
    var btn = document.getElementById("startStopBtn");
    btn.innerText = "Rechercher";
    btn.classList.remove("running");
    isSearching = false;
  }

  // Ponts globaux pour les attributs onclick du HTML
  window.lancerRecherche = lancerRecherche;
  window.arreterRecherche = arreterRecherche;
  window.sauvegarderParametres = function () { ui.paramForm.save(); ui.logger.log("Paramètres sauvegardés."); };
  window.toggleTheme = function () { ui.paramForm.toggleTheme(); };
  window.toggleProMode = function () { ui.paramForm.toggleProMode(); };
  window.toggleComparison = function () {
    comparisonManager.toggle();
    var btn = document.getElementById('toggleComparisonBtn');
    if (btn) btn.classList.toggle('active', comparisonManager.isOpen());
  };

  // Pont pour les boutons de visualisation (UI.xxx dans le HTML)
  window.UI = {
    afficherResultats: function (solutions) { ui.afficherResultats(solutions); },
    afficherMessageStatus: function (msg) { ui.logger.setStatus(msg); },
    ajouterLog: function (msg) { ui.logger.log(msg); },
    toggleLogs: function () { ui.logger.toggle(); },
    clearLogs: function () { ui.logger.clear(); },
    toggleAnimation: function () { ui.exportManager.toggleAnimation(); },
    resetSVGView: function () { ui.exportManager.resetView(); },
    exporterSVG: function () { ui.exportManager.exportSVG(); },
    exporterPNG: function () { ui.exportManager.exportPNG(); }
  };

  document.addEventListener('DOMContentLoaded', init);

})(GearApp);
