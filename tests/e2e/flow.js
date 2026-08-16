// Parcours de recherche partagé par les suites E2E.
//
// La configuration ne vit plus dans la page : elle vit dans le modal, qui
// s'ouvre de lui-même tant qu'aucun besoin n'est défini. Tout test qui veut des
// résultats passe donc par ici, exactement comme un utilisateur.

/** Ouvre le modal s'il ne l'est pas déjà (après une recherche, il est fermé). */
async function openModal(page) {
  const modal = page.locator('#searchModal');
  if (!(await modal.isVisible())) await page.locator('#editSearchBtn').click();
  await modal.waitFor({ state: 'visible' });
  return modal;
}

/**
 * Déplie un réglage de la première étape (technologie, disposition). Ils sont
 * repliés tant qu'on n'y a pas touché : c'est tout l'objet de la passe UX.
 */
async function openSetting(page, key) {
  await page.locator('[data-step="type"]').click();
  const body = page.locator(`[data-setting-body="${key}"]`);
  if (!(await body.count())) await page.locator(`.setting-toggle[data-setting="${key}"]`).click();
  await body.waitFor();
}

/**
 * Déplie une ligne d'option de l'étape « Affiner ». Elles sont repliées tant
 * qu'on ne les demande pas : la plupart des recherches n'y touchent jamais.
 */
async function openOption(page, key) {
  await page.locator('[data-step="criteria"]').click();
  const body = page.locator(`[data-option-body="${key}"]`);
  if (await body.isHidden()) await page.locator(`.option-row-head[data-option="${key}"]`).click();
  await body.waitFor({ state: 'visible' });
}

/**
 * Pose une grandeur sur la fiche, en la révélant d'abord si besoin.
 * @param {string} path ex. 'ratio', 'output.speed'
 * @param {string|number} value valeur, ou [min, max] pour une plage
 * @param {string} [kind] exact | target | min | max | range
 */
async function setQuantity(page, path, value, kind) {
  await page.locator('[data-step="need"]').click();
  const row = page.locator(`.quantity-row[data-path="${path}"]`);
  if (!(await row.count())) {
    await page.locator('#addQuantityBtn').click();
    await page.locator(`#quantityMenu [data-field="${path}"]`).click();
  }
  if (kind) await row.locator('.quantity-kind').selectOption(kind);
  const values = Array.isArray(value) ? value : [value];
  await row.locator('[data-slot="a"]').fill(String(values[0]));
  if (values.length > 1) await row.locator('[data-slot="b"]').fill(String(values[1]));
  await row.locator('[data-slot="a"]').blur();
}

/**
 * Définit un besoin dans le modal et lance la recherche.
 * @param {object} [spec] grandeurs à poser ; par défaut un rapport 12:1.
 */
async function defineSearch(page, spec) {
  spec = spec || {};
  await openModal(page);
  const quantities = spec.quantities || { ratio: 12 };
  for (const path of Object.keys(quantities)) {
    const entry = quantities[path];
    const value = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.value : entry;
    const kind = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.kind : undefined;
    await setQuantity(page, path, value, kind);
  }
  if (spec.families) {
    await openSetting(page, 'technology');
    await page.locator('#technologyPolicy [data-policy="restrict"]').click();
    for (const family of spec.families) await page.locator(`.family-card[data-family="${family}"]`).click();
  }
  if (spec.constraints) {
    await page.locator('[data-step="criteria"]').click();
    for (const key of Object.keys(spec.constraints)) {
      await page.locator('#addConstraintBtn').click();
      await page.locator(`#constraintMenu [data-field="${key}"]`).click();
      const chip = page.locator(`.constraint-chip[data-constraint="${key}"]`);
      await chip.locator('[data-slot="a"]').fill(String(spec.constraints[key]));
      await chip.locator('[data-slot="a"]').blur();
    }
  }
  await page.locator('#searchModalSubmit').click();
  await page.locator('#searchModal').waitFor({ state: 'hidden' });
}

/** Définit un besoin, lance la recherche et attend les cartes. */
async function search(page, spec) {
  await defineSearch(page, spec);
  await page.locator('.solution-card').first().waitFor({ timeout: 30000 });
}

module.exports = { openModal, setQuantity, defineSearch, search, openSetting, openOption };
