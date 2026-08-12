(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResultsColumnPreferences = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var REQUIRED = ['action'];

  function sanitize(value, available) {
    var known = {};
    available.forEach(function (id) { known[id] = true; });
    var visible = (Array.isArray(value) ? value : available).filter(function (id, index, values) {
      return known[id] && values.indexOf(id) === index;
    });
    REQUIRED.forEach(function (id) { if (known[id] && visible.indexOf(id) < 0) visible.push(id); });
    if (!visible.some(function (id) { return REQUIRED.indexOf(id) < 0; })) {
      return available.slice();
    }
    return visible;
  }

  function load(storage, key, available) {
    try { return sanitize(JSON.parse(storage.getItem(key)), available); }
    catch (error) { return sanitize(null, available); }
  }

  function save(storage, key, visible, available) {
    var sanitized = sanitize(visible, available);
    try { storage.setItem(key, JSON.stringify(sanitized)); } catch (error) { /* Storage can be disabled. */ }
    return sanitized;
  }

  return { sanitize: sanitize, load: load, save: save };
});
