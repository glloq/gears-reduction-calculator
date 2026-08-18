const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');
const { search } = require('./flow.js');

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
  // Le modal de recherche s'ouvre tant qu'aucun besoin n'est défini ; ce harnais
  // monte le visualiseur directement, il doit donc d'abord dégager la page.
  const modal = page.locator('#searchModal');
  if (await modal.isVisible()) await page.locator('#searchModalClose').click();
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

const watchErrors = watchConsoleErrors;

test('selection survives all three visualization views', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await search(page);
  await expect(page.locator('.train-stage').first()).toBeVisible({ timeout: 20000 });
  // On clique une roue de l'étage, pas le centre de son cadre : sur un train
  // composé, les cadres d'étages se recouvrent.
  await page.locator('.train-stage[data-stage="0"] .train-wheel').first().click();
  await page.getByRole('button', { name: 'Dimensions', exact: true }).click();
  await expect(page.locator('.geometry-layer .geometry-stage').first()).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Cinématique' }).click();
  await expect(page.locator('.kinematic-stage').first()).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Transmission' }).click();
  await expect(page.locator('.train-stage').first()).toHaveClass(/selected/);
  expect(errors).toEqual([]);
});

test('animation speed and direction controls update shared viewer state', async ({ page }) => {
  await page.goto('/');
  await search(page);
  await expect(page.locator('.train-svg')).toBeVisible({ timeout: 20000 });
  // Les réglages d'animation vivent désormais dans un menu replié.
  await page.locator('#viewerAnimationMenu > summary').click();
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
  // Le signe de l'angle dessiné porte désormais le CÔTÉ depuis lequel on
  // regarde : une roue vue de son autre extrémité tourne, à l'écran, dans
  // l'autre sens. Seule l'amplitude est ici en cause.
  expect(travel.rotor).toMatch(/^rotate\(-?360/);
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
    // L'orbite est portée par la PLACE du satellite, plus par une rotation du
    // groupe : elle suit le plan d'orbite, qu'un `rotate()` ne parcourt pas.
    const read = () => ({ orbit: planet.querySelector('.planet-seat').getAttribute('transform'),
      spin: planet.querySelector('.rotor').getAttribute('transform') });
    const start = read();
    teeth.setAnimationAngle(180);
    return { start, end: read() };
  });
  expect(motion.end.orbit).not.toBe(motion.start.orbit);
  expect(motion.end.spin).not.toBe(motion.start.spin);

  await showView(page, 'kinematic');
  // §9, §10 : « INPUT S » ne disait ni de quel organe il s'agit ni ce qu'il
  // fait. L'organe est nommé, son code de schéma reste entre parenthèses.
  const roles = await page.locator('.kinematic-stage .role-label').allTextContents();
  expect(roles.join(' ')).toContain('Entrée · Solaire (S)');
  expect(roles.join(' ')).toContain('Sortie · Porte-satellites (C)');
  expect(roles.join(' ')).toContain('Fixe · Couronne (R)');
});

test('the fixed member carries a ground symbol in all three views (§18)', async ({ page }) => {
  await mount(page, ['planetary']);
  // Couronne bloquée : c'est ELLE qui doit porter les hachures, dans les trois
  // vues. Sans symbole, seule l'étiquette disait quel organe est immobile.
  for (const view of ['teeth', 'geometry', 'kinematic']) {
    await showView(page, view);
    const hatches = await page.locator('.ground-hatch').count();
    expect(hatches, view).toBeGreaterThan(3);
  }

  // Et le symbole SUIT la topologie : solaire bloqué, il change de place. La
  // mesure se fait en Denture, la seule vue où le bâti épouse la pièce réelle.
  await showView(page, 'teeth');
  const moved = await page.evaluate(() => {
    const box = () => {
      const marks = Array.from(document.querySelectorAll('.ground-hatch'));
      if (!marks.length) return null;
      const xs = marks.map(m => Number(m.getAttribute('x1')));
      return { count: marks.length, span: Math.max(...xs) - Math.min(...xs) };
    };
    const before = box();
    const stage = window.__viewer.solution.stages[0];
    Object.assign(stage, { inputMember: 'C', fixed: 'S', outputMember: 'R' });
    window.__viewer.render(window.__viewer.solution);
    return { before, after: box() };
  });
  // La couronne est bien plus large que le solaire : l'étendue du peigne change.
  expect(moved.after.span).toBeLessThan(moved.before.span);
});

test('the worm turns without walking, in the Denture and Geometry views (§15)', async ({ page }) => {
  await mount(page, ['worm']);
  for (const view of ['teeth', 'geometry']) {
    await showView(page, view);
    const motion = await page.evaluate(v => {
      const renderer = v === 'teeth' ? window.__viewer.teeth : window.__viewer.geometry;
      const read = () => {
        const phase = document.querySelector('.worm-thread-phase');
        const body = document.querySelector('.worm-body, .worm-member');
        return { phase: phase && phase.getAttribute('transform'),
          body: body && (body.getAttribute('transform') || ''),
          bodyX: body && (body.getAttribute('x') || body.getAttribute('cx') || '') };
      };
      renderer.setAnimationAngle(0);
      const start = read();
      renderer.setAnimationAngle(90);
      const quarter = read();
      renderer.setAnimationAngle(360);
      return { start, quarter, full: read() };
    }, view);
    // Les filets défilent…
    expect(motion.quarter.phase, view).not.toBe(motion.start.phase);
    // …et se retrouvent exactement où ils étaient après un tour complet.
    expect(motion.full.phase, view).toBe(motion.start.phase);
    // …tandis que le corps ne bouge pas d'un pouce : c'était le défaut, la vis
    // se déplaçait le long de son propre arbre.
    expect(motion.quarter.body, view).toBe(motion.start.body);
    expect(motion.quarter.bodyX, view).toBe(motion.start.bodyX);
  }

  // §15 : et surtout, plus d'aiguille radiale en Géométrie — elle prétendait
  // une rotation dans le plan du dessin, que la vis vue de profil ne fait pas.
  // La ROUE, elle, est bien vue de face : elle garde son repère. Seule la vis
  // n'en a plus.
  const needles = await page.evaluate(() => {
    const worm = document.querySelector('.worm-member').closest('.geometry-member-group');
    return { onWorm: worm.querySelectorAll('.index-mark').length,
      total: document.querySelectorAll('.geometry-member-group .index-mark').length };
  });
  expect(needles.onWorm).toBe(0);
  expect(needles.total).toBeGreaterThan(0);
});

test('the inspector explains a planetary, and the analysis lets it be checked (§20, §21)', async ({ page }) => {
  await mount(page, ['planetary']);
  await showView(page, 'teeth');
  await page.locator('.train-stage[data-stage="0"] .train-wheel').first().click();
  const inspector = page.locator('#stageInspector');
  await expect(inspector).toBeVisible();
  // §20 : la relation qui EXPLIQUE le rapport, et le rapport de base — pas
  // seulement « 24 → 24 → 72 », qui ne dit pas qui mène.
  await expect(inspector).toContainText('Rapport de base');
  await expect(inspector).toContainText('ωS');
  await expect(inspector).toContainText('Coaxialité');
  await expect(inspector).toContainText('Équirépartition');
  await expect(inspector).toContainText('Fixe');
  await expect(inspector).toContainText('Couronne (R)');
});

