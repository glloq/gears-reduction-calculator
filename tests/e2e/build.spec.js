const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { openModal, setQuantity, chooseMode, addBuildStage } = require('./flow.js');

// Le mode « Construire » : choisir soi-même les étages, et ne faire chercher
// que ce qu'on n'a pas fixé. La capacité existait — Technologie → Architecture
// — mais on n'y fixait que la FAMILLE de chaque étage, jamais ses dentures.

test('the first screen asks what to do, not what to search for', async ({ page }) => {
  const errors = watchConsoleErrors(page);
  await page.goto('/');
  await expect(page.locator('#searchModal')).toBeVisible();
  await expect(page.locator('#intentCards .type-entry')).toHaveCount(5);
  await expect(page.locator('[data-workspace="build"]')).toContainText('Construire');
  await expect(page.locator('[data-workspace="analyze"]')).toContainText('Étudier');
  // Un mode sans effet n'est pas affiché : « Comparer » est déclaré dans le
  // modèle, il n'a pas de carte tant qu'il ne fait rien.
  await expect(page.locator('[data-workspace="compare"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('choosing Construire replaces the need questions with a chain editor', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'build');
  // La liste est vide au départ : c'est la section qui doit être là, pas une
  // hauteur de liste.
  await expect(page.locator('.build-section')).toBeVisible();
  await expect(page.locator('#buildStages')).toBeAttached();
  await expect(page.locator('#addBuildStageBtn')).toBeVisible();
  // La technologie et la disposition n'ont plus de question à poser : elles
  // s'écrivent étage par étage juste en dessous.
  await expect(page.locator('.setting-toggle[data-setting="technology"]')).toHaveCount(0);
  await expect(page.locator('#buildPlan')).toContainText('Ajoutez un étage');
});

test('the freedom of a stage is read from what it carries (🔒 ◐ ⚙)', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, null);
  const stage = page.locator('.build-stage[data-stage="0"]');
  await expect(stage).toHaveAttribute('data-level', 'auto');

  await page.locator('#buildFamily0').selectOption('spur');
  await expect(stage).toHaveAttribute('data-level', 'auto');
  await page.locator('#buildStage0_input_teeth').fill('20');
  await page.locator('#buildStage0_input_teeth').dispatchEvent('change');
  await expect(stage).toHaveAttribute('data-level', 'partial');
  await page.locator('#buildStage0_output_teeth').fill('60');
  await page.locator('#buildStage0_output_teeth').dispatchEvent('change');
  await expect(stage).toHaveAttribute('data-level', 'fixed');
  await expect(stage.locator('.build-level')).toContainText('Imposé');

  // Vider un champ REDONNE la liberté : sans cela, une denture saisie par
  // erreur ne pourrait plus jamais être rendue au solveur.
  await page.locator('#buildStage0_output_teeth').fill('');
  await page.locator('#buildStage0_output_teeth').dispatchEvent('change');
  await expect(stage).toHaveAttribute('data-level', 'partial');
});

test('a fully described chain is computed, without any search', async ({ page }) => {
  const errors = watchConsoleErrors(page);
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await addBuildStage(page, 'planetary', { sunTeeth: 20, ringTeeth: 70 });
  await page.locator('#buildModule').fill('1.5');
  await page.locator('#buildModule').dispatchEvent('change');

  // Le bouton dit ce qu'il va faire : « Rechercher les solutions » serait faux,
  // rien ne sera cherché.
  await expect(page.locator('#buildPlan')).toContainText('sans recherche');
  await expect(page.locator('#searchModalSubmit')).toContainText('Analyser cette transmission');

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('.solution-architecture').first()).toContainText('Droit → Épicycloïdal');
  // Le résultat est une vraie solution : viewer, analyse mécanique, inspecteur.
  await expect(page.locator('#svgContainer svg')).toBeVisible();
  await expect(page.locator('#mechanicalPanel')).toContainText('13.5');
  expect(errors).toEqual([]);
});

test('a chain that cannot exist is named, not silently dropped', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'build');
  // (79 − 20) / 2 = 29,5 : le satellite devrait avoir une demi-dent.
  await addBuildStage(page, 'planetary', { sunTeeth: 20, ringTeeth: 79 });
  await expect(page.locator('#buildErrors')).toBeVisible();
  await expect(page.locator('#buildErrors')).toContainText('Étage 1');
  await expect(page.locator('#searchModalSubmit')).toBeDisabled();
});

