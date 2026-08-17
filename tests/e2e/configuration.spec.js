const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { search, openModal, setQuantity, openSetting, openOption } = require('./flow.js');

const watchErrors = watchConsoleErrors;

// ===== §16 : la page n'est plus un formulaire =====

test('the app opens on the modal, not on a configuration panel', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#searchModal')).toBeVisible();
  await expect(page.locator('#step-besoin')).toHaveCount(0);
  await expect(page.locator('#requirementBannerText')).toHaveText('Aucune recherche définie.');
  // §17 : plus de barre latérale de configuration, ni de tiroir mobile.
  await expect(page.locator('#sidebar')).toHaveCount(0);
  await expect(page.locator('#mobileMenuBtn')).toHaveCount(0);
  // Trois points de départ, pas six : le reste se déduit de la saisie.
  await expect(page.locator('#intentCards .type-entry')).toHaveCount(3);
  // §7, §8 : technologie et disposition ne prennent plus qu'une ligne chacune
  // tant qu'on ne les touche pas. Le premier écran ne montre donc ni les
  // quatre politiques ni les six dispositions.
  await expect(page.locator('#technologyPolicy .policy-option')).toHaveCount(0);
  await expect(page.locator('.disposition-card')).toHaveCount(0);
  await expect(page.locator('.setting-row')).toHaveCount(2);
  // §12 : la ligne repliée porte désormais le résultat du conseiller.
  await expect(page.locator('[data-setting="technology"] .setting-value')).toContainText('familles');
  await expect(page.locator('[data-setting="technology"] .setting-value')).toContainText('en tête :');
  // Et elles restent atteignables en un clic.
  await page.locator('.setting-toggle[data-setting="technology"]').click();
  await expect(page.locator('#technologyPolicy .policy-option')).toHaveCount(4);
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
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy="auto"]').click();
  await openSetting(page, 'disposition');
  await expect(page.locator('.disposition-card')).toHaveCount(6);
  await expect(page.locator('.disposition-card[data-disposition="angle"]')).toBeVisible();

  await setQuantity(page, 'ratio', 20);
  await openSetting(page, 'disposition');
  await page.locator('.disposition-card[data-disposition="coaxial"]').click();
  await openSetting(page, 'technology');
  // Le conseil est un résumé de quelques lignes, pas le panneau complet.
  await expect(page.locator('#typeAdvice .advice-row').first()).toContainText('Train épicycloïdal');
  expect(await page.locator('#typeAdvice .advice-row').count()).toBeLessThanOrEqual(7);
});

test('a required 90° turn changes the advice, and a back-drivable one rules out the worm', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 40);
  await openSetting(page, 'disposition');
  await page.locator('.disposition-card[data-disposition="angle"]').click();
  await openSetting(page, 'technology');
  await expect(page.locator('#typeAdvice')).toContainText('Engrenage conique');

  await openSetting(page, 'disposition');
  await page.locator('[data-architecture="selfLocking"]').selectOption('forbidden');
  await openSetting(page, 'technology');
  const worm = page.locator('#typeAdvice .advice-row[data-family="worm"]');
  if (await worm.count()) await expect(worm).toHaveClass(/advice-excluded/);
});

// ===== §4, §19 : imposer ou préférer =====

