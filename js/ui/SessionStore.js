// SessionStore.js - La dernière recherche, rangée pour ce qu'elle est (§2).
//
// Le stockage était encore celui de l'ancien formulaire : une liste plate de
// valeurs de champs, relue directement dans les miroirs au démarrage. Deux
// conséquences, toutes deux mauvaises :
//
//   1. rien ne distinguait « configuration d'une version précédente » de
//      « projet en cours », si bien qu'un vieux `gearCalcParams` suffisait à
//      faire croire à une session active ;
//   2. la source de vérité étant désormais `SearchSession`, sérialiser des
//      champs revenait à sauvegarder le REFLET plutôt que le modèle.
//
// On range donc la session elle-même, sous une version de schéma explicite.
// L'ancien format n'est pas relu ici : il reste lu par `SearchParams.restore`,
// qui le convertit en miroirs, puis `adoptForm` en refait un modèle. C'est le
// chemin de migration, et il disparaîtra avec les miroirs.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else {
    root.GearSessionStore = api;
    if (root.GearApp) { root.GearApp.ui = root.GearApp.ui || {}; root.GearApp.ui.SessionStore = api; }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Version du schéma. À incrémenter dès qu'une forme rangée change de sens. */
  // 4 : la session porte un mode de travail et une chaîne construite. Une
  // session v3 relue telle quelle repartirait sans mode, donc en « Concevoir »
  // silencieusement — mieux vaut la laisser et rouvrir un modal vide.
  var SCHEMA_VERSION = 4;
  var KEY = 'gearLastSearch';
  /** L'ancienne clé, à ne plus qu'effacer. */
  var LEGACY_KEY = 'gearCalcParams';

  function storage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (ignore) { return null; }        // navigation privée, quota, iframe
  }

  /**
   * Range une session. Le nom de la clé dit ce que c'est : la DERNIÈRE
   * recherche, pas le projet actif — la nuance est précisément ce qui manquait.
   */
  function save(session) {
    var store = storage();
    if (!store || !session || typeof session.toJSON !== 'function') return false;
    try {
      store.setItem(KEY, JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        session: session.toJSON()
      }));
      return true;
    } catch (ignore) { return false; }
  }

  /**
   * Relit la dernière recherche, ou null. Une version inconnue est IGNORÉE
   * plutôt que devinée : rien ne garantit qu'un champ de même nom ait gardé le
   * même sens, et repartir d'une recherche vide vaut mieux que d'en afficher
   * une fausse.
   */
  function load() {
    var store = storage();
    if (!store) return null;
    var raw;
    try { raw = store.getItem(KEY); } catch (ignore) { return null; }
    if (!raw) return null;
    var data;
    try { data = JSON.parse(raw); } catch (ignore) { return null; }
    if (!data || data.schemaVersion !== SCHEMA_VERSION || !data.session) return null;
    return { session: data.session, savedAt: data.savedAt || null };
  }

  function clear() {
    var store = storage();
    if (!store) return;
    try { store.removeItem(KEY); } catch (ignore) { /* rien à faire */ }
  }

  /**
   * §29 : le format plat d'avant la refonte, une fois converti, n'a plus de
   * raison d'exister. Le garder « au cas où » revenait à conserver deux
   * mémoires de la même recherche, dont une que plus personne ne relit — et
   * qui, si elle venait à être relue, raconterait un état périmé. On l'efface
   * dès qu'une session est rangée sous son schéma.
   */
  function dropLegacy() {
    var store = storage();
    if (!store) return false;
    try {
      if (store.getItem(LEGACY_KEY) == null) return false;
      store.removeItem(LEGACY_KEY);
      return true;
    } catch (ignore) { return false; }
  }

  return { save: save, load: load, clear: clear, dropLegacy: dropLegacy,
    SCHEMA_VERSION: SCHEMA_VERSION, KEY: KEY, LEGACY_KEY: LEGACY_KEY };
});