test('the solver completes only the stages left open', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });   // 3:1 imposé
  await addBuildStage(page, 'spur');                                              // à trouver
  await expect(page.locator('#buildPlan')).toContainText('à compléter');
  await expect(page.locator('#searchModalSubmit')).toContainText('Compléter (1 étage)');
  // Compléter suppose une cible : sans rapport visé, le solveur n'a rien pour
  // départager les chaînes qu'il pourrait former. Le bouton le dit.
  await expect(page.locator('#searchModalSubmit')).toBeDisabled();
  await expect(page.locator('#searchModalSubmit')).toHaveAttribute('title', /rapport visé/);

  await setQuantity(page, 'ratio', 15);
  await page.locator('[data-step="type"]').click();
  await expect(page.locator('#searchModalSubmit')).toBeEnabled();
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 40000 });

  // L'étage imposé est resté exactement ce qu'il était, et la chaîne garde sa
  // longueur : elle est une décision, pas une inconnue.
  const found = await page.evaluate(() => {
    const stages = window.GearApp._workbench.solutions[0].stages;
    return stages.map(s => ({ type: s.type, input: s.input && s.input.teeth, output: s.output && s.output.teeth }));
  });
  expect(found.length).toBe(2);
  expect(found[0]).toEqual({ type: 'spur', input: 20, output: 60 });
  expect(found[1].type).toBe('spur');
});

test('imposing only the families dimensions the architecture', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await chooseMode(page, 'build');
  // « Je veux absolument deux étages droits, trouve les dentures. »
  await addBuildStage(page, 'spur');
  await addBuildStage(page, 'spur');
  await setQuantity(page, 'ratio', 18);
  await page.locator('[data-step="type"]').click();
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card').first()).toBeVisible({ timeout: 40000 });
  const found = await page.evaluate(() => window.GearApp._workbench.solutions[0].stages.map(s => s.type));
  expect(found).toEqual(['spur', 'spur']);
});

test('Étudier l’existant computes a described mechanism without searching', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'analyze');
  await addBuildStage(page, 'spur', { 'input.teeth': 18, 'output.teeth': 72 });
  await expect(page.locator('#searchModalSubmit')).toContainText('Analyser');
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('#mechanicalPanel')).toContainText('4.0000');
});

test('Étudier tells the truth about what it can and cannot compute (§2, §3)', async ({ page }) => {
  const errors = watchConsoleErrors(page);
  await page.goto('/');
  await chooseMode(page, 'analyze');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });

  // §3 : une chaîne complète fournit son rapport et sa géométrie sans rien
  // demander à personne. Le résumé annonçait « besoin incomplet » à côté d'un
  // bouton « Analyser » parfaitement actif.
  const levels = page.locator('#analysisLevels');
  await expect(levels.locator('[data-level="geometry"]')).toHaveText(/^✓/);
  await expect(levels.locator('[data-level="kinematics"]')).toContainText('vitesse d’entrée non renseignée');
  await expect(levels.locator('[data-level="forces"]')).toContainText('couple ou puissance');

  // §4 : plus de remarque sur des technologies « explorées » — rien ne l'est.
  await expect(page.locator('#searchModalSummary')).not.toContainText('technologie explorée');
  await expect(page.locator('#searchModalSummary')).not.toContainText('technologies explorées');
  // §5 : le résumé parle de la transmission décrite, pas d'une méthode.
  await expect(page.locator('#searchModalSummary')).toContainText('Transmission');
  await expect(page.locator('#searchModalSummary')).toContainText('Rapport calculé');
  await expect(page.locator('#searchModalSummary')).not.toContainText('Méthode');

  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });
  // §2 : ni 1500 rpm ni 10 N·m inventés. Ce qui n'est pas connu reste vide.
  const panel = page.locator('#mechanicalPanel .mechanical-summary');
  await expect(panel).toContainText('3.0000');
  await expect(panel).toContainText('— → —');
  const values = await page.evaluate(() => {
    const s = window.GearApp._workbench.solutions[0];
    return { speed: s.outputSpeedRpm, torque: s.outputTorqueNm, power: s.inputPowerW,
      thermal: s.thermalRisk, bending: s.mechanical[0].bending, status: s.mechanical[0].bendingStatus };
  });
  expect(values).toEqual({ speed: null, torque: null, power: null, thermal: null,
    bending: null, status: 'not-evaluated' });
  expect(errors).toEqual([]);
});

