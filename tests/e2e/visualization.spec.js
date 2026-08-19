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
  await page.locator('.train-wheel[data-stage="0"]').first().click();
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
  // Cliquer une roue désigne LA ROUE — la fiche d'étage est à un bouton de là.
  await page.locator('.train-wheel[data-stage="0"]').first().click();
  const inspector = page.locator('#stageInspector');
  await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'Voir l’étage' }).click();
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
      // Par NUMÉRO D'EXEMPLAIRE, pas par ordre du document : la pile est triée
      // en profondeur et deux satellites y échangent leur place en orbitant.
      const read = () => Array.from(document.querySelectorAll('.train-wheel.planet'))
        .sort((a, b) => Number(a.dataset.instance) - Number(b.dataset.instance))
        .map(host => {
          const m = host.querySelector('.planet-seat').getAttribute('transform')
            .match(/translate\(([-\d.]+) ([-\d.]+)\)/);
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
      // L'ellipse d'abord : vue de BIAIS, la pièce a une silhouette de cylindre
      // ET des cercles ouverts en ellipses. Vue par la TRANCHE, elle a la même
      // silhouette mais ses cercles se referment en segments — c'est l'ellipse,
      // pas la silhouette, qui distingue les deux.
      if (host.querySelector('ellipse')) return 'ellipse';
      if (host.querySelector('.profile-body')) return 'profile';
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
    // Le calque de géométrie est PLAT : les pièces de tous les étages y sont
    // sœurs, et c'est ce qui permet de les trier entre elles.
    const layer = document.querySelector('#svgContainer .geometry-layer');
    return Array.from(layer.querySelectorAll(':scope > .train-wheel')).map(element => {
      const record = renderer._wheels.filter(w => w.group === element)[0];
      return { stage: element.dataset.stage, depth: record ? record.wheel.depth : null };
    });
  });
  expect(painted.length, 'aucune pièce dans le calque de géométrie').toBeGreaterThan(3);
  // Peint du fond vers l'avant, TOUS ÉTAGES CONFONDUS.
  painted.forEach((piece, index) => {
    if (index === 0) return;
    expect(piece.depth, 'pièce peinte devant une plus proche')
      .toBeLessThanOrEqual(painted[index - 1].depth + 1e-9);
  });
  // Et l'ordre traverse réellement les étages : sinon le tri ne serait que
  // celui de la PR précédente, interne à chaque étage.
  expect(new Set(painted.map(p => p.stage)).size).toBeGreaterThan(1);
  const straight = painted.map(p => p.stage).join('');
  expect(straight, 'les pièces restent rangées par étage').not.toBe(
    painted.map(p => p.stage).sort().join(''));

  // L'autre bord : le même mécanisme, regardé de l'autre côté. C'est une
  // notion ORTHOGRAPHIQUE — une isométrie n'a pas d'autre bord, elle a des
  // azimuts, et le bouton s'efface donc en Iso plutôt que d'y faire passer la
  // caméra sous le mécanisme.
  await expect(flip).toBeHidden();
  await select.selectOption('front');
  await expect(flip).toBeVisible();
  const drawingOf = () => page.evaluate(() =>
    window.__viewer.renderer().model.wheels.map(w => w.cx.toFixed(3) + ',' + w.cy.toFixed(3)).join('|'));
  const before = await drawingOf();
  await expect(flip).toHaveAttribute('aria-pressed', 'false');
  await flip.click();
  await expect(flip).toHaveAttribute('aria-pressed', 'true');
  // La liste montre toujours la vue de référence : « De face » et « De
  // derrière » sont la même coupe, prise des deux bords.
  await expect(select).toHaveValue('front');
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

