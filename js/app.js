// app.js - Point d'entrée de l'application
// Bootstrap, câblage des composants et gestion du cycle de recherche

(function (GearApp) {

  var engine, ui, legacySchema, comparisonManager, workbench, explorer;
  var isSearching = false;

  function init() {
    engine = new GearApp.core.Engine(GearApp.eventBus);
    ui = new GearApp.ui.UIController(GearApp.eventBus);
    legacySchema = new GearApp.visualization.LegacySchema('gearCanvas');

    comparisonManager = new GearApp.ui.ComparisonManager('comparisonPanel', GearApp.eventBus);
    comparisonManager.setEngine(engine);
    GearApp._engine = engine;

    ui.setVisualizationComponents(null, legacySchema, window.GearCharts || null);

    // La couche Workbench anime le DOM statique de index.html : les
    // identifiants historiques lus par SearchParams sont tous conservés.
    workbench = new GearApp.ui.Workbench(GearApp.eventBus);
    workbench.init();

    // Explorateur de solutions : vivier + barre d'affinage instantané.
    explorer = new GearApp.ui.SolutionExplorer(GearApp.eventBus, {
      workbench: workbench,
      resultsTable: ui.resultsTable,
      uiController: ui
    });
    explorer.bind();
    GearApp._explorer = explorer;

    ui.paramForm.initSliders();

    // Restaurer depuis l'URL d'abord, sinon depuis localStorage.
    var hasURLParams = GearApp.models.SearchParams.fromURL();
    if (!hasURLParams) {
      ui.paramForm.restore();
    }
    // La restauration modifie les contrôles après le premier rendu.
    workbench.refreshAfterRestore();

    ui.paramForm.restoreTheme();
    ui.paramForm.restoreProMode();

    _initPresets();
    _renderHistory();
    _bindHeaderActions();
    _bindWorkspaceActions();
    _bindShortcuts();

    var loader = document.getElementById('loadingOverlay');
    if (loader) {
      loader.classList.add('loaded');
      setTimeout(function () { loader.style.display = 'none'; }, 300);
    }
  }

  // ===== Presets =====

  function _initPresets() {
    var grid = document.getElementById('presetsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    var presets = GearApp.models.SearchParams.getPresets();
    Object.keys(presets).forEach(function (presetId) {
      var preset = presets[presetId];
      var btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.title = preset.description;
      btn.textContent = preset.nom;
      btn.addEventListener('click', function () {
        GearApp.models.SearchParams.applyPreset(presetId);
        workbench.refreshAfterRestore();
        ui.logger.log('Preset "' + preset.nom + '" appliqué');
      });
      grid.appendChild(btn);
    });
  }

  // ===== Cycle de recherche =====

  function lancerRecherche() {
    if (isSearching) {
      arreterRecherche();
      return;
    }

    ui.logger.clear();

    var btn = document.getElementById("startStopBtn");
    btn.innerText = "Arrêter";
    btn.setAttribute('aria-label', 'Arrêter');
    btn.classList.add("running");
    isSearching = true;

    var progressBar = document.getElementById("progress-bar");
    progressBar.style.width = "0%";
    ui.logger.setStatus("Calcul en cours…");

    var searchParams = ui.paramForm.getSearchParams();
    var validationMessage = document.getElementById('validationMessage');
    if (validationMessage) validationMessage.textContent = '';
    if (searchParams.moduleMode === 'automatic' && searchParams.moduleMin && searchParams.moduleMax && searchParams.moduleMax <= searchParams.moduleMin) {
      if (validationMessage) validationMessage.textContent = '⚠ Le module maximum doit être supérieur au minimum.';
      document.getElementById('module_max').setAttribute('aria-invalid', 'true');
      ui.logger.setStatus('Corrigez les paramètres signalés.');
      _resetButton();
      return;
    }
    if (document.getElementById('module_max')) document.getElementById('module_max').removeAttribute('aria-invalid');
    var validation = searchParams.validate();
    if (!validation.valid) {
      if (validationMessage) validationMessage.textContent = validation.message;
      ui.logger.setStatus(validation.message);
      _resetButton();
      return;
    }

    // Persistance automatique : chaque lancement mémorise la configuration.
    searchParams.save();
    _saveToHistory(searchParams);
    _renderHistory();

    engine.rechercher(searchParams).then(function (resultats) {
      explorer.setPool(resultats, searchParams, ui.lastStats());
      progressBar.style.width = "100%";
      ui.logger.setStatus(resultats.length > 0
        ? resultats.length + ' solution(s) dans le vivier'
        : "Aucune solution trouvée"
      );
      _resetButton();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
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
    btn.setAttribute('aria-label', 'Rechercher');
    btn.classList.remove("running");
    isSearching = false;
    var sticky = document.querySelector('.sticky-progress');
    if (sticky) sticky.style.width = '0%';
  }

  // ===== Historique des recherches =====

  var MAX_HISTORY = 20;

  function _saveToHistory(searchParams) {
    try {
      var history = JSON.parse(localStorage.getItem('gearCalcHistory') || '[]');
      var entry = {
        date: new Date().toISOString(),
        mode: searchParams.objectiveMode || 'ratio',
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

  function _renderHistory() {
    var list = document.getElementById('historyList');
    if (!list) return;
    var history = [];
    try { history = JSON.parse(localStorage.getItem('gearCalcHistory') || '[]'); } catch (e) { /* ignore */ }
    list.innerHTML = '';
    if (!history.length) {
      list.innerHTML = '<p class="field-help">Aucune recherche récente.</p>';
      return;
    }
    history.slice(0, 8).forEach(function (entry) {
      var btn = document.createElement('button');
      btn.className = 'history-entry';
      var when = new Date(entry.date);
      var label = entry.mode === 'rotationTranslation'
        ? 'Linéaire'
        : (Number.isFinite(entry.rapport) ? Number(entry.rapport).toFixed(2) + ':1 ± ' + entry.precision + ' %' : 'Recherche');
      btn.innerHTML = '<strong>' + label + '</strong><span>' + (entry.types || []).join(', ') +
        ' · ≤ ' + entry.etages + ' étages</span><small>' + when.toLocaleDateString('fr-FR') + ' ' +
        when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</small>';
      btn.addEventListener('click', function () { _applyHistoryEntry(entry); });
      list.appendChild(btn);
    });
  }

  function _applyHistoryEntry(entry) {
    if (entry.mode === 'rotationTranslation') {
      var objective = document.getElementById('objective_mode');
      if (objective) objective.value = 'rotationTranslation';
    } else {
      var objectiveEl = document.getElementById('objective_mode');
      if (objectiveEl && objectiveEl.value === 'rotationTranslation') objectiveEl.value = 'ratio';
      if (Number.isFinite(entry.rapport)) document.getElementById('rapport').value = entry.rapport;
      if (entry.precision !== undefined) document.getElementById('precision').value = entry.precision;
      if (entry.etages !== undefined) document.getElementById('etages').value = entry.etages;
      if (Array.isArray(entry.types)) {
        document.querySelectorAll('.type-checkbox').forEach(function (cb) {
          if (cb.value !== 'rack') cb.checked = entry.types.indexOf(cb.value) !== -1;
        });
      }
    }
    workbench.refreshAfterRestore();
    ui.logger.log('Recherche précédente rechargée.');
  }

  // ===== Actions d'en-tête et d'espace de travail =====

  function _bindHeaderActions() {
    var mode = document.getElementById('proModeBtn');
    if (mode) mode.addEventListener('click', function () { ui.paramForm.toggleProMode(); });

    var theme = document.getElementById('themeBtn');
    if (theme) theme.addEventListener('click', function () { ui.paramForm.toggleTheme(); });

    var share = document.getElementById('shareBtn');
    if (share) {
      share.addEventListener('click', function () {
        var url = GearApp.models.SearchParams.toURL ? GearApp.models.SearchParams.toURL() : location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            ui.logger.setStatus('Lien copié dans le presse-papiers.');
          });
        }
      });
    }

    var mobile = document.getElementById('mobileMenuBtn');
    if (mobile) mobile.addEventListener('click', toggleMobileSidebar);
    var overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.addEventListener('click', toggleMobileSidebar);
  }

  function _bindWorkspaceActions() {
    var start = document.getElementById('startStopBtn');
    if (start) start.addEventListener('click', lancerRecherche);

    var comparison = document.getElementById('toggleComparisonBtn');
    if (comparison) comparison.addEventListener('click', toggleComparison);

    var exportCharts = document.getElementById('exportChartsBtn');
    if (exportCharts) exportCharts.addEventListener('click', exportAllCharts);
  }

  function _bindShortcuts() {
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
  }

  // ===== Mobile =====

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

  // ===== Comparaison multi-sorties =====

  function toggleComparison() {
    if (document.getElementById('objective_mode').value === 'rotationTranslation') {
      ui.logger.setStatus('La comparaison multi-sorties est réservée aux transmissions rotatives.');
      return;
    }
    comparisonManager.toggle();
    var btn = document.getElementById('toggleComparisonBtn');
    if (btn) btn.classList.toggle('active', comparisonManager.isOpen());
  }

  // ===== Export des graphiques =====

  function exportAllCharts() {
    var charts = window.GearCharts;
    if (!charts) return;
    ['ratioChart', 'radarChart', 'cascadeChart', 'powerLossChart', 'safetyChart'].forEach(function (id) {
      if (charts.charts[id]) {
        charts.exportChart(id, id + '.png');
      }
    });
  }

  // Ponts globaux (menu d'export, comparaison, tests)
  window.lancerRecherche = lancerRecherche;
  window.arreterRecherche = arreterRecherche;
  window.toggleTheme = function () { ui.paramForm.toggleTheme(); };
  window.toggleProMode = function () { ui.paramForm.toggleProMode(); };
  window.toggleMobileSidebar = toggleMobileSidebar;
  window.exportAllCharts = exportAllCharts;
  window.toggleComparison = toggleComparison;

  window.UI = {
    afficherResultats: function (solutions) { ui.afficherResultats(solutions); },
    afficherMessageStatus: function (msg) { ui.logger.setStatus(msg); },
    ajouterLog: function (msg) { ui.logger.log(msg); },
    toggleLogs: function () { ui.logger.toggle(); },
    clearLogs: function () { ui.logger.clear(); },
    toggleAnimation: function () { ui.exportManager.toggleAnimation(); },
    resetSVGView: function () { ui.exportManager.resetView(); },
    exporterSVG: function () { ui.exportManager.exportSVG(); },
    exporterPNG: function () { ui.exportManager.exportPNG(); },
    exporterJSON: function () { ui.exportManager.exportJSON({ input: ui._lastSearchParams || {}, constraints: (ui._lastSearchParams && ui._lastSearchParams.constraints) || {}, solution: GearApp.currentSolution || null, materials: { input: ui._lastSearchParams && ui._lastSearchParams.inputMaterial, output: ui._lastSearchParams && ui._lastSearchParams.outputMaterial } }); },
    exporterCSV: function () { ui.exportManager.exportCSV(GearApp.currentSolution || []); }
  };

  document.addEventListener('DOMContentLoaded', init);

})(GearApp);