test('each view says what it draws to scale, and what it only suggests (§22, §23)', async ({ page }) => {
  await mount(page, ['spur']);
  const badge = page.locator('#viewerFidelity');

  await showView(page, 'geometry');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('cotée');

  await showView(page, 'kinematic');
  // Un schéma symbolique lu comme un plan coté est une source d'erreur :
  // la vue le dit elle-même, elle ne le laisse pas deviner.
  await expect(badge).toContainText('symbolique');
  await expect(badge).toContainText('pas à l’échelle');

  await showView(page, 'teeth');
  await expect(badge).toContainText('à l’échelle réelle');
  await expect(badge).not.toHaveClass(/has-derived/);
  // §54 : la phrase disait une bonne fois « la longueur des arbres est
  // schématique ». Elle l'était faute d'abscisses ; elle ne l'est plus
  // toujours, et la vue qualifie maintenant ce qu'elle montre.
  await expect(badge).toContainText('L’écartement des organes');

  // Un train composé fait porter deux organes au même arbre : leur écartement
  // dépend alors d'un jeu d'arbre, que rien n'impose ici. La vue le dit.
  await mount(page, ['spur', 'helical']);
  await showView(page, 'teeth');
  await expect(badge).toContainText('jeu d’arbre par défaut');
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

test('angle 0 to 120 moves something in every family and every view', async ({ page }) => {
  // Le test qui manquait : chaque famille DOIT bouger dans chaque vue où un
  // mouvement est attendu. C'est ce qui empêche une vue de rester muette.
  const expected = {
    spur: { teeth: true, geometry: true, kinematic: true },
    helical: { teeth: true, geometry: true, kinematic: true },
    internal: { teeth: true, geometry: true, kinematic: true },
    bevel: { teeth: true, geometry: true, kinematic: true },
    worm: { teeth: true, geometry: true, kinematic: true },
    belt: { teeth: true, geometry: true, kinematic: true },
    chain: { teeth: true, geometry: true, kinematic: true },
    planetary: { teeth: true, geometry: true, kinematic: true },
    rack: { teeth: true, geometry: true, kinematic: true }
  };
  for (const [name, views] of Object.entries(expected)) {
    await mount(page, [name]);
    for (const [view, shouldMove] of Object.entries(views)) {
      await showView(page, view);
      const moved = await page.evaluate(() => {
        // Empreinte de TOUTES les transformations animées de la vue courante.
        const snapshot = () => Array.from(document.querySelectorAll(
          '#svgContainer .rotor, #svgContainer .planet-orbit, #svgContainer .carrier-arms,' +
          '#svgContainer .cone-phase, #svgContainer .train-wheel, #svgContainer .index-rotor,' +
          '#svgContainer .linear-slider, #svgContainer .spin-mark, #svgContainer .belt-tooth,' +
          '#svgContainer .chain-link, #svgContainer .power-pulse'
        )).map(el => el.getAttribute('transform') + '|' + el.getAttribute('cx') + ',' + el.getAttribute('cy')).join(';');
        const renderer = window.__viewer.renderer();
        renderer.setAnimationAngle(0);
        const before = snapshot();
        renderer.setAnimationAngle(120);
        return { before, after: snapshot() };
      });
      if (shouldMove) expect(moved.after, name + ' / ' + view + ' est resté figé').not.toBe(moved.before);
      expect(moved.after, name + ' / ' + view).not.toMatch(/NaN/);
    }
  }
});

test('the same input angle yields the same member angles in all three views', async ({ page }) => {
  await mount(page, ['spur', 'planetary']);
  const angles = {};
  for (const view of ['teeth', 'geometry', 'kinematic']) {
    await showView(page, view);
    angles[view] = await page.evaluate(() => {
      const renderer = window.__viewer.renderer();
      renderer.setAnimationAngle(150);
      // La pose est demandée au moteur, pas relue dans le DOM : c'est elle qui
      // doit être identique d'une vue à l'autre.
      const pose = GearKinematicsEngine.pose(renderer.scene.kinematics, 150);
      return Object.fromEntries(Object.entries(pose.members).map(([id, m]) => [id, Number(m.angle.toFixed(6))]));
    });
  }
  expect(angles.geometry).toEqual(angles.teeth);
  expect(angles.kinematic).toEqual(angles.teeth);
  // Et cette pose n'est pas triviale : les membres ne tournent pas tous pareil.
  expect(new Set(Object.values(angles.teeth)).size).toBeGreaterThan(2);
});

test('the three views agree on who drives and who is held, in all six topologies (§31)', async ({ page }) => {
  await mount(page, ['planetary']);
  const TOPOLOGIES = [
    { inputMember: 'S', fixed: 'R', outputMember: 'C' }, { inputMember: 'S', fixed: 'C', outputMember: 'R' },
    { inputMember: 'R', fixed: 'S', outputMember: 'C' }, { inputMember: 'R', fixed: 'C', outputMember: 'S' },
    { inputMember: 'C', fixed: 'S', outputMember: 'R' }, { inputMember: 'C', fixed: 'R', outputMember: 'S' }
  ];
  // La classe de dessin d'un organe n'est pas son code de schéma : la vue
  // Denture parle de « sun », « ring », « planet-carrier ». C'est justement le
  // genre de correspondance qu'une vue ne doit pas déduire toute seule.
  const CLASS_OF = { S: 'sun', R: 'ring', C: 'planet-carrier' };

  for (const topology of TOPOLOGIES) {
    const report = await page.evaluate(({ topology, classOf }) => {
      Object.assign(window.__viewer.solution.stages[0], topology);
      const out = {};
      for (const view of ['teeth', 'geometry', 'kinematic']) {
        window.__viewer.setView(view);
        const renderer = window.__viewer.renderer();
        const scene = renderer.scene;
        // La référence est la SCÈNE : chaque vue est comparée à elle, jamais
        // les vues entre elles — sinon trois vues également fausses passeraient.
        const truth = ['input', 'output', 'fixed'].reduce((acc, role) => {
          const member = scene.functionalMember(0, role);
          acc[role] = { code: member.role, name: member.memberName, rpm: member.mechanical.rpm };
          return acc;
        }, {});
        const svg = document.querySelector('#svgContainer svg');
        const hatch = svg.querySelector('.ground-hatch');
        let grounded = null;
        if (hatch && view === 'teeth') {
          const owner = hatch.closest('.train-wheel, .planet-carrier');
          grounded = owner ? Object.keys(classOf).find(code => owner.classList.contains(classOf[code])) : null;
        }
        out[view] = { truth: truth, text: svg.textContent, hatches: svg.querySelectorAll('.ground-hatch').length, grounded: grounded };
      }
      return out;
    }, { topology, classOf: CLASS_OF });

    const label = JSON.stringify(topology);
    for (const view of ['teeth', 'geometry', 'kinematic']) {
      const seen = report[view];
      // 1. Chaque vue lit la même topologie que la scène.
      expect(seen.truth.input.code, view + ' ' + label).toBe(topology.inputMember);
      expect(seen.truth.output.code, view + ' ' + label).toBe(topology.outputMember);
      expect(seen.truth.fixed.code, view + ' ' + label).toBe(topology.fixed);
      // 2. L'organe bloqué ne tourne pas, quelle que soit la vue.
      expect(Math.abs(seen.truth.fixed.rpm || 0), view + ' ' + label).toBeLessThan(1e-6);
      // 3. Et chacune le montre : le bâti est dessiné, pas seulement calculé.
      expect(seen.hatches, view + ' ' + label).toBeGreaterThan(3);
    }
    // 4. En Denture, le bâti est bien SUR l'organe bloqué — c'était le défaut :
    //    la couronne était hachurée quelle que soit la topologie.
    expect(report.teeth.grounded, label).toBe(topology.fixed);
    // 5. La cinématique nomme les trois organes, avec leur fonction.
    expect(report.kinematic.text, label).toContain('Fixe · ' + report.kinematic.truth.fixed.name);
    expect(report.kinematic.text, label).toContain('Entrée · ' + report.kinematic.truth.input.name);
  }
});

test('the inspector reports the same speeds whichever view opened it (§31)', async ({ page }) => {
  await mount(page, ['spur', 'planetary']);
  const readings = {};
  for (const view of ['teeth', 'geometry', 'kinematic']) {
    await showView(page, view);
    readings[view] = await page.evaluate(() => {
      const inspector = window.__viewer.inspector;
      const rows = [];
      for (let index = 0; index < 2; index++) {
        inspector.show(index);
        rows.push(document.querySelector('#stageInspector .inspector-grid').textContent);
      }
      return rows;
    });
  }
  // L'inspecteur lit la scène de la vue courante : trois scènes, un seul texte.
  expect(readings.geometry).toEqual(readings.teeth);
  expect(readings.kinematic).toEqual(readings.teeth);
  // Et il dit bien quelque chose : sinon l'égalité serait vide de sens.
  expect(readings.teeth[1]).toContain('Rapport de base');
});

test('belt markers travel around the pulleys, not only along the strands', async ({ page }) => {
  await mount(page, ['belt']);
  await showView(page, 'teeth');
  const trace = await page.evaluate(() => {
    const renderer = window.__viewer.renderer();
    const marker = document.querySelector('.belt-tooth');
    const link = renderer.model.stages[0].links[0];
    // Les centres sont ceux de la courroie DESSINÉE : la géométrie vit dans le
    // plan des poulies, et c'est son image qu'on suit ici.
    const centre1 = { x: link.geometry.centre1[0], y: link.geometry.centre1[1] };
    const centre2 = { x: link.geometry.centre2[0], y: link.geometry.centre2[1] };
    const positions = [];
    // Un tour complet de COURROIE, pas d'arbre : la courroie est bien plus
    // longue que la circonférence de la petite poulie.
    const perRevolution = Math.PI * 2 * link.r1;
    const span = 360 * link.length / perRevolution;
    for (let i = 0; i <= 120; i++) {
      renderer.setAnimationAngle(i * span / 120);
      const t = marker.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/);
      const x = Number(t[1]), y = Number(t[2]);
      positions.push({ x, y,
        d1: Math.hypot(x - centre1.x, y - centre1.y), d2: Math.hypot(x - centre2.x, y - centre2.y) });
    }
    return { positions, r1: link.r1, r2: link.r2, collapsed: link.collapsed };
  });
  // La vue par défaut voit la courroie de face : ses poulies sont des cercles,
  // et une distance au centre s'y compare à un rayon.
  expect(trace.collapsed, 'la courroie est vue par la tranche').toBe(false);
  // Le marqueur touche les deux poulies au cours du parcours.
  const onPulley1 = trace.positions.filter(p => Math.abs(p.d1 - trace.r1) < 0.5).length;
  const onPulley2 = trace.positions.filter(p => Math.abs(p.d2 - trace.r2) < 0.5).length;
  expect(onPulley1, 'jamais enroulé sur la petite poulie').toBeGreaterThan(0);
  expect(onPulley2, 'jamais enroulé sur la grande poulie').toBeGreaterThan(0);
  // Il ne rentre jamais dans une poulie, et ne saute jamais.
  trace.positions.forEach(p => {
    expect(p.d1).toBeGreaterThan(trace.r1 - 0.5);
    expect(p.d2).toBeGreaterThan(trace.r2 - 0.5);
  });
});

test('a belt hangs on its pulleys, whatever the projection (§6 de l’audit)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['belt']);
  await showView(page, 'teeth');
  const select = page.locator('#viewerProjection');
  const known = await page.evaluate(() => GearProjectionEngine.VIEWS.map(v => v.id));

  const shot = () => page.evaluate(() => {
    const model = window.__viewer.renderer().model;
    const link = model.stages[0].links[0], wheels = model.stages[0].wheels;
    const g = link.geometry;
    // Chaque point de tangence, ramené dans le plan de courroie : sa distance
    // au centre doit valoir le rayon de la poulie. C'est la tangence même, et
    // elle ne survit pas à un tracé reconstruit à l'horizontale.
    const det = g.first[0] * g.second[1] - g.second[0] * g.first[1];
    const radii = Math.abs(det) < 1e-9 ? null : g.tangentPoints.map((point, index) => {
      const dx = point[0] - g.origin[0], dy = point[1] - g.origin[1];
      const a = (dx * g.second[1] - dy * g.second[0]) / det;
      const b = (dy * g.first[0] - dx * g.first[1]) / det;
      const centre = index % 2 === 0 ? [0, 0] : [g.distance, 0];
      return Math.hypot(a - centre[0], b - centre[1]) - (index % 2 === 0 ? link.r1 : link.r2);
    });
    return {
      seat1: [wheels[0].cx, wheels[0].cy], seat2: [wheels[1].cx, wheels[1].cy],
      centre1: g.centre1, centre2: g.centre2, radii: radii,
      wrap: link.wrapAngle1Deg, length: link.length, distance: link.centerDistance,
      d: document.querySelector('#svgContainer .belt-line').getAttribute('d')
    };
  });

  const drawings = new Set();
  let reference = null;
  for (const id of ['unfolded'].concat(known)) {
    await select.selectOption(id);
    const seen = await shot();
    if (!reference) reference = seen;
    // La courroie s'accroche aux poulies TELLES QUE LA VUE LES A POSÉES.
    expect(Math.hypot(seen.centre1[0] - seen.seat1[0], seen.centre1[1] - seen.seat1[1])).toBeLessThan(1e-6);
    expect(Math.hypot(seen.centre2[0] - seen.seat2[0], seen.centre2[1] - seen.seat2[1])).toBeLessThan(1e-6);
    if (seen.radii) seen.radii.forEach(gap => expect(Math.abs(gap), 'tangence en ' + id).toBeLessThan(1e-6));
    // Les grandeurs mécaniques ne dépendent pas du point de vue.
    expect(seen.wrap, 'enroulement en ' + id).toBeCloseTo(reference.wrap, 6);
    expect(seen.length, 'longueur développée en ' + id).toBeCloseTo(reference.length, 6);
    expect(seen.distance, 'entraxe en ' + id).toBeCloseTo(reference.distance, 6);
    expect(seen.d).not.toMatch(/NaN|Infinity/);
    drawings.add(seen.d);
  }
  // Et le dessin, lui, change : une courroie vue de biais n'est pas la même
  // image qu'une courroie vue de face.
  expect(drawings.size, 'la courroie se dessine pareil partout').toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('a satellite orbits in its plane, and its arm follows it (§6 de l’audit)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['planetary']);
  await showView(page, 'teeth');
  const select = page.locator('#viewerProjection');

  for (const view of ['unfolded', 'iso', 'front']) {
    await select.selectOption(view);
    const trace = await page.evaluate(() => {
      const renderer = window.__viewer.renderer();
      const entry = renderer.model.stages[0];
      const basis = entry.carrier.basis;
      const planet = entry.wheels.filter(w => w.role === 'planet')[0];
      const centre = [planet.orbitCenterX, planet.orbitCenterY];
      const det = basis.first[0] * basis.second[1] - basis.second[0] * basis.first[1];
      const read = () => Array.from(document.querySelectorAll('.planet-seat')).map(el => {
        const m = el.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/);
        return [Number(m[1]) - centre[0], Number(m[2]) - centre[1]];
      });
      const arms = () => Array.from(document.querySelector('.carrier-arms path').getAttribute('d')
        .matchAll(/L ([-\d.]+) ([-\d.]+)/g)).map(m => [Number(m[1]), Number(m[2])]);
      const frames = [];
      for (let a = 0; a <= 360; a += 15) {
        renderer.setAnimationAngle(a);
        frames.push({ seats: read(), arms: arms() });
      }
      return { frames, basis, det, orbit: planet.orbit };
    });

    const positions = new Set();
    for (const frame of trace.frames) {
      frame.seats.forEach((seat, index) => {
        positions.add(seat.map(v => v.toFixed(2)).join(','));
        // Le bras du porte-satellites finit sur le satellite qu'il porte.
        const arm = frame.arms[index];
        expect(Math.hypot(arm[0] - seat[0], arm[1] - seat[1]), view + ' bras ' + index).toBeLessThan(0.02);
        if (Math.abs(trace.det) < 1e-9) return;
        // Et surtout : ramené dans le PLAN D'ORBITE, le satellite reste à son
        // rayon d'orbite, à tout instant. Une rotation d'écran le ferait sortir
        // de son plan dès que celui-ci n'est plus perpendiculaire au regard.
        const a = (seat[0] * trace.basis.second[1] - seat[1] * trace.basis.second[0]) / trace.det;
        const b = (seat[1] * trace.basis.first[0] - seat[0] * trace.basis.first[1]) / trace.det;
        // Tolérance : les transformations sont écrites au centième de mm.
        expect(Math.hypot(a, b), view + ' satellite ' + index + ' hors de son orbite')
          .toBeCloseTo(trace.orbit, 1);
      });
    }
    // Le satellite bouge réellement : un plan d'orbite juste mais figé ne
    // montrerait rien de plus qu'un dessin statique.
    expect(positions.size, view + ' : les satellites ne bougent pas').toBeGreaterThan(4);
  }
  expect(errors).toEqual([]);
});

