const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../js/visualization/TrainLayout.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');
const Projection = require('../js/visualization/core/ProjectionEngine.js');

// Construit un étage avec sa géométrie calculée, comme Engineering le fait.
function stage(type, config) {
  const def = Registry.get(type === 'epicyclic' ? 'planetary' : type);
  const s = Object.assign({ type: type === 'epicyclic' ? 'planetary' : type, parameters: { module: 1 } }, config);
  s.geometry = def.calculateGeometry(s);
  return s;
}
function pair(type, a, b, params) {
  return stage(type, { input: { teeth: a }, output: { teeth: b }, parameters: Object.assign({ module: 1 }, params) });
}
function mech(ratio, signed) { return { ratio: Math.abs(ratio), signedRatio: signed === undefined ? -ratio : signed, efficiency: 0.97 }; }

function allFinite(model) {
  model.wheels.forEach(w => {
    for (const key of ['cx', 'cy', 'pitchD', 'outsideD', 'rootD']) {
      assert.ok(Number.isFinite(w[key]), key + ' is not finite on ' + w.role + ': ' + w[key]);
    }
  });
  model.stages.forEach(e => e.links.forEach(l => {
    for (const key of ['x1', 'y1', 'x2', 'y2', 'x', 'y']) {
      if (l[key] !== undefined) assert.ok(Number.isFinite(l[key]), 'link ' + l.kind + ' ' + key);
    }
  }));
}

test('mixed 8-type chain lays out with finite coordinates everywhere', () => {
  const stages = [
    pair('spur', 12, 36),
    pair('helical', 15, 45, { helixAngle: 20 }),
    pair('internal', 15, 45),
    pair('belt', 20, 60, { pitch: 2, centerDistance: 100 }),
    pair('chain', 15, 45, { pitch: 12.7, centerDistance: 200 }),
    stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 1, leadAngle: 20, diameterQuotient: 10 } }),
    pair('bevel', 15, 30, { shaftAngle: 90 }),
    stage('planetary', { sunTeeth: 12, ringTeeth: 48, planetTeeth: 18, planetCount: 4, inputMember: 'S', outputMember: 'C', fixed: 'R' })
  ];
  const mechanical = [mech(3), mech(3), mech(3), mech(3, 3), mech(3, 3), mech(20), mech(2), mech(5, 5)];
  const model = Layout.layout(stages, mechanical);
  assert.equal(model.stages.length, 8);
  allFinite(model);
  // Le planétaire a bien planetCount satellites réels
  const planetary = model.stages[7];
  assert.equal(planetary.wheels.filter(w => w.role === 'planet').length, 4);
});

test('consecutive external pairs are compound: one shaft, two wheels', () => {
  // L'ancienne version exigeait que les deux roues soient AU MÊME POINT. Elles
  // n'y sont que vues de bout : sur un arbre qui a une longueur, elles sont
  // séparées de leur écart axial. Exiger la superposition, c'était interdire
  // qu'un arbre en ait une — et c'est ce qui empêchait de montrer un engrenage
  // et une vis sur le même arbre.
  const stages = [pair('spur', 12, 36), pair('spur', 12, 36)];
  const model = Layout.layout(stages, [mech(3), mech(3)]);
  const out0 = model.stages[0].wheels[1];
  const in1 = model.stages[1].wheels[0];

  // Ce qui doit être vrai dans TOUTES les vues : les deux roues sont solidaires.
  const body = model.graph.rigidBodyOf(out0.memberId);
  assert.ok(body.includes(in1.memberId), 'les deux roues appartiennent au même corps');

  ['unfolded', 'front', 'top', 'side', 'iso'].forEach(view => {
    const seen = Layout.layout(stages, [mech(3), mech(3)], { view });
    const [a, b] = [seen.stages[0].wheels[1], seen.stages[1].wheels[0]];
    const worldA = seen.spatial.byId[a.memberId], worldB = seen.spatial.byId[b.memberId];
    const axial = Math.abs(worldB.axialPosition - worldA.axialPosition);
    assert.ok(axial > 0, 'les deux roues occupent deux places sur l’arbre');
    const drawn = Math.hypot(b.cx - a.cx, b.cy - a.cy);

    if (seen.mode === 'projected') {
      // Une PROJECTION dessine l'image de l'écart, et rien d'autre : elle le
      // raccourcit dès qu'il possède une composante en profondeur, et le
      // réduit à zéro quand l'arbre pointe vers l'œil. C'est ce qu'une vue
      // montre, et c'est justement ce que le dépliage refuse de faire.
      const gap = [0, 1, 2].map(i => worldB.position[i] - worldA.position[i]);
      const expected = Math.hypot(
        gap.reduce((sum, c, i) => sum + c * seen.view.u[i], 0),
        gap.reduce((sum, c, i) => sum + c * seen.view.v[i], 0));
      assert.ok(Math.abs(drawn - expected) < 1e-6, `${view} : ${drawn.toFixed(2)} contre ${expected.toFixed(2)}`);
      assert.ok(drawn <= axial + 1e-6, `${view} : une projection ne rallonge jamais`);
    } else {
      // DÉPLIÉE : la longueur reste vraie, ou nulle si l'arbre est vu en bout —
      // ce qui est la seule superposition légitime.
      const shaft = seen.shafts.find(s => s.memberIds.includes(a.memberId));
      assert.ok(Math.abs(drawn - (shaft.endOn ? 0 : axial)) < 1e-6,
        `${view} : ${drawn.toFixed(2)} dessiné, ${shaft.endOn ? 0 : axial.toFixed(2)} attendu`);
    }
  });
});

