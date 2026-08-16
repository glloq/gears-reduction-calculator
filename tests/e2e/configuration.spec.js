const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');

/** Champs réellement visibles : `checkVisibility` tient compte des <details> fermés. */
async function visibleFields(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#sidebar input, #sidebar select, #sidebar textarea'))
    .filter(el => el.type !== 'hidden' && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    .map(el => el.id || el.className));
}

const watchErrors = watchConsoleErrors;

// ===== La fiche remplace le mode de solveur (2C, 3C) =====

test('a beginner can search without ever choosing a solver mode', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  // Rien qui ressemble à « quel type de recherche voulez-vous » : une fiche.
  await expect(page.locator('#objectiveCards')).toHaveCount(0);
  await expect(page.locator('.quantity-row')).toHaveCount(3);
  await expect(page.locator('#panel-avance-racine')).not.toHaveAttribute('open', /.*/);

  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the problem is deduced from what is filled in, and announced in plain words', async ({ page }) => {
  await page.goto('/');
  // Au départ : un rapport donné directement.
  await expect(page.locator('#requirementDiagnostic')).toContainText('rapport est donné directement');
  expect(await page.inputValue('#objective_mode')).toBe('ratio');

  // Ajouter une vitesse de sortie change le problème sans que rien ne soit annoncé.
  await page.locator('#addQuantityBtn').click();
  await page.locator('#quantityMenu [data-field="output.speed"]').click();
  await expect(page.locator('#requirementDiagnostic')).toContainText('déterminent le rapport');
  expect(await page.inputValue('#objective_mode')).toBe('need');

  // Une course fait basculer vers le linéaire, toujours sans mode à choisir.
  await page.locator('#addQuantityBtn').click();
  await page.locator('#quantityMenu [data-field="output.travelPerRev"]').click();
  expect(await page.inputValue('#objective_mode')).toBe('rotationTranslation');
});

test('a value carries its intent, and a range becomes a range of ratios', async ({ page }) => {
  await page.goto('/');
  await page.locator('#addQuantityBtn').click();
  await page.locator('#quantityMenu [data-field="output.speed"]').click();

  const row = page.locator('.quantity-row[data-path="output.speed"]');
  await row.locator('.quantity-kind').selectOption('range');
  await row.locator('[data-slot="a"]').fill('20');
  await row.locator('[data-slot="b"]').fill('40');
  await row.locator('[data-slot="b"]').blur();

  // 1500 rpm en entrée : la plage de sortie devient une plage de rapports.
  await expect(page.locator('#derivedRatio')).toContainText('37.5');
  await expect(page.locator('#derivedRatio')).toContainText('75');
  // Et les bornes dures partent au moteur, exactement.
  expect(await page.inputValue('#rpm_sortie_min')).toBe('20');
  expect(await page.inputValue('#rpm_sortie_max')).toBe('40');
});

test('a functional shortcut only fills the sheet, it opens no second path', async ({ page }) => {
  await page.goto('/');
  await page.locator('.requirement-shortcut[data-shortcut="torque"]').click();
  await expect(page.locator('.quantity-row[data-path="output.torque"]')).toBeVisible();
  await expect(page.locator('.quantity-row[data-path="output.speed"]')).toBeVisible();
  expect(await page.inputValue('#objective_mode')).toBe('need');
  // Le raccourci « changer d'axe » pose un fait d'architecture, pas une famille.
  await page.locator('.requirement-shortcut[data-shortcut="angle"]').click();
  await expect(page.locator('#architectureOptions [data-architecture="axisAngle"]')).toBeChecked();
});

// ===== Contraintes et préférences (4B) =====

test('a chip can be flipped from constraint to preference, keeping its value', async ({ page }) => {
  await page.goto('/');
  await page.locator('#addConstraintBtn').click();
  await page.locator('#constraintMenu [data-field="maxDiameter"]').click();
  const chip = page.locator('.constraint-chip[data-constraint="maxDiameter"]');
  await expect(chip).toHaveAttribute('data-role', 'constraint');
  await chip.locator('[data-slot="a"]').fill('70');
  await chip.locator('[data-slot="a"]').blur();

  await chip.locator('.constraint-chip-role').click();
  await expect(chip).toHaveAttribute('data-role', 'preference');
  expect(await chip.locator('[data-slot="a"]').inputValue()).toBe('70');
  // Une préférence ne filtre pas : elle ne descend donc pas dans le moteur.
  expect(await page.inputValue('#max_diameter')).toBe('');

  await chip.locator('.constraint-chip-role').click();
  await expect(chip).toHaveAttribute('data-role', 'constraint');
  expect(await page.inputValue('#max_diameter')).toBe('70');
});

