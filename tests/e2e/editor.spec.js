const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { search } = require('./flow.js');
let errors = [];
test.beforeEach(async ({ page }) => {
  errors = watchConsoleErrors(page);
  await page.goto('/');
});
test.afterEach(() => expect(errors, 'browser errors').toEqual([]));

test('stage editor recomputes live and saves a variant into the pool', async ({ page }) => {
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });
  await page.locator('[data-detail="editeur"]').click();
  await expect(page.locator('.editor-stage').first()).toBeVisible();

  // Modifier les dents menées du premier étage → recalcul et deltas visibles.
  await page.locator('.editor-stage').first().locator('input').nth(1).fill('37');
  await expect(page.locator('#editorKpis .editor-kpi').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#editorSaveVariant')).toBeEnabled();

  await page.locator('#editorSaveVariant').click();
  // La variante rejoint le vivier, signalée par son propre badge de carte.
  await expect(page.locator('.solution-card .recommendation-badge.variant').first()).toBeVisible();

  // La variante sélectionnée alimente le schéma héro (toujours visible).
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
});

test('a pitch diameter can be typed, and says which tooth count it lands on', async ({ page }) => {
  await search(page);
  await expect(page.locator('.solution-card')).not.toHaveCount(0, { timeout: 20000 });
  await page.locator('[data-detail="editeur"]').click();
  const stage = page.locator('.editor-stage').first();
  await expect(stage).toBeVisible();

  // Le champ vise un compte de dents nommé — le premier étage n'est pas
  // toujours de la même famille, et le libellé change avec elle.
  const diameter = stage.locator('input[data-sizing]').first();
  await expect(diameter).toBeVisible();
  const drives = await diameter.getAttribute('data-sizing');
  const teeth = stage.locator(`input[data-field="${drives}"]`);

  // Il part de la valeur que le module et les dents imposent : ce n'est pas
  // une taille libre, c'est une conséquence.
  const start = await page.evaluate(sel => {
    const stage = document.querySelector('.editor-stage');
    const module = Array.from(stage.querySelectorAll('label.sub'))
      .find(l => l.childNodes[0].textContent.trim().startsWith('Module'));
    return { teeth: Number(stage.querySelector(`input[data-field="${sel}"]`).value),
      module: Number(module.querySelector('input').value),
      shown: Number(stage.querySelector('input[data-sizing]').value) };
  }, drives);
  expect(start.shown).toBeCloseTo(start.module * start.teeth, 2);

  // On demande un diamètre volontairement hors compte rond.
  const asked = start.module * (start.teeth + 3) + start.module * 0.4;
  await diameter.fill(asked.toFixed(3));
  const note = stage.locator('.sizing-note').first();
  await expect(note).toHaveText(/Z = \d+/);
  // Le compte de dents est ENTIER : le diamètre atteignable est donc discret,
  // et le message le dit au lieu d'arrondir en silence. On interroge le MODÈLE
  // et pas seulement le champ — c'est l'étage ré-analysé qui compte, et un
  // champ qui afficherait un entier au-dessus d'une fraction serait le pire
  // des deux mondes.
  await expect(teeth).toHaveValue(String(start.teeth + 3));
  const held = await page.evaluate(path => {
    const stage = GearApp._stageEditor._stages[0];
    return path.split('.').reduce((o, k) => o && o[k], stage);
  }, drives);
  expect(held, 'l’étage retient un nombre de dents entier').toBe(start.teeth + 3);
  await expect(note).toHaveText(/Ø atteignable/);

  // Et la chaîne a bien été ré-analysée : ce n'est pas un champ décoratif.
  await expect(page.locator('#editorKpis .editor-kpi').first()).toBeVisible({ timeout: 5000 });
});
