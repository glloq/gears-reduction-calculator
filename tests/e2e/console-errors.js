// Surveillance des erreurs navigateur, partagée par toutes les suites E2E.
//
// L'application charge deux dépendances CDN (Chart.js, noUiSlider). Dans un
// environnement sans accès sortant, elles échouent et polluent la console de
// « Failed to load resource » qui ne disent rien de l'application — l'ancienne
// version de ces tests échouait uniquement pour cette raison.
//
// Le filtre porte donc sur l'ORIGINE et non sur le message : un asset local
// manquant (CSS, module, worker) reste une vraie erreur, et le seul bruit
// toléré est celui d'une ressource tierce injoignable.

/**
 * @param {import('@playwright/test').Page} page
 * @returns {string[]} tableau vivant, à comparer à [] en fin de test
 */
function watchConsoleErrors(page) {
  const errors = [];
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (isThirdPartyLoadFailure(page, message)) return;
    errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

function isThirdPartyLoadFailure(page, message) {
  if (!/Failed to load resource/.test(message.text())) return false;
  const url = (message.location() && message.location().url) || '';
  if (!url) return false;
  try {
    return new URL(url).origin !== new URL(page.url()).origin;
  } catch (error) {
    return false;
  }
}

module.exports = { watchConsoleErrors };