test('a shared URL comes back as a modelled requirement, with no migration code', async ({ page }) => {
  // Les clés courtes sont le format de partage historique : il doit survivre.
  await page.goto('/?r=25&e=2&t=spur,helical');
  const ratio = page.locator('.quantity-row[data-path="ratio"] [data-slot="a"]');
  expect(await ratio.inputValue()).toBe('25');
  // « ≤ 2 étages » s'écarte du réglage d'usine : cela devient une chip.
  await expect(page.locator('.constraint-chip[data-constraint="stages"]')).toBeVisible();
  // Une sélection de familles portée par l'URL est un choix, pas un défaut.
  await expect(page.locator('[data-technology-mode="manual"]')).toHaveClass(/active/);
});

// ===== Priorités (9B) =====

test('two priorities replace eight sliders, and drive the engine', async ({ page }) => {
  await page.goto('/');
  await page.locator('#priority_primary').selectOption('compact');
  await page.locator('#priority_secondary').selectOption('quiet');
  expect(await page.inputValue('#search_mode')).toBe('compact');

  const size = Number(await page.inputValue('#weight_size'));
  const noise = Number(await page.inputValue('#weight_noise'));
  const cost = Number(await page.inputValue('#weight_cost'));
  expect(size).toBeGreaterThan(noise);
  expect(noise).toBeGreaterThan(cost);
  // Les curseurs sont un affichage : personne n'a plus à les arbitrer.
  await expect(page.locator('#weight_size')).toBeDisabled();
});

// ===== Conseiller (5C) =====

test('automatic is a ranking with reasons, not every family ticked', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#technologySummary')).toContainText('Conseillé');
  const recommended = await page.locator('.advisor-entry.advisor-recommended').count();
  const total = await page.locator('.advisor-entry').count();
  expect(recommended).toBeGreaterThan(0);
  expect(recommended).toBeLessThan(total);
  await expect(page.locator('.advisor-entry.advisor-recommended').first().locator('.advisor-reason').first()).not.toBeEmpty();
  // La sélection conseillée est bien celle qui part au moteur.
  const checked = await page.locator('.type-checkbox:checked').count();
  expect(checked).toBe(recommended);
});

test('the advisor reacts to the architecture, and says what it rules out', async ({ page }) => {
  await page.goto('/');
  await page.locator('#architecturePanel > summary').click();
  await page.locator('#architectureOptions [data-architecture="selfLocking"]').selectOption('forbidden');
  const worm = page.locator('.advisor-entry[data-family="worm"]');
  await expect(worm).toHaveClass(/advisor-excluded/);
  await expect(worm).toContainText(/rréversible/);

  await page.locator('#architectureOptions [data-architecture="axisAngle"]').check();
  await expect(page.locator('.advisor-entry[data-family="bevel"]')).toContainText('renvoi d’angle');
});

test('choosing the families yourself is a decision, not a default', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-technology-mode="manual"]').click();
  await expect(page.locator('#technologySummary')).toContainText('famille');
  const box = page.locator('.advisor-entry[data-family="spur"] input[type="checkbox"]');
  await expect(box).toBeEnabled();
  await box.uncheck();
  await expect(page.locator('#type-spur')).not.toBeChecked();

  await page.locator('[data-technology-mode="auto"]').click();
  await expect(page.locator('#technologySummary')).toContainText('Conseillé');
});

// ===== Résultats : Pareto interne, catégories lisibles (12C, 13C) =====

test('result filters never re-run the search', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  const searches = await page.evaluate(() => {
    window.__searches = 0;
    window.GearApp.eventBus.on('search:done', () => { window.__searches++; });
    return window.__searches;
  });
  expect(searches).toBe(0);

  await page.locator('#addFilterBtn').click();
  await page.locator('#refineMenu [data-field="refine_efficiency_min"]').click();
  await expect(page.locator('.constraint-chip[data-constraint="refine_efficiency_min"]')).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__searches)).toBe(0);
});

