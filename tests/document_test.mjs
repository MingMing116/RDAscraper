// Test runner dependency @napi-rs/canvas is for Node-only PDF.js; browsers need no package install.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),base=path.dirname(fileURLToPath(import.meta.url));
globalThis.window={JSZip:require('../web/vendor/jszip.min.js'),pako:require('../web/vendor/pako.min.js'),sax:require('../web/vendor/sax.js')};
const canvas=require((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/':'')+'@napi-rs/canvas');
globalThis.DOMMatrix=canvas.DOMMatrix;globalThis.ImageData=canvas.ImageData;globalThis.Path2D=canvas.Path2D;
const {extractDocument}=await import('../web/documents.mjs');
const results=[];
for(const name of fs.readdirSync(path.join(base,'fixtures')).filter(n=>/\.(hwp|hwpx|pdf)$/.test(n))){const b=fs.readFileSync(path.join(base,'fixtures',name));const d=await extractDocument({name,size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)});assert.ok(d.title);assert.ok(d.characters>1000);assert.ok(d.queries.length>=15);results.push({name,title:d.title,date:d.releaseDate,characters:d.characters,keywords:d.keywords,queries:d.queries});console.log('PASS '+name+' | '+d.title);}
for(const group of ['synthetic_breeding','synthetic_materials']){const r=results.filter(x=>x.name.startsWith(group));assert.equal(r.length,3);assert.equal(new Set(r.map(x=>x.title)).size,1);assert.equal(new Set(r.map(x=>x.date)).size,1);let shared=r[0].keywords.filter(k=>r.every(x=>x.keywords.includes(k)));assert.ok(shared.length>=22);console.log(`PASS ${group}: 동일 제목·날짜 / 공통 핵심어 ${shared.length}/24`);}
await assert.rejects(()=>extractDocument({name:'broken.hwp',size:2,arrayBuffer:async()=>new Uint8Array([1,2]).buffer}));
await assert.rejects(()=>extractDocument({name:'large.pdf',size:26*1024*1024,arrayBuffer:async()=>new ArrayBuffer(0)}));
fs.writeFileSync(path.join(base,'document_validation.json'),JSON.stringify({testedAt:new Date().toISOString(),results},null,2));
console.log('TOTAL 7 documents + 2 format comparisons + 2 failure cases PASS');