test('a family can be preferred without closing the door on better ones', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"restrict\"]').click();
  await page.locator('.family-card[data-family="planetary"]').click();
  await expect(page.locator('#technologyPolicy [data-policy="restrict"]')).toHaveClass(/active/);

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
  // Imposé : le moteur n'explore que cette famille.
  expect(await page.locator('.type-checkbox:checked').count()).toBe(1);
  await expect(page.locator('#type-epicyclic')).toBeChecked();
  const imposed = await page.locator('.solution-architecture').allTextContents();
  expect(imposed.every(text => /Épicycloïdal/.test(text))).toBe(true);

  await page.locator('#editSearchBtn').click();
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy="prefer"]').click();
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
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"template\"]').click();
  await expect(page.locator('.architecture-stage')).toHaveCount(2);

  await page.locator('.architecture-stage[data-stage="0"] .stage-choice[data-family="bevel"]').click();
  await page.locator('.architecture-stage[data-stage="1"] .stage-choice[data-family="helical"]').click();
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
  await expect(page.locator('.analysis-level[data-level="forces"]')).toContainText('couple ou puissance d’entrée manquant');

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
  await expect(page.locator('#secondaryPriorityToggle')).toBeVisible();
  await page.locator('#secondaryPriorityToggle').click();
  await expect(page.locator('#prioritySecondary')).toBeVisible();
  // Et le bouton reste là pour refermer : il se cachait après usage, ce qui
  // rendait une secondaire ouverte par erreur impossible à retirer.
  await expect(page.locator('#secondaryPriorityToggle')).toBeVisible();
  await expect(page.locator('#secondaryPriorityToggle')).toContainText('Retirer');
  await page.locator('.priority-chip-primary[data-axis="compact"]').click();
  await page.locator('.priority-chip-secondary[data-axis="quiet"]').click();
  // Le résumé est désormais structuré : l'ordre se lit, il n'est plus une phrase.
  const optimisation = page.locator('.search-summary-section[data-section="Optimisation"]');
  await expect(optimisation).toContainText('1. Compact');
  await expect(optimisation).toContainText('2. Silencieux');
});

test('the manufacturing process feeds the advice', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 5);
  await openOption(page, 'fabrication');
  await page.locator('.fabrication-option[data-process="printing3d"]').click();
  await openSetting(page, 'technology');
  await expect(page.locator('#typeAdvice')).toContainText('impression 3D');
});

// ===== §13 : les réglages techniques restent atteignables =====

test('the old form is gone from view, and nothing it carried is lost (§20)', async ({ page }) => {
  await page.goto('/');
  await openOption(page, 'technical');
  // Les panneaux numérotés ne remontent plus dans le modal : ils y posaient
  // une deuxième fois les questions que le modal pose déjà.
  await expect(page.locator('#searchModal #panel-avance-racine')).toHaveCount(0);
  await expect(page.locator('#searchModal #technologyPanel')).toHaveCount(0);
  await expect(page.locator('#legacyHost #panel-avance-racine')).toHaveCount(1);
  await expect(page.locator('#panel-avance-racine')).toBeHidden();

  // Ce qu'ils portaient seuls a maintenant un éditeur propre, sur le modèle.
  await expect(page.locator('#tech_materials_input')).toBeVisible();
  await expect(page.locator('#tech_shaft_supportDistanceMm')).toBeVisible();
  await expect(page.locator('#tech_module_mode')).toBeVisible();
  await page.locator('#tech_materials_input').selectOption('bronze');
  await page.locator('#tech_shaft_supportDistanceMm').fill('80');
  await page.locator('#tech_shaft_supportDistanceMm').blur();
  // §18 : le brouillon ne touche pas encore aux miroirs — c'est la recherche
  // ADOPTÉE qui les écrit, sinon une édition abandonnée les laisserait faux.
  expect(await page.inputValue('#input_material')).toBe('C45');
  await setQuantity(page, 'ratio', 12);
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
  // Une fois adoptée, l'URL partagée et la comparaison portent bien le choix.
  expect(await page.inputValue('#input_material')).toBe('bronze');
  expect(await page.inputValue('#support_distance')).toBe('80');

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
  // §27 : sur téléphone les trois volets ne s'empilent plus, ils se
  // choisissent. On arrive sur les solutions — la sélection automatique du
  // premier résultat ne demande pas à voir le viewer.
  await expect(page.locator('#mobilePanes')).toBeVisible();
  await expect(page.locator('.design-workspace')).toHaveAttribute('data-mobile-pane', 'results');
  await expect(page.locator('.solution-card').first()).toBeVisible();
  await expect(page.locator('#svgContainer .train-svg')).toBeHidden();

  // Choisir une solution, c'est demander à la voir.
  await page.locator('.solution-card').first().click();
  await expect(page.locator('.design-workspace')).toHaveAttribute('data-mobile-pane', 'viewer');
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  await page.locator('#mobilePanes [data-pane="detail"]').click();
  await expect(page.locator('.detail-pane')).toBeVisible();
  await page.locator('#mobilePanes [data-pane="results"]').click();
  await expect(page.locator('.solution-card').first()).toBeVisible();

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

// ===== §20 : puissance moteur =====

test('a nameplate power gives the torque, and unlocks the mechanical analysis', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'input.speed', 1500);
  await expect(page.locator('.analysis-level[data-level="forces"]')).toContainText('manquant');

  await setQuantity(page, 'input.power', 750);
  // §6 : le couple déduit s'annonce là où la puissance se saisit — c'est de
  // cette saisie qu'il découle, pas d'une ligne de dérivations à part.
  await expect(page.locator('#motorDerivedTorque')).toContainText('couple calculé');
  await expect(page.locator('#motorDerivedTorque')).toContainText('4.77');
  await expect(page.locator('.analysis-level[data-level="forces"]')).toHaveClass(/analysis-ok/);
});