test('the dimensioned view draws what it sees, not always a circle (§7 de l’audit)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'worm', 'bevel']);
  await showView(page, 'geometry');
  const select = page.locator('#viewerProjection');

  const shot = () => page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    const shape = selector => {
      const host = svg.querySelector(selector);
      if (!host) return 'absent';
      if (host.querySelector('.profile-body')) return 'profile';
      if (host.querySelector('ellipse')) return 'ellipse';
      if (host.querySelector('circle:not(.phase-dot)')) return 'circle';
      return 'autre';
    };
    return {
      // La roue d'une vis sans fin et la vis ne peuvent pas être vues de face
      // toutes les deux : c'est ce que la vue affirmait en les dessinant
      // toutes deux en cercle.
      wheel: shape('.geometry-stage[data-stage="1"] .role-output'),
      pinion: shape('.geometry-stage[data-stage="0"] .role-input'),
      needles: svg.querySelectorAll('.index-rotor').length,
      phases: svg.querySelectorAll('.phase-mark').length,
      axes: Array.from(svg.querySelectorAll('.shaft-layer line')).map(line =>
        Math.hypot(line.getAttribute('x2') - line.getAttribute('x1'),
          line.getAttribute('y2') - line.getAttribute('y1')))
    };
  });

  const seen = {};
  for (const view of ['unfolded', 'front', 'side', 'iso']) {
    await select.selectOption(view);
    seen[view] = await shot();
    // Aucun axe de longueur nulle : un arbre qui ne se voit pas en bout est un
    // segment, et un arbre vu en bout est une croix — jamais un trait mort.
    seen[view].axes.forEach(length => expect(length, view + ' : axe de longueur nulle').toBeGreaterThan(0.5));
  }
  // Vue dépliée : la vis est vue de côté, donc sa roue est vue par la tranche.
  expect(seen.unfolded.wheel).toBe('profile');
  expect(seen.unfolded.pinion).toBe('circle');
  // De biais, plus un seul cercle : des ellipses, et le repère radial cède la
  // place à un repère de phase.
  expect(seen.iso.wheel).toBe('ellipse');
  expect(seen.iso.pinion).toBe('ellipse');
  expect(seen.iso.needles, 'une aiguille radiale subsiste de biais').toBe(0);
  expect(seen.iso.phases).toBeGreaterThan(0);
  // Et en bout d'arbre d'entrée, c'est le pignon qui se voit de face.
  expect(seen.side.pinion).toBe('circle');

  // L'animation : de biais, le corps ne bascule pas — c'est la phase qui bouge.
  await select.selectOption('iso');
  const motion = await page.evaluate(() => {
    const renderer = window.__viewer.geometry;
    const mark = document.querySelector('#svgContainer .phase-mark');
    const body = document.querySelector('#svgContainer .geometry-member-group.role-input ellipse');
    const read = () => ({ phase: mark.getAttribute('transform'), body: body.getAttribute('transform') });
    renderer.setAnimationAngle(0);
    const start = read();
    renderer.setAnimationAngle(90);
    return { start, quarter: read() };
  });
  expect(motion.quarter.phase).not.toBe(motion.start.phase);
  expect(motion.quarter.body).toBe(motion.start.body);
  expect(errors).toEqual([]);
});

test('every phase mark on the drawing really carries a movement (§8 de l’audit)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['worm']);
  const select = page.locator('#viewerProjection');

  // Une vis porte sa phase dans ses FILETS. Un repère de phase posé en plus
  // restait immobile : une puce sur le dessin que rien n'animait.
  await showView(page, 'teeth');
  await select.selectOption('unfolded');
  const worm = await page.evaluate(() => {
    const renderer = window.__viewer.renderer();
    const host = document.querySelector('#svgContainer .train-wheel[data-role="input"]');
    const read = () => ({
      threads: host.querySelector('.worm-thread-phase').getAttribute('transform'),
      marks: host.querySelectorAll('.phase-mark').length
    });
    renderer.setAnimationAngle(0);
    const start = read();
    renderer.setAnimationAngle(90);
    return { start, quarter: read() };
  });
  expect(worm.start.marks, 'la vis porte un repère de phase que rien ne bouge').toBe(0);
  expect(worm.quarter.threads).not.toBe(worm.start.threads);

  // Vue dans son axe, la vis se voit par le bout : elle tourne, et c'est son
  // repère de bout qui le montre.
  await select.selectOption('side');
  const endOn = await page.evaluate(() => {
    const renderer = window.__viewer.renderer();
    const host = document.querySelector('#svgContainer .train-wheel[data-role="input"]');
    const rotor = host.querySelector('.rotor');
    renderer.setAnimationAngle(0);
    const start = { rotor: rotor.getAttribute('transform'), end: host.querySelectorAll('.worm-end-phase').length };
    renderer.setAnimationAngle(90);
    return { start, quarter: rotor.getAttribute('transform') };
  });
  expect(endOn.start.end, 'pas de repère de bout sur une vis vue en bout').toBeGreaterThan(0);
  expect(endOn.quarter).not.toBe(endOn.start.rotor);

  // Et la vue cotée la dessine par le bout aussi : un cylindre couché y
  // montrerait une longueur que cette vue ne voit pas.
  await showView(page, 'geometry');
  await select.selectOption('side');
  const cotted = await page.evaluate(() => {
    const host = document.querySelector('#svgContainer .geometry-member-group.role-input');
    return { circle: !!host.querySelector('circle.worm-member'), body: host.querySelectorAll('rect').length };
  });
  expect(cotted.circle).toBe(true);
  expect(cotted.body).toBe(0);
  expect(errors).toEqual([]);
});

test('the dimensioned rack slides on its slide, not along the screen (§8 de l’audit)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['rack']);
  await showView(page, 'geometry');

  const trace = await page.evaluate(() => {
    const renderer = window.__viewer.geometry;
    const member = renderer.layout.stages[0].members.filter(m => m.kind === 'rack')[0];
    const slider = document.querySelector('#svgContainer .linear-slider');
    const at = angle => {
      renderer.setAnimationAngle(angle);
      const m = slider.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/);
      const pose = GearKinematicsEngine.pose(renderer.scene.kinematics, angle);
      return { x: Number(m[1]), y: Number(m[2]),
        travel: pose.linear[member.linearId].position };
    };
    return { along: member.slideAlong, frames: [0, 90, 180, 270].map(at) };
  });

  const along = trace.along;
  expect(Math.hypot(along[0], along[1])).toBeCloseTo(1, 6);
  trace.frames.forEach(frame => {
    // La course dessinée est celle de la pose, en millimètres réels…
    expect(Math.hypot(frame.x, frame.y)).toBeCloseTo(Math.abs(frame.travel), 1);
    // …et elle suit la glissière : aucune composante en travers.
    const across = frame.x * -along[1] + frame.y * along[0];
    expect(Math.abs(across), 'la crémaillère glisse en travers de sa glissière').toBeLessThan(0.02);
  });
  // Elle bouge réellement.
  expect(new Set(trace.frames.map(f => f.x.toFixed(2) + ',' + f.y.toFixed(2))).size).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('the force arrows come from the mesh, not from a fixed rosette (§9 de l’audit)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['helical']);
  await showView(page, 'teeth');
  const select = page.locator('#viewerProjection');

  const shot = () => page.evaluate(() => {
    const entry = window.__viewer.renderer().model.stages[0];
    const host = document.querySelector('#svgContainer .force-overlay');
    const read = label => {
      const arrow = host.querySelector('.force-' + label);
      if (!arrow) return null;
      if (arrow.classList.contains('force-end-on')) return { endOn: true };
      const line = arrow.querySelector('line');
      return { endOn: false, x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) };
    };
    return { anchor: [Number(host.dataset.anchorX), Number(host.dataset.anchorY)],
      centres: entry.wheels.map(w => [w.cx, w.cy]), pitch: entry.wheels[0].pitchD,
      ft: read('ft'), fr: read('fr'), fa: read('fa') };
  });

  const angles = new Set();
  for (const view of ['unfolded', 'front', 'top', 'side', 'iso']) {
    await select.selectOption(view);
    const seen = await shot();
    const [a, b] = seen.centres;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const span = Math.hypot(dx, dy);
    if (span > 1e-6) {
      // Le point d'application est le point primitif, sur la ligne des centres.
      const reach = Math.hypot(seen.anchor[0] - a[0], seen.anchor[1] - a[1]);
      expect(reach, view + ' : point d’application').toBeCloseTo(Math.min(seen.pitch / 2, span), 3);
      // Et Ft traverse cette ligne à angle droit — dans les vues qui montrent
      // le plan d'engrènement sans le déformer.
      if (seen.ft && !seen.ft.endOn && (view === 'unfolded' || view === 'front' || view === 'side')) {
        const along = [dx / span, dy / span];
        const cos = (seen.ft.x * along[0] + seen.ft.y * along[1]) / Math.hypot(seen.ft.x, seen.ft.y);
        expect(Math.abs(cos), view + ' : Ft n’est pas perpendiculaire à la ligne des centres').toBeLessThan(1e-6);
      }
    }
    if (seen.ft && !seen.ft.endOn) angles.add(Math.atan2(seen.ft.y, seen.ft.x).toFixed(4));
  }
  // Une rosace fixe donnerait le même angle partout.
  expect(angles.size, 'les flèches ne bougent pas d’une vue à l’autre').toBeGreaterThan(1);

  // Un effort vu dans sa propre direction n'est pas une flèche de longueur
  // nulle : c'est ⊙ ou ⊗, la convention du dessin technique.
  const endOn = await page.evaluate(() => {
    const found = [];
    for (const view of ['unfolded', 'front', 'top', 'side', 'iso']) {
      window.__viewer.setProjection(view);
      const arrow = document.querySelector('#svgContainer .force-overlay .force-end-on');
      if (arrow) found.push({ view, symbols: arrow.querySelectorAll('circle').length });
    }
    return found;
  });
  expect(endOn.length, 'aucune vue ne regarde un effort dans son axe').toBeGreaterThan(0);
  endOn.forEach(entry => expect(entry.symbols, entry.view).toBeGreaterThan(0));
  expect(errors).toEqual([]);
});