test('one recommendation, alternatives only when the compromise is real', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.recommendation-badge.recommended')).toHaveCount(1);
  await expect(page.locator('.solution-card').first().locator('.solution-why')).not.toBeEmpty();
  // Chaque alternative porte une catégorie distincte : jamais deux fois la même.
  const labels = await page.locator('.recommendation-badge').allTextContents();
  expect(new Set(labels).size).toBe(labels.length);
});

test('a card says whether the solution honours the constraints', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.solution-card').first().locator('.solution-why')).toContainText('Respecte toutes les contraintes');
});

test('selecting a solution drives the viewer and the analysis, with no new search', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').nth(1)).toBeVisible({ timeout: 20000 });
  await page.locator('.solution-card').nth(1).click();
  await expect(page.locator('.solution-card').nth(1)).toHaveClass(/selected/);
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  await expect(page.locator('#solutionCard')).toBeVisible();
});

// ===== Aucun résultat : relaxation chiffrée (14C) =====

test('no result names the blocker, measures it and unlocks it in one click', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.locator('#addConstraintBtn').click();
  await page.locator('#constraintMenu [data-field="maxDiameter"]').click();
  const chip = page.locator('.constraint-chip[data-constraint="maxDiameter"] [data-slot="a"]');
  await chip.fill('20');
  await chip.blur();

  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  const accept = page.locator('#acceptRelaxationBtn');
  await accept.waitFor({ timeout: 40000 });

  // Le diagnostic est chiffré, pas une liste de suspects.
  await expect(page.locator('#workspaceEmptyHint')).toContainText('Blocage principal');
  await expect(page.locator('#workspaceEmptyHint')).toContainText('La meilleure architecture atteint');
  await expect(page.locator('#workspaceEmptyHint')).toContainText(/\d+ solutions? deviennent? disponibles?|devient disponible/);

  await accept.click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 40000 });
  // La contrainte a été assouplie, pas supprimée.
  await expect(page.locator('.constraint-chip[data-constraint="maxDiameter"]')).toBeVisible();
});

// ===== Accessibilité et mode global supprimé (8B) =====

test('the header no longer carries a standard/expert switch', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#proModeBtn')).toHaveCount(0);
  // Le contenu technique reste atteignable, replié dans ses propres panneaux.
  await expect(page.locator('#panel-materiaux')).toHaveCount(1);
  await expect(page.locator('#panel-materiaux')).not.toHaveAttribute('open', /.*/);
});

test('keyboard alone reaches a quantity, a constraint and the search', async ({ page }) => {
  await page.goto('/');
  await page.locator('#addQuantityBtn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#quantityMenu')).toBeVisible();

  await page.locator('#addConstraintBtn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#constraintMenu')).toBeVisible();

  await page.locator('#startStopBtn').focus();
  await expect(page.locator('#startStopBtn')).toBeFocused();
});

test('the visible field count stays small even with the whole model behind it', async ({ page }) => {
  await page.goto('/');
  const fields = await visibleFields(page);
  // Une ligne typée coûte deux contrôles (l'intention et la valeur) : trois
  // lignes, deux listes de priorité et le bloc de lancement. On reste très loin
  // des vingt-huit champs que l'ancien formulaire affichait d'emblée.
  expect(fields.length).toBeLessThanOrEqual(16);
  // Et surtout : aucun champ technique n'est visible sans ouvrir un panneau.
  for (const id of ['module', 'max_iterations', 'input_material', 'weight_size', 'rapport']) {
    expect(fields).not.toContain(id);
  }
});

// ===== Adaptatif =====

test('the mobile layout keeps the viewer usable and drops the wide table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto('/');
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#sidebar')).toHaveClass(/sidebar-open/);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await expect(page.locator('#tableViewBtn')).toBeDisabled();
  await expect(page.locator('#result-container')).not.toHaveClass(/results-table-mode/);
});

test('the table view comes back on a wide screen, and remembers the choice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });

  await page.locator('#tableViewBtn').click();
  await expect(page.locator('#result-container')).toHaveClass(/results-table-mode/);

  await page.setViewportSize({ width: 390, height: 820 });
  await expect(page.locator('#result-container')).not.toHaveClass(/results-table-mode/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#result-container')).toHaveClass(/results-table-mode/);
});
