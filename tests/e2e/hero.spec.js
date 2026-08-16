const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { search } = require('./flow.js');
let errors = [];
test.beforeEach(async ({ page }) => {
  errors = watchConsoleErrors(page);
  await page.goto('/');
});
test.afterEach(() => expect(errors, 'browser errors').toEqual([]));

test('clicking a stage in the hero opens the inspector and bridges to the editor', async ({ page }) => {
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();

  // Cibler le moyeu du premier engrenage : les trains composés superposent
  // les centres de groupes, le centre du bbox n'est pas cliquable.
  await page.locator('.train-stage[data-stage="0"] .gear-hub').first().click({ force: true });
  await expect(page.locator('#stageInspector')).toBeVisible();
  await expect(page.locator('#stageInspector')).toContainText('Rapport');
  await expect(page.locator('.train-stage.selected')).toHaveCount(1);

  // La ligne du panneau mécanique est synchronisée (une seule sélection).
  await expect(page.locator('#mechanicalPanel tr.selected')).toHaveCount(1);

  // « Modifier cet étage » ouvre l'onglet Éditeur, ligne focalisée visible.
  await page.locator('#stageInspectorEdit').click();
  await expect(page.locator('[data-detail="editeur"]')).toHaveClass(/active/);
  await expect(page.locator('.editor-stage').first()).toBeVisible();
});
