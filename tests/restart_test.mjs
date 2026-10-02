// Regression: a reset saved on one local port must beat stale browser data on another.
import fs from 'node:fs';import assert from 'node:assert/strict';import {JSDOM} from './dom_helpers.mjs';
const dom=new JSDOM(fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://127.0.0.1:9123/'});
for(const k of ['window','document','localStorage','DOMParser'])globalThis[k]=k==='window'?dom.window:dom.window[k];
localStorage.setItem('rda-v62',JSON.stringify({schema:'rdascraper-project',version:62,savedAt:100,press:{title:'이전 작업',text:'예전 보도자료 본문',keywords:[],queries:[]},results:[],start:'2026-06-09',end:'2026-06-23'}));
const blank={schema:'rdascraper-project',version:63,savedAt:200,press:null,results:[],start:'2026-09-16',end:'2026-09-30'};
globalThis.fetch=async u=>new Response(JSON.stringify(u==='/api/config'?{ok:true,token:'test'}:u==='/api/project'?{ok:true,project:blank}:u.includes('media_master')?{entries:[]}:{ok:true}));
const interval=globalThis.setInterval;globalThis.setInterval=(...args)=>{const id=interval(...args);id.unref();return id;};
await import('../web/app.mjs');await new Promise(r=>setTimeout(r,100));
assert.equal(document.getElementById('analysis').hidden,true);assert.equal(document.getElementById('pressTitle').value,'');assert.equal(document.getElementById('totalCount').textContent,'0');assert.equal(document.getElementById('saveBtn').disabled,true);
console.log('PASS restart after reset rejects stale browser snapshot from another port');