test('the iso view of a spur → belt train holds together (§24 de la mission)', async ({ page }) => {
  const errors = watchErrors(page);
  // La capture de référence : une grande roue d'un premier étage et la petite
  // poulie du suivant, sur le MÊME ARBRE, vues en isométrie.
  await mount(page, ['spur', 'belt']);
  await showView(page, 'teeth');
  const mod180 = a => ((a % 180) + 180) % 180;

  // « Iso opposée » n'a pas d'entrée dans la liste : c'est la même vue, prise
  // de l'autre bord, et le bouton ⇄ y mène. On la demande donc par son nom.
  for (const view of ['iso', 'iso-rear']) {
    await page.evaluate(id => window.__viewer.setProjection(id), view);
    await page.waitForTimeout(60);
    const seen = await page.evaluate(() => {
      const svg = document.querySelector('#svgContainer svg');
      const model = window.__viewer.renderer().model;
      const wheels = {};
      model.wheels.forEach(w => { wheels[w.memberId] = w; });
      const shafts = {};
      model.shafts.forEach(s => { shafts[s.id] = s; });
      const link = model.stages[1].links[0];
      // F. aucun cercle de construction autour d'une roue oblique.
      const stray = Array.from(svg.querySelectorAll('.geometry-layer .train-wheel')).filter(host => {
        const record = window.__viewer.renderer()._wheels.filter(w => w.group === host)[0];
        return record && record.wheel.presentation === 'oblique' &&
          host.querySelector('circle.pitch-circle, circle.base-circle, circle.root-circle, circle.tip-circle');
      }).length;
      return {
        wheels: model.wheels.map(w => ({ id: w.memberId, body: w.bodyId, presentation: w.presentation,
          apparent: w.apparent, cx: w.cx, cy: w.cy, width: w.faceWidth })),
        shafts: model.shafts.map(s => ({ id: s.id, length: Math.hypot(s.x2 - s.x1, s.y2 - s.y1),
          endOn: s.endOn, real: null })),
        spatial: model.spatial.shafts.map(s => ({ id: s.id, length: s.length })),
        stray: stray,
        belt: { circles: link.geometry.circles, parts: link.geometry.parts.length,
          origin: link.geometry.origin, first: link.geometry.first, second: link.geometry.second,
          distance: link.geometry.distance, r1: link.r1, r2: link.r2 },
        io: Array.from(svg.querySelectorAll('.io-chip')).map(chip => ({
          along: chip.dataset.along.split(',').map(Number),
          d: chip.querySelector('.io-arrow').getAttribute('d') })),
        painted: Array.from(svg.querySelectorAll('.geometry-layer > .train-wheel'))
          .map(el => el.dataset.member),
        depths: model.wheels.reduce((map, w) => { map[w.memberId] = w.depth; return map; }, {})
      };
    });

    // A/B/C. Les deux organes du même arbre partagent leur plan apparent.
    const byBody = {};
    seen.wheels.forEach(w => { (byBody[w.body] = byBody[w.body] || []).push(w); });
    const shared = Object.keys(byBody).filter(id => byBody[id].length > 1);
    expect(shared.length, view + ' : aucun arbre ne porte deux organes').toBeGreaterThan(0);
    shared.forEach(id => {
      const [a, b] = byBody[id];
      expect(a.apparent.major, view).toBeCloseTo(b.apparent.major, 9);
      expect(a.apparent.minor, view).toBeCloseTo(b.apparent.minor, 9);
      expect(mod180(a.apparent.rotationDeg), view).toBeCloseTo(mod180(b.apparent.rotationDeg), 6);
      // D. seule une translation le long de leur arbre commun les sépare.
      const shaft = seen.shafts.filter(s => s.id === id)[0];
      const gap = [b.cx - a.cx, b.cy - a.cy];
      if (!shaft.endOn && Math.hypot(gap[0], gap[1]) > 1e-9) {
        const axis = mod180(a.apparent.rotationDeg + 90) * Math.PI / 180;
        const across = gap[0] * -Math.sin(axis) + gap[1] * Math.cos(axis);
        expect(Math.abs(across), view + ' : les deux organes s’écartent en travers de leur arbre')
          .toBeLessThan(1e-6);
      }
    });

    // E. la courroie est tangente à ses deux poulies, et chaque poulie est
    // décrite par la même ellipse que la roue.
    seen.belt.circles.forEach((circle, index) => {
      const wheel = seen.wheels.filter(w => w.id === (index === 0 ? 's1-input' : 's1-output'))[0];
      expect(circle.major, view).toBeCloseTo(wheel.apparent.major, 9);
      expect(circle.minor, view).toBeCloseTo(wheel.apparent.minor, 9);
      expect(mod180(circle.rotationDeg), view).toBeCloseTo(mod180(wheel.apparent.rotationDeg), 6);
      expect(Math.hypot(circle.centre[0] - wheel.cx, circle.centre[1] - wheel.cy), view).toBeLessThan(1e-9);
    });

    // F. aucun cercle de construction autour d'une ellipse.
    expect(seen.stray, view + ' : un cercle entoure encore une roue oblique').toBe(0);

    // G. l'arbre est raccourci exactement comme la projection le veut.
    seen.shafts.forEach(shaft => {
      const real = seen.spatial.filter(s => s.id === shaft.id)[0];
      expect(shaft.length, view + ' ' + shaft.id).toBeCloseTo(real.length * Math.sqrt(2 / 3), 6);
    });

    // H. la profondeur décide de l'ordre de peinture, tous étages confondus.
    seen.painted.forEach((id, index) => {
      if (index === 0) return;
      expect(seen.depths[id], view + ' : ordre de profondeur rompu')
        .toBeLessThanOrEqual(seen.depths[seen.painted[index - 1]] + 1e-9);
    });
    // Et la courroie est découpée, pour pouvoir passer devant ET derrière.
    expect(seen.belt.parts, view).toBe(4);

    // I. ENTRÉE et SORTIE suivent l'orientation réelle des arbres.
    expect(seen.io.length).toBe(2);
    seen.io.forEach(chip => {
      // La direction est écrite au dix-millième dans l'attribut : on la
      // compare à cette précision, pas au-delà.
      expect(Math.hypot(chip.along[0], chip.along[1]), view).toBeCloseTo(1, 3);
      // La flèche n'est pas horizontale : les arbres ne le sont pas.
      expect(Math.abs(chip.along[1]), view + ' : flèche horizontale sur un arbre oblique')
        .toBeGreaterThan(0.05);
      const points = Array.from(chip.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)).map(m => [Number(m[1]), Number(m[2])]);
      const shaftDirection = [chip.along[0], chip.along[1]];
      const stroke = [points[1][0] - points[0][0], points[1][1] - points[0][1]];
      const span = Math.hypot(stroke[0], stroke[1]);
      const cos = (stroke[0] * shaftDirection[0] + stroke[1] * shaftDirection[1]) / span;
      expect(Math.abs(Math.abs(cos) - 1), view + ' : la flèche ne suit pas son arbre').toBeLessThan(1e-3);
    });
  }
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
  // Une pièce que le tri de profondeur place DERRIÈRE une autre ne reçoit plus
  // le survol : c'est le propre d'un dessin qui respecte la profondeur. On
  // survole donc une roue, et non la première pièce du document.
  await page.locator('#svgContainer .train-wheel.sun').hover();
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
  await page.locator('#svgContainer .geometry-member-group[data-hud]').first().hover();
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
  const selector = { teeth: '.train-wheel', geometry: '.geometry-layer .geometry-stage',
    kinematic: '.kinematic-stage' };

  // Un point du dessin qui répond effectivement l'étage visé. Viser le centre
  // de sa boîte englobante ne suffit pas : celle-ci englobe aussi son
  // étiquette, posée en marge du dessin entier, et un trait ne se clique pas
  // en son milieu.
  const aim = sel => page.evaluate(selector => {
    // Plusieurs pièces peuvent porter l'étage visé, et le tri de profondeur en
    // cache certaines : on cherche celle qui répond réellement.
    //
    // Le CENTRE d'une pièce ne suffit pas à la viser. Une couronne est un
    // anneau : son centre est un trou, et c'est ce qui se trouve derrière qui
    // y répond — le pignon de l'étage précédent, coaxial. On échantillonne
    // donc plusieurs points de sa boîte, pas seulement son milieu.
    const steps = [0.06, 0.2, 0.35, 0.5, 0.65, 0.8, 0.94];
    for (const stage of document.querySelectorAll(`#svgContainer ${selector}[data-stage="2"]`)) {
      for (const part of stage.querySelectorAll('path, circle, rect, polygon, ellipse')) {
        const box = part.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        for (const fy of steps) {
          for (const fx of steps) {
            const x = box.x + box.width * fx, y = box.y + box.height * fy;
            const hit = document.elementFromPoint(x, y);
            if (hit && stage.contains(hit)) return { x, y };
          }
        }
      }
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
    await expect(page.locator(`#svgContainer ${selector[view]}[data-stage="2"]`).first()).toHaveClass(/selected/);
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

  // Une pièce que la profondeur place derrière une autre ne reçoit plus le
  // clic : on désigne donc l'étage par son libellé, qui est au-dessus de tout.
  await page.locator('#svgContainer .train-stage[data-stage="1"] .train-label').click();
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
  await page.locator('#svgContainer .train-wheel').first().click();
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

test('a satellite passes behind the ring, then in front of it (§ profondeur planétaire)', async ({ page }) => {
  await mount(page, ['planetary']);
  await showView(page, 'teeth');
  for (const view of ['front', 'iso']) {
    await page.evaluate(id => window.__viewer.setProjection(id), view);
    const run = await page.evaluate(() => {
      const teeth = window.__viewer.teeth;
      const layer = document.querySelector('.geometry-layer');
      // Le numéro d'exemplaire : cinq pièces qui portent le même `data-member`
      // sont sinon indiscernables dans la pile.
      const planets = Array.from(layer.querySelectorAll('.train-wheel.planet[data-instance]'));
      const ring = layer.querySelector('[data-member$="-R"]');
      const stack = () => Array.from(layer.children);
      const sides = {};
      const orders = [];
      for (let a = 0; a <= 360; a += 30) {
        teeth.setAnimationAngle(a);
        const order = stack();
        orders.push(order.map(el => el.getAttribute('data-instance') || '·').join(''));
        const ringAt = order.indexOf(ring);
        planets.forEach(el => {
          const key = el.getAttribute('data-instance');
          sides[key] = sides[key] || new Set();
          sides[key].add(order.indexOf(el) > ringAt ? 'devant' : 'derrière');
        });
      }
      return { count: planets.length, distinct: new Set(orders).size,
        both: Object.keys(sides).filter(k => sides[k].size === 2).length };
    });
    expect(run.count).toBe(5);
    // La pile CHANGE au cours d'un tour : un satellite qui garde sa place
    // traverse la couronne au lieu d'en faire le tour.
    expect(run.distinct).toBeGreaterThan(1);
    // Et au moins un satellite est passé des deux côtés de la couronne.
    expect(run.both).toBeGreaterThan(0);
  }
});

test('the Dimensions view draws the same oblique bodies as the Teeth view', async ({ page }) => {
  await mount(page, ['worm', 'bevel', 'spur']);
  await showView(page, 'geometry');
  const read = async () => page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    const body = selector => {
      const el = svg.querySelector(selector);
      return el ? { d: el.getAttribute('d') || '', tag: el.tagName } : null;
    };
    return { worm: body('.worm-member'), cone: body('.cone-member'),
      profile: body('.profile-body > path'),
      // Le bâti d'un organe bloqué : cercle de face, ellipse de biais.
      ground: (() => {
        const el = svg.querySelector('.ground-ring, .ground-boundary');
        return el ? { tag: el.tagName, rx: el.getAttribute('rx'), ry: el.getAttribute('ry') } : null;
      })(),
      base: !!svg.querySelector('.cone-base'), face: !!svg.querySelector('.worm-end-face') };
  });

  await page.evaluate(() => window.__viewer.setProjection('front'));
  const flat = await read();
  // Vu de face ou par la tranche, un corps couché reste le RECTANGLE du dessin
  // de profil : ses bouts sont des segments, il n'y a pas d'arc à tracer.
  if (flat.worm) expect(flat.worm.d).not.toContain('A ');

  await page.evaluate(() => window.__viewer.setProjection('iso'));
  const oblique = await read();
  // De biais, chaque corps se ferme par les demi-ellipses de ses bouts : c'est
  // le contour de la vue Denture, dans le vocabulaire de trait des cotes. Le
  // rectangle laissait quatre coins hors d'une pièce ronde.
  expect(oblique.worm, 'pas de vis dans la vue cotée').not.toBeNull();
  expect(oblique.worm.d).toContain('A ');
  expect(oblique.cone, 'pas de cône dans la vue cotée').not.toBeNull();
  expect(oblique.cone.d).toContain('A ');
  expect(oblique.profile, 'pas de corps couché dans la vue cotée').not.toBeNull();
  expect(oblique.profile.d).toContain('A ');
  // Et chaque famille montre le cercle que sa forme rend visible.
  expect(oblique.base).toBe(true);
  expect(oblique.face).toBe(true);
});

test('the ground symbol follows the shape of the part it blocks (§ bâti oblique)', async ({ page }) => {
  await mount(page, ['planetary']);
  await showView(page, 'geometry');
  const shape = async () => page.evaluate(() => {
    const el = document.querySelector('#svgContainer .envelope-layer ellipse, #svgContainer .envelope-layer circle');
    if (!el) return null;
    const blocked = window.__viewer.geometry.layout.stages[0].members
      .filter(m => m.functionalRole === 'fixed')[0];
    return { tag: el.tagName.toLowerCase(),
      // rx/ry du symbole, et le rapport que l'organe bloqué ANNONCE lui-même.
      ratio: el.tagName.toLowerCase() === 'ellipse'
        ? Number(el.getAttribute('rx')) / Number(el.getAttribute('ry')) : 1,
      expected: blocked && blocked.apparent ? blocked.apparent.minor / blocked.apparent.major : null };
  });

  const seenIn = {};
  for (const view of ['front', 'side', 'iso']) {
    await page.evaluate(id => window.__viewer.setProjection(id), view);
    const found = await shape();
    expect(found, view + ' : aucun symbole de bâti').not.toBeNull();
    // Le bâti prend la forme de la pièce qu'il bloque. Un anneau circulaire
    // autour d'une couronne vue de biais affirmait que la pièce, elle, est vue
    // de face — et le rapport de son ellipse le dit, vue par vue.
    expect(Math.abs(found.ratio - found.expected), view + ' : bâti ' + found.ratio
      + ' vs pièce ' + found.expected).toBeLessThan(0.02);
    seenIn[view] = found.ratio;
  }
  // Et il change réellement d'une vue à l'autre : une forme constante ne
  // suivrait rien du tout.
  expect(new Set(Object.values(seenIn).map(v => v.toFixed(2))).size).toBeGreaterThan(1);
});

test('a crossed shaft passes in front of some parts and behind others (§ profondeur des arbres)', async ({ page }) => {
  await mount(page, ['spur', 'bevel']);
  await showView(page, 'teeth');
  const stack = async () => page.evaluate(() => {
    const layer = document.querySelector('#svgContainer .geometry-layer');
    const order = Array.from(layer.children);
    const kind = el => el.classList.contains('train-shaft') ? 'shaft'
      : el.classList.contains('train-wheel') ? 'wheel'
      : el.classList.contains('train-shafts') ? 'axes' : 'autre';
    const first = order.findIndex(el => kind(el) === 'wheel');
    const last = order.map(kind).lastIndexOf('wheel');
    return {
      pieces: order.filter(el => kind(el) === 'shaft').length,
      // Un tronçon d'arbre peint APRÈS une roue passe devant elle.
      inFront: order.filter((el, i) => kind(el) === 'shaft' && i > first).length,
      behind: order.filter((el, i) => kind(el) === 'shaft' && i < last).length,
      // Un arbre reste UNE pièce : tous ses tronçons portent son identifiant.
      shafts: new Set(order.filter(el => kind(el) === 'shaft').map(el => el.dataset.shaft)).size,
      crossings: order.filter(el => kind(el) === 'shaft')
        .map(el => el.querySelector('line')).filter(Boolean)
        .filter(line => Number(line.getAttribute('x1')) !== Number(line.getAttribute('x2'))).length
    };
  });

  await page.evaluate(() => window.__viewer.setProjection('front'));
  const flat = await stack();
  // De face, les arbres sont perpendiculaires au regard : un tronçon par
  // portion visible, aucun besoin d'en découper davantage.
  expect(flat.pieces).toBeGreaterThan(0);

  await page.evaluate(() => window.__viewer.setProjection('iso'));
  const seen = await stack();
  // De biais, les arbres plongent : ils sont découpés, et leurs tronçons se
  // répartissent de part et d'autre des roues. Le dessin les posait d'un bloc
  // au fond, sous toutes les dentures.
  expect(seen.pieces, 'les arbres ne sont pas découpés').toBeGreaterThan(flat.pieces);
  expect(seen.inFront, 'aucun tronçon devant une roue').toBeGreaterThan(0);
  expect(seen.behind, 'aucun tronçon derrière une roue').toBeGreaterThan(0);
  // Et le corps rigide reste lisible : les tronçons d'un même arbre gardent
  // son identifiant, donc s'allument ensemble.
  expect(seen.shafts).toBeGreaterThanOrEqual(2);
  expect(seen.shafts).toBeLessThan(seen.pieces);
});

test('turning the iso view orbits the mechanism instead of diving under it (§ rotation ISO)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['worm', 'belt']);
  await showView(page, 'teeth');
  const select = page.locator('#viewerProjection');
  const flip = page.locator('#viewerOpposite');
  const left = page.locator('#viewerIsoLeft');
  const right = page.locator('#viewerIsoRight');
  const count = page.locator('#viewerIsoCount');

  // Hors isométrie, on change de BORD ; il n'y a pas d'azimut à tourner.
  await select.selectOption('front');
  await expect(flip).toBeVisible();
  await expect(page.locator('#viewerIsoTurn')).toBeHidden();

  await select.selectOption('iso');
  // En isométrie, c'est l'inverse : on TOURNE, et le bouton « autre bord »
  // s'efface — il menait au coin diagonalement opposé du cube, c'est-à-dire
  // sous le mécanisme, en inversant d'un coup toute la profondeur.
  await expect(flip).toBeHidden();
  await expect(count).toHaveText('Iso 1/4');

  const state = () => page.evaluate(() => {
    const engine = window.GearProjectionEngine;
    const id = window.__viewer.projection;
    const seen = engine.view(id);
    const model = window.__viewer.renderer().model;
    return { id: id, up: seen.w[1], handed:
      engine.vector.dot(engine.vector.cross(seen.u, seen.v), seen.w),
      // La verticale du monde, projetée : elle doit rester verticale et vers
      // le haut de l'écran, à tous les azimuts.
      screenUp: engine.project([0, 1, 0], id),
      seats: model.wheels.map(w => w.cx.toFixed(3) + ',' + w.cy.toFixed(3)).join('|'),
      world: model.spatial.members.map(m => m.position.join(',')).join('|') };
  });

  const turns = ['iso', 'iso-90', 'iso-180', 'iso-270'];
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const now = await state();
    expect(now.id, 'quart de tour ' + i).toBe(turns[i]);
    await expect(count).toHaveText('Iso ' + (i + 1) + '/4');
    // La liste continue d'afficher « Iso » : l'utilisateur n'a pas huit noms
    // techniques à démêler, le compteur lui dit où il en est.
    await expect(select).toHaveValue('iso');
    // Jamais sous le mécanisme : la caméra garde sa hauteur.
    expect(now.up).toBeCloseTo(1 / Math.sqrt(3), 12);
    // Jamais d'image miroir : le trièdre garde son sens.
    expect(now.handed).toBeCloseTo(-1, 12);
    // Le haut du monde reste le haut du dessin.
    expect(Math.abs(now.screenUp[0])).toBeLessThan(1e-9);
    expect(now.screenUp[1]).toBeLessThan(-0.8);
    seen.push(now);
    await right.click();
  }
  // Quatre quarts de tour reviennent exactement au départ.
  expect((await state()).id).toBe('iso');
  expect((await state()).seats).toBe(seen[0].seats);
  // Chaque azimut dessine autre chose…
  expect(new Set(seen.map(s => s.seats)).size).toBe(4);
  // …mais le MONDE, lui, n'a pas bougé d'un millimètre.
  seen.forEach(s => expect(s.world).toBe(seen[0].world));

  // ↷ puis ↶ ramène exactement où l'on était, et réciproquement.
  await right.click();
  await left.click();
  expect((await state()).id).toBe('iso');
  await left.click();
  expect((await state()).id).toBe('iso-270');
  await right.click();
  expect((await state()).id).toBe('iso');
  expect(errors).toEqual([]);
});

