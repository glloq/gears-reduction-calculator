const { test, expect } = require('@playwright/test');
let errors = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
});
test.afterEach(() => expect(errors, 'browser errors').toEqual([]));

test('refine bar filters the pool client-side without re-searching', async ({ page }) => {
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.locator('.solution-tile')).not.toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('#refineBar')).toBeVisible();
  await expect(page.locator('#refineCount')).toContainText('trouvée');

  // Un filtre impossible vide la vue mais garde l'espace de travail visible.
  await page.locator('#refine_diameter_max').fill('1');
  await expect(page.locator('.solution-tile')).toHaveCount(0);
  await expect(page.locator('#refineCount')).toContainText('0 affichée');
  await expect(page.locator('#refineBar')).toBeVisible();

  // Réinitialiser restaure la vue, première solution re-sélectionnable.
  await page.locator('#refineResetBtn').click();
  await expect(page.locator('.solution-tile')).not.toHaveCount(0);
  await expect(page.locator('.solution-tile').first()).toHaveClass(/selected/);
});
