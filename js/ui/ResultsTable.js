// ResultsTable.js - Affichage, tri, filtrage et gestion du tableau des résultats

(function (GearApp) {

  var COLUMNS = [
    { id: 'gears', label: 'Engrenages', sortable: true },
    { id: 'types', label: 'Types', sortable: true },
    { id: 'ratio', label: 'Rapport', sortable: true },
    { id: 'error', label: 'Écart (%)', sortable: true },
    { id: 'stages', label: 'Étages', sortable: true },
    { id: 'efficiency', label: 'Rendement', sortable: true },
    { id: 'action', label: 'Schéma', sortable: false }
  ];

  function ResultsTable(tbodyId, eventBus) {
    this._tbody = document.getElementById(tbodyId);
    this._table = this._tbody ? this._tbody.closest('table') : null;
    this._eventBus = eventBus || GearApp.eventBus;
    this._solutions = [];
    this._displayData = []; // cache: { solution, ratio, error, efficiency, types }
    this._selectedIndex = 0;
    this._params = null;

    // Tri
    this._sortColumn = 'error'; // tri par défaut sur l'écart
    this._sortDirection = 'asc';

    // Filtres par type
    this._typeFilters = {}; // typeId -> bool (true = visible)
    this._allTypes = []; // types présents dans les résultats

    // Comparaison
    this._comparisonMode = false;
    this._comparedIndices = new Set();

    this._initSortableHeaders();
  }

  ResultsTable.prototype.getSolutions = function () {
    return this._solutions;
  };

  ResultsTable.prototype.getSolution = function (index) {
    return this._solutions[index];
  };

  ResultsTable.prototype.getSelectedIndex = function () {
    return this._selectedIndex;
  };

  /**
   * Calcule le rapport total type-aware d'une solution.
   */
  ResultsTable.prototype._calculerRapport = function (solution) {
    var registry = GearApp.models.typeRegistry;
    return solution.reduce(function (acc, stage) {
      var typeId = stage[2] || 'spur';
      return acc * registry.calculerRapportEtage(typeId, stage[0], stage[1]);
    }, 1);
  };

  /**
   * Récupère les types uniques d'une solution.
   */
  ResultsTable.prototype._getTypes = function (solution) {
    var seen = {};
    var types = [];
    solution.forEach(function (stage) {
      var typeId = stage[2] || 'spur';
      if (!seen[typeId]) {
        seen[typeId] = true;
        types.push(typeId);
      }
    });
    return types;
  };

  /**
   * Construit les en-têtes triables dans le <thead>.
   */
  ResultsTable.prototype._initSortableHeaders = function () {
    if (!this._table) return;
    var thead = this._table.querySelector('thead');
    if (!thead) return;

    var tr = thead.querySelector('tr');
    if (!tr) return;
    tr.innerHTML = '';

    var self = this;
    COLUMNS.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col.label;
      th.setAttribute('data-col', col.id);

      if (col.sortable) {
        th.classList.add('sortable-th');
        th.onclick = function () { self._onHeaderClick(col.id); };

        var indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        if (col.id === self._sortColumn) {
          indicator.textContent = self._sortDirection === 'asc' ? ' ▲' : ' ▼';
          th.classList.add('sorted');
        }
        th.appendChild(indicator);
      }
      tr.appendChild(th);
    });
  };

  /**
   * Click sur un en-tête de colonne.
   */
  ResultsTable.prototype._onHeaderClick = function (colId) {
    if (this._sortColumn === colId) {
      this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortColumn = colId;
      this._sortDirection = 'asc';
    }
    this._updateSortIndicators();
    this._renderFiltered();
  };

  /**
   * Met à jour les indicateurs visuels de tri.
   */
  ResultsTable.prototype._updateSortIndicators = function () {
    if (!this._table) return;
    var ths = this._table.querySelectorAll('thead th');
    var self = this;
    ths.forEach(function (th) {
      var colId = th.getAttribute('data-col');
      var indicator = th.querySelector('.sort-indicator');
      th.classList.remove('sorted');
      if (indicator) indicator.textContent = '';

      if (colId === self._sortColumn) {
        th.classList.add('sorted');
        if (indicator) indicator.textContent = self._sortDirection === 'asc' ? ' ▲' : ' ▼';
      }
    });
  };

  /**
   * Construit la barre de filtres par type au-dessus du tableau.
   */
  ResultsTable.prototype._buildTypeFilterBar = function () {
    var container = this._table ? this._table.parentElement : null;
    if (!container) return;

    // Supprimer l'ancienne barre si elle existe
    var existing = container.parentElement.querySelector('.type-filter-bar');
    if (existing) existing.remove();

    if (this._allTypes.length <= 1) return; // pas utile s'il n'y a qu'un seul type

    var bar = document.createElement('div');
    bar.className = 'type-filter-bar';

    var label = document.createElement('span');
    label.className = 'filter-label';
    label.textContent = 'Filtrer :';
    bar.appendChild(label);

    var self = this;
    var registry = GearApp.models.typeRegistry;

    // Bouton Tous
    var allBtn = document.createElement('button');
    allBtn.className = 'filter-chip filter-chip-all active';
    allBtn.textContent = 'Tous';
    allBtn.onclick = function () { self._resetFilters(); };
    bar.appendChild(allBtn);

    this._allTypes.forEach(function (typeId) {
      var type = registry.get(typeId);
      var chip = document.createElement('button');
      chip.className = 'filter-chip ' + typeId;
      chip.setAttribute('data-type', typeId);
      if (self._typeFilters[typeId]) chip.classList.add('active');
      chip.textContent = type.nomCourt;
      chip.onclick = function () { self._toggleTypeFilter(typeId); };
      bar.appendChild(chip);
    });

    // Insérer avant la table-scroll
    container.parentElement.insertBefore(bar, container);
  };

  /**
   * Active/désactive un filtre de type.
   */
  ResultsTable.prototype._toggleTypeFilter = function (typeId) {
    this._typeFilters[typeId] = !this._typeFilters[typeId];

    // Vérifier si aucun filtre actif -> réactiver tous
    var anyActive = false;
    for (var key in this._typeFilters) {
      if (this._typeFilters[key]) { anyActive = true; break; }
    }
    if (!anyActive) {
      this._resetFilters();
      return;
    }

    this._updateFilterChips();
    this._renderFiltered();
  };

  ResultsTable.prototype._resetFilters = function () {
    var self = this;
    this._allTypes.forEach(function (typeId) {
      self._typeFilters[typeId] = true;
    });
    this._updateFilterChips();
    this._renderFiltered();
  };

  ResultsTable.prototype._updateFilterChips = function () {
    var container = this._table ? this._table.parentElement.parentElement : null;
    if (!container) return;

    var chips = container.querySelectorAll('.filter-chip[data-type]');
    var self = this;
    var allActive = true;
    chips.forEach(function (chip) {
      var typeId = chip.getAttribute('data-type');
      chip.classList.toggle('active', !!self._typeFilters[typeId]);
      if (!self._typeFilters[typeId]) allActive = false;
    });

    var allChip = container.querySelector('.filter-chip-all');
    if (allChip) allChip.classList.toggle('active', allActive);
  };

  /**
   * Prépare les données de cache pour le tri et le filtrage.
   * Le rendement est calculé en lazy (à la demande) pour éviter de bloquer l'UI.
   */
  ResultsTable.prototype._prepareDisplayData = function () {
    var self = this;
    var registry = GearApp.models.typeRegistry;
    var target = this._params ? this._params.rapportCible : parseFloat(document.getElementById("rapport").value);

    this._displayData = this._solutions.map(function (solution, originalIndex) {
      var ratio = self._calculerRapport(solution);
      var error = Math.abs((ratio - target) / target * 100);
      var types = self._getTypes(solution);

      return {
        originalIndex: originalIndex,
        solution: solution,
        ratio: ratio,
        error: error,
        stages: solution.length,
        types: types,
        typesStr: types.map(function (t) { return registry.get(t).nomCourt; }).join(', '),
        efficiency: null,
        _efficiencyComputed: false,
        totalTeeth: solution.reduce(function (sum, s) { return sum + s[0] + s[1]; }, 0)
      };
    });
  };

  /**
   * Calcule le rendement d'une solution à la demande (lazy).
   */
  ResultsTable.prototype._computeEfficiency = function (dataItem) {
    if (dataItem._efficiencyComputed) return dataItem.efficiency;
    var modValue = this._params ? this._params.module : null;
    if (modValue) {
      var analyse = GearApp.core.GearMechanics.analyserTrainEngrenages(dataItem.solution, {
        module: modValue,
        vitesseEntree: this._params.vitesseEntree || 1500,
        coupleEntree: this._params.coupleEntree || 10
      });
      dataItem.efficiency = analyse.rendementTotal;
    }
    dataItem._efficiencyComputed = true;
    return dataItem.efficiency;
  };

  /**
   * Filtre et trie les données, puis re-rend les lignes.
   */
  ResultsTable.prototype._renderFiltered = function () {
    var self = this;

    // Filtrer
    var filtered = this._displayData.filter(function (d) {
      // Au moins un type de la solution doit être dans les filtres actifs
      return d.types.some(function (typeId) {
        return self._typeFilters[typeId];
      });
    });

    // Trier
    filtered.sort(function (a, b) {
      var va, vb;
      switch (self._sortColumn) {
        case 'gears':
          va = a.totalTeeth; vb = b.totalTeeth; break;
        case 'types':
          va = a.typesStr; vb = b.typesStr;
          return self._sortDirection === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'ratio':
          va = a.ratio; vb = b.ratio; break;
        case 'error':
          va = a.error; vb = b.error; break;
        case 'stages':
          va = a.stages; vb = b.stages; break;
        case 'efficiency':
          va = self._computeEfficiency(a) || 0; vb = self._computeEfficiency(b) || 0; break;
        default:
          va = a.error; vb = b.error;
      }
      var diff = va - vb;
      return self._sortDirection === 'asc' ? diff : -diff;
    });

    // Rendre
    this._renderRows(filtered);

    // Compteur de résultats
    this._updateCounter(filtered.length, this._displayData.length);
  };

  /**
   * Met à jour le compteur de résultats filtrés.
   */
  ResultsTable.prototype._updateCounter = function (shown, total) {
    var container = this._table ? this._table.parentElement.parentElement : null;
    if (!container) return;
    var counter = container.querySelector('.results-counter');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'results-counter';
      var h2 = container.querySelector('h2');
      if (h2) h2.parentNode.insertBefore(counter, h2.nextSibling);
    }
    if (shown === total) {
      counter.textContent = total + ' résultat(s)';
    } else {
      counter.textContent = shown + ' / ' + total + ' résultat(s) affichés';
    }
  };

  /**
   * Rend les lignes de la table.
   */
  ResultsTable.prototype._renderRows = function (dataItems) {
    this._tbody.innerHTML = '';

    if (dataItems.length === 0) {
      this._tbody.innerHTML = "<tr><td colspan='7'>Aucun résultat correspondant aux filtres</td></tr>";
      return;
    }

    var self = this;
    var registry = GearApp.models.typeRegistry;
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    dataItems.forEach(function (data, displayIdx) {
      var row = document.createElement("tr");
      row.classList.add("result-row");
      row.setAttribute('data-original-idx', data.originalIndex);
      if (data.originalIndex === self._selectedIndex) row.classList.add("selected-row");

      row.onclick = function () { self.selectSolution(data.originalIndex); };

      // Engrenages
      var gearsCell = document.createElement("td");
      var gearsHtml = "";
      data.solution.forEach(function (stage, i) {
        gearsHtml += "<span>" + letters[2 * i] + ":" + stage[0] + ", " + letters[2 * i + 1] + ":" + stage[1] + "</span>";
        if (i < data.solution.length - 1) gearsHtml += " ; ";
      });
      gearsCell.innerHTML = gearsHtml;

      // Types
      var typesCell = document.createElement("td");
      data.solution.forEach(function (stage) {
        var typeId = stage[2] || 'spur';
        var type = registry.get(typeId);
        var badge = document.createElement("span");
        badge.className = "type-badge " + typeId;
        badge.textContent = type.nomCourt;
        typesCell.appendChild(badge);
      });

      // Rapport
      var ratioCell = document.createElement("td");
      ratioCell.innerText = data.ratio.toFixed(4);

      // Écart
      var errorCell = document.createElement("td");
      errorCell.innerText = data.error.toFixed(3);
      if (data.error < 0.01) errorCell.classList.add("excellent");
      else if (data.error < 0.1) errorCell.classList.add("good");

      // Étages
      var stagesCell = document.createElement("td");
      stagesCell.innerText = data.stages;

      // Rendement (calculé en lazy pour les lignes visibles)
      var effCell = document.createElement("td");
      var eff = self._computeEfficiency(data);
      if (eff !== null) {
        effCell.innerText = (eff * 100).toFixed(1) + "%";
        if (eff > 0.95) effCell.classList.add("excellent");
        else if (eff > 0.90) effCell.classList.add("good");
      } else {
        effCell.innerText = "-";
      }

      // Bouton Voir / Comparer
      var buttonCell = document.createElement("td");
      if (self._comparisonMode) {
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = self._comparedIndices.has(data.originalIndex);
        checkbox.onchange = function () {
          if (checkbox.checked) self._comparedIndices.add(data.originalIndex);
          else self._comparedIndices.delete(data.originalIndex);
          self._eventBus.emit('comparison:selectionChanged', {
            indices: Array.from(self._comparedIndices)
          });
        };
        buttonCell.appendChild(checkbox);
      }
      var btn = document.createElement("button");
      btn.innerText = "Voir";
      btn.classList.add("btn-schema");
      btn.onclick = function (e) {
        e.stopPropagation();
        self.selectSolution(data.originalIndex);
      };
      buttonCell.appendChild(btn);

      row.appendChild(gearsCell);
      row.appendChild(typesCell);
      row.appendChild(ratioCell);
      row.appendChild(errorCell);
      row.appendChild(stagesCell);
      row.appendChild(effCell);
      row.appendChild(buttonCell);
      self._tbody.appendChild(row);
    });
  };

  /**
   * Affiche les résultats dans le tableau.
   */
  ResultsTable.prototype.display = function (solutions, params) {
    this._solutions = solutions;
    this._params = params;
    this._selectedIndex = 0;
    this._comparedIndices.clear();

    if (solutions.length === 0) {
      this._tbody.innerHTML = "<tr><td colspan='7'>Aucun résultat</td></tr>";
      this._updateCounter(0, 0);
      return;
    }

    // Collecter les types présents
    var typesSet = {};
    solutions.forEach(function (sol) {
      sol.forEach(function (stage) {
        typesSet[stage[2] || 'spur'] = true;
      });
    });
    this._allTypes = Object.keys(typesSet);

    // Initialiser filtres (tous actifs)
    var self = this;
    this._allTypes.forEach(function (t) {
      if (self._typeFilters[t] === undefined) self._typeFilters[t] = true;
    });

    this._prepareDisplayData();
    this._buildTypeFilterBar();
    this._updateSortIndicators();
    this._renderFiltered();

    this.selectSolution(0);
  };

  ResultsTable.prototype.selectSolution = function (index) {
    this._selectedIndex = index;
    var rows = this._tbody.querySelectorAll(".result-row");
    rows.forEach(function (row) {
      var idx = parseInt(row.getAttribute('data-original-idx'), 10);
      row.classList.toggle("selected-row", idx === index);
    });
    var solution = this._solutions[index];
    if (solution) {
      this._eventBus.emit('solution:selected', { index: index, solution: solution });
    }
  };

  /**
   * Active/désactive le mode comparaison.
   */
  ResultsTable.prototype.setComparisonMode = function (enabled) {
    this._comparisonMode = enabled;
    if (!enabled) this._comparedIndices.clear();
    this._renderFiltered();
  };

  ResultsTable.prototype.getComparedSolutions = function () {
    var self = this;
    return Array.from(this._comparedIndices).map(function (idx) {
      return self._solutions[idx];
    });
  };

  GearApp.ui.ResultsTable = ResultsTable;

})(GearApp);