test('a worm → belt train holds together at all four iso azimuths (§ rotation ISO)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['worm', 'belt']);
  await showView(page, 'teeth');
  const readings = {};
  for (const view of ['iso', 'iso-90', 'iso-180', 'iso-270']) {
    await page.evaluate(id => window.__viewer.setProjection(id), view);
    const seen = await page.evaluate(() => {
      const model = window.__viewer.renderer().model;
      const wheels = {};
      model.wheels.forEach(w => { wheels[w.memberId] = w; });
      const link = model.stages[1].links[0];
      const geometry = link && link.geometry;
      const worm = model.wheels.filter(w => w.kind === 'worm')[0];
      const wheel = model.wheels.filter(w => w.memberId === 's0-output')[0];
      const io = model.io;
      return {
        // La vis garde son arbre, son sens d'hélice et sa place axiale : la
        // caméra ne touche pas à la mécanique.
        wormBody: worm && worm.bodyId, wormHand: worm && worm.handedness,
        // La position AXIALE de la vis sur son arbre : une donnée du monde,
        // que la caméra ne peut pas toucher.
        wormSeat: (model.spatial.members.filter(m => m.id === (worm && worm.memberId))[0] || {}).axialPosition,
        // La roue de la vis et la poulie de l'étage suivant partagent un arbre.
        shared: wheel && wheels['s1-input'] ? wheel.bodyId === wheels['s1-input'].bodyId : null,
        // La courroie garde ses deux poulies et leurs rayons : c'est ce qui
        // fait qu'elle reste tangente, quel que soit l'azimut.
        pulleys: geometry ? geometry.circles.map(c => c.radius.toFixed(3)).join('|') : null,
        parts: geometry ? geometry.parts.length : 0,
        // Les deux brins sont à des profondeurs différentes : l'un passe
        // devant les poulies, l'autre derrière.
        depths: geometry ? new Set(geometry.parts.map(p => p.depth.toFixed(3))).size : 0,
        // ENTRÉE et SORTIE suivent l'ARBRE PROJETÉ : c'est la direction que
        // la flèche porte, pas une règle gauche/droite d'écran.
        input: (document.querySelector('#svgContainer .io-chip.in') || {}).dataset.along,
        output: (document.querySelector('#svgContainer .io-chip.out') || {}).dataset.along,
        // Le texte reste horizontal quel que soit l'azimut.
        upright: Array.from(document.querySelectorAll('#svgContainer .io-chip text'))
          .every(t => !t.getAttribute('transform')),
        member: io.input ? io.input.memberId : null
      };
    });
    expect(seen.wormBody, view).toBeTruthy();
    expect(seen.wormHand, view).toBe('right');
    expect(seen.shared, view + ' : la roue et la poulie ont perdu leur arbre commun').toBe(true);
    expect(seen.parts, view + ' : la courroie n’a plus ses quatre portions').toBe(4);
    expect(seen.depths, view + ' : les deux brins sont à la même profondeur').toBeGreaterThan(1);
    expect(seen.input, view + ' : entrée sans direction').toMatch(/^-?[\d.]+,-?[\d.]+$/);
    expect(seen.output, view + ' : sortie sans direction').toMatch(/^-?[\d.]+,-?[\d.]+$/);
    expect(seen.upright, view + ' : le texte a tourné avec la caméra').toBe(true);
    readings[view] = seen;
  }
  const first = readings.iso;
  Object.keys(readings).forEach(view => {
    // Ce qui appartient à la MÉCANIQUE ne bouge pas d'un azimut à l'autre :
    // l'arbre de la vis, son sens d'hélice, sa position axiale, les rayons de
    // poulie. Une vis à droite ne devient pas gauche par un miroir d'écran.
    ['wormBody', 'wormHand', 'wormSeat', 'pulleys', 'shared', 'member'].forEach(key =>
      expect(readings[view][key], view + ' : ' + key + ' a changé avec la caméra')
        .toEqual(first[key]));
  });
  // Et ce qui appartient au DESSIN change bien : quatre azimuts, quatre
  // directions d'entrée.
  expect(new Set(Object.keys(readings).map(v => readings[v].input)).size).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('four planetary stages stand side by side, not stacked (§ plan axial)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['planetary', 'planetary', 'planetary', 'planetary']);
  await showView(page, 'teeth');

  for (const view of ['front', 'iso', 'iso-90', 'iso-180', 'iso-270']) {
    await page.evaluate(id => window.__viewer.setProjection(id), view);
    const seen = await page.evaluate(() => {
      const model = window.__viewer.renderer().model;
      const stages = model.stages.map(entry => {
        const bodies = entry.wheels.filter(w => w.role === 'sun' || w.role === 'ring' || w.role === 'planet');
        return {
          // Le plan de l'étage, dans le MONDE : c'est lui qui ne doit plus
          // revenir à zéro pour les étages 2, 3 et 4.
          axial: bodies.map(w => model.spatial.byId[w.memberId].axialPosition),
          place: bodies.map(w => w.cx.toFixed(3) + ',' + w.cy.toFixed(3) + '@' + w.depth.toFixed(3))
        };
      });
      return { stages: stages,
        labels: Array.from(document.querySelectorAll('#svgContainer .stage-label'))
          .map(t => t.getAttribute('x') + ',' + t.getAttribute('y')) };
    });
    expect(seen.stages.length, view).toBe(4);
    const seats = seen.stages.map(stage => {
      // Tous les corps d'un étage partagent UN plan axial.
      const first = stage.axial[0];
      stage.axial.forEach(at => expect(Math.abs(at - first), view + ' : corps hors du plan').toBeLessThan(1e-6));
      return first;
    });
    // Et les quatre plans avancent le long de l'axe : aucun ne revient à zéro.
    seats.forEach((seat, i) => {
      if (i === 0) return;
      expect(seat, view + ' : étage ' + (i + 1) + ' revenu en arrière').toBeGreaterThan(seats[i - 1]);
    });
    expect(new Set(seats).size, view + ' : deux étages dans le même plan').toBe(4);
    // Le dessin le montre : quatre places distinctes, jamais quatre fois la
    // même. C'est ce que la capture d'origine donnait — quatre mécanismes
    // empilés au même endroit.
    const places = seen.stages.map(stage => stage.place[0]);
    expect(new Set(places).size, view + ' : deux étages au même endroit').toBe(4);
    // Les libellés suivent, au lieu de s'accumuler sur le premier étage.
    expect(new Set(seen.labels).size, view + ' : libellés empilés').toBe(seen.labels.length);
  }
  expect(errors).toEqual([]);
});

