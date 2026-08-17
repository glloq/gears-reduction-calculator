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
    // Poignée d'inspection, au même titre que `_explorer` : les tests de bout
    // en bout vérifient ainsi le MODÈLE, et pas seulement ce que le DOM affiche.
    GearApp._workbench = workbench;

    // Éditeur d'étages : ré-analyse locale d'une solution sélectionnée.
    var stageEditor = new GearApp.ui.StageEditor(GearApp.eventBus, 'stageEditor', explorer);
    stageEditor.bind();
    GearApp._stageEditor = stageEditor;

    // Comparaison de solutions épinglées (onglet Comparer).
    var comparePanel = new GearApp.ui.ComparePanel(GearApp.eventBus, 'compareSolutionsPanel', explorer);
    comparePanel.bind();

    ui.paramForm.initSliders();

    // D'où vient la recherche affichée au démarrage ? La question n'était pas
    // posée, et la réponse changeait le comportement en silence : une vieille
    // configuration rangée dans le localStorage par une version précédente
    // suffisait à faire croire à une session « non vide », donc à sauter le
    // modal — alors que l'utilisateur ouvrait l'application pour chercher.
    var hasURLParams = GearApp.models.SearchParams.fromURL();
    var source = 'fresh';
    if (hasURLParams) {
      source = 'sharedUrl';
      workbench.refreshAfterRestore(true);
    } else {
      // §2 : la session rangée sous son propre schéma prime sur l'ancien
      // format plat — elle porte le MODÈLE, pas le reflet des champs.
      var stored = GearApp.ui.SessionStore.load();
      if (stored) {
        source = 'localStorage';
        workbench.adoptStoredSession(stored.session);
      } else if (ui.paramForm.restore()) {
        source = 'localStorage';
        workbench.refreshAfterRestore(true);
      } else {
        workbench.refreshAfterRestore(false);
      }
    }
    workbench.openInitialSearchModal(source);

    ui.paramForm.restoreTheme();

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

    // Choix 20C : la recherche part du MODÈLE, plus du formulaire. Le
    // formulaire n'est plus qu'un reflet, écrit par la session.
    var session = workbench && workbench.session;

    // Une chaîne entièrement décrite n'a rien à faire chercher : elle se
    // CALCULE. Lancer le solveur pour retrouver ce que l'utilisateur vient
    // d'écrire serait à la fois lent et absurde — et le vivier retournerait
    // des variantes que personne n'a demandées.
    if (session && session.plannedEngine() === 'analyze') {
      _analyzeBuiltChain(session);
      return;
    }
    // Une exploration ne lance pas UNE recherche mais une série de recherches
    // bornées, dont on réunit les viviers. Les paramètres validés sont ceux de
    // la première bande : ce sont eux qui partiront réellement au moteur.
    var plan = session ? session.explorationPlan() : null;
    var searchParams = plan ? plan.runs[0] : (session ? session.toSearchParams() : ui.paramForm.getSearchParams());
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
    //
    // §29 : la session part sous son schéma versionné, et c'est TOUT. Le format
    // plat n'est plus écrit : au démarrage, adopter la session réécrit les
    // miroirs depuis le modèle, donc rien de ce qu'il portait n'est perdu — il
    // n'était plus qu'une seconde mémoire, jamais relue, et donc périmée dès la
    // première recherche. Il reste lu une dernière fois pour convertir une
    // configuration d'avant la refonte ; ensuite il est effacé.
    if (session) {
      GearApp.ui.SessionStore.save(session);
      GearApp.ui.SessionStore.dropLegacy();
    } else {
      searchParams.save();
    }
    _saveToHistory(searchParams);
    _renderHistory();

    (plan ? _explore(plan) : engine.rechercher(searchParams)).then(function (rawResults) {
      // Le moteur ne sait pas tout filtrer : la session applique ce qui reste.
      var resultats = session ? session.filterPool(rawResults) : rawResults;
      // Améliorer l'existant : la référence entre dans le vivier, sinon
      // « plus compact » n'aurait rien à quoi se comparer.
      var reference = session ? session.baseline() : null;
      if (reference) resultats = [reference].concat(resultats);
      progressBar.style.width = "100%";
      // Le moteur a trouvé, mais une contrainte qu'il ne sait pas exprimer a
      // tout écarté : le dire, plutôt que sonder et accuser autre chose.
      if (!resultats.length && rawResults.length && session) {
        var blocked = session.effectivePreferences().clientConstraints();
        explorer.setPool([], searchParams, ui.lastStats(), {
          status: 'client-filtered', blocker: null, candidates: [],
          text: 'Le moteur a trouvé ' + rawResults.length + ' architecture(s), mais ' +
            (blocked.length ? blocked.map(function (entry) { return entry.meta.label.toLowerCase(); }).join(', ') : 'une exigence') +
            ' les écarte toutes. Assouplissez cette exigence, ou élargissez les technologies explorées.'
        });
        ui.logger.setStatus('Aucune solution trouvée');
        _resetButton();
        return;
      }
      if (!resultats.length && session) {
        // Choix 14C : « aucun résultat » déclenche une SONDE — la même
        // recherche, contraintes de qualification levées — pour pouvoir dire
        // de combien on rate et ce qu'un assouplissement débloquerait.
        return _probeForNearMiss(session, searchParams).then(function (diagnosis) {
          explorer.setPool(resultats, searchParams, ui.lastStats(), diagnosis);
          ui.logger.setStatus('Aucune solution trouvée');
          _resetButton();
        });
      }
      // §24 : d'où vient chaque valeur. Une chaîne complétée est sinon
      // indiscernable d'une chaîne trouvée de bout en bout.
      _stampOrigin(session, resultats);
      explorer.setPool(resultats, searchParams, ui.lastStats(), null,
        session ? { sort: session.poolSort() } : null);
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

  /**
   * Modes « Construire » et « Étudier l'existant », chaîne complète : on
   * analyse ce qui est décrit, avec exactement le même code d'ingénierie que
   * pour une solution trouvée. Deux jeux de formules donneraient deux vérités,
   * et « ce que fait mon mécanisme » ne serait plus comparable à « ce que ferait
   * son remplaçant ».
   */
  function _analyzeBuiltChain(session) {
    var progressBar = document.getElementById('progress-bar');
    var solution = null;
    try { solution = session.analyzeBuild(); } catch (error) { solution = null; }
    if (progressBar) progressBar.style.width = '100%';
    GearApp.ui.SessionStore.save(session);
    GearApp.ui.SessionStore.dropLegacy();
    if (!solution) {
      var errors = session.build.errors();
      explorer.setPool([], session.toSearchParams(), ui.lastStats(), {
        status: 'client-filtered', blocker: null, candidates: [],
        text: errors.length
          ? 'La chaîne décrite n’est pas réalisable : ' + errors.map(function (entry) {
            return 'étage ' + entry.stage + ', ' + entry.text.toLowerCase();
          }).join(' ; ') + '.'
          : 'La chaîne décrite n’a pas pu être analysée. Vérifiez les dentures et le module.'
      });
      ui.logger.setStatus('Chaîne non analysable');
      _resetButton();
      return;
    }
    _stampOrigin(session, [solution]);
    explorer.setPool([solution], session.toSearchParams(), ui.lastStats(), null, { sort: null });
    ui.logger.setStatus('Transmission analysée');
    _resetButton();
  }

  /**
   * Marque les solutions d'une chaîne construite avec ce que l'utilisateur avait
   * épinglé. Toutes les solutions d'un même « compléter » partagent la même
   * origine : ce sont les mêmes contraintes qui les ont produites.
   */
  function _stampOrigin(session, solutions) {
    if (!session || !session.workspace.editsChain() || session.build.isEmpty()) return;
    var origin = session.build.toOrigin();
    (solutions || []).forEach(function (solution) {
      if (solution && !solution.isExisting) solution.origin = origin;
    });
  }

  /** Vivier maximal d'une exploration : au-delà, la barre d'affinage trie du bruit. */
  var MAX_EXPLORATION_POOL = 400;

  /**
   * Balaye l'espace de conception bande par bande. Les recherches sont
   * SÉQUENTIELLES : un seul worker à la fois, donc un « Arrêter » qui arrête
   * vraiment, et une barre de progression qui avance pour de bon.
   */
  function _explore(plan) {
    var Planner = GearApp.requirements.ExplorationPlanner;
    var pools = [], total = plan.runs.length;
    var chain = plan.runs.reduce(function (previous, params, index) {
      return previous.then(function () {
        if (!isSearching) return null;                 // interrompu entre deux bandes
        var band = params.explorationBand;
        ui.logger.setStatus('Exploration ' + (index + 1) + '/' + total +
          ' — rapports ' + _shortRatio(band.min) + ' à ' + _shortRatio(band.max) + ':1');
        var bar = document.getElementById('progress-bar');
        if (bar) bar.style.width = Math.round(index / total * 100) + '%';
        return engine.rechercher(params).then(function (pool) { pools.push(pool || []); });
      });
    }, Promise.resolve());
    return chain.then(function () {
      var merged = Planner.merge(pools, plan.objective, MAX_EXPLORATION_POOL);
      ui.logger.setStatus(merged.length + ' architecture(s) dans l’espace exploré');
      return merged;
    });
  }

  function _shortRatio(value) {
    return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  }

  /**
   * Relance la recherche sans les contraintes dures, uniquement pour mesurer
   * l'écart. Le vivier sonde n'est jamais affiché : il ne sert qu'au diagnostic.
   */
  function _probeForNearMiss(session, searchParams) {
    var NearMiss = GearApp.requirements.NearMissAnalyzer;
    var preferences = session.effectivePreferences();
    var probePreferences = NearMiss.probePreferences(preferences);
    // Le conseil dépend de ce qui a été DÉCIDÉ : sur une chaîne construite,
    // « élargissez les technologies » revient à conseiller d'annuler la chaîne.
    var context = _diagnosisContext(session, searchParams);
    if (!preferences.constraints().length) {
      return Promise.resolve(NearMiss.analyze([], preferences, context));
    }
    var probeParams = session.toSearchParams({ preferences: probePreferences });
    return engine.rechercher(probeParams)
      .then(function (pool) { return NearMiss.analyze(pool, preferences, context); })
      .catch(function () { return null; });
  }

  /** Ce qui reste réellement ajustable, pour que le diagnostic le nomme. */
  function _diagnosisContext(session, searchParams) {
    if (!session || !session.workspace.editsChain() || session.build.isEmpty()) return null;
    var gearing = session.technical.gearing;
    return {
      chain: true,
      unknownStages: session.build.unknownCount(),
      teethRange: {
        min: Math.min(gearing.drivingMin, gearing.drivenMin),
        max: Math.max(gearing.drivingMax, gearing.drivenMax)
      }
    };
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
    exporterSVGTechnique: function () { ui.exportManager.exportTechnicalSVG(); },
    exporterPNG: function () { ui.exportManager.exportPNG(); },
    exporterJSON: function () { ui.exportManager.exportJSON({ input: ui._lastSearchParams || {}, constraints: (ui._lastSearchParams && ui._lastSearchParams.constraints) || {}, solution: GearApp.currentSolution || null, materials: { input: ui._lastSearchParams && ui._lastSearchParams.inputMaterial, output: ui._lastSearchParams && ui._lastSearchParams.outputMaterial } }); },
    exporterCSV: function () { ui.exportManager.exportCSV(GearApp.currentSolution || []); }
  };

  document.addEventListener('DOMContentLoaded', init);

})(GearApp);