test('mesh distance equals the real calculated center distance', () => {
  const s = pair('spur', 12, 36);
  const model = Layout.layout([s], [mech(3)]);
  const [a, b] = model.stages[0].wheels;
  const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
  assert.ok(Math.abs(d - s.geometry.centerDistance) < 1e-6, d + ' vs ' + s.geometry.centerDistance);
});

test('belt and chain advance by the corrected center distance with real pitch diameters', () => {
  const belt = pair('belt', 20, 60, { pitch: 2, centerDistance: 100 });
  const model = Layout.layout([belt], [mech(3, 3)]);
  const [a, b] = model.stages[0].wheels;
  assert.ok(Math.abs(Math.hypot(b.cx - a.cx, b.cy - a.cy) - belt.geometry.correctedCenterDistance) < 1e-6);
  assert.ok(Math.abs(a.pitchD - 20 * 2 / Math.PI) < 1e-6, 'pulley pitch diameter is z·p/π');
  assert.equal(model.stages[0].links[0].kind, 'belt-span');
});

test('what continues after a planetary is the member that carries the output', () => {
  // L'ancienne version demandait un symbole de RUPTURE d'arbre et exigeait que
  // l'étage suivant soit dessiné au-delà de la couronne. C'était une
  // convention de mise en page : elle disait « la suite est ailleurs » sans
  // jamais dire de QUOI elle descend. Un arbre a maintenant une longueur, et
  // le pignon suivant est posé dessus — celui du porte-satellites, ici.
  const stages = [
    stage('planetary', { sunTeeth: 12, ringTeeth: 48, planetTeeth: 18, planetCount: 3, inputMember: 'S', outputMember: 'C', fixed: 'R' }),
    pair('spur', 12, 36)
  ];
  const model = Layout.layout(stages, [mech(5, 5), mech(3)]);
  assert.equal(model.stages[0].attach, 'coaxial');

  // Le pignon de l'étage suivant est solidaire du porte-satellites, et de lui
  // seul : ni du solaire menant, ni de la couronne bloquée.
  const nextIn = model.stages[1].wheels[0];
  const body = model.graph.rigidBodyOf(nextIn.memberId);
  assert.ok(body.includes('s0-C'), 'le pignon suivant tourne avec le porte-satellites');
  assert.ok(!body.includes('s0-R') && !body.includes('s0-S'), 'et avec rien d’autre');

  // Un satellite n'est sur aucun des trois corps coaxiaux, et il orbite.
  const planets = model.stages[0].wheels.filter(w => w.role === 'planet');
  assert.equal(planets.length, 3);
  planets.forEach(planet => assert.ok(planet.orbit > 0, 'rayon d’orbite réel'));
  const carrier = model.stages[0].carrier;
  planets.forEach(planet => {
    const reach = Math.hypot(planet.cx - carrier.cx, planet.cy - carrier.cy);
    assert.ok(reach <= carrier.orbit + 1e-6, 'aucun satellite au-delà de son orbite');
  });
  // Vus de face, les trois satellites sont bien répartis autour du solaire.
  assert.ok(new Set(planets.map(p => p.cx.toFixed(3) + ',' + p.cy.toFixed(3))).size >= 2,
    'les satellites ne sont pas tous au même endroit');
});

test('speeds cascade and direction alternates through external pairs', () => {
  const stages = [pair('spur', 12, 36), pair('spur', 12, 36)];
  const model = Layout.layout(stages, [mech(3), mech(3)]);
  const w = model.stages.map(e => e.wheels);
  assert.equal(w[0][0].speed, 1);            // arbre d'entrée
  assert.equal(w[0][1].speed, -1 / 3);       // inversé et réduit
  assert.equal(w[1][0].speed, -1 / 3);       // même arbre
  assert.ok(Math.abs(w[1][1].speed - 1 / 9) < 1e-9); // ré-inversé
});