test('the drawing is painted from the back, and can be seen from the other side (§10)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'spur', 'bevel']);
  await showView(page, 'teeth');
  const select = page.locator('#viewerProjection');
  const flip = page.locator('#viewerOpposite');

  // Peinture du fond vers l'avant : les positions 3D étaient justes, mais le
  // SVG était peint dans l'ordre des étages — de biais, une roue du fond
  // pouvait recouvrir celle qui est devant elle.
  await select.selectOption('iso');
  const painted = await page.evaluate(() => {
    const renderer = window.__viewer.renderer();
    const depthOf = element => {
      const record = renderer._wheels.filter(w => w.group === element)[0];
      return record ? record.wheel.depth : null;
    };
    const stages = Array.from(document.querySelectorAll('#svgContainer .train-stage'));
    return stages.map(stage => ({
      wheels: Array.from(stage.querySelectorAll(':scope > .train-wheel')).map(depthOf),
      nearest: Math.min.apply(null, Array.from(stage.querySelectorAll(':scope > .train-wheel')).map(depthOf))
    }));
  });
  painted.forEach((stage, index) => {
    stage.wheels.forEach((depth, i) => {
      if (i === 0) return;
      expect(depth, 'étage ' + index + ' : roue peinte devant une plus proche')
        .toBeLessThanOrEqual(stage.wheels[i - 1] + 1e-9);
    });
  });
  // Les étages, eux, gardent leur ordre : ils portent leurs alertes et leurs
  // libellés, et les réordonner enterrerait le badge d'un étage sous la
  // denture du voisin.
  expect(painted.length).toBeGreaterThan(1);

  // L'autre bord : le même mécanisme, regardé de l'autre côté.
  const drawingOf = () => page.evaluate(() =>
    window.__viewer.renderer().model.wheels.map(w => w.cx.toFixed(3) + ',' + w.cy.toFixed(3)).join('|'));
  const before = await drawingOf();
  await expect(flip).toHaveAttribute('aria-pressed', 'false');
  await flip.click();
  await expect(flip).toHaveAttribute('aria-pressed', 'true');
  // La liste montre toujours la vue de référence : « Iso » et « Iso opposée »
  // sont la même vue, prise des deux bords.
  await expect(select).toHaveValue('iso');
  const after = await drawingOf();
  expect(after).not.toBe(before);
  // Gauche et droite s'échangent, le haut ne bouge pas.
  const mirrored = before.split('|').map((seat, index) => {
    const [x, y] = seat.split(',').map(Number);
    const [ox, oy] = after.split('|')[index].split(',').map(Number);
    return Math.abs(x + ox) < 1e-3 && Math.abs(y - oy) < 1e-3;
  });
  expect(mirrored.every(Boolean), 'le dessin ne s’est pas retourné : ' + after).toBe(true);

  // Et l'on revient d'où l'on vient.
  await flip.click();
  await expect(flip).toHaveAttribute('aria-pressed', 'false');
  expect(await drawingOf()).toBe(before);

  // La vue dépliée n'est pas une projection : elle n'a pas de bord.
  await select.selectOption('unfolded');
  await expect(flip).toBeDisabled();
  expect(errors).toEqual([]);
});

test('the animation cadence follows the mode, the poses never do', async ({ page }) => {
  await mount(page, ['spur']);
  await showView(page, 'teeth');
  const cadence = await page.evaluate(() => {
    const animation = window.__viewer.renderer().animation;
    const pedagogical = animation.setMode('pedagogical').degreesPerSecond();
    const relative = animation.setMode('relative').degreesPerSecond();
    animation.setMode('pedagogical');
    return { pedagogical, relative, inputRpm: animation.inputRpm };
  });
  expect(cadence.inputRpm).toBe(1500);
  expect(cadence.pedagogical).toBeGreaterThan(0);
  expect(cadence.relative).toBeGreaterThan(0);
  // Le bouton de la barre bascule réellement le mode partagé.
  await page.locator('#viewerAnimationMenu > summary').click();
  await page.locator('#viewerMode').click();
  await expect(page.locator('#viewerMode')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__viewer.renderer().animation.mode)).toBe('relative');
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
  // La roue d'ENTRÉE, désignée par son membre : les roues sont peintes du fond
  // vers l'avant, et « la première du document » n'est plus la première du
  // mécanisme — c'était même une roue menée, qui tourne trois fois moins vite.
  const teeth = await page.locator('.train-wheel[data-member="s0-input"] .rotor').getAttribute('transform');
  // Même horloge, donc même amplitude. Le signe, lui, dit de quel bout on
  // regarde l'axe, et n'a pas à être le même dans deux vues différentes.
  expect(teeth).toMatch(/^rotate\(-?90/);
  await showView(page, 'geometry');
  expect(await page.locator('.index-rotor[data-member="s0-input"]').getAttribute('transform')).toMatch(/rotate\(-?90/);
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
  // §18 : les flux physiques sont groupés — mouvement, puissance, efforts —
  // avant les repères de lecture. L'ordre suit la question posée, plus la
  // donnée tracée.
  expect(await offered()).toEqual(['rpm', 'powerFlow', 'ratios', 'spatialAxes', 'labels']);
  // Le menu est replié : on vérifie l'attribut, comme `offered()` juste au-dessus.
  await expect(page.locator('#viewerDisplayMenu .display-menu-group')).not.toHaveAttribute('hidden', '');

  await showView(page, 'teeth');
  expect(await offered()).toEqual(['autoDetails', 'pitchCircles', 'lineOfAction', 'forces', 'labels']);
  // Une option masquée dans une vue reste mémorisée pour son retour.
  await expect(page.locator('#svgContainer')).toHaveClass(/hide-dimensions/);
});

test('the reading tier follows the zoom, and thins the annotations (§2)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'helical']);
  await showView(page, 'teeth');
  const container = page.locator('#svgContainer');

  await expect(container).toHaveAttribute('data-zoom-tier', 'overview');
  // À l'ensemble, les cotes et les dentures chiffrées se taisent : à cette
  // échelle elles se superposent au dessin sans être lisibles.
  await expect(page.locator('#svgContainer .tooth-count').first()).toBeHidden();
  await expect(page.locator('#svgContainer .train-dim').first()).toBeHidden();

  await page.evaluate(() => window.__viewer.renderer().viewport.zoomAt(0, 0, 6));
  await expect(container).toHaveAttribute('data-zoom-tier', 'close');
  await expect(page.locator('#svgContainer .tooth-count').first()).toBeVisible();
  await expect(page.locator('#svgContainer .train-dim').first()).toBeVisible();
  // Les cercles de construction restent réservés au palier technique.
  await expect(container).not.toHaveClass(/zoom-technical/);

  await page.evaluate(() => window.__viewer.renderer().viewport.zoomAt(0, 0, 4));
  await expect(container).toHaveAttribute('data-zoom-tier', 'technical');

  await page.evaluate(() => window.__viewer.renderer().resetView());
  await expect(container).toHaveAttribute('data-zoom-tier', 'overview');

  // Le palier vaut dans les trois vues, malgré des unités différentes.
  for (const view of ['geometry', 'kinematic']) {
    await showView(page, view);
    await expect(container).toHaveAttribute('data-zoom-tier', 'overview');
    await page.evaluate(() => window.__viewer.renderer().viewport.zoomAt(0, 0, 6));
    await expect(container).toHaveAttribute('data-zoom-tier', 'close');
  }
  expect(errors).toEqual([]);
});

test('four presets answer four questions, and a single case leaves them (§3)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur']);
  const hidden = () => page.evaluate(() => Array.from(document.getElementById('svgContainer').classList)
    .filter(name => name.startsWith('hide-')).sort());
  const pressed = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-preset]'))
    .filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.preset));

  const states = {};
  for (const id of ['simple', 'motion', 'sizing', 'mechanical']) {
    await page.locator(`[data-preset="${id}"]`).click();
    expect(await pressed(), id).toEqual([id]);
    states[id] = await hidden();
  }
  // Quatre intentions distinctes : si deux préréglages montraient la même
  // chose, l'un des deux ne servirait à rien.
  const signatures = Object.values(states).map(list => list.join('|'));
  expect(new Set(signatures).size).toBe(4);
  expect(states.mechanical).not.toContain('hide-line-of-action');
  expect(states.sizing).toContain('hide-forces');
  expect(states.motion).not.toContain('hide-rpm');
  expect(states.sizing).not.toContain('hide-dimensions');

  // Chaque préréglage donne l'état COMPLET, pas seulement ce qu'il ajoute :
  // « Simple » demandé après « Mécanique » ne doit pas laisser traîner la ligne
  // d'action ni les efforts. L'ordre compte, d'où cette seconde demande —
  // vérifier « Simple » depuis l'état par défaut ne prouverait rien.
  await page.locator('[data-preset="mechanical"]').click();
  await page.locator('[data-preset="simple"]').click();
  expect(await hidden(), 'Simple après Mécanique doit tout reprendre').toEqual(states.simple);
  expect(states.simple).toContain('hide-line-of-action');
  expect(states.simple).toContain('hide-forces');

  // Les cases du menu détaillé décrivent le préréglage actif…
  await page.locator('[data-preset="sizing"]').click();
  await expect(page.locator('#viewerDisplayMenu [data-overlay="dimensions"]')).toBeChecked();
  await expect(page.locator('#viewerDisplayMenu [data-overlay="forces"]')).not.toBeChecked();
  // …et toucher une case sort du préréglage, plutôt que de le décrire à faux.
  await page.evaluate(() => window.__viewer.setOverlay('forces', true));
  expect(await pressed()).toEqual([]);
  await expect(page.locator('#svgContainer')).not.toHaveClass(/hide-forces/);
  expect(errors).toEqual([]);
});

test('hovering a wheel reads it at once, and the export keeps the titles (§4)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['planetary']);
  await showView(page, 'teeth');

  // Les `<title>` sont déplacés dans data-hud : l'infobulle native ne peut plus
  // se superposer au panneau une seconde plus tard.
  const absorbed = await page.evaluate(() => ({
    titles: document.querySelectorAll('#svgContainer svg title').length,
    hud: document.querySelectorAll('#svgContainer [data-hud]').length,
    labelled: document.querySelectorAll('#svgContainer [data-hud][aria-label]').length
  }));
  expect(absorbed.hud).toBeGreaterThan(2);
  expect(absorbed.titles).toBe(0);
  expect(absorbed.labelled, 'le nom accessible ne doit pas être perdu').toBe(absorbed.hud);

  const hud = page.locator('#viewerHud');
  await expect(hud).toBeHidden();
  await page.locator('#svgContainer [data-hud]').first().hover();
  await expect(hud).toBeVisible();
  // Le HUD présente ce que le renderer écrit : titre puis grandeurs.
  await expect(hud.locator('.hud-title')).toHaveCount(1);
  expect(await hud.locator('.hud-line').count()).toBeGreaterThan(0);
  const shown = (await hud.locator('.hud-title').textContent()).trim();
  expect(shown.length).toBeGreaterThan(0);
  expect(shown).not.toMatch(/NaN|undefined/);

  await page.mouse.move(2, 2);
  await expect(hud).toBeHidden();

  // Le panneau survit à un nouveau rendu — les renderers vident le conteneur.
  await showView(page, 'geometry');
  await expect(page.locator('#viewerHud')).toHaveCount(1);
  await page.locator('#svgContainer [data-hud]').first().hover();
  await expect(page.locator('#viewerHud')).toBeVisible();

  // Hors de l'application, un SVG exporté doit rester lisible : les `<title>`
  // sont reconstruits, et data-hud disparaît.
  const exportedGeometry = await page.evaluate(() => window.__viewer.renderer().exportSVG());
  expect((exportedGeometry.match(/<title>/g) || []).length).toBeGreaterThan(2);
  expect(exportedGeometry).not.toContain('data-hud');
  expect(errors).toEqual([]);
});