// ===== §9 : critères recommandés =====

test('the criteria menu suggests what matters here, catalogue one click away', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 40);
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"restrict\"]').click();
  await page.locator('.family-card[data-family="belt"]').click();

  await page.locator('[data-step="criteria"]').click();
  await page.locator('#addConstraintBtn').click();
  // Une courroie appelle d'abord un entraxe : c'est le premier proposé.
  await expect(page.locator('#constraintSuggestions button').first()).toContainText('Entraxe');
  // Le catalogue complet reste replié tant qu'on ne le demande pas.
  expect(await page.locator('#constraintMenu .constraint-menu-group:not(.constraint-menu-suggested)').count()).toBe(0);
  await page.locator('#showAllConstraints').click();
  expect(await page.locator('#constraintMenu .constraint-menu-group:not(.constraint-menu-suggested)').count()).toBeGreaterThan(0);

  // Un critère suggéré s'ajoute comme les autres.
  await page.locator('#addConstraintBtn').click();
  await page.locator('#constraintSuggestions [data-field="centerDistance"]').click();
  await expect(page.locator('.constraint-chip[data-constraint="centerDistance"]')).toBeVisible();
});

// ===== §15 : paramètres propres aux familles explorées =====

test('only the explored families expose their own parameters', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"restrict\"]').click();
  await page.locator('.family-card[data-family="worm"]').click();

  await openOption(page, 'technical');
  await expect(page.locator('.type-parameters[data-family="worm"]')).toHaveCount(1);
  await expect(page.locator('.type-parameters[data-family="helical"]')).toHaveCount(0);
  await page.locator('.type-parameters[data-family="worm"] summary').click();
  await expect(page.locator('#tpm_worm_leadAngle')).toBeVisible();

  // Changer de famille change les paramètres offerts, sans réglage à retrouver.
  await openSetting(page, 'technology');
  await page.locator('.family-card[data-family="worm"]').click();
  await page.locator('.family-card[data-family="helical"]').click();
  await page.locator('[data-step="criteria"]').click();
  await expect(page.locator('.type-parameters[data-family="helical"]')).toHaveCount(1);
  await expect(page.locator('.type-parameters[data-family="worm"]')).toHaveCount(0);
});

