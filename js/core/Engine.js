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

  Engine.prototype._rechercherFallback = function (params) {
    var self = this;
    var solutions = [];
    var compteurIterations = 0;
    var LOG_FREQUENCY = 10000;

    function rechercher(chaine, profondeur, rapportActuel, etageLimite) {
      if (compteurIterations > params.maxIterations) return;
      compteurIterations++;

      if (compteurIterations % LOG_FREQUENCY === 0) {
        self._eventBus.emit('search:log', {
          message: 'Itération: ' + compteurIterations + ', profondeur: ' + profondeur + ', rapportActuel: ' + rapportActuel.toFixed(3)
        });
      }

      if (profondeur === etageLimite) {
        var ecart = Math.abs((rapportActuel - params.rapportCible) / params.rapportCible) * 100;
        if (ecart <= params.precisionToleree) {
          solutions.push(chaine);
        }
        return;
      }

      var aStart = params.dentMenanteMin;
      var aEnd = params.dentMenanteMax;
      if (profondeur === 0 && params.dentMenanteFixe != null) {
        aStart = params.dentMenanteFixe;
        aEnd = params.dentMenanteFixe;
      }

      for (var A = aStart; A <= aEnd; A++) {
        for (var B = params.dentMeneeMin; B <= params.dentMeneeMax; B++) {
          if (params.allowReductionOnly !== false && B <= A) continue;
          if (params.allowReductionOnly === false && B === A) continue;
          if (profondeur === etageLimite - 1 && params.dentMeneeFixe != null) {
            B = params.dentMeneeFixe;
          }
          var rapport = B / A;
          var nouveauRapport = rapportActuel * rapport;
          if (params.allowReductionOnly !== false && nouveauRapport > params.rapportCible * (1 + params.precisionToleree / 100)) continue;
          rechercher([].concat(chaine, [[A, B]]), profondeur + 1, nouveauRapport, etageLimite);
          if (profondeur === etageLimite - 1 && params.dentMeneeFixe != null) break;
        }
      }
    }

    return new Promise(function (resolve) {
      for (var etageLimite = 1; etageLimite <= params.maxEtages; etageLimite++) {
        solutions = [];
        self._eventBus.emit('search:log', { message: 'Démarrage de la recherche pour ' + etageLimite + ' étage(s)...' });
        rechercher([], 0, 1, etageLimite);
        if (solutions.length > 0) {
          self._eventBus.emit('search:log', { message: 'Solutions trouvées avec ' + etageLimite + ' étage(s).' });
          break;
        }
        self._eventBus.emit('search:log', { message: 'Aucune solution trouvée pour ' + etageLimite + ' étage(s).' });
      }

      solutions.sort(function (a, b) {
        var rA = a.reduce(function (acc, p) { return acc * (p[1] / p[0]); }, 1);
        var rB = b.reduce(function (acc, p) { return acc * (p[1] / p[0]); }, 1);
        return Math.abs(rA - params.rapportCible) - Math.abs(rB - params.rapportCible);
      });
      resolve(solutions.slice(0, params.maxSolutions));
    });
  };

  GearApp.core.Engine = Engine;

})(GearApp);
