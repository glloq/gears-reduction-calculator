const { test, expect } = require('@playwright/test');
const { watchConsoleErrors } = require('./console-errors.js');

// ===== LA MATRICE DE VALIDATION =====
//
// Le dépôt teste énormément la géométrie, et beaucoup de comportements. Il
// manquait la dernière couche : PROUVER que chaque transmission reste correcte
// dans chaque vue, chaque projection, chaque style et chaque état d'affichage —
// et pas seulement qu'elle produit un SVG sans NaN.
//
// Le produit cartésien complet ferait des milliers de rendus pour un gain
// décroissant. La matrice est donc coupée en deux, comme il se doit :
//
//   AXE EXHAUSTIF — toutes les familles × les onze états spatiaux × les deux
//   vues spatiales. C'est là que vivent les erreurs de projection, et il n'y a
//   aucune raison d'en échantillonner une partie.
//
//   AXE CIBLÉ — style technique, éclatement, phases d'animation. Ces états ne
//   changent pas la géométrie du mécanisme : ils changent le vocabulaire du
//   tracé. Quelques assemblages représentatifs suffisent à les tenir.
//
// Ce qui est vérifié n'est jamais « il y a du SVG » : ce sont des invariants
// qu'un dessin faux viole nécessairement.

const STAGES = {
  spur: { type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } },
  helical: { type: 'helical', input: { teeth: 18 }, output: { teeth: 54 }, parameters: { module: 2, helixAngle: 25, pressureAngle: 20, faceWidth: 20 } },
  helicalLeft: { type: 'helical', input: { teeth: 18 }, output: { teeth: 54 }, parameters: { module: 2, helixAngle: 25, handedness: 'left', pressureAngle: 20, faceWidth: 20 } },
  internal: { type: 'internal', input: { teeth: 18 }, output: { teeth: 54 }, parameters: { module: 2, pressureAngle: 20 } },
  bevel: { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 90, faceWidth: 15 } },
  bevel60: { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 60, faceWidth: 15 } },
  worm: { type: 'worm', wormStarts: 2, wheelTeeth: 40, parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } },
  belt: { type: 'belt', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { pitch: 5, centerDistance: 150, profile: 'HTD-5M' } },
  beltCrossed: { type: 'belt', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { pitch: 5, centerDistance: 150, profile: 'HTD-5M', crossed: true } },
  chain: { type: 'chain', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { pitch: 12.7, centerDistance: 250 } },
  planetary: { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 5, inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2, faceWidth: 20 } },
  rack: { type: 'rack', pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } }
};

/** Les onze états spatiaux : la vue dépliée, six orthographiques, quatre isométries. */
const CAMERAS = ['unfolded', 'front', 'rear', 'top', 'bottom', 'side', 'side-far',
  'iso', 'iso-90', 'iso-180', 'iso-270'];

const ASSEMBLIES = [
  ['spur'], ['helical'], ['helicalLeft'], ['internal'], ['bevel'], ['bevel60'], ['worm'],
  ['belt'], ['beltCrossed'], ['chain'], ['planetary'], ['rack'],
  ['spur', 'bevel'], ['worm', 'spur'], ['belt', 'spur'], ['planetary', 'spur'], ['bevel', 'worm']
];

