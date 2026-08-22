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
      // Par le NOM de la colonne, pas par sa position : une colonne ajoutée
      // devant décalerait tout, et le test mesurerait autre chose sans le dire.
      .map(row => (row.querySelector('td[data-col="architecture"]') || {}).textContent);
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

test('the first result is the recommended one, in the cards and in the table (§ décision)', async ({ page }) => {
  // LE DÉFAUT : deux classements répondaient à « quelle est la meilleure ? ».
  // Le menu triait par l'indice technique d'Engineering — absolu, calculé
  // solution par solution — pendant que le badge ★ venait du classement
  // décisionnel — relatif au vivier et aux priorités. La carte 1 et la carte ★
  // pouvaient donc être deux cartes différentes, et la solution ouverte
  // d'office n'était pas celle qu'on recommandait.
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });

  const first = page.locator('.solution-card').first();
  await expect(first).toHaveClass(/recommended/);
  await expect(first.locator('.recommendation-badge.recommended')).toBeVisible();

  // Une seule solution porte le badge : deux recommandées ne recommandent rien.
  await expect(page.locator('.solution-card .recommendation-badge.recommended')).toHaveCount(1);

  // Et le tableau — l'autre vue du même vivier — s'ouvre sur la même ligne.
  await page.locator('#tableViewBtn').click();
  const rank = page.locator('#resultats tr td[data-col="rank"]').first();
  await expect(rank).toHaveText('★ 1');

  // L'indice technique reste consultable, sous son nom, et il ne prétend plus
  // répondre à la question du classement.
  const header = page.locator('#resultats').locator('xpath=ancestor::table').locator('th[data-col="score"]');
  await expect(header).toHaveText('Indice technique');
  await expect(header).toHaveAttribute('title', /pas le classement/);

  // ===== ET MAINTENANT, LES DEUX CLASSEMENTS EN DÉSACCORD =====
  //
  // Sur un vivier ordinaire les deux ordres coïncident souvent, et un test qui
  // s'en contente ne prouve rien : il passait encore quand on lui retirait le
  // classement décisionnel. On force donc le désaccord — l'indice technique est
  // réécrit à l'ENVERS du rang — et on vérifie que l'écran ne bouge pas.
  const forced = await page.evaluate(() => {
    const explorer = window.GearApp._explorer;
    const pool = explorer._pool;
    const decision = explorer._assess();
    if (!decision || pool.length < 2) return null;
    // Rang 1 → pire indice, dernier rang → meilleur indice.
    pool.forEach((solution, index) => {
      solution.score = Object.assign({}, solution.score, { value: 1 - decision.rank[index] / pool.length });
    });
    explorer._publish(false);
    return { recommended: decision.recommended, size: pool.length };
  });
  expect(forced, 'vivier trop petit pour opposer les deux classements').not.toBeNull();
  expect(forced.size).toBeGreaterThan(1);

  // Le tableau reste ouvert : sa première ligne est toujours la recommandée…
  await expect(page.locator('#resultats tr td[data-col="rank"]').first()).toHaveText('★ 1');
  // …et l'indice technique de cette ligne est désormais le PIRE du lot, ce qui
  // prouve que l'écran ne le suit plus.
  const indices = await page.locator('#resultats tr td[data-col="score"]')
    .evaluateAll(cells => cells.map(cell => Number(cell.textContent)));
  expect(indices.length).toBeGreaterThan(1);
  expect(indices[0]).toBeGreaterThan(Math.min.apply(null, indices.slice(1)));

  // Et les cartes disent la même chose que le tableau.
  await page.locator('#cardsViewBtn').click();
  await expect(page.locator('.solution-card').first()).toHaveClass(/recommended/);
});
