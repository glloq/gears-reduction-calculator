const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { search } = require('./flow.js');
let errors = [];
test.beforeEach(async ({ page }) => {
  errors = watchConsoleErrors(page);
  await page.goto('/');
});
test.afterEach(() => expect(errors, 'browser errors').toEqual([]));

test('refine bar filters the pool client-side without re-searching', async ({ page }) => {
  await search(page);
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

test('grouping by architecture replaces sixty near-identical rows by one (§ regrouper)', async ({ page }) => {
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });
  // Le tableau est la vue d'expert : elle se demande. Les cartes sont la vue
  // par défaut, et c'est bien ainsi.
  await page.locator('#tableViewBtn').click();
  const rows = page.locator('#resultats tr');
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);
  const architectures = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('#resultats tr'))
      .map(row => (row.querySelector('td:nth-child(2)') || {}).textContent);
    return new Set(cells.filter(Boolean)).size;
  });

  // Une ligne par ARCHITECTURE : ce qui distingue vraiment deux résultats,
  // ce n'est pas Z20/60 contre Z18/54.
  const toggle = page.locator('#resultsGroup');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const heads = page.locator('#resultats tr.group-head');
  const grouped = await heads.count();
  expect(grouped, 'le regroupement n’a rien réduit').toBeLessThanOrEqual(before);
  expect(grouped).toBe(Math.min(architectures, 25));
  // Le compteur dit les deux : combien d'architectures, et combien de solutions.
  await expect(page.locator('.pagination-status')).toContainText('architecture');
  await expect(page.locator('.pagination-status')).toContainText('solutions');

  // Déplier une famille montre ses variantes, en retrait.
  const expandable = page.locator('#resultats .group-toggle').first();
  if (await expandable.count()) {
    await expect(page.locator('#resultats tr.group-variant')).toHaveCount(0);
    await expandable.click();
    await expect(page.locator('#resultats tr.group-variant').first()).toBeVisible();
    // Et la ligne de tête reste celle de la famille : on n'a pas remplacé le
    // groupe par ses membres, on l'a ouvert.
    await expect(heads).toHaveCount(grouped);
  }

  // Choisir une ligne groupée ouvre bien CETTE solution : le contrat de
  // sélection transporte la position d'origine, qu'un groupe ne renumérote pas.
  await heads.first().click();
  await expect(page.locator('#svgContainer svg')).toBeVisible();

  // Et l'on revient à la liste complète.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#resultats tr.group-head')).toHaveCount(0);
  expect(await rows.count()).toBe(before);
});
