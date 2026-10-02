import {clean} from './core.mjs';
export const abortError=()=>new DOMException('작업이 중단되었습니다.','AbortError');
export const checkAbort=signal=>{if(signal?.aborted)throw abortError();};
const base=new URL('./vendor/ocr/',import.meta.url);
export const localOCROptions=()=>({
  workerPath:new URL('worker.min.js',base).href,
  corePath:new URL('core',base).href,
  langPath:new URL('lang',base).href,
  workerBlobURL:false,cacheMethod:'none',gzip:true,legacyCore:false,legacyLang:false,
});
// One bounded worker per document. All models and code come from the executable.
export async function createOCRSession({signal,onProgress=()=>{},workerFactory}={}){
  checkAbort(signal);
  const factory=workerFactory||globalThis.Tesseract?.createWorker||globalThis.window?.Tesseract?.createWorker;
  if(!factory)throw Error('내장 OCR 엔진을 읽지 못했습니다. 프로그램을 다시 실행하세요.');
  let worker=null,closed=false,cancelReject,termination=null;
  const cancelled=new Promise((_,reject)=>{cancelReject=reject;});
  // Keep the cancellation promise handled even while the caller is between pages.
  cancelled.catch(()=>{});
  // Tesseract normalizes an image in a microtask before posting the job. Let
  // that microtask finish before termination so an immediate cancel cannot
  // post to a worker which Tesseract has already set to null.
  const stopWorker=()=>{
    if(!worker)return Promise.resolve();
    return termination||=(new Promise(resolve=>setTimeout(resolve,0))).then(()=>worker.terminate()).catch(()=>{});
  };
  const abort=()=>{closed=true;cancelReject(abortError());void stopWorker();};
  signal?.addEventListener('abort',abort,{once:true});
  const progress=m=>{
    if(closed)return;
    if(m.status==='recognizing text')onProgress({stage:'recognize',progress:m.progress||0,message:`글자 인식 ${Math.round((m.progress||0)*100)}%`});
    else if(m.status==='loading language traineddata')onProgress({stage:'load',progress:m.progress||0,message:'한국어·영어 인식 데이터 준비 중'});
    else if(m.status==='initializing api'||m.status==='loading tesseract core')onProgress({stage:'load',progress:m.progress||0,message:'OCR 엔진 준비 중'});
  };
  let init;
  try{
    onProgress({stage:'load',progress:0,message:'OCR 엔진 준비 중'});
    init=Promise.resolve(factory('kor+eng',1,{...localOCROptions(),logger:progress,errorHandler:()=>{}}));
    init.then(w=>{if(closed){worker=w;void stopWorker();}},()=>{});
    worker=await Promise.race([init,cancelled]);checkAbort(signal);
    await Promise.race([worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1',user_defined_dpi:'300'}),cancelled]);
  }catch(e){closed=true;signal?.removeEventListener('abort',abort);await stopWorker();throw e;}
  return {
    async recognize(image){
      checkAbort(signal);if(closed)throw abortError();
      // Accept only in-memory image bytes. This also prevents delayed URL or
      // file reads from racing worker shutdown, and keeps OCR fully local.
      let bytes=image;
      if(typeof image==='string'){
        if(!/^data:image\/[\w.+-]+;base64,/.test(image))throw Error('OCR에는 로컬 이미지 데이터가 필요합니다.');
        bytes=Uint8Array.from(atob(image.slice(image.indexOf(',')+1)),c=>c.charCodeAt(0));
      }
      if(!(bytes instanceof Uint8Array)&&!(bytes instanceof ArrayBuffer))throw Error('OCR 이미지 데이터를 읽지 못했습니다.');
      const job=Promise.resolve().then(()=>{checkAbort(signal);if(closed)throw abortError();return worker.recognize(bytes,{rotateAuto:false},{text:true,blocks:true});});
      const result=await Promise.race([job,cancelled]);checkAbort(signal);
      const data=result.data||{},lines=[];
      for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
        const text=clean(line.text||line.words?.map(w=>w.text).join(' '));
        if(text)lines.push({text,size:Math.max(1,(line.bbox?.y1||0)-(line.bbox?.y0||0)),page:1,source:'ocr',confidence:line.confidence});
      }
      return {text:clean(lines.length?lines.map(x=>x.text).join('\n'):data.text),lines,confidence:Math.round(data.confidence||0)};
    },
    async close(){closed=true;signal?.removeEventListener('abort',abort);await stopWorker();}
  };
}
export async function imageCanvas(bytes,{signal,canvasFactory,decodeImage}={}){
  checkAbort(signal);
  let bitmap;
  if(decodeImage)bitmap=await decodeImage(bytes);
  else if(globalThis.createImageBitmap)bitmap=await createImageBitmap(new Blob([bytes]));
  else{
    bitmap=await new Promise((resolve,reject)=>{const image=new Image(),url=URL.createObjectURL(new Blob([bytes]));image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('이미지를 읽지 못했습니다. PNG 또는 JPG로 저장해 주세요.'));};image.src=url;});
  }
  try{
    checkAbort(signal);const w=bitmap.width||bitmap.naturalWidth,h=bitmap.height||bitmap.naturalHeight;
    if(!w||!h||w*h>40000000)throw Error('이미지 크기가 너무 크거나 잘못되었습니다. 4천만 화소 이하로 줄여 주세요.');
    const scale=Math.min(3,Math.max(1,2200/Math.max(w,h)),3600/Math.max(w,h));
    const canvas=canvasFactory?canvasFactory(Math.ceil(w*scale),Math.ceil(h*scale)):document.createElement('canvas');
    canvas.width=Math.ceil(w*scale);canvas.height=Math.ceil(h*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return canvas;
  }finally{bitmap.close?.();}
}
