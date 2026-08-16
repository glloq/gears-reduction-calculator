const { test, expect } = require('@playwright/test');

test('selection survives all three visualization views', async ({ page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.locator('.train-stage').first()).toBeVisible({ timeout: 20000 });
  await page.locator('.train-stage').first().click();
  await page.getByRole('button', { name: 'Géométrie 2D' }).click();
  await expect(page.locator('.geometry-stage').first()).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Cinématique' }).click();
  await expect(page.locator('.kinematic-stage').first()).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Denture' }).click();
  await expect(page.locator('.train-stage').first()).toHaveClass(/selected/);
  expect(errors).toEqual([]);
});

test('animation speed and direction controls update shared viewer state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.locator('.train-svg')).toBeVisible({ timeout: 20000 });
  await page.locator('#viewerSpeed').selectOption('2');
  await page.locator('#viewerReverse').click();
  await page.getByRole('button', { name: 'Animer' }).click();
  await expect(page.locator('#viewerAnimate')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#viewerReverse')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.train-svg')).toHaveClass(/is-animated/);
});
