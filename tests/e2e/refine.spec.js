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
    const assessment = explorer._assess();
    const decision = assessment && assessment.decision;
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

test('a card says what it gains AND what it costs, with its alerts ranked (§9, §13, §20)', async ({ page }) => {
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });

  const seen = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.solution-card'));
    return cards.map(card => ({
      recommended: card.classList.contains('recommended'),
      gains: Array.from(card.querySelectorAll('.trade-gain em')).map(node => node.textContent),
      losses: Array.from(card.querySelectorAll('.trade-loss em')).map(node => node.textContent),
      alerts: Array.from(card.querySelectorAll('.solution-alert')).map(node => ({
        level: (node.className.match(/level-(\w+)/) || [])[1], text: node.textContent.trim() })),
      more: !!card.querySelector('.solution-alert-more'),
      unknown: !!card.querySelector('.solution-uncertainty')
    }));
  });

  // La référence ne se compare pas à elle-même ; les autres, si.
  const reference = seen.filter(card => card.recommended);
  expect(reference.length).toBe(1);
  expect(reference[0].gains.length + reference[0].losses.length).toBe(0);
  const others = seen.filter(card => !card.recommended);
  expect(others.length).toBeGreaterThan(0);
  expect(others.some(card => card.gains.length || card.losses.length),
    'aucune alternative ne dit ce qu’elle gagne ni ce qu’elle perd').toBe(true);
  // Un écart porte un signe et une unité, pas un nombre nu.
  others.forEach(card => card.gains.concat(card.losses).forEach(text => {
    expect(text).toMatch(/^[+−]/);
  }));

  // Les alertes se lisent par gravité : un danger ne peut pas suivre une réserve.
  seen.forEach(card => {
    const levels = card.alerts.map(alert => alert.level);
    const lastDanger = levels.lastIndexOf('danger');
    const firstWarning = levels.indexOf('warning');
    if (lastDanger >= 0 && firstWarning >= 0) expect(lastDanger).toBeLessThan(firstWarning);
    // Jamais plus de trois, et le reste est annoncé plutôt que tu.
    expect(card.alerts.length).toBeLessThanOrEqual(3);
  });

  // Ce qui n'a pas été vérifié se lit : la recherche par défaut ne fournit pas
  // de couple, donc aucun contrôle mécanique n'a eu lieu.
  expect(seen.some(card => card.unknown), 'aucune carte ne signale ses contrôles manquants').toBe(true);
});

test('an alternative keeps its badge all the way to the drawing (§25)', async ({ page }) => {
  // Le badge d'alternative ne s'affichait au-dessus du dessin que pour la
  // recommandée : on cliquait « Meilleur rendement », on arrivait sur le
  // dessin, et plus rien ne disait POURQUOI on regardait celle-là.
  //
  // Une recherche ordinaire ne produit pas toujours d'alternative — un front
  // de Pareto peut n'avoir qu'un point. On pose donc le badge dans le verdict
  // lui-même, puis on redessine : ce qui est vérifié ici, c'est que la bande
  // d'identité LIT le même verdict que la carte, pas que le moteur l'ait
  // produit — cela, les tests unitaires s'en chargent.
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });

  const label = await page.evaluate(() => {
    const explorer = window.GearApp._explorer;
    const workbench = window.GearApp._workbench;
    if (explorer._pool.length < 2) return null;
    const assessment = explorer._assess();
    // La deuxième du vivier devient « Meilleur rendement ».
    const target = assessment.decision.recommended === 1 ? 0 : 1;
    assessment.decision.byIndex[target] = ['efficient'];
    assessment.byIndex[target].badges = ['efficient'];
    workbench.renderSolutions(explorer._pool, explorer._pool.map((_, i) => i),
      { pool: explorer._pool, decision: assessment.decision, assessment: assessment });
    window.__target = target;
    return null;
  });
  void label;

  const alternative = page.locator('.solution-card:not(.recommended)')
    .filter({ has: page.locator('.recommendation-badge') }).first();
  await expect(alternative).toHaveCount(1);
  const text = (await alternative.locator('.recommendation-badge').first().textContent()).trim();
  expect(text).toBe('Meilleur rendement');

  await alternative.click();
  // La bande d'identité, au-dessus du dessin, rappelle ce qu'on était venu voir.
  await expect(page.locator('.identity-badge')).toHaveText(text);
});