test('no member of the Geometry view stays mute, and no decoration steals the hover (§4)', async ({ page }) => {
  const errors = watchErrors(page);
  // Une vis et un porte-satellites n'ont pas de cercle primitif : le titre posé
  // sur le cercle les laissait muets, et les annotations dessinées par-dessus
  // les roues interceptaient le survol.
  await mount(page, ['planetary', 'worm', 'bevel']);
  await showView(page, 'geometry');

  const mute = await page.evaluate(() => Array.from(document.querySelectorAll('#svgContainer .geometry-member-group'))
    .filter(group => !(group.dataset.hud || '').trim())
    .map(group => group.dataset.role));
  expect(mute, 'tout membre dessiné doit pouvoir se lire').toEqual([]);

  const texts = await page.evaluate(() => Array.from(document.querySelectorAll('#svgContainer .geometry-member-group'))
    .map(group => group.dataset.hud));
  // Chaque membre se nomme, et aucun ne montre de trou de calcul.
  texts.forEach(text => {
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(text.split('\n')[0].length).toBeGreaterThan(2);
  });
  expect(texts.join('|')).toContain('Porte-satellites');
  expect(texts.join('|')).toContain('Vis');

  // Le repère d'indexation est dessiné SUR la roue et ne porte aucune grandeur :
  // le pointeur doit le traverser plutôt que refermer le panneau.
  const throughDecoration = await page.evaluate(() => {
    const mark = document.querySelector('#svgContainer .index-mark');
    if (!mark) return 'aucun repère dessiné';
    const box = mark.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    document.getElementById('svgContainer').dispatchEvent(
      new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    const hit = document.elementFromPoint(x, y);
    const panel = document.getElementById('viewerHud');
    return { onMark: !!(hit && hit.closest('.index-rotor')), hidden: panel.hidden,
      read: (panel.textContent || '').slice(0, 30) };
  });
  expect(throughDecoration.onMark, 'le point choisi doit bien tomber sur le repère').toBe(true);
  expect(throughDecoration.hidden, 'survoler un repère doit lire la roue dessous').toBe(false);
  expect(throughDecoration.read.length).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('the three framings do what they promise, and say so when they cannot (§7)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'helical', 'worm']);
  await showView(page, 'geometry');
  const width = () => page.evaluate(() => Number(document.querySelector('#svgContainer svg')
    .getAttribute('viewBox').split(/\s+/)[2]));

  const whole = await width();

  // « Cadrer l'étage » ne promet rien tant qu'aucun étage n'est choisi.
  const focus = page.locator('#viewerFocus');
  await expect(focus).toBeDisabled();
  await expect(focus).toHaveAttribute('title', /Sélectionnez/);

  await page.locator('#svgContainer .geometry-layer .geometry-stage[data-stage="1"]').click();
  await expect(focus).toBeEnabled();
  await expect(focus).toHaveAttribute('title', /étage 2/);
  await focus.click();
  const framed = await width();
  expect(framed, 'cadrer un étage rapproche').toBeLessThan(whole);

  await page.locator('#viewerReset').click();
  expect(await width()).toBeCloseTo(whole, 1);

  // 1:1 : un millimètre dessiné pour un millimètre d'écran, dans les vues
  // métriques seulement.
  const actual = page.locator('#viewerActualSize');
  await expect(actual).toBeEnabled();
  await actual.click();
  const real = await page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    const drawn = Number(svg.getAttribute('viewBox').split(/\s+/)[2]);
    return { drawn, px: svg.getBoundingClientRect().width };
  });
  expect(real.px / real.drawn).toBeCloseTo(96 / 25.4, 1);

  // La Cinématique est symbolique : le bouton s'y désactive plutôt que de
  // prétendre une échelle que le schéma n'a pas.
  await showView(page, 'kinematic');
  await expect(actual).toBeDisabled();
  await expect(actual).toHaveAttribute('title', /symbolique/);
  await showView(page, 'teeth');
  await expect(actual).toBeEnabled();

  expect(errors).toEqual([]);
});

test('a double-click frames the stage it points at, in all three views (§7)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'helical', 'planetary']);
  // Le même étage apparaît dans plusieurs couches de la vue Géométrie (dessin,
  // cotes, alertes) : on visait ici la pièce, pas ses annotations.
  const selector = { teeth: '.train-stage', geometry: '.geometry-layer .geometry-stage',
    kinematic: '.kinematic-stage' };

  // Un point du dessin qui répond effectivement l'étage visé. Viser le centre
  // de sa boîte englobante ne suffit pas : celle-ci englobe aussi son
  // étiquette, posée en marge du dessin entier, et un trait ne se clique pas
  // en son milieu.
  const aim = sel => page.evaluate(selector => {
    const stage = document.querySelector(`#svgContainer ${selector}[data-stage="2"]`);
    for (const part of stage.querySelectorAll('path, circle, rect, polygon, ellipse')) {
      const box = part.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && stage.contains(hit)) return { x, y };
    }
    return null;
  }, sel);

  for (const view of ['teeth', 'geometry', 'kinematic']) {
    await showView(page, view);
    const width = () => page.evaluate(() => Number(document.querySelector('#svgContainer svg')
      .getAttribute('viewBox').split(/\s+/)[2]));
    // Le premier clic ouvre l'inspecteur, donc redispose la page : on le donne
    // AVANT de viser, sans quoi le second clic d'un double-clic tomberait à
    // côté et le navigateur enverrait son `dblclick` à un ancêtre commun.
    const first = await aim(selector[view]);
    expect(first, view + ' : l’étage doit être cliquable').not.toBeNull();
    await page.mouse.click(first.x, first.y);
    const whole = await width();
    const spot = await aim(selector[view]);
    expect(spot, view + ' : l’étage doit rester cliquable').not.toBeNull();
    await page.mouse.dblclick(spot.x, spot.y);
    expect(await width(), view).toBeLessThan(whole);
    // Le double-clic sélectionne aussi : cadrer sans sélectionner laisserait
    // l'inspecteur parler d'un autre étage que celui qu'on regarde.
    await expect(page.locator(`#svgContainer ${selector[view]}[data-stage="2"]`)).toHaveClass(/selected/);
    await page.locator('#viewerReset').click();
  }
  expect(errors).toEqual([]);
});