async function prepare(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.GearApp && GearApp.visualization && GearApp.visualization.ViewerToolbar);
  const modal = page.locator('#searchModal');
  if (await modal.isVisible()) await page.locator('#searchModalClose').click();
  await page.evaluate(() => {
    document.body.classList.add('has-results');
    window.__viewer = new GearApp.visualization.ViewerToolbar(document.getElementById('svgContainer'));
    window.__viewer.bind();

    // ===== LA BATTERIE D'INVARIANTS, posée une fois dans la page =====
    window.__inspect = function (view) {
      const svg = document.querySelector('#svgContainer svg');
      const problems = [];
      if (!svg) return ['aucun SVG produit'];

      // (0) Une coordonnée indéfinie efface la pièce sans rien dire.
      Array.from(svg.querySelectorAll('*')).forEach(el => {
        Array.from(el.attributes || []).forEach(a => {
          if (/NaN|Infinity|undefined/.test(a.value)) {
            problems.push('attribut ' + a.name + ' de <' + el.tagName + '> = ' + a.value);
          }
        });
      });

      // (1) CHAQUE ÉTAGE EST DESSINÉ. Un étage qui disparaît d'une vue est le
      //     défaut le plus grave et le plus silencieux : le dessin reste beau.
      const stages = new Set(Array.from(svg.querySelectorAll('[data-stage]'))
        .map(el => el.dataset.stage));
      const expected = (window.__solution.stages || []).length;
      for (let i = 0; i < expected; i++) {
        if (!stages.has(String(i))) problems.push('étage ' + (i + 1) + ' absent du dessin');
      }
      if (!svg.querySelector('path, ellipse, circle, rect, line')) problems.push('dessin vide');
      if (view === 'kinematic') return problems;

      const model = view === 'geometry' ? window.__viewer.geometry.layout : window.__viewer.teeth.model;
      const frame = view === 'geometry' ? model.frame : model;
      if (!model) return problems.concat('aucun modèle de dessin');

      // (2) LA PLACE DESSINÉE d'un organe est la projection de sa place dans
      //     l'espace. Tout le reste en découle.
      if (frame.mode !== 'unfolded') {
        // La vue cotée POSE chaque étage côte à côte pour les mesurer : ses
        // organes sont donc translatés en bloc, étage par étage. Ce qui doit
        // rester vrai, c'est la forme de l'étage — les écarts entre ses organes,
        // que la translation ne change pas.
        const groups = view === 'geometry'
          ? model.stages.map(s => s.members || [])
          : [model.wheels];
        groups.forEach((drawn, index) => {
          const probes = [];
          drawn.forEach(part => {
            const placed = frame.spatial.byId[part.memberId];
            if (!placed || (Number.isFinite(part.orbit) && part.orbit > 0)) return;
            const xy = GearProjectionEngine.project(placed.position, frame.view);
            probes.push({ id: part.memberId, x: xy[0] - part.cx, y: xy[1] - part.cy });
          });
          probes.slice(1).forEach(p => {
            const gap = Math.hypot(p.x - probes[0].x, p.y - probes[0].y);
            if (gap > 0.05) {
              problems.push('étage ' + (index + 1) + ' : organe ' + p.id + ' à ' +
                gap.toFixed(2) + ' mm de sa projection');
            }
          });
        });
      }
      if (view === 'geometry') return problems;

      // (3) LE REPÈRE où une primitive dessine est posé SUR L'AXE de la pièce,
      //     et l'ellipse qu'elle trace est celle que la projection donne à un
      //     cercle porté par cet axe.
      Array.from(svg.querySelectorAll('g[data-member]')).forEach(g => {
        const seen = model.projected && model.projected.member(g.dataset.member);
        // Une sonde prise DANS le rotor porterait, en plus du repère de l'axe, la
        // rotation propre de la roue : on mesurerait l'animation au lieu de la
        // pose. Les cercles de construction, eux, ne tournent pas.
        const probe = g.querySelector('.construction ellipse')
          || g.querySelector('ellipse, path.tooth-profile, path.oblique-body');
        if (!seen || !probe || !Number.isFinite(seen.axisAngleDeg)) return;
        const rel = svg.getCTM().inverse().multiply(probe.getCTM());
        const off = ((Math.atan2(rel.b, rel.a) * 180 / Math.PI - seen.axisAngleDeg) % 180 + 270) % 180 - 90;
        if (Math.abs(off) > 0.05) {
          problems.push('organe ' + g.dataset.member + ' dessiné à ' + off.toFixed(2) + '° de son axe');
        }
        const wanted = seen.apparent.minor / seen.apparent.major;
        Array.from(g.querySelectorAll('ellipse')).forEach(e => {
          const rx = Number(e.getAttribute('rx')), ry = Number(e.getAttribute('ry'));
          if (ry > 0.01 && Math.abs(rx / ry - wanted) > 0.02) {
            problems.push('organe ' + g.dataset.member + ' : ellipse ' + (rx / ry).toFixed(3) +
              ' au lieu de ' + wanted.toFixed(3));
          }
        });
      });

      // (4) DEUX ORGANES D'UN MÊME ARBRE restent alignés sur cet arbre.
      const byShaft = {};
      model.wheels.forEach(w => {
        if (!w.bodyId || (Number.isFinite(w.orbit) && w.orbit > 0)) return;
        (byShaft[w.bodyId] = byShaft[w.bodyId] || []).push(w);
      });
      Object.keys(byShaft).forEach(id => {
        const list = byShaft[id];
        const shaft = model.shafts && model.shafts.filter(s => s.id === id)[0];
        if (list.length < 2 || !shaft || !shaft.along) return;
        list.slice(1).forEach(w => {
          const across = Math.abs((w.cx - list[0].cx) * -shaft.along[1] + (w.cy - list[0].cy) * shaft.along[0]);
          if (across > 0.05) problems.push('arbre ' + id + ' : ' + w.memberId + ' à ' + across.toFixed(2) + ' mm en travers');
        });
      });

      // (5) LES DEUX CÔNES d'un couple ont un sommet commun.
      model.stages.forEach(entry => {
        if (entry.type !== 'bevel' || !entry.apex) return;
        // Éclaté, les deux cônes glissent chacun sur son axe : leurs sommets se
        // séparent, et c'est tout l'objet du geste. Les axes et leur point de
        // croisement, eux, restent à leur place — le sommet DE L'ASSEMBLAGE.
        if (model.exploded) return;
        entry.wheels.filter(w => w.kind === 'cone').forEach(w => {
          if (!Number.isFinite(w.coneAngleDeg)) return;
          const shaft = model.shafts && model.shafts.filter(s => s.id === w.bodyId)[0];
          if (model.mode === 'unfolded' && shaft && Math.hypot(shaft.along[0], shaft.along[1]) < 1e-9) return;
          const back = (w.pitchD / 2) / Math.tan(w.coneAngleDeg * Math.PI / 180);
          const minor = w.apparent ? w.apparent.minor / w.apparent.major : 0;
          const squeeze = model.mode === 'unfolded' ? 1 : Math.sqrt(Math.max(0, 1 - minor * minor));
          const t = (w.axisAngleDeg || 0) * Math.PI / 180, side = w.apexSide < 0 ? -1 : 1;
          const gap = Math.hypot(w.cx + Math.cos(t) * back * squeeze * side - entry.apex.x,
            w.cy + Math.sin(t) * back * squeeze * side - entry.apex.y);
          if (gap > 0.05) problems.push('conique : sommet de ' + w.memberId + ' à ' + gap.toFixed(2) + ' mm du sommet commun');
        });
      });

      // (6) CHAQUE BRIN de courroie ou de chaîne est tangent aux deux cercles
      //     primitifs projetés — y compris croisé, où les brins changent de côté.
      model.stages.forEach(entry => {
        (entry.links || []).forEach(link => {
          if (link.kind !== 'belt-span' && link.kind !== 'chain-span') return;
          const spans = ((link.geometry && link.geometry.parts) || []).filter(p => p.kind === 'line');
          if (!spans.length) { problems.push(link.kind + ' : aucun brin droit'); return; }
          spans.forEach(part => {
            const m = /M\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)/.exec(part.d || '');
            if (!m) { problems.push(link.kind + ' : brin non rectiligne'); return; }
            const p1 = [Number(m[1]), Number(m[2])], p2 = [Number(m[3]), Number(m[4])];
            const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len, ny = dx / len;
            entry.wheels.forEach(w => {
              if (!w.apparent) return;
              const dist = Math.abs((w.cx - p1[0]) * nx + (w.cy - p1[1]) * ny);
              const t = (w.axisAngleDeg || 0) * Math.PI / 180;
              const a = w.pitchD / 2 * (w.apparent.minor / w.apparent.major), b = w.pitchD / 2;
              const ux = nx * Math.cos(t) + ny * Math.sin(t), uy = -nx * Math.sin(t) + ny * Math.cos(t);
              const support = Math.hypot(a * ux, b * uy);
              if (Math.abs(dist - support) > 0.6) {
                problems.push(link.kind + ' : brin à ' + dist.toFixed(2) + ' du centre de ' +
                  w.memberId + ', tangente attendue à ' + support.toFixed(2));
              }
            });
          });
        });
      });
      return problems;
    };

    window.__mount = function (names, stages) {
      const chosen = names.map(n => JSON.parse(JSON.stringify(stages[n])));
      chosen.forEach(s => { if (s.type === 'rack') s.geometry = GearTransmissionRegistry.get('rack').calculateGeometry(s); });
      window.__solution = GearEngineering.analyzeSolution(chosen, 10, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
    };
  });
}

