const { test, expect } = require('@playwright/test');

// ===== RÉGRESSION VISUELLE =====
//
// Tout le reste de la suite prouve des PROPRIÉTÉS : une place, un angle, une
// tangence, un ordre de profondeur. C'est ce qu'il faut, et cela n'attrape pas
// tout. Un dessin peut satisfaire chaque invariant qu'on a su écrire et rester
// illisible — une étiquette posée sur une denture, un trait de construction qui
// domine la pièce, une couleur qui disparaît sur son fond.
//
// Ces images sont la dernière maille du filet. Elles ne disent pas « c'est
// bien » : elles disent « c'est CE QUE C'ÉTAIT ». Toute différence est portée à
// la connaissance de quelqu'un, qui décide si elle est un progrès ou une perte.
//
// ===== CE QUI EST FIGÉ, ET POURQUOI =====
//
// Une image ne se compare que si tout ce qui n'est pas le dessin est immobile :
// même fenêtre, même animation arrêtée au même angle, transitions CSS coupées.
// Les références sont enregistrées PAR PLATEFORME par Playwright ; le rendu du
// texte diffère d'un système à l'autre, et une tolérance de quelques pour mille
// absorbe l'antialiasing sans laisser passer un organe déplacé.
//
// Pour réenregistrer après un changement voulu :
//     npx playwright test tests/e2e/visual-regression.spec.js --update-snapshots
// et REGARDER chaque image avant de la valider. Une référence mise à jour sans
// être vue ne prouve plus rien.

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
  planetaryCarrierIn: { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 3, inputMember: 'C', outputMember: 'R', fixed: 'S', parameters: { module: 2, faceWidth: 20 } },
  rack: { type: 'rack', pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } }
};

/**
 * LES CAS DE RÉFÉRENCE.
 *
 * Un par situation où le dessin peut se tromper d'une façon qu'aucun invariant
 * ne nomme : chaque famille dans la vue qui la caractérise, les deux mains d'une
 * hélice, une courroie ouverte et croisée, un renvoi conique droit et oblique,
 * les enchaînements où un étage change de plan, et les deux styles de tracé.
 */
const SHOTS = [
  { name: 'spur-face', stages: ['spur'], camera: 'side' },
  { name: 'spur-profil', stages: ['spur'], camera: 'front' },
  { name: 'spur-iso', stages: ['spur'], camera: 'iso' },
  { name: 'spur-technique-iso', stages: ['spur'], camera: 'iso', style: 'technical' },
  { name: 'spur-eclate-iso', stages: ['spur'], camera: 'iso', explode: true },
  // L'hélice se lit maintenant sous les trois présentations, et la main doit
  // s'y distinguer partout : de face (arcs sur la denture), par la tranche
  // (traits en travers de la hauteur), de biais (traits sur la surface
  // latérale). D'où six références et non deux : deux mains × trois façons de
  // regarder la même roue. Une paire qui deviendrait identique signalerait que
  // la main a cessé d'être figurée de ce côté-là.
  { name: 'helical-droite-face', stages: ['helical'], camera: 'side' },
  { name: 'helical-gauche-face', stages: ['helicalLeft'], camera: 'side' },
  { name: 'helical-droite-face-opposee', stages: ['helical'], camera: 'side-far' },
  { name: 'helical-gauche-face-opposee', stages: ['helicalLeft'], camera: 'side-far' },
  { name: 'helical-droite-tranche', stages: ['helical'], camera: 'front' },
  { name: 'helical-gauche-tranche', stages: ['helicalLeft'], camera: 'front' },
  { name: 'helical-iso', stages: ['helical'], camera: 'iso' },
  { name: 'helical-gauche-iso', stages: ['helicalLeft'], camera: 'iso' },
  { name: 'internal-face', stages: ['internal'], camera: 'side' },
  { name: 'internal-iso', stages: ['internal'], camera: 'iso' },
  { name: 'internal-iso-180', stages: ['internal'], camera: 'iso-180' },
  { name: 'bevel90-face', stages: ['bevel'], camera: 'front' },
  { name: 'bevel90-iso', stages: ['bevel'], camera: 'iso' },
  { name: 'bevel60-iso', stages: ['bevel60'], camera: 'iso' },
  { name: 'bevel60-dessus', stages: ['bevel60'], camera: 'top' },
  { name: 'worm-face', stages: ['worm'], camera: 'front' },
  { name: 'worm-iso', stages: ['worm'], camera: 'iso' },
  { name: 'worm-bout', stages: ['worm'], camera: 'side' },
  { name: 'belt-ouverte-face', stages: ['belt'], camera: 'side' },
  { name: 'belt-ouverte-iso', stages: ['belt'], camera: 'iso' },
  { name: 'belt-croisee-face', stages: ['beltCrossed'], camera: 'side' },
  { name: 'belt-croisee-iso', stages: ['beltCrossed'], camera: 'iso' },
  { name: 'belt-croisee-iso-90', stages: ['beltCrossed'], camera: 'iso-90' },
  { name: 'chain-face', stages: ['chain'], camera: 'side' },
  { name: 'chain-iso', stages: ['chain'], camera: 'iso' },
  { name: 'planetary-face', stages: ['planetary'], camera: 'side' },
  { name: 'planetary-iso', stages: ['planetary'], camera: 'iso' },
  { name: 'planetary-porte-satellites-iso', stages: ['planetaryCarrierIn'], camera: 'iso' },
  { name: 'planetary-eclate-iso', stages: ['planetary'], camera: 'iso', explode: true },
  { name: 'rack-face', stages: ['rack'], camera: 'front' },
  { name: 'rack-iso', stages: ['rack'], camera: 'iso' },
  { name: 'spur-bevel-iso', stages: ['spur', 'bevel'], camera: 'iso' },
  { name: 'worm-spur-iso', stages: ['worm', 'spur'], camera: 'iso' },
  { name: 'planetary-spur-iso', stages: ['planetary', 'spur'], camera: 'iso' },
  { name: 'spur-bevel-dimensions', stages: ['spur', 'bevel'], camera: 'iso', view: 'geometry' },
  { name: 'worm-dimensions-face', stages: ['worm'], camera: 'front', view: 'geometry' },
  { name: 'planetary-cinematique', stages: ['planetary'], view: 'kinematic' },
  { name: 'worm-spur-cinematique', stages: ['worm', 'spur'], view: 'kinematic' }
];

