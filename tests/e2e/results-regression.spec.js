const { test, expect } = require('@playwright/test');
const { search } = require('./flow.js');

// ===== RÉFÉRENCES VISUELLES DE L'INTERFACE DE RÉSULTATS =====
//
// La suite prouve des PROPRIÉTÉS : un rang, un badge, un ordre d'alertes, une
// référence de comparaison. C'est ce qu'il faut, et cela n'attrape pas tout.
// Une carte peut porter le bon badge, le bon écart et la bonne alerte, et être
// illisible — deux blocs qui se chevauchent, une couleur qui disparaît, une
// colonne qui déborde.
//
// Ces images disent « c'est CE QUE C'ÉTAIT ». Toute différence est portée à la
// connaissance de quelqu'un, qui décide si elle est un progrès ou une perte.
//
// Pour réenregistrer après un changement voulu :
//     npx playwright test tests/e2e/results-regression.spec.js --update-snapshots
// et REGARDER chaque image. Une référence mise à jour sans être vue ne prouve
// plus rien.
//
// Chart.js vient d'un CDN : les panneaux de graphiques ne sont donc pas
// photographiés ici, ils ne se peindraient pas hors ligne. Leur DONNÉE est
// vérifiée dans `tests/charts-model.test.js`.

/** Le vivier, figé : mêmes solutions, même verdict, même image. */
async function results(page, width) {
  await page.setViewportSize({ width: width || 1280, height: 900 });
  await page.goto('/');
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });
  // Les transitions et l'animation du dessin ne doivent pas décider du pixel.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.waitForTimeout(150);
}

test.use({ reducedMotion: 'reduce' });

// Les cartes sont photographiées UNE PAR UNE. Prendre la liste entière
// donnerait une image dont les trois quarts sont hors écran, donc non peints :
// une référence pleine de blanc, qui changerait au gré du défilement.
test('la carte recommandée, avec ses alertes et ses angles morts', async ({ page }) => {
  await results(page);
  await expect(page.locator('.solution-card.recommended')).toHaveScreenshot('resultats-carte-recommandee.png',
    { maxDiffPixelRatio: 0.01, animations: 'disabled' });
});

test('une alternative, avec ce qu’elle gagne et ce qu’elle coûte', async ({ page }) => {
  await results(page);
  const alternative = page.locator('.solution-card:not(.recommended)').first();
  await alternative.scrollIntoViewIfNeeded();
  await expect(alternative).toHaveScreenshot('resultats-carte-alternative.png',
    { maxDiffPixelRatio: 0.01, animations: 'disabled' });
});

test('le bandeau d’étendue, quand le domaine est tronqué', async ({ page }) => {
  await results(page);
  await expect(page.locator('#resultsScopeBar')).toHaveScreenshot('resultats-etendue.png',
    { maxDiffPixelRatio: 0.01, animations: 'disabled' });
});

// Demander le tableau, c'est demander de la LARGEUR : il prend la ligne
// entière, et le dessin passe dessous. Il vivait auparavant dans la colonne
// étroite des solutions — seize colonnes dans 323 px.
test('le tableau expert, rang et contrôles compris', async ({ page }) => {
  await results(page, 1400);
  await page.locator('#tableViewBtn').click();
  await page.waitForTimeout(150);
  // Le conteneur, pas la table : la table déborde de sa zone défilante, et une
  // capture prise sur elle photographie ce qui se trouve DERRIÈRE — le dessin.
  await expect(page.locator('#resultats').locator('xpath=ancestor::div[contains(@class,"table-scroll")]'))
    .toHaveScreenshot('resultats-tableau.png', { maxDiffPixelRatio: 0.01, animations: 'disabled' });
});

test('le tableau groupé par configuration', async ({ page }) => {
  await results(page, 1400);
  await page.locator('#tableViewBtn').click();
  await page.locator('#resultsGroup').click();
  await page.waitForTimeout(150);
  await expect(page.locator('#resultats').locator('xpath=ancestor::div[contains(@class,"table-scroll")]'))
    .toHaveScreenshot('resultats-tableau-groupe.png', { maxDiffPixelRatio: 0.01, animations: 'disabled' });
});

test('la comparaison de deux solutions épinglées', async ({ page }) => {
  await results(page);
  await page.locator('.solution-card').nth(0).locator('.tile-pin').click();
  await page.locator('.solution-card').nth(1).locator('.tile-pin').click();
  await page.locator('.detail-tabs [data-detail="comparer"]').click();
  await expect(page.locator('.compare-table')).toBeVisible();
  await page.waitForTimeout(150);
  await expect(page.locator('[data-detail-panel="comparer"]')).toHaveScreenshot('resultats-comparaison.png',
    { maxDiffPixelRatio: 0.01, animations: 'disabled' });
});

test('la même carte sur un téléphone de 390 px', async ({ page }) => {
  await results(page, 390);
  const pane = page.locator('#mobilePanes [data-pane="results"]');
  if (await pane.isVisible().catch(() => false)) await pane.click();
  await page.waitForTimeout(150);
  await expect(page.locator('.solution-card.recommended')).toHaveScreenshot('resultats-carte-390.png',
    { maxDiffPixelRatio: 0.01, animations: 'disabled' });
});