test('a planetary chooses its topology automatically, or exactly as told', async ({ page }) => {
  await page.goto('/');
  // Couronne menante, solaire bloqué : le rapport vaut (Zs+Zr)/Zr, donc entre
  // 1 et 2. Viser 12:1 ici, c'est demander ce que cette topologie ne peut pas.
  await setQuantity(page, 'ratio', 1.5);
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy="restrict"]').click();
  await page.locator('.family-card[data-family="planetary"]').click();
  await openOption(page, 'technical');
  const block = page.locator('.type-parameters[data-family="planetary"]');
  await block.locator('summary').click();

  // Par défaut la recherche essaie les six topologies : imposer un organe
  // d'entrée n'aurait alors aucun sens, et le champ ne s'affiche pas.
  await expect(block.locator('#tpm_planetary_topologyMode')).toHaveValue('auto');
  await expect(block.locator('#tpm_planetary_inputMember')).toBeHidden();
  await block.locator('#tpm_planetary_topologyMode').selectOption('fixed');
  await expect(block.locator('#tpm_planetary_inputMember')).toBeVisible();
  // Le code nu « S » ne dit rien : l'organe est nommé.
  await expect(block.locator('#tpm_planetary_inputMember option[value="S"]')).toHaveText(/Solaire/);

  // Trois organes, trois rôles : prendre la couronne en entrée alors qu'elle
  // était fixe échange les deux au lieu de laisser un rôle orphelin.
  await block.locator('#tpm_planetary_inputMember').selectOption('R');
  await expect(block.locator('#tpm_planetary_fixed')).toHaveValue('S');
  await expect(block.locator('#tpm_planetary_outputMember')).toHaveValue('C');

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
  expect(await page.inputValue('#tp_planetary_inputMember')).toBe('R');
  expect(await page.inputValue('#tp_planetary_fixed')).toBe('S');

  // §21 : l'analyse doit permettre de VÉRIFIER le train, pas seulement de le
  // nommer — organe bloqué, rapport de base, conditions de montage.
  const analysis = page.locator('#mechanicalPanel');
  await expect(analysis).toContainText('Trains épicycloïdaux');
  await analysis.getByRole('tab', { name: 'Trains épicycloïdaux' }).click();
  await expect(analysis).toContainText('Rapport de base');
  await expect(analysis).toContainText('Équirépartition');
  // Et la table des étages nomme la famille en français, plus « planetary ».
  await analysis.getByRole('tab', { name: 'Étages' }).click();
  await expect(analysis.locator('.stages-table').first()).toContainText('Épicycloïdal');
});

test('a parameter set in the modal drives the search and the historic mirror', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await openOption(page, 'technical');
  const spur = page.locator('.type-parameters[data-family="spur"]');
  await spur.locator('summary').click();
  await spur.locator('#tpm_spur_faceWidth').fill('18');
  await spur.locator('#tpm_spur_faceWidth').blur();

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
  expect(await page.inputValue('#tp_spur_faceWidth')).toBe('18');
});

// ===== §20 : sens de rotation, service, distance entre arbres =====

test('a demanded output direction really filters the pool', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await setQuantity(page, 'input.speed', 1500);
  await setQuantity(page, 'ratio', 9);
  // Uniquement des couples droits : chacun inverse le sens de sortie.
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"restrict\"]').click();
  await page.locator('.family-card[data-family="spur"]').click();
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });

  // Deux étages droits rendent le sens identique : la contrainte les garde.
  await page.locator('#editSearchBtn').click();
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"auto\"]').click();
  await openSetting(page, 'disposition');
  await page.locator('[data-architecture="direction"]').selectOption('same');
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"restrict\"]').click();
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });

  // Exiger l'inverse ne laisse rien, et le diagnostic nomme le vrai coupable
  // au lieu d'accuser une contrainte de dimension.
  await page.locator('#editSearchBtn').click();
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"auto\"]').click();
  await openSetting(page, 'disposition');
  await page.locator('[data-architecture="direction"]').selectOption('reverse');
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy=\"restrict\"]').click();
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('#workspaceEmptyHint')).toContainText('sens de sortie', { timeout: 30000 });
  await expect(page.locator('.solution-card')).toHaveCount(0);
});

