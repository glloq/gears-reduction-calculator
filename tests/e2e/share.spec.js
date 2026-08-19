const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { search } = require('./flow.js');

// §20 : « regarde cette solution » ne s'envoyait pas. Le lien de partage
// rouvrait une RECHERCHE — à charge pour le destinataire de la relancer,
// d'attendre, et de retrouver lui-même, dans quatre-vingts lignes, celle dont
// on lui parlait, en supposant que le moteur n'ait pas changé d'avis.

/** Ce que la page montre : la solution affichée, et d'où on la regarde. */
const shown = page => page.evaluate(() => {
  const pool = GearApp._explorer.getPool();
  const index = GearApp._explorer.selectedIndex() || 0;
  const solution = pool[index] || null;
  const viewer = GearApp.visualization.viewerToolbar;
  return {
    count: pool.length,
    stages: solution ? JSON.stringify(solution.stages.map(stage => {
      const copy = Object.assign({}, stage);
      delete copy.geometry; delete copy.mechanical;
      return copy;
    })) : null,
    ratio: solution ? Math.round(solution.ratio * 1e6) / 1e6 : null,
    error: solution ? Math.round(solution.errorPercent * 1e4) / 1e4 : null,
    torque: solution ? Math.round(solution.outputTorqueNm * 1e3) / 1e3 : null,
    view: viewer ? viewer.currentView : null,
    projection: viewer ? viewer.projection : null,
    explode: viewer ? !!viewer.explode : null,
    stage: viewer ? viewer.selectedStage : null
  };
});

test('a shared link reopens the solution itself, seen from where it was shown (§20)', async ({ page }) => {
  const errors = watchConsoleErrors(page);
  await page.goto('/');
  // Un rapport que le moteur ne peut PAS atteindre exactement : sans écart à
  // reproduire, le rapport visé pourrait se perdre en route sans que rien ne
  // le dise — l'écart resterait nul des deux côtés.
  await search(page, { quantities: { ratio: 12.37 } });

  // On s'installe : une vue, un regard, un éclatement, un étage. C'est cet
  // écran-là qu'on partage, et c'est lui qui doit revenir.
  await page.evaluate(() => {
    const viewer = GearApp.visualization.viewerToolbar;
    viewer.setView('geometry');
    viewer.setProjection('iso');
    viewer.setExplode(true);
    viewer.selectStage(0);
  });
  const sent = await shown(page);
  expect(sent.stages).not.toBe(null);
  expect(sent.error, 'le cas d’essai n’a plus d’écart à reproduire').toBeGreaterThan(0);

  // Le bouton de partage écrit le lien dans la barre d'adresse, en plus de le
  // copier : le presse-papiers n'est pas lisible ici, et un utilisateur non
  // plus n'a pas à croire sur parole ce qu'on vient de lui copier.
  await page.locator('#shareBtn').click();
  const link = page.url();
  expect(link, 'le lien ne porte pas de version').toContain('v=1');
  expect(link, 'le point de vue n’est pas lisible dans le lien').toContain('oeil=iso');
  expect(link).toContain('eclate=1');
  expect(link).toContain('vue=geometry');
  // Une adresse qu'on ne peut pas envoyer n'est pas un partage.
  expect(link.length, 'lien de ' + link.length + ' caractères').toBeLessThan(2000);

  // Le destinataire ouvre le lien.
  await page.goto(link);
  await page.locator('.solution-card').first().waitFor();
  const received = await shown(page);

  // La MÊME transmission, à la dent près — et sans avoir rien relancé.
  expect(received.count).toBe(1);
  expect(received.stages).toBe(sent.stages);
  // Les mêmes chiffres : le lien ne porte que ce qui définit la chaîne, tout
  // le reste est recalculé, et doit retomber sur ses pieds.
  expect(received.ratio).toBe(sent.ratio);
  expect(received.error).toBe(sent.error);
  expect(received.torque).toBe(sent.torque);

  // Et vu d'où on le montrait : un lien qui rouvrirait le bon mécanisme sous
  // un autre angle ne montrerait pas ce qu'on montrait.
  expect(received.view).toBe('geometry');
  expect(received.projection).toBe('iso');
  expect(received.explode).toBe(true);
  expect(received.stage).toBe(0);

  // Un lien désigne explicitement une solution : l'ouvrir sur le modal de
  // recherche reviendrait à l'ignorer.
  await expect(page.locator('#searchModal')).toBeHidden();

  // Une solution REÇUE n'est pas un vivier d'une solution : rien à trier, rien
  // à filtrer, rien à comparer à soi-même. Et l'écran dit d'où elle vient —
  // « transmission analysée » laisserait croire qu'on l'a saisie soi-même.
  await expect(page.locator('#analysedBanner')).toBeVisible();
  await expect(page.locator('#analysedTitle')).toHaveText('Solution partagée');
  await expect(page.locator('#refineBar')).toBeHidden();

  // AMPUTÉ DE SON CAHIER DES CHARGES — une adresse coupée en fin de ligne, un
  // client de messagerie trop zélé — le lien doit encore rendre la MÊME
  // transmission, avec les mêmes chiffres : il porte lui-même le rapport visé
  // et le régime, et ne compte pas sur le besoin pour les retrouver.
  await page.goto(link.replace(/&cdc=[^&]*/, ''));
  await page.locator('.solution-card').first().waitFor();
  const alone = await shown(page);
  expect(alone.stages).toBe(sent.stages);
  expect(alone.ratio).toBe(sent.ratio);
  expect(alone.error).toBe(sent.error);
  expect(alone.torque).toBe(sent.torque);
  expect(errors).toEqual([]);
});

