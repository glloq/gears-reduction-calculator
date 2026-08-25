const { test, expect } = require('@playwright/test');
const path = require('path');
const { search, chooseMode, addBuildStage, setQuantity } = require('./flow.js');

// ===== LES CAPTURES DU DÉPÔT =====
//
// Ces images ne prouvent rien : elles MONTRENT. Le README et la documentation
// décrivent une application que personne ne peut voir sans la lancer ; une
// capture par grande partie répond en une seconde à « à quoi ça ressemble ».
//
// Elles ne sont donc pas des références de régression — celles-là vivent dans
// `visual-regression.spec.js` et `results-regression.spec.js`, comparées au
// pixel près. Ici on écrit dans `img/`, et on regarde.
//
//     npm run screenshots
//
// La suite E2E ordinaire ne les régénère pas : sans SHOTS=1 tout est ignoré,
// pour qu'un `npm run test:e2e` ne réécrive pas seize fichiers versionnés.
//
// Chart.js et noUiSlider viennent d'un CDN. Hors ligne, les graphiques ne se
// peindraient pas et les curseurs resteraient des champs nus : les copies
// installées dans `node_modules` sont servies à leur place, de sorte que
// l'image montre l'écran tel qu'il est en ligne.

const IMG = path.join(__dirname, '..', '..', 'img');
// `chart.js` n'expose pas son dossier `dist` dans ses `exports` : le chemin est
// résolu depuis le package lui-même, pas par `require.resolve` du fichier.
const modules = path.join(__dirname, '..', '..', 'node_modules');
const VENDOR = {
  'chart.umd.min.js': path.join(modules, 'chart.js', 'dist', 'chart.umd.js'),
  'nouislider.min.js': path.join(modules, 'nouislider', 'dist', 'nouislider.min.js'),
  'nouislider.min.css': path.join(modules, 'nouislider', 'dist', 'nouislider.min.css')
};

test.skip(!process.env.SHOTS, 'captures de documentation : npm run screenshots');
test.describe.configure({ mode: 'serial' });
test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

/** Sert les dépendances CDN depuis le disque et ouvre la page. */
async function open(page, width) {
  if (width) await page.setViewportSize({ width, height: 900 });
  await page.route('**/cdnjs.cloudflare.com/**', route => serve(route));
  await page.route('**/cdn.jsdelivr.net/**', route => serve(route));
  await page.goto('/');
}

function serve(route) {
  const file = VENDOR[route.request().url().split('/').pop()];
  return file ? route.fulfill({ path: file }) : route.abort();
}

// Le besoin photographié : un rapport de 40 en dentures droites ou hélicoïdales.
// La recherche par défaut (12:1, toutes technologies) revient sur une vis sans
// fin d'un seul étage — vraie solution, mauvaise vitrine : elle ne montre ni
// chaîne à plusieurs étages, ni cascade de vitesses, ni comparaison utile.
const NEED = { quantities: { ratio: 40 }, families: ['spur', 'helical'] };

/** Fige ce qui bouge : une capture ne doit pas attraper une transition. */
async function settle(page) {
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.waitForTimeout(250);
}

async function shot(target, name, options) {
  await target.screenshot(Object.assign({ path: path.join(IMG, name + '.png'), animations: 'disabled' }, options || {}));
}

// ===== 1. DÉFINIR CE QU'ON CHERCHE =====

test('01 le modal de recherche, ses trois étapes', async ({ page }) => {
  await open(page);
  const modal = page.locator('#searchModal');
  await expect(modal).toBeVisible();
  await settle(page);
  await shot(modal, '01-recherche-intention');

  await setQuantity(page, 'ratio', 12);
  await settle(page);
  await shot(modal, '02-recherche-besoin');

  await page.locator('[data-step="criteria"]').click();
  await settle(page);
  await shot(modal, '03-recherche-affiner');
});

