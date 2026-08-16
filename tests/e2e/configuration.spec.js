const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { search, openModal, setQuantity } = require('./flow.js');

const watchErrors = watchConsoleErrors;

// ===== §16 : la page n'est plus un formulaire =====

test('the app opens on the modal, not on a configuration panel', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#searchModal')).toBeVisible();
  await expect(page.locator('#step-besoin')).toHaveCount(0);
  await expect(page.locator('#requirementBannerText')).toHaveText('Aucune recherche définie.');
  // Première question : comment choisir, pas laquelle des neuf familles.
  await expect(page.locator('.type-entry')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('three steps lead to results, and the banner then carries the brief', async ({ page }) => {
  await page.goto('/');
  await search(page);
  await expect(page.locator('#searchModal')).toBeHidden();
  await expect(page.locator('#requirementBannerText')).toContainText('12');
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
});

// ===== §18 : brouillon =====

test('an abandoned edit leaves the displayed search untouched', async ({ page }) => {
  await page.goto('/');
  await search(page);
  const before = await page.locator('#requirementBannerText').textContent();
  const cards = await page.locator('.solution-card').count();

  await page.locator('#editSearchBtn').click();
  await setQuantity(page, 'ratio', 60);
  await page.locator('#searchModalClose').click();

  await expect(page.locator('#requirementBannerText')).toHaveText(before);
  expect(await page.locator('.solution-card').count()).toBe(cards);
  // Les miroirs non plus : ils décrivent toujours la recherche affichée.
  expect(await page.inputValue('#rapport')).toBe('12');
});

test('a confirmed edit replaces the search in one go', async ({ page }) => {
  await page.goto('/');
  await search(page);
  await page.locator('#editSearchBtn').click();
  await setQuantity(page, 'ratio', 30);
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('#requirementBannerText')).toContainText('30');
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
});

// ===== §2, §3 : conseillez-moi =====

test('the advised path asks for a geometry, never for a tooth profile', async ({ page }) => {
  await page.goto('/');
  await page.locator('.type-entry[data-policy="auto"]').click();
  await expect(page.locator('.disposition-card')).toHaveCount(6);
  await expect(page.locator('.disposition-card[data-disposition="angle"]')).toBeVisible();

  await setQuantity(page, 'ratio', 20);
  await page.locator('[data-step="type"]').click();
  await page.locator('.disposition-card[data-disposition="coaxial"]').click();
  // Le conseil est un résumé de quelques lignes, pas le panneau complet.
  await expect(page.locator('#typeAdvice .advice-row').first()).toContainText('Train épicycloïdal');
  expect(await page.locator('#typeAdvice .advice-row').count()).toBeLessThanOrEqual(7);
});

test('a required 90° turn changes the advice, and a back-drivable one rules out the worm', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 40);
  await page.locator('[data-step="type"]').click();
  await page.locator('.disposition-card[data-disposition="angle"]').click();
  await expect(page.locator('#typeAdvice')).toContainText('Engrenage conique');

  await page.locator('[data-architecture="selfLocking"]').selectOption('forbidden');
  const worm = page.locator('#typeAdvice .advice-row[data-family="worm"]');
  if (await worm.count()) await expect(worm).toHaveClass(/advice-excluded/);
});

// ===== §4, §19 : imposer ou préférer =====

test('a family can be preferred without closing the door on better ones', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await page.locator('[data-step="type"]').click();
  await page.locator('.type-entry[data-policy="restrict"]').click();
  await page.locator('.family-card[data-family="planetary"]').click();
  await expect(page.locator('.policy-option[data-policy="restrict"]')).toHaveClass(/active/);

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
  // Imposé : le moteur n'explore que cette famille.
  expect(await page.locator('.type-checkbox:checked').count()).toBe(1);
  await expect(page.locator('#type-epicyclic')).toBeChecked();
  const imposed = await page.locator('.solution-architecture').allTextContents();
  expect(imposed.every(text => /Épicycloïdal/.test(text))).toBe(true);

  await page.locator('#editSearchBtn').click();
  await page.locator('[data-step="type"]').click();
  await page.locator('.policy-option[data-policy="prefer"]').click();
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
  // Préféré : la famille reste en tête, mais l'exploration s'ouvre.
  expect(await page.locator('.type-checkbox:checked').count()).toBeGreaterThan(1);
  await expect(page.locator('#type-epicyclic')).toBeChecked();
});

// ===== §5 : architecture imposée par étage =====

test('an imposed architecture fixes the families stage by stage', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 20);
  await page.locator('[data-step="type"]').click();
  await page.locator('.type-entry[data-policy="template"]').click();
  await expect(page.locator('.architecture-stage')).toHaveCount(2);

  await page.locator('.architecture-stage[data-stage="0"] select').selectOption('bevel');
  await page.locator('.architecture-stage[data-stage="1"] select').selectOption('helical');
  await page.locator('#addStageBtn').click();
  await expect(page.locator('.architecture-stage')).toHaveCount(3);
  await page.locator('.architecture-stage[data-stage="2"] .architecture-stage-remove').click();
  await expect(page.locator('.architecture-stage')).toHaveCount(2);

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.solution-architecture').first()).toContainText('Conique');
});

// ===== §7 : niveau d'analyse disponible =====

