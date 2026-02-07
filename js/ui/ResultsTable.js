/**
 * @file ResultsTable.js - Affichage, tri, filtrage et gestion du tableau des résultats
 * @description Composant UI principal pour l'affichage des résultats de recherche d'engrenages.
 *              Fonctionnalités :
 *              - Affichage tabulaire des solutions avec engrenages, types, rapport, écart, rendement
 *              - Tri interactif par clic sur les en-têtes de colonnes (▲/▼)
 *              - Filtrage par type de transmission via des "chips" cliquables
 *              - Compteur de résultats filtrés / total
 *              - Calcul du rendement en lazy (à la demande) pour les performances
 *              - Mode comparaison avec checkboxes de sélection multiple
 *              - Sélection d'une solution avec émission d'événement via EventBus
 *
 *   Structure du cache _displayData (un élément par solution) :
 *   {
 *     originalIndex: number,    // Index dans le tableau original _solutions
 *     solution: Array<Array>,   // Référence vers la solution [A, B, typeId]
 *     ratio: number,            // Rapport de réduction calculé
 *     error: number,            // Écart en % par rapport au rapport cible
 *     stages: number,           // Nombre d'étages
 *     types: Array<string>,     // Types uniques (ex: ['spur', 'helical'])
 *     typesStr: string,         // Types en texte (ex: "Dr., Hél.")
 *     efficiency: number|null,  // Rendement (calculé en lazy)
 *     _efficiencyComputed: boolean, // Flag de calcul du rendement
 *     totalTeeth: number        // Nombre total de dents (toutes roues)
 *   }
 *
 * @namespace GearApp.ui.ResultsTable
 */

