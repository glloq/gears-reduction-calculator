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

  Engine.prototype._rechercherFallback = function (params) {
    var result = GearSearchEngine.search(params);
    return Promise.resolve(result.solutions.map(function(s){ return s.stages.map(GearTransmissionRegistry.toLegacy); }));
  };

  GearApp.core.Engine = Engine;

})(GearApp);
