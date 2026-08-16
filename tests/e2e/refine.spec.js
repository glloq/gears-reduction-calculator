const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
let errors = [];
test.beforeEach(async ({ page }) => {
  errors = watchConsoleErrors(page);
  await page.goto('/');
});
test.afterEach(() => expect(errors, 'browser errors').toEqual([]));

test('refine bar filters the pool client-side without re-searching', async ({ page }) => {
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('#refineBar')).toBeVisible();
  await expect(page.locator('#refineCount')).toContainText('trouvée');

  // Un filtre impossible vide la vue mais garde l'espace de travail visible.
  // Les champs historiques ne sont plus affichés en permanence : on passe par
  // le menu « + Ajouter un filtre », qui les révèle sous forme de chips.
  await page.locator('#addFilterBtn').click();
  await page.locator('#refineMenu [data-field="refine_diameter_max"]').click();
  await page.locator('.constraint-chip[data-constraint="refine_diameter_max"] .constraint-chip-input').fill('1');
  await expect(page.locator('.solution-card')).toHaveCount(0);
  await expect(page.locator('#refineCount')).toContainText('0 affichée');
  await expect(page.locator('#refineBar')).toBeVisible();

  // Réinitialiser restaure la vue, première solution re-sélectionnable.
  await page.locator('#refineResetBtn').click();
  await expect(page.locator('.solution-card')).not.toHaveCount(0);
  await expect(page.locator('.solution-card').first()).toHaveClass(/selected/);
});