test('the inspector is docked beside the drawing, never over it (§6)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, ['spur', 'helical', 'planetary']);
  await showView(page, 'teeth');

  const layout = () => page.evaluate(() => {
    const drawing = document.getElementById('svgContainer').getBoundingClientRect();
    const panel = document.getElementById('stageInspector');
    const box = panel.getBoundingClientRect();
    return { hidden: panel.hidden, host: panel.parentElement.className,
      drawingWidth: Math.round(drawing.width), panelWidth: Math.round(box.width),
      // Un panneau docké commence là où le dessin s'arrête ; posé dessus, il
      // empiéterait.
      overlaps: !panel.hidden && box.x < drawing.x + drawing.width - 1 };
  });

  const closed = await layout();
  expect(closed.hidden).toBe(true);
  expect(closed.host, 'l’inspecteur vit à côté du dessin, pas dedans').toContain('viewer-stage');

  await page.locator('#svgContainer .train-stage[data-stage="1"] .train-wheel').first().click();
  await expect(page.locator('#stageInspector')).toBeVisible();
  const open = await layout();
  expect(open.overlaps, 'l’inspecteur ne doit rien recouvrir').toBe(false);
  expect(open.panelWidth).toBeGreaterThan(150);
  expect(open.drawingWidth, 'le dessin rétrécit au lieu d’être caché')
    .toBeLessThan(closed.drawingWidth);

  // Le dessin reste entièrement cliquable pendant que l'inspecteur est ouvert :
  // c'est ce qui manquait quand la carte flottait par-dessus.
  const reachable = await page.evaluate(() => Array.from(document.querySelectorAll('#svgContainer .train-stage'))
    .map(stage => {
      const b = stage.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + 4, b.y + b.height / 2);
      return !(hit && hit.closest('#stageInspector'));
    }));
  expect(reachable.every(Boolean), 'aucun étage masqué par l’inspecteur').toBe(true);

  // Il survit à un changement de vue et à un nouveau rendu — les renderers
  // vident le conteneur SVG, mais l'inspecteur n'y est plus.
  await showView(page, 'geometry');
  await expect(page.locator('#stageInspector')).toBeVisible();
  await expect(page.locator('#stageInspector')).toHaveCount(1);

  // Refermé, il rend sa colonne au dessin.
  await page.locator('#stageInspector button[aria-label="Fermer"]').click();
  expect((await layout()).drawingWidth).toBe(closed.drawingWidth);
  // Et « Cadrer l'étage » redevient une promesse qu'on ne peut plus tenir.
  await expect(page.locator('#viewerFocus')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('a filter that excludes everything leaves no solution on screen', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await search(page);
  await page.locator('.solution-card').first().click();
  await page.locator('#svgContainer svg').waitFor({ timeout: 20000 });
  await page.locator('#svgContainer .train-stage .train-wheel').first().click();
  await expect(page.locator('#stageInspector')).toBeVisible();

  const shown = () => page.evaluate(() => ({
    svg: document.querySelectorAll('#svgContainer svg').length,
    identity: !document.getElementById('solutionIdentity').hidden,
    stageNav: !document.getElementById('stageNav').hidden,
    inspector: !document.getElementById('stageInspector').hidden,
    fidelity: !document.getElementById('viewerFidelity').hidden,
    // Régions `aria-live` : vidées, pas seulement masquées.
    cardText: (document.getElementById('solutionCard').textContent || '').trim().length,
    analysisText: (document.getElementById('mechanicalPanel').textContent || '').trim().length
  }));
  const before = await shown();
  expect(before.svg).toBe(1);
  expect(before.identity).toBe(true);
  expect(before.cardText).toBeGreaterThan(0);

  // Un diamètre d'un millimètre : aucune solution ne peut passer. Les filtres
  // passent par le menu, comme pour un utilisateur.
  await page.locator('#addFilterBtn').click();
  await page.locator('#refineMenu [data-field="refine_diameter_max"]').click();
  await page.locator('.constraint-chip[data-constraint="refine_diameter_max"] .constraint-chip-input').fill('1');
  await expect(page.locator('.solution-card')).toHaveCount(0);
  await expect(page.locator('#svgContainer svg')).toHaveCount(0);

  const after = await shown();
  expect(after, 'plus aucune trace de la solution disparue').toEqual({
    svg: 0, identity: false, stageNav: false, inspector: false, fidelity: false,
    cardText: 0, analysisText: 0
  });

  // Et le filtre levé la ramène : effacer n'est pas casser.
  await page.locator('#refineResetBtn').click();
  await expect(page.locator('.solution-card')).not.toHaveCount(0);
  await expect(page.locator('#svgContainer svg')).toHaveCount(1);
  await expect(page.locator('#solutionIdentity')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the card never ticks what it has not checked (§ conformité)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await search(page);
  await page.locator('.solution-card').first().click();
  await expect(page.locator('#solutionCard')).toBeVisible();

  const badges = () => page.evaluate(() => Array.from(document.querySelectorAll('#solutionCard .status-badge'))
    .map(b => ({ key: b.dataset.compliance || null, state: (b.className.match(/state-(\w+)/) || [])[1],
      text: b.textContent.trim(), title: b.title })));
  const list = await badges();
  expect(list.length).toBeGreaterThan(3);

  list.forEach(badge => {
    // Une coche verte suppose un contrôle : celles qui portent « non évalué »
    // ou « aucune limite » doivent être sourdes.
    if (/non évalué|non vérifié|Aucune/i.test(badge.text + ' ' + badge.title)) {
      expect(badge.state, badge.text).toBe('unknown');
      expect(badge.text.startsWith('✓'), badge.text).toBe(false);
    }
    // Aucun code interne à l'écran.
    expect(badge.text).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
    expect(badge.text).not.toMatch(/NaN|undefined|null/);
  });

  // Un facteur de sécurité sous sa limite ne peut jamais porter de coche —
  // c'était exactement « ✓ SF 0.82 ». On force ici une chaîne sous-dimensionnée
  // plutôt que d'espérer que le solveur en renvoie une : sans cela le test
  // passe sans avoir rien vérifié.
  const weak = await page.evaluate(() => {
    const under = GearEngineering.analyzeSolution([
      { type: 'spur', input: { teeth: 14 }, output: { teeth: 42 },
        parameters: { module: 0.6, pressureAngle: 20, faceWidth: 4 } }
    ], 3, { inputSpeedRpm: 3000, inputTorqueNm: 120 });
    GearApp._workbench && null;
    GearApp.eventBus.emit('solution:selected', { index: 0, solution: under });
    const limits = GearSolutionCompliance.LIMITS;
    return { sf: under.mechanical[0].bending.safetyFactor, limit: limits.bendingSafety };
  });
  expect(weak.sf, 'la chaîne de contrôle doit être réellement sous-dimensionnée').toBeLessThan(weak.limit);

  const safety = await page.evaluate(() => {
    const limits = GearSolutionCompliance.LIMITS;
    return Array.from(document.querySelectorAll('#solutionCard .status-badge'))
      .filter(b => /SF |SH /.test(b.textContent))
      .map(b => ({ text: b.textContent.trim(),
        value: parseFloat((b.textContent.match(/(\d+\.\d+)/) || [])[1]),
        ticked: b.textContent.trim().startsWith('✓'),
        state: (b.className.match(/state-(\w+)/) || [])[1],
        limit: /SF /.test(b.textContent) ? limits.bendingSafety : limits.contactSafety }));
  });
  const numeric = safety.filter(entry => Number.isFinite(entry.value));
  expect(numeric.length, 'la carte doit afficher les facteurs chiffrés').toBeGreaterThan(0);
  numeric.forEach(entry => {
    if (entry.value < entry.limit) {
      expect(entry.ticked, entry.text + ' est sous la limite et ne peut pas être coché').toBe(false);
      expect(entry.state, entry.text).toBe('danger');
    }
  });
  expect(errors).toEqual([]);
});

test('the drawing and the analysis report exactly the same warnings', async ({ page }) => {
  const errors = watchErrors(page);
  // Un pignon de 12 dents au second étage : la sous-coupe concerne CET étage.
  await mount(page, ['spur', 'spur']);
  await page.evaluate(() => {
    const stages = [
      { type: 'spur', input: { teeth: 24 }, output: { teeth: 48 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } },
      { type: 'spur', input: { teeth: 12 }, output: { teeth: 48 }, parameters: { module: 1, pressureAngle: 20, faceWidth: 6 } }
    ];
    window.__solution = GearEngineering.analyzeSolution(stages, 8, { inputSpeedRpm: 3000, inputTorqueNm: 40 });
    window.__viewer.render(window.__solution);
  });
  await showView(page, 'teeth');

  const drawn = await page.evaluate(() => Array.from(document.querySelectorAll('#svgContainer .mechanical-warning'))
    .map(node => ({ code: node.dataset.warning, stage: Number(node.dataset.stage) })));
  const emitted = await page.evaluate(() => window.__solution.warnings
    .map(w => ({ code: w.code, stage: w.stageIndex })));

  expect(drawn.length, 'le dessin doit porter des alertes').toBeGreaterThan(0);
  // Tout badge dessiné correspond à une alerte émise par le moteur, sur son
  // étage. Le viewer les recalculait auparavant, avec sa propre copie des seuils.
  drawn.forEach(badge => {
    expect(emitted, JSON.stringify(badge)).toContainEqual({ code: badge.code, stage: badge.stage });
  });
  // Et une alerte de chaîne ne se pose sur aucun étage.
  const chainWide = emitted.filter(w => w.stage === null).map(w => w.code);
  chainWide.forEach(code => expect(drawn.map(b => b.code)).not.toContain(code));
  expect(errors).toEqual([]);
});

test('the inspector says what each family actually needs, forces included', async ({ page }) => {
  const errors = watchErrors(page);
  const families = ['spur', 'helical', 'internal', 'bevel', 'belt', 'chain'];
  await mount(page, families);

  const card = async index => page.evaluate(i => {
    window.__viewer.inspector.show(i);
    const host = document.getElementById('stageInspector');
    return { groups: Array.from(host.querySelectorAll('.inspector-group')).map(h => h.textContent),
      rows: Array.from(host.querySelectorAll('.inspector-grid div')).map(d => d.textContent) };
  }, index);

  // Chacune de ces grandeurs est calculée depuis toujours ; aucune n'était
  // affichée. Ce sont pourtant celles qui font choisir la famille.
  const expected = {
    spur: [/Angle de pression/, /Rapport de conduite/],
    helical: [/Angle d’hélice/, /Effort axial induit/],
    internal: [/intérieure/],
    bevel: [/Angle des arbres/, /Cône menant/, /Distance conique/],
    belt: [/Profil/, /Longueur/, /Enroulement/],
    chain: [/Maillons/, /Entraxe corrigé/]
  };
  for (let i = 0; i < families.length; i++) {
    const family = families[i];
    const shown = await card(i);
    const text = shown.rows.join(' | ');
    expected[family].forEach(pattern => expect(text, family).toMatch(pattern));
    expect(text, family).not.toMatch(/NaN|undefined/);
  }

  // Les efforts chiffrés, là où le moteur les calcule. Un flexible n'en fournit
  // pas : le bloc s'absente plutôt que d'afficher trois tirets.
  const gear = await card(1);          // hélicoïdal
  expect(gear.groups).toContain('Efforts');
  const forces = gear.rows.filter(row => /^(Tangentiel|Radial|Axial)/.test(row));
  expect(forces.length).toBe(3);
  forces.forEach(row => expect(row).toMatch(/\d+ N$/));
  // Une hélice pousse le long de l'arbre : cette valeur doit être non nulle.
  const axial = Number((forces.find(r => r.startsWith('Axial')).match(/(\d+) N/) || [])[1]);
  expect(axial).toBeGreaterThan(0);

  const flexible = await card(4);      // courroie
  expect(flexible.groups).not.toContain('Efforts');
  expect(errors).toEqual([]);
});

test('each view keeps its own framing across view switches (§8)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'helical', 'planetary']);
  const scale = () => page.evaluate(() => window.__viewer.renderer().viewport.getState().scale);

  await showView(page, 'geometry');
  await page.evaluate(() => window.__viewer.renderer().viewport.zoomAt(0, 0, 5));
  const zoomed = await scale();
  expect(zoomed).toBeGreaterThan(4);

  // Une autre vue repart de son propre cadrage : les trois n'ont ni la même
  // échelle ni la même disposition, partager un viewBox n'aurait aucun sens.
  await showView(page, 'kinematic');
  expect(await scale()).toBeCloseTo(1, 1);

  // Et l'on retrouve le travail de cadrage en revenant.
  await showView(page, 'geometry');
  expect(await scale()).toBeCloseTo(zoomed, 1);

  // Une AUTRE solution invalide les cadrages : un viewBox n'a de sens que pour
  // le dessin qui l'a produit.
  await page.evaluate(() => {
    const other = GearEngineering.analyzeSolution([
      { type: 'spur', input: { teeth: 11 }, output: { teeth: 88 }, parameters: { module: 3, pressureAngle: 20, faceWidth: 30 } }
    ], 8, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
    window.__viewer.render(other);
  });
  expect(await scale()).toBeCloseTo(1, 1);
  expect(errors).toEqual([]);
});

test('a preset takes you to the view that answers its question (§8)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'helical']);
  await showView(page, 'teeth');

  const state = () => page.evaluate(() => ({ view: window.__viewer.currentView,
    pressed: Array.from(document.querySelectorAll('[data-preset][aria-pressed="true"]')).map(b => b.dataset.preset) }));

  // Demander « Dimensionnement » en restant sur un schéma explicitement
  // symbolique donnait des cotes dans la seule vue qui ne peut pas les porter.
  await page.locator('[data-preset="sizing"]').click();
  expect(await state()).toEqual({ view: 'geometry', pressed: ['sizing'] });
  await expect(page.locator('#svgContainer')).not.toHaveClass(/hide-dimensions/);

  await page.locator('[data-preset="motion"]').click();
  expect(await state()).toEqual({ view: 'kinematic', pressed: ['motion'] });

  await page.locator('[data-preset="mechanical"]').click();
  expect(await state()).toEqual({ view: 'teeth', pressed: ['mechanical'] });
  await expect(page.locator('#svgContainer')).not.toHaveClass(/hide-forces/);

  // « Simple » est une question qu'on se pose dans n'importe quelle vue : il
  // n'en impose aucune.
  await showView(page, 'geometry');
  await page.locator('[data-preset="simple"]').click();
  expect(await state()).toEqual({ view: 'geometry', pressed: ['simple'] });
  expect(errors).toEqual([]);
});

test('a warning badge leads to its cause, and every screen states it identically (§12)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'spur']);
  await page.evaluate(() => {
    // Second étage nettement sous-dimensionné : l'alerte porte sur LUI.
    const stages = [
      { type: 'spur', input: { teeth: 24 }, output: { teeth: 48 }, parameters: { module: 3, pressureAngle: 20, faceWidth: 25 } },
      { type: 'spur', input: { teeth: 12 }, output: { teeth: 48 }, parameters: { module: 1, pressureAngle: 20, faceWidth: 5 } }
    ];
    window.__solution = GearEngineering.analyzeSolution(stages, 8, { inputSpeedRpm: 3000, inputTorqueNm: 60 });
    window.__viewer.render(window.__solution);
  });
  await showView(page, 'teeth');

  const badge = page.locator('#svgContainer .mechanical-warning[data-stage="1"]').first();
  await expect(badge).toBeAttached();
  await expect(badge).toHaveAttribute('role', 'button');

  // Cliquer désigne l'étage : l'inspecteur docké s'ouvre sur lui, avec la cause.
  await badge.click();
  const inspector = page.locator('#stageInspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('2 ·');
  await expect(inspector.locator('.inspector-group', { hasText: 'Avertissements' })).toHaveCount(1);

  // Le même défaut, dit de la même façon dans le dessin, la fiche et l'analyse.
  const said = await page.evaluate(() => {
    const engine = window.__solution.warnings.filter(w => w.stageIndex === 1);
    const badges = Array.from(document.querySelectorAll('#svgContainer .mechanical-warning[data-stage="1"]'))
      .map(node => node.dataset.warning);
    const panel = Array.from(document.querySelectorAll('#stageInspector .inspector-grid div'))
      .map(row => row.textContent);
    return { codes: engine.map(w => w.code), messages: engine.map(w => w.message), badges: badges, panel: panel };
  });
  expect(said.codes.length).toBeGreaterThan(0);
  // Le dessin ne montre que des alertes réellement émises pour cet étage…
  said.badges.forEach(code => expect(said.codes).toContain(code));
  // …et l'inspecteur reprend leur libellé, sans jamais montrer le code interne.
  const text = said.panel.join(' | ');
  said.messages.forEach(message => expect(text).toContain(message));
  said.codes.forEach(code => expect(text).not.toContain(code));
  expect(errors).toEqual([]);
});

