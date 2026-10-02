// Real public-network integration. No request routing, fixtures for news, or response replay.
// The input HWPX is synthetic; the search term and returned news are public and live.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out=path.join(root,'tests/artifacts/live_browser');
fs.mkdirSync(out,{recursive:true});
for(const name of ['validation.json','failure.json','review-screen.png','source-screen.png','failure-screen.png','list.pdf'])fs.rmSync(path.join(out,name),{force:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'rdascraper-live-'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const query='농촌진흥청';
const day=date=>date.toISOString().slice(0,10);
const end=day(new Date()),start=day(new Date(Date.now()-90*86400000));
const results=[],fetches=[],pendingFetches=[],pageErrors=[],consoleErrors=[];
let server,browser,page,base,token,serverOutput='',selected=null,browserVersion='',searchStatus='',searchLog='';
const binary=process.env.RDA_TEST_BINARY;
let binaryHash='';
async function test(name,fn){
 const began=Date.now();console.log('START '+name);
 try{await fn();results.push({name,status:'PASS',seconds:+((Date.now()-began)/1000).toFixed(2)});console.log('PASS '+name);}
 catch(error){results.push({name,status:'FAIL',seconds:+((Date.now()-began)/1000).toFixed(2),error:error.message});throw error;}
}
async function download(id,destination){
 const pending=page.waitForEvent('download',{timeout:60000});
 await page.locator('#'+id).click();const file=await pending;
 const error=await file.failure();assert.equal(error,null,'Browser download failed: '+error);
 await file.saveAs(destination);return fs.readFileSync(destination);
}
function record(status,error){
 const value={testedAt:new Date().toISOString(),status,platform:process.platform,nativeWindows:process.platform==='win32',browser:browserVersion,binarySHA256:binaryHash,
  scope:'Synthetic HWPX input; live public news search through the compiled application; no interception or replay.',
  query,period:{start,end},results,fetches,selected,searchStatus,searchLog,pageErrors,consoleErrors};
 if(error)value.error=error.stack||String(error);
 fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(value,null,2));
 if(error)fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify(value,null,2));
}
try{
 assert.ok(binary,'Set RDA_TEST_BINARY to the compiled local application.');
 assert.ok(fs.statSync(binary).isFile(),'RDA_TEST_BINARY must be a file.');binaryHash=sha256(fs.readFileSync(binary));
 await test('Start compiled local application with isolated data',async()=>{
  server=spawn(path.resolve(binary),['-no-browser','-port','0','-data-dir',profile],{stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>serverOutput+=chunk);server.stderr.on('data',chunk=>serverOutput+=chunk);
  let launchError;server.on('error',error=>{launchError=error;});
  for(let i=0;i<200;i++){
   if(launchError)throw launchError;if(server.exitCode!==null)throw Error('Application exited before readiness: '+serverOutput);
   const address=path.join(profile,'address.txt');if(fs.existsSync(address)){base=fs.readFileSync(address,'utf8').trim();break;}await pause(100);
  }
  assert.ok(base,'Application readiness timed out. '+serverOutput);
  assert.equal(new URL(base).hostname,'127.0.0.1');
  const response=await fetch(new URL('api/config',base));assert.equal(response.status,200);token=(await response.json()).token;assert.ok(token);
  const executable=process.env.RDA_BROWSER_EXECUTABLE;
  const customLinux=Boolean(executable&&process.platform==='linux');
  browser=await chromium.launch({headless:process.env.RDA_TEST_HEADED!=='1',
   ...(executable?{executablePath:executable}:process.platform==='win32'?{channel:'msedge'}:{}),
   args:customLinux?['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu']:[]});
  browserVersion=await browser.version();
  const context=await browser.newContext({viewport:{width:1536,height:1100},acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(()=>{window.__cspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.__cspViolations.push({directive:event.effectiveDirective,blocked:event.blockedURI}));});
  page.on('response',response=>{
   if(new URL(response.url()).pathname!=='/api/fetch')return;
   pendingFetches.push((async()=>{try{
    const requested=response.request().postDataJSON()?.url;const data=await response.json();
    fetches.push({requested,url:data.url||requested,ok:data.ok===true,httpStatus:data.status||null,apiStatus:response.status(),characters:(data.text||'').length,error:data.error||'',contentSHA256:data.text?sha256(data.text):''});
   }catch(error){fetches.push({ok:false,error:'Could not record fetch response: '+error.message});}})());
  });
  const responsePage=await page.goto(base);assert.match(responsePage.headers()['content-security-policy'],/script-src-attr 'none'/);
  await page.waitForFunction(()=>document.getElementById('connection').textContent==='내 PC에서 실행 중');
 });
 await test('File input: synthetic HWPX document analysis',async()=>{
  await page.locator('#file').setInputFiles(path.join(root,'tests/fixtures/synthetic_breeding.hwpx'));
  await page.waitForFunction(()=>!document.getElementById('analysis').hidden&&!document.getElementById('searchBtn').disabled,{},{timeout:60000});
  assert.match((await page.locator('#preview').inputValue()).replace(/\s/g,''),/농촌진흥청/);
  assert.ok((await page.locator('#pressTitle').inputValue()).length>5);
  assert.ok(await page.locator('#keywords button').count()>5);
 });
 let project;
 await test('Live public news search over the last 90 days',async()=>{
  await page.locator('#start').fill(start);await page.locator('#start').dispatchEvent('change');
  await page.locator('#end').fill(end);await page.locator('#end').dispatchEvent('change');
  for(const source of ['naver','google','daum','bing'])await page.locator(`input[name=source][value="${source}"]`).check();
  await page.locator('details.generated').evaluate(element=>element.open=true);
  await page.locator('#queries').fill(query);await page.locator('#searchBtn').click();
  await page.waitForFunction(()=>document.getElementById('stopBtn').disabled&&/^(검색 완료|검색 중단)/.test(document.getElementById('searchStatus').textContent),{},{timeout:330000});
  searchStatus=await page.locator('#searchStatus').innerText();searchLog=await page.locator('#logs').innerText();
  await Promise.allSettled(pendingFetches);
  assert.ok(Number(await page.locator('#totalCount').innerText())>0,'No live news results. '+searchStatus+'\n'+searchLog);
  const projectPath=path.join(profile,'live-project.json');project=JSON.parse((await download('saveBtn',projectPath)).toString());
  assert.ok(project.results.length>0);assert.ok(fetches.some(item=>item.ok&&/search\.naver\.com|news\.google\.com|search\.daum\.net|bing\.com/.test(new URL(item.url).hostname)),'No successful real search response.');
 });
 let selectedIndex;
 await test('Verify actual source title, publication date and substantive body',async()=>{
  selectedIndex=project.results.findIndex(article=>article.checked===true&&!article.linkMismatch&&article.title?.length>5&&article.body?.length>=200&&article.dateSource==='원문 게시일'&&article.date>=start&&article.date<=end&&new URL(article.url).hostname!=='news.google.com');
  assert.ok(selectedIndex>=0,'News candidates were found but no source supplied a confirmed title, original publication date and at least 200 body characters.');
  const article=project.results[selectedIndex];
  const matchingFetch=fetches.find(item=>item.ok&&(item.url===article.url||item.requested===article.url));
  assert.ok(matchingFetch&&matchingFetch.characters>=200,'No successful live source response corresponds to the selected article.');
  selected={title:article.title,url:article.url,media:article.media,date:article.date,dateSource:article.dateSource,bodyCharacters:article.body.length,source:article.source||article.sources,match:article.match};
  await page.locator(`[data-detail="${selectedIndex}"]`).click();
  assert.match(await page.locator('#articleEvidence').innerText(),/원문 확인/);
  assert.equal(await page.locator('#editArticleTitle').inputValue(),article.title);
  assert.equal(await page.locator('#editArticleDate').inputValue(),article.date);
  assert.ok((await page.locator('#articleBody').inputValue()).length>=200);
  assert.equal(await page.locator('#articleLink').getAttribute('href'),article.url);
  await page.screenshot({path:path.join(out,'source-screen.png'),fullPage:true});
  await page.locator('#closeArticle').click();
 });
 await test('Open the original article from its title link',async()=>{
  const popupPromise=page.context().waitForEvent('page');
  await page.locator(`#results tr[data-index="${selectedIndex}"] td:nth-child(5) > a`).click();
  const original=await popupPromise;
  try{
   await original.waitForLoadState('domcontentloaded',{timeout:45000});
   const body=await original.locator('body').innerText({timeout:10000});
   const words=selected.title.split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>=2);
   assert.ok(words.filter(word=>body.includes(word)).length>=Math.min(2,words.length),'The opened source page did not contain the article headline; it may be blocked by the site.');
   assert.ok(body.length>=200,'Opened source page did not contain readable content.');
   selected.openedSourceURL=original.url();selected.openedPageTitle=await original.title();
  }finally{await original.close();}
 });
 await test('Select the verified article and download its review-list PDF',async()=>{
  await page.locator('#clearShown').click();await page.locator(`[data-select="${selectedIndex}"]`).check();
  assert.equal(await page.locator('#selectedCount').innerText(),'1');
  const pdfs=[];
  for(const [id,file] of [['pdfBtn','list.pdf']]){
   const bytes=await download(id,path.join(out,file));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);
   pdfs.push({file,bytes:bytes.length,sha256:sha256(bytes)});
  }
  selected.pdfs=pdfs;await page.screenshot({path:path.join(out,'review-screen.png'),fullPage:true});
 });
 await test('Production content security policy and application page remain clean',async()=>{
  assert.deepEqual(await page.evaluate(()=>window.__cspViolations),[]);assert.deepEqual(pageErrors,[]);
 });
 record('PASS');console.log('TOTAL '+results.length+' PASS (live public news, '+process.platform+')');
}catch(error){
 if(page){searchStatus=await page.locator('#searchStatus').innerText().catch(()=>searchStatus);searchLog=await page.locator('#logs').innerText().catch(()=>searchLog);await page.screenshot({path:path.join(out,'failure-screen.png'),fullPage:true}).catch(()=>{});}
 await Promise.allSettled(pendingFetches);record('FAIL',error);throw error;
}finally{
 if(browser)await browser.close();
 if(server){if(base&&token)await fetch(new URL('api/shutdown',base),{method:'POST',headers:{'X-RDA-Token':token}}).catch(()=>{});await pause(500);if(server.exitCode===null)server.kill();}
 fs.rmSync(profile,{recursive:true,force:true});
}