(function (GearApp) {

  // ===== Définition des colonnes du tableau =====

  /**
   * Configuration des colonnes du tableau de résultats.
   * Chaque colonne a un identifiant, un libellé affiché et un flag de triabilité.
   *
   * @type {Array<{id: string, label: string, sortable: boolean}>}
   */
  var COLUMNS = [
    { id: 'gears', label: 'Engrenages', sortable: true },
    { id: 'types', label: 'Types', sortable: true },
    { id: 'ratio', label: 'Rapport', sortable: true },
    { id: 'error', label: 'Écart (%)', sortable: true },
    { id: 'stages', label: 'Étages', sortable: true },
    { id: 'efficiency', label: 'Rendement', sortable: true },
    { id: 'action', label: 'Schéma', sortable: false }
  ];

  // ===== Constructeur =====

  /**
   * Crée une instance de ResultsTable.
   * Initialise le tri par défaut (écart croissant), les filtres par type,
   * et construit les en-têtes triables.
   *
   * @constructor
   * @param {string} tbodyId - Identifiant de l'élément <tbody> du tableau
   * @param {GearApp.core.EventBus} [eventBus=GearApp.eventBus] - Instance de l'EventBus
   */
  function ResultsTable(tbodyId, eventBus) {
    /** @type {HTMLElement|null} @private Élément <tbody> du tableau de résultats */
    this._tbody = document.getElementById(tbodyId);
    /** @type {HTMLTableElement|null} @private Élément <table> parent */
    this._table = this._tbody ? this._tbody.closest('table') : null;
    /** @type {GearApp.core.EventBus} @private Bus d'événements */
    this._eventBus = eventBus || GearApp.eventBus;
    /** @type {Array<Array>} @private Liste brute des solutions */
    this._solutions = [];
    /** @type {Array<Object>} @private Cache de données pré-calculées pour le tri et le filtrage */
    this._displayData = []; // cache: { solution, ratio, error, efficiency, types }
    /** @type {number} @private Index de la solution actuellement sélectionnée */
    this._selectedIndex = 0;
    /** @type {GearApp.models.SearchParams|null} @private Paramètres de la dernière recherche */
    this._params = null;

    // ===== État du tri =====
    /** @type {string} @private Colonne de tri courante (par défaut : 'error') */
    this._sortColumn = 'error'; // tri par défaut sur l'écart
    /** @type {string} @private Direction du tri ('asc' ou 'desc') */
    this._sortDirection = 'asc';

    // ===== Filtres par type =====
    /** @type {Object.<string, boolean>} @private État des filtres par type (true = visible) */
    this._typeFilters = {}; // typeId -> bool (true = visible)
    /** @type {Array<string>} @private Liste des types présents dans les résultats courants */
    this._allTypes = []; // types présents dans les résultats

    // ===== Mode comparaison =====
    /** @type {boolean} @private Indique si le mode comparaison est activé */
    this._comparisonMode = false;
    /** @type {Set<number>} @private Ensemble des index des solutions cochées en mode comparaison */
    this._comparedIndices = new Set();

    this._initSortableHeaders();
  }

  // ===== Accesseurs =====

  /**
   * Retourne la liste complète des solutions.
   *
   * @returns {Array<Array>} Liste des solutions
   */
  ResultsTable.prototype.getSolutions = function () {
    return this._solutions;
  };

  /**
   * Retourne une solution par son index.
   *
   * @param {number} index - Index de la solution
   * @returns {Array<Array>} La solution à l'index donné
   */
  ResultsTable.prototype.getSolution = function (index) {
    return this._solutions[index];
  };

  /**
   * Retourne l'index de la solution actuellement sélectionnée.
   *
   * @returns {number} Index de la solution sélectionnée
   */
  ResultsTable.prototype.getSelectedIndex = function () {
    return this._selectedIndex;
  };

  // ===== Calculs internes =====

  /**
   * Calcule le rapport total type-aware d'une solution.
   * Utilise le registre de types pour appliquer la formule de rapport
   * spécifique à chaque type de transmission.
   *
   * @private
   * @param {Array<Array>} solution - Solution (tuples [A, B, typeId] par étage)
   * @returns {number} Rapport de réduction total
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
   * Préserve l'ordre d'apparition des types dans les étages.
   *
   * @private
   * @param {Array<Array>} solution - Solution (tuples [A, B, typeId] par étage)
   * @returns {Array<string>} Liste des identifiants de types uniques
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

  // ===== En-têtes triables =====

  /**
   * Construit les en-têtes triables dans le <thead>.
   * Chaque en-tête triable est cliquable et affiche un indicateur de direction (▲/▼).
   * L'en-tête de la colonne de tri courante est mis en surbrillance.
   *
   * @private
   * @returns {void}
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
        // Clic sur l'en-tête : basculer le tri
        th.onclick = function () { self._onHeaderClick(col.id); };

        // Indicateur de direction du tri
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
   * Gestionnaire de clic sur un en-tête de colonne.
   * Si la colonne cliquée est déjà la colonne de tri, inverse la direction.
   * Sinon, change la colonne de tri avec direction ascendante par défaut.
   *
   * @private
   * @param {string} colId - Identifiant de la colonne cliquée
   * @returns {void}
   */
  ResultsTable.prototype._onHeaderClick = function (colId) {
    if (this._sortColumn === colId) {
      // Même colonne : inverser la direction
      this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // Nouvelle colonne : tri ascendant par défaut
      this._sortColumn = colId;
      this._sortDirection = 'asc';
    }
    this._updateSortIndicators();
    this._renderFiltered();
  };

  /**
   * Met à jour les indicateurs visuels de tri dans les en-têtes.
   * Retire la mise en surbrillance de toutes les colonnes et l'applique
   * uniquement à la colonne de tri courante.
   *
   * @private
   * @returns {void}
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

  // ===== Barre de filtres par type =====

  /**
   * Construit la barre de filtres par type au-dessus du tableau.
   * Affiche des "chips" cliquables pour chaque type de transmission présent
   * dans les résultats, plus un bouton "Tous" pour réinitialiser.
   * N'affiche rien s'il n'y a qu'un seul type dans les résultats.
   *
   * @private
   * @returns {void}
   */
  ResultsTable.prototype._buildTypeFilterBar = function () {
    var container = this._table ? this._table.parentElement : null;
    if (!container) return;

    // Supprimer l'ancienne barre si elle existe
    var existing = container.parentElement.querySelector('.type-filter-bar');
    if (existing) existing.remove();

    // Pas utile s'il n'y a qu'un seul type dans les résultats
    if (this._allTypes.length <= 1) return;

    var bar = document.createElement('div');
    bar.className = 'type-filter-bar';

    var label = document.createElement('span');
    label.className = 'filter-label';
    label.textContent = 'Filtrer :';
    bar.appendChild(label);

    var self = this;
    var registry = GearApp.models.typeRegistry;

    // Bouton "Tous" pour réinitialiser les filtres
    var allBtn = document.createElement('button');
    allBtn.className = 'filter-chip filter-chip-all active';
    allBtn.textContent = 'Tous';
    allBtn.onclick = function () { self._resetFilters(); };
    bar.appendChild(allBtn);

    // Un chip par type de transmission présent
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

    // Insérer avant le conteneur scrollable du tableau
    container.parentElement.insertBefore(bar, container);
  };

  // ===== Gestion des filtres =====

  /**
   * Active/désactive un filtre de type.
   * Si aucun filtre n'est actif après la bascule, réinitialise tous les filtres
   * (comportement "tout sélectionner" par défaut).
   *
   * @private
   * @param {string} typeId - Identifiant du type à basculer
   * @returns {void}
   */
  ResultsTable.prototype._toggleTypeFilter = function (typeId) {
    this._typeFilters[typeId] = !this._typeFilters[typeId];

    // Si aucun filtre n'est actif, réactiver tous les filtres
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

  /**
   * Réinitialise tous les filtres de type (tous actifs).
   *
   * @private
   * @returns {void}
   */
  ResultsTable.prototype._resetFilters = function () {
    var self = this;
    this._allTypes.forEach(function (typeId) {
      self._typeFilters[typeId] = true;
    });
    this._updateFilterChips();
    this._renderFiltered();
  };

  /**
   * Met à jour l'état visuel des chips de filtre (classe 'active').
   * Le chip "Tous" est actif uniquement si tous les types sont actifs.
   *
   * @private
   * @returns {void}
   */
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

    // Le chip "Tous" est actif seulement si tous les filtres sont actifs
    var allChip = container.querySelector('.filter-chip-all');
    if (allChip) allChip.classList.toggle('active', allActive);
  };

  // ===== Préparation des données =====

  /**
   * Prépare les données de cache pour le tri et le filtrage.
   * Pré-calcule le rapport, l'écart, les types et le total de dents.
   * Le rendement est calculé en lazy (à la demande) pour éviter de bloquer l'UI
   * lors de l'affichage de grands ensembles de résultats.
   *
   * @private
   * @returns {void}
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
   * Le calcul n'est effectué qu'une seule fois par solution (résultat mis en cache).
   * Nécessite que le paramètre "module" soit renseigné.
   *
   * @private
   * @param {Object} dataItem - Élément du cache _displayData
   * @returns {number|null} Rendement (0..1) ou null si le module n'est pas renseigné
   */
  ResultsTable.prototype._computeEfficiency = function (dataItem) {
    if (dataItem._efficiencyComputed) return dataItem.efficiency;
    var modValue = this._params ? this._params.module : null;
    if (modValue) {
      // Calcul complet de l'analyse mécanique pour obtenir le rendement
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

  // ===== Filtrage, tri et rendu =====

  /**
   * Filtre et trie les données, puis re-rend les lignes du tableau.
   * Le filtrage ne conserve que les solutions ayant au moins un type
   * parmi les filtres actifs. Le tri s'effectue selon la colonne et
   * la direction courantes.
   *
   * @private
   * @returns {void}
   */
  ResultsTable.prototype._renderFiltered = function () {
    var self = this;

    // Filtrer : conserver les solutions ayant au moins un type dans les filtres actifs
    var filtered = this._displayData.filter(function (d) {
      return d.types.some(function (typeId) {
        return self._typeFilters[typeId];
      });
    });

    // Trier selon la colonne et la direction courantes
    filtered.sort(function (a, b) {
      var va, vb;
      switch (self._sortColumn) {
        case 'gears':
          // Tri par nombre total de dents
          va = a.totalTeeth; vb = b.totalTeeth; break;
        case 'types':
          // Tri alphabétique sur les noms de types
          va = a.typesStr; vb = b.typesStr;
          return self._sortDirection === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'ratio':
          va = a.ratio; vb = b.ratio; break;
        case 'error':
          va = a.error; vb = b.error; break;
        case 'stages':
          va = a.stages; vb = b.stages; break;
        case 'efficiency':
          // Déclenche le calcul lazy du rendement si nécessaire
          va = self._computeEfficiency(a) || 0; vb = self._computeEfficiency(b) || 0; break;
        default:
          va = a.error; vb = b.error;
      }
      var diff = va - vb;
      return self._sortDirection === 'asc' ? diff : -diff;
    });

    // Rendre les lignes filtrées et triées
    this._renderRows(filtered);

    // Mettre à jour le compteur de résultats
    this._updateCounter(filtered.length, this._displayData.length);
  };

  /**
   * Met à jour le compteur de résultats filtrés.
   * Affiche "N résultat(s)" ou "N / M résultat(s) affichés" si filtré.
   *
   * @private
   * @param {number} shown - Nombre de résultats affichés après filtrage
   * @param {number} total - Nombre total de résultats avant filtrage
   * @returns {void}
   */
  ResultsTable.prototype._updateCounter = function (shown, total) {
    var container = this._table ? this._table.parentElement.parentElement : null;
    if (!container) return;
    var counter = container.querySelector('.results-counter');
    // Créer le compteur s'il n'existe pas encore
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

  // ===== Rendu des lignes =====

  /**
   * Rend les lignes du tableau à partir des données pré-calculées.
   * Chaque ligne contient : engrenages (format A:N, B:N), badges de types,
   * rapport, écart, nombre d'étages, rendement, et bouton "Voir" / checkbox.
   * En mode comparaison, ajoute une checkbox pour chaque ligne.
   *
   * @private
   * @param {Array<Object>} dataItems - Données filtrées et triées à afficher
   * @returns {void}
   */
  ResultsTable.prototype._renderRows = function (dataItems) {
    this._tbody.innerHTML = '';

    if (dataItems.length === 0) {
      this._tbody.innerHTML = "<tr><td colspan='7'>Aucun résultat correspondant aux filtres</td></tr>";
      return;
    }

    var self = this;
    var registry = GearApp.models.typeRegistry;
    // Lettres pour nommer les roues : A, B, C, D...
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    dataItems.forEach(function (data, displayIdx) {
      var row = document.createElement("tr");
      row.classList.add("result-row");
      // Stocker l'index original pour la sélection
      row.setAttribute('data-original-idx', data.originalIndex);
      if (data.originalIndex === self._selectedIndex) row.classList.add("selected-row");

      // Clic sur la ligne : sélectionner cette solution
      row.onclick = function () { self.selectSolution(data.originalIndex); };

      // Colonne engrenages (format A:10, B:30 ; C:12, D:48)
      var gearsCell = document.createElement("td");
      var gearsHtml = "";
      data.solution.forEach(function (stage, i) {
        gearsHtml += "<span>" + letters[2 * i] + ":" + stage[0] + ", " + letters[2 * i + 1] + ":" + stage[1] + "</span>";
        if (i < data.solution.length - 1) gearsHtml += " ; ";
      });
      gearsCell.innerHTML = gearsHtml;

      // Colonne types (badges colorés par type de transmission)
      var typesCell = document.createElement("td");
      data.solution.forEach(function (stage) {
        var typeId = stage[2] || 'spur';
        var type = registry.get(typeId);
        var badge = document.createElement("span");
        badge.className = "type-badge " + typeId;
        badge.textContent = type.nomCourt;
        typesCell.appendChild(badge);
      });

      // Colonne rapport de réduction
      var ratioCell = document.createElement("td");
      ratioCell.innerText = data.ratio.toFixed(4);

      // Colonne écart par rapport au rapport cible (%)
      var errorCell = document.createElement("td");
      errorCell.innerText = data.error.toFixed(3);
      // Classification visuelle : <0.01% excellent, <0.1% bon
      if (data.error < 0.01) errorCell.classList.add("excellent");
      else if (data.error < 0.1) errorCell.classList.add("good");

      // Colonne nombre d'étages
      var stagesCell = document.createElement("td");
      stagesCell.innerText = data.stages;

      // Colonne rendement (calculé en lazy pour les lignes visibles)
      var effCell = document.createElement("td");
      var eff = self._computeEfficiency(data);
      if (eff !== null) {
        effCell.innerText = (eff * 100).toFixed(1) + "%";
        // Classification visuelle : >95% excellent, >90% bon
        if (eff > 0.95) effCell.classList.add("excellent");
        else if (eff > 0.90) effCell.classList.add("good");
      } else {
        effCell.innerText = "-";
      }

      // Colonne action : bouton "Voir" et checkbox en mode comparaison
      var buttonCell = document.createElement("td");
      if (self._comparisonMode) {
        // Checkbox de sélection pour la comparaison
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = self._comparedIndices.has(data.originalIndex);
        checkbox.onchange = function () {
          if (checkbox.checked) self._comparedIndices.add(data.originalIndex);
          else self._comparedIndices.delete(data.originalIndex);
          // Notifier les autres composants de la nouvelle sélection
          self._eventBus.emit('comparison:selectionChanged', {
            indices: Array.from(self._comparedIndices)
          });
        };
        buttonCell.appendChild(checkbox);
      }
      // Bouton "Voir" pour afficher le schéma
      var btn = document.createElement("button");
      btn.innerText = "Voir";
      btn.classList.add("btn-schema");
      btn.onclick = function (e) {
        e.stopPropagation(); // Empêcher le clic de la ligne
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

  // ===== Affichage principal =====

  /**
   * Affiche les résultats dans le tableau.
   * Point d'entrée principal appelé par UIController.
   * Réinitialise la sélection, collecte les types, prépare les données,
   * construit la barre de filtres, et lance le rendu filtré/trié.
   * Sélectionne automatiquement la première solution.
   *
   * @param {Array<Array>} solutions - Liste des solutions à afficher
   * @param {GearApp.models.SearchParams|Object} params - Paramètres de recherche (rapport cible, module, etc.)
   * @returns {void}
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

    // Collecter tous les types de transmission présents dans les résultats
    var typesSet = {};
    solutions.forEach(function (sol) {
      sol.forEach(function (stage) {
        typesSet[stage[2] || 'spur'] = true;
      });
    });
    this._allTypes = Object.keys(typesSet);

    // Initialiser les filtres (tous actifs par défaut pour les nouveaux types)
    var self = this;
    this._allTypes.forEach(function (t) {
      if (self._typeFilters[t] === undefined) self._typeFilters[t] = true;
    });

    // Préparer les données, construire les filtres, et lancer le rendu
    this._prepareDisplayData();
    this._buildTypeFilterBar();
    this._updateSortIndicators();
    this._renderFiltered();

    // Sélectionner automatiquement la première solution
    this.selectSolution(0);
  };

  // ===== Sélection d'une solution =====

  /**
   * Sélectionne une solution par son index original.
   * Met à jour la mise en surbrillance de la ligne dans le tableau
   * et émet l'événement 'solution:selected' via l'EventBus.
   *
   * @param {number} index - Index de la solution dans le tableau original
   * @returns {void}
   */
  ResultsTable.prototype.selectSolution = function (index) {
    this._selectedIndex = index;
    // Mettre à jour la mise en surbrillance
    var rows = this._tbody.querySelectorAll(".result-row");
    rows.forEach(function (row) {
      var idx = parseInt(row.getAttribute('data-original-idx'), 10);
      row.classList.toggle("selected-row", idx === index);
    });
    var solution = this._solutions[index];
    if (solution) {
      // Émettre l'événement de sélection pour le UIController
      this._eventBus.emit('solution:selected', { index: index, solution: solution });
    }
  };

  // ===== Mode comparaison =====

  /**
   * Active/désactive le mode comparaison.
   * En mode comparaison, des checkboxes apparaissent dans chaque ligne
   * pour permettre la sélection de plusieurs solutions à comparer.
   * La désactivation vide la sélection de comparaison.
   *
   * @param {boolean} enabled - true pour activer le mode comparaison
   * @returns {void}
   */
  ResultsTable.prototype.setComparisonMode = function (enabled) {
    this._comparisonMode = enabled;
    if (!enabled) this._comparedIndices.clear();
    this._renderFiltered();
  };

  /**
   * Retourne la liste des solutions cochées en mode comparaison.
   *
   * @returns {Array<Array>} Liste des solutions sélectionnées pour la comparaison
   */
  ResultsTable.prototype.getComparedSolutions = function () {
    var self = this;
    return Array.from(this._comparedIndices).map(function (idx) {
      return self._solutions[idx];
    });
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.ui.ResultsTable = ResultsTable;

})(GearApp);
