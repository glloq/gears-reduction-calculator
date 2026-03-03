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
    GearApp._engine = engine;

    // Connecter les composants de visualisation
    ui.setVisualizationComponents(null, legacySchema, window.GearCharts || null);

    // Initialiser le formulaire
    ui.paramForm.initSliders();

    // Restaurer depuis l'URL d'abord, sinon depuis localStorage
    var hasURLParams = GearApp.models.SearchParams.fromURL();
    if (!hasURLParams) {
      ui.paramForm.restore();
    }

    ui.paramForm.restoreTheme();
    ui.paramForm.restoreProMode();

    // Initialiser les presets
    _initPresets();

    // Raccourcis clavier
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        lancerRecherche();
      }
      if (e.key === 'Escape' && isSearching) {
        arreterRecherche();
      }
      if (e.key === '?' && !e.ctrlKey && !e.altKey && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        var helpSection = document.querySelector('.help-section');
        if (helpSection) helpSection.open = !helpSection.open;
      }
    });

    // Masquer l'indicateur de chargement
    var loader = document.getElementById('loadingOverlay');
    if (loader) {
      loader.classList.add('loaded');
      setTimeout(function () { loader.style.display = 'none'; }, 300);
    }
  }

  function _initPresets() {
    var grid = document.getElementById('presetsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    var presets = GearApp.models.SearchParams.getPresets();
    for (var key in presets) {
      if (presets.hasOwnProperty(key)) {
        (function (presetId, preset) {
          var btn = document.createElement('button');
          btn.className = 'preset-btn';
          btn.title = preset.description;
          btn.textContent = preset.nom;
          btn.onclick = function () {
            GearApp.models.SearchParams.applyPreset(presetId);
            ui.logger.log('Preset "' + preset.nom + '" appliqué');
            // Update type params if in pro mode
            if (ui.paramForm.isProMode()) {
              ui.paramForm._updateTypeParams();
            }
          };
          grid.appendChild(btn);
        })(key, presets[key]);
      }
    }
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

    // Sauvegarder dans l'historique
    _saveToHistory(searchParams);

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

  // ===== Historique des recherches =====
  var MAX_HISTORY = 20;

  function _saveToHistory(searchParams) {
    try {
      var history = JSON.parse(localStorage.getItem('gearCalcHistory') || '[]');
      var entry = {
        date: new Date().toISOString(),
        rapport: searchParams.rapportCible,
        types: searchParams.typesActifs,
        precision: searchParams.precision,
        etages: searchParams.maxEtages
      };
      history.unshift(entry);
      if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
      localStorage.setItem('gearCalcHistory', JSON.stringify(history));
    } catch (e) { /* ignore */ }
  }

  // ===== Mobile sidebar =====
  function toggleMobileSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    var btn = document.getElementById('mobileMenuBtn');
    var isOpen = sidebar.classList.toggle('sidebar-open');
    overlay.classList.toggle('active', isOpen);
    btn.classList.toggle('active', isOpen);
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    document.body.classList.toggle('sidebar-mobile-open', isOpen);
  }

  // ===== Export de tous les graphiques =====
  function exportAllCharts() {
    var charts = window.GearCharts;
    if (!charts) return;
    var ids = ['ratioChart', 'radarChart', 'cascadeChart', 'powerLossChart', 'safetyChart'];
    ids.forEach(function (id) {
      if (charts.charts[id]) {
        charts.exportChart(id, id + '.png');
      }
    });
  }

  // Ponts globaux pour les attributs onclick du HTML
  window.lancerRecherche = lancerRecherche;
  window.arreterRecherche = arreterRecherche;
  window.sauvegarderParametres = function () { ui.paramForm.save(); ui.logger.log("Paramètres sauvegardés."); };
  window.toggleTheme = function () { ui.paramForm.toggleTheme(); };
  window.toggleProMode = function () { ui.paramForm.toggleProMode(); };
  window.toggleMobileSidebar = toggleMobileSidebar;
  window.exportAllCharts = exportAllCharts;
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
