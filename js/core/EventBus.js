/**
 * @file EventBus.js - Système de publication/souscription pour découpler les modules
 *
 * Implémente le patron de conception « Observateur » (pub/sub) afin que les
 * composants de l'application puissent communiquer sans dépendre directement
 * les uns des autres. Le moteur de recherche (Engine) émet des événements
 * (progression, résultats, logs) et l'interface utilisateur (UIController)
 * s'y abonne pour mettre à jour l'affichage.
 *
 * Événements principaux utilisés dans l'application :
 *   - 'search:log'      — message de journal pendant la recherche
 *   - 'search:progress'  — pourcentage de progression
 *   - 'search:partial'   — résultats partiels en cours de calcul
 *
 * @namespace GearApp.core.EventBus
 */

(function (GearApp) {

  // ===== Constructeur =====

  /**
   * Crée une nouvelle instance d'EventBus.
   *
   * L'objet interne `_listeners` est un dictionnaire dont les clés sont
   * les noms d'événements et les valeurs sont des tableaux de fonctions
   * de rappel (callbacks).
   *
   * @constructor
   */
  function EventBus() {
    /** @private @type {Object.<string, Function[]>} */
    this._listeners = {};
  }

  // ===== Méthodes publiques =====

  /**
   * Abonne une fonction de rappel à un événement donné.
   *
   * Si l'événement n'a encore aucun abonné, un nouveau tableau est créé.
   * La méthode retourne `this` pour permettre le chaînage d'appels.
   *
   * @param {string} event - Nom de l'événement auquel s'abonner (ex. 'search:log')
   * @param {Function} callback - Fonction de rappel à invoquer lors de l'émission
   * @returns {EventBus} L'instance courante (chaînage)
   */
  EventBus.prototype.on = function (event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return this;
  };

  /**
   * Désabonne une fonction de rappel d'un événement.
   *
   * - Si `callback` n'est pas fourni, tous les abonnés de l'événement
   *   sont supprimés (nettoyage complet).
   * - Si `callback` est fourni, seul cet abonné spécifique est retiré
   *   du tableau via un filtre par référence.
   *
   * @param {string} event - Nom de l'événement
   * @param {Function} [callback] - Fonction de rappel à retirer.
   *   Si omis, tous les abonnés de l'événement sont supprimés.
   * @returns {EventBus} L'instance courante (chaînage)
   */
  EventBus.prototype.off = function (event, callback) {
    if (!this._listeners[event]) return this;
    if (!callback) {
      // Suppression de tous les abonnés pour cet événement
      delete this._listeners[event];
    } else {
      // Filtrage : on ne conserve que les callbacks différents de celui fourni
      this._listeners[event] = this._listeners[event].filter(function (cb) {
        return cb !== callback;
      });
    }
    return this;
  };

  /**
   * Émet un événement en invoquant tous les abonnés enregistrés.
   *
   * Chaque fonction de rappel reçoit l'objet `data` en paramètre.
   * Les abonnés sont appelés dans l'ordre de leur enregistrement
   * (premier inscrit, premier appelé — FIFO).
   *
   * @param {string} event - Nom de l'événement à émettre
   * @param {*} [data] - Données transmises à chaque abonné
   * @returns {EventBus} L'instance courante (chaînage)
   */
  EventBus.prototype.emit = function (event, data) {
    var handlers = this._listeners[event] || [];
    for (var i = 0; i < handlers.length; i++) {
      handlers[i](data);
    }
    return this;
  };

  // ===== Instance partagée et enregistrement =====

  /** Instance singleton partagée par toute l'application */
  GearApp.eventBus = new EventBus();

  /** Référence au constructeur pour permettre la création d'instances dédiées */
  GearApp.core.EventBus = EventBus;

})(GearApp);