test('02 le mode Construire : la chaîne décrite étage par étage', async ({ page }) => {
  await open(page);
  await chooseMode(page, 'build');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await addBuildStage(page, 'spur', { 'input.teeth': 18 });
  await page.locator('#buildPlan').waitFor();
  await settle(page);
  await shot(page.locator('#searchModal'), '04-construire');
});

// ===== 2. CHOISIR PARMI LES SOLUTIONS =====

test('03 l’espace de travail, les cartes, le tableau expert', async ({ page }) => {
  await open(page);
  await search(page, NEED);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 30000 });
  await settle(page);
  await shot(page, '05-espace-de-travail');
  await shot(page.locator('.solution-card.recommended'), '06-carte-recommandee');

  await page.locator('#tableViewBtn').click();
  await settle(page);
  await shot(page.locator('#result-container'), '07-tableau-expert');
});

// ===== 3. REGARDER LE MÉCANISME =====

test('04 les trois vues du visualiseur', async ({ page }) => {
  await open(page);
  await search(page, NEED);
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible({ timeout: 30000 });
  const viewer = page.locator('.hero-viewer');
  const views = [['teeth', '08-vue-transmission'], ['geometry', '09-vue-dimensions'], ['kinematic', '10-vue-cinematique']];
  for (const [view, name] of views) {
    await page.locator(`.view-mode[data-view="${view}"]`).click();
    await settle(page);
    await shot(viewer, name);
  }

  // L'inspecteur : cliquer une roue désigne la roue, pas la solution.
  await page.locator('.view-mode[data-view="teeth"]').click();
  await page.locator('.train-wheel[data-stage="0"] .gear-hub').first().click({ force: true });
  await expect(page.locator('#stageInspector')).toBeVisible();
  await settle(page);
  await shot(page.locator('#stageInspector'), '11-inspecteur-etage');
});

// ===== 4. ANALYSER, MODIFIER, COMPARER =====

// Sous 1400 px l'analyse passe SOUS le dessin, dans la colonne large : le
// tableau de comparaison y tient en entier, là où la troisième colonne d'un
// écran plus large le rognerait à deux colonnes et demie.
test('05 les onglets de détail', async ({ page }) => {
  await open(page, 1280);
  await search(page, NEED);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 30000 });
  await settle(page);
  await shot(page.locator('[data-detail-panel="analyse"]'), '12-analyse-mecanique');

  await page.locator('.detail-tabs [data-detail="editeur"]').click();
  await expect(page.locator('.editor-stage').first()).toBeVisible();
  await settle(page);
  await shot(page.locator('[data-detail-panel="editeur"]'), '13-editeur');

  await page.locator('.solution-card').nth(0).locator('.tile-pin').click();
  await page.locator('.solution-card').nth(1).locator('.tile-pin').click();
  await page.locator('.detail-tabs [data-detail="comparer"]').click();
  await expect(page.locator('.compare-table')).toBeVisible();
  await settle(page);
  await shot(page.locator('[data-detail-panel="comparer"]'), '14-comparaison');

});

// Le nuage de compromis ne montre quelque chose que si le vivier VARIE. Sur un
// rapport de 40 en dentures droites, les cent solutions retenues partagent
// l'encombrement et le rendement : cent points au même endroit. Le besoin par
// défaut — 12:1, toutes technologies — étale le vivier, et c'est ce que le
// graphique est là pour donner à voir.
test('06 les graphiques de compromis', async ({ page }) => {
  await open(page, 1280);
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 30000 });
  await page.locator('.detail-tabs [data-detail="graphiques"]').click();
  await page.waitForTimeout(600);
  await settle(page);
  await shot(page.locator('[data-detail-panel="graphiques"]'), '15-graphiques');
});

// ===== 5. SUR UN TÉLÉPHONE =====

test('07 la même application en 390 px', async ({ page }) => {
  await open(page, 390);
  await search(page, NEED);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 30000 });
  await settle(page);
  await shot(page, '16-mobile-solutions');
  await page.locator('#mobilePanes [data-pane="viewer"]').click();
  await settle(page);
  await shot(page, '17-mobile-vue');
});
