// DOM interaction tests. This is not a native Windows/browser rendering test.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
import assert from 'node:assert/strict';
import {JSDOM} from './dom_helpers.mjs';
const web=new URL('../web/',import.meta.url);
const dom=new JSDOM(fs.readFileSync(new URL('index.html',web),'utf8'),{url:'http://127.0.0.1:8765/',pretendToBeVisual:true});
const {window}=dom;window.pako=require('../web/vendor/pako.min.js');window.JSZip=require('../web/vendor/jszip.min.js');window.sax=require('../web/vendor/sax.js');for(const key of ['window','document','localStorage','DOMParser'])globalThis[key]=key==='window'?window:window[key];
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const $=id=>document.getElementById(id),click=id=>$(id).click();
let disk=null,delayFetch=false,fetchCalls=0,shut=false,failDisk=false,holdSave=false,releaseSave=null,holdFont=false,releaseFont=null,holdArticle=false,releaseArticle=null;const downloads=[];const blobs=new Map();let n=0;
URL.createObjectURL=b=>{const key='blob:test-'+(++n);blobs.set(key,b);return key;};URL.revokeObjectURL=u=>blobs.delete(u);
window.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:blobs.get(this.href)});};
window.confirm=()=>true;window.open=()=>null;window.scrollTo=()=>{};
const baseInterval=globalThis.setInterval;globalThis.setInterval=(...a)=>{const handle=baseInterval(...a);handle.unref();return handle;};
const title='농촌진흥청 콩 유전체 디지털육종 기술 개발';
const body='농촌진흥청 국립농업과학원은 콩 유전체 데이터와 디지털육종 기술을 이용해 새로운 품종을 선발한다. '.repeat(6);
const card=`<div class="fds-news-item-list-tab"><div class="sds-comps-profile-info-title-text">농업신문</div><span class="sds-comps-profile-info-subtext">2026.06.09.</span><a data-heatmap-target=".tit" href="https://news.example/article/1">${title}</a><a data-heatmap-target=".body" href="https://news.example/article/1">${body}</a></div>`;
const article=`<meta property="og:title" content="${title}"><meta property="article:published_time" content="2026-06-09T11:00:00+09:00"><meta property="og:site_name" content="농업신문"><article>${body}</article>`;
globalThis.fetch=async(u,o={})=>{
 u=String(u);let result;
 if(u==='/api/config')result={ok:true,token:'test-token',version:'65.0.0'};
 else if(u==='/api/health')result={ok:true};
 else if(u.endsWith('media_master.json'))result=JSON.parse(fs.readFileSync(new URL('media_master.json',web)));
 else if(u.endsWith('NotoSansKR-Bold.ttf')){if(holdFont){holdFont=false;await new Promise(r=>releaseFont=r);}return new Response(fs.readFileSync(new URL('assets/NotoSansKR-Bold.ttf',web)));}
 else if(u==='/api/project'){
  assert.equal(o.headers?.['X-RDA-Token'],'test-token');
  if(o.method==='POST'){if(failDisk)return new Response(JSON.stringify({ok:false,error:'저장 실패'}),{status:500});if(holdSave){holdSave=false;await new Promise(r=>{releaseSave=r;});}disk=JSON.parse(o.body);result={ok:true};}else result={ok:true,project:disk};
 }else if(u==='/api/fetch'){
  fetchCalls++;assert.equal(o.headers?.['X-RDA-Token'],'test-token');if(delayFetch){if(o.signal.aborted)throw new DOMException('Aborted','AbortError');await new Promise((_,rej)=>o.signal.addEventListener('abort',()=>rej(new DOMException('Aborted','AbortError')),{once:true}));}
  const url=JSON.parse(o.body).url;
  if(holdArticle&&!url.includes('search.naver.com')){
   holdArticle=false;
   await new Promise((resolve,reject)=>{
    const finish=error=>{clearTimeout(deadline);o.signal?.removeEventListener('abort',abort);releaseArticle=null;error?reject(error):resolve();};
    const abort=()=>finish(new DOMException('Aborted','AbortError'));
    const deadline=setTimeout(()=>finish(Error('Held article test request timed out')),3000);
    releaseArticle=()=>finish();if(o.signal?.aborted)abort();else o.signal?.addEventListener('abort',abort,{once:true});
   });
  }
  result={ok:true,url,text:url.includes('search.naver.com')?card:article};
 }else if(u==='/api/shutdown'){shut=true;result={ok:true};}
 else throw Error('Unexpected request '+u);
 return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
};
const waitFor=async(predicate,label='condition',ms=6000)=>{const deadline=Date.now()+ms;while(!predicate()){if(Date.now()>deadline)throw Error('Timeout '+label+'; '+($('exportStatus')?.textContent||''));await new Promise(r=>setTimeout(r,20));}};
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
await import('../web/app.mjs');
await waitFor(()=>$('connection').textContent==='내 PC에서 실행 중','init');
await test('Fresh startup has empty results and disabled exports',()=>{assert.equal($('totalCount').textContent,'0');assert.equal($('searchBtn').disabled,true);assert.equal($('csvBtn').disabled,true);});
await test('Manual text becomes editable title and queries',()=>{$('manual').value=title+'\n'+body;click('analyzeBtn');assert.equal($('analysis').hidden,false);assert.equal($('pressTitle').value,title);assert.ok(document.querySelectorAll('#keywords button').length>2);assert.equal($('searchBtn').disabled,false);});
await test('Keyword toggle and user keyword addition',()=>{const c=document.querySelector('#keywords button');c.click();assert.equal(document.querySelector('#keywords button').getAttribute('aria-pressed'),'false');$('keywordInput').value='희귀변이, 기능성소재';click('addKeyword');assert.match($('keywords').textContent,/희귀변이/);assert.match($('keywords').textContent,/기능성소재/);});
await test('June 9 selected with one click; calendar closes',()=>{$('start').value='2026-06-01';document.querySelector('.calendar-open[data-target="start"]').click();assert.equal($('calendar').open,true);document.querySelector('[data-day="2026-06-09"]').click();assert.equal($('start').value,'2026-06-09');assert.equal($('end').value,'2026-06-23');assert.equal($('calendar').open,false);});
await test('Quick duration is reflected immediately',()=>{document.querySelector('[data-days="7"]').click();assert.equal($('end').value,'2026-06-16');});
await test('Search runs real handlers, deduplicates and verifies source',async()=>{
 document.querySelectorAll('input[name=source]').forEach(x=>x.checked=x.value==='naver');$('queries').value='콩 유전체 농촌진흥청';$('queries').dispatchEvent(new window.Event('input'));
 click('searchBtn');assert.equal($('searchBtn').disabled,true);assert.equal($('stopBtn').disabled,false);await waitFor(()=>$('searchStatus').textContent.startsWith('검색 완료'),'search');assert.equal($('totalCount').textContent,'1');assert.equal($('readyCount').textContent,'1');assert.equal($('selectedCount').textContent,'1');assert.equal($('inputFields').disabled,false);
});
await test('Whole row and keyboard toggle article selection',()=>{document.querySelector('#results tr').click();assert.equal($('selectedCount').textContent,'0');document.querySelector('#results tr').dispatchEvent(new window.KeyboardEvent('keydown',{key:' ',bubbles:true}));assert.equal($('selectedCount').textContent,'1');});
await test('Article detail edits date and records user confirmation',()=>{document.querySelector('[data-detail]').click();assert.equal($('articleDialog').open,true);assert.match($('articleBody').value,/디지털육종/);$('editArticleDate').value='2026-06-10';click('saveArticle');assert.equal($('articleDialog').open,false);assert.match($('results').textContent,/2026-06-10/);assert.match($('results').textContent,/사용자 확인/);});
await test('Result filter and current-view selection',()=>{$('filter').value='없는제목';$('filter').dispatchEvent(new window.Event('input'));assert.equal($('shownCount').textContent,'0건 표시');$('filter').value='콩';$('filter').dispatchEvent(new window.Event('input'));click('clearShown');assert.equal($('selectedCount').textContent,'0');click('selectShown');assert.equal($('selectedCount').textContent,'1');});
await test('CSV export has readable Korean fields and selected article',async()=>{click('csvBtn');const d=downloads.at(-1);assert.match(d.name,/\.csv$/);const text=await d.blob.text();assert.match(text,/매체 점수/);assert.match(text,/번호/);assert.match(text,/"Y","1"/);assert.match(text,/사용자 확인/);assert.match(text,/news.example\/article\/1/);});
await test('Fixed-row XLSX download is a genuine workbook',async()=>{
 const before=downloads.length;click('xlsxBtn');await waitFor(()=>downloads.length>before,'XLSX export');const d=downloads.at(-1);assert.match(d.name,/\.xlsx$/);const z=await window.JSZip.loadAsync(await d.blob.arrayBuffer());const xml=await z.file('xl/worksheets/sheet1.xml').async('string');assert.match(xml,/customHeight="1"/);assert.match(xml,/ht="30"/);assert.match(xml,/매체 점수/);
});
await test('Starting XLSX or PDF export immediately locks selection and restores it after completion',async()=>{
 for(const id of ['xlsxBtn','pdfBtn']){
  const checkbox=document.querySelector('[data-select]'),selected=$('selectedCount').textContent,before=downloads.length;
  assert.equal(checkbox.disabled,false);assert.equal(checkbox.checked,true);
  if(id==='pdfBtn'){holdFont=true;releaseFont=null;}
  click(id);assert.equal(checkbox.disabled,true,'existing checkbox must lock without a render');
  checkbox.click();assert.equal(checkbox.checked,true);
  checkbox.checked=false;checkbox.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(checkbox.checked,true,'busy change handler must restore the stored selection');assert.equal($('selectedCount').textContent,selected);
  if(id==='pdfBtn'){await waitFor(()=>releaseFont,'selection-lock font request');releaseFont();}
  await waitFor(()=>downloads.length>before&& !document.querySelector('[data-select]').disabled,'selection unlocked after export');
  assert.equal(document.querySelector('[data-select]').checked,true);assert.equal($('selectedCount').textContent,selected);
 }
});
await test('Review PDF uses the local font without fetching article pages or launching a printer',async()=>{
 assert.deepEqual([...document.querySelectorAll('.export-actions button')].map(b=>b.id),['xlsxBtn','csvBtn','pdfBtn']);
 assert.equal($('bodyPDFBtn'),null);assert.equal($('textPDFBtn'),null);
 const before=downloads.length,requestsBefore=fetchCalls;click('pdfBtn');await waitFor(()=>downloads.length>before,'review PDF');
 const d=downloads.at(-1);assert.match(d.name,/RDA_검수목록_.*\.pdf$/);
 const bytes=Buffer.from(await d.blob.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(fetchCalls,requestsBefore);
 fs.mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('./artifacts/list.pdf',import.meta.url),bytes);
});
let project;
await test('JSON export and disk automatic save retain selection and query',async()=>{click('saveBtn');project=JSON.parse(await downloads.at(-1).blob.text());assert.equal(project.version,64);assert.equal(project.results[0].included,true);assert.equal(project.results[0].date,'2026-06-10');assert.equal(project.queries,'콩 유전체 농촌진흥청');await waitFor(()=>disk?.results[0]?.date==='2026-06-10','auto save');});
await test('JSON restore restores duration, sources and real article',async()=>{$('manual').value='농촌진흥청 과수화상병 방제 연구';click('analyzeBtn');assert.equal($('totalCount').textContent,'0');Object.defineProperty($('projectFile'),'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify(project)}]});$('projectFile').dispatchEvent(new window.Event('change'));await waitFor(()=>$('totalCount').textContent==='1','restore');assert.equal(document.querySelector('input[value="google"]').checked,false);assert.equal($('end').value,'2026-06-16');});
await test('Stop cancels pending search promptly and unlocks controls',async()=>{delayFetch=true;const before=fetchCalls;click('searchBtn');await waitFor(()=>fetchCalls>before,'pending search');click('stopBtn');await waitFor(()=>!$('searchBtn').disabled,'stop',1500);assert.match($('searchStatus').textContent,/검색 중단/);assert.equal($('inputFields').disabled,false);delayFetch=false;});
await test('Failed disk save is visible rather than silently successful',async()=>{failDisk=true;click('saveBtn');await waitFor(()=>$('saveStatus').textContent==='작업 JSON 저장 필요','save failure');assert.match($('notice').textContent,/저장 실패/);failDisk=false;});
const restoreFile=async p=>{Object.defineProperty($('projectFile'),'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify(p)}]});await $('projectFile').onchange();assert.equal($('totalCount').textContent,String(p.results.length));};
await test('A late refresh of article A cannot replace article B in the open dialog',async()=>{
 const multi=structuredClone(project),secondBody='두 번째 기사 전용 본문입니다. 이전 기사와 혼동하지 않습니다. '.repeat(8);
 multi.results.push({...multi.results[0],articleNo:2,url:'https://news.example/article/2',title:'농촌진흥청 콩 유전체 두 번째 기사',body:secondBody,fetchNote:'두 번째 기사 확인 사항'});
 await restoreFile(multi);$('filter').value='';$('filter').dispatchEvent(new window.Event('input'));
 document.querySelector('[data-detail="0"]').click();holdArticle=true;releaseArticle=null;click('refreshArticleBody');
 await waitFor(()=>releaseArticle,'held refresh for article A');
 click('closeArticle');document.querySelector('[data-detail="1"]').click();
 const secondTitle=$('editArticleTitle').value,secondEvidence=$('articleEvidence').textContent;
 assert.equal($('articleBody').value,secondBody);assert.equal($('saveArticle').disabled,true);
 releaseArticle();await waitFor(()=>!$('refreshArticleBody').disabled,'article A refresh completion');
 assert.equal($('articleDialog').open,true);assert.equal($('editArticleTitle').value,secondTitle);
 assert.equal($('articleBody').value,secondBody);assert.equal($('articleEvidence').textContent,secondEvidence);
 assert.equal($('articleBody').readOnly,true);assert.equal($('saveArticle').disabled,false);click('closeArticle');
});
await test('Manual body draft disables refresh and cannot be replaced by a forced refresh event',async()=>{
 await restoreFile(project);document.querySelector('[data-detail]').click();
 assert.equal($('refreshArticleBody').disabled,false);click('editBodyBtn');
 const draft='아직 저장하지 않은 사용자 보완 본문입니다. '.repeat(8),before=fetchCalls;
 $('articleBody').value=draft;
 assert.equal($('articleBody').readOnly,false);assert.equal($('refreshArticleBody').disabled,true);assert.equal($('editBodyBtn').disabled,true);
 click('refreshArticleBody');await $('refreshArticleBody').onclick();
 assert.equal(fetchCalls,before);assert.equal($('articleBody').value,draft);assert.equal($('articleBody').readOnly,false);
 click('saveArticle');document.querySelector('[data-detail]').click();
 assert.equal($('articleBody').value,draft.trim());assert.equal($('articleBody').readOnly,true);assert.equal($('refreshArticleBody').disabled,false);click('closeArticle');
});
await test('Article numbers survive sorting and filtering',async()=>{
 const multi=structuredClone(project);multi.results.push({...multi.results[0],articleNo:2,url:'https://news.example/article/2',title:'농촌진흥청 희귀변이 연구',date:'2026-06-11',match:22});await restoreFile(multi);
 $('filter').value='';$('filter').dispatchEvent(new window.Event('input'));$('sort').value='date';$('sort').dispatchEvent(new window.Event('change'));assert.equal(document.querySelector('.article-number').textContent,'2');
 $('filter').value='희귀변이';$('filter').dispatchEvent(new window.Event('input'));assert.equal(document.querySelector('.article-number').textContent,'2');
});
await test('Logo reset waits for in-flight save and clears all controls and caches',async()=>{
 localStorage.setItem('rda-v62',JSON.stringify(project));$('ocrMode').value='always';holdSave=true;click('saveBtn');await waitFor(()=>releaseSave,'pending save');click('homeBtn');assert.equal($('homeBtn').disabled,true);releaseSave();
 await waitFor(()=>!$('homeBtn').disabled,'reset');assert.equal($('totalCount').textContent,'0');assert.equal($('pressTitle').value,'');assert.equal($('queries').value,'');assert.equal($('filter').value,'');assert.equal($('sort').value,'match');assert.equal($('mode').value,'8');assert.equal($('ocrMode').value,'auto');assert.equal($('timer').textContent,'00:00');assert.equal($('analysis').hidden,true);assert.equal(disk.press,null);assert.deepEqual(disk.results,[]);assert.equal(localStorage.getItem('rda-v62'),null);assert.equal(JSON.parse(localStorage.getItem('rda-v64')).press,null);assert.equal($('csvBtn').disabled,true);
});
await test('Logo reset aborts an active search without late results',async()=>{
 await restoreFile(project);delayFetch=true;const before=fetchCalls;click('searchBtn');await waitFor(()=>fetchCalls>before,'pending search reset');click('homeBtn');await waitFor(()=>!$('homeBtn').disabled,'search reset',1600);assert.equal($('totalCount').textContent,'0');assert.equal(disk.press,null);assert.equal($('inputFields').disabled,false);delayFetch=false;
});
await test('Logo reset terminates OCR and prevents late extraction',async()=>{
 let recognizing=false,terminated=false;
 globalThis.createImageBitmap=async()=>({width:400,height:200,close(){}});
 window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});window.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,iVBORw0KGgo=';
 window.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:async()=>{recognizing=true;return new Promise(()=>{});},terminate:async()=>{terminated=true;}})};
 Object.defineProperty($('file'),'files',{configurable:true,value:[{name:'test.png',size:4,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer}]});$('file').dispatchEvent(new window.Event('change'));
 await waitFor(()=>recognizing,'OCR pending');assert.equal($('cancelAnalysis').hidden,false);click('homeBtn');await waitFor(()=>!$('homeBtn').disabled,'OCR reset',1600);assert.equal(terminated,true);assert.equal($('analysis').hidden,true);assert.equal($('cancelAnalysis').hidden,true);assert.equal(disk.press,null);
});
await test('Reset suppresses an export that completes late',async()=>{
 await restoreFile(project);holdFont=true;releaseFont=null;const before=downloads.length;click('pdfBtn');await waitFor(()=>releaseFont,'font pending');click('homeBtn');await waitFor(()=>!$('homeBtn').disabled,'export reset');releaseFont();await new Promise(r=>setTimeout(r,200));assert.equal(downloads.length,before);assert.equal($('pdfBtn').disabled,true);assert.equal($('exportStatus').textContent,'');
});
await test('Manual article body remains clearly labeled and persists',async()=>{
 await restoreFile(project);document.querySelector('[data-detail]').click();click('editBodyBtn');assert.equal($('articleBody').readOnly,false);$('articleBody').value='농촌진흥청 원문에서 확인한 사용자 보완 본문입니다. '.repeat(8);click('saveArticle');const before=downloads.length;click('saveBtn');await waitFor(()=>downloads.length>before,'manual body JSON');const saved=JSON.parse(await downloads.at(-1).blob.text());assert.equal(saved.results[0].bodyUserEdited,true);assert.equal(saved.results[0].checked,false);assert.match(saved.results[0].body,/사용자 보완/);
});
// Restore a real project so the exit test verifies save rather than an empty session.
await restoreFile(project);
await test('Exit waits for disk save before local engine shutdown',async()=>{click('quitBtn');await waitFor(()=>shut,'shutdown');await waitFor(()=>document.body.textContent.includes('오늘의 스크랩을 마쳤습니다.'),'goodbye');assert.equal(disk.version,64);});
console.log(`TOTAL ${count} PASS (jsdom, not native rendering)`);
process.exit(0);