test('the list opens on what helps decide, and says how far the ranking reaches (§16, §17)', async ({ page }) => {
  // §16 : toutes les cartes de la vue étaient rendues, et le vivier peut en
  // garder quatre cents. Personne ne compare correctement cent quatre-vingts
  // cartes — et sur téléphone, elles sont la seule représentation.
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });

  const bar = page.locator('#resultsScopeBar');
  await expect(bar).toBeVisible();
  const cards = page.locator('.solution-card');

  const shortlist = await cards.count();
  const total = await page.evaluate(() => window.GearApp._explorer._pool.length);
  expect(total).toBeGreaterThan(12);
  expect(shortlist).toBeLessThan(total);
  expect(shortlist).toBeGreaterThan(0);
  // La recommandée est dans la sélection, et en tête : c'est le point de départ.
  await expect(cards.first()).toHaveClass(/recommended/);

  // Le front de Pareto, puis tout le vivier — les deux à un geste.
  await page.locator('#resultsScope [data-scope="pareto"]').click();
  const pareto = await cards.count();
  expect(pareto).toBeGreaterThan(0);
  await page.locator('#resultsScope [data-scope="all"]').click();
  expect(await cards.count()).toBe(total);

  // §17 : la portée du classement se lit, au lieu de dormir dans une
  // info-bulle. Le moteur a validé bien plus de solutions que le vivier n'en
  // garde ; une recommandation calculée sur les conservées doit le dire.
  const note = page.locator('#resultsScopeNote');
  await expect(note).toContainText('front de Pareto');
  const text = await note.textContent();
  const truncated = await page.evaluate(() => {
    const stats = window.GearApp._explorer._stats;
    return !!(stats && stats.valid > window.GearApp._explorer._pool.length);
  });
  if (truncated) {
    expect(text).toMatch(/tronqué/);
    await expect(note).toHaveClass(/is-truncated/);
  }
});

test('the expert table shows the decision it used to hide (§13, §14)', async ({ page }) => {
  // La vue tableau ne montrait que des données brutes et l'indice du moteur,
  // pendant que les cartes portaient le Pareto, les badges et la conformité :
  // deux vues d'un même vivier qui semblaient donner deux résultats.
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });
  await page.locator('#tableViewBtn').click();

  const headers = await page.locator('#resultats').locator('xpath=ancestor::table').locator('th').allTextContents();
  ['Rang', 'Pareto', 'Contrôles', 'Indice technique', 'Alertes'].forEach(label => {
    expect(headers).toContain(label);
  });

  const first = await page.evaluate(() => {
    const row = document.querySelector('#resultats tr');
    const cell = name => (row.querySelector('td[data-col="' + name + '"]') || {}).textContent;
    return { rank: cell('rank'), pareto: cell('pareto'), checks: cell('checks'), alerts: cell('warnings') };
  });
  // La première ligne est la recommandée : rang 1, et sur le front.
  expect(first.rank).toBe('★ 1');
  expect(first.pareto).toBe('✓');
  // Les contrôles se lisent dans les mêmes marques que partout ailleurs, et
  // « non vérifié » (·) n'y est pas confondu avec « conforme » (✓).
  expect(first.checks).toMatch(/[✓⚠✕·]/);
  // §13 : les alertes disent leur gravité, pas seulement leur nombre.
  expect(first.alerts).toMatch(/^(—|[✕⚠] \d+( · [✕⚠] \d+)?)$/);
});
