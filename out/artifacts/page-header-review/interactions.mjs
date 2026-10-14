import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1280,height:720}});
// Signed-out API fixture; render the real invitation notice without a live API.
await context.route('**/v1/auth/get-session**', route => route.fulfill({status:200,contentType:'application/json',body:'null'}));
const page=await context.newPage();
try {
const results=[];
await page.goto('http://localhost:3027/projects/new',{timeout:600000});
await page.waitForTimeout(1200);
 const closeToast=page.getByRole('button',{name:'Close toast',exact:true});
if(await closeToast.first().isVisible())await closeToast.first().click();
 const decline=page.getByRole('button',{name:'Decline',exact:true});
 if(await decline.isVisible())await decline.click();
await page.getByLabel('Project Name *',{exact:true}).fill('Header review');
const create=page.getByRole('button',{name:/Create Project/});
await create.waitFor();
await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent?.includes('Create Project')&&!b.disabled),undefined,{timeout:180000});
assert.equal(await create.isEnabled(),true);
const buttonBox=await create.boundingBox();
assert.ok(buttonBox.y+buttonBox.height <=720,'Desktop Create action remains in viewport');
await page.locator('button[role=radio][id=replicad]').click();
assert.equal(await page.locator('button[role=radio][id=replicad]').getAttribute('aria-checked'),'true');
results.push('Desktop 1280×720: editable name, selectable kernel and reachable enabled Create action');
await page.screenshot({path:'out/research/page-headers/screenshots/projects-new-short-desktop.png'});
await page.setViewportSize({width:390,height:844});
const mobileKernel=page.getByRole('button',{name:/JSCAD/});
await mobileKernel.click();
assert.equal(await mobileKernel.getAttribute('aria-expanded'),'true');
await create.scrollIntoViewIfNeeded();
assert.equal(await create.isVisible(),true);
await page.screenshot({path:'out/research/page-headers/screenshots/projects-new-mobile-actions.png'});
results.push('Mobile 390×844: kernel accordion and bottom actions remain reachable');
await page.goto('http://localhost:3027/legal/cookies#preferences');
await page.getByRole('dialog').waitFor();
results.push('Cookie preferences hash still opens its dialog');
await page.screenshot({path:'out/research/page-headers/screenshots/legal-cookies-preferences.png'});
await page.setViewportSize({width:2560,height:1440});
await page.emulateMedia({colorScheme:'dark'});
const frames=[];
for(const route of ['/community','/projects/new']){
 await page.goto('http://localhost:3027'+route,{timeout:600000});
 await page.getByRole('heading',{level:1}).first().waitFor();
 frames.push(await page.getByRole('heading',{level:1}).first().evaluate(h=>({x:h.getBoundingClientRect().x,y:h.getBoundingClientRect().y,font:getComputedStyle(h).fontSize})));
 await page.screenshot({path:'out/research/page-headers/screenshots/'+route.slice(1).replaceAll('/','-')+'-wide-dark.png'});
}
assert.deepEqual(frames[0],frames[1],'Community and New Project header alignment/typography agree at 2560px');
results.push({wideDesktopHeaderParity:frames});
await fs.writeFile('out/research/page-headers/interactions.json',JSON.stringify(results,null,2));

console.log(results);

} catch(error) {
 await page.screenshot({path:'out/research/page-headers/interaction-failure.png'});
 await fs.writeFile('out/research/page-headers/interaction-failure.txt',await page.locator('body').ariaSnapshot());
 throw error;
} finally { await browser.close(); }
