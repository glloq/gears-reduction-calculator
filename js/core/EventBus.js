// EventBus.js - Système de publication/souscription pour découpler les modules

(function (GearApp) {

  function EventBus() {
    this._listeners = {};
  }

  EventBus.prototype.on = function (event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return this;
  };

  EventBus.prototype.off = function (event, callback) {
    if (!this._listeners[event]) return this;
    if (!callback) {
      delete this._listeners[event];
    } else {
      this._listeners[event] = this._listeners[event].filter(function (cb) {
        return cb !== callback;
      });
    }
    return this;
  };

  EventBus.prototype.emit = function (event, data) {
    var handlers = this._listeners[event] || [];
    for (var i = 0; i < handlers.length; i++) {
      handlers[i](data);
    }
    return this;
  };

  // Instance partagée
  GearApp.eventBus = new EventBus();
  GearApp.core.EventBus = EventBus;

})(GearApp);