// En dessous de 1000 px de large, la mise en page passe à un seul volet à la
// fois et le dessin n'est plus à l'écran : une référence prise là ne
// photographierait rien. 1280 × 760 place le visualiseur à côté de la liste,
// c'est-à-dire dans la disposition où on le regarde vraiment.
test.use({ viewport: { width: 1280, height: 760 }, reducedMotion: 'reduce' });

test.describe('références visuelles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.GearApp && GearApp.visualization && GearApp.visualization.ViewerToolbar);
    const modal = page.locator('#searchModal');
    if (await modal.isVisible()) await page.locator('#searchModalClose').click();
    await page.evaluate(() => {
      document.body.classList.add('has-results');
      window.__viewer = new GearApp.visualization.ViewerToolbar(document.getElementById('svgContainer'));
      window.__viewer.bind();
    });
  });

  for (const shot of SHOTS) {
    test(shot.name, async ({ page }) => {
      await page.evaluate(({ stages, shot }) => {
        const chosen = shot.stages.map(n => JSON.parse(JSON.stringify(stages[n])));
        chosen.forEach(s => { if (s.type === 'rack') s.geometry = GearTransmissionRegistry.get('rack').calculateGeometry(s); });
        const solution = GearEngineering.analyzeSolution(chosen, 10, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
        const viewer = window.__viewer;
        viewer.setStyle(shot.style || 'visual');
        viewer.setView(shot.view || 'teeth');
        if (shot.camera) viewer.setProjection(shot.camera);
        viewer.setExplode(!!shot.explode);
        viewer.render(solution);
        // L'animation ARRÊTÉE à un angle connu : une image comparée à une autre
        // ne peut pas dépendre de l'instant où on l'a prise.
        const renderer = viewer.renderer();
        if (renderer && renderer.animation && renderer.animation.playing) renderer.toggleAnimation();
        if (renderer && renderer.setAnimationAngle) renderer.setAnimationAngle(0);
      }, { stages: STAGES, shot });
      await expect(page.locator('#svgContainer')).toHaveScreenshot(shot.name + '.png', {
        maxDiffPixelRatio: 0.003,
        animations: 'disabled'
      });
    });
  }
});
