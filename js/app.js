/**
 * app.js - Point d'entrée de l'application Calculateur d'Engrenages
 *
 * Bootstrap de l'application : instanciation des composants,
 * câblage via EventBus, et liaison des actions utilisateur.
 *
 * Architecture :
 *   - Engine (recherche via Web Worker ou fallback synchrone)
 *   - UIController (orchestre tous les sous-composants UI)
 *   - ComparisonManager (comparaison multi-rapports)
 *   - LegacySchema (schéma Canvas 2D optionnel)
 *
 * Les boutons HTML utilisent des attributs `data-action` au lieu
 * de gestionnaires `onclick` inline, liés ici via délégation d'événements.
 *
 * @see docs/ARCHITECTURE.md pour le flux de données complet
 */
(function (GearApp) {

  /** @type {GearApp.core.Engine} Moteur de recherche */
  var engine;
  /** @type {GearApp.ui.UIController} Contrôleur UI principal */
  var ui;
  /** @type {GearApp.visualization.LegacySchema} Schéma Canvas legacy */
  var legacySchema;
  /** @type {GearApp.ui.ComparisonManager} Gestionnaire de comparaison */
  var comparisonManager;
  /** @type {boolean} Indique si une recherche est en cours */
  var isSearching = false;

  // ===================================================================
  // INITIALISATION
  // ===================================================================

  /**
   * Initialise tous les composants et câble les événements.
   * Appelé au DOMContentLoaded.
   */
  function init() {
    // Instanciation du moteur de recherche
    engine = new GearApp.core.Engine(GearApp.eventBus);

    // Instanciation du contrôleur UI (crée Logger, ResultsTable, etc.)
    ui = new GearApp.ui.UIController(GearApp.eventBus);

    // Schéma legacy Canvas (dans la section <details>)
    legacySchema = new GearApp.visualization.LegacySchema('gearCanvas');

    // Comparaison multi-sorties
    comparisonManager = new GearApp.ui.ComparisonManager('comparisonPanel', GearApp.eventBus);
    comparisonManager.setEngine(engine);
    GearApp._engine = engine; // expose pour ComparisonManager fallback

    // Connecter les composants de visualisation au contrôleur UI
    ui.setVisualizationComponents(null, legacySchema, window.GearCharts || null);

    // Initialiser le formulaire (sliders, restauration, thème)
    ui.paramForm.initSliders();
    ui.paramForm.restore();
    ui.paramForm.restoreTheme();
    ui.paramForm.restoreProMode();

    // Lier les actions des boutons via délégation d'événements
    _bindActions();

    // Raccourcis clavier globaux
    _bindKeyboardShortcuts();
  }

  // ===================================================================
  // LIAISON DES ACTIONS (data-action)
  // ===================================================================

  /**
   * Table de correspondance data-action → fonction.
   * Permet de supprimer les handlers onclick inline du HTML.
   * @type {Object.<string, Function>}
   */
  var ACTION_MAP = {};

  /**
   * Lie tous les boutons `[data-action]` à leurs fonctions respectives.
   * Utilise la délégation d'événements sur le document pour couvrir
   * les boutons présents et futurs (ex: ajoutés dynamiquement).
   */
  function _bindActions() {
    ACTION_MAP = {
      lancerRecherche: lancerRecherche,
      sauvegarderParametres: function () {
        ui.paramForm.save();
        ui.logger.log("Paramètres sauvegardés.");
      },
      toggleTheme: function () { ui.paramForm.toggleTheme(); },
      toggleProMode: function () { ui.paramForm.toggleProMode(); },
      toggleComparison: function () {
        comparisonManager.toggle();
        var btn = document.getElementById('toggleComparisonBtn');
        if (btn) btn.classList.toggle('active', comparisonManager.isOpen());
      },
      toggleAnimation: function () { ui.exportManager.toggleAnimation(); },
      resetSVGView: function () { ui.exportManager.resetView(); },
      exporterSVG: function () { ui.exportManager.exportSVG(); },
      exporterPNG: function () { ui.exportManager.exportPNG(); }
    };

    // Délégation d'événements : un seul listener sur le document
    document.addEventListener('click', function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');
      if (ACTION_MAP[action]) {
        ACTION_MAP[action]();
      }
    });
  }

  // ===================================================================
  // CYCLE DE RECHERCHE
  // ===================================================================

  /**
   * Lance ou arrête la recherche d'engrenages.
   * Bascule entre les deux états via le bouton start/stop.
   */
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

    // Lire et valider les paramètres du formulaire
    var searchParams = ui.paramForm.getSearchParams();
    var validation = searchParams.validate();
    if (!validation.valid) {
      ui.logger.setStatus(validation.message);
      _resetButton();
      return;
    }

    // Lancer la recherche (Worker ou fallback)
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

  /**
   * Arrête la recherche en cours et réinitialise l'interface.
   */
  function arreterRecherche() {
    engine.arreter();
    ui.logger.setStatus("Recherche interrompue");
    _resetButton();
  }

  /**
   * Réinitialise l'état du bouton de recherche après fin ou arrêt.
   * @private
   */
  function _resetButton() {
    var btn = document.getElementById("startStopBtn");
    btn.innerText = "Rechercher";
    btn.classList.remove("running");
    isSearching = false;
  }

  // ===================================================================
  // RACCOURCIS CLAVIER
  // ===================================================================

  /**
   * Lie les raccourcis clavier globaux :
   * - Ctrl+Entrée : lancer la recherche
   * - Échap : arrêter la recherche en cours
   */
  function _bindKeyboardShortcuts() {
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

  // ===================================================================
  // PONTS GLOBAUX (compatibilité avec code legacy éventuel)
  // ===================================================================

  // Conservés pour compatibilité arrière ; les nouvelles interactions
  // passent exclusivement par data-action.
  window.lancerRecherche = lancerRecherche;
  window.arreterRecherche = arreterRecherche;
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

  // ===================================================================
  // DÉMARRAGE
  // ===================================================================

  document.addEventListener('DOMContentLoaded', init);

})(GearApp);
