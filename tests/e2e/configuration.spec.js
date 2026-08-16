const { test, expect } = require('@playwright/test');

/** Champs réellement visibles : `checkVisibility` tient compte des <details> fermés. */
async function visibleFields(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#sidebar input, #sidebar select, #sidebar textarea'))
    .filter(el => el.type !== 'hidden' && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    .map(el => el.id));
}

function watchErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

test('a beginner can search without opening a single advanced panel', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  // Le critère d'acceptation §23 : très peu de champs avant toute interaction.
  const fields = await visibleFields(page);
  expect(fields, 'trop de champs visibles au chargement').toEqual(['vitesse_entree', 'couple_entree', 'rapport']);
  await expect(page.locator('#panel-avance-racine')).not.toHaveAttribute('open', /.*/);

  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  expect(errors).toEqual([]);
});

test('adding and removing a constraint drives the historic control', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#constraintChips')).toBeHidden();

  await page.locator('#addConstraintBtn').click();
  await expect(page.locator('#constraintMenu')).toBeVisible();
  await page.locator('#refineMenu, #constraintMenu').first().locator('[data-field="max_diameter"]').click();

  const chip = page.locator('.constraint-chip[data-constraint="max_diameter"]');
  await expect(chip).toBeVisible();
  // Le chip et le contrôle historique portent la même valeur : c'est lui que
  // SearchParams lira.
  expect(await page.inputValue('#max_diameter')).toBe('80');
  await chip.locator('input').fill('55');
  expect(await page.inputValue('#max_diameter')).toBe('55');

  await chip.getByRole('button', { name: /Supprimer la contrainte diamètre maximum/ }).click();
  await expect(chip).toHaveCount(0);
  expect(await page.inputValue('#max_diameter')).toBe('');
});

test('typing in advanced settings creates the matching chip', async ({ page }) => {
  await page.goto('/');
  // Ouvrir l'avancé ET la sous-section : ce sont deux <details> imbriqués.
  await page.evaluate(() => {
    let node = document.getElementById('minimum_efficiency');
    while (node) { if (node.tagName === 'DETAILS') node.open = true; node = node.parentElement; }
  });
  await page.locator('#minimum_efficiency').fill('0.93');
  await page.locator('#minimum_efficiency').dispatchEvent('change');
  await expect(page.locator('.constraint-chip[data-constraint="minimum_efficiency"]')).toBeVisible();
});

test('a shared URL restores its constraints as chips', async ({ page }) => {
  const expert = encodeURIComponent(JSON.stringify({ max_diameter: '80', minimum_efficiency: '0.92' }));
  await page.goto('/?r=12&p=0.1&e=3&s=50&t=spur,helical&amin=10&amax=30&bmin=20&bmax=60&mod=1&expert=' + expert);
  await expect(page.locator('.constraint-chip[data-constraint="max_diameter"]')).toBeVisible();
  await expect(page.locator('.constraint-chip[data-constraint="minimum_efficiency"]')).toBeVisible();
  // « ≤ 3 étages » vient du paramètre e=3 : c'est bien une contrainte, pas le défaut.
  await expect(page.locator('.constraint-chip[data-constraint="etages"]')).toBeVisible();
  // Et la restriction de technologies est résumée sans ouvrir le panneau.
  await expect(page.locator('#technologyAutoBtn')).toHaveText(/\+ 1 autre/);
});

test('a preset restores into the new flow without losing anything', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Robotique' }).click();
  await page.waitForTimeout(200);
  expect(await page.inputValue('#rapport')).toBe('50');
  await expect(page.locator('.constraint-chip[data-constraint="etages"]')).toBeVisible();
  await expect(page.locator('#technologyAutoBtn')).not.toHaveText('Automatique');
});

test('priorities configure the engine, and custom is reachable and reversible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.priority-chip.active')).toHaveText('Recommandé');

  await page.locator('.priority-chip[data-priority="compact"]').click();
  await expect(page.locator('.priority-chip.active')).toHaveText('Compact');
  expect(await page.inputValue('#search_mode')).toBe('compact');
  expect(await page.inputValue('#weight_size')).toBe('10');

  // Toucher un curseur bascule en Personnalisé…
  await page.evaluate(() => {
    const slider = document.getElementById('weight_cost');
    slider.value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.priority-chip.active')).toHaveText('Personnalisé');
  // …et un clic suffit à revenir à un preset.
  await page.locator('.priority-chip[data-priority="recommended"]').click();
  await expect(page.locator('.priority-chip.active')).toHaveText('Recommandé');
});

