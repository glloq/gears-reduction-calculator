/**
 * @file ComparisonManager.js - Système de comparaison multi-sorties
 * @description Permet de définir plusieurs rapports de réduction cibles et de lancer
 *              des recherches parallèles pour comparer les solutions obtenues.
 *              Chaque "sortie" (output) représente un rapport cible avec ses solutions.
 *
 *   Structure d'un objet output :
 *   {
 *     id: number,                // Identifiant unique auto-incrémenté
 *     ratio: number|string,      // Rapport de réduction cible
 *     label: string,             // Nom personnalisable (ex: "Sortie 1")
 *     solutions: Array<Array>,   // Solutions trouvées (tuples [A, B, typeId] par étage)
 *     selectedIdx: number        // Index de la solution sélectionnée pour la comparaison
 *   }
 *
 *   Flux d'utilisation :
 *   1. L'utilisateur ouvre le panneau (toggle)
 *   2. Ajoute des sorties avec des rapports cibles (addOutput)
 *   3. Lance la recherche pour toutes les sorties (runAll)
 *   4. Compare les solutions via le tableau récapitulatif (_renderSummary)
 *
 * @namespace GearApp.ui.ComparisonManager
 */

(function (GearApp) {

  // ===== Constructeur =====

  /**
   * Crée une instance de ComparisonManager.
   * Construit l'interface utilisateur et lie les événements des boutons.
   *
   * @constructor
   * @param {string} panelId - Identifiant de l'élément DOM du panneau de comparaison
   * @param {GearApp.core.EventBus} [eventBus=GearApp.eventBus] - Instance de l'EventBus
   */
  function ComparisonManager(panelId, eventBus) {
    /** @type {HTMLElement|null} @private Élément DOM du panneau de comparaison */
    this._panel = document.getElementById(panelId);
    /** @type {GearApp.core.EventBus} @private Bus d'événements */
    this._eventBus = eventBus || GearApp.eventBus;
    /** @type {Array<Object>} @private Liste des sorties (outputs) à comparer */
    this._outputs = []; // { id, ratio, label, solutions, selectedIdx }
    /** @type {number} @private Compteur auto-incrémenté pour les identifiants de sortie */
    this._nextId = 1;
    /** @type {boolean} @private État d'ouverture du panneau */
    this._isOpen = false;
    /** @type {GearApp.core.Engine|null} @private Référence vers le moteur de recherche */
    this._engine = null;

    this._buildUI();
    this._bindEvents();
  }

  // ===== Configuration =====

  /**
   * Définit le moteur de recherche utilisé pour les recherches multi-sorties.
   *
   * @param {GearApp.core.Engine} engine - Instance du moteur de recherche
   * @returns {void}
   */
  ComparisonManager.prototype.setEngine = function (engine) {
    this._engine = engine;
  };

  // ===== Construction de l'interface =====

  /**
   * Construit le HTML initial du panneau de comparaison.
   * Crée l'en-tête descriptif, la zone d'entrée des rapports,
   * les boutons d'action et les conteneurs de résultats/résumé.
   *
   * @private
   * @returns {void}
   */
  ComparisonManager.prototype._buildUI = function () {
    if (!this._panel) return;

    this._panel.innerHTML =
      '<div class="comparison-header">' +
        '<h3>Comparaison multi-sorties</h3>' +
        '<p class="comparison-desc">Définissez plusieurs rapports cibles pour comparer les solutions de transmission.</p>' +
      '</div>' +
      '<div class="comparison-inputs" id="compOutputsList"></div>' +
      '<div class="comparison-actions">' +
        '<button class="btn-secondary" id="compAddOutput">+ Ajouter un rapport</button>' +
        '<button class="btn-primary" id="compRunAll">Rechercher tout</button>' +
      '</div>' +
      '<div id="compResults" class="comparison-results"></div>' +
      '<div id="compSummary" class="comparison-summary" style="display:none;"></div>';
  };

  // ===== Liaison des événements =====

  /**
   * Lie les gestionnaires de clic aux boutons "Ajouter" et "Rechercher tout".
   *
   * @private
   * @returns {void}
   */
  ComparisonManager.prototype._bindEvents = function () {
    var self = this;

    // Bouton : ajouter une nouvelle sortie
    var addBtn = document.getElementById('compAddOutput');
    if (addBtn) {
      addBtn.onclick = function () { self.addOutput(); };
    }

    // Bouton : lancer la recherche pour toutes les sorties
    var runBtn = document.getElementById('compRunAll');
    if (runBtn) {
      runBtn.onclick = function () { self.runAll(); };
    }
  };

  // ===== Ouverture / Fermeture du panneau =====

  /**
   * Bascule la visibilité du panneau de comparaison.
   * À la première ouverture, crée automatiquement deux sorties par défaut.
   *
   * @returns {void}
   */
  ComparisonManager.prototype.toggle = function () {
    this._isOpen = !this._isOpen;
    if (this._panel) {
      this._panel.style.display = this._isOpen ? 'block' : 'none';
    }
    // Création automatique de deux sorties par défaut à la première ouverture
    if (this._isOpen && this._outputs.length === 0) {
      this.addOutput(null, 'Sortie 1');
      this.addOutput(null, 'Sortie 2');
    }
  };

  /**
   * Retourne l'état d'ouverture du panneau.
   *
   * @returns {boolean} true si le panneau est ouvert
   */
  ComparisonManager.prototype.isOpen = function () {
    return this._isOpen;
  };

  // ===== Gestion des sorties =====

  /**
   * Ajoute une sortie à comparer.
   * Crée un objet output avec un identifiant unique auto-incrémenté
   * et met à jour l'affichage des entrées.
   *
   * @param {number|string|null} [ratio] - Rapport cible (vide par défaut)
   * @param {string} [label] - Nom de la sortie (auto-généré si non fourni)
   * @returns {number} L'identifiant unique de la sortie créée
   */
  ComparisonManager.prototype.addOutput = function (ratio, label) {
    var id = this._nextId++;
    var output = {
      id: id,
      ratio: ratio || '',
      label: label || ('Sortie ' + id),
      solutions: [],
      selectedIdx: 0
    };
    this._outputs.push(output);
    this._renderInputs();
    return id;
  };

  /**
   * Supprime une sortie par son identifiant.
   * Met à jour l'affichage des entrées et des résultats.
   *
   * @param {number} id - Identifiant de la sortie à supprimer
   * @returns {void}
   */
  ComparisonManager.prototype.removeOutput = function (id) {
    this._outputs = this._outputs.filter(function (o) { return o.id !== id; });
    this._renderInputs();
    this._renderResults();
  };

  // ===== Rendu des entrées =====

  /**
   * Rend la liste des champs de saisie pour chaque sortie.
   * Chaque ligne contient : un champ nom, un champ rapport cible, un bouton supprimer.
   * Les modifications sont répercutées en temps réel dans l'objet output correspondant.
   *
   * @private
   * @returns {void}
   */
  ComparisonManager.prototype._renderInputs = function () {
    var container = document.getElementById('compOutputsList');
    if (!container) return;
    container.innerHTML = '';

    var self = this;
    this._outputs.forEach(function (output, idx) {
      var row = document.createElement('div');
      row.className = 'comp-input-row';

      row.innerHTML =
        '<input type="text" class="comp-label-input" value="' + self._escapeAttr(output.label) + '" ' +
          'placeholder="Nom" data-id="' + output.id + '" data-field="label">' +
        '<input type="number" class="comp-ratio-input" value="' + (output.ratio || '') + '" ' +
          'placeholder="Rapport cible" step="0.1" min="0.1" data-id="' + output.id + '" data-field="ratio">' +
        '<button class="btn-icon comp-remove-btn" data-id="' + output.id + '" title="Supprimer">&times;</button>';

      // Liaison des événements de saisie pour mise à jour en temps réel
      var inputs = row.querySelectorAll('input');
      inputs.forEach(function (input) {
        input.oninput = function () {
          var oid = parseInt(input.getAttribute('data-id'), 10);
          var field = input.getAttribute('data-field');
          var o = self._getOutput(oid);
          // Le champ "ratio" est converti en nombre, les autres restent en texte
          if (o) o[field] = field === 'ratio' ? parseFloat(input.value) : input.value;
        };
      });

      // Bouton de suppression de la sortie
      var removeBtn = row.querySelector('.comp-remove-btn');
      if (removeBtn) {
        removeBtn.onclick = function () {
          self.removeOutput(parseInt(removeBtn.getAttribute('data-id'), 10));
        };
      }

      container.appendChild(row);
    });
  };

  // ===== Utilitaires internes =====

  /**
   * Recherche un objet output par son identifiant.
   *
   * @private
   * @param {number} id - Identifiant de la sortie
   * @returns {Object|null} L'objet output trouvé, ou null
   */
  ComparisonManager.prototype._getOutput = function (id) {
    for (var i = 0; i < this._outputs.length; i++) {
      if (this._outputs[i].id === id) return this._outputs[i];
    }
    return null;
  };

  /**
   * Échappe les caractères spéciaux HTML pour les attributs.
   * Protège contre l'injection HTML dans les valeurs d'attribut.
   *
   * @private
   * @param {string} str - Chaîne à échapper
   * @returns {string} Chaîne échappée
   */
  ComparisonManager.prototype._escapeAttr = function (str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  };

  // ===== Recherche multi-sorties =====

  /**
   * Lance la recherche pour toutes les sorties ayant un rapport cible valide.
   * Clone les paramètres de recherche du formulaire principal pour chaque sortie,
   * en remplaçant le rapport cible. Les recherches sont lancées en parallèle
   * et les résultats sont affichés une fois toutes les recherches terminées.
   *
   * @returns {void}
   */
  ComparisonManager.prototype.runAll = function () {
    // Tentative de récupération du moteur de recherche si non défini
    if (!this._engine) {
      this._engine = GearApp._engine; // fallback
    }
    if (!this._engine) return;

    var self = this;
    // Filtrer les sorties avec un rapport cible valide (nombre positif)
    var validOutputs = this._outputs.filter(function (o) {
      return o.ratio && !isNaN(o.ratio) && o.ratio > 0;
    });

    if (validOutputs.length === 0) return;

    // Afficher un message de recherche en cours
    var resultsContainer = document.getElementById('compResults');
    if (resultsContainer) {
      resultsContainer.innerHTML = '<p class="comp-searching">Recherche en cours...</p>';
    }

    // Obtenir les paramètres de base depuis le formulaire
    var baseParams = GearApp.models.SearchParams.fromForm();
    var completed = 0;

    // Lancer une recherche par sortie avec le rapport cible modifié
    validOutputs.forEach(function (output) {
      // Cloner les params depuis le formulaire avec le rapport cible spécifique
      var params = GearApp.models.SearchParams.fromForm();
      params.rapportCible = output.ratio;

      self._engine.rechercher(params).then(function (solutions) {
        output.solutions = solutions;
        output.selectedIdx = 0;
        completed++;
        // Afficher les résultats quand toutes les recherches sont terminées
        if (completed === validOutputs.length) {
          self._renderResults();
          self._renderSummary();
        }
      }).catch(function () {
        output.solutions = [];
        completed++;
        // Même en cas d'erreur, vérifier si c'est la dernière recherche
        if (completed === validOutputs.length) {
          self._renderResults();
          self._renderSummary();
        }
      });
    });
  };

  // ===== Rendu des résultats =====

  /**
   * Rend les résultats pour chaque sortie sous forme de cartes.
   * Chaque carte affiche : en-tête (nom, cible, nombre de solutions),
   * mini-tableau des 5 premières solutions avec sélection par radio.
   * Un clic sur une ligne sélectionne la solution pour la comparaison.
   *
   * @private
   * @returns {void}
   */
  ComparisonManager.prototype._renderResults = function () {
    var container = document.getElementById('compResults');
    if (!container) return;
    container.innerHTML = '';

    var self = this;
    var registry = GearApp.models.typeRegistry;
    // Lettres pour nommer les roues : A, B, C, D...
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    this._outputs.forEach(function (output) {
      // Affichage "aucun résultat" si la sortie a un ratio mais pas de solutions
      if (!output.solutions || output.solutions.length === 0) {
        if (output.ratio) {
          var noResult = document.createElement('div');
          noResult.className = 'comp-output-card comp-no-result';
          noResult.innerHTML = '<h4>' + self._escapeHtml(output.label) +
            ' (r=' + output.ratio + ')</h4><p>Aucun résultat trouvé</p>';
          container.appendChild(noResult);
        }
        return;
      }

      // Carte de résultats pour cette sortie
      var card = document.createElement('div');
      card.className = 'comp-output-card';

      // En-tête de la carte : nom, rapport cible, nombre de solutions
      var header = document.createElement('div');
      header.className = 'comp-card-header';
      header.innerHTML = '<h4>' + self._escapeHtml(output.label) +
        '</h4><span class="comp-target">Cible : ' + output.ratio + ':1</span>' +
        '<span class="comp-count">' + output.solutions.length + ' solution(s)</span>';
      card.appendChild(header);

      // Mini-tableau des 5 premières solutions
      var table = document.createElement('table');
      table.className = 'comp-mini-table';
      table.innerHTML = '<thead><tr>' +
        '<th></th><th>Engrenages</th><th>Types</th><th>Rapport</th><th>Écart</th><th>Rend.</th>' +
        '</tr></thead>';
      var tbody = document.createElement('tbody');

      // Afficher au maximum 5 solutions
      var maxShow = Math.min(output.solutions.length, 5);
      for (var i = 0; i < maxShow; i++) {
        // IIFE pour capturer correctement l'index dans la closure
        (function (idx) {
          var sol = output.solutions[idx];
          var ratio = self._calculerRapport(sol);
          var error = Math.abs((ratio - output.ratio) / output.ratio * 100);

          var row = document.createElement('tr');
          row.className = 'comp-row';
          if (idx === output.selectedIdx) row.classList.add('comp-selected');
          // Clic sur la ligne : sélectionner cette solution et rafraîchir
          row.onclick = function () {
            output.selectedIdx = idx;
            self._renderResults();
            self._renderSummary();
          };

          // Colonne radio de sélection
          var radioCell = document.createElement('td');
          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'comp_output_' + output.id;
          radio.checked = idx === output.selectedIdx;
          radioCell.appendChild(radio);

          // Colonne engrenages (format A:10, B:30 ; C:12, D:48)
          var gearsCell = document.createElement('td');
          var gStr = sol.map(function (s, si) {
            return letters[2 * si] + ':' + s[0] + ',' + letters[2 * si + 1] + ':' + s[1];
          }).join(' ; ');
          gearsCell.textContent = gStr;

          // Colonne types (badges colorés)
          var typesCell = document.createElement('td');
          sol.forEach(function (stage) {
            var typeId = stage[2] || 'spur';
            var type = registry.get(typeId);
            var badge = document.createElement('span');
            badge.className = 'type-badge ' + typeId;
            badge.textContent = type.nomCourt;
            typesCell.appendChild(badge);
          });

          // Colonne rapport obtenu
          var ratioCell = document.createElement('td');
          ratioCell.textContent = ratio.toFixed(4);

          // Colonne écart en pourcentage par rapport au rapport cible
          var errorCell = document.createElement('td');
          errorCell.textContent = error.toFixed(3) + '%';
          if (error < 0.01) errorCell.classList.add('excellent');
          else if (error < 0.1) errorCell.classList.add('good');

          // Colonne rendement (non calculé dans la comparaison rapide)
          var effCell = document.createElement('td');
          effCell.textContent = '-';

          row.appendChild(radioCell);
          row.appendChild(gearsCell);
          row.appendChild(typesCell);
          row.appendChild(ratioCell);
          row.appendChild(errorCell);
          row.appendChild(effCell);
          tbody.appendChild(row);
        })(i);
      }

      table.appendChild(tbody);
      card.appendChild(table);
      container.appendChild(card);
    });
  };

  // ===== Tableau récapitulatif de comparaison =====

  /**
   * Rend le tableau récapitulatif comparant les solutions sélectionnées.
   * Compare pour chaque sortie : rapport cible, rapport obtenu, nombre d'étages,
   * types utilisés, total de dents, et nombre d'étages communs avec la référence.
   * Nécessite au moins 2 sorties avec des solutions pour s'afficher.
   *
   * @private
   * @returns {void}
   */
  ComparisonManager.prototype._renderSummary = function () {
    var summaryEl = document.getElementById('compSummary');
    if (!summaryEl) return;

    // Collecter les solutions sélectionnées pour chaque sortie
    var selected = [];
    var self = this;
    this._outputs.forEach(function (output) {
      if (output.solutions && output.solutions.length > 0) {
        var sol = output.solutions[output.selectedIdx] || output.solutions[0];
        selected.push({
          label: output.label,
          targetRatio: output.ratio,
          solution: sol,
          ratio: self._calculerRapport(sol)
        });
      }
    });

    // Le tableau comparatif n'a de sens qu'avec au moins 2 entrées
    if (selected.length < 2) {
      summaryEl.style.display = 'none';
      return;
    }

    summaryEl.style.display = 'block';
    var registry = GearApp.models.typeRegistry;

    // Construction du tableau comparatif
    var html = '<h4>Comparaison des solutions sélectionnées</h4>';
    html += '<table class="comp-summary-table"><thead><tr>';
    html += '<th>Propriété</th>';
    selected.forEach(function (s) {
      html += '<th>' + self._escapeHtml(s.label) + '</th>';
    });
    html += '</tr></thead><tbody>';

    // Ligne : rapport cible
    html += '<tr><td>Rapport cible</td>';
    selected.forEach(function (s) { html += '<td>' + s.targetRatio + ':1</td>'; });
    html += '</tr>';

    // Ligne : rapport obtenu
    html += '<tr><td>Rapport obtenu</td>';
    selected.forEach(function (s) { html += '<td>' + s.ratio.toFixed(4) + '</td>'; });
    html += '</tr>';

    // Ligne : nombre d'étages
    html += '<tr><td>Étages</td>';
    selected.forEach(function (s) { html += '<td>' + s.solution.length + '</td>'; });
    html += '</tr>';

    // Ligne : types de transmission utilisés
    html += '<tr><td>Types</td>';
    selected.forEach(function (s) {
      var types = s.solution.map(function (stage) {
        var typeId = stage[2] || 'spur';
        return '<span class="type-badge ' + typeId + '">' + registry.get(typeId).nomCourt + '</span>';
      }).join(' ');
      html += '<td>' + types + '</td>';
    });
    html += '</tr>';

    // Ligne : total de dents (somme de toutes les dents menantes + menées)
    html += '<tr><td>Total dents</td>';
    selected.forEach(function (s) {
      var total = s.solution.reduce(function (sum, stage) { return sum + stage[0] + stage[1]; }, 0);
      html += '<td>' + total + '</td>';
    });
    html += '</tr>';

    // Ligne : étages communs (par rapport à la première sortie comme référence)
    if (selected.length >= 2) {
      html += '<tr><td>Étages communs</td>';
      selected.forEach(function (s, idx) {
        if (idx === 0) {
          html += '<td>Référence</td>';
          return;
        }
        var common = self._findSharedStages(selected[0].solution, s.solution);
        html += '<td>' + (common > 0 ? common + ' étage(s)' : 'Aucun') + '</td>';
      });
      html += '</tr>';
    }

    html += '</tbody></table>';
    summaryEl.innerHTML = html;
  };

  // ===== Utilitaires de comparaison =====

  /**
   * Trouve le nombre d'étages communs entre deux solutions.
   * Deux étages sont considérés communs s'ils ont le même nombre de dents
   * menante et menée, et le même type de transmission, à la même position.
   *
   * @private
   * @param {Array<Array>} solA - Première solution
   * @param {Array<Array>} solB - Deuxième solution
   * @returns {number} Nombre d'étages communs
   */
  ComparisonManager.prototype._findSharedStages = function (solA, solB) {
    var count = 0;
    var minLen = Math.min(solA.length, solB.length);
    for (var i = 0; i < minLen; i++) {
      // Comparaison : mêmes dents A, mêmes dents B, même type (défaut: spur)
      if (solA[i][0] === solB[i][0] && solA[i][1] === solB[i][1] &&
          (solA[i][2] || 'spur') === (solB[i][2] || 'spur')) {
        count++;
      }
    }
    return count;
  };

  /**
   * Calcule le rapport de réduction total d'une solution en tenant compte
   * du type de transmission de chaque étage (via le registre de types).
   *
   * @private
   * @param {Array<Array>} solution - Solution (tuples [A, B, typeId] par étage)
   * @returns {number} Rapport de réduction total (produit des rapports de chaque étage)
   */
  ComparisonManager.prototype._calculerRapport = function (solution) {
    var registry = GearApp.models.typeRegistry;
    return solution.reduce(function (acc, stage) {
      var typeId = stage[2] || 'spur';
      return acc * registry.calculerRapportEtage(typeId, stage[0], stage[1]);
    }, 1);
  };

  /**
   * Échappe les caractères spéciaux HTML pour le contenu textuel.
   * Utilise un élément DOM temporaire pour un échappement sûr.
   *
   * @private
   * @param {string} str - Chaîne à échapper
   * @returns {string} Chaîne HTML-safe
   */
  ComparisonManager.prototype._escapeHtml = function (str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  // ===== Accesseurs =====

  /**
   * Retourne la liste de toutes les sorties (outputs) avec leurs solutions.
   *
   * @returns {Array<Object>} Liste des objets output
   */
  ComparisonManager.prototype.getOutputs = function () {
    return this._outputs;
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.ui.ComparisonManager = ComparisonManager;

})(GearApp);
