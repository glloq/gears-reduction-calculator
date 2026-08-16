const {test,expect}=require('@playwright/test');
const {watchConsoleErrors}=require('./console-errors.js');
const {search,setQuantity,openModal,defineSearch}=require('./flow.js');
let errors=[];
test.beforeEach(async({page})=>{errors=watchConsoleErrors(page);await page.goto('/');});
test.afterEach(()=>expect(errors,'browser errors').toEqual([]));

test('default search selects a solution rendered from calculated geometry',async({page})=>{
  await search(page);
  await expect(page.locator('.solution-card').first()).toHaveClass(/selected/);
  await expect(page.locator('#svgContainer .train-svg')).toBeVisible();
  await expect(page.locator('.train-stage').first()).toHaveAttribute('data-center-distance-mm',/\d/);
  await expect(page.getByRole('button',{name:'Animer'})).toBeEnabled();
  await page.getByRole('button',{name:'Animer'}).click();
  await expect(page.locator('.train-svg')).toHaveClass(/is-animated/);
});

test('need derives 12:1 and returns an output near 125 rpm',async({page})=>{
  // Aucun mode à choisir : deux vitesses suffisent à poser le problème.
  await openModal(page);
  await setQuantity(page,'input.speed',1500);
  await setQuantity(page,'output.speed',125);
  await expect(page.locator('#requirementDiagnostic')).toContainText('déterminent le rapport');
  await expect(page.locator('#derivedRatio')).toContainText('12');
  await page.locator('#searchModalSubmit').click();
  expect(await page.inputValue('#objective_mode')).toBe('need');
  await expect(page.locator('.solution-card').first()).toBeVisible({timeout:30000});
  await expect(page.locator('#solutionCard')).toContainText('125.0 rpm');
});

test('linear UI and constraints reach the rack solver',async({page})=>{
  // Une course de sortie fait basculer le problème toute seule.
  await openModal(page);
  await setQuantity(page,'input.speed',1500);
  await setQuantity(page,'input.torque',2);
  await setQuantity(page,'output.travelPerRev',62.83);
  await expect(page.locator('#requirementDiagnostic')).toContainText('mouvement linéaire');
  await page.locator('#searchModalSubmit').click();
  expect(await page.inputValue('#objective_mode')).toBe('rotationTranslation');
  await expect(page.locator('.solution-card').first()).toContainText('Course',{timeout:30000});
  await expect(page.locator('#solutionCard')).toContainText('Vitesse linéaire');
  await expect(page.locator('.train-stage.rack .rack-teeth')).toBeVisible();

  const force=Number((await page.locator('#solutionCard').textContent()).match(/Force sortie([\d.]+)/)?.[1]);
  await defineSearch(page,{constraints:{outputForce:force+100000}});
  await expect(page.locator('.solution-card')).toHaveCount(0,{timeout:30000});
});
