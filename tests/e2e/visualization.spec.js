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
    const centre1 = link.path.centre1, centre2 = link.path.centre2;
    const positions = [];
    // Un tour complet de COURROIE, pas d'arbre : la courroie est bien plus
    // longue que la circonférence de la petite poulie.
    const perRevolution = Math.PI * 2 * link.path.radius1;
    const span = 360 * link.path.length / perRevolution;
    for (let i = 0; i <= 120; i++) {
      renderer.setAnimationAngle(i * span / 120);
      const t = marker.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/);
      const x = Number(t[1]), y = Number(t[2]);
      positions.push({ x, y,
        d1: Math.hypot(x - centre1.x, y - centre1.y), d2: Math.hypot(x - centre2.x, y - centre2.y) });
    }
    return { positions, r1: link.path.radius1, r2: link.path.radius2 };
  });
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
  for (const view of ['front', 'top', 'side', 'iso']) {
    seen[view] = await page.evaluate(v => {
      const renderer = window.__viewer.renderer();
      renderer.projection = v;
      renderer.render(renderer.solution);
      const model = renderer.model;
      return { view: model.view.id,
        drawing: model.wheels.map(w => w.cx.toFixed(2) + ',' + w.cy.toFixed(2)).join('|'),
        world: model.spatial.members.map(m => m.id + ':' + m.position.join(',')).join('|'),
        centres: model.stages.filter(s => Number.isFinite(s.centerDistance)).map(s =>
          Math.hypot(s.wheels[1].cx - s.wheels[0].cx, s.wheels[1].cy - s.wheels[0].cy) - s.centerDistance) };
    }, view);
    expect(seen[view].view, 'la vue demandée est celle qui est rendue').toBe(view);
    // Dans chaque vue, chaque engrènement reste à son entraxe calculé.
    seen[view].centres.forEach(gap => expect(Math.abs(gap)).toBeLessThan(1e-6));
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
  await expect(select).toHaveValue('');
  // La liste vient du moteur de projection : rien n'est réécrit dans l'UI.
  const offered = await select.locator('option').evaluateAll(list => list.map(o => o.value));
  const known = await page.evaluate(() => GearProjectionEngine.VIEWS.map(v => v.id));
  expect(offered).toEqual([''].concat(known));

  const shot = () => page.evaluate(() => {
    const svg = document.querySelector('#svgContainer svg');
    const model = window.__viewer.renderer().model;
    return { announced: svg.dataset.view,
      drawing: model.wheels.map(w => w.cx.toFixed(2) + ',' + w.cy.toFixed(2)).join('|'),
      world: model.spatial.members.map(m => m.id + ':' + m.position.join(',')).join('|') };
  });

  const automatic = await shot();
  const drawings = new Set([automatic.drawing]);
  for (const id of known) {
    await select.selectOption(id);
    const seen = await shot();
    // Ce que la commande promet : le dessin change, la mécanique non.
    expect(seen.announced, id).toBe(id);
    expect(seen.world, id + ' : aucune pièce ne bouge').toBe(automatic.world);
    drawings.add(seen.drawing);
  }
  expect(drawings.size, 'chaque point de vue doit donner un dessin distinct').toBeGreaterThan(1);

  // Retour à l'automatique : on retrouve exactement le dessin de départ.
  await select.selectOption('');
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
  await select.selectOption('');

  // La Cinématique aussi, et elle annonce celui qu'elle a retenu.
  await showView(page, 'kinematic');
  await expect(select).toBeEnabled();
  await select.selectOption('iso');
  await expect(page.locator('#svgContainer svg')).toHaveAttribute('data-projection', 'iso');
  await select.selectOption('top');
  await expect(page.locator('#svgContainer svg')).toHaveAttribute('data-projection', 'top');
  await select.selectOption('');
  await showView(page, 'teeth');

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