test('crossed belt inverts direction while straight belt preserves it', () => {
  const straight = Layout.layout([pair('belt', 20, 60, { pitch: 2, centerDistance: 100 })], [mech(3, 3)]);
  assert.ok(straight.stages[0].wheels[1].speed > 0);
  const crossedStage = pair('belt', 20, 60, { pitch: 2, centerDistance: 100, crossed: true });
  const crossed = Layout.layout([crossedStage], [mech(3, -3)]);
  assert.ok(crossed.stages[0].wheels[1].speed < 0);
});

test('single stage and missing mechanical data stay finite', () => {
  const single = Layout.layout([pair('spur', 10, 40)], []);
  allFinite(single);
  assert.equal(single.io.input.role, 'input');
  assert.equal(single.io.output.role, 'output');
  const empty = Layout.layout([], []);
  assert.equal(empty.stages.length, 0);
});

test('worm places the wheel perpendicular below the screw', () => {
  const s = stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 1, leadAngle: 20, diameterQuotient: 10 } });
  const model = Layout.layout([s], [mech(20)]);
  const [worm, wheel] = model.stages[0].wheels;
  assert.equal(worm.kind, 'worm');
  assert.ok(wheel.cy > worm.cy, 'wheel below the worm');
  assert.ok(Math.abs(wheel.cy - worm.cy - s.geometry.centerDistance) < 1e-6);
});

// ===== Le dessin consomme le modèle spatial =====

test('a worm and a gear on the same shaft are not drawn the same way', () => {
  // C'est le cas que l'ancien placement ne pouvait pas représenter : il posait
  // toutes les roues en cercles, donc « vues suivant leur axe ». Une vis et un
  // engrenage solidaires ne peuvent pas l'être en même temps.
  const stages = [
    pair('spur', 12, 36),
    stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 1, leadAngle: 20, diameterQuotient: 10 } }),
    pair('spur', 12, 36)
  ];
  const model = Layout.layout(stages, [mech(3), mech(20), mech(3)]);
  const byId = Object.fromEntries(model.wheels.map(w => [w.memberId, w]));

  // La roue de l'étage 1 et la vis de l'étage 2 sont sur le même arbre…
  assert.ok(model.graph.rigidBodyOf('s0-output').includes('s1-input'));
  // …et se présentent toutes deux de profil dans cette vue : c'est cohérent.
  assert.equal(byId['s1-input'].presentation, 'profile');
  // La roue de la vis, elle, est sur un axe perpendiculaire : vue de face.
  assert.equal(byId['s1-output'].presentation, 'face');
  // Deux présentations DIFFÉRENTES coexistent dans le même dessin.
  assert.ok(new Set(model.wheels.map(w => w.presentation)).size > 1,
    'un seul mode de représentation pour toute la chaîne');
});

test('how a part is drawn follows the projection of its axis, and nothing else', () => {
  const stages = [pair('spur', 12, 36),
    stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 1, leadAngle: 20, diameterQuotient: 10 } })];
  ['front', 'top', 'side', 'iso'].forEach(view => {
    const model = Layout.layout(stages, [mech(3), mech(20)], { view });
    assert.equal(model.view.id, view, 'la vue demandée est celle qui est rendue');
    model.wheels.forEach(wheel => {
      const placed = model.spatial.byId[wheel.memberId];
      if (!placed) return;                       // la crémaillère glisse, elle n'a pas d'arbre
      assert.equal(wheel.presentation, Projection.presentation(placed.axis, view), wheel.memberId);
      assert.ok(wheel.foreshortening >= 0 && wheel.foreshortening <= 1 + 1e-9, wheel.memberId);
      // Un organe vu de face n'a pas d'inclinaison à l'écran : son axe pointe
      // vers l'œil. Lui en donner une ferait tourner ses étiquettes pour rien.
      if (wheel.presentation === 'face') assert.equal(wheel.axisAngleDeg, undefined, wheel.memberId);
    });
  });
});