test('every family, in every view and every point of view (§ matrice)', async ({ page }) => {
  const errors = watchConsoleErrors(page);
  await prepare(page);
  const found = await page.evaluate(({ stages, assemblies, cameras }) => {
    const out = [];
    assemblies.forEach(names => {
      window.__mount(names, stages);
      ['teeth', 'geometry'].forEach(view => {
        window.__viewer.setView(view);
        cameras.forEach(camera => {
          window.__viewer.setProjection(camera);
          window.__viewer.render(window.__solution);
          window.__inspect(view).forEach(p => out.push(names.join('+') + ' · ' + view + ' · ' + camera + ' — ' + p));
        });
      });
      window.__viewer.setView('kinematic');
      window.__viewer.render(window.__solution);
      window.__inspect('kinematic').forEach(p => out.push(names.join('+') + ' · kinematic — ' + p));
    });
    return out;
  }, { stages: STAGES, assemblies: ASSEMBLIES, cameras: CAMERAS });
  expect(found, found.slice(0, 10).join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});

test('the technical style changes the vocabulary, never the geometry (§ matrice)', async ({ page }) => {
  // Le style technique n'est pas « le visuel en gris » : il retire les
  // remplissages, ajoute les axes et les traits cachés. Il ne doit rien
  // déplacer — sans quoi deux lectures du même mécanisme ne concorderaient pas.
  const errors = watchConsoleErrors(page);
  await prepare(page);
  const found = await page.evaluate(({ stages, cameras }) => {
    const out = [];
    [['spur'], ['bevel'], ['worm'], ['planetary'], ['chain'], ['rack']].forEach(names => {
      window.__mount(names, stages);
      window.__viewer.setView('teeth');
      cameras.forEach(camera => {
        const places = ['visual', 'technical'].map(style => {
          window.__viewer.setStyle(style);
          window.__viewer.setProjection(camera);
          window.__viewer.render(window.__solution);
          window.__inspect('teeth').forEach(p => out.push(names.join('+') + ' · ' + style + ' · ' + camera + ' — ' + p));
          return window.__viewer.teeth.model.wheels.map(w => [w.memberId, w.cx, w.cy, w.axisAngleDeg]);
        });
        if (JSON.stringify(places[0]) !== JSON.stringify(places[1])) {
          out.push(names.join('+') + ' · ' + camera + ' — le style technique a déplacé les organes');
        }
      });
      window.__viewer.setStyle('visual');
    });
    return out;
  }, { stages: STAGES, cameras: CAMERAS });
  expect(found, found.slice(0, 10).join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});

test('exploding opens the drawing and never touches a dimension (§ matrice)', async ({ page }) => {
  // La règle qui rend l'éclaté acceptable dans un logiciel de calcul : une cote
  // de 50 mm doit continuer à dire 50 mm même si les deux pièces sont
  // visuellement écartées de 100 de plus.
  const errors = watchConsoleErrors(page);
  await prepare(page);
  const found = await page.evaluate(({ stages, cameras }) => {
    const out = [];
    // CE QU'UNE COTE DIT, organe par organe. Comparer la liste des traits
    // cotés n'aurait rien prouvé : un autre point de vue trace d'autres traits
    // — des cercles vus de face, des génératrices vues de profil — sans qu'une
    // seule valeur change. Ce qui ne doit pas bouger, ce sont les GRANDEURS.
    const cotes = () => {
      const model = window.__viewer.currentView === 'geometry'
        ? window.__viewer.geometry.layout : window.__viewer.teeth.model;
      const parts = window.__viewer.currentView === 'geometry'
        ? [].concat.apply([], model.stages.map(s => s.members || [])) : model.wheels;
      const out = {};
      parts.forEach(p => {
        if (!p.memberId) return;
        out[p.memberId] = [p.pitchD, p.outsideD, p.rootD, p.pitchDiameter,
          p.outsideDiameter, p.rootDiameter, p.width, p.teeth]
          .map(v => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null)).join('/');
      });
      model.stages.forEach((entry, i) => {
        if (Number.isFinite(entry.centerDistance)) out['entraxe-' + i] = Math.round(entry.centerDistance * 1e6) / 1e6;
      });
      return JSON.stringify(out, Object.keys(out).sort());
    };
    [['spur'], ['bevel'], ['worm'], ['planetary'], ['spur', 'bevel']].forEach(names => {
      window.__mount(names, stages);
      ['teeth', 'geometry'].forEach(view => {
        window.__viewer.setView(view);
        cameras.forEach(camera => {
          window.__viewer.setProjection(camera);
          const measured = [false, true].map(open => {
            window.__viewer.setExplode(open);
            window.__viewer.render(window.__solution);
            window.__inspect(view).forEach(p => out.push(names.join('+') + ' · éclaté=' + open + ' · ' + view + ' · ' + camera + ' — ' + p));
            return cotes();
          });
          if (measured[0] !== measured[1]) {
            out.push(names.join('+') + ' · ' + view + ' · ' + camera + ' — l’éclatement a changé une cote : ' +
              measured[0] + ' ≠ ' + measured[1]);
          }
          window.__viewer.setExplode(false);
        });
      });
    });
    return out;
  }, { stages: STAGES, cameras: CAMERAS });
  expect(found, found.slice(0, 10).join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});

test('the animation advances without ever jumping (§ matrice)', async ({ page }) => {
  // Un tour d'ENTRÉE ne ramène pas le train à sa pose de départ : à 3:1, la roue
  // menée n'a fait qu'un tiers de tour. Ce qu'on peut exiger, et ce qu'un
  // spectateur voit tout de suite quand ça manque, c'est la CONTINUITÉ : d'un
  // pas d'animation au suivant, rien ne doit sauter. Un filet de vis qui se
  // recale brutalement à chaque pas, une roue qui repart de zéro au passage du
  // tour : c'est ce que ce test attrape.
  const errors = watchConsoleErrors(page);
  await prepare(page);
  const found = await page.evaluate(({ stages, cameras }) => {
    const out = [];
    // UNE POSE, et non la chaîne qui la décrit : « rotate(360) » et
    // « rotate(0) » sont le même dessin, et un test qui les distingue mesure la
    // mise en forme du texte.
    // Le plus grand ÉCART ANGULAIRE entre deux poses, en degrés.
    const turns = text => (text.match(/rotate\(([-\d.]+)/g) || []).map(t => Number(t.slice(7)));
    const biggestTurn = (a, b) => {
      const x = turns(a), y = turns(b);
      let worst = 0;
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        let delta = (y[i] - x[i]) % 360;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        worst = Math.max(worst, Math.abs(delta));
      }
      return worst;
    };
    const pose = () => Array.from(document.querySelectorAll(
      '#svgContainer .rotor, #svgContainer .worm-thread-phase, #svgContainer .carrier-arms'))
      .map(el => (el.getAttribute('transform') || '').replace(/rotate\(([-\d.]+)/g, function (whole, deg) {
        return 'rotate(' + (((Number(deg) % 360) + 360) % 360).toFixed(2);
      })).join('|');
    let everMoved = false;
    [['spur'], ['worm'], ['planetary'], ['rack'], ['belt']].forEach(names => {
      window.__mount(names, stages);
      window.__viewer.setView('teeth');
      cameras.forEach(camera => {
        window.__viewer.setProjection(camera);
        window.__viewer.render(window.__solution);
        const at = angle => { window.__viewer.teeth.setAnimationAngle(angle); return pose(); };
        const STEP = 5;
        let previous = at(0);
        for (let angle = STEP; angle <= 720; angle += STEP) {
          const now = at(angle);
          if (now !== previous) everMoved = true;
          const jump = biggestTurn(previous, now);
          // Un pas de 5° ne peut pas faire tourner un organe de plus de 5° :
          // toutes les vitesses relatives sont bornées par celle de l'entrée.
          if (jump > STEP * 1.5 + 0.2) {
            out.push(names.join('+') + ' · ' + camera + ' — saut de ' + jump.toFixed(1) +
              '° au passage de ' + angle + '°');
            break;
          }
          previous = now;
        }
        // On n'exige PAS un retour à la pose de départ après un nombre fixe de
        // tours : à 20:1, la roue menée ne revient qu'au vingtième, et les
        // repères d'une courroie qu'après toute sa longueur. Exiger le contraire
        // reviendrait à imposer un rapport de 1.
        window.__viewer.teeth.setAnimationAngle(0);
        window.__inspect('teeth').forEach(p => out.push(names.join('+') + ' · ' + camera + ' — ' + p));
      });
      // Une roue vue EXACTEMENT par la tranche ne montre rien de sa rotation :
      // c'est juste. Mais si rien ne bouge sous AUCUN des onze regards,
      // l'animation est morte.
      if (!everMoved) out.push(names.join('+') + ' — rien ne bouge, sous aucun point de vue');
      everMoved = false;
    });
    return out;
  }, { stages: STAGES, cameras: CAMERAS });
  expect(found, found.slice(0, 10).join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});
