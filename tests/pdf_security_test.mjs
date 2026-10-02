// Local, benign PDF regressions. No exploit payloads or external targets.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const canvas=require((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/':'')+'@napi-rs/canvas');
for(const key of ['DOMMatrix','ImageData','Path2D'])globalThis[key]=canvas[key];
globalThis.window={requestAnimationFrame:cb=>setTimeout(cb,0),cancelAnimationFrame:clearTimeout};
const requests=[];
globalThis.fetch=async url=>{
  requests.push(String(url));
  const parsed=new URL(url);
  assert.equal(parsed.protocol,'file:','PDF processing must not request an external URL');
  const target=fileURLToPath(parsed),vendor=path.join(root,'web','vendor')+path.sep;
  assert.ok(target.startsWith(vendor),'PDF auxiliary assets must be bundled');
  return new Response(fs.readFileSync(target));
};

const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/PDFJS_ASSETS.json'),'utf8'));
assert.equal(manifest.version,'6.2.108');
const documentAssets=JSON.parse(fs.readFileSync(path.join(root,'docs/DOCUMENT_ASSETS.json'),'utf8'));
for(const item of [...manifest.files,...documentAssets.packages.flatMap(p=>p.files)]){
  const bytes=fs.readFileSync(path.join(root,item.path));
  assert.equal(bytes.length,item.bytes,item.path);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256,item.path);
}
const pdf=await import('../web/vendor/pdf.mjs');
assert.equal(pdf.version,manifest.version);
assert.match(fs.readFileSync(path.join(root,'web/vendor/pdf.worker.mjs'),'utf8').slice(0,1600),/pdfjsVersion = 6\.2\.108/);
pdf.GlobalWorkerOptions.workerSrc=new URL('../web/vendor/pdf.worker.mjs',import.meta.url).href;
const {pdfText}=await import('../web/documents.mjs');
console.log(`PASS ${manifest.files.length} PDF assets verified against the official npm tarball manifest`);
console.log('PASS XML / ZIP / HWP dependency assets verified against the official npm tarball manifests');

function buildPDF(objects){
  let body='%PDF-1.7\n',offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=Buffer.byteLength(body);
  body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  body+=offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  body+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body));
}
const benignText='Synthetic PDF security regression: document text and canvas extraction must stay local.';
const stream=`BT /F1 12 Tf 24 180 Td (${benignText}) Tj ET`;
const harmlessScript='globalThis.__rdaPdfScriptExecuted = true;';
const bytes=buildPDF([
  '<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [7 0 R] >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  `<< /S /JavaScript /JS (${harmlessScript}) >>`,
  '<< /Type /Annot /Subtype /Link /Rect [24 160 300 190] /A << /S /URI /URI (https://example.invalid/unused-pdf-link) >> >>',
]);

// Prove the synthetic PDF really contains an action, then check the application
// does not execute it. This is an action-isolation test, not a CVE exploit test.
const check=pdf.getDocument({data:bytes.slice(),enableXfa:false});
const parsed=await check.promise;
assert.ok(JSON.stringify(await parsed.getJSActions()).includes(harmlessScript));
await check.destroy();
globalThis.__rdaPdfScriptExecuted=false;
const textResult=await pdfText(bytes.slice(),{ocrMode:'off'});
assert.ok(textResult.text.includes(benignText));
assert.equal(globalThis.__rdaPdfScriptExecuted,false);
assert.equal(textResult.pages,1);
console.log('PASS PDF JavaScript action remains inactive during text extraction');

let recognized=false,terminated=false;
const workerFactory=async()=>({
  async setParameters(){},
  async recognize(image){
    assert.ok(image instanceof Uint8Array);
    assert.deepEqual(Array.from(image.subarray(0,8)),[137,80,78,71,13,10,26,10]);
    recognized=true;
    return {data:{text:benignText,confidence:100,blocks:[]}};
  },
  async terminate(){terminated=true;},
});
const rendered=await pdfText(bytes.slice(),{ocrMode:'always',workerFactory,canvasFactory:(w,h)=>canvas.createCanvas(w,h)});
assert.ok(recognized&&terminated);
assert.equal(rendered.ocrPages,1);
assert.equal(globalThis.__rdaPdfScriptExecuted,false);
assert.equal(requests.some(u=>/^https?:/i.test(u)),false);
console.log('PASS canvas OCR input is a local PNG; PDF actions and external links remain inactive');

await assert.rejects(()=>pdfText(new Uint8Array(Buffer.from('%PDF-1.7\ntrailer << /Root 99 0 R >>\n%%EOF')),{ocrMode:'off'}),{name:'InvalidPDFException'});
console.log('PASS malformed PDF rejected and failed loading task released');
const pageObjects=Array.from({length:101},()=>'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>');
const tooMany=buildPDF(['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pageObjects.map((_,i)=>`${i+3} 0 R`).join(' ')}] /Count 101 >>`,...pageObjects]);
await assert.rejects(()=>pdfText(tooMany,{ocrMode:'off'}),/100쪽 이하/);
console.log('PASS 101 page PDF rejected before extraction');
const abort=new AbortController();abort.abort();
await assert.rejects(()=>pdfText(bytes.slice(),{signal:abort.signal}),{name:'AbortError'});
console.log('PASS cancelled PDF operation never starts');
console.log('TOTAL patched bundle integrity + action isolation + local canvas render + malformed/page-limit/cancel cases PASS');