test('a projection shortens what is oblique; only the unfolded view refuses to', () => {
  // C'était la confusion de fond : `front`, `top`, `side` et `iso` nommaient des
  // projections, mais toutes passaient par le dépliage. L'entraxe dessiné
  // restait donc égal à l'entraxe vrai jusque dans l'axonométrie — ce qui ne
  // peut pas arriver dans une projection, et qu'un test exigeait pourtant.
  const stages = [pair('spur', 12, 36), pair('spur', 15, 45)];
  const views = ['unfolded', 'front', 'top', 'side', 'iso']
    .map(view => Layout.layout(stages, [mech(3), mech(3)], { view }));
  const reference = views[0].spatial.members.map(m => m.id + ':' + m.position.join(','));

  views.forEach(model => {
    // Le monde ne bouge jamais : c'est l'invariant que la séparation protège.
    assert.deepEqual(model.spatial.members.map(m => m.id + ':' + m.position.join(',')), reference,
      model.view.id + ' : aucune pièce ne bouge dans l’espace');

    model.stages.forEach((entry, index) => {
      if (!Number.isFinite(entry.centerDistance)) return;
      const [a, b] = entry.wheels;
      const drawn = Math.hypot(b.cx - a.cx, b.cy - a.cy);
      if (model.mode === 'unfolded') {
        assert.ok(Math.abs(drawn - entry.centerDistance) < 1e-6,
          `déplié / étage ${index} : ${drawn.toFixed(2)} pour ${entry.centerDistance.toFixed(2)}`);
      } else {
        assert.ok(drawn <= entry.centerDistance + 1e-6,
          `${model.view.id} / étage ${index} : ${drawn.toFixed(2)} > ${entry.centerDistance.toFixed(2)}`);
      }
      // Dans TOUS les cas, la valeur de la cote vient du modèle et pas du
      // dessin : c'est elle qu'on lit, jamais le trait qu'on mesure.
      assert.equal(entry.centerDistance, views[0].stages[index].centerDistance);
    });
  });

  // L'isométrie raccourcit réellement : sinon elle n'en serait pas une.
  const iso = views.find(m => m.view.id === 'iso');
  const shortened = iso.stages.some((entry, index) => {
    if (!Number.isFinite(entry.centerDistance)) return false;
    const [a, b] = entry.wheels;
    return Math.hypot(b.cx - a.cx, b.cy - a.cy) < entry.centerDistance - 1e-6;
  });
  assert.ok(shortened, 'une isométrie doit raccourcir ce qui a de la profondeur');

  const drawings = views.map(m => m.wheels.map(w => w.cx.toFixed(2) + ',' + w.cy.toFixed(2)).join('|'));
  assert.ok(new Set(drawings).size > 1, 'toutes les vues donnent le même dessin');
});

test('a shaft has a length, or says it is seen end-on', () => {
  const stages = [pair('spur', 12, 36),
    stage('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 1, leadAngle: 20, diameterQuotient: 10 } })];
  const model = Layout.layout(stages, [mech(3), mech(20)]);
  assert.ok(model.shafts.length >= 3, 'un arbre par corps tournant');
  model.shafts.forEach(shaft => {
    const drawn = Math.hypot(shaft.x2 - shaft.x1, shaft.y2 - shaft.y1);
    assert.ok(Number.isFinite(drawn));
    // Un arbre vu de côté a une longueur ; vu en bout, il n'en a pas — et le
    // dit, pour qu'on trace une croix d'axe plutôt qu'un segment nul.
    assert.equal(shaft.endOn, drawn < 1e-9, shaft.id);
    if (!shaft.endOn) assert.ok(drawn > 0, shaft.id);
  });
});

test('the default view of the teeth drawing is the one that shows teeth', () => {
  // `auto` choisit la vue qui perd le moins du MÉCANISME, et compte l'axe vu
  // en bout comme une perte : pour un train à axes parallèles, elle élit donc
  // la coupe — toutes les roues en rectangles. C'est un dessin d'ensemble
  // correct, et exactement ce qu'une vue « denture réaliste » ne doit pas être.
  const stages = [pair('spur', 12, 36), pair('spur', 12, 36)];
  const model = Layout.layout(stages, [mech(3), mech(3)]);
  assert.ok(model.wheels.every(w => w.presentation === 'face'),
    'les roues d’un train parallèle se voient de face par défaut');
  // La vue « la moins perdante » reste accessible, et elle est différente.
  const auto = Layout.layout(stages, [mech(3), mech(3)], { view: 'auto' });
  assert.notEqual(auto.view.id, model.view.id);
});

test('rack is available in the teeth layout with real pinion and travel geometry', () => {
  const stage = { type: 'rack', pinionTeeth: 20, parameters: { module: 2 }, geometry: { pitchDiameterInput: 40, maxDiameter: 44, travelPerRevolution: 40 * Math.PI } };
  const model = Layout.layout([stage], []);
  assert.equal(model.stages[0].attach, 'linear');
  assert.equal(model.stages[0].wheels[0].kind, 'gear');
  assert.equal(model.stages[0].wheels[1].kind, 'rack');
  assert.equal(model.stages[0].wheels[1].length, 40 * Math.PI);
});
