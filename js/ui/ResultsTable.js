// ResultsTable.js - Affichage, tri, filtrage, pagination et export CSV

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

  var PAGE_SIZE = 25;

  function ResultsTable(tbodyId, eventBus) {
    this._tbody = document.getElementById(tbodyId);
    this._table = this._tbody ? this._tbody.closest('table') : null;
    this._eventBus = eventBus || GearApp.eventBus;
    this._solutions = [];
    this._displayData = [];
    this._selectedIndex = 0;
    this._params = null;

    // Tri
    this._sortColumn = 'error';
    this._sortDirection = 'asc';

    // Filtres par type
    this._typeFilters = {};
    this._allTypes = [];

    // Comparaison
    this._comparisonMode = false;
    this._comparedIndices = new Set();

    // Pagination
    this._currentPage = 0;
    this._filteredData = [];

    // Recherche textuelle
    this._searchText = '';

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

  ResultsTable.prototype._calculerRapport = function (solution) {
    var registry = GearApp.models.typeRegistry;
    return solution.reduce(function (acc, stage) {
      var typeId = stage[2] || 'spur';
      return acc * registry.calculerRapportEtage(typeId, stage[0], stage[1]);
    }, 1);
  };

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
        th.setAttribute('role', 'columnheader');
        th.setAttribute('aria-sort', 'none');
        th.onclick = function () { self._onHeaderClick(col.id); };

        var indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        if (col.id === self._sortColumn) {
          indicator.textContent = self._sortDirection === 'asc' ? ' ▲' : ' ▼';
          th.classList.add('sorted');
          th.setAttribute('aria-sort', self._sortDirection === 'asc' ? 'ascending' : 'descending');
        }
        th.appendChild(indicator);
      }
      tr.appendChild(th);
    });
  };

  ResultsTable.prototype._onHeaderClick = function (colId) {
    if (this._sortColumn === colId) {
      this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortColumn = colId;
      this._sortDirection = 'asc';
    }
    this._currentPage = 0;
    this._updateSortIndicators();
    this._renderFiltered();
  };

  ResultsTable.prototype._updateSortIndicators = function () {
    if (!this._table) return;
    var ths = this._table.querySelectorAll('thead th');
    var self = this;
    ths.forEach(function (th) {
      var colId = th.getAttribute('data-col');
      var indicator = th.querySelector('.sort-indicator');
      th.classList.remove('sorted');
      th.setAttribute('aria-sort', 'none');
      if (indicator) indicator.textContent = '';

      if (colId === self._sortColumn) {
        th.classList.add('sorted');
        th.setAttribute('aria-sort', self._sortDirection === 'asc' ? 'ascending' : 'descending');
        if (indicator) indicator.textContent = self._sortDirection === 'asc' ? ' ▲' : ' ▼';
      }
    });
  };

  ResultsTable.prototype._buildToolbar = function () {
    var container = this._table ? this._table.parentElement.parentElement : null;
    if (!container) return;

    // Supprimer les anciennes barres
    var existingFilter = container.querySelector('.type-filter-bar');
    if (existingFilter) existingFilter.remove();
    var existingToolbar = container.querySelector('.results-toolbar');
    if (existingToolbar) existingToolbar.remove();

    // Barre d'outils (recherche + export CSV + partage URL)
    var toolbar = document.createElement('div');
    toolbar.className = 'results-toolbar';

    // Recherche textuelle
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'results-search';
    searchInput.placeholder = 'Rechercher (dents, type, ratio...)';
    searchInput.setAttribute('aria-label', 'Rechercher dans les résultats');
    var self = this;
    searchInput.oninput = function () {
      self._searchText = searchInput.value.toLowerCase().trim();
      self._currentPage = 0;
      self._renderFiltered();
    };
    toolbar.appendChild(searchInput);

    // Bouton CSV
    var csvBtn = document.createElement('button');
    csvBtn.className = 'btn-small';
    csvBtn.textContent = 'CSV';
    csvBtn.title = 'Exporter les résultats filtrés en CSV';
    csvBtn.onclick = function () { self.exportCSV(); };
    toolbar.appendChild(csvBtn);

    // Bouton Copier URL
    var urlBtn = document.createElement('button');
    urlBtn.className = 'btn-small';
    urlBtn.textContent = 'Partager';
    urlBtn.title = 'Copier le lien de cette configuration';
    urlBtn.onclick = function () {
      var url = GearApp.models.SearchParams.toURL();
      navigator.clipboard.writeText(url).then(function () {
        urlBtn.textContent = 'Copié !';
        setTimeout(function () { urlBtn.textContent = 'Partager'; }, 2000);
      });
    };
    toolbar.appendChild(urlBtn);

    container.insertBefore(toolbar, container.querySelector('.table-scroll'));

    // Barre de filtres par type
    if (this._allTypes.length > 1) {
      var bar = document.createElement('div');
      bar.className = 'type-filter-bar';

      var label = document.createElement('span');
      label.className = 'filter-label';
      label.textContent = 'Filtrer :';
      bar.appendChild(label);

      var allBtn = document.createElement('button');
      allBtn.className = 'filter-chip filter-chip-all active';
      allBtn.textContent = 'Tous';
      allBtn.onclick = function () { self._resetFilters(); };
      bar.appendChild(allBtn);

      var registry = GearApp.models.typeRegistry;
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

      container.insertBefore(bar, container.querySelector('.table-scroll'));
    }
  };

  ResultsTable.prototype._toggleTypeFilter = function (typeId) {
    this._typeFilters[typeId] = !this._typeFilters[typeId];

    var anyActive = false;
    for (var key in this._typeFilters) {
      if (this._typeFilters[key]) { anyActive = true; break; }
    }
    if (!anyActive) {
      this._resetFilters();
      return;
    }

    this._currentPage = 0;
    this._updateFilterChips();
    this._renderFiltered();
  };

  ResultsTable.prototype._resetFilters = function () {
    var self = this;
    this._allTypes.forEach(function (typeId) {
      self._typeFilters[typeId] = true;
    });
    this._currentPage = 0;
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

  ResultsTable.prototype._prepareDisplayData = function () {
    var self = this;
    var registry = GearApp.models.typeRegistry;
    var target = this._params ? this._params.rapportCible : parseFloat(document.getElementById("rapport").value);
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    this._displayData = this._solutions.map(function (solution, originalIndex) {
      var ratio = self._calculerRapport(solution);
      var error = Math.abs((ratio - target) / target * 100);
      var types = self._getTypes(solution);

      // Texte cherchable
      var searchText = '';
      solution.forEach(function (stage, i) {
        searchText += stage[0] + ' ' + stage[1] + ' ';
        searchText += (registry.get(stage[2] || 'spur').nomCourt) + ' ';
      });
      searchText += ratio.toFixed(4) + ' ' + error.toFixed(3);

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
        totalTeeth: solution.reduce(function (sum, s) { return sum + s[0] + s[1]; }, 0),
        _searchText: searchText.toLowerCase()
      };
    });
  };

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

  ResultsTable.prototype._renderFiltered = function () {
    var self = this;

    // Filtrer par type
    var filtered = this._displayData.filter(function (d) {
      return d.types.some(function (typeId) {
        return self._typeFilters[typeId];
      });
    });

    // Filtrer par recherche textuelle
    if (this._searchText) {
      filtered = filtered.filter(function (d) {
        return d._searchText.indexOf(self._searchText) !== -1;
      });
    }

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

    this._filteredData = filtered;

    // Paginer
    var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (this._currentPage >= totalPages) this._currentPage = totalPages - 1;
    var start = this._currentPage * PAGE_SIZE;
    var pageData = filtered.slice(start, start + PAGE_SIZE);

    // Rendre
    this._renderRows(pageData);
    this._updateCounter(filtered.length, this._displayData.length);
    this._renderPagination(totalPages);
  };

  ResultsTable.prototype._renderPagination = function (totalPages) {
    var container = this._table ? this._table.parentElement.parentElement : null;
    if (!container) return;

    var existingPag = container.querySelector('.pagination-bar');
    if (existingPag) existingPag.remove();

    if (totalPages <= 1) return;

    var self = this;
    var bar = document.createElement('div');
    bar.className = 'pagination-bar';

    var prevBtn = document.createElement('button');
    prevBtn.className = 'btn-small pagination-btn';
    prevBtn.textContent = 'Précédent';
    prevBtn.disabled = this._currentPage === 0;
    prevBtn.onclick = function () {
      if (self._currentPage > 0) {
        self._currentPage--;
        self._renderFiltered();
      }
    };
    bar.appendChild(prevBtn);

    var info = document.createElement('span');
    info.className = 'pagination-info';
    info.textContent = 'Page ' + (this._currentPage + 1) + ' / ' + totalPages;
    bar.appendChild(info);

    var nextBtn = document.createElement('button');
    nextBtn.className = 'btn-small pagination-btn';
    nextBtn.textContent = 'Suivant';
    nextBtn.disabled = this._currentPage >= totalPages - 1;
    nextBtn.onclick = function () {
      if (self._currentPage < totalPages - 1) {
        self._currentPage++;
        self._renderFiltered();
      }
    };
    bar.appendChild(nextBtn);

    // Insert after table-scroll
    var tableScroll = container.querySelector('.table-scroll');
    if (tableScroll) {
      tableScroll.parentNode.insertBefore(bar, tableScroll.nextSibling);
    }
  };

  ResultsTable.prototype._updateCounter = function (shown, total) {
    var container = this._table ? this._table.parentElement.parentElement : null;
    if (!container) return;
    var counter = container.querySelector('.results-counter');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'results-counter';
      counter.setAttribute('aria-live', 'polite');
      var h2 = container.querySelector('h2');
      if (h2) h2.parentNode.insertBefore(counter, h2.nextSibling);
    }
    if (shown === total) {
      counter.textContent = total + ' résultat(s)';
    } else {
      counter.textContent = shown + ' / ' + total + ' résultat(s) affichés';
    }
  };

  ResultsTable.prototype._renderRows = function (dataItems) {
    this._tbody.innerHTML = '';

    if (dataItems.length === 0) {
      this._tbody.innerHTML = "<tr><td colspan='7'>Aucun résultat correspondant aux filtres</td></tr>";
      return;
    }

    var self = this;
    var registry = GearApp.models.typeRegistry;
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var proMode = document.body.classList.contains('pro-mode');

    dataItems.forEach(function (data, displayIdx) {
      var row = document.createElement("tr");
      row.classList.add("result-row");
      row.setAttribute('data-original-idx', data.originalIndex);
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'row');
      if (data.originalIndex === self._selectedIndex) row.classList.add("selected-row");

      row.onclick = function () { self.selectSolution(data.originalIndex); };
      row.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          self.selectSolution(data.originalIndex);
        }
      };

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

      // Rendement
      var effCell = document.createElement("td");
      var eff = self._computeEfficiency(data);
      if (eff !== null) {
        effCell.innerText = (eff * 100).toFixed(1) + "%";
        if (eff > 0.95) effCell.classList.add("excellent");
        else if (eff > 0.90) effCell.classList.add("good");
      } else {
        effCell.innerText = "-";
      }

      // Pro mode: micro-indicators
      if (proMode && eff !== null) {
        // Safety indicator
        var modValue = self._params ? self._params.module : null;
        if (modValue) {
          var analyse = GearApp.core.GearMechanics.analyserTrainEngrenages(data.solution, {
            module: modValue,
            vitesseEntree: self._params.vitesseEntree || 1500,
            coupleEntree: self._params.coupleEntree || 10
          });
          var minSec = Infinity;
          var hasIrreversible = false;
          analyse.etages.forEach(function (etage) {
            var secA = etage.resistanceMenante.facteurSecurite;
            var secB = etage.resistanceMenee.facteurSecurite;
            if (secA !== Infinity) minSec = Math.min(minSec, secA);
            if (secB !== Infinity) minSec = Math.min(minSec, secB);
            if (!etage.reversible) hasIrreversible = true;
          });

          // Safety dot
          if (minSec !== Infinity) {
            var dot = document.createElement('span');
            dot.className = 'safety-dot';
            if (minSec >= 2) dot.classList.add('safe');
            else if (minSec >= 1.5) dot.classList.add('caution');
            else dot.classList.add('danger');
            dot.title = 'Sécurité min: ' + minSec.toFixed(1);
            effCell.appendChild(dot);
          }

          // Irreversibility icon
          if (hasIrreversible) {
            var icon = document.createElement('span');
            icon.className = 'irreversible-icon';
            icon.textContent = ' \u26A0';
            icon.title = 'Contient un étage irréversible (vis sans fin)';
            typesCell.appendChild(icon);
          }
        }
      }

      // Bouton Voir / Comparer
      var buttonCell = document.createElement("td");
      if (self._comparisonMode) {
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = self._comparedIndices.has(data.originalIndex);
        checkbox.setAttribute('aria-label', 'Comparer cette solution');
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
      btn.setAttribute('aria-label', 'Voir le schéma de cette solution');
      btn.onclick = function (e) {
        e.stopPropagation();
        self.selectSolution(data.originalIndex);
      };
      buttonCell.appendChild(btn);

      // Copy button
      var copyBtn = document.createElement("button");
      copyBtn.className = 'btn-copy';
      copyBtn.textContent = '\u2398';
      copyBtn.title = 'Copier cette ligne';
      copyBtn.onclick = function (e) {
        e.stopPropagation();
        var text = data.solution.map(function (s, i) {
          return letters[2 * i] + ':' + s[0] + ' ' + letters[2 * i + 1] + ':' + s[1] + ' (' + (registry.get(s[2] || 'spur').nomCourt) + ')';
        }).join(' | ');
        text += ' | Rapport: ' + data.ratio.toFixed(4) + ' | Écart: ' + data.error.toFixed(3) + '%';
        if (eff !== null) text += ' | Rend: ' + (eff * 100).toFixed(1) + '%';
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = '\u2713';
          setTimeout(function () { copyBtn.textContent = '\u2398'; }, 1500);
        });
      };
      buttonCell.appendChild(copyBtn);

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

  ResultsTable.prototype.display = function (solutions, params) {
    this._solutions = solutions;
    this._params = params;
    this._selectedIndex = 0;
    this._comparedIndices.clear();
    this._currentPage = 0;
    this._searchText = '';

    if (solutions.length === 0) {
      this._tbody.innerHTML = "<tr><td colspan='7'>Aucun résultat</td></tr>";
      this._updateCounter(0, 0);
      return;
    }

    var typesSet = {};
    solutions.forEach(function (sol) {
      sol.forEach(function (stage) {
        typesSet[stage[2] || 'spur'] = true;
      });
    });
    this._allTypes = Object.keys(typesSet);

    var self = this;
    this._allTypes.forEach(function (t) {
      if (self._typeFilters[t] === undefined) self._typeFilters[t] = true;
    });

    this._prepareDisplayData();
    this._buildToolbar();
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

  // ===== Export CSV =====

  ResultsTable.prototype.exportCSV = function () {
    var data = this._filteredData.length > 0 ? this._filteredData : this._displayData;
    var registry = GearApp.models.typeRegistry;
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    var lines = ['Engrenages;Types;Rapport;Écart (%);Étages;Rendement (%)'];

    var self = this;
    data.forEach(function (d) {
      var gears = d.solution.map(function (s, i) {
        return letters[2 * i] + ':' + s[0] + ' ' + letters[2 * i + 1] + ':' + s[1];
      }).join(' | ');
      var types = d.typesStr;
      var eff = self._computeEfficiency(d);
      var effStr = eff !== null ? (eff * 100).toFixed(1) : '-';
      lines.push(gears + ';' + types + ';' + d.ratio.toFixed(4) + ';' + d.error.toFixed(3) + ';' + d.stages + ';' + effStr);
    });

    var csv = lines.join('\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'resultats-engrenages.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  GearApp.ui.ResultsTable = ResultsTable;

})(GearApp);