test('technology is automatic until the user decides otherwise', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#technologyAutoBtn')).toHaveText('Automatique');
  await expect(page.locator('#technologyPanel')).toBeHidden();
  expect(await page.evaluate(() => document.querySelectorAll('.type-checkbox:checked').length)).toBe(8);

  await page.locator('#technologyToggle').click();
  await expect(page.locator('#technologyPanel')).toBeVisible();
  await page.locator('#type-worm').uncheck();
  await expect(page.locator('#technologyAutoBtn')).toHaveText(/\+ \d+ autres/);
  await page.locator('#technologyAutoBtn').click();
  await expect(page.locator('#technologyAutoBtn')).toHaveText('Automatique');
});

test('family parameters stay hidden until their family is involved', async ({ page }) => {
  await page.goto('/');
  await page.locator('#technologyToggle').click();
  // Une seule famille : seuls ses paramètres sont proposés. On décoche par
  // l'interface réelle, pas en forçant le DOM.
  for (const type of ['spur', 'internal', 'bevel', 'epicyclic', 'worm', 'belt', 'chain']) {
    await page.locator('#type-' + type).uncheck();
  }
  await expect(page.locator('#tp_helical_helixAngle')).toHaveCount(1);
  await expect(page.locator('#tp_worm_leadAngle')).toHaveCount(0);
});

test('the speed+torque objective posts its torque constraint', async ({ page }) => {
  await page.goto('/');
  await page.locator('.objective-card[data-objective="needTorque"]').click();
  expect(await page.inputValue('#objective_mode')).toBe('need');
  await expect(page.locator('.constraint-chip[data-constraint="minimum_output_torque"]')).toBeVisible();
  await expect(page.locator('.objective-card[data-objective="needTorque"]')).toHaveAttribute('aria-checked', 'true');

  // Revenir à « Vitesse de sortie » lève la contrainte impliquée.
  await page.locator('.objective-card[data-objective="need"]').click();
  await expect(page.locator('.constraint-chip[data-constraint="minimum_output_torque"]')).toHaveCount(0);
});

test('the linear objective swaps the applicable constraints', async ({ page }) => {
  await page.goto('/');
  await page.locator('.objective-card[data-objective="rotationTranslation"]').click();
  await expect(page.locator('#type-rack')).toBeChecked();
  await page.locator('#addConstraintBtn').click();
  const fields = await page.locator('#constraintMenu [data-field]').evaluateAll(nodes => nodes.map(n => n.dataset.field));
  expect(fields).toContain('linear_force_min');
  expect(fields).not.toContain('rpm_sortie_min');
});

test('result filters never re-run the search', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  const searches = await page.evaluate(() => {
    window.__searches = 0;
    const bus = window.GearApp.eventBus;
    bus.on('search:done', () => { window.__searches++; });
    return window.__searches;
  });
  expect(searches).toBe(0);

  await page.locator('#addFilterBtn').click();
  await page.locator('#refineMenu [data-field="refine_efficiency_min"]').click();
  await expect(page.locator('.constraint-chip[data-constraint="refine_efficiency_min"]')).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__searches)).toBe(0);
});

test('recommendations label the pool and explain themselves', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.recommendation-badge.recommended')).toHaveCount(1);
  await expect(page.locator('.solution-card').first().locator('.solution-why')).not.toBeEmpty();
  // Une carte tient en quelques métriques : SF/SH restent dans l'inspection.
  await expect(page.locator('.solution-card').first()).not.toContainText('SF /');
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

test('keyboard alone reaches the objective, a constraint and the search', async ({ page }) => {
  await page.goto('/');
  await page.locator('.objective-card[data-objective="ratio"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.objective-card[data-objective="need"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.objective-card[data-objective="ratio"]')).toHaveAttribute('aria-checked', 'true');

  await page.locator('#addConstraintBtn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#constraintMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#constraintMenu')).toBeHidden();
});

test('an empty result set names the blockers and offers a way out', async ({ page }) => {
  await page.goto('/');
  // Contrainte volontairement impossible.
  await page.locator('#addConstraintBtn').click();
  await page.locator('#constraintMenu [data-field="max_diameter"]').click();
  await page.locator('.constraint-chip[data-constraint="max_diameter"] input').fill('1');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card')).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('#workspaceEmptyTitle')).toContainText(/Aucune architecture/);
  await expect(page.locator('#workspaceEmptyBlockers')).toContainText('Ø max 1 mm');
  const action = page.locator('#workspaceEmptyActions button').first();
  await expect(action).toContainText('Lever');
  await action.click();
  await expect(page.locator('.constraint-chip[data-constraint="max_diameter"]')).toHaveCount(0);
});

test('the mobile layout keeps the viewer usable and drops the wide table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto('/');
  // Sur mobile la configuration est un tiroir : il faut l'ouvrir pour chercher.
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#sidebar')).toHaveClass(/sidebar-open/);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  // Les résultats restent en cartes : aucun débordement horizontal de la page.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
