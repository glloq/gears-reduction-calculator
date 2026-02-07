/**
 * @file Engine.js - Moteur de recherche de combinaisons d'engrenages
 *
 * Ce module orchestre la recherche de solutions de trains d'engrenages pour
 * atteindre un rapport de réduction cible. Deux stratégies sont disponibles :
 *
 *   1. **Web Worker** (préféré) — Le calcul s'exécute dans un fil d'exécution
 *      séparé (`worker.js`) afin de ne pas bloquer l'interface utilisateur.
 *      Le Worker communique via `postMessage` / `onmessage`.
 *
 *   2. **Fallback synchrone** — Si `window.Worker` n'est pas disponible
 *      (environnement ancien), la recherche est effectuée directement dans
 *      le fil principal avec une version simplifiée de l'algorithme.
 *
 * L'Engine est découplé de l'interface grâce à l'EventBus : il émet des
 * événements ('search:log', 'search:progress', 'search:partial') que
 * l'UIController consomme pour mettre à jour l'affichage.
 *
 * @namespace GearApp.core.Engine
 */

(function (GearApp) {

  // ===== Constructeur =====

  /**
   * Crée une nouvelle instance du moteur de recherche.
   *
   * @constructor
   * @param {GearApp.core.EventBus} [eventBus] - Bus d'événements à utiliser.
   *   Si non fourni, l'instance partagée `GearApp.eventBus` est utilisée.
   */
  function Engine(eventBus) {
    /** @private @type {Worker|null} Référence au Web Worker actif */
    this._worker = null;

    /** @private @type {boolean} Indique si une recherche est en cours */
    this._isRunning = false;

    /** @private @type {GearApp.core.EventBus} Bus d'événements pour la communication */
    this._eventBus = eventBus || GearApp.eventBus;
  }

  // ===== Propriété calculée =====

  /**
   * Indique si une recherche est actuellement en cours d'exécution.
   * Propriété en lecture seule exposée via un getter.
   *
   * @type {boolean}
   * @readonly
   */
  Object.defineProperty(Engine.prototype, 'isRunning', {
    get: function () { return this._isRunning; }
  });

  // ===== Méthode principale de recherche =====

  /**
   * Lance la recherche de combinaisons d'engrenages.
   *
   * Accepte soit un objet `SearchParams` (qui possède une méthode
   * `toWorkerParams()`), soit un objet plat contenant directement les
   * paramètres du Worker. Sélectionne automatiquement la stratégie
   * Worker ou fallback selon la disponibilité de `window.Worker`.
   *
   * @param {GearApp.models.SearchParams|Object} searchParams - Paramètres de recherche.
   *   Propriétés attendues (objet plat) :
   *     - {number} rapportCible      — rapport de réduction souhaité
   *     - {number} precisionToleree  — tolérance en pourcentage
   *     - {number} maxEtages         — nombre maximal d'étages
   *     - {number} maxIterations     — limite d'itérations
   *     - {number} maxSolutions      — nombre maximal de solutions à retourner
   *     - {string[]} typesActifs     — identifiants des types de transmission actifs
   *     - {number} dentMenanteMin/Max — plage de dents menantes
   *     - {number} dentMeneeMin/Max   — plage de dents menées
   *     - {number|null} dentMenanteFixe — dent menante imposée (1er étage)
   *     - {number|null} dentMeneeFixe   — dent menée imposée (dernier étage)
   * @returns {Promise<Array>} Promesse résolue avec un tableau de solutions.
   *   Chaque solution est un tableau d'étages au format [A, B, typeId].
   */
  Engine.prototype.rechercher = function (searchParams) {
    var params;
    // Conversion : si c'est un objet SearchParams, on extrait les paramètres plats
    if (searchParams && typeof searchParams.toWorkerParams === 'function') {
      params = searchParams.toWorkerParams();
    } else {
      params = searchParams;
    }

    // Choix de la stratégie selon la disponibilité du Web Worker
    if (window.Worker) {
      return this._rechercherAvecWorker(params);
    }
    return this._rechercherFallback(params);
  };

  // ===== Recherche via Web Worker =====

  /**
   * Exécute la recherche dans un Web Worker dédié.
   *
   * Le Worker envoie différents types de messages :
   *   - 'progress'        — avancement (itérations, profondeur courante)
   *   - 'solution_found'  — une solution individuelle trouvée
   *   - 'partial_results' — lot de résultats partiels
   *   - 'log'             — message de journal
   *   - 'done'            — recherche terminée avec toutes les solutions
   *
   * @private
   * @param {Object} params - Paramètres de recherche (format plat)
   * @returns {Promise<Array>} Promesse résolue avec les solutions trouvées
   */
  Engine.prototype._rechercherAvecWorker = function (params) {
    var self = this;
    return new Promise(function (resolve, reject) {
      // Terminer le Worker précédent s'il existe encore
      if (self._worker) {
        self._worker.terminate();
      }

      self._worker = new Worker('js/core/worker.js');
      self._isRunning = true;

      self._worker.onmessage = function (e) {
        var data = e.data;
        switch (data.type) {
          case 'progress':
            // Journaliser l'avancement avec les compteurs d'itérations
            self._eventBus.emit('search:log', {
              message: 'Itération: ' + data.iterations + '/' + data.maxIterations +
                ', profondeur: ' + data.profondeur +
                ', rapport: ' + data.rapportActuel.toFixed(3) +
                ', solutions: ' + data.solutionsCount
            });
            // Calcul du pourcentage (plafonné à 95% pour laisser place à la finalisation)
            var percent = Math.min(95, (data.iterations / data.maxIterations) * 100);
            self._eventBus.emit('search:progress', { percent: percent });
            break;
          case 'solution_found':
            // Journaliser chaque solution individuelle avec son écart
            self._eventBus.emit('search:log', {
              message: 'Solution: [' + data.solution.map(function (p) { return '[' + p[0] + ',' + p[1] + ']'; }).join(' ') +
                '] rapport: ' + data.rapport.toFixed(3) + ' (écart: ' + data.ecart.toFixed(2) + '%)'
            });
            break;
          case 'partial_results':
            // Transmettre les résultats partiels pour affichage progressif
            self._eventBus.emit('search:partial', {
              solutions: data.solutions,
              totalSolutions: data.totalSolutions
            });
            break;
          case 'log':
            self._eventBus.emit('search:log', { message: data.message });
            break;
          case 'done':
            // Recherche terminée — journaliser le résumé et résoudre la promesse
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
        // En cas d'erreur du Worker, journaliser et rejeter la promesse
        self._eventBus.emit('search:log', { message: 'Erreur Worker: ' + err.message });
        self._isRunning = false;
        self._worker.terminate();
        self._worker = null;
        reject(err);
      };

      // Envoyer les paramètres au Worker pour démarrer la recherche
      self._worker.postMessage(params);
    });
  };

  // ===== Arrêt de la recherche =====

  /**
   * Interrompt la recherche en cours en terminant le Web Worker.
   *
   * Si aucune recherche n'est en cours (pas de Worker actif),
   * l'appel est ignoré silencieusement. Un message de journal
   * est émis pour informer l'utilisateur de l'interruption.
   */
  Engine.prototype.arreter = function () {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
      this._isRunning = false;
      this._eventBus.emit('search:log', { message: "Recherche interrompue par l'utilisateur." });
    }
  };

  // ===== Configuration du fallback =====

  /**
   * Contraintes par type de transmission pour le mode fallback.
   *
   * Ces données sont dupliquées depuis le Worker car le fallback
   * s'exécute dans le fil principal et n'a pas accès au contexte
   * du Worker. Chaque entrée définit :
   *   - minA/maxA         — plage de dents pour la roue menante
   *   - minB/maxB         — plage de dents pour la roue menée
   *   - maxRatio          — rapport maximal théorique du type
   *   - calcRapport(A,B)  — fonction de calcul du rapport pour ce type
   *   - reductionOnly     — si vrai, B doit être > A (réduction uniquement)
   *   - diffMin           — différence minimale B-A (engrenage interne)
   *   - validCombo(A,B)   — contrainte supplémentaire (épicycloïdal)
   *
   * @private
   * @type {Object.<string, {minA: number, maxA: number, minB: number, maxB: number,
   *   maxRatio: number, calcRapport: function(number, number): number,
   *   reductionOnly: boolean, diffMin?: number,
   *   validCombo?: function(number, number): boolean}>}
   */
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

  // ===== Recherche fallback (sans Worker) =====

  /**
   * Recherche de solutions en mode fallback (fil principal).
   *
   * Algorithme récursif par approfondissement itératif (iterative deepening) :
   * on teste d'abord les solutions à 1 étage, puis 2, etc. jusqu'à
   * `params.maxEtages`. L'algorithme s'arrête dès qu'un niveau produit
   * au moins une solution.
   *
   * Optimisations implémentées :
   *   - Élagage par borne supérieure : abandon si le rapport courant
   *     dépasse déjà la cible avec 50% de marge
   *   - Élagage par borne inférieure : abandon si le rapport courant,
   *     même multiplié par le ratio max pour les étages restants,
   *     ne peut pas atteindre la cible
   *   - Limitation du nombre d'itérations (`params.maxIterations`)
   *
   * @private
   * @param {Object} params - Paramètres de recherche (format plat, voir `rechercher()`)
   * @returns {Promise<Array>} Promesse résolue avec les solutions triées par
   *   proximité au rapport cible, limitées à `params.maxSolutions`
   */
  Engine.prototype._rechercherFallback = function (params) {
    var self = this;
    var solutions = [];
    var compteurIterations = 0;

    /** Fréquence de journalisation (toutes les N itérations) */
    var LOG_FREQUENCY = 10000;

    // Types actifs : par défaut 'spur' si aucun type n'est spécifié
    var activeTypes = (params.typesActifs && params.typesActifs.length > 0) ? params.typesActifs : ['spur'];

    // Pré-calcul du ratio maximal possible par étage parmi tous les types
    // actifs — utilisé pour l'élagage par borne inférieure
    var maxRatioParEtage = 1;
    for (var t = 0; t < activeTypes.length; t++) {
      var tc = FALLBACK_TYPES[activeTypes[t]];
      if (tc && tc.maxRatio > maxRatioParEtage) maxRatioParEtage = tc.maxRatio;
    }

    /**
     * Fonction récursive de recherche par retour sur trace (backtracking).
     *
     * Explore toutes les combinaisons (A, B, type) pour chaque étage
     * et accumule les solutions valides dans le tableau `solutions`.
     *
     * @param {Array<Array>} chaine - Étages déjà sélectionnés [[A, B, typeId], ...]
     * @param {number} profondeur - Étage courant (0-indexé)
     * @param {number} rapportActuel - Rapport cumulé jusqu'ici
     * @param {number} etageLimite - Nombre d'étages cible pour cette passe
     */
    function rechercher(chaine, profondeur, rapportActuel, etageLimite) {
      // Condition d'arrêt : nombre maximal d'itérations atteint
      if (compteurIterations > params.maxIterations) return;

      // Cas de base : on a atteint le nombre d'étages cible
      if (profondeur === etageLimite) {
        // Calculer l'écart relatif par rapport au rapport cible (en %)
        var ecart = Math.abs((rapportActuel - params.rapportCible) / params.rapportCible) * 100;
        if (ecart <= params.precisionToleree) {
          solutions.push({ chaine: chaine, rapport: rapportActuel, ecart: ecart });
        }
        return;
      }

      // Itérer sur chaque type de transmission actif
      for (var ti = 0; ti < activeTypes.length; ti++) {
        var typeId = activeTypes[ti];
        var typeConf = FALLBACK_TYPES[typeId];
        if (!typeConf) continue;

        // Intersectionner les plages du type avec les plages utilisateur
        var aMin = Math.max(typeConf.minA, params.dentMenanteMin);
        var aMax = Math.min(typeConf.maxA, params.dentMenanteMax);
        var bMin = Math.max(typeConf.minB, params.dentMeneeMin);
        var bMax = Math.min(typeConf.maxB, params.dentMeneeMax);

        // Si le premier engrenage est fixé par l'utilisateur, restreindre la plage
        if (profondeur === 0 && params.dentMenanteFixe != null) {
          if (params.dentMenanteFixe >= typeConf.minA && params.dentMenanteFixe <= typeConf.maxA) {
            aMin = params.dentMenanteFixe;
            aMax = params.dentMenanteFixe;
          } else {
            // La valeur fixée est hors plage pour ce type — on le saute
            continue;
          }
        }

        for (var A = aMin; A <= aMax; A++) {
          if (compteurIterations > params.maxIterations) return;

          for (var B = bMin; B <= bMax; B++) {
            if (compteurIterations > params.maxIterations) return;
            compteurIterations++;

            // Journalisation périodique de l'avancement
            if (compteurIterations % LOG_FREQUENCY === 0) {
              self._eventBus.emit('search:log', {
                message: 'Itération: ' + compteurIterations + ', profondeur: ' + profondeur +
                  ', type: ' + typeId + ', rapportActuel: ' + rapportActuel.toFixed(3)
              });
            }

            // --- Contraintes de réduction ---
            // Type réduction uniquement : B doit être strictement supérieur à A
            if (typeConf.reductionOnly && B <= A) continue;
            // Mode réduction forcé par l'utilisateur pour les types bidirectionnels
            if (!typeConf.reductionOnly && params.allowReductionOnly && B <= A) continue;
            // Exclure le rapport 1:1 (A === B) pour les types bidirectionnels
            if (!typeConf.reductionOnly && !params.allowReductionOnly && B === A) continue;

            // --- Contraintes spécifiques au type ---
            // Différence minimale (engrenage interne : la couronne doit être
            // significativement plus grande que le pignon)
            if (typeConf.diffMin && (B - A) < typeConf.diffMin) continue;
            // Validité de combinaison (épicycloïdal : contrainte d'assemblage
            // (A+B) % 3 === 0 et (B-A) pair)
            if (typeConf.validCombo && !typeConf.validCombo(A, B)) continue;

            // Si c'est le dernier étage et que la dent menée est fixée, vérifier
            if (profondeur === etageLimite - 1 && params.dentMeneeFixe != null) {
              if (B !== params.dentMeneeFixe) continue;
            }

            var rapport = typeConf.calcRapport(A, B);
            var nouveauRapport = rapportActuel * rapport;

            // --- Élagage (pruning) ---
            // Borne supérieure : si le rapport courant dépasse déjà 1.5x la
            // cible avec tolérance, inutile de continuer sur cette branche
            if (nouveauRapport > params.rapportCible * (1 + params.precisionToleree / 100) * 1.5) continue;
            // Borne inférieure : même en maximisant les étages restants, le
            // rapport ne pourra jamais atteindre la cible — on élague
            var etagesRestants = etageLimite - profondeur - 1;
            if (etagesRestants > 0) {
              if (nouveauRapport * Math.pow(maxRatioParEtage, etagesRestants) < params.rapportCible * (1 - params.precisionToleree / 100)) continue;
            }

            // Appel récursif avec le nouvel étage ajouté à la chaîne
            rechercher([].concat(chaine, [[A, B, typeId]]), profondeur + 1, nouveauRapport, etageLimite);
          }
        }
      }
    }

    // ===== Lancement de la recherche par approfondissement itératif =====

    return new Promise(function (resolve) {
      // Boucle d'approfondissement : essayer 1 étage, puis 2, etc.
      for (var etageLimite = 1; etageLimite <= params.maxEtages; etageLimite++) {
        solutions = [];
        self._eventBus.emit('search:log', {
          message: 'Recherche pour ' + etageLimite + ' étage(s) avec types: [' + activeTypes.join(', ') + ']...'
        });
        rechercher([], 0, 1, etageLimite);
        // Dès qu'on trouve des solutions à ce niveau, on arrête l'approfondissement
        if (solutions.length > 0) {
          self._eventBus.emit('search:log', {
            message: solutions.length + ' solution(s) trouvée(s) avec ' + etageLimite + ' étage(s).'
          });
          break;
        }
        self._eventBus.emit('search:log', { message: 'Aucune solution pour ' + etageLimite + ' étage(s).' });
      }

      // Tri par proximité au rapport cible (écart minimal en premier)
      solutions.sort(function (a, b) {
        return Math.abs(a.rapport - params.rapportCible) - Math.abs(b.rapport - params.rapportCible);
      });

      // Retourner les meilleures solutions, limitées à maxSolutions,
      // en ne conservant que la chaîne d'étages (sans métadonnées)
      resolve(solutions.slice(0, params.maxSolutions).map(function (s) { return s.chaine; }));
    });
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.core.Engine = Engine;

})(GearApp);
