// Real Chromium integration against the compiled local application, with CSP enabled.
// News HTML is synthetic and intercepted at the app's same-origin /api/fetch route.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),JSZip=require('../web/vendor/jszip.min.js');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out=path.join(root,'tests/artifacts/browser');fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'failure.json'),{force:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'rdascraper-browser-'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const binary=process.env.RDA_TEST_BINARY;
let server,base=process.env.RDA_TEST_BASE_URL,browser,token,serverOutput='';
const results=[],errors=[],requests=[],responses=[],warnings=[];
async function test(name,fn){const start=Date.now();await fn();results.push({name,status:'PASS',seconds:+((Date.now()-start)/1000).toFixed(2)});console.log('PASS '+name);}
try {
 if(!base){
  assert.ok(binary,'Set RDA_TEST_BINARY to the compiled application.');
  server=spawn(path.resolve(binary),['-no-browser','-port','0','-data-dir',profile],{stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',b=>serverOutput+=b);server.stderr.on('data',b=>serverOutput+=b);
  server.on('error',e=>errors.push(String(e)));
  for(let i=0;i<150;i++){const f=path.join(profile,'address.txt');if(fs.existsSync(f)){base=fs.readFileSync(f,'utf8').trim();break;}if(server.exitCode!==null)throw Error('App exited: '+serverOutput);await pause(100);}
  assert.ok(base,'App did not create its readiness address file: '+serverOutput);
 }
 token=(await (await fetch(new URL('api/config',base))).json()).token;
 browser=await chromium.launch({headless:true,...(process.env.RDA_BROWSER_EXECUTABLE?{executablePath:process.env.RDA_BROWSER_EXECUTABLE}:{}),args:process.env.RDA_BROWSER_EXECUTABLE?['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu']:[]});
 const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
 page.on('request',r=>requests.push(r.url()));page.on('response',r=>responses.push({url:r.url(),status:r.status()}));
 await page.addInitScript(()=>{window.__cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.__cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));});
 page.on('dialog',d=>d.accept());
 await test('Local startup and production CSP',async()=>{
  const r=await page.goto(base);assert.match(r.headers()['content-security-policy'],/script-src-attr 'none'/);
  await page.waitForFunction(()=>document.getElementById('connection').textContent==='내 PC에서 실행 중');
  assert.equal(await page.locator('#totalCount').innerText(),'0');
  assert.doesNotMatch(await page.locator('body').innerText(),/v\d+\s*·\s*ONE FILE/);
 });
 async function reset(){await page.locator('#homeBtn').click();await page.waitForFunction(()=>!document.getElementById('homeBtn').disabled&&document.getElementById('analysis').hidden);}
 async function parseFile(rel,ocrMode,ocrExpected){
  await reset();await page.locator('#ocrMode').selectOption(ocrMode);
  await page.locator('#file').setInputFiles(path.join(root,rel));
  await page.waitForFunction(()=>document.getElementById('cancelAnalysis').hidden,{},{timeout:180000});
  const status=await page.locator('#analysisStatus').innerText();
  assert.equal(await page.locator('#analysis').getAttribute('hidden'),null,'Parse failed: '+status);
  const text=await page.locator('#preview').inputValue();assert.ok(text.length>100,status);assert.match(text.replace(/\s/g,''),/농촌진흥청/);
  assert.ok(await page.locator('#keywords button').count()>5);
  if(ocrExpected)assert.match(status,/OCR/);return {status,characters:text.length};
 }
 for(const [rel,mode,ocr] of [
  ['tests/fixtures/synthetic_breeding.hwp','auto',false],
  ['tests/fixtures/synthetic_breeding.hwpx','auto',false],
  ['tests/fixtures/synthetic_breeding.pdf','auto',false],
  ['tests/ocr/scanned_press.png','auto',true],
  ['tests/ocr/scanned_press.pdf','auto',true],
  ['tests/fixtures/synthetic_breeding.pdf','always',true]
 ])await test('Browser document / OCR: '+path.basename(rel)+' ('+mode+')',async()=>{const r=await parseFile(rel,mode,ocr);console.log('  '+r.status.split('\n')[0]+'; '+r.characters+' characters');});
 await test('Document processing makes no external network request',async()=>{
  assert.deepEqual(requests.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')&&!u.startsWith('data:')),[]);
  assert.deepEqual(responses.filter(r=>r.status>=400),[]);
  assert.ok(requests.some(u=>u.includes('/vendor/pdf.worker.mjs')));
  assert.ok(requests.some(u=>u.includes('/vendor/ocr/lang/kor.traineddata.gz')));
  assert.deepEqual(await page.evaluate(()=>window.__cspViolations),[]);
 });
 await reset();
 const title='농촌진흥청 콩 유전체 디지털육종 기술 개발';
 const body='농촌진흥청 국립농업과학원은 콩 유전체 데이터와 디지털육종 기술을 이용해 새로운 품종을 선발한다. '.repeat(6);
 await test('Manual analysis and one-click date calendar',async()=>{
  await page.locator('#manual').fill(title+'\n'+body);await page.locator('#analyzeBtn').click();
  assert.equal(await page.locator('#pressTitle').inputValue(),title);
  await page.locator('#start').fill('2026-06-01');await page.locator('.calendar-open[data-target="start"]').click();
  await page.locator('[data-day="2026-06-09"]').click();assert.equal(await page.locator('#start').inputValue(),'2026-06-09');
  assert.equal(await page.locator('#calendar').getAttribute('open'),null);
 });
 const card=`<div class="fds-news-item-list-tab"><div class="sds-comps-profile-info-title-text">농업신문</div><span class="sds-comps-profile-info-subtext">2026.06.09.</span><a data-heatmap-target=".tit" href="https://news.example/article/1">${title}</a><a data-heatmap-target=".body" href="https://news.example/article/1">${body}</a></div>`;
 const article=`<meta property="og:title" content="${title}"><meta property="article:published_time" content="2026-06-09T11:00:00+09:00"><meta property="og:site_name" content="농업신문"><article>${body}</article>`;
 await page.route('**/api/fetch',async route=>{const request=route.request().postDataJSON(),url=request.url;await route.fulfill({json:{ok:true,url,text:url.includes('search.naver.com')?card:article}});});
 await test('Synthetic news: search, source verification, row numbering and selection',async()=>{
  for(const source of ['naver','google','daum']){const el=page.locator(`input[name=source][value="${source}"]`);if(await el.count())await el.setChecked(source==='naver');}
  await page.locator('details.generated > summary').click();await page.locator('#queries').fill('콩 유전체 농촌진흥청');await page.locator('#searchBtn').click();
  await page.waitForFunction(()=>document.getElementById('searchStatus').textContent.startsWith('검색 완료'));
  assert.equal(await page.locator('#totalCount').innerText(),'1');assert.equal(await page.locator('#readyCount').innerText(),'1');
  assert.equal(await page.locator('.article-number').innerText(),'1');
  await page.locator('#results tr').click();assert.equal(await page.locator('#selectedCount').innerText(),'0');
  await page.locator('#results tr').press('Space');assert.equal(await page.locator('#selectedCount').innerText(),'1');
 });
 const downloads={};
 await test('Fixed-row XLSX, CSV, review PDF and JSON downloads',async()=>{
  for(const id of ['xlsxBtn','csvBtn','pdfBtn','saveBtn']){
   const promise=page.waitForEvent('download');await page.locator('#'+id).click();const d=await promise;
   const dest=path.join(out,id+path.extname(d.suggestedFilename()));await d.saveAs(dest);const bytes=fs.readFileSync(dest);downloads[id]=bytes;
   if(id.includes('PDF')||id==='pdfBtn')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
   if(id==='csvBtn')assert.match(bytes.toString(),/매체 점수/);
   if(id==='xlsxBtn'){const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');const rows=[...xml.matchAll(/<row\b([^>]*)>/g)];assert.equal(rows.length,2);for(const row of rows){assert.match(row[1],/ht="30"/);assert.match(row[1],/customHeight="1"/);}assert.match(xml,/매체 점수/);}
  }
  assert.equal(JSON.parse(downloads.saveBtn).results.length,1);
 });
 await test('Review PDF keeps original article numbers ascending without new article or printer requests',async()=>{
  const project=JSON.parse(downloads.saveBtn),original=project.results[0];
  project.results=[
   {...original,articleNo:24,title:'마지막 번호 정렬 확인 기사',url:'https://news.example/article/24'},
   {...original,articleNo:8,title:'선택하지 않은 기사',url:'https://news.example/article/8',included:false},
   {...original,articleNo:2,title:'두 번째 번호 정렬 확인 기사',url:'https://news.example/article/2'},
   {...original,articleNo:1,title:'첫 번째 번호 정렬 확인 기사',url:'https://news.example/article/1'}
  ];
  await page.locator('#projectFile').setInputFiles({name:'unordered-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await page.waitForFunction(()=>document.getElementById('totalCount').textContent==='4');
  const requestStart=requests.length,pending=page.waitForEvent('download');await page.locator('#pdfBtn').click();const file=await pending;
  assert.match(file.suggestedFilename(),/검수목록/);const dest=path.join(out,'numbered-review.pdf');await file.saveAs(dest);
  const text=await page.evaluate(async encoded=>{
   const pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',location.href).href;
   const loading=pdfjs.getDocument({data:Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),isEvalSupported:false}),doc=await loading.promise;
   const lines=[];for(let i=1;i<=doc.numPages;i++)lines.push((await(await doc.getPage(i)).getTextContent()).items.map(item=>item.str||'').join(''));
   await loading.destroy();return lines.join('\n');
  },fs.readFileSync(dest).toString('base64'));
  assert.ok(text.indexOf('1. 첫 번째')>=0);assert.ok(text.indexOf('1. 첫 번째')<text.indexOf('2. 두 번째'));assert.ok(text.indexOf('2. 두 번째')<text.indexOf('24. 마지막'));
  assert.doesNotMatch(text,/선택하지 않은 기사/);
  assert.deepEqual(requests.slice(requestStart).filter(url=>new URL(url).pathname==='/api/fetch'||new URL(url).pathname==='/api/article-pdf'),[]);
  assert.equal(await page.locator('#bodyPDFBtn, #textPDFBtn, #exportDetails').count(),0);
  await page.locator('#projectFile').setInputFiles({name:'original-project.json',mimeType:'application/json',buffer:downloads.saveBtn});
  await page.waitForFunction(()=>document.getElementById('totalCount').textContent==='1');
 });
 await test('Three export buttons fit standard and narrower windows',async()=>{
  for(const width of [1440,980,768,390]){await page.setViewportSize({width,height:1000});await page.locator('#saveStep').scrollIntoViewIfNeeded();const boxes=await page.locator('.export-actions button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,clipped:b.scrollWidth>b.clientWidth};}));assert.equal(boxes.length,3);assert.ok(boxes.every(r=>r.left>=0&&r.right<=width&&r.width>=80&&!r.clipped),JSON.stringify({width,boxes}));await page.locator('#saveStep').screenshot({path:path.join(out,`export-${width}.png`)});}
  await page.setViewportSize({width:1440,height:1100});
 });
 await page.screenshot({path:path.join(out,'review-screen.png'),fullPage:true});
 await test('Forged project values are rejected without replacing current work',async()=>{
  const p=JSON.parse(downloads.saveBtn);p.results[0].mediaScore='<img src=x onerror="window.__injected=1">';
  await page.locator('#projectFile').setInputFiles({name:'malformed-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
  await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('매체 점수'));
  assert.equal(await page.locator('#totalCount').innerText(),'1');assert.equal(await page.evaluate(()=>window.__injected),undefined);
 });
 await test('Local retention off clears saved work; manual download still works',async()=>{
  await page.locator('#privacyBtn').click();await page.locator('#rememberWork').uncheck();
  await page.waitForFunction(()=>document.getElementById('privacyStatus').textContent.includes('자동 저장을 껐습니다'));
  const config=await(await fetch(new URL('api/config',base))).json();assert.equal(config.autoSave,false);
  const disk=await(await fetch(new URL('api/project',base),{headers:{'X-RDA-Token':token}})).json();assert.equal(disk.project.reset,true);assert.equal(disk.project.press,null);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/^rda-v/.test(k)).length),0);
  assert.equal(await page.locator('#totalCount').innerText(),'1');
  await page.screenshot({path:path.join(out,'privacy-screen.png'),fullPage:true});
  await page.locator('#closePrivacy').click();const pending=page.waitForEvent('download');await page.locator('#saveBtn').click();assert.match((await pending).suggestedFilename(),/\.json$/);
  const r=await fetch(new URL('api/project',base),{method:'POST',headers:{'X-RDA-Token':token,'Content-Type':'application/json'},body:downloads.saveBtn});assert.equal(r.status,409);
 });
 await test('Logo reset, refresh and production CSP remain clean',async()=>{
  assert.deepEqual(await page.evaluate(()=>window.__cspViolations),[]);await reset();await page.reload();await page.waitForFunction(()=>document.getElementById('connection').textContent==='내 PC에서 실행 중');
  assert.equal(await page.locator('#analysis').getAttribute('hidden'),'');assert.equal(await page.locator('#totalCount').innerText(),'0');
  assert.deepEqual(await page.evaluate(()=>window.__cspViolations),[]);assert.deepEqual(errors,[]);
 });
 const result={testedAt:new Date().toISOString(),platform:process.platform,browser:await browser.version(),results,pageErrors:errors,warnings,networkScope:'same-origin only; synthetic news /api/fetch intercepted; no live search claim',csp:'enabled; no violations',nativeWindows:process.platform==='win32'};
 fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(result,null,2));console.log(`TOTAL ${results.length} PASS (real Chromium, ${process.platform}; synthetic news)`);
} catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.stack,results,errors,warnings,responses:responses.filter(r=>r.status>=400)},null,2));throw e;}
finally {
 if(browser)await browser.close();
 if(server){if(base&&token)await fetch(new URL('api/shutdown',base),{method:'POST',headers:{'X-RDA-Token':token}}).catch(()=>{});await pause(500);if(server.exitCode===null)server.kill();}
 fs.rmSync(profile,{recursive:true,force:true});
}
