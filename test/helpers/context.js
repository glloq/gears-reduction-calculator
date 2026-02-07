/**
 * @module test/helpers/context
 * @description Harnais de test pour charger les modules IIFE dans un contexte VM.
 *
 * Les modules de l'application utilisent des IIFE qui s'attendent à trouver
 * `GearApp` et `window` dans la portée globale. Ce helper crée un contexte
 * VM isolé avec ces globales et charge les fichiers source en ordre.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

/**
 * Crée un contexte VM avec les globales nécessaires aux modules.
 * @returns {vm.Context} Contexte prêt pour charger les modules
 */
function createContext() {
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });
  // window pointe vers le contexte lui-même (comme dans un navigateur)
  ctx.window = ctx;
  return ctx;
}

/**
 * Charge un fichier JS dans le contexte VM.
 * @param {vm.Context} ctx - Le contexte cible
 * @param {string} relativePath - Chemin relatif depuis la racine du projet
 */
function loadFile(ctx, relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  const code = fs.readFileSync(fullPath, 'utf8');
  vm.runInContext(code, ctx, { filename: fullPath });
}

/**
 * Charge une liste de fichiers dans l'ordre dans le contexte.
 * @param {vm.Context} ctx - Le contexte cible
 * @param {string[]} files - Chemins relatifs depuis la racine du projet
 * @returns {vm.Context} Le contexte mis à jour
 */
function loadModules(ctx, files) {
  for (const file of files) {
    loadFile(ctx, file);
  }
  return ctx;
}

// Ensembles de modules pré-définis (ordre de chargement)
const NAMESPACE = ['js/namespace.js'];
const CONFIG = [...NAMESPACE, 'js/config/Constants.js'];
const REGISTRY = [...CONFIG, 'js/models/TransmissionTypeRegistry.js'];
const CORE = [...REGISTRY, 'js/core/EventBus.js', 'js/core/GearMechanics.js'];

module.exports = { createContext, loadFile, loadModules, ROOT, NAMESPACE, CONFIG, REGISTRY, CORE };
