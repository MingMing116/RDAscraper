// Actual app handlers with synthetic local-only inputs. jsdom evaluates injected
// handlers if present; no script is allowed to be inserted and no external request
// is permitted. This is not a native Windows/browser security certification.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {JSDOM} from './dom_helpers.mjs';
const scenario=process.argv[2];
if(!scenario){
  for(const name of ['import','disk','browser','fallback','tombstone','privacy','privacy_restart']){
    const child=spawnSync(process.execPath,[new URL(import.meta.url).pathname,name],{env:process.env,encoding:'utf8'});
    process.stdout.write(child.stdout);process.stderr.write(child.stderr);assert.equal(child.status,0,name);
  }
  console.log('TOTAL 7 project DOM security and privacy scenarios PASS');process.exit(0);
}
const web=new URL('../web/',import.meta.url);
const dom=new JSDOM(fs.readFileSync(new URL('index.html',web),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'dangerously',pretendToBeVisual:true});
const {window}=dom;
for(const key of ['window','document','localStorage','DOMParser'])globalThis[key]=key==='window'?window:window[key];
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
window.confirm=()=>true;window.open=()=>null;window.scrollTo=()=>{};
const interval=globalThis.setInterval;globalThis.setInterval=(...args)=>{const id=interval(...args);id.unref();return id;};
const $=id=>document.getElementById(id),waitFor=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout '+$('notice').textContent);};
const title='농촌진흥청 콩 유전체 합성 보안 검증';
const base=()=>({schema:'rdascraper-project',version:63,savedAt:100,start:'2026-09-01',end:'2026-09-30',press:{title,text:title+' 본문',keywords:['유전체'],queries:['유전체']},results:[{title,url:'https://news.example.test/a',date:'2026-09-15',media:'합성 매체',mediaScore:999,match:50,included:true,eligible:true,checked:true,dateSource:'사용자 확인',userEdited:true,articleNo:4,sources:['합성 검증'],warnings:[]}]});
const payload='<img id="rda-security-marker" src="/synthetic-missing-image" onerror="window.__rdaSecurityMarker=1">';
const bad=()=>{const p=base();p.savedAt=999;p.results[0].mediaScore=payload;return p;};
let disk=scenario==='disk'?bad():scenario==='fallback'?base():scenario==='tombstone'?{schema:'rdascraper-project',version:64,savedAt:1000,press:null,results:[],reset:true}:null;
let autoSave=scenario!=='privacy_restart',holdPost=false,releasePost=null;
if(['browser','fallback','privacy_restart'].includes(scenario))localStorage.setItem('rda-v63',JSON.stringify(bad()));
if(scenario==='tombstone')localStorage.setItem('rda-v63',JSON.stringify({...base(),savedAt:Number.MAX_SAFE_INTEGER}));
if(scenario==='privacy_restart')localStorage.setItem('rda-preferences',JSON.stringify({autoSave:true}));
const requests=[],downloads=[],blobs=new Map();let blobID=0;
URL.createObjectURL=b=>{const key='blob:synthetic-'+(++blobID);blobs.set(key,b);return key;};URL.revokeObjectURL=u=>blobs.delete(u);
window.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:blobs.get(this.href)});};
globalThis.fetch=async(u,o={})=>{
  u=String(u);requests.push({url:u,method:o.method||'GET'});let result;
  if(u==='/api/config')result={ok:true,token:'synthetic-token',autoSave};
  else if(u==='/api/health')result={ok:true};
  else if(u==='./media_master.json')result={entries:[{media:'검증된 합성 매체',domains:['news.example.test'],score:2,category:'합성'}]};
  else if(u==='/api/project'){
    if(o.method==='POST'){if(holdPost){holdPost=false;await new Promise(r=>releasePost=r);}assert.equal(autoSave,true);disk=JSON.parse(o.body);result={ok:true};}
    else if(o.method==='DELETE'){autoSave=false;disk={schema:'rdascraper-project',version:64,savedAt:Date.now(),reset:true,press:null,results:[]};result={ok:true,autoSave,project:disk};}
    else result={ok:true,project:disk};
  }else if(u==='/api/preferences'){autoSave=JSON.parse(o.body).autoSave;if(!autoSave)disk={schema:'rdascraper-project',version:64,savedAt:Date.now(),reset:true,press:null,results:[]};result={ok:true,autoSave,project:disk};}
  else if(u==='/api/shutdown')result={ok:true};
  else throw Error('Unexpected request '+u);
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
};
await import(new URL('app.mjs',web));await waitFor(()=>$('connection').textContent==='내 PC에서 실행 중');await new Promise(r=>setTimeout(r,40));
const importFile=async p=>{Object.defineProperty($('projectFile'),'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify(p)}]});await $('projectFile').onchange();};
function noInjection(){assert.equal(document.getElementById('rda-security-marker'),null);for(const img of document.images)img.dispatchEvent(new window.Event('error'));assert.equal(window.__rdaSecurityMarker,undefined);assert.deepEqual(requests.filter(r=>/^https?:/.test(r.url)),[]);}
if(scenario==='import'){
  await importFile(base());await waitFor(()=>disk?.results?.[0]?.mediaScore===2);
  assert.equal($('readyCount').textContent,'0');assert.equal($('selectedCount').textContent,'1');assert.equal(disk.results[0].checked,false);assert.equal(disk.results[0].userEdited,true);assert.equal(disk.results[0].dateSource,'사용자 확인');assert.equal(disk.results[0].articleNo,4);
  const previous=JSON.stringify(disk),previousLocal=localStorage.getItem('rda-v64');
  for(const field of ['mediaScore','match','articleNo']){const p=base();p.results[0][field]=payload;await importFile(p);assert.match($('notice').textContent,/형식 또는 허용 범위/);assert.equal($('totalCount').textContent,'1');assert.equal($('pressTitle').value,title);noInjection();}
  await new Promise(r=>setTimeout(r,500));assert.equal(JSON.stringify(disk),previous);assert.equal(localStorage.getItem('rda-v64'),previousLocal);
  const literal=base();literal.results[0].title=payload;literal.results[0].snippet=payload;literal.results[0].dateSource=payload;literal.results[0].sources=[payload];literal.press.keywords=[payload.slice(0,30)];literal.press.queries=[payload];
  await importFile(literal);assert.match($('results').textContent,/<img id=/);noInjection();
  $('keywordInput').value='새핵심어';$('addKeyword').click();assert.equal($('readyCount').textContent,'0');
}else if(scenario==='disk'||scenario==='browser'){
  assert.equal($('analysis').hidden,true);assert.equal($('totalCount').textContent,'0');assert.equal(requests.some(r=>r.method==='POST'),false);noInjection();
}else if(scenario==='fallback'){
  assert.equal($('pressTitle').value,title);assert.equal($('readyCount').textContent,'0');assert.match($('results').textContent,/매체 2점/);noInjection();
}else if(scenario==='tombstone'){
  assert.equal($('analysis').hidden,true);assert.equal($('totalCount').textContent,'0');assert.equal(requests.some(r=>r.method==='POST'),false);
}else if(scenario==='privacy_restart'){
  assert.equal($('rememberWork').checked,false);assert.equal($('analysis').hidden,true);assert.equal(localStorage.getItem('rda-v63'),null);assert.equal(requests.some(r=>r.method==='POST'),false);
}else if(scenario==='privacy'){
  await importFile(base());holdPost=true;$('saveBtn').click();await waitFor(()=>releasePost);
  $('rememberWork').checked=false;const turnOff=$('rememberWork').onchange();assert.equal($('rememberWork').disabled,true);releasePost();await turnOff;
  assert.equal(autoSave,false);assert.equal(disk.press,null);assert.equal(disk.reset,true);assert.equal($('pressTitle').value,title);assert.equal($('rememberWork').checked,false);assert.equal(localStorage.getItem('rda-v64'),null);assert.match($('privacyStatus').textContent,/다운로드한 JSON/);
  const posts=()=>requests.filter(r=>r.url==='/api/project'&&r.method==='POST').length,before=posts();
  $('saveBtn').click();assert.match(downloads.at(-1).name,/\.json$/);assert.equal(JSON.parse(await downloads.at(-1).blob.text()).press.title,title);
  window.dispatchEvent(new window.Event('beforeunload'));await new Promise(r=>setTimeout(r,550));assert.equal(posts(),before);assert.equal(localStorage.getItem('rda-v64'),null);
  $('rememberWork').checked=true;await $('rememberWork').onchange();await waitFor(()=>disk?.press?.title===title);assert.equal(autoSave,true);
  await $('clearLocalData').onclick();assert.equal(autoSave,false);assert.equal(disk.press,null);assert.equal($('pressTitle').value,title);assert.equal(localStorage.getItem('rda-v64'),null);
  const finalBefore=posts();await $('quitBtn').onclick();assert.equal(posts(),finalBefore);assert.match(document.body.textContent,/자동 저장을 끈 상태/);
}
noInjection();console.log('PASS actual app '+scenario);dom.window.close();process.exit(0);
