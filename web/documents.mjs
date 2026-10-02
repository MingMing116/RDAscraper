import {clean,analyzeText} from './core.mjs';
import {checkAbort,createOCRSession,imageCanvas} from './ocr.mjs';
const MAX=25*1024*1024, EXPANDED=80*1024*1024;
const decode16=b=>new TextDecoder('utf-16le').decode(b);
export async function extractDocument(file,options={}){
  if(file.size>MAX)throw Error('파일은 25MB 이하로 선택하세요.');
  checkAbort(options.signal);
  const data=new Uint8Array(await file.arrayBuffer()),ext=file.name.split('.').pop().toLowerCase();
  checkAbort(options.signal);let result;
  if(ext==='pdf')result=await pdfText(data,options);
  else if(ext==='hwpx')result=await hwpxText(data);
  else if(ext==='hwp')result=hwpText(data);
  else if(ext==='txt')result={text:new TextDecoder().decode(data)};
  else if(['png','jpg','jpeg','webp','bmp'].includes(ext)){
    if(options.ocrMode==='off')throw Error('이미지 파일을 읽으려면 글자 인식을 ‘자동’으로 설정하세요.');
    const canvas=await imageCanvas(data,options);let session;
    try{session=await createOCRSession(options);const ocr=await session.recognize(canvas.toDataURL('image/png'));result={...ocr,pages:1,ocrPages:1};}
    finally{if(session)await session.close();canvas.width=canvas.height=1;}
  }else throw Error('HWP, HWPX, PDF, TXT 또는 PNG·JPG·WEBP·BMP 이미지를 선택하세요.');
  checkAbort(options.signal);
  if(result.text.replace(/\s/g,'').length<(result.ocrPages?2:25))throw Error('읽을 수 있는 글자가 부족합니다. 더 선명한 이미지나 PDF를 선택하거나 제목·본문을 직접 입력하세요.');
  const analysis=analyzeText(result.text,'',result.lines?.length?result.lines:null);
  const warnings=[...analysis.warnings,...(result.warnings||[])];
  if(result.ocrPages)warnings.push('이미지에서 인식한 내용입니다. 검색 전 제목과 핵심어를 확인하세요.');
  return {...analysis,warnings,quality:result.ocrPages?'OCR 결과 확인':analysis.quality,format:ext.toUpperCase()+(result.ocrPages?' · OCR':''),pages:result.pages||null,ocrPages:result.ocrPages||0,ocrConfidence:result.confidence??null,filename:file.name};
}
export async function pdfText(data,options={}){
  checkAbort(options.signal);
  const pdf=await import('./vendor/pdf.mjs');pdf.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
  // The display API extracts text / pixels only. Never create the PDF viewer,
  // scripting manager or interactive annotation DOM. PDF.js 6 removed the old
  // isEvalSupported option; it must not be relied on as a security control.
  const loading=pdf.getDocument({data,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,enableXfa:false});
  let doc;
  try{doc=await loading.promise;}catch(e){await loading.destroy();throw e;}
  if(doc.numPages>100){await loading.destroy();throw Error('100쪽 이하의 보도자료 PDF를 선택하세요.');}
  let lines=[],ocrPages=0,skipped=0,scores=[],session=null;
  try{for(let pn=1;pn<=doc.numPages;pn++){
    checkAbort(options.signal);options.onProgress?.({stage:'pdf',message:`PDF ${pn}/${doc.numPages}쪽 읽는 중`});
    const page=await doc.getPage(pn),content=await page.getTextContent();checkAbort(options.signal);
    const items=content.items.filter(x=>x.str?.trim()).map(x=>({text:x.str,x:x.transform[4],y:x.transform[5],width:x.width,size:Math.hypot(x.transform[2],x.transform[3])||x.height}));
    items.sort((a,b)=>b.y-a.y||a.x-b.x);let groups=[],pageLines=[];
    for(const item of items){let row=groups.find(g=>Math.abs(g.y-item.y)<Math.max(2,Math.min(g.size,item.size)*.28));if(!row){row={y:item.y,size:item.size,items:[]};groups.push(row);}row.items.push(item);row.size=Math.max(row.size,item.size);}
    for(const g of groups.sort((a,b)=>b.y-a.y)){
      let text='',right=null;for(const it of g.items.sort((a,b)=>a.x-b.x)){
        const gap=right===null?0:it.x-right;
        if(text&&gap>Math.max(1.3,it.size*.11)&&!text.endsWith(' ')&&!it.text.startsWith(' '))text+=' ';
        text+=it.text;right=it.x+it.width;
      }
      if(clean(text))pageLines.push({text:clean(text),size:g.size,page:pn});
    }
    const readable=pageLines.map(x=>x.text).join('').replace(/[^가-힣a-zA-Z0-9]/g,'').length;
    if(options.ocrMode!=='off'&&(options.ocrMode==='always'||readable<40)){
      if(ocrPages>=20){skipped++;lines.push(...pageLines);page.cleanup();continue;}
      const base=page.getViewport({scale:1}),scale=Math.min(3,3200/Math.max(base.width,base.height)),viewport=page.getViewport({scale});
      const canvas=options.canvasFactory?options.canvasFactory(Math.ceil(viewport.width),Math.ceil(viewport.height)):document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try{
        const render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)',annotationMode:pdf.AnnotationMode.DISABLE});
        const stop=()=>render.cancel();options.signal?.addEventListener('abort',stop,{once:true});
        try{await render.promise;}catch(e){checkAbort(options.signal);throw e;}finally{options.signal?.removeEventListener('abort',stop);}
        checkAbort(options.signal);
        if(!session)session=await createOCRSession({...options,onProgress:m=>options.onProgress?.({...m,message:`PDF OCR · ${m.message}`})});
        options.onProgress?.({stage:'recognize',message:`PDF ${pn}/${doc.numPages}쪽 글자 인식 중`});
        const result=await session.recognize(canvas.toDataURL('image/png'));ocrPages++;scores.push(result.confidence);
        const recognized=result.lines.length?result.lines:result.text.split('\n').filter(Boolean).map(text=>({text,size:12*scale}));
        if(result.text.replace(/\s/g,'').length>=readable||options.ocrMode==='always')pageLines=recognized.map(x=>({...x,size:x.size/scale,page:pn}));
      }finally{canvas.width=canvas.height=1;}
    }
    lines.push(...pageLines);page.cleanup();
  }
  return {text:lines.map(x=>x.text).join('\n'),lines,pages:doc.numPages,ocrPages,confidence:scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):undefined,warnings:skipped?[`OCR은 최대 20쪽입니다. 추가 ${skipped}쪽은 이미지 글자를 읽지 못했습니다.`]:[]};
  }finally{if(session)await session.close();await loading.destroy();}
}
export async function hwpxText(data){
  const zip=await window.JSZip.loadAsync(data);let total=0;
  for(const f of Object.values(zip.files)){total+=f._data?.uncompressedSize||0;if(total>EXPANDED)throw Error('압축 해제한 문서가 너무 큽니다.');}
  const sections=Object.keys(zip.files).filter(n=>/^Contents\/section\d+\.xml$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if(!sections.length)throw Error('HWPX 본문을 찾지 못했습니다.');
  let parts=[];
  for(const name of sections){const xml=await zip.file(name).async('string');if(xml.length>EXPANDED)throw Error('문서가 너무 큽니다.');
    let out='',inside=0;const sax=window.sax.parser(true,{xmlns:true});
    sax.onopentag=node=>{if(node.local==='t')inside++;if(node.local==='tab')out+=' ';if(node.local==='lineBreak')out+='\n';};
    sax.ontext=t=>{if(inside)out+=t;};sax.oncdata=sax.ontext;
    sax.onclosetag=name=>{const local=name.split(':').pop();if(local==='t')inside--;if(local==='p')out+='\n';};
    sax.onerror=()=>{throw Error('HWPX XML이 손상되었습니다.');};sax.write(xml).close();parts.push(out);
  }return {text:clean(parts.join('\n'))};
}
export function oleStreams(data){
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength),u=(o)=>v.getUint32(o,true),u16=o=>v.getUint16(o,true);
  if(data.length<512||u(0)!==0xe011cfd0||u(4)!==0xe11ab1a1)throw Error('HWP 5.x 형식이 아니거나 손상되었습니다. HWPX 또는 PDF로 저장해 사용하세요.');
  const size=2**u16(30),miniSize=2**u16(32);if(![512,4096].includes(size)||miniSize!==64)throw Error('지원하지 않는 HWP 저장 구조입니다.');
  const sector=id=>{const p=(id+1)*size;if(id>=0xfffffffa||p+size>data.length)throw Error('HWP 섹터 범위 오류');return data.subarray(p,p+size);};
  const ints=b=>{const d=new DataView(b.buffer,b.byteOffset,b.byteLength);return Array.from({length:b.length/4},(_,i)=>d.getUint32(i*4,true));};
  let fatS=[];for(let i=0;i<109;i++){let x=u(76+i*4);if(x<0xfffffffa)fatS.push(x);}
  let dif=u(68),seen=new Set();for(let n=0;n<u(72)&&dif<0xfffffffa;n++){if(seen.has(dif))throw Error('HWP 순환 참조 오류');seen.add(dif);const ds=ints(sector(dif));fatS.push(...ds.slice(0,-1).filter(x=>x<0xfffffffa));dif=ds.at(-1);}
  const fat=fatS.flatMap(x=>ints(sector(x)));
  const chain=(first,table,get,limit=EXPANDED)=>{let chunks=[],n=first,used=new Set(),len=0;while(n<0xfffffffa){if(used.has(n)||n>=table.length)throw Error('HWP 연결 구조가 손상되었습니다.');used.add(n);const b=get(n);len+=b.length;if(len>limit)throw Error('HWP 해제 크기 제한 초과');chunks.push(b);n=table[n];}const out=new Uint8Array(len);let off=0;for(const b of chunks){out.set(b,off);off+=b.length;}return out;};
  const dir=chain(u(48),fat,sector),dv=new DataView(dir.buffer);let entries=[];
  for(let p=0;p+128<=dir.length;p+=128){let nl=dv.getUint16(p+64,true);entries.push({name:nl>=2&&nl<=64?decode16(dir.subarray(p,p+nl-2)):'',type:dir[p+66],left:dv.getUint32(p+68,true),right:dv.getUint32(p+72,true),child:dv.getUint32(p+76,true),start:dv.getUint32(p+116,true),length:dv.getUint32(p+120,true)});}
  const root=entries[0];if(root?.type!==5)throw Error('HWP 루트가 없습니다.');
  const mini=chain(root.start,fat,sector).subarray(0,root.length),miniFat=u(64)?ints(chain(u(60),fat,sector)):[];
  const streams={},visited=new Set();const visit=(id,path)=>{if(id>=0xfffffffa)return;if(id>=entries.length||visited.has(id))throw Error('HWP 디렉터리가 손상되었습니다.');visited.add(id);const e=entries[id];visit(e.left,path);const name=path+e.name;if(e.type===1)visit(e.child,name+'/');else if(e.type===2){if(e.length>EXPANDED)throw Error('HWP 본문이 너무 큽니다.');streams[name]=(e.length<u(56)?chain(e.start,miniFat,n=>{if((n+1)*miniSize>mini.length)throw Error('HWP 미니섹터 오류');return mini.subarray(n*miniSize,(n+1)*miniSize);}):chain(e.start,fat,sector)).subarray(0,e.length);}visit(e.right,path);};visit(root.child,'');return streams;
}
export function hwpText(data){
  const streams=oleStreams(data),header=streams.FileHeader;if(!header||header.length<40)throw Error('HWP 머리정보가 없습니다.');
  const flags=new DataView(header.buffer,header.byteOffset).getUint32(36,true);if(flags&2)throw Error('암호가 설정된 HWP입니다. 암호를 해제한 파일을 선택하세요.');if(flags&4)throw Error('배포용 HWP는 직접 분석할 수 없습니다. HWPX 또는 텍스트 PDF를 사용하세요.');
  let parts=[];for(const name of Object.keys(streams).filter(n=>/^BodyText\/Section\d+$/.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){
    let b=streams[name];if(flags&1){let inf=new window.pako.Inflate({raw:true}),chunks=[],len=0;inf.onData=x=>{len+=x.length;if(len>EXPANDED)throw Error('HWP 해제 크기 제한 초과');chunks.push(x);};inf.push(b,true);if(inf.err)throw Error('HWP 압축 본문을 읽지 못했습니다.');b=new Uint8Array(len);let p=0;for(const c of chunks){b.set(c,p);p+=c.length;}}
    const d=new DataView(b.buffer,b.byteOffset,b.byteLength);let p=0;
    while(p+4<=b.length){let h=d.getUint32(p,true);p+=4;let tag=h&1023,len=h>>>20;if(len===4095){if(p+4>b.length)break;len=d.getUint32(p,true);p+=4;}if(p+len>b.length)throw Error('HWP 본문 레코드가 손상되었습니다.');
      if(tag===67){let units=[];for(let q=p;q+2<=p+len;){const c=d.getUint16(q,true);if(c<32){if(c===10||c===13)units.push(10);else if(c===9)units.push(32);q+=([1,2,3,9,11,12,14,15,16,17,18,21,22,23].includes(c)?16:2);}else{units.push(c);q+=2;}}
        let s='';for(let i=0;i<units.length;i+=4096)s+=String.fromCharCode(...units.slice(i,i+4096));if(clean(s))parts.push(clean(s));}
      p+=len;
    }
  }if(!parts.length)throw Error('HWP 본문이 비어 있습니다. HWPX 또는 PDF로 저장해 사용하세요.');return {text:parts.join('\n')};
}