test('the service cycle stays folded until it is asked for', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await page.locator('[data-step="criteria"]').click();
  await expect(page.locator('#svc_hoursPerDay')).toHaveCount(0);
  await openOption(page, 'service');
  await expect(page.locator('.analysis-level[data-level="fatigue"]')).toContainText('cycle de service');

  await page.locator('#svc_enabled').check();
  await expect(page.locator('#svc_hoursPerDay')).toBeVisible();
  await expect(page.locator('#svc_years')).toBeVisible();
  await expect(page.locator('#svc_loadType')).toBeVisible();
});

test('a shaft distance to span brings belts and chains forward', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'input.speed', 1500);
  await setQuantity(page, 'ratio', 9);
  await page.locator('[data-step="criteria"]').click();
  // §13 : la distance entre arbres est une donnée d'architecture, elle vit
  // avec la disposition — pas avec la fatigue et les heures par jour.
  await openSetting(page, 'disposition');
  await page.locator('#shaftDistance').fill('300');
  await page.locator('#shaftDistance').blur();
  await openSetting(page, 'technology');
  await expect(page.locator('#typeAdvice .advice-row').first()).toContainText(/Courroie|Chaîne/);
  await expect(page.locator('#typeAdvice')).toContainText('distance entre arbres');
});

// ===== P1 : profondeur, composants, choix multiple par étage, résumé =====

test('a stage accepts several families at once', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 25);
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy="template"]').click();
  const stage = page.locator('.architecture-stage[data-stage="0"]');
  // « Auto » est l'état de départ ; deux familles peuvent coexister sur un cran.
  await expect(stage.locator('.stage-choice[data-family=""]')).toHaveClass(/active/);
  await stage.locator('.stage-choice[data-family="bevel"]').click();
  await stage.locator('.stage-choice[data-family="worm"]').click();
  await expect(stage.locator('.stage-choice.active')).toHaveCount(2);
  await expect(stage.locator('.stage-choice[data-family=""]')).not.toHaveClass(/active/);

  // Les deux partent au moteur.
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 30000 });
  const template = JSON.parse(await page.inputValue('#type_template'));
  expect(template[0].sort()).toEqual(['bevel', 'worm']);
});

test('search depth is named, and the numbers stay underneath', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await page.locator('[data-step="criteria"]').click();
  await openOption(page, 'depth');
  await expect(page.locator('.depth-option')).toHaveCount(4);
  await expect(page.locator('.depth-option.active')).toHaveText('Standard');

  await page.locator('.depth-option[data-depth="exhaustive"]').click();
  await expect(page.locator('.depth-option.active')).toHaveText('Exhaustive');
  // §16 : la profondeur se lit là où on lance la recherche, pas dans une
  // section à elle. La ligne d'option la rappelle, le pied de page aussi.
  await expect(page.locator('.option-row-head[data-option="depth"]')).toContainText('Exhaustive');
  await expect(page.locator('#searchModalContext')).toContainText('Exhaustive');
  // Le nombre suit, mais n'est pas ce qu'on a demandé à l'utilisateur.
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 40000 });
  expect(Number(await page.inputValue('#max_iterations'))).toBeGreaterThan(1000000);
});

test('existing parts are reachable as a starting point', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 12);
  await page.locator('[data-step="criteria"]').click();
  await openOption(page, 'parts');
  await page.locator('#part_module_fixed').fill('1.5');
  await page.locator('#part_module_fixed').blur();
  await page.locator('#part_gearing_drivingFixed').fill('16');
  await page.locator('#part_gearing_drivingFixed').blur();

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 40000 });
  expect(await page.inputValue('#module')).toBe('1.5');
  expect(await page.inputValue('#dent_menante_fixe')).toBe('16');
});

