// SolutionExplorer.js - Propriétaire du vivier de solutions et de la barre
// d'affinage. La recherche remplit le vivier ; l'affinage filtre/trie côté
// client (GearSolutionFilter) sans jamais relancer le moteur.
//
// Contrat de sélection : toute vue transporte des paires {solution, index} où
// index est la position dans le vivier d'origine ; `solution:selected {index}`
// garde ce sens, index === -1 signifiant « hors vivier » (variante/épingle).
(function (GearApp) {
  'use strict';

  // §19 : le nom d'une famille vient du registre, pas d'une table locale.
  var familyName = GearTransmissionRegistry.familyName;


  function el(id) { return document.getElementById(id); }
  function optionalNumber(id) {
    var input = el(id);
    if (!input) return null;
    var raw = String(input.value).trim();
    if (raw === '') return null;
    var value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function SolutionExplorer(eventBus, refs) {
    this.bus = eventBus || GearApp.eventBus;
    this.workbench = refs.workbench;
    this.resultsTable = refs.resultsTable;
    this.ui = refs.uiController;
    this._pool = [];
    this._params = null;
    this._workerParams = null;
    this._stats = null;
    this._nextUid = 1;
    this._disabledTypes = {};
    this._debounce = null;
  }

  // §15 : LE CATALOGUE DES FILTRES N'EST PLUS ÉCRIT ICI.
  //
  // Il l'était : sept champs, recopiés à la main, à côté des seize grandeurs
  // que `PreferenceModel` décrit déjà — avec leur unité, leur sens et la façon
  // de les LIRE sur une solution. Deux listes pour une même notion, c'est une
  // divergence programmée : ce qu'on peut demander avant la recherche finissait
  // par ne plus correspondre à ce qu'on peut filtrer après. Une seule liste,
  // et ajouter une grandeur au catalogue commun la rend filtrable sans toucher
  // à ce fichier.
  function filterCatalog() {
    return (GearMetricRegistry ? GearMetricRegistry.filters() : []).map(function (entry) {
      return {
        category: entry.category, field: entry.field, label: entry.label,
        name: entry.name, unit: entry.unit, suggest: entry.suggest, step: entry.step
      };
    });
  }

  /**
   * Les champs que le catalogue réclame et que le markup ne porte pas : ils
   * sont créés au vol, dans le même conteneur. Sans cela, ajouter une grandeur
   * au catalogue commun ne suffirait pas — il faudrait encore l'écrire dans le
   * HTML, c'est-à-dire retomber dans deux listes.
   */
  function ensureFields() {
    var host = document.querySelector('.refine-fields');
    if (!host || !GearMetricRegistry) return;
    GearMetricRegistry.filters().forEach(function (entry) {
      if (document.getElementById(entry.field)) return;
      var label = document.createElement('label');
      label.className = 'sub' + (entry.linear ? ' refine-linear' : ' refine-rotary');
      if (entry.note) label.title = entry.note;
      label.appendChild(document.createTextNode(entry.label + (entry.unit ? ' ' + entry.unit : '')));
      var input = document.createElement('input');
      input.id = entry.field;
      input.type = 'number';
      input.min = '0';
      if (entry.step) input.step = String(entry.step);
      input.placeholder = '—';
      label.appendChild(input);
      host.appendChild(label);
    });
  }

  SolutionExplorer.prototype.bind = function () {
    var self = this;
    ensureFields();
    var FILTERS = filterCatalog();
    var FILTER_CATEGORIES = GearMetricRegistry ? GearMetricRegistry.CATEGORIES : [];
    // Les filtres deviennent des chips : seuls les critères réellement posés
    // occupent de la place.
    this.filters = new GearConstraintManager.Manager({
      host: el('refineChips'),
      menu: el('refineMenu'),
      trigger: el('addFilterBtn'),
      catalog: FILTERS,
      categories: FILTER_CATEGORIES,
      sidebar: 'refineBar',
      onChange: function () { self._schedulePublish(); }
    }).bind();

    FILTERS.forEach(function (entry) {
      var input = el(entry.field);
      if (!input) return;
      input.addEventListener('input', function () { self._schedulePublish(); });
    });
    var sort = el('refine_sort');
    if (sort) sort.addEventListener('change', function () { self._publish(false); });

    var chips = el('refineTypeChips');
    if (chips) {
      chips.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-type]');
        if (!chip) return;
        var type = chip.dataset.type;
        self._disabledTypes[type] = !self._disabledTypes[type];
        chip.classList.toggle('active', !self._disabledTypes[type]);
        chip.setAttribute('aria-pressed', String(!self._disabledTypes[type]));
        self._publish(false);
        self._renderChips();
      });
    }

    var reset = el('refineResetBtn');
    if (reset) reset.addEventListener('click', function () { self._resetCriteria(); self._publish(false); });

    // La sélection peut venir d'ailleurs (clic sur une carte, éditeur d'étages) :
    // sans l'écouter, l'explorateur croirait toujours afficher la première.
    this.bus.on('solution:selected', function (data) { self._selectedIndex = data.index; });
  };

  // ===== Vivier =====

  SolutionExplorer.prototype.setPool = function (solutions, searchParams, stats, diagnosis, options) {
    var self = this;
    // Une exploration classe par la performance poursuivie : « recommandé »
    // répondrait à une autre question que celle qui a été posée.
    this._defaultSort = (options && options.sort) || 'recommended';
    this._pool = solutions || [];
    this._pool.forEach(function (solution) {
      if (solution.uid === undefined) {
        Object.defineProperty(solution, 'uid', { value: self._nextUid++, enumerable: false });
      }
    });
    this._params = searchParams || null;
    this._workerParams = searchParams && searchParams.toWorkerParams ? searchParams.toWorkerParams() : null;
    this._stats = stats || null;
    // Diagnostic de relaxation, produit par la sonde quand le vivier est vide.
    this._diagnosis = diagnosis || null;
    this._selectedIndex = null;
    var notice = el('refineNotice');
    if (notice) { notice.textContent = ''; notice.hidden = true; }
    this._resetCriteria();
    // Une nouvelle recherche rouvre sur la sélection : c'est la lecture qui
    // aide à décider, et l'utilisateur garde les deux autres à un geste.
    this._scope = 'shortlist';
    this._renderChips();

    var linear = this._pool.length > 0 && this._pool[0].mode === 'rotationTranslation';
    var bar = el('refineBar');
    if (bar) {
      bar.hidden = this._pool.length === 0 || this._isSingleTransmission();
      bar.classList.toggle('refine-linear', linear);
    }
    this._renderAnalysed();
    this._publish(true);
  };

  /**
   * §23 : une transmission ANALYSÉE n'est pas un vivier d'une solution. La
   * réutilisation du vivier est un bon choix technique — tout le reste en
   * dépend — mais l'écran ne doit pas pour autant proposer de trier une liste
   * d'un élément, de la filtrer, ni de comparer une transmission à elle-même.
   */
  SolutionExplorer.prototype._isSingleTransmission = function () {
    // Une solution REÇUE par un lien est dans le même cas qu'une chaîne
    // construite : elle n'a pas été cherchée, et il n'y a rien autour d'elle.
    // Un vivier d'une solution issu d'une VRAIE recherche, lui, garde sa barre
    // d'affinage — c'est le résultat d'une recherche, si maigre soit-il.
    var only = this._pool.length === 1 ? this._pool[0] : null;
    return !!(only && (only.isBuilt || only.isShared));
  };

  SolutionExplorer.prototype._renderAnalysed = function () {
    var single = this._isSingleTransmission();
    var banner = el('analysedBanner');
    document.body.classList.toggle('single-transmission', single);
    if (!banner) return;
    banner.hidden = !single;
    if (!single) return;
    var solution = this._pool[0];
    // D'où vient ce qu'on regarde : décrit ici, ou reçu par un lien. Les deux
    // sont analysés de la même façon, mais dire « transmission analysée » à
    // qui vient d'ouvrir le lien d'un collègue laisserait croire qu'il l'a
    // saisie lui-même.
    var title = el('analysedTitle');
    if (title) title.textContent = solution.isShared ? 'Solution partagée' : 'Transmission analysée';
    var summary = el('analysedSummary');
    if (summary) {
      var architecture = (solution.stages || []).map(function (stage) {
        return GearTransmissionRegistry.familyName(stage.type, 'short');
      }).join(' → ');
      var ratio = Number.isFinite(solution.ratio) ? ', rapport ' + solution.ratio.toFixed(3) + ':1' : '';
      summary.textContent = architecture + ratio;
    }
  };

  SolutionExplorer.prototype.addVariant = function (solution) {
    if (!solution) return;
    if (solution.uid === undefined) {
      Object.defineProperty(solution, 'uid', { value: this._nextUid++, enumerable: false });
    }
    this._pool.push(solution);
    this._publish(false);
    this._select({ index: this._pool.length - 1, solution: solution });
  };

  SolutionExplorer.prototype.getPool = function () { return this._pool; };

  /**
   * La position, DANS LE VIVIER, de la solution affichée — ou null. C'est elle
   * que désigne un partage ou un export : la position dans la liste filtrée
   * changerait de sens au premier affinage.
   */
  SolutionExplorer.prototype.selectedIndex = function () {
    return this._selectedIndex == null ? null : this._selectedIndex;
  };

  SolutionExplorer.prototype.poolIndexOf = function (uid) {
    for (var i = 0; i < this._pool.length; i++) if (this._pool[i].uid === uid) return i;
    return -1;
  };

  // Contexte d'ingénierie capturé au moment de la recherche : sert à l'éditeur
  // d'étages pour ré-analyser une chaîne avec les mêmes hypothèses.
  /**
   * Le régime de service n'est PAS inventé ici, et il ne peut pas l'être en
   * relisant les paramètres de recherche : ceux-ci portent DÉJÀ 1500 rpm et
   * 10 N·m, substitués volontairement en amont — un solveur ne peut pas
   * dimensionner sans un régime quelconque, et cette hypothèse est nommée une
   * fois dans LegacySearchAdapter.
   *
   * Une analyse, elle, n'a pas besoin de cette hypothèse : elle laisse non
   * évalué ce qu'elle ignore. Mais modifier ensuite un étage rappelait ce
   * contexte, et l'hypothèse du solveur revenait en silence : une analyse
   * honnêtement muette redevenait bavarde, avec des efforts et des facteurs de
   * sécurité tirés d'un régime que personne n'avait choisi.
   *
   * La SESSION sait ce qui a réellement été demandé. C'est elle qu'on
   * interroge ; les paramètres de recherche ne servent plus que de repli, pour
   * les chemins qui n'en ont pas.
   */
  SolutionExplorer.prototype._statedRegime = function () {
    var session = this.workbench && this.workbench.session;
    if (!session || !session.engineeringOptions) return null;
    var stated = session.engineeringOptions();
    return { inputSpeedRpm: Number.isFinite(stated.inputSpeedRpm) ? stated.inputSpeedRpm : null,
      inputTorqueNm: Number.isFinite(stated.inputTorqueNm) ? stated.inputTorqueNm : null };
  };

  /**
   * Adopte les paramètres d'une recherche SANS vivier.
   *
   * Le contexte de ré-analyse — régime, matériaux, fabrication — se lit dans
   * ces paramètres. Une solution rouverte depuis un lien partagé doit être
   * analysée dans ce contexte-là, et il faut donc pouvoir le poser AVANT
   * d'avoir une solution à publier.
   */
  SolutionExplorer.prototype.useParams = function (searchParams) {
    this._params = searchParams || null;
    this._workerParams = searchParams && searchParams.toWorkerParams
      ? searchParams.toWorkerParams() : null;
    return this;
  };

  SolutionExplorer.prototype.getContext = function () {
    var wp = this._workerParams || {};
    var regime = this._statedRegime() ||
      { inputSpeedRpm: Number.isFinite(wp.vitesseEntree) ? wp.vitesseEntree : null,
        inputTorqueNm: Number.isFinite(wp.coupleEntree) ? wp.coupleEntree : null };
    return {
      target: Number.isFinite(wp.rapportCible) ? wp.rapportCible : null,
      linear: wp.objectiveMode === 'rotationTranslation',
      engineeringOptions: {
        inputSpeedRpm: regime.inputSpeedRpm,
        inputTorqueNm: regime.inputTorqueNm,
        inputMaterial: wp.inputMaterial || 'C45',
        outputMaterial: wp.outputMaterial || 'C45',
        additiveDerating: wp.additiveDerating || 1,
        weights: wp.weights || {},
        fatigue: wp.fatigue,
        shaft: wp.shaft
      },
      manufacturing: wp.manufacturing || { mode: 'standard' },
      constraints: wp.constraints || {}
    };
  };

  // ===== Critères =====

  SolutionExplorer.prototype._resetCriteria = function () {
    (GearMetricRegistry ? GearMetricRegistry.filters() : []).forEach(function (entry) {
      var input = el(entry.field); if (input) input.value = '';
    });
    var sort = el('refine_sort');
    if (sort) sort.value = this._defaultSort || 'recommended';
    this._disabledTypes = {};
    if (this.filters) this.filters.render();
  };

  SolutionExplorer.prototype._criteria = function () {
    var disabled = this._disabledTypes;
    var allTypes = GearSolutionFilter.bounds(this._pool).types;
    var enabled = allTypes.filter(function (type) { return !disabled[type]; });
    // Les bornes sont lues GRANDEUR PAR GRANDEUR sur le catalogue commun : il
    // n'y a plus de liste de champs à tenir à jour ici, ni de traduction
    // manuelle vers les clés du filtre.
    var metrics = [];
    (GearMetricRegistry ? GearMetricRegistry.filters() : []).forEach(function (entry) {
      var value = optionalNumber(entry.field);
      if (value != null) metrics.push({ entry: entry, value: value });
    });
    return {
      metrics: metrics,
      types: enabled.length === allTypes.length ? null : enabled,
      sort: (el('refine_sort') && el('refine_sort').value) || 'recommended'
    };
  };

  /**
   * §22 : une famille cochée ne disait pas ce qu'elle apporte. « Vis sans fin
   * 4 » contre « Droit 31 » rend le filtre immédiatement lisible — et évite
   * d'écarter la famille qui portait l'essentiel du vivier.
   */
  SolutionExplorer.prototype._renderChips = function () {
    var host = el('refineTypeChips'), self = this;
    if (!host) return;
    var counts = {};
    this._pool.forEach(function (solution) {
      var seen = {};
      (solution.stages || []).forEach(function (stage) {
        var type = stage.type === 'epicyclic' ? 'planetary' : stage.type;
        if (seen[type]) return;
        seen[type] = true;
        counts[type] = (counts[type] || 0) + 1;
      });
    });
    host.innerHTML = '';
    GearSolutionFilter.bounds(this._pool).types.forEach(function (type) {
      var chip = document.createElement('button');
      chip.type = 'button';
      var active = !self._disabledTypes[type];
      chip.className = 'refine-chip' + (active ? ' active' : '');
      chip.dataset.type = type;
      chip.setAttribute('aria-pressed', String(active));
      chip.textContent = familyName(type, 'short');
      var count = document.createElement('span');
      count.className = 'refine-chip-count';
      count.textContent = String(counts[type] || 0);
      chip.appendChild(count);
      host.appendChild(chip);
    });
    host.hidden = !host.children.length;
  };

  // ===== Publication =====

  SolutionExplorer.prototype._schedulePublish = function () {
    var self = this;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(function () { self._publish(false); }, 120);
  };

  /**
   * LE VERDICT, CALCULÉ UNE FOIS, SUR LE VIVIER ENTIER.
   *
   * Il l'était deux fois : ici pour trier — par l'indice technique — et dans
   * l'espace de travail pour poser les badges, par le classement décisionnel.
   * Deux calculs, deux réponses, une seule question. Il est fait une fois, sur
   * le vivier complet (un badge ne doit pas dépendre des filtres actifs), et
   * les deux consommateurs lisent le même objet.
   */
  SolutionExplorer.prototype._assess = function () {
    var Assessment = GearApp.requirements && GearApp.requirements.DecisionAssessment;
    if (!Assessment || !this._pool.length) return null;
    var session = this.workbench && this.workbench.session;
    return Assessment.build(this._pool, {
      preferences: session ? session.preferences : null,
      selection: session ? session.technologySelection : null,
      constraints: this._workerParams && this._workerParams.constraints ? this._workerParams.constraints : {},
      stats: this._stats
    });
  };

  /**
   * §16 : TROIS NIVEAUX DE LECTURE.
   *
   * Toutes les cartes de la vue filtrée étaient rendues, et le vivier peut en
   * garder quatre cents. Personne ne compare correctement cent quatre-vingts
   * cartes — et sur téléphone, où le tableau est désactivé, elles sont la
   * seule représentation. La liste s'ouvre donc sur ce qui sert à décider ; le
   * front de Pareto et le vivier complet restent à un geste.
   */
  SolutionExplorer.prototype._scopeIndices = function (assessment) {
    if (!assessment) return null;
    var scope = this._scope || 'shortlist';
    if (scope === 'all') return null;
    if (scope === 'pareto') return assessment.decision.front.slice();
    var Assessment = GearApp.requirements && GearApp.requirements.DecisionAssessment;
    return Assessment.shortlist(assessment, {
      grouping: typeof GearSolutionGrouping !== 'undefined' ? GearSolutionGrouping : null
    });
  };

  /** Le bandeau d'étendue : combien on montre, sur combien, et de quel domaine. */
  SolutionExplorer.prototype._renderScope = function (assessment, shown) {
    var bar = el('resultsScopeBar'), note = el('resultsScopeNote'), self = this;
    if (!bar) return;
    var pool = this._pool.length;
    // Sous une douzaine de solutions, il n'y a rien à réduire : les trois
    // niveaux donneraient la même liste, et un contrôle sans effet est pire
    // qu'un contrôle absent.
    bar.hidden = pool <= 12 || this._isSingleTransmission();
    if (bar.hidden) return;
    var host = el('resultsScope');
    if (host && !host.dataset.bound) {
      host.dataset.bound = '1';
      host.addEventListener('click', function (event) {
        var button = event.target.closest('[data-scope]');
        if (!button) return;
        self._scope = button.dataset.scope;
        self._publish(false);
      });
    }
    if (host) {
      Array.prototype.forEach.call(host.querySelectorAll('[data-scope]'), function (button) {
        var active = button.dataset.scope === (self._scope || 'shortlist');
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }
    if (note) {
      var front = assessment ? assessment.decision.front.length : 0;
      note.textContent = shown + ' affichée' + (shown > 1 ? 's' : '') + ' · ' +
        front + ' sur le front de Pareto · ' +
        (assessment ? assessment.scope.label : pool + ' solutions');
      note.classList.toggle('is-truncated', !!(assessment && assessment.scope.truncated));
    }
  };

  SolutionExplorer.prototype._publish = function (fresh) {
    var self = this;
    var assessment = this._assess();
    var decision = assessment ? assessment.decision : null;
    var criteria = this._criteria();
    criteria.decision = decision;
    var view = GearSolutionFilter.apply(this._pool, criteria);
    // L'étendue s'applique APRÈS les filtres : la sélection est celle du vivier
    // qu'on regarde, pas d'un vivier qu'on a écarté.
    var keep = this._scopeIndices(assessment);
    if (keep) {
      var allowed = {};
      keep.forEach(function (index) { allowed[index] = true; });
      view = view.filter(function (item) { return allowed[item.index]; });
    }
    this._renderScope(assessment, view.length);
    var solutions = view.map(function (item) { return item.solution; });
    var indices = view.map(function (item) { return item.index; });

    // keepResults : un affinage qui vide la vue ne doit pas masquer l'espace
    // de travail (la barre de filtres doit rester accessible).
    if (this.workbench) this.workbench.renderSolutions(solutions, indices, { stats: this._stats, pool: this._pool, diagnosis: this._diagnosis, session: this.session, decision: decision, assessment: assessment, keepResults: this._pool.length > 0 });
    if (this.resultsTable) this.resultsTable.display(solutions, this._params, indices, decision, assessment);

    var count = el('refineCount');
    if (count) {
      count.textContent = view.length + ' affichée' + (view.length > 1 ? 's' : '') +
        ' / ' + this._pool.length + ' trouvée' + (this._pool.length > 1 ? 's' : '');
      var engineValid = this._stats && this._stats.valid;
      count.title = Number.isFinite(engineValid) && engineValid > this._pool.length
        ? engineValid + ' solutions valides côté moteur (vivier tronqué)'
        : '';
    }

    if (fresh) {
      if (this.ui && this.ui.updatePoolCharts) this.ui.updatePoolCharts(this._pool, this._params);
      if (view.length) this._select(view[0]);
      else if (this.ui && this.ui.clearDetail) this.ui.clearDetail();
      return;
    }

    // Un affinage ne changeait pas la sélection : la solution affichée dans le
    // viewer pouvait donc avoir disparu de la liste tout en restant à l'écran,
    // Ø 90 mm sous un filtre « Ø ≤ 80 ». La vue et le viewer doivent décrire
    // le même objet.
    var stillVisible = view.some(function (item) { return item.index === self._selectedIndex; });
    if (stillVisible) return;
    if (view.length) {
      this._select(view[0]);
      this._announce('La solution affichée ne passait plus les filtres : la première de la liste a été sélectionnée.');
    } else if (this.ui && this.ui.clearDetail) {
      this.ui.clearDetail();
      this._selectedIndex = null;
      this._announce('Aucune des ' + this._pool.length + ' solutions ne passe vos filtres.', true);
    }
  };

  SolutionExplorer.prototype._select = function (item) {
    this._selectedIndex = item.index;
    this.bus.emit('solution:selected', { index: item.index, solution: item.solution });
    if (this.resultsTable && this.resultsTable.setSelectedIndex) this.resultsTable.setSelectedIndex(item.index);
  };

  /** Dit ce que le filtrage vient de changer, sans interrompre le geste. */
  SolutionExplorer.prototype._announce = function (text, offerReset) {
    var self = this, host = el('refineNotice');
    if (!host) return;
    host.textContent = text + ' ';
    host.hidden = false;
    if (!offerReset) return;
    var undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn-link';
    undo.id = 'refineNoticeReset';
    undo.textContent = 'Réinitialiser les filtres';
    undo.addEventListener('click', function () { self._resetCriteria(); self._publish(false); });
    host.appendChild(undo);
  };

  GearApp.ui.SolutionExplorer = SolutionExplorer;

})(GearApp);