test('the docked inspector hides nothing on a narrow screen', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 640, height: 900 });
  await mount(page, ['spur', 'helical']);
  // Sous 900 px, l'espace de travail montre un volet à la fois : c'est celui du
  // dessin qui nous intéresse ici.
  await page.evaluate(() => {
    const grid = document.querySelector('.design-workspace');
    if (grid) grid.dataset.mobilePane = 'viewer';
  });
  await showView(page, 'teeth');
  await page.evaluate(() => window.__viewer.renderer().selectStage(0));
  await expect(page.locator('#stageInspector')).toBeVisible();

  const layout = await page.evaluate(() => {
    const stage = document.querySelector('.viewer-stage');
    const drawing = document.getElementById('svgContainer').getBoundingClientRect();
    const panel = document.getElementById('stageInspector').getBoundingClientRect();
    return { direction: getComputedStyle(stage).flexDirection,
      // Empilé, l'inspecteur commence sous le dessin : il ne le recouvre pas.
      below: panel.top >= drawing.bottom - 1,
      drawingWidth: Math.round(drawing.width), panelWidth: Math.round(panel.width) };
  });
  expect(layout.direction, 'trop étroit pour deux colonnes').toBe('column');
  expect(layout.below, 'l’inspecteur passe dessous, il ne se pose pas dessus').toBe(true);
  // Et le dessin garde toute la largeur, au lieu d'en céder une colonne.
  expect(layout.drawingWidth).toBeGreaterThan(300);

  const reachable = await page.evaluate(() => Array.from(document.querySelectorAll('#svgContainer .train-stage'))
    .map(stage => {
      const b = stage.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + 4, b.y + b.height / 2);
      return !(hit && hit.closest('#stageInspector'));
    }));
  expect(reachable.every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

test('worm threads never leave the body, in either view or in the export', async ({ page }) => {
  const errors = watchErrors(page);
  // Deux vis dans la même chaîne : leurs masques doivent être distincts.
  await mount(page, ['worm', 'worm']);

  for (const view of ['teeth', 'geometry']) {
    await showView(page, view);
    const shape = await page.evaluate(() => {
      const svg = document.querySelector('#svgContainer svg');
      const bodies = Array.from(svg.querySelectorAll('.worm-body, .worm-member'));
      const ids = Array.from(svg.querySelectorAll('clipPath')).map(c => c.id);
      const refs = Array.from(svg.querySelectorAll('.worm-thread-clip')).map(c => c.getAttribute('clip-path'));
      return { bodies: bodies.length, rounded: bodies.filter(b => b.getAttribute('rx')).length,
        ids: ids, refs: refs, unique: new Set(ids).size === ids.length,
        resolve: refs.every(r => ids.some(id => r === 'url(#' + id + ')')) };
    });
    // Un cylindre vu de côté est un rectangle : `rx` en faisait une capsule.
    expect(shape.rounded, view + ' : aucune extrémité arrondie').toBe(0);
    expect(shape.refs.length, view).toBeGreaterThan(0);
    expect(shape.unique, view + ' : un masque par vis').toBe(true);
    expect(shape.resolve, view + ' : chaque référence trouve son masque').toBe(true);

    // Le clip est une propriété de RENDU : on interroge le rendu, pas la boîte
    // géométrique — getBoundingClientRect ignore le masque et ne prouverait rien.
    const leaks = await page.evaluate(() => {
      const svg = document.querySelector('#svgContainer svg');
      const body = svg.querySelector('.worm-body, .worm-member');
      const found = [];
      [0, 90, 180, 359, 360, -120].forEach(angle => {
        window.__viewer.renderer().setAnimationAngle(angle);
        const box = body.getBoundingClientRect();
        let escaped = 0;
        [-14, -9, -5, -2, 2, 5, 9, 14].forEach(dx => {
          const x = dx < 0 ? box.left + dx : box.right + dx;
          for (let f = 0.15; f <= 0.85; f += 0.1) {
            const hit = document.elementFromPoint(x, box.top + box.height * f);
            if (hit && hit.classList && hit.classList.contains('worm-thread')) escaped++;
          }
        });
        if (escaped) found.push({ angle: angle, escaped: escaped });
      });
      return found;
    });
    expect(leaks, view + ' : aucun filet hors du corps').toEqual([]);

    // L'export emporte ses masques : un SVG dont le clip serait perdu
    // montrerait les filets débordants hors de l'application.
    const exported = await page.evaluate(() => window.__viewer.renderer().exportSVG());
    expect((exported.match(/<clipPath/g) || []).length, view).toBe(shape.ids.length);
    expect((exported.match(/clip-path="url\(#/g) || []).length, view).toBe(shape.refs.length);
    expect(exported, view + ' : pas de capsule dans l’export').not.toMatch(/class="[^"]*worm-(body|member)[^"]*"[^>]*\srx=/);
  }
  expect(errors).toEqual([]);
});

test('a chain that changes axis is drawn as one, not as a row of front views', async ({ page }) => {
  const errors = watchErrors(page);
  // Un engrenage et une vis sur le même arbre : le cas que l'ancien placement
  // ne pouvait pas représenter, parce qu'il dessinait toute roue en cercle,
  // c'est-à-dire « vue suivant son axe » — ce qui ne peut pas être vrai des
  // deux à la fois.
  await mount(page, ['spur', 'worm', 'spur']);
  await showView(page, 'teeth');

  const drawing = await page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    const model = window.__viewer.renderer().model;
    return {
      view: svg.dataset.view,
      // Ce que le MODÈLE dit de chaque organe…
      presentations: model.wheels.map(w => w.presentation),
      // …et ce que le DESSIN en fait réellement.
      profiles: svg.querySelectorAll('.gear-profile, .worm-body').length,
      discs: svg.querySelectorAll('.tooth-profile').length,
      pitchLines: svg.querySelectorAll('.pitch-line').length,
      shafts: svg.querySelectorAll('.train-shaft').length,
      lengths: Array.from(svg.querySelectorAll('.shaft-body')).map(line =>
        Math.hypot(line.getAttribute('x2') - line.getAttribute('x1'),
          line.getAttribute('y2') - line.getAttribute('y1'))),
      // Un cercle de construction n'a de sens que sur une roue vue de face :
      // tracé sur un organe vu par la tranche, il ne cote rien.
      strayCircles: Array.from(svg.querySelectorAll('.train-wheel')).filter(host => {
        const flat = host.querySelector('.gear-profile, .worm-body');
        return flat && host.querySelector('.pitch-circle, .base-circle');
      }).length
    };
  });

  // Les deux modes de représentation coexistent dans le même dessin.
  expect(new Set(drawing.presentations).size).toBeGreaterThan(1);
  expect(drawing.profiles, 'des corps vus par la tranche').toBeGreaterThan(0);
  expect(drawing.discs, 'des dentures vues de face').toBeGreaterThan(0);
  expect(drawing.pitchLines, 'la surface primitive des corps de profil').toBeGreaterThan(0);
  expect(drawing.strayCircles, 'aucun cercle de construction sur un corps vu de côté').toBe(0);

  // Les arbres ont une longueur : deux roues solidaires ne partagent plus un point.
  expect(drawing.shafts).toBeGreaterThanOrEqual(3);
  expect(drawing.lengths.every(l => l > 0), 'aucun arbre de longueur nulle').toBe(true);

  // Changer de point de vue change le dessin, jamais la mécanique.
  const seen = {};
  for (const view of ['unfolded', 'front', 'top', 'side', 'iso']) {
    seen[view] = await page.evaluate(v => {
      const renderer = window.__viewer.renderer();
      renderer.projection = v;
      renderer.render(renderer.solution);
      const model = renderer.model;
      return { view: model.view.id, mode: model.mode,
        drawing: model.wheels.map(w => w.cx.toFixed(2) + ',' + w.cy.toFixed(2)).join('|'),
        world: model.spatial.members.map(m => m.id + ':' + m.position.join(',')).join('|'),
        centres: model.stages.filter(s => Number.isFinite(s.centerDistance)).map(s =>
          Math.hypot(s.wheels[1].cx - s.wheels[0].cx, s.wheels[1].cy - s.wheels[0].cy) - s.centerDistance) };
    }, view);
    if (view !== 'unfolded') expect(seen[view].view, 'la vue demandée est celle qui est rendue').toBe(view);
    if (seen[view].mode === 'unfolded') {
      // La vue dépliée garde les longueurs vraies : c'est sa raison d'être.
      seen[view].centres.forEach(gap => expect(Math.abs(gap)).toBeLessThan(1e-6));
    } else {
      // Une PROJECTION raccourcit ce qui a de la profondeur. Exiger l'entraxe
      // vrai jusque dans l'axonométrie, c'était exiger un dessin qu'aucun
      // point de vue ne peut voir.
      seen[view].centres.forEach(gap => expect(gap).toBeLessThan(1e-6));
    }
  }
  const worlds = new Set(Object.values(seen).map(s => s.world));
  expect(worlds.size, 'aucune pièce ne bouge quand on change de vue').toBe(1);
  const drawings = new Set(Object.values(seen).map(s => s.drawing));
  expect(drawings.size, 'les vues doivent différer, sinon elles ne servent à rien').toBeGreaterThan(1);

  expect(errors).toEqual([]);
});

test('the point of view is a control, not a decoration (§28)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'worm', 'spur']);
  await showView(page, 'teeth');

  const select = page.locator('#viewerProjection');
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue('unfolded');
  // La liste vient du moteur de projection : rien n'est réécrit dans l'UI.
  const offered = await select.locator('option').evaluateAll(list => list.map(o => o.value));
  const known = await page.evaluate(() => GearProjectionEngine.VIEWS.map(v => v.id));
  // « Dépliée » vient en tête, et sous son nom : ce n'est pas une projection,
  // et la faire passer pour le comportement caché des autres était la source
  // de la confusion entre comprendre et mesurer.
  expect(offered).toEqual(['unfolded'].concat(known));

  const shot = () => page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    const model = window.__viewer.renderer().model;
    return { announced: svg.dataset.view, mode: model.mode,
      drawing: model.wheels.map(w => w.cx.toFixed(2) + ',' + w.cy.toFixed(2)).join('|'),
      world: model.spatial.members.map(m => m.id + ':' + m.position.join(',')).join('|') };
  });

  const automatic = await shot();
  expect(automatic.mode, 'la vue par défaut est la vue dépliée').toBe('unfolded');
  const drawings = new Set([automatic.drawing]);
  for (const id of known) {
    await select.selectOption(id);
    const seen = await shot();
    // Ce que la commande promet : le dessin change, la mécanique non.
    expect(seen.announced, id).toBe(id);
    // Et une vue nommée comme une projection EST une projection.
    expect(seen.mode, id + ' doit être une vraie projection').toBe('projected');
    expect(seen.world, id + ' : aucune pièce ne bouge').toBe(automatic.world);
    drawings.add(seen.drawing);
  }
  expect(drawings.size, 'chaque point de vue doit donner un dessin distinct').toBeGreaterThan(1);

  // Retour à la vue dépliée : on retrouve exactement le dessin de départ.
  await select.selectOption('unfolded');
  expect((await shot()).drawing).toBe(automatic.drawing);

  // Une seule commande pour les trois vues : elles dessinent le même
  // mécanisme depuis le même endroit, et un réglage par vue laissait croire à
  // deux réglages indépendants, à reposer l'un après l'autre.
  // Les positions dessinées, plutôt que le cadrage : deux points de vue
  // peuvent donner la même boîte englobante en plaçant les pièces ailleurs.
  const drawn = () => page.evaluate(() => Array.from(
    document.querySelectorAll('#svgContainer svg circle'))
    .map(c => c.getAttribute('cx') + ',' + c.getAttribute('cy')).join('|'));

  await showView(page, 'geometry');
  await expect(select).toBeEnabled();
  const flat = await drawn();
  await select.selectOption('side');
  expect(await drawn(), 'la vue cotée suit le point de vue choisi').not.toBe(flat);
  await select.selectOption('unfolded');

  // La Cinématique, elle, n'a pas de point de vue à choisir : c'est un schéma
  // fonctionnel, et le réorganiser au gré d'une caméra reviendrait à le prendre
  // pour une vue du mécanisme.
  await showView(page, 'kinematic');
  await expect(select).toBeDisabled();
  await expect(select).toHaveAttribute('title', /schéma cinématique est fonctionnel/);
  await showView(page, 'teeth');
  await expect(select).toBeEnabled();

  expect(errors).toEqual([]);
});