test('every reference chain survives all four iso azimuths (§ régression ISO)', async ({ page }) => {
  const errors = watchErrors(page);
  const chains = [
    ['spur', 'belt'], ['worm', 'belt'], ['worm', 'spur'], ['bevel', 'spur'],
    ['planetary', 'spur'], ['planetary', 'planetary'], ['spur', 'planetary', 'belt']
  ];
  for (const chain of chains) {
    await mount(page, chain);
    await showView(page, 'teeth');
    const worlds = new Set();
    for (const view of ['iso', 'iso-90', 'iso-180', 'iso-270']) {
      await page.evaluate(id => window.__viewer.setProjection(id), view);
      const seen = await page.evaluate(() => {
        const model = window.__viewer.renderer().model;
        const svg = document.querySelector('#svgContainer svg');
        return {
          // Le MONDE, inchangé d'un azimut à l'autre.
          world: model.spatial.members.map(m => m.id + '@' + m.position.map(v => v.toFixed(6)).join(',')).join('|'),
          // Le dessin, lui, change — et reste fini.
          drawn: svg.querySelectorAll('.train-wheel').length,
          nan: /NaN|Infinity/.test(svg.outerHTML),
          // Aucun organe n'a perdu son arbre.
          orphans: model.wheels.filter(w => !w.bodyId).length
        };
      });
      worlds.add(seen.world);
      expect(seen.drawn, chain.join('→') + ' / ' + view + ' : dessin vide').toBeGreaterThan(1);
      expect(seen.nan, chain.join('→') + ' / ' + view + ' : géométrie non finie').toBe(false);
      expect(seen.orphans, chain.join('→') + ' / ' + view + ' : organe sans arbre').toBe(0);
    }
    // Tourner la caméra n'a pas touché une seule pièce du mécanisme.
    expect(worlds.size, chain.join('→') + ' : le monde a bougé avec la caméra').toBe(1);
  }
  expect(errors).toEqual([]);
});