test('the side summary is structured, and repeats no unit', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'input.speed', 1500);
  await setQuantity(page, 'input.power', 750);
  await setQuantity(page, 'output.speed', 100);

  const titles = await page.locator('.search-summary-section h4').allTextContents();
  expect(titles).toContain('Méthode');
  expect(titles).toContain('Entrée');
  // §23 : les niveaux d'analyse ne sont plus répétés en texte pauvre ici — ils
  // vivent une seule fois, en clair, dans le même résumé.
  expect(titles).not.toContain('Analyse');
  await expect(page.locator('#searchModalSummary .analysis-level')).not.toHaveCount(0);
  // Le couple déduit est annoncé comme calculé, une seule fois son unité.
  await expect(page.locator('.search-summary-section[data-section="Entrée"]')).toContainText('calculés');
  const entree = await page.locator('.search-summary-section[data-section="Entrée"]').textContent();
  expect(entree).not.toMatch(/rpm\s*rpm|N·m\s*N·m/);
  // Aucune rubrique vide : « Contraintes » n'apparaît pas tant qu'il n'y en a pas.
  expect(titles).not.toContain('Contraintes');
});

// ===== P2 : pousser une performance, sans rapport cible =====

test('an exploration answers « how much can I get » instead of « find me 12:1 »', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.locator('[data-step="type"]').click();
  // La performance à pousser n'existe pas tant que la méthode ne l'appelle pas.
  await expect(page.locator('#intentObjectives')).toHaveCount(0);
  await page.locator('#intentCards [data-intent="maximize"]').click();
  await expect(page.locator('.intent-objective')).toHaveCount(5);
  await expect(page.locator('.intent-objective.active')).toHaveText('Couple de sortie');
  // L'espace balayé est ANNONCÉ : une plage par défaut muette serait imposée.
  await expect(page.locator('#intentSpanNote')).toContainText('rapports 1 à 200:1');

  // Un moteur, un encombrement, aucun rapport demandé.
  await setQuantity(page, 'input.speed', 1500);
  await setQuantity(page, 'input.power', 750);
  await page.locator('[data-step="criteria"]').click();
  await page.locator('#addConstraintBtn').click();
  await page.locator('#constraintMenu [data-field="maxDiameter"]').click();
  const chip = page.locator('.constraint-chip[data-constraint="maxDiameter"]');
  await chip.locator('[data-slot="a"]').fill('120');
  await chip.locator('[data-slot="a"]').blur();
  await expect(page.locator('.search-summary-section[data-section="Exploration"]')).toContainText('bandes balayées');

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 120000 });
  // Le vivier est classé par la performance poursuivie, pas par « recommandé ».
  expect(await page.inputValue('#refine_sort')).toBe('torque');
  const torques = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.solution-card'))
      .slice(0, 8)
      .map(card => card.textContent.match(/Couple([\d\s.,]+)N·m/))
      .filter(Boolean)
      .map(match => parseFloat(match[1].replace(/\s/g, '').replace(',', '.'))));
  expect(torques.length).toBeGreaterThan(3);
  for (let i = 1; i < torques.length; i++) expect(torques[i]).toBeLessThanOrEqual(torques[i - 1]);
  // Aucun rapport n'a été visé : aucune carte ne peut annoncer en rater un.
  await expect(page.locator('.solution-card').first()).toContainText('Écart de 0 %');
  expect(errors).toEqual([]);
});

test('a real parts inventory is combined, and nothing outside it is proposed', async ({ page }) => {
  await page.goto('/');
  await setQuantity(page, 'ratio', 3);
  await page.locator('[data-step="criteria"]').click();
  await openOption(page, 'parts');

  // « J'ai des roues de 16, 20, 48 et 60 dents, en module 1,5. »
  await page.locator('#inventory_gearing_teethInventory').fill('16, 20, 48, 60');
  await page.locator('#inventory_gearing_teethInventory').blur();
  await page.locator('#inventory_module_list').fill('1.5');
  await page.locator('#inventory_module_list').blur();
  await expect(page.locator('.search-summary-section[data-section="Composants"]'))
    .toContainText('4 dentures en stock');

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 60000 });
  // Le miroir historique porte l'inventaire : URL partagée et comparaison suivent.
  expect(await page.inputValue('#teeth_inventory')).toBe('16, 20, 48, 60');

  const teeth = await page.evaluate(() => {
    const pool = window.GearApp._explorer.getPool();
    return pool.flatMap(s => s.stages).flatMap(stage => [stage.input && stage.input.teeth, stage.output && stage.output.teeth]);
  });
  expect(teeth.length).toBeGreaterThan(0);
  for (const count of teeth) {
    if (count != null) expect([16, 20, 48, 60]).toContain(count);
  }
});