test('stating the regime restores the full analysis', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'analyze');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await setQuantity(page, 'input.speed', 900);
  await setQuantity(page, 'input.torque', 25);
  await page.locator('[data-step="type"]').click();
  await expect(page.locator('#analysisLevels [data-level="kinematics"]')).toHaveText(/^✓/);
  await expect(page.locator('#analysisLevels [data-level="forces"]')).toHaveText(/^✓/);
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('#mechanicalPanel .mechanical-summary')).toContainText('900 → 300.0');
});

test('a built chain is a project, not an empty session (§9, §10)', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });
  // Une transmission construite sans aucune grandeur de besoin finissait sous
  // « Aucune recherche définie », alors qu'elle existait bel et bien.
  const banner = page.locator('#requirementBannerText');
  await expect(banner).not.toContainText('Aucune recherche définie');
  await expect(banner).toContainText('Construire');
  await expect(banner).toContainText('Droit');
  await expect(banner).toContainText('i = 3');
});

test('each mode names its own steps and its own footer (§6, §7)', async ({ page }) => {
  await page.goto('/');
  const steps = () => page.locator('#searchModalSteps .search-step-label').allTextContents();
  const footer = () => page.locator('.search-modal-context').first().textContent();

  await chooseMode(page, 'design');
  expect(await steps()).toEqual(['Méthode', 'Besoin', 'Affiner']);
  expect(await footer()).toContain('technologies');

  // « Recherche » en tête d'un mode qui ne cherche rien fait lire l'écran de
  // travers ; et « 8 technologies » n'a aucun sens sur une chaîne décrite.
  await chooseMode(page, 'build');
  expect(await steps()).toEqual(['Transmission', 'Objectif', 'Options']);
  await chooseMode(page, 'analyze');
  expect(await steps()).toEqual(['Transmission', 'Conditions', 'Analyse']);
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  expect(await footer()).toContain('analyse directe');
  expect(await footer()).not.toContain('technologie');

  // Une exploration balaye un espace : c'est cela que le pied annonce.
  await chooseMode(page, 'explore');
  expect(await steps()).toEqual(['Exploration', 'Limites', 'Affiner']);
  expect(await footer()).toMatch(/rapports \d+→\d+/);
});

test('Construire delegates, Étudier records — the words differ (§11, §12)', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, 'planetary', { sunTeeth: 20 });
  const badge = page.locator('.build-stage[data-stage="0"] .build-level');
  // §12 : combien il manque, pas seulement « il manque ».
  await expect(badge).toContainText('Partiel · 1 valeur à trouver');
  await expect(page.locator('#buildStage0_ringTeeth')).toHaveAttribute('placeholder', 'auto');
  await expect(page.locator('#buildPlan')).toContainText('le solveur ne cherchera qu’eux');

  // §11 : en Étudier, un champ vide est une donnée MANQUANTE, pas une
  // délégation. Lui faire dire « automatique » inviterait à inventer.
  await chooseMode(page, 'analyze');
  await expect(badge).toContainText('Incomplet · 1 valeur manquante');
  await expect(page.locator('#buildStage0_ringTeeth')).toHaveAttribute('placeholder', 'non renseigné');
  await expect(page.locator('#buildStage0_inputMember option').first()).toHaveText('Non renseigné');
  await expect(page.locator('#buildPlan')).toContainText('ne seront pas calculés');
  await expect(page.locator('#buildPlan')).not.toContainText('compléter');
  // Le champ requis encore vide se distingue du facultatif laissé libre.
  await expect(page.locator('#buildStage0_ringTeeth').locator('..')).toHaveClass(/build-field-missing/);
  await expect(page.locator('#buildStage0_planetCount').locator('..')).toHaveClass(/build-field-optional/);
});