test('what turns as one block lights up as one block (§ corps rigides)', async ({ page }) => {
  const errors = watchErrors(page);
  // Train composé : la roue menée de l'étage 1 et le pignon menant de l'étage 2
  // sont sur le même arbre. Rien de visible ne le disait.
  await mount(page, ['spur', 'helical']);
  await showView(page, 'teeth');

  const bodies = await page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    return Array.from(svg.querySelectorAll('.train-wheel'))
      .map(g => g.dataset.member + '→' + g.dataset.body);
  });
  expect(bodies.length).toBe(4);
  // Deux organes partagent un corps, les deux autres non.
  const perBody = bodies.reduce((count, entry) => {
    const body = entry.split('→')[1];
    count[body] = (count[body] || 0) + 1;
    return count;
  }, {});
  expect(Object.values(perBody).filter(n => n === 2).length, 'un arbre porte deux roues').toBe(1);

  // Survoler l'un éclaire l'autre, ainsi que leur arbre — et rien d'autre.
  const shared = Object.keys(perBody).find(body => perBody[body] === 2);
  const lit = await page.evaluate(body => {
    const svg = document.querySelector('#svgContainer svg');
    const part = svg.querySelector(`.train-wheel[data-body="${body}"] path, .train-wheel[data-body="${body}"] circle`);
    const box = part.getBoundingClientRect();
    part.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
    return {
      wheels: Array.from(svg.querySelectorAll('.train-wheel.rigid-highlight')).map(g => g.dataset.member),
      shafts: Array.from(svg.querySelectorAll('.train-shaft.rigid-highlight')).map(g => g.dataset.shaft)
    };
  }, shared);
  expect(lit.wheels.length, 'les deux roues solidaires').toBe(2);
  expect(lit.shafts, 'et leur arbre, lui seul').toEqual([shared]);

  // Quitter le dessin éteint tout : un surlignage qui reste allumé ment.
  const after = await page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    return svg.querySelectorAll('.rigid-highlight').length;
  });
  expect(after).toBe(0);

  // Et le texte le dit aussi, pour qui ne survole pas : la solidarité est une
  // information, pas seulement un effet visuel.
  const said = await page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    return Array.from(svg.querySelectorAll('.train-wheel [data-hud], .train-wheel'))
      .map(g => g.dataset.hud || '').filter(Boolean).join('\n---\n');
  });
  expect(said).toMatch(/Solidaire de/);

  expect(errors).toEqual([]);
});

test('the technical style is a drawing language, not a grey filter (§2, §53)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'worm', 'internal']);
  await showView(page, 'teeth');

  const read = () => page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    const model = window.__viewer.renderer().model;
    return {
      teeth: svg.querySelectorAll('.tooth-profile').length,
      surfaces: svg.querySelectorAll('.tip-surface, .root-surface, .rim-surface').length,
      pitch: svg.querySelectorAll('.pitch-circle, .pitch-line').length,
      warnings: svg.querySelectorAll('.warning-overlay').length,
      // La mécanique, telle que le modèle la décrit : elle ne doit pas bouger.
      mechanics: model.wheels.map(w => [w.memberId, w.bodyId, w.pitchD.toFixed(4),
        w.teeth, w.presentation].join(':')).join('|'),
      centres: model.stages.map(s => (s.centerDistance || 0).toFixed(4)).join('|')
    };
  });

  const visual = await read();
  expect(visual.teeth, 'le style visuel garde la denture').toBeGreaterThan(0);

  await page.locator('[data-style="technical"]').click();
  await page.waitForTimeout(150);
  const technical = await read();

  // §63.3 : une roue globale n'affiche plus nécessairement toutes ses dents.
  expect(technical.teeth, 'aucune denture sur un dessin d’ensemble').toBe(0);
  // §63.2 : ce n'est pas un filtre — les surfaces conventionnelles apparaissent.
  expect(technical.surfaces, 'les surfaces remplacent la denture').toBeGreaterThan(0);
  expect(technical.pitch, 'les surfaces primitives restent').toBeGreaterThan(0);

  // §53 : le style ne change JAMAIS la mécanique.
  expect(technical.mechanics).toBe(visual.mechanics);
  expect(technical.centres).toBe(visual.centres);

  // §16 : ce qui commente la géométrie sort de la géométrie — mais reste
  // accessible ailleurs, ce que l'inspecteur assure déjà.
  const painted = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#svgContainer .warning-overlay') || document.body).display);
  if (technical.warnings) expect(painted).toBe('none');

  // Le conteneur porte l'état, ce qui permet au CSS de suivre sans que chaque
  // primitive ait à connaître le style.
  await expect(page.locator('#svgContainer')).toHaveClass(/is-technical/);
  await expect(page.locator('[data-style="technical"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-style="visual"]')).toHaveAttribute('aria-pressed', 'false');

  // Et le retour au visuel restitue exactement le dessin d'avant.
  await page.locator('[data-style="visual"]').click();
  await page.waitForTimeout(150);
  const back = await read();
  expect(back.teeth).toBe(visual.teeth);
  expect(back.mechanics).toBe(visual.mechanics);

  expect(errors).toEqual([]);
});

test('a wheel seen edge-on does not spin like a disc (§4 de l’audit)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'bevel']);
  await showView(page, 'teeth');

  // Le renderer appliquait `rotate(angle)` à toute roue sans exception. Sur une
  // roue dessinée en rectangle de largeur b, cela faisait basculer le rectangle
  // en diagonale : mécaniquement absurde, et d'autant plus visible depuis que le
  // modèle spatial place correctement les organes de profil.
  const trace = view => page.evaluate(v => {
    const renderer = window.__viewer.renderer();
    renderer.projection = v;
    renderer.render(renderer.solution);
    const out = [];
    // Les roues sont peintes du fond vers l'avant : leur ordre dans le document
    // n'est plus celui du modèle. On les apparie donc par leur identifiant.
    Array.from(document.querySelectorAll('#svgContainer .train-wheel')).forEach(host => {
      const wheel = renderer.model.wheels.filter(w => w.memberId === host.dataset.member)[0];
      if (!wheel) return;
      const rotor = host.querySelector('.rotor');
      const mark = host.querySelector('.phase-mark');
      const frames = [0, 90, 180, 270].map(angle => {
        renderer.setAnimationAngle(angle);
        return { rotor: rotor.getAttribute('transform') || '',
          mark: mark ? mark.getAttribute('transform') || '' : null };
      });
      out.push({ presentation: wheel.presentation, kind: wheel.kind, frames });
    });
    return out;
  }, view);

  for (const view of ['unfolded', 'front', 'iso']) {
    const wheels = await trace(view);
    expect(wheels.length, view).toBeGreaterThan(0);
    wheels.forEach((wheel, index) => {
      const label = `${view} / roue ${index} (${wheel.presentation})`;
      if (wheel.presentation === 'face') {
        // De face, le disque tourne réellement dans le plan.
        const angles = wheel.frames.map(f => f.rotor);
        expect(new Set(angles).size, label + ' : le disque doit tourner').toBeGreaterThan(1);
        angles.forEach(a => expect(a, label).toMatch(/^rotate\(/));
      } else {
        // De profil ou obliquement, le CORPS ne bouge pas : il ne le peut pas.
        wheel.frames.forEach(frame => {
          expect(frame.rotor, label + ' : le corps doit rester fixe').toBe('');
        });
        // C'est un repère de phase qui porte le mouvement.
        expect(wheel.frames[0].mark, label + ' : il faut un repère de phase').not.toBeNull();
        const marks = wheel.frames.map(f => f.mark);
        expect(new Set(marks).size, label + ' : le repère doit bouger').toBeGreaterThan(1);

        const points = marks.map(m => m.replace(/[^-\d. ]/g, '').trim().split(/\s+/).map(Number));
        if (wheel.presentation === 'profile') {
          // Le cercle primitif vu par la tranche est un SEGMENT : le repère y
          // va et vient, sans jamais quitter la ligne.
          const spread = new Set(points.map(p => p[0].toFixed(3)));
          expect(spread.size, label + ' : un segment, pas un cercle').toBe(1);
          expect(new Set(points.map(p => p[1].toFixed(3))).size, label).toBeGreaterThan(1);
        } else {
          // Obliquement, c'est une ellipse : les deux coordonnées varient.
          expect(new Set(points.map(p => p[0].toFixed(3))).size, label + ' : ellipse en x').toBeGreaterThan(1);
          expect(new Set(points.map(p => p[1].toFixed(3))).size, label + ' : ellipse en y').toBeGreaterThan(1);
        }
      }
    });
  }

  // De quel BOUT on regarde : `abs(dot(...))` détruisait cette information, et
  // elle ne se reconstruit pas après coup. Une roue vue de son autre extrémité
  // tourne, à l'écran, dans l'autre sens — l'angle appliqué doit donc porter le
  // signe que le repère projeté donne, et pas seulement celui de la cinématique.
  const applied = await page.evaluate(() => {
    const renderer = window.__viewer.renderer();
    renderer.projection = 'unfolded';
    renderer.render(renderer.solution);
    renderer.setAnimationAngle(90);
    const pose = GearKinematicsEngine.pose(renderer.scene.kinematics, 90);
    return Array.from(document.querySelectorAll('#svgContainer .train-wheel'))
      .map(host => {
        // Appariement par identifiant : les roues sont peintes par profondeur.
        const wheel = renderer.model.wheels.filter(w => w.memberId === host.dataset.member)[0];
        if (!wheel) return {};
        const drawn = host.querySelector('.rotor').getAttribute('transform');
        return { presentation: wheel.presentation,
          spin: wheel.phaseBasis ? wheel.phaseBasis.spin : null,
          own: (pose.members[wheel.memberId] || {}).angle,
          drawn: drawn ? Number(drawn.replace(/[^-\d.]/g, '')) : null };
      })
      .filter(w => w.presentation === 'face' && Number.isFinite(w.own) && w.own !== 0);
  });
  expect(applied.length, 'au moins une roue vue de face').toBeGreaterThan(0);
  applied.forEach((wheel, index) => {
    expect(wheel.spin, 'roue ' + index + ' : un sens apparent').not.toBe(0);
    // L'angle dessiné est l'angle mécanique, orienté par le côté depuis lequel
    // on regarde. Ignorer `spin`, c'est affirmer le même sens des deux bouts.
    expect(Math.sign(wheel.drawn), 'roue ' + index + ' : sens apparent')
      .toBe(Math.sign(wheel.own * wheel.spin));
    expect(Math.abs(Math.abs(wheel.drawn) - Math.abs(wheel.own)), 'roue ' + index).toBeLessThan(0.01);
  });

  expect(errors).toEqual([]);
});
