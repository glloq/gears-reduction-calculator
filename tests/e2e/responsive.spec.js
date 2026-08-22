const { test, expect } = require('@playwright/test');

// ===== LES LARGEURS OÙ L'ON TRAVAILLE VRAIMENT =====
//
// La suite se déroulait à une seule taille de fenêtre, large. Or la mise en
// page bascule deux fois — à 1000 px l'espace de travail passe à un volet à la
// fois, à 600 px les cibles tactiles s'agrandissent — et c'est précisément
// dans ces bascules que le visualiseur se retrouvait dans un conteneur qu'il
// ne pouvait pas mesurer.
//
// Ce qui est exigé ici tient en cinq points, valables à toute largeur :
//   1. la page ne déborde jamais horizontalement ;
//   2. aucun contrôle de la barre du visualiseur ne sort de l'écran ;
//   3. sur un écran tactile, chaque contrôle reste une cible de doigt ;
//   4. le dessin est VISIBLE quand on demande à le voir ;
//   5. et il est CADRÉ : tout ce qui est dessiné tient dans la fenêtre de vue,
//      avec des étiquettes d'une taille lisible.
//
// Le point 5 est celui qui manquait. Sous 1000 px, le volet du visualiseur est
// masqué pendant que la recherche aboutit : le dessin était donc cadré sur un
// conteneur de largeur nulle, `getBBox` ne renvoyait rien, la boîte tombait
// sur son repli et l'échelle des textes sur 900 px imaginaires. On ouvrait
// « Vue » et le mécanisme était hors cadre, coupé, en corps de quatre pixels.

const SIZES = [
  { width: 360, height: 800, name: 'petit téléphone' },
  { width: 390, height: 844, name: 'téléphone courant' },
  { width: 768, height: 1024, name: 'tablette en portrait' },
  { width: 1000, height: 800, name: 'seuil du volet unique' },
  { width: 1440, height: 900, name: 'ordinateur' }
];

// Un train à deux étages dont le second change de plan : c'est le cas où le
// cadrage a le plus à perdre, la boîte englobante n'étant pas celle d'un
// simple couple de roues.
const STAGES = [
  { type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } },
  { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 90, faceWidth: 15 } }
];

/**
 * Le parcours RÉEL : la solution est rendue pendant que le visualiseur est
 * encore masqué, puis on ouvre son volet. Rendre après l'avoir ouvert
 * masquerait justement le défaut qu'on surveille.
 */
async function open(page, size) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto('/');
  await page.waitForFunction(() => window.GearApp && GearApp.visualization && GearApp.visualization.ViewerToolbar);
  const modal = page.locator('#searchModal');
  if (await modal.isVisible()) await page.locator('#searchModalClose').click();
  await page.evaluate(stages => {
    document.body.classList.add('has-results');
    const toolbar = new GearApp.visualization.ViewerToolbar(document.getElementById('svgContainer'));
    toolbar.bind();
    window.__viewer = toolbar;
    toolbar.render(GearEngineering.analyzeSolution(JSON.parse(JSON.stringify(stages)), 3,
      { inputSpeedRpm: 1500, inputTorqueNm: 10 }));
  }, STAGES);
  const pane = page.locator('#mobilePanes [data-pane="viewer"]');
  if (await pane.isVisible().catch(() => false)) await pane.click();
  await page.waitForTimeout(250);
}

/** Ce que la page mesure d'elle-même, une fois le visualiseur à l'écran. */
function measure() {
  const width = window.innerWidth, height = window.innerHeight;
  const bar = document.querySelector('.viz-controls');
  const controls = Array.from(bar.querySelectorAll('button, select, summary'))
    .filter(node => node.offsetParent);
  const outside = [], small = [];
  controls.forEach(node => {
    const box = node.getBoundingClientRect();
    const name = (node.textContent || node.id || '').trim().slice(0, 20);
    if (box.left < -0.5 || box.right > width + 0.5) outside.push(name);
    if (box.height < 32) small.push(name + ' ' + box.height.toFixed(0) + 'px');
  });
  const container = document.getElementById('svgContainer').getBoundingClientRect();
  const svg = document.querySelector('#svgContainer svg');
  const view = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  const drawn = svg.getBBox();
  const port = svg.querySelector('[class$="-viewport"]');
  const world = Number(port && port.getAttribute('font-size'));
  return {
    overflow: document.documentElement.scrollWidth - width,
    outside: outside,
    small: small,
    controls: controls.length,
    visible: Math.min(container.bottom, height) - Math.max(container.top, 0),
    // Le dessin tient-il dans sa fenêtre de vue ? Un demi-millimètre de marge
    // pour les arrondis d'écriture du viewBox.
    framed: drawn.x >= view[0] - 0.5 && drawn.y >= view[1] - 0.5 &&
      drawn.x + drawn.width <= view[0] + view[2] + 0.5 &&
      drawn.y + drawn.height <= view[1] + view[3] + 0.5,
    // La taille d'une étiquette EN PIXELS D'ÉCRAN : c'est ce que l'œil voit,
    // et c'est ce que fausse un cadrage fait à largeur nulle.
    label: world * (svg.getBoundingClientRect().width / view[2])
  };
}

for (const size of SIZES) {
  test(`le visualiseur tient à ${size.width} px — ${size.name} (§ responsive)`, async ({ page }) => {
    await open(page, size);
    const seen = await page.evaluate(measure);

    expect(seen.overflow, 'la page déborde horizontalement').toBeLessThanOrEqual(1);
    expect(seen.controls, 'barre du visualiseur vide').toBeGreaterThan(15);
    expect(seen.outside, 'contrôles hors de l’écran').toEqual([]);
    // Sous 768 px on est sur un écran qu'on touche : 32 px est le plancher
    // au-dessous duquel une cible se rate. Au-delà, la souris vise mieux et la
    // barre a le droit d'être compacte.
    if (size.width <= 768) expect(seen.small, 'cibles tactiles trop petites').toEqual([]);
    // 300 px, et non « un pixel visible » : ce qu'on demande en ouvrant
    // « Vue », c'est de regarder un mécanisme, pas d'en apercevoir la tranche
    // sous une pile de boutons.
    expect(seen.visible, 'le dessin n’est pas à l’écran').toBeGreaterThan(300);
    expect(seen.framed, 'le mécanisme sort de son cadre').toBe(true);
    expect(seen.label, 'étiquettes illisibles').toBeGreaterThan(7);
  });
}

test('les trois vues se cadrent après l’ouverture du volet, pas avant (§ responsive)', async ({ page }) => {
  // Le défaut ne touchait pas que la Transmission : les Dimensions et la
  // Cinématique dimensionnent aussi leurs textes sur la largeur du conteneur,
  // et se rabattaient sur 900 px imaginaires.
  await open(page, SIZES[1]);
  for (const view of ['teeth', 'geometry', 'kinematic']) {
    await page.evaluate(v => window.__viewer.setView(v), view);
    await page.waitForTimeout(120);
    const seen = await page.evaluate(measure);
    expect(seen.framed, view + ' : hors cadre').toBe(true);
    expect(seen.label, view + ' : étiquettes illisibles').toBeGreaterThan(7);
    expect(seen.visible, view + ' : dessin absent de l’écran').toBeGreaterThan(300);
  }
});
