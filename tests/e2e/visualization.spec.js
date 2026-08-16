const { test, expect } = require('@playwright/test');

// Étages de référence : un par famille de transmission, avec les paramètres
// que le moteur sait dimensionner. Ils sont analysés dans la page pour ne pas
// dépendre de la solution que la recherche renvoie.
const STAGES = {
  spur: { type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } },
  helical: { type: 'helical', input: { teeth: 18 }, output: { teeth: 54 }, parameters: { module: 2, helixAngle: 25, pressureAngle: 20, faceWidth: 20 } },
  internal: { type: 'internal', input: { teeth: 18 }, output: { teeth: 54 }, parameters: { module: 2, pressureAngle: 20 } },
  bevel: { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 90, faceWidth: 15 } },
  worm: { type: 'worm', wormStarts: 2, wheelTeeth: 40, parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } },
  belt: { type: 'belt', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { pitch: 5, centerDistance: 150, profile: 'HTD-5M' } },
  chain: { type: 'chain', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { pitch: 12.7, centerDistance: 250 } },
  planetary: { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 5, inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2, faceWidth: 20 } },
  rack: { type: 'rack', pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } }
};

/** Monte un jeu d'étages dans le visualiseur et renvoie le contrôleur de vues. */
async function mount(page, names) {
  await page.goto('/');
  await page.waitForFunction(() => window.GearApp && GearApp.visualization && GearApp.visualization.ViewerToolbar);
  return page.evaluate(({ stages, names }) => {
    const chosen = names.map(name => JSON.parse(JSON.stringify(stages[name])));
    // Le visualiseur héro n'est affiché qu'une fois une recherche aboutie ; on
    // le révèle directement pour tester le rendu sans dépendre du solveur.
    document.body.classList.add('has-results');
    const container = document.getElementById('svgContainer');
    const toolbar = new GearApp.visualization.ViewerToolbar(container);
    toolbar.bind();
    window.__viewer = toolbar;
    let solution;
    if (chosen.length === 1 && chosen[0].type === 'rack') {
      const definition = GearTransmissionRegistry.get('rack');
      chosen[0].geometry = definition.calculateGeometry(chosen[0]);
      solution = { mode: 'rotationTranslation', stages: chosen, inputSpeedRpm: 1500, inputTorqueNm: 10,
        dimensions: { length: 44, maxDiameter: 44, width: 20 }, warnings: [], outputForceN: 500,
        mechanical: [{ stage: 1, type: 'rack', ratio: null, geometry: chosen[0].geometry, efficiency: .97,
          forces: definition.calculateForces(chosen[0], 10) }] };
    } else {
      solution = GearEngineering.analyzeSolution(chosen, 3, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
    }
    window.__solution = solution;
    toolbar.render(solution);
    return true;
  }, { stages: STAGES, names });
}

async function showView(page, view) {
  await page.evaluate(v => window.__viewer.setView(v), view);
  await page.waitForTimeout(60);
}

function watchErrors(page) {
  const errors = [];
  page.on('console', message => {
    // Le CDN des dépendances tierces n'est pas joignable hors ligne : seules
    // les erreurs de l'application nous intéressent ici.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

test('selection survives all three visualization views', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.locator('.train-stage').first()).toBeVisible({ timeout: 20000 });
  // On clique une roue de l'étage, pas le centre de son cadre : sur un train
  // composé, les cadres d'étages se recouvrent.
  await page.locator('.train-stage[data-stage="0"] .train-wheel').first().click();
  await page.getByRole('button', { name: 'Géométrie 2D' }).click();
  await expect(page.locator('.geometry-layer .geometry-stage').first()).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Cinématique' }).click();
  await expect(page.locator('.kinematic-stage').first()).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Denture' }).click();
  await expect(page.locator('.train-stage').first()).toHaveClass(/selected/);
  expect(errors).toEqual([]);
});

test('animation speed and direction controls update shared viewer state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.locator('.train-svg')).toBeVisible({ timeout: 20000 });
  await page.locator('#viewerSpeed').selectOption('2');
  await page.locator('#viewerReverse').click();
  await page.getByRole('button', { name: 'Animer' }).click();
  await expect(page.locator('#viewerAnimate')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#viewerReverse')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.train-svg')).toHaveClass(/is-animated/);
});

test('every transmission family draws in every view without errors or NaN', async ({ page }) => {
  const errors = watchErrors(page);
  for (const name of Object.keys(STAGES)) {
    await mount(page, [name]);
    for (const view of ['teeth', 'geometry', 'kinematic']) {
      await showView(page, view);
      const markup = await page.locator('#svgContainer svg').innerHTML();
      expect(markup, name + ' / ' + view).not.toMatch(/NaN|Infinity/);
      expect(markup.length, name + ' / ' + view).toBeGreaterThan(200);
    }
  }
  expect(errors).toEqual([]);
});

test('the rack is now drawn in the Denture view, not deflected to Geometry', async ({ page }) => {
  await mount(page, ['rack']);
  await showView(page, 'teeth');
  await expect(page.locator('.train-stage.rack')).toHaveCount(1);
  await expect(page.locator('.train-wheel .rack-teeth')).toHaveCount(1);
  // Le bouton n'est plus réservé aux objectifs rotatifs.
  await expect(page.locator('.view-mode[data-view="teeth"]')).not.toHaveClass(/rotary-only/);
  // Le pignon tourne, la crémaillère translate.
  const travel = await page.evaluate(() => {
    const teeth = window.__viewer.teeth;
    teeth.setAnimationAngle(360);
    const rack = document.querySelector('.train-wheel [class*="rack-teeth"]').closest('.train-wheel');
    return { transform: rack.getAttribute('transform'), rotor: document.querySelector('.train-wheel .rotor').getAttribute('transform') };
  });
  expect(travel.transform).toMatch(/translate/);
  expect(travel.rotor).toMatch(/rotate\(360/);
});

test('a planetary draws every real planet, its carrier and its three roles', async ({ page }) => {
  await mount(page, ['planetary']);
  await showView(page, 'teeth');
  await expect(page.locator('.train-wheel.planet')).toHaveCount(5);
  await expect(page.locator('.planet-carrier')).toHaveCount(1);
  await expect(page.locator('.train-wheel.ring')).toHaveCount(1);
  await expect(page.locator('.train-wheel.sun')).toHaveCount(1);

  // Les satellites orbitent ET tournent sur eux-mêmes.
  const motion = await page.evaluate(() => {
    const teeth = window.__viewer.teeth;
    teeth.setAnimationAngle(0);
    const planet = document.querySelector('.train-wheel.planet');
    const start = { orbit: planet.querySelector('.planet-orbit').getAttribute('transform'),
      spin: planet.querySelector('.rotor').getAttribute('transform') };
    teeth.setAnimationAngle(180);
    return { start, end: { orbit: planet.querySelector('.planet-orbit').getAttribute('transform'),
      spin: planet.querySelector('.rotor').getAttribute('transform') } };
  });
  expect(motion.end.orbit).not.toBe(motion.start.orbit);
  expect(motion.end.spin).not.toBe(motion.start.spin);

  await showView(page, 'kinematic');
  const roles = await page.locator('.kinematic-stage .role-label').allTextContents();
  expect(roles.join(' ')).toContain('INPUT S');
  expect(roles.join(' ')).toContain('OUTPUT C');
  expect(roles.join(' ')).toContain('FIXED R');
});

test('belts and chains use the exact tangent path and travelling elements', async ({ page }) => {
  for (const [name, marker] of [['belt', '.belt-tooth'], ['chain', '.chain-link']]) {
    await mount(page, [name]);
    await showView(page, 'teeth');
    await expect(page.locator('.train-wheel')).toHaveCount(2);
    expect(await page.locator(marker).count()).toBeGreaterThan(3);
    const moved = await page.evaluate(selector => {
      const teeth = window.__viewer.teeth;
      teeth.setAnimationAngle(0);
      const before = document.querySelector(selector).getAttribute('transform');
      teeth.setAnimationAngle(120);
      return { before, after: document.querySelector(selector).getAttribute('transform') };
    }, marker);
    expect(moved.after).not.toBe(moved.before);

    await showView(page, 'geometry');
    // La vue Géométrie affiche l'enroulement et les points de tangence réels.
    const stage = page.locator('.geometry-layer .geometry-stage').first();
    expect(Number(await stage.getAttribute('data-wrap-angle-deg'))).toBeGreaterThan(0);
    expect(await page.locator('.tangency-point').count()).toBe(4);
  }
});

test('the level of detail follows the zoom, adding construction traces', async ({ page }) => {
  await mount(page, ['spur']);
  await showView(page, 'teeth');
  const detail = () => page.evaluate(() => ({
    base: document.querySelectorAll('.base-circle').length,
    contact: document.querySelectorAll('.line-of-action').length
  }));
  const fitted = await detail();
  await page.evaluate(() => { const t = window.__viewer.teeth; t.viewport.zoomAt(0, 0, 10); t._refreshDetail(); });
  const zoomed = await detail();
  expect(zoomed.base).toBeGreaterThan(fitted.base);
  expect(zoomed.contact).toBeGreaterThan(0);
  await page.evaluate(() => { const t = window.__viewer.teeth; t.resetView(); });
  expect((await detail()).base).toBe(fitted.base);
});

test('the three views share one animation clock across view switches', async ({ page }) => {
  await mount(page, ['spur', 'helical']);
  await showView(page, 'teeth');
  await page.evaluate(() => { window.__viewer.renderer().setAnimationAngle(90); window.__viewer.animationAngle = 90; });
  const teeth = await page.locator('.train-wheel .rotor').first().getAttribute('transform');
  expect(teeth).toMatch(/rotate\(90/);
  await showView(page, 'geometry');
  expect(await page.locator('.index-rotor').first().getAttribute('transform')).toMatch(/rotate\(90/);
  await showView(page, 'kinematic');
  expect(await page.locator('.spin-mark').first().getAttribute('transform')).toMatch(/rotate\(90/);
});

test('shafts carry their real speed and direction in the kinematic view', async ({ page }) => {
  await mount(page, ['spur', 'spur']);
  await showView(page, 'kinematic');
  const labels = await page.locator('.shaft-label').evaluateAll(nodes => nodes.map(n => n.firstChild.nodeValue));
  expect(labels.length).toBeGreaterThanOrEqual(3);
  expect(labels[0]).toContain('S0 · 1500 rpm');
  // Un engrènement externe inverse le sens : ↺ puis ↻ puis ↺.
  expect(labels[0]).toContain('↺');
  expect(labels[1]).toContain('↻');
  expect(labels[2]).toContain('↺');
  await expect(page.locator('.power-flow')).toHaveCount(1);
});

test('exports are self-contained and free of NaN in every view', async ({ page }) => {
  await mount(page, ['planetary', 'belt']);
  for (const view of ['teeth', 'geometry', 'kinematic']) {
    await showView(page, view);
    const exported = await page.evaluate(() => ({
      plain: window.__viewer.renderer().exportSVG(),
      technical: window.__viewer.renderer().exportSVG({ technical: true })
    }));
    expect(exported.plain.length, view).toBeGreaterThan(500);
    expect(exported.plain, view).not.toMatch(/NaN|Infinity/);
    expect(exported.plain, view).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(exported.plain, view).toContain('<style');
    expect(exported.plain, view).not.toContain('class="selected"');
    expect(exported.technical, view).toContain('is-technical-export');
  }
});

test('the display menu adapts to the current view and toggles overlays', async ({ page }) => {
  await mount(page, ['spur']);
  const offered = () => page.evaluate(() => Array.from(document.querySelectorAll('#viewerDisplayMenu [data-overlay]'))
    .filter(input => !input.closest('label').hidden).map(input => input.dataset.overlay));

  await showView(page, 'geometry');
  expect(await offered()).toEqual(['pitchCircles', 'dimensions', 'axes', 'envelope', 'forces', 'labels']);
  await page.evaluate(() => window.__viewer.setOverlay('dimensions', false));
  await expect(page.locator('#svgContainer')).toHaveClass(/hide-dimensions/);

  await showView(page, 'kinematic');
  expect(await offered()).toEqual(['rpm', 'ratios', 'powerFlow', 'spatialAxes', 'labels']);

  await showView(page, 'teeth');
  expect(await offered()).toEqual(['autoDetails', 'pitchCircles', 'lineOfAction', 'forces', 'labels']);
  // Une option masquée dans une vue reste mémorisée pour son retour.
  await expect(page.locator('#svgContainer')).toHaveClass(/hide-dimensions/);
});