test('a shared link brings the brief along, so the search can be taken further (§20)', async ({ page }) => {
  const errors = watchConsoleErrors(page);
  await page.goto('/');
  await search(page, { quantities: { ratio: 12 }, constraints: { maxDiameter: 220 } });
  await page.locator('#shareBtn').click();
  const link = page.url();
  expect(link).toContain('cdc=');

  await page.goto(link);
  await page.locator('.solution-card').first().waitFor();
  // Le besoin est là, prêt à être repris : le destinataire n'a pas à deviner
  // ce qu'on cherchait pour chercher mieux.
  const brief = await page.evaluate(() => {
    const session = GearApp._workbench.session;
    return { ratio: session.requirement.ratio.nominal(),
      constraints: session.preferences.constraints().map(entry => entry.meta.label) };
  });
  expect(brief.ratio).toBeCloseTo(12, 6);
  expect(brief.constraints.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a link without a solution is a search to take up, not an empty page (§20)', async ({ page }) => {
  // On peut partager depuis un écran qui n'affiche encore rien : le lien porte
  // alors le besoin, et rien d'autre. Le destinataire ne doit pas tomber sur
  // une page vide en attendant qu'il devine quoi faire — c'est une recherche
  // préremplie, et le modal est l'endroit où on la reprend.
  const errors = watchConsoleErrors(page);
  await page.goto('/');
  await search(page, { quantities: { ratio: 12.37 } });
  await page.locator('#shareBtn').click();
  const link = page.url();
  await page.goto(link.replace(/&sol=[^&]*/, ''));
  await expect(page.locator('#searchModal')).toBeVisible();
  const ratio = await page.evaluate(() => GearApp._workbench.session.requirement.ratio.nominal());
  expect(ratio).toBeCloseTo(12.37, 6);
  expect(errors).toEqual([]);
});

test('an address that shares nothing still opens the search (§20)', async ({ page }) => {
  // Un lien d'une version qu'on ne sait pas relire n'est pas deviné : ses
  // implicites ne sont peut-être plus les nôtres, et on rouvrirait autre chose.
  const errors = watchConsoleErrors(page);
  await page.goto('/?v=999&vue=teeth&sol=nimportequoi');
  await expect(page.locator('#searchModal')).toBeVisible();
  expect(errors).toEqual([]);
});
