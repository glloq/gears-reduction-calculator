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
    // §20 : un lien de partage porte la SOLUTION, pas une recherche à
    // relancer. Il passe donc avant l'ancien format d'adresse, qui ne savait
    // transporter que des valeurs de champs.
    var shared = GearApp.ui.ShareLink.carries(window.location.search)
      ? GearApp.ui.ShareLink.decode(window.location.search, _sessionDefaults()) : null;
    var hasURLParams = !shared && GearApp.models.SearchParams.fromURL();
    var source = 'fresh';
    if (shared) {
      // Un lien qui porte une SOLUTION la désigne explicitement : l'ouvrir sur
      // le modal reviendrait à l'ignorer. Un lien qui ne porte qu'un cahier des
      // charges, lui, n'a rien à montrer — c'est une recherche préremplie, et
      // le modal est justement l'endroit où on la reprend.
      source = shared.solution ? 'sharedUrl' : 'localStorage';
      // Le cahier des charges du lien, s'il en porte un : le destinataire peut
      // alors reprendre la recherche là où elle en était, au lieu de deviner.
      if (shared.session) workbench.adoptStoredSession(shared.session);
      else workbench.refreshAfterRestore(false);
    } else if (hasURLParams) {
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
    // La solution partagée est ouverte APRÈS le modal initial : elle doit
    // pouvoir dessiner, et le point de vue ne s'applique qu'une fois le
    // visualiseur en place.
    if (shared) _openSharedSolution(shared);

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

  // ===== §20 : partager la solution qu'on regarde =====

  /** La session neuve qui sert de référence : un lien ne porte que les écarts. */
  function _sessionDefaults() {
    try { return new GearApp.ui.SearchSession().toJSON(); } catch (ignore) { return null; }
  }

  /** Le viseur, s'il existe : il n'est construit qu'au premier dessin. */
  function _viewer() { return GearApp.visualization.viewerToolbar || null; }

  /**
   * CE QU'ON EST EN TRAIN DE MONTRER : la solution affichée, le besoin qui l'a
   * produite, et le point de vue depuis lequel on la regarde. Sans le point de
   * vue, un lien rouvrirait le bon mécanisme sous un autre angle — c'est-à-dire
   * pas ce qu'on montrait.
   */
  function _shareState() {
    var session = workbench && workbench.session ? workbench.session : null;
    var pool = explorer ? explorer.getPool() : [];
    var chosen = explorer ? explorer.selectedIndex() : null;
    var index = chosen == null ? 0 : chosen;
    var solution = pool && pool.length ? (pool[index] || pool[0]) : null;
    var view = _viewer();
    // Le CONTEXTE de ré-analyse, tel que l'éditeur d'étages le prend : rapport
    // visé, régime d'entrée, matériaux. Le demander à la session seule
    // donnerait un régime vide quand l'utilisateur n'en a pas imposé, alors que
    // la recherche, elle, a bien tourné avec les valeurs de service — et le
    // destinataire lirait des couples nuls sous une transmission identique.
    var context = explorer && explorer.getContext ? explorer.getContext() : null;
    var regime = (context && context.engineeringOptions) || {};
    return {
      session: session ? session.toJSON() : null,
      solution: solution ? {
        stages: solution.stages,
        // Le rapport VISÉ, et non celui de la chaîne : c'est lui qui donne son
        // sens à l'écart affiché, et le recalculer chez le destinataire à
        // partir des dentures rendrait tout écart nul.
        target: Number.isFinite(solution.targetRatio) ? solution.targetRatio
          : (context && Number.isFinite(context.target) ? context.target : null),
        // LE RÉGIME DE LA SOLUTION, avant celui du contexte. Une recherche qui
        // n'impose ni vitesse ni couple tourne tout de même avec les valeurs
        // de service, et c'est ce régime-là qui a produit les couples
        // affichés : le lire dans le cahier des charges renverrait « aucun »,
        // et le destinataire lirait des couples nuls sous une transmission
        // identique.
        inputSpeedRpm: Number.isFinite(solution.inputSpeedRpm) ? solution.inputSpeedRpm : regime.inputSpeedRpm,
        inputTorqueNm: Number.isFinite(solution.inputTorqueNm) ? solution.inputTorqueNm : regime.inputTorqueNm
      } : null,
      view: view ? {
        view: view.currentView, projection: view.projection, explode: !!view.explode,
        stage: view.selectedStage >= 0 ? view.selectedStage : null
      } : {}
    };
  }

  function _shareURL() {
    var query = GearApp.ui.ShareLink.encode(_shareState(), _sessionDefaults());
    return window.location.origin + window.location.pathname + '?' + query;
  }

  /**
   * Rouvrir une solution partagée. Elle est RÉ-ANALYSÉE, avec exactement le
   * code d'ingénierie de l'éditeur d'étages : le lien ne porte que ce qui
   * DÉFINIT la chaîne — ses dentures, ses paramètres —, jamais des résultats
   * qu'un moteur plus récent recalculerait autrement.
   */
  function _openSharedSolution(shared) {
    if (!shared || !shared.solution || !workbench || !workbench.session) return;
    var session = workbench.session;
    var helpers = window.GearStageEditorHelpers;
    if (!helpers) return;
    // Le contexte du cahier des charges reçu, puis CE QUE LE LIEN AFFIRME.
    // L'ordre compte : le régime porté par le lien a produit les couples que
    // l'expéditeur avait sous les yeux, et c'est lui qui doit gagner — sans
    // quoi un lien dont le cahier des charges s'est perdu en route rouvrirait
    // la même chaîne sous un autre régime, donc avec d'autres efforts.
    explorer.useParams(session.toSearchParams());
    var context = explorer.getContext();
    if (Number.isFinite(shared.solution.target) && shared.solution.target > 0) {
      context.target = shared.solution.target;
    }
    if (Number.isFinite(shared.solution.inputSpeedRpm)) {
      context.engineeringOptions.inputSpeedRpm = shared.solution.inputSpeedRpm;
    }
    if (Number.isFinite(shared.solution.inputTorqueNm)) {
      context.engineeringOptions.inputTorqueNm = shared.solution.inputTorqueNm;
    }
    var result = helpers.reanalyze(shared.solution.stages, context,
      { Engineering: window.GearEngineering, ManufacturingRules: window.ManufacturingRules,
        Registry: window.GearTransmissionRegistry });
    if (!result || !result.solution) {
      ui.logger.setStatus('Le lien partagé décrit une transmission que ce calculateur ne sait pas analyser.');
      return;
    }
    if (Number.isFinite(shared.solution.target) && shared.solution.target > 0) {
      // Le rapport visé voyage AVEC la solution : un partage repris depuis
      // cette page doit dire la même chose que le premier, même si le cahier
      // des charges s'est perdu entre les deux.
      result.solution.targetRatio = shared.solution.target;
    }
    // Une solution reçue n'est pas un vivier d'une solution : rien à trier,
    // rien à filtrer, rien à comparer à soi-même. C'est la même remarque que
    // pour une chaîne construite, et elle mérite le même écran.
    result.solution.isShared = true;
    explorer.setPool([result.solution], session.toSearchParams(), ui.lastStats(), null, { sort: null });
    ui.logger.setStatus('Solution partagée ouverte.');
    _applySharedView(shared.view);
  }

  /**
   * Le point de vue du lien, une fois le dessin en place. Le visualiseur n'est
   * construit qu'au premier rendu : on le rattrape au tour suivant plutôt que
   * de perdre l'angle que l'expéditeur avait choisi.
   */
  function _applySharedView(view, retry) {
    if (!view) return;
    var viewer = _viewer();
    if (!viewer) {
      if (!retry) setTimeout(function () { _applySharedView(view, true); }, 0);
      return;
    }
    if (view.view) viewer.setView(view.view);
    if (view.projection) viewer.setProjection(view.projection);
    if (view.explode && viewer.setExplode) viewer.setExplode(true);
    if (view.stage != null && view.stage >= 0 && viewer.selectStage) viewer.selectStage(view.stage);
  }

  // ===== Actions d'en-tête et d'espace de travail =====

  function _bindHeaderActions() {
    var theme = document.getElementById('themeBtn');
    if (theme) theme.addEventListener('click', function () { ui.paramForm.toggleTheme(); });

    var share = document.getElementById('shareBtn');
    if (share) {
      share.addEventListener('click', function () {
        // §20 : le lien porte la solution AFFICHÉE, et non les valeurs des
        // champs de recherche. Sans elle, le destinataire recevait un
        // formulaire à relancer, dont rien ne garantissait qu'il retrouverait
        // la solution dont on lui parlait.
        var url = _shareURL();
        // La barre d'adresse suit : le lien qu'on vient de donner est celui de
        // la page qu'on regarde, et un rechargement rouvre la même chose.
        if (window.history && window.history.replaceState) window.history.replaceState(null, '', url);
        var shared = explorer && explorer.getPool().length;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            ui.logger.setStatus(shared ? 'Lien de cette solution copié dans le presse-papiers.'
              : 'Lien du cahier des charges copié dans le presse-papiers.');
          }, function () { ui.logger.setStatus('Lien affiché dans la barre d’adresse.'); });
        } else {
          ui.logger.setStatus('Lien affiché dans la barre d’adresse.');
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
    exporterCSV: function () { ui.exportManager.exportCSV(GearApp.currentSolution || []); },
    // Le verdict tel qu'il a été rendu à l'écran : l'explorateur le détient,
    // l'export le met en forme, personne ne le recalcule.
    exporterDecision: function () {
      var assessment = explorer && explorer._assess ? explorer._assess() : null;
      var session = GearApp._workbench && GearApp._workbench.session;
      ui.exportManager.exportDecisionReport(assessment, {
        requirement: session && session.requirement ? session.requirement.describe && session.requirement.describe() : null,
        priorities: session && session.preferences
          ? { primary: session.preferences.primary, secondary: session.preferences.secondary } : null
      });
    }
  };

  document.addEventListener('DOMContentLoaded', init);

})(GearApp);