test('the view cube changes the point of view by showing it (§ cube de vue)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'belt']);
  await showView(page, 'teeth');
  const cube = page.locator('#viewerCube');
  const select = page.locator('#viewerProjection');

  await expect(cube).toBeVisible();
  // De face, le cube n'offre qu'UNE face : c'est ce qu'un cube montre, et
  // proposer celles de derrière n'aurait pas de sens.
  await expect(cube.locator('.view-cube-face')).toHaveCount(1);

  // Cliquer un COIN mène à l'isométrie, et le cube tourne avec la caméra.
  const drawingOf = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#viewerCube .view-cube-face'))
      .map(f => f.dataset.view + ':' + f.getAttribute('d')).join('|'));
  await cube.locator('.view-cube-corner').first().click();
  await expect(select).toHaveValue('iso');
  expect(await page.evaluate(() => window.__viewer.projection)).toMatch(/^iso/);
  const first = await drawingOf();

  // De biais, trois faces s'ouvrent : cliquer l'une d'elles mène à la vue
  // qu'elle montre, sans passer par la liste.
  await expect(cube.locator('.view-cube-face')).toHaveCount(3);
  await cube.locator('[data-view="top"]').click();
  await expect(select).toHaveValue('top');
  await expect(cube.locator('.view-cube-face.is-active')).toHaveAttribute('data-view', 'top');
  await cube.locator('.view-cube-corner').first().click();
  await expect(select).toHaveValue('iso');

  // Un coin de plus : un quart de tour, et un cube redessiné.
  const before = await page.evaluate(() => window.__viewer.projection);
  await cube.locator('.view-cube-corner').first().click();
  const after = await page.evaluate(() => window.__viewer.projection);
  expect(after).not.toBe(before);
  expect(await drawingOf()).not.toBe(first);
  // Le cube et le dessin regardent le même endroit : c'est la MÊME caméra.
  const agreed = await page.evaluate(() => {
    const seen = window.GearProjectionEngine.view(window.__viewer.projection);
    const faces = Array.from(document.querySelectorAll('#viewerCube .view-cube-face'));
    // Une face dessinée est une face que la caméra regarde.
    return faces.every(face => {
      const entry = window.GearViewCube.FACES.filter(f => f.view === face.dataset.view)[0];
      const facing = -(entry.normal[0] * seen.w[0] + entry.normal[1] * seen.w[1] + entry.normal[2] * seen.w[2]);
      return facing > 0;
    }) && faces.length === 3;
  });
  expect(agreed, 'le cube ne regarde pas où regarde le dessin').toBe(true);

  // Au clavier comme à la souris.
  await cube.locator('[data-view="front"]').focus();
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('front');

  // La Cinématique est un schéma : elle n'a pas de point de vue à offrir.
  await showView(page, 'kinematic');
  await expect(cube).toBeHidden();
  await showView(page, 'geometry');
  await expect(cube).toBeVisible();
  expect(errors).toEqual([]);
});