test('the modal says what will be computable instead of demanding everything', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await expect(page.locator('.analysis-level[data-level="geometry"]')).toHaveClass(/analysis-ok/);
  await expect(page.locator('.analysis-level[data-level="forces"]')).toContainText('couple d’entrée manquant');

  await setQuantity(page, 'input.torque', 4);
  await expect(page.locator('.analysis-level[data-level="forces"]')).toHaveClass(/analysis-ok/);
});

// ===== §8, §10, §11 : critères, priorités, fabrication =====

test('a chip flips between constraint and preference inside the modal', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await page.locator('[data-step="criteria"]').click();
  await page.locator('#addConstraintBtn').click();
  await page.locator('#constraintMenu [data-field="maxDiameter"]').click();
  const chip = page.locator('.constraint-chip[data-constraint="maxDiameter"]');
  await expect(chip).toHaveAttribute('data-role', 'constraint');
  await chip.locator('.constraint-chip-role').click();
  await expect(chip).toHaveAttribute('data-role', 'preference');
});

test('the secondary priority stays hidden until it is asked for', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-step="criteria"]').click();
  await expect(page.locator('#prioritySecondary')).toBeHidden();
  await page.locator('#secondaryPriorityToggle').click();
  await expect(page.locator('#prioritySecondary')).toBeVisible();
  await page.locator('.priority-chip-primary[data-axis="compact"]').click();
  await page.locator('.priority-chip-secondary[data-axis="quiet"]').click();
  await expect(page.locator('#searchModalSummary')).toContainText('Compact, puis silencieux');
});

test('the manufacturing process feeds the advice', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 5);
  await page.locator('[data-step="criteria"]').click();
  await page.locator('.fabrication-option[data-process="printing3d"]').click();
  await page.locator('[data-step="type"]').click();
  await expect(page.locator('#typeAdvice')).toContainText('impression 3D');
});

// ===== §13 : les réglages techniques restent atteignables =====

test('the technical panels moved into the modal, none of them lost', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-step="criteria"]').click();
  await page.locator('#modalAdvanced > summary').click();
  await expect(page.locator('#modalAdvancedBody #panel-avance-racine')).toHaveCount(1);
  await expect(page.locator('#modalAdvancedBody #technologyPanel')).toHaveCount(1);
  // Chaque identifiant historique existe encore exactement une fois.
  for (const id of ['module', 'max_iterations', 'input_material', 'weight_size']) {
    expect(await page.locator(`#${id}`).count()).toBe(1);
  }
});

// ===== Résultats : inchangés dans leur fond =====

test('result filters never re-run the search', async ({ page }) => {
  await page.goto('/');
  await search(page);
  const searches = await page.evaluate(() => {
    window.__searches = 0;
    window.GearApp.eventBus.on('search:done', () => { window.__searches++; });
    return window.__searches;
  });
  expect(searches).toBe(0);
  await page.locator('#addFilterBtn').click();
  await page.locator('#refineMenu [data-field="refine_efficiency_min"]').click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__searches)).toBe(0);
});

test('one recommendation, alternatives only when the compromise is real', async ({ page }) => {
  await page.goto('/');
  await search(page);
  await expect(page.locator('.recommendation-badge.recommended')).toHaveCount(1);
  const labels = await page.locator('.recommendation-badge').allTextContents();
  expect(new Set(labels).size).toBe(labels.length);
  await expect(page.locator('.solution-card').first().locator('.solution-why')).toContainText('Respecte toutes les contraintes');
});

test('selecting a solution drives the viewer and the analysis, with no new search', async ({ page }) => {
  await page.goto('/');
  await search(page);
  await page.locator('.solution-card').nth(1).click();
  await expect(page.locator('.solution-card').nth(1)).toHaveClass(/selected/);
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  await expect(page.locator('#solutionCard')).toBeVisible();
});

// ===== §14 (passe précédente) : relaxation chiffrée =====

test('no result names the blocker, measures it and unlocks it in one click', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await search(page, { quantities: { ratio: 12 }, constraints: { maxDiameter: 20 } })
    .catch(() => {});                       // aucune solution : c'est le sujet du test
  const accept = page.locator('#acceptRelaxationBtn');
  await accept.waitFor({ timeout: 40000 });
  await expect(page.locator('#workspaceEmptyHint')).toContainText('Blocage principal');
  await expect(page.locator('#workspaceEmptyHint')).toContainText('La meilleure architecture atteint');
  await accept.click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 40000 });
});

// ===== Accessibilité et adaptatif =====

test('keyboard alone reaches the steps and the search', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-step="need"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.search-pane[data-pane="need"]')).toBeVisible();
  await page.locator('#addQuantityBtn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#quantityMenu')).toBeVisible();
  // Échap referme le modal sans rien valider.
  await page.keyboard.press('Escape');
  await expect(page.locator('#searchModal')).toBeHidden();
});

test('the mobile layout turns the modal into a full-screen wizard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto('/');
  const box = await page.locator('.search-modal-panel').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(388);
  await search(page);
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('#tableViewBtn')).toBeDisabled();
});

test('the table view comes back on a wide screen, and remembers the choice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await search(page);
  await page.locator('#tableViewBtn').click();
  await expect(page.locator('#result-container')).toHaveClass(/results-table-mode/);
  await page.setViewportSize({ width: 390, height: 820 });
  await expect(page.locator('#result-container')).not.toHaveClass(/results-table-mode/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#result-container')).toHaveClass(/results-table-mode/);
});
