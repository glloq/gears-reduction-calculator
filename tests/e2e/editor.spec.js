const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { search } = require('./flow.js');
let errors = [];
test.beforeEach(async ({ page }) => {
  errors = watchConsoleErrors(page);
  await page.goto('/');
});
test.afterEach(() => expect(errors, 'browser errors').toEqual([]));

test('stage editor recomputes live and saves a variant into the pool', async ({ page }) => {
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });
  await page.locator('[data-detail="editeur"]').click();
  await expect(page.locator('.editor-stage').first()).toBeVisible();

  // Modifier les dents menées du premier étage → recalcul et deltas visibles.
  await page.locator('.editor-stage').first().locator('input').nth(1).fill('37');
  await expect(page.locator('#editorKpis .editor-kpi').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#editorSaveVariant')).toBeEnabled();

  await page.locator('#editorSaveVariant').click();
  // La variante rejoint le vivier, signalée par son propre badge de carte.
  await expect(page.locator('.solution-card .recommendation-badge.variant').first()).toBeVisible();

  // La variante sélectionnée alimente le schéma héro (toujours visible).
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
});