test('clicking designates a part, a shaft or a mesh — not always its stage (§ sélection)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'planetary']);
  await showView(page, 'teeth');
  const state = () => page.evaluate(() => ({
    selection: window.__viewer.selection,
    stage: window.__viewer.selectedStage,
    title: (document.querySelector('#stageInspector .type-badge') || {}).textContent,
    rows: Array.from(document.querySelectorAll('#stageInspector .inspector-grid > div')).map(d => d.textContent),
    marked: Array.from(document.querySelectorAll('#svgContainer .is-selected'))
      .map(el => el.dataset.member || el.dataset.shaft || el.dataset.mesh),
    lit: document.querySelectorAll('#svgContainer .rigid-highlight').length
  }));

  // UNE ROUE. Le dessin répondait « étage 2 » quand la question était
  // « quelle roue, et à quelle vitesse ? ».
  await page.locator('#svgContainer .train-wheel[data-member="s0-input"] .tooth-profile')
    .first().click({ force: true });
  const wheel = await state();
  expect(wheel.selection.type).toBe('member');
  expect(wheel.selection.id).toBe('s0-input');
  // Désigner une roue désigne aussi l'étage où elle se trouve : les commandes
  // qui ne connaissent qu'un étage continuent de fonctionner.
  expect(wheel.stage).toBe(0);
  expect(wheel.marked).toEqual(['s0-input']);
  expect(wheel.rows.join(' ')).toContain('Dents');
  expect(wheel.rows.join(' ')).toContain('15');
  // Et tout ce qui tourne avec elle s'allume, sans qu'on ait à survoler.
  expect(wheel.lit).toBeGreaterThan(0);

  // UN ENGRÈNEMENT. La ligne d'action n'existe qu'au plus fin niveau de
  // détail et seulement vu de face ; la poignée, elle, existe toujours.
  await page.locator('#svgContainer .mesh-handle').first().click({ force: true });
  const mesh = await state();
  expect(mesh.selection.type).toBe('mesh');
  expect(mesh.title).toContain('Engrènement');
  expect(mesh.rows.join(' ')).toContain('Rapport');
  expect(mesh.rows.join(' ')).toContain('Entraxe');

  // UN ARBRE. Aucune fiche n'en parlait, alors que c'est l'objet qu'on
  // dimensionne. Vu en bout il est caché par sa roue : on le désigne alors
  // depuis la fiche de l'organe.
  await page.evaluate(() => window.__viewer.setProjection('front'));
  const spot = await page.evaluate(() => {
    for (const shaft of document.querySelectorAll('#svgContainer .train-shaft')) {
      for (const target of shaft.querySelectorAll('.shaft-hit, .shaft-hit-point')) {
        const box = target.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        for (const t of [0.5, 0.25, 0.75]) {
          const x = box.x + box.width * t, y = box.y + box.height * 0.5;
          const hit = document.elementFromPoint(x, y);
          if (hit && shaft.contains(hit)) return { x, y };
        }
      }
    }
    return null;
  });
  expect(spot, 'un arbre doit pouvoir être désigné : un trait fin ne s’attrape pas').not.toBeNull();
  // À CÔTÉ du trait, pas dessus. Un arbre se dessine en trait fin — c'est ce
  // qu'il doit être — et à l'échelle d'un train entier ce trait fait moins
  // d'un pixel : sans zone de prise, le curseur tombe toujours à côté.
  await page.mouse.click(spot.x, spot.y + 2.5);
  const shaft = await state();
  expect(shaft.selection.type).toBe('shaft');
  expect(shaft.title).toContain('Arbre');
  expect(shaft.rows.join(' ')).toContain('rpm');
  // Un arbre traverse plusieurs étages : il peut n'en désigner aucun, et
  // prétendre le contraire ferait cadrer sur un étage choisi au hasard.
  expect(shaft.selection.stageIndex).toBeNull();
  // Tous ses organes sont marqués, pas seulement un.
  expect(shaft.marked.length).toBeGreaterThan(0);

  // LE VIDE, c'est l'ensemble : la fiche se referme. Un coin du dessin, où il
  // n'y a rien — pas hors du dessin, qui ne serait plus le viewer du tout.
  await page.locator('#svgContainer svg').click({ position: { x: 4, y: 4 } });
  const empty = await page.evaluate(() => ({
    type: window.__viewer.selection.type,
    hidden: document.getElementById('stageInspector').hidden
  }));
  expect(empty.type).toBeNull();
  expect(empty.hidden).toBe(true);

  // La sélection TRAVERSE le re-rendu : changer de point de vue ne fait pas
  // perdre la pièce qu'on lisait.
  await page.locator('#svgContainer .train-wheel[data-member="s0-output"] .tooth-profile')
    .first().click({ force: true });
  await page.evaluate(() => window.__viewer.setProjection('iso'));
  const kept = await state();
  expect(kept.selection.id).toBe('s0-output');
  expect(kept.marked).toEqual(['s0-output']);
  expect(errors).toEqual([]);
});

