/**
 * namespace.js - Définition du namespace global de l'application
 *
 * Crée la hiérarchie GearApp.{models, core, ui, visualization, config}
 * utilisée par tous les modules pour éviter la pollution du scope global.
 * Ce fichier DOIT être chargé en premier (avant tous les autres scripts).
 *
 * @namespace GearApp
 */
var GearApp = GearApp || {};
GearApp.models = GearApp.models || {};
GearApp.core = GearApp.core || {};
GearApp.ui = GearApp.ui || {};
GearApp.visualization = GearApp.visualization || {};
GearApp.config = GearApp.config || {};
