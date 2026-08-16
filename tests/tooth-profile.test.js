const test = require('node:test');
const assert = require('node:assert/strict');
const Profile = require('../js/visualization/teeth/ToothProfile.js');
const Cache = require('../js/visualization/teeth/ToothProfileCache.js');

const rad = deg => deg * Math.PI / 180;

/** Denture normalisée ISO : ha = m, hf = 1,25 m, déport x. */
function gear(z, m, alpha = 20, x = 0) {
  const r = m * z / 2;
  return { teeth: z, module: m, pitchR: r, pressureAngle: alpha, profileShift: x,
    tipR: r + m * (1 + x), rootR: r - m * (1.25 - x) };
}
function describe(g, options = {}) {
  return Profile.describe(g.teeth, g.pitchR, g.tipR, g.rootR, g.pressureAngle,
    { profileShift: g.profileShift, ...options });
}

test('the base circle is the real one and inv(alpha) is exact', () => {
  const g = describe(gear(24, 2));
  assert.ok(Math.abs(g.baseRadius - 24 * Math.cos(rad(20))) < 1e-12, 'rb = r·cos α');
  // inv(20°) = tan 20° − 20° en radians = 0,0149044...
  assert.ok(Math.abs(Profile.inv(rad(20)) - 0.014904383867336446) < 1e-12);
  // involuteAt et radiusAtInvolute sont réciproques.
  for (const r of [g.baseRadius * 1.01, g.pitchRadius, g.tipRadius]) {
    const value = Profile.involuteAt(g.baseRadius, r);
    assert.ok(Math.abs(Profile.radiusAtInvolute(g.baseRadius, value) - r) < 1e-9, 'r=' + r);
  }
});

test('the tooth thickness at the pitch circle is exactly π·m/2', () => {
  for (const z of [12, 17, 24, 41, 42, 80, 150]) {
    for (const m of [0.5, 1, 2, 8]) {
      const g = describe(gear(z, m));
      // s = 2·r·ψ(r) au cercle primitif.
      const thickness = 2 * g.pitchRadius * g.halfThicknessAt(g.pitchRadius);
      assert.ok(Math.abs(thickness - Math.PI * m / 2) < 1e-9,
        `z=${z} m=${m} : ${thickness} au lieu de ${Math.PI * m / 2}`);
      // Le creux vaut le complément : dent + creux = pas circulaire π·m.
      const space = 2 * g.pitchRadius * (g.angularPitch / 2 - g.halfThicknessAt(g.pitchRadius));
      assert.ok(Math.abs(thickness + space - Math.PI * m) < 1e-9);
    }
  }
});

test('a profile shift thickens the tooth by exactly 2·x·m·tan α', () => {
  const m = 2, alpha = 20;
  const base = describe(gear(24, m, alpha, 0));
  for (const x of [-0.5, -0.2, 0.3, 0.8]) {
    const shifted = describe(gear(24, m, alpha, x));
    const delta = 2 * shifted.pitchRadius * shifted.halfThicknessAt(shifted.pitchRadius)
      - 2 * base.pitchRadius * base.halfThicknessAt(base.pitchRadius);
    assert.ok(Math.abs(delta - 2 * x * m * Math.tan(rad(alpha))) < 1e-9, 'x=' + x + ' → ' + delta);
  }
});

test('every flank point satisfies the involute equation of the base circle', () => {
  // Cas critique : z = 80 place le cercle de PIED au-dessus du cercle de BASE.
  // L'ancien code remplaçait alors rb par rootR et ne produisait plus une
  // développante ; on vérifie ici la propriété caractéristique elle-même.
  for (const z of [12, 24, 80]) {
    const g = describe(gear(z, 2));
    if (z === 80) assert.ok(g.rootRadius > g.baseRadius, 'cas rootR > rb attendu');
    const points = Profile.involutePoints(g.baseRadius, g.crestR, -g.halfThicknessBase, 1, 24, g.gapR);
    assert.ok(points.length > 10);
    for (const p of points) {
      const r = Math.hypot(p.x, p.y);
      assert.ok(r >= g.baseRadius - 1e-9, 'aucun point sous le cercle de base');
      // Propriété : l'écart angulaire au rebroussement vaut inv(α(r)).
      const offset = Math.atan2(p.y, p.x) - (-g.halfThicknessBase);
      assert.ok(Math.abs(offset - Profile.involuteAt(g.baseRadius, r)) < 1e-9,
        `z=${z} r=${r} : ${offset} vs ${Profile.involuteAt(g.baseRadius, r)}`);
      // Et la longueur de la tangente au cercle de base vaut l'arc déroulé.
      const tangent = Math.sqrt(Math.max(0, r * r - g.baseRadius * g.baseRadius));
      const rolled = g.baseRadius * (offset + Math.acos(Math.min(1, g.baseRadius / r)));
      assert.ok(Math.abs(tangent - rolled) < 1e-6, 'développante : tangente = arc déroulé');
    }
  }
});