test('one satellite of five is one satellite, not five (§ sélection)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['planetary']);
  await showView(page, 'teeth');
  // Cinq satellites portent le même identifiant de membre : sans le numéro
  // d'exemplaire, en désigner un les allumerait tous.
  const planets = page.locator('#svgContainer .train-wheel.planet[data-instance]');
  await expect(planets).toHaveCount(5);
  await planets.nth(2).locator('.tooth-profile').first().click({ force: true });
  const seen = await page.evaluate(() => ({
    selection: window.__viewer.selection,
    marked: Array.from(document.querySelectorAll('#svgContainer .train-wheel.is-selected'))
      .map(el => el.dataset.instance)
  }));
  expect(seen.selection.type).toBe('member');
  expect(seen.selection.instance).toBe(2);
  expect(seen.marked).toEqual(['2']);
  expect(errors).toEqual([]);
});

test('isolating keeps what you are reading and fades the rest (§ isoler)', async ({ page }) => {
  const errors = watchErrors(page);
  await mount(page, ['spur', 'planetary', 'spur']);
  await showView(page, 'teeth');
  await page.evaluate(() => window.__viewer.setProjection('front'));
  const context = page.locator('#viewerIsolateContext');
  const only = page.locator('#viewerIsolateOnly');
  const counts = () => page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    const opacity = selector => {
      const el = document.querySelector(selector);
      return el ? Number(getComputedStyle(el).opacity) : null;
    };
    return {
      near: svg.querySelectorAll('.is-near').length,
      far: svg.querySelectorAll('.is-far').length,
      isolating: svg.classList.contains('is-isolating'),
      keptOpacity: opacity('#svgContainer .is-near'),
      fadedOpacity: opacity('#svgContainer .is-far')
    };
  });

  // Sans rien de sélectionné, il n'y a rien à isoler : estomper la totalité du
  // dessin reviendrait à l'éteindre.
  await expect(context).toBeDisabled();
  await expect(only).toBeDisabled();
  expect((await counts()).isolating).toBe(false);

  // Le solaire d'un planétaire est derrière ses satellites : on le DÉSIGNE,
  // au lieu de cliquer un point que le tri de profondeur donne à un autre —
  // ce que teste déjà la sélection, et qui n'est pas le sujet ici.
  await page.evaluate(() => window.__viewer.select(
    window.GearSelection.of('member', 's1-S', { stageIndex: 1 })));
  await expect(context).toBeEnabled();

  await context.click();
  // L'estompage est une TRANSITION : la mesurer avant qu'elle ne se termine
  // relèverait l'opacité de départ, c'est-à-dire 1.
  const settled = () => page.waitForFunction(() => {
    const faded = document.querySelector('#svgContainer .is-far');
    if (!faded) return false;
    const value = Number(getComputedStyle(faded).opacity);
    return value === 0 || value < 0.4;
  });
  await settled();
  const ghosted = await counts();
  expect(ghosted.isolating).toBe(true);
  await expect(context).toHaveAttribute('aria-pressed', 'true');
  // Ce qu'on lit reste net, le reste s'estompe — mais reste là : on voit OÙ
  // se trouve la pièce dans le mécanisme.
  expect(ghosted.near, 'rien n’est resté au premier plan').toBeGreaterThan(0);
  expect(ghosted.far, 'rien n’a été estompé').toBeGreaterThan(0);
  expect(ghosted.keptOpacity).toBe(1);
  expect(ghosted.fadedOpacity).toBeGreaterThan(0);
  expect(ghosted.fadedOpacity).toBeLessThan(0.4);

  // « Seul » va au bout : le reste disparaît.
  await only.click();
  await page.waitForFunction(() => {
    const faded = document.querySelector('#svgContainer .is-far');
    return faded && Number(getComputedStyle(faded).opacity) === 0;
  });
  const alone = await counts();
  await expect(only).toHaveAttribute('aria-pressed', 'true');
  await expect(context).toHaveAttribute('aria-pressed', 'false');
  expect(alone.keptOpacity).toBe(1);
  expect(alone.fadedOpacity).toBe(0);
  // Rien n'a été déplacé ni recalculé : c'est une affaire d'opacité, et une
  // pièce estompée reste exactement à sa place.
  expect(alone.near + alone.far).toBe(ghosted.near + ghosted.far);

  // Ce qui TOURNE AVEC la pièce reste avec elle : isoler un organe ne le
  // sépare pas de son arbre.
  const kept = await page.evaluate(() => Array.from(document.querySelectorAll('#svgContainer .is-near'))
    .map(el => el.dataset.member || el.dataset.shaft).filter(Boolean));
  expect(kept).toContain('s1-S');
  expect(kept.some(id => /shaft/.test(id)), 'l’arbre de la pièce a été estompé').toBe(true);

  // Et ce qui est SOLIDAIRE reste avec elle. La roue menée du premier étage et
  // le solaire du deuxième sont un seul corps tournant : isoler l'une sans
  // l'autre montrerait une pièce coupée de ce qui l'entraîne.
  await page.evaluate(() => window.__viewer.select(
    window.GearSelection.of('member', 's0-output', { stageIndex: 0 })));
  const solidary = await page.evaluate(() => Array.from(document.querySelectorAll('#svgContainer .is-near'))
    .map(el => el.dataset.member).filter(Boolean));
  expect(solidary).toContain('s0-output');
  expect(solidary, 'le corps solidaire a été estompé').toContain('s1-S');
  await page.evaluate(() => window.__viewer.select(
    window.GearSelection.of('member', 's1-S', { stageIndex: 1 })));

  // Le même bouton en sort.
  await only.click();
  const back = await counts();
  expect(back.isolating).toBe(false);
  expect(back.far).toBe(0);

  // Et refermer la sélection referme l'isolation : il n'y a plus rien à isoler.
  await context.click();
  expect((await counts()).isolating).toBe(true);
  await page.locator('#svgContainer svg').click({ position: { x: 4, y: 4 } });
  expect((await counts()).isolating).toBe(false);
  await expect(context).toBeDisabled();
  expect(errors).toEqual([]);
});