// ===== §G : améliorer un réducteur existant =====

test('an existing reducer becomes the reference, and better is found at its ratio', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.locator('[data-step="type"]').click();
  await page.locator('#intentCards [data-intent="improve"]').click();
  await expect(page.locator('#existingSummary')).toContainText('Décrivez au moins un étage');

  // « J'ai : étage 1 = 20 → 60 module 1, étage 2 = 15 → 45 module 1,5. »
  await page.locator('#addExistingStageBtn').click();
  await page.locator('#existing_0_input_teeth').fill('20');
  await page.locator('#existing_0_input_teeth').blur();
  await page.locator('#existing_0_output_teeth').fill('60');
  await page.locator('#existing_0_output_teeth').blur();
  await page.locator('#addExistingStageBtn').click();
  // §11 : ajouter un étage ouvre celui-là et replie le précédent en résumé.
  await expect(page.locator('.existing-stage-summary[data-stage="0"]')).toContainText('20 → 60');
  await expect(page.locator('#existing_0_input_teeth')).toHaveCount(0);
  await page.locator('#existing_1_input_teeth').fill('15');
  await page.locator('#existing_1_input_teeth').blur();
  await page.locator('#existing_1_output_teeth').fill('45');
  await page.locator('#existing_1_output_teeth').blur();
  await page.locator('#existing_1_module').fill('1.5');
  await page.locator('#existing_1_module').blur();

  // Le réducteur est MESURÉ dès sa description, avant toute recherche.
  await expect(page.locator('#existingSummary')).toContainText('Rapport 9:1');
  await expect(page.locator('#existingSummary')).toContainText('rendement');
  await expect(page.locator('.search-summary-section[data-section="Réducteur actuel"]'))
    .toContainText('2 étages, rapport 9:1');
  await page.locator('#existingGoals [data-goal="compact"]').click();

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 60000 });
  expect(await page.inputValue('#refine_sort')).toBe('compactness');

  const verdict = await page.evaluate(() => {
    const pool = window.GearApp._explorer.getPool();
    const reference = pool.find(s => s.isExisting);
    const volume = s => s.dimensions.x * s.dimensions.y * Math.max(1, s.dimensions.z);
    const others = pool.filter(s => !s.isExisting);
    return {
      hasReference: !!reference,
      referenceRatio: reference && reference.ratio,
      sameRatio: others.every(s => Math.abs(s.ratio - 9) / 9 < 0.03),
      better: others.some(s => volume(s) < volume(reference))
    };
  });
  // La référence est DANS le vivier : sans elle, « plus compact » qu'quoi ?
  expect(verdict.hasReference).toBe(true);
  expect(verdict.referenceRatio).toBeCloseTo(9, 6);
  expect(verdict.sameRatio).toBe(true);
  expect(verdict.better).toBe(true);
  expect(errors).toEqual([]);
});

test('a setting that opened itself can still be closed again (§7)', async ({ page }) => {
  await page.goto('/');
  await openSetting(page, 'technology');
  await page.locator('#technologyPolicy [data-policy="restrict"]').click();
  // Personnalisée, la section s'ouvre d'elle-même à chaque rendu…
  await expect(page.locator('[data-setting-body="technology"]')).toBeVisible();
  // …et doit malgré tout pouvoir être repliée : un bouton « Replier » sans
  // effet serait le même piège que l'ancienne priorité secondaire.
  await page.locator('.setting-toggle[data-setting="technology"]').click();
  await expect(page.locator('[data-setting-body="technology"]')).toHaveCount(0);
  // La ligne continue d'annoncer ce qui a été choisi.
  await expect(page.locator('[data-setting="technology"] .setting-value')).toContainText('imposé');
});
