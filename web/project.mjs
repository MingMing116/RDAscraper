// Imported and automatically restored projects are untrusted data. Never keep
// unknown properties or trust serialized verification flags as fresh evidence.
import {validDay,safeURL,today,plusDays,assess,mediaMatch,numberArticles} from './core.mjs';
export const PROJECT_VERSION=64;
export const PROJECT_KEYS=['rda-v64','rda-v63','rda-v62','rda-v61'];
export const MAX_PROJECT_BYTES=15*1024*1024;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const invalid=label=>{throw Error(`작업 파일의 ${label} 형식 또는 허용 범위가 올바르지 않습니다.`);};
const object=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))invalid(label);return v;};
function text(v,label,max,min=0){if(typeof v!=='string'||v.length<min||v.length>max)invalid(label);return v;}
function number(v,label,min,max,integer=false){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isSafeInteger(v)))invalid(label);return v;}
function boolean(v,label){if(typeof v!=='boolean')invalid(label);return v;}
function list(v,label,max,length){if(!Array.isArray(v)||v.length>max)invalid(label);return v.map(x=>text(x,label,length));}
function day(v,label,empty=true){if(typeof v!=='string'||(!v&& !empty)||(v&&!validDay(v)))invalid(label);return v;}
function url(v,label,empty=false){text(v,label,8192);if(empty&&!v)return '';const parsed=safeURL(v);if(!parsed||parsed.length>8192)invalid(label);const port=new URL(parsed).port;if(port&&port!=='80'&&port!=='443')invalid(label);return parsed;}
function copyText(source,target,fields){for(const [key,max] of Object.entries(fields))if(own(source,key))target[key]=text(source[key],key,max);}
function copyFlags(source,target,fields){for(const key of fields)if(own(source,key))target[key]=boolean(source[key],key);}
function enumValue(source,key,values,fallback){if(!own(source,key))return fallback;if(!values.includes(source[key]))invalid(key);return source[key];}
function pressData(raw){
  const p=object(raw,'문서'),out={text:text(p.text,'문서 본문',2000000,2),title:own(p,'title')?text(p.title,'문서 제목',1000):''};
  out.keywords=own(p,'keywords')?list(p.keywords,'핵심어',40,40):[];
  if(own(p,'activeKeywords')){out.activeKeywords=list(p.activeKeywords,'선택 핵심어',40,40);if(out.activeKeywords.some(x=>!out.keywords.includes(x)))invalid('선택 핵심어');}
  out.queries=own(p,'queries')?list(p.queries,'검색어 목록',25,1000):[];
  out.warnings=own(p,'warnings')?list(p.warnings,'문서 확인 사항',50,2000):[];
  if(own(p,'releaseDate'))out.releaseDate=day(p.releaseDate,'배포일');
  copyText(p,out,{format:100,quality:200,filename:255});
  for(const [key,min,max] of [['characters',0,2000000],['pages',1,100],['ocrPages',0,100]])if(own(p,key))out[key]=key==='pages'&&p[key]===null?null:number(p[key],key,min,max,true);
  if(own(p,'ocrConfidence'))out.ocrConfidence=p.ocrConfidence===null?null:number(p.ocrConfidence,'OCR 신뢰도',0,100);
  return out;
}
function articleData(raw){
  const a=object(raw,'기사'),out={url:url(a.url,'기사 주소'),title:text(a.title,'기사 제목',2000)};
  copyText(a,out,{media:400,snippet:50000,body:2000000,dateSource:200,source:200,query:1000,category:200,institution:200,fetchNote:2000,bodySource:200,observedTitle:2000,originalSearchTitle:2000,id:8192});
  for(const key of ['origin','portalURL'])if(own(a,key))out[key]=url(a[key],key,true);
  for(const key of ['date','searchDate'])if(own(a,key))out[key]=day(a[key],key);
  for(const [key,max,length] of [['sources',10,200],['matched',40,40],['warnings',50,2000]])if(own(a,key))out[key]=list(a[key],key,max,length);
  copyFlags(a,out,['checked','eligible','included','dateOK','excluded','manual','userEdited','bodyUserEdited','bodyLimited','linkMismatch','dateDifference']);
  if(own(a,'mediaScore'))out.mediaScore=a.mediaScore===null?null:number(a.mediaScore,'매체 점수',0,10000);
  if(own(a,'match'))out.match=number(a.match,'일치도',0,100);
  if(own(a,'articleNo'))out.articleNo=number(a.articleNo,'기사 번호',1,2000,true);
  return out;
}
export function validateProject(raw){
  const p=object(raw,'작업');
  if(p.schema!=='rdascraper-project'||![61,62,63,64].includes(p.version))invalid('작업 종류 또는 버전');
  if(!Array.isArray(p.results)||p.results.length>2000)invalid('기사 목록');
  const out={schema:p.schema,version:p.version,savedAt:own(p,'savedAt')?number(p.savedAt,'저장 시각',0,Number.MAX_SAFE_INTEGER,true):0};
  if(!own(p,'press'))invalid('문서');
  out.press=p.press===null?null:pressData(p.press);
  out.results=p.results.map(articleData);
  if(!out.press&&out.results.length)invalid('빈 작업의 기사 목록');
  out.reset=own(p,'reset')?boolean(p.reset,'초기화 표시'):false;
  if(out.reset&&(out.press||out.results.length))invalid('초기화 작업');
  const tombstone=out.reset&&!out.press;
  out.start=own(p,'start')?day(p.start,'시작일',false):tombstone?today():invalid('시작일');
  out.end=own(p,'end')?day(p.end,'종료일',false):tombstone?plusDays(out.start,14):invalid('종료일');
  if(out.start>out.end)invalid('검색 기간');
  out.demo=own(p,'demo')?boolean(p.demo,'예시 여부'):false;
  out.duration=enumValue(p,'duration',[7,14,21,28],14);
  out.mode=enumValue(p,'mode',['8','25'],'8');
  out.ocrMode=enumValue(p,'ocrMode',['auto','always','off'],'auto');
  out.sources=own(p,'sources')?list(p.sources,'검색원',4,10):['naver','google','daum'];
  if(out.sources.some(x=>!['naver','google','daum','bing'].includes(x))||new Set(out.sources).size!==out.sources.length)invalid('검색원');
  out.queries=own(p,'queries')?text(p.queries,'검색어',25000):(out.press?.queries||[]).join('\n');
  return out;
}
export function restoreProject(raw,master){
  const p=validateProject(raw);
  if(p.press){
    p.results=p.results.map(a=>assess({...a,...mediaMatch(a.media,a.url,master),checked:false,eligible:false},p.press,p.start,p.end));
    numberArticles(p.results);
  }
  return p;
}