test('the flank spans the real usable range, from root (or base) to tip', () => {
  const small = describe(gear(12, 2));       // rootR < rb : le flanc démarre à rb
  assert.ok(small.rootRadius < small.baseRadius);
  assert.ok(Math.abs(small.flankFrom - small.baseRadius) < 1e-12);
  assert.ok(Math.abs(small.crestR - small.tipRadius) < 1e-12);

  const large = describe(gear(80, 2));       // rootR > rb : le flanc démarre au pied
  assert.ok(large.rootRadius > large.baseRadius);
  assert.ok(Math.abs(large.gapR - large.rootRadius) < 1e-12);
});

test('a tooth that would become pointed is truncated, never crossed', () => {
  // Fort déport sur peu de dents : la tête théorique dépasse la dent pointue.
  const g = describe(gear(9, 2, 20, 0.9));
  assert.ok(g.pointedRadius < g.tipRadius, 'cas de dent pointue attendu');
  assert.equal(g.crestR, g.pointedRadius);
  assert.ok(g.halfThicknessAt(g.crestR) >= -1e-9, 'les flancs ne se croisent pas');
});

test('an internal tooth is the space of its mating gear: it widens inwards', () => {
  const z = 60, m = 2, r = m * z / 2;
  const g = Profile.describe(z, r, r - m, r + 1.25 * m, 20, { internal: true });
  assert.equal(g.internal, true);
  // Épaisseur au primitif identique en valeur absolue à une denture extérieure.
  assert.ok(Math.abs(2 * r * g.halfThicknessAt(r) - Math.PI * m / 2) < 1e-9);
  // La dent intérieure pointe vers le centre : tête au petit rayon, pied au grand.
  assert.ok(g.crestR < g.pitchRadius && g.gapR > g.pitchRadius);
  // Et elle s'élargit vers l'intérieur.
  assert.ok(g.halfThicknessAt(g.crestR) > g.halfThicknessAt(g.gapR));
});

test('the generated path is closed, finite and has exactly one crest per tooth', () => {
  for (const [z, options] of [[24, {}], [12, {}], [80, {}], [60, { internal: true }]]) {
    const g = gear(z, 2);
    const path = options.internal
      ? Profile.gearPath(z, g.pitchR, g.pitchR - 2, g.pitchR + 2.5, 20, options)
      : Profile.gearPath(z, g.pitchR, g.tipR, g.rootR, 20, options);
    assert.match(path, /^M /);
    assert.match(path, / Z$/);
    assert.doesNotMatch(path, /NaN|Infinity|undefined/);
    // Un arc de tête et un arc de creux par dent, plus l'arc de fermeture.
    const arcs = path.match(/ A /g) || [];
    assert.equal(arcs.length, 2 * z, `z=${z} : ${arcs.length} arcs`);
  }
});

test('identical profiles reuse one cache entry, different radii do not', () => {
  Cache.clear();
  const options = { type: 'spur', teeth: 24, module: 1, pressureAngle: 20 };
  assert.equal(Cache.get(options), Cache.get({ ...options }));
  assert.equal(Cache.size(), 1);
  // Les rayons participent à la clé : deux roues nominalement identiques mais
  // taillées différemment ne doivent pas partager le même tracé.
  const shifted = Cache.get({ ...options, tipRadius: 14 });
  assert.notEqual(shifted, Cache.get(options));
  assert.equal(Cache.size(), 2);
});
