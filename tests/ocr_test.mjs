import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),modules=process.env.RDA_TEST_MODULES,load=name=>require(modules?modules+'/'+name:name);
const canvas=require((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/':'')+'@napi-rs/canvas');
const {createWorker}=load('tesseract.js');
for(const key of ['DOMMatrix','ImageData','Path2D'])globalThis[key]=canvas[key];
globalThis.window={JSZip:require('../web/vendor/jszip.min.js'),pako:require('../web/vendor/pako.min.js'),sax:require('../web/vendor/sax.js'),requestAnimationFrame:cb=>setTimeout(cb,0),cancelAnimationFrame:clearTimeout};
globalThis.fetch=async u=>{if(String(u).startsWith('file:'))return new Response(fs.readFileSync(fileURLToPath(u)));throw Error('Unexpected external request in offline OCR test: '+String(u));};
const {extractDocument}=await import('../web/documents.mjs');const {localOCROptions,createOCRSession}=await import('../web/ocr.mjs');
const root=path.dirname(fileURLToPath(import.meta.url));
const localOptions=localOCROptions();assert.equal(localOptions.cacheMethod,'none');assert.equal(localOptions.legacyCore,false);
const workerFactory=(langs,oem,opts)=>createWorker(langs,oem,{...opts,workerPath:require.resolve(modules?modules+'/tesseract.js/src/worker-script/node/index.js':'tesseract.js/src/worker-script/node/index.js'),langPath:path.resolve(root,'../web/vendor/ocr/lang')});
const options={workerFactory,canvasFactory:(w,h)=>canvas.createCanvas(w,h),decodeImage:b=>canvas.loadImage(Buffer.from(b))};
const results=[];
for(const name of ['scanned_press.png','scanned_press.pdf']){
 const bytes=fs.readFileSync(path.join(root,'ocr',name)),started=Date.now();let events=0;
 const p=await extractDocument({name,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)},{...options,onProgress:m=>{events++;}});
 fs.writeFileSync(path.join(root,'ocr',name+'.result.json'),JSON.stringify(p,null,2));assert.equal(p.ocrPages,1);assert.ok(p.characters>500);assert.ok(p.text.replace(/\s/g,'').includes('디지털육종'));assert.ok(p.keywords.length>=10);assert.ok(p.title.replace(/\s/g,'').includes('농촌진흥청'));assert.match(p.format,/OCR/);assert.ok(events>2);
 results.push({name,title:p.title,date:p.releaseDate,characters:p.characters,ocrConfidence:p.ocrConfidence,keywords:p.keywords,seconds:(Date.now()-started)/1000});console.log('PASS local Korean OCR:',name,JSON.stringify(results.at(-1)));
}
const first=results[0].keywords.filter(k=>results[1].keywords.includes(k));assert.ok(first.length>=12);console.log('PASS image / scanned PDF keyword agreement:',first.length);
// An already-aborted operation must never create a worker.
const cancelled=new AbortController();cancelled.abort();let created=false;await assert.rejects(()=>createOCRSession({signal:cancelled.signal,workerFactory:()=>{created=true;}}),{name:'AbortError'});assert.equal(created,false);
// Test cancellation before the image-posting microtask and during real OCR.
const stop=new AbortController();let session;session=await createOCRSession({...options,signal:stop.signal});const pending=session.recognize(fs.readFileSync(path.join(root,'ocr','scanned_press.png')));stop.abort();await assert.rejects(()=>pending,{name:'AbortError'});await session.close();console.log('PASS OCR cancellation');
const activeStop=new AbortController();let reachedRecognition=false;
const activeSession=await createOCRSession({...options,signal:activeStop.signal,onProgress:m=>{if(m.stage==='recognize'){reachedRecognition=true;activeStop.abort();}}});
await assert.rejects(()=>activeSession.recognize(fs.readFileSync(path.join(root,'ocr','scanned_press.png'))),{name:'AbortError'});await activeSession.close();assert.equal(reachedRecognition,true);console.log('PASS OCR cancellation during recognition');
fs.writeFileSync(path.join(root,'ocr_validation.json'),JSON.stringify({testedAt:new Date().toISOString(),engine:'Tesseract.js 7.0.0, local kor+eng best_int models, same shipped WASM core; Node worker harness',results,commonKeywords:first.length,cancellation:'PASS: before creation, immediately after recognize, during recognition'},null,2));
console.log('TOTAL 2 actual OCR files + keyword comparison + 3 cancellation cases PASS');