test('stage labels find their own place on a dense train (§ étiquettes)', async ({ page }) => {
  const errors = watchErrors(page);
  // Quatre planétaires COAXIAUX : ils partagent une abscisse, et c'est le cas
  // que les deux couloirs — pairs au-dessus, impairs en dessous — mettaient
  // bout à bout, très loin de ce qu'ils désignent.
  await mount(page, ['planetary', 'planetary', 'planetary', 'planetary']);
  await showView(page, 'teeth');
  for (const view of ['front', 'iso', 'iso-90']) {
    await page.evaluate(id => window.__viewer.setProjection(id), view);
    const seen = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('#svgContainer .train-label'));
      const visible = labels.filter(l => l.getAttribute('display') !== 'none');
      const boxes = visible.map(l => l.getBoundingClientRect());
      let clashes = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const wide = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const high = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (wide > 1 && high > 1) clashes++;
        }
      }
      // Chaque libellé posé loin est RELIÉ à l'étage qu'il nomme : sans le
      // trait, un texte à l'écart ne désigne plus rien.
      const leaders = Array.from(document.querySelectorAll('#svgContainer .label-leader'));
      return { total: labels.length, shown: visible.length, clashes, leaders: leaders.length,
        texts: visible.map(l => l.textContent) };
    });
    expect(seen.total, view).toBe(4);
    expect(seen.shown, view + ' : des libellés ont disparu').toBe(4);
    expect(seen.clashes, view + ' : libellés superposés').toBe(0);
    expect(seen.leaders, view + ' : libellés éloignés sans ligne de rappel').toBeGreaterThan(0);
    // Les quatre étages sont nommés, chacun le sien.
    expect(new Set(seen.texts).size).toBe(4);
  }

  // L'étage DÉSIGNÉ passe devant : c'est celui qu'on lit, et le perdre au
  // profit d'un voisin serait le contraire de ce qu'on demande au dessin.
  await page.evaluate(() => window.__viewer.selectStage(2));
  const chosen = await page.evaluate(() => {
    const label = document.querySelector('#svgContainer .train-label[data-label-stage="2"]');
    return { hidden: label.getAttribute('display') === 'none', text: label.textContent };
  });
  expect(chosen.hidden).toBe(false);
  expect(chosen.text).toContain('Étage 3');
  expect(errors).toEqual([]);
});

test('the exploded view opens what the mechanism hides, and says it is not to scale (§9)', async ({ page }) => {
  const errors = watchErrors(page);
  // Un train épicycloïdal est le cas qui justifie la commande : planétaire,
  // couronne, porte-satellites et satellites occupent le MÊME plan axial.
  // Aucun cadrage, aucun point de vue ne les sépare — ils sont réellement au
  // même endroit.
  await mount(page, ['planetary', 'planetary']);
  await showView(page, 'teeth');
  const assembled = page.locator('#viewerAssembled');
  const exploded = page.locator('#viewerExploded');
  await expect(exploded).toBeVisible();
  await expect(assembled).toHaveAttribute('aria-pressed', 'true');

  // Les abscisses DESSINÉES de chaque organe, prises sur le SVG lui-même : ce
  // qui compte est ce que l'utilisateur voit, pas ce que le modèle contient.
  const drawn = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#svgContainer [data-member]').forEach(node => {
      const box = node.getBoundingClientRect();
      if (box.width || box.height) out[node.dataset.member] = box.x + box.width / 2;
    });
    return out;
  });
  // Les abscisses du MODÈLE mécanique, qu'aucun dessin n'a le droit de changer.
  const model = () => page.evaluate(() => JSON.stringify(window.__viewer.teeth.model.graph.shafts
    .map(shaft => shaft.members.map(member => member.axialPosition))));

  const closed = await drawn();
  const before = await model();
  expect(Object.keys(closed).length, 'aucun organe identifié dans le dessin').toBeGreaterThan(3);

  await exploded.click();
  await expect(exploded).toHaveAttribute('aria-pressed', 'true');
  await expect(assembled).toHaveAttribute('aria-pressed', 'false');
  const open = await drawn();

  // Le modèle n'a pas bougé d'un millimètre : c'est une transformation de
  // PRÉSENTATION, et elle doit le rester.
  expect(await model()).toBe(before);

  // Le dessin, lui, s'est ouvert : les organes qui se recouvraient ont chacun
  // leur place.
  const spread = places => {
    const xs = Object.keys(places).map(id => places[id]);
    return Math.max(...xs) - Math.min(...xs);
  };
  expect(spread(open), 'le dessin ne s’est pas ouvert').toBeGreaterThan(spread(closed) + 10);
  // Et deux corps d'un même étage, confondus jusqu'ici, se distinguent.
  expect(Math.abs(open['s0-S'] - open['s0-R'])).toBeGreaterThan(4);

  // Ce dessin ne se cote pas, et il le dit lui-même.
  await expect(page.locator('#viewerFidelity')).toContainText('Vue éclatée — espacement non à l’échelle');

  // Refermer revient exactement d'où l'on vient.
  await assembled.click();
  await expect(assembled).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#viewerFidelity')).not.toContainText('Vue éclatée');
  expect(spread(await drawn())).toBeCloseTo(spread(closed), 0);
  expect(errors).toEqual([]);
});
