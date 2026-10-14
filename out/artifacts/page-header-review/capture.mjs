import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light',extraHTTPHeaders:{'Sec-GPC':'1'}});
const page=await context.newPage();
page.setDefaultTimeout(120000);
const routes=['/community','/projects/new','/workflows','/legal','/legal/terms','/legal/privacy','/legal/cookies','/legal/acceptable-use','/legal/subprocessors','/legal/open-source','/github/complete','/invitations/header-review','/loader','/loader/glass','/debug/geospec'];
const metrics=[];
const screenshots='out/research/page-headers/screenshots';
await fs.mkdir(screenshots,{recursive:true});
async function open(route){
 console.log('Opening',route);
 await page.goto('http://localhost:3027'+route,{timeout:180000,waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{level:1}).first().waitFor();
 await page.evaluate(()=>document.fonts.ready);
 const closeToast=page.getByRole('button',{name:'Close toast',exact:true});
 if(await closeToast.first().isVisible())await closeToast.first().click();
}
async function capture(route,label){
 const result=await page.evaluate(()=>({
  title:document.title,main:document.querySelectorAll('main').length,
  viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,theme:document.documentElement.className,
  headings:[...document.querySelectorAll('h1')].map(h=>({text:h.textContent,x:h.getBoundingClientRect().x,y:h.getBoundingClientRect().y,right:h.getBoundingClientRect().right,font:getComputedStyle(h).fontSize,weight:getComputedStyle(h).fontWeight})),
  scrollers:[...document.querySelectorAll('main > section')].map(e=>({overflow:e.scrollWidth-e.clientWidth}))
 }));
 metrics.push({route,label,...result});
 console.log(JSON.stringify(metrics.at(-1)));
 await page.screenshot({path:screenshots+'/'+route.slice(1).replaceAll('/','-')+'-'+label+'.png'});
 if(label==='desktop')await page.screenshot({path:screenshots+'/'+route.slice(1).replaceAll('/','-')+'-header.png',clip:{x:0,y:0,width:1440,height:340}});
 await fs.writeFile('out/research/page-headers/measurements.json',JSON.stringify(metrics,null,2));
}
for(const route of routes){await open(route);await capture(route,'desktop');}
await page.emulateMedia({colorScheme:'dark'});
await page.setViewportSize({width:320,height:720});
for(const route of routes.slice(1)){await open(route);await capture(route,'320-dark');}
await page.setViewportSize({width:390,height:844});
for(const route of ['/projects/new','/legal','/legal/terms','/workflows','/github/complete','/invitations/header-review']){
 await open(route);await capture(route,'mobile-dark');
}
await page.setViewportSize({width:2560,height:1440});
for(const route of ['/community','/projects/new']){await open(route);await capture(route,'wide-dark');}
await browser.close();
const failures=metrics.filter(m=>m.main!==1||m.headings.length!==1||m.documentWidth>m.viewport||m.headings[0].font!=='36px'||m.headings[0].weight!=='500'||m.title==='Tau');
console.log('Failures:',JSON.stringify(failures));
if(failures.length)process.exitCode=1;
