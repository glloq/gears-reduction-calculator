// Engine.js - Moteur de recherche avec support Web Worker
// Découplé de l'UI via EventBus

(function (GearApp) {

  function Engine(eventBus) {
    this._worker = null;
    this._isRunning = false;
    this._eventBus = eventBus || GearApp.eventBus;
  }

  Object.defineProperty(Engine.prototype, 'isRunning', {
    get: function () { return this._isRunning; }
  });

  /**
   * Lance la recherche. Accepte un SearchParams ou un objet plat.
   */
  Engine.prototype.rechercher = function (searchParams) {
    var params;
    if (searchParams && typeof searchParams.toWorkerParams === 'function') {
      params = searchParams.toWorkerParams();
    } else {
      params = searchParams;
    }

    if (window.Worker) {
      return this._rechercherAvecWorker(params);
    }
    return this._rechercherFallback(params);
  };

  Engine.prototype._rechercherAvecWorker = function (params) {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (self._worker) {
        self._worker.terminate();
      }

      self._worker = new Worker('js/core/worker.js');
      self._isRunning = true;

      self._worker.onmessage = function (e) {
        var data = e.data;
        switch (data.type) {
          case 'progress':
            self._eventBus.emit('search:log', {
              message: 'Itération: ' + data.iterations + '/' + data.maxIterations +
                ', profondeur: ' + data.profondeur +
                ', rapport: ' + data.rapportActuel.toFixed(3) +
                ', solutions: ' + data.solutionsCount
            });
            var percent = Math.min(95, (data.iterations / data.maxIterations) * 100);
            self._eventBus.emit('search:progress', { percent: percent });
            break;
          case 'solution_found':
            self._eventBus.emit('search:log', {
              message: 'Solution: [' + data.solution.map(function (p) { return '[' + p[0] + ',' + p[1] + ']'; }).join(' ') +
                '] rapport: ' + data.rapport.toFixed(3) + ' (écart: ' + data.ecart.toFixed(2) + '%)'
            });
            break;
          case 'partial_results':
            self._eventBus.emit('search:partial', {
              solutions: data.solutions,
              totalSolutions: data.totalSolutions
            });
            break;
          case 'log':
            self._eventBus.emit('search:log', { message: data.message });
            break;
          case 'done':
            self._eventBus.emit('search:log', {
              message: 'Terminé. ' + data.totalIterations + ' itérations, ' + data.totalSolutions + ' solutions trouvées.'
            });
            self._isRunning = false;
            self._worker.terminate();
            self._worker = null;
            resolve(data.solutions);
            break;
        }
      };

      self._worker.onerror = function (err) {
        self._eventBus.emit('search:log', { message: 'Erreur Worker: ' + err.message });
        self._isRunning = false;
        self._worker.terminate();
        self._worker = null;
        reject(err);
      };

      self._worker.postMessage(params);
    });
  };

  Engine.prototype.arreter = function () {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
      this._isRunning = false;
      this._eventBus.emit('search:log', { message: "Recherche interrompue par l'utilisateur." });
    }
  };

  // Contraintes par type (dupliquées du worker car le fallback n'a pas accès au Worker)
  var FALLBACK_TYPES = {
    spur:      { minA: 6,  maxA: 200, minB: 6,   maxB: 200, maxRatio: 8,   calcRapport: function (A, B) { return B / A; }, reductionOnly: false },
    helical:   { minA: 8,  maxA: 200, minB: 8,   maxB: 200, maxRatio: 10,  calcRapport: function (A, B) { return B / A; }, reductionOnly: false },
    internal:  { minA: 10, maxA: 80,  minB: 20,  maxB: 300, maxRatio: 12,  calcRapport: function (A, B) { return B / A; }, reductionOnly: true, diffMin: 10 },
    bevel:     { minA: 10, maxA: 80,  minB: 10,  maxB: 120, maxRatio: 6,   calcRapport: function (A, B) { return B / A; }, reductionOnly: false },
    belt:      { minA: 10, maxA: 200, minB: 10,  maxB: 500, maxRatio: 10,  calcRapport: function (A, B) { return B / A; }, reductionOnly: false },
    epicyclic: { minA: 12, maxA: 60,  minB: 30,  maxB: 200, maxRatio: 12,  calcRapport: function (A, B) { return 1 + B / A; }, reductionOnly: true,
                 validCombo: function (A, B) { return (A + B) % 3 === 0 && (B - A) > 0 && (B - A) % 2 === 0; } },
    worm:      { minA: 1,  maxA: 6,   minB: 15,  maxB: 120, maxRatio: 100, calcRapport: function (A, B) { return B / A; }, reductionOnly: true }
  };

  Engine.prototype._rechercherFallback = function (params) {
    var self = this;
    var solutions = [];
    var compteurIterations = 0;
    var LOG_FREQUENCY = 10000;

    var activeTypes = (params.typesActifs && params.typesActifs.length > 0) ? params.typesActifs : ['spur'];

    // Calcul du ratio max possible par étage pour l'élagage
    var maxRatioParEtage = 1;
    for (var t = 0; t < activeTypes.length; t++) {
      var tc = FALLBACK_TYPES[activeTypes[t]];
      if (tc && tc.maxRatio > maxRatioParEtage) maxRatioParEtage = tc.maxRatio;
    }

    function rechercher(chaine, profondeur, rapportActuel, etageLimite) {
      if (compteurIterations > params.maxIterations) return;

      if (profondeur === etageLimite) {
        var ecart = Math.abs((rapportActuel - params.rapportCible) / params.rapportCible) * 100;
        if (ecart <= params.precisionToleree) {
          solutions.push({ chaine: chaine, rapport: rapportActuel, ecart: ecart });
        }
        return;
      }

      // Itérer sur chaque type actif
      for (var ti = 0; ti < activeTypes.length; ti++) {
        var typeId = activeTypes[ti];
        var typeConf = FALLBACK_TYPES[typeId];
        if (!typeConf) continue;

        var aMin = Math.max(typeConf.minA, params.dentMenanteMin);
        var aMax = Math.min(typeConf.maxA, params.dentMenanteMax);
        var bMin = Math.max(typeConf.minB, params.dentMeneeMin);
        var bMax = Math.min(typeConf.maxB, params.dentMeneeMax);

        // Premier engrenage fixe
        if (profondeur === 0 && params.dentMenanteFixe != null) {
          if (params.dentMenanteFixe >= typeConf.minA && params.dentMenanteFixe <= typeConf.maxA) {
            aMin = params.dentMenanteFixe;
            aMax = params.dentMenanteFixe;
          } else {
            continue;
          }
        }

        for (var A = aMin; A <= aMax; A++) {
          if (compteurIterations > params.maxIterations) return;

          for (var B = bMin; B <= bMax; B++) {
            if (compteurIterations > params.maxIterations) return;
            compteurIterations++;

            if (compteurIterations % LOG_FREQUENCY === 0) {
              self._eventBus.emit('search:log', {
                message: 'Itération: ' + compteurIterations + ', profondeur: ' + profondeur +
                  ', type: ' + typeId + ', rapportActuel: ' + rapportActuel.toFixed(3)
              });
            }

            // Contrainte de réduction
            if (typeConf.reductionOnly && B <= A) continue;
            if (!typeConf.reductionOnly && params.allowReductionOnly && B <= A) continue;
            if (!typeConf.reductionOnly && !params.allowReductionOnly && B === A) continue;

            // Contraintes spécifiques
            if (typeConf.diffMin && (B - A) < typeConf.diffMin) continue;
            if (typeConf.validCombo && !typeConf.validCombo(A, B)) continue;

            // Dernier engrenage fixe
            if (profondeur === etageLimite - 1 && params.dentMeneeFixe != null) {
              if (B !== params.dentMeneeFixe) continue;
            }

            var rapport = typeConf.calcRapport(A, B);
            var nouveauRapport = rapportActuel * rapport;

            // Élagage
            if (nouveauRapport > params.rapportCible * (1 + params.precisionToleree / 100) * 1.5) continue;
            var etagesRestants = etageLimite - profondeur - 1;
            if (etagesRestants > 0) {
              if (nouveauRapport * Math.pow(maxRatioParEtage, etagesRestants) < params.rapportCible * (1 - params.precisionToleree / 100)) continue;
            }

            rechercher([].concat(chaine, [[A, B, typeId]]), profondeur + 1, nouveauRapport, etageLimite);
          }
        }
      }
    }

    return new Promise(function (resolve) {
      for (var etageLimite = 1; etageLimite <= params.maxEtages; etageLimite++) {
        solutions = [];
        self._eventBus.emit('search:log', {
          message: 'Recherche pour ' + etageLimite + ' étage(s) avec types: [' + activeTypes.join(', ') + ']...'
        });
        rechercher([], 0, 1, etageLimite);
        if (solutions.length > 0) {
          self._eventBus.emit('search:log', {
            message: solutions.length + ' solution(s) trouvée(s) avec ' + etageLimite + ' étage(s).'
          });
          break;
        }
        self._eventBus.emit('search:log', { message: 'Aucune solution pour ' + etageLimite + ' étage(s).' });
      }

      solutions.sort(function (a, b) {
        return Math.abs(a.rapport - params.rapportCible) - Math.abs(b.rapport - params.rapportCible);
      });
      resolve(solutions.slice(0, params.maxSolutions).map(function (s) { return s.chaine; }));
    });
  };

  GearApp.core.Engine = Engine;

})(GearApp);