test('the viewer says what is on screen, and every stage is addressable (§14, §15)', async ({ page }) => {
  const errors = watchConsoleErrors(page);
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await addBuildStage(page, 'planetary', { sunTeeth: 20, ringTeeth: 70 });
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });

  // §14 : identifier ce qu'on regarde ne doit plus demander un aller-retour du
  // regard entre la carte, le dessin et le panneau mécanique.
  const identity = page.locator('#solutionIdentity');
  await expect(identity).toBeVisible();
  await expect(identity.locator('.identity-architecture')).toHaveText('Droit → Épicycloïdal');
  await expect(identity.locator('.identity-badge')).toHaveText('Analysée');

  // §15 : un étage se vise sans avoir à cliquer une roue — au clavier compris.
  const chips = page.locator('#stageNav .stage-chip');
  await expect(chips).toHaveCount(3);
  await expect(chips.first()).toHaveText('Ensemble');
  await expect(chips.first()).toHaveClass(/active/);

  await page.locator('#stageNav [data-stage-nav="1"]').click();
  await expect(page.locator('#stageNav [data-stage-nav="1"]')).toHaveClass(/active/);
  await expect(page.locator('#stageInspector')).toBeVisible();
  await expect(page.locator('#stageInspector header')).toContainText('Train épicycloïdal');
  await expect(page.locator('.train-stage.selected')).toHaveAttribute('data-stage', '1');

  // Et l'inverse : cliquer une roue allume la puce. Les deux gestes désignent
  // la même chose, par le même chemin.
  await page.locator('.train-stage[data-stage="0"] .train-wheel').first().click();
  await expect(page.locator('#stageNav [data-stage-nav="0"]')).toHaveClass(/active/);

  await page.locator('#stageNav [data-stage-nav="all"]').click();
  await expect(page.locator('#stageInspector')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the kinematic chain shows the path, not just the totals (§17)', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await addBuildStage(page, 'worm', { wormStarts: 2, wheelTeeth: 40 });
  await setQuantity(page, 'input.speed', 1500);
  await page.locator('[data-step="type"]').click();
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });

  const nodes = page.locator('#kinematicChain .chain-node');
  await expect(nodes).toHaveCount(5);           // entrée + 2 étages + arbre + sortie
  await expect(nodes.nth(0)).toContainText('1500 rpm');
  await expect(nodes.nth(1)).toContainText('3.000 : 1');
  await expect(nodes.nth(2)).toContainText('500.0 rpm');
  await expect(nodes.nth(4)).toContainText('25.0 rpm');
  // Un maillon d'étage est cliquable : même geste que la puce.
  await page.locator('#kinematicChain [data-chain-stage="1"]').click();
  await expect(page.locator('#stageNav [data-stage-nav="1"]')).toHaveClass(/active/);

  // §16 : la fiche connaît la famille. Ce qu'on veut savoir d'une vis, c'est si
  // elle tient la charge — et cela dépend de l'angle d'avance, pas de la famille.
  const inspector = page.locator('#stageInspector .inspector-grid');
  await expect(inspector).toContainText('Angle d’avance');
  await expect(inspector).toContainText('Maintien de charge');
  await expect(inspector).toContainText('2 filets');
});

test('without a regime the chain states ratios and invents no rpm (§2, §17)', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'analyze');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });
  const nodes = page.locator('#kinematicChain .chain-node');
  await expect(nodes.nth(0)).toContainText('régime non renseigné');
  // Le rapport, lui, ne dépend d'aucun régime : il reste affiché.
  await expect(nodes.nth(1)).toContainText('3.000 : 1');
  await expect(nodes.nth(2)).toContainText('—');
});

test('a built chain survives a reload', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });

  await page.reload();
  await expect(page.locator('#searchModal')).toBeVisible();
  await expect(page.locator('[data-workspace="build"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#buildStage0_input_teeth')).toHaveValue('20');
  await expect(page.locator('.build-stage[data-stage="0"]')).toHaveAttribute('data-level', 'fixed');
});

test('an abandoned chain edit leaves the displayed one untouched', async ({ page }) => {
  await page.goto('/');
  await chooseMode(page, 'build');
  await addBuildStage(page, 'spur', { 'input.teeth': 20, 'output.teeth': 60 });
  await page.locator('#searchModalSubmit').click();
  await expect(page.locator('.solution-card')).toHaveCount(1, { timeout: 20000 });

  // §18 : le modal édite un BROUILLON. Ajouter un étage puis fermer ne doit
  // rien changer à la transmission affichée.
  await openModal(page);
  await addBuildStage(page, 'spur', { 'input.teeth': 15, 'output.teeth': 45 });
  await page.locator('#searchModalClose').click();
  await expect(page.locator('.solution-card')).toHaveCount(1);
  const stages = await page.evaluate(() => window.GearApp._workbench.session.build.stages.length);
  expect(stages).toBe(1);
});
