// Run after browser_test.mjs exports its synthetic project fixture.
// Exercises the real UI while resizing one Chromium window; no native Windows claim.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out=path.join(root,'tests/artifacts/appearance');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'rda-appearance-'));
const binary=process.env.RDA_TEST_BINARY;assert.ok(binary,'Set RDA_TEST_BINARY.');
const server=spawn(path.resolve(binary),['--no-browser','--port','0','--data-dir',profile]);
let browser,base,token;const results=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
 for(let i=0;i<100;i++){
  if(fs.existsSync(path.join(profile,'address.txt'))){base=fs.readFileSync(path.join(profile,'address.txt'),'utf8').trim();break;}
  if(server.exitCode!==null)throw Error('Local server exited');await sleep(100);
 }
 assert.ok(base);const config=await(await fetch(base+'api/config')).json();token=config.token;
 browser=await chromium.launch({headless:true,...(process.env.RDA_BROWSER_EXECUTABLE?{executablePath:process.env.RDA_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu']}: {})});
 const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
 page.on('dialog',dialog=>dialog.accept());const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const response=await page.goto(base);assert.equal(response.headers()['cache-control'],'no-store');
 await page.waitForFunction(()=>document.getElementById('connection').textContent==='내 PC에서 실행 중');
 assert.equal(await page.locator('#textSize').inputValue(),'default');
 await page.locator('#projectFile').setInputFiles(path.join(root,'tests/artifacts/browser/saveBtn.json'));
 await page.waitForFunction(()=>document.getElementById('totalCount').textContent==='1');
 for(const [preset,minSize,maxSize] of [['default',18,19],['large',20,21],['extra',22,23]]){
  await page.locator('#textSize').selectOption(preset);
  const sizes=[];
  for(const width of [1920,1440,1366,1024,768,390]){
   await page.setViewportSize({width,height:width<800?844:1100});
   await page.evaluate(async()=>{await document.fonts.ready;scrollTo({top:0,behavior:'instant'});});await sleep(100);
   const measurement=await page.evaluate(()=>{
    const $=s=>document.querySelector(s),style=s=>{const c=getComputedStyle($(s));return {family:c.fontFamily,size:parseFloat(c.fontSize),weight:c.fontWeight}};
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
    const text=[...document.querySelectorAll('button,label,.field-note,.badge,.snippet,.detail-btn,th,td,small,input,select,textarea')].filter(visible);
    const faces=[...document.fonts].map(f=>({family:f.family,status:f.status}));
    const rect=e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const items=[...document.querySelectorAll('header nav > *')].filter(visible).map(rect),collisions=[];
    for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++){
     const x=items[a],y=items[b];if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)collisions.push([x.id,y.id]);
    }
    const cards=[...document.querySelectorAll('.workspace > .card')].map(rect);
    return {preset:document.documentElement.dataset.textSize,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
     body:style('body'),input:style('#manual'),button:style('#searchBtn'),title:style('td a'),table:style('td'),helper:style('.field-note'),
     loadedFont:faces.some(f=>f.family.includes('Noto Sans KR')&&f.status==='loaded'),
     smallText:text.filter(e=>parseFloat(getComputedStyle(e).fontSize)<14.99).map(e=>({tag:e.tagName,cls:e.className,size:getComputedStyle(e).fontSize})),
     header:{height:$('header').getBoundingClientRect().height,items,collisions},
     columns:Math.abs(cards[0].top-cards[1].top)<2?2:1,
     tableOverflow:$('#tableWrap').scrollWidth>$('#tableWrap').clientWidth};
   });
   assert.ok(measurement.body.size>=minSize-.01&&measurement.body.size<=maxSize+.01,JSON.stringify(measurement));
   assert.ok(measurement.loadedFont,'Bundled Noto Sans KR must actually load.');
   assert.ok(measurement.input.size>=16&&measurement.title.size>=19,'Main text must remain readable.');
   assert.ok(measurement.scrollWidth<=width+1,JSON.stringify(measurement));
   assert.deepEqual(measurement.smallText,[]);assert.deepEqual(measurement.header.collisions,[]);
   assert.ok(measurement.header.items.every(r=>r.left>=0&&r.right<=width+1),'Every header control stays within the viewport.');
   if(width===1920)assert.equal(measurement.columns,2,'Wide windows show the input/search cards side by side.');
   if(width<=768)assert.equal(measurement.columns,1,'Narrow windows stack the input/search cards.');
   sizes.push(measurement.body.size);results.push(measurement);
   if(preset==='default'&&[1920,1366,390].includes(width)||preset==='extra'&&[1366,390].includes(width))
    await page.screenshot({path:path.join(out,`${preset}-${width}.png`),fullPage:true});
  }
  assert.ok(sizes[0]>sizes.at(-1),'Resizing this same page must change the reading scale.');
  assert.ok(sizes.every((size,i)=>i===0||size<=sizes[i-1]+.01),'Scale changes continuously in the expected direction.');
 }
 // Reading preference survives reload and a return to a wide window.
 await page.reload();await page.waitForFunction(()=>document.getElementById('connection').textContent==='내 PC에서 실행 중');
 assert.equal(await page.locator('#textSize').inputValue(),'extra');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontSize),'22px');
 await page.setViewportSize({width:1920,height:1100});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontSize),'23px');
 // Keyboard users can still see and operate the compact header controls.
 await page.locator('#helpBtn').focus();await page.keyboard.press('Tab');
 const focus=await page.evaluate(()=>{const e=document.activeElement,c=getComputedStyle(e);return {id:e.id,style:c.outlineStyle,width:parseFloat(c.outlineWidth)}});
 assert.equal(focus.id,'privacyBtn');assert.equal(focus.style,'solid');assert.ok(focus.width>=3);
 // Inspect the article editor at the largest preference in a narrow window.
 await page.setViewportSize({width:390,height:844});
 await page.locator('#projectFile').setInputFiles(path.join(root,'tests/artifacts/browser/saveBtn.json'));
 await page.waitForFunction(()=>document.getElementById('totalCount').textContent==='1');
 await page.locator('[data-detail]').click();
 const dialog=await page.locator('#articleDialog').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}});
 assert.ok(dialog.left>=0&&dialog.right<=390&&dialog.top>=0&&dialog.bottom<=844,'Article dialog fits the narrow viewport.');
 assert.ok(dialog.scrollWidth<=dialog.clientWidth+1,'Article dialog has no horizontal content overflow.');
 await page.screenshot({path:path.join(out,'article-dialog-narrow.png')});
 await page.locator('#closeArticle').click();
 await page.locator('#textSize').selectOption('default');await page.setViewportSize({width:1440,height:1100});
 await page.locator('[data-detail]').click();await page.screenshot({path:path.join(out,'article-dialog.png')});
 assert.deepEqual(errors,[]);
 const record={platform:process.platform,nativeWindows:process.platform==='win32',browser:await browser.version(),
  appVersion:config.version,scope:'Real Chromium rendering with a synthetic article and dynamic viewport resizing; no live-news or native-Windows claim',status:'PASS',
  sizesPersistAcrossReload:true,HTMLCache:'no-store',minimumControlTextPx:15,keyboardFocus:focus,narrowDialog:dialog,results};
 fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(record,null,2)+'\n');
 console.log(`PASS ${results.length} viewport/size combinations; dynamic resizing; Noto Sans KR; minimum 15px; header bounds; no page overflow; keyboard focus; narrow dialog; preference persistence`);
} finally {
 if(browser)await browser.close();
 if(base&&token)await fetch(base+'api/shutdown',{method:'POST',headers:{'X-RDA-Token':token}}).catch(()=>{});
 await sleep(250);if(server.exitCode===null)server.kill();fs.rmSync(profile,{recursive:true,force:true});
}
