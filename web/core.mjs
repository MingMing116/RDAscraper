export const VERSION = '65.0.0';
export const AGENCIES = ['농촌진흥청','농진청','국립농업과학원','국립식량과학원','국립원예특작과학원','국립축산과학원'];
const STOP = new Set(('보도자료 보도 배포 시점 조간 석간 즉시 담당 부서 책임자 담당자 연구사 연구관 과장 센터장 붙임 자료 그림입니다 원본 그림 통해 위해 대한 관련 이번 또한 앞으로 밝혔다 말했다 제공한다 제공하는 계획이다 있는 있다 한다 것이다 것으로 이를 등이 위해서 등에서 우리나라 국립 농촌진흥청 농진청 국립농업과학원 국립식량과학원 국립원예특작과학원 국립축산과학원 청장 이승돈 기술 연구 정보 사업 기반 활용 개발 서비스 자료 제공 세계 국내 한국').split(' '));
for(const w of ('간단 정확 편리 전면 이번 지난 기존 처음 지난해 올해 내년 이날 오는 밝혔다 말했으며 밝혔으며 말했다 설명했다 설명하며 덧붙였다 밝혔다고 있다고 있도록 때문에 것으로 통해서 통해 위한 위해 이를 이들 등이 함께 더욱 보다 크게 매우 다양한 새로운 높은 많은 모든 누구나 누구 새롭게 쉽고 쉽게 앞으로 따라서 이에 또한 특히 것은 등을 내용 경우 주요 이용해 이용한 이용하는 사용해 사용하는 있도록 들어갈 새로운 넣는다 채워 빠진 나타나 나타났다 놓칠 다루 이를 위한 관한 대한 데의 들의 해당 대해 향상 높였다 밝혔다 보인다 기대된다 기대 효과 이용 기존 가능 가능한 있도록 됐다 되어 되는 만들고 마련하고 계획 밝혔다 전했다 설명했다 제공 밝혔다 청장 기자 전화 연락 문의 이메일 원본 크기 다운로드 보도사진 사진 설명 담당자 배포일 보도일 시점 오전 오후 서비스 정보 기술 연구 개발 발표 사업 분석').split(' '))STOP.add(w);
const DOMAIN_TERMS=['양자컴퓨팅','양자컴퓨터','디지털육종','유전체','유전형','유전자형','희귀변이','전사체','대사체','오믹스','결측치','유용유전자','기능성 소재','기능성 물질','식물 세포','조직배양','과수화상병','피부장벽','스마트팜','기후변화','병해충','난축맛돈','육가공','국산 감귤','NABIC','GWAS','KASP','RNA-seq'];
export const clean = s => String(s ?? '').normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b\ufeff]/g,'').replace(/[ \t\r]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
export const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
export const escapeHTML = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function words(s) {
  const plain=clean(s).replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+|\b(?:[a-z0-9-]+\.)+(?:com|kr|org|net)\b/gi,' ');
  return (plain.match(/[가-힣A-Za-z][가-힣A-Za-z0-9-]*/g)||[]).map(w=>w.length>=3?w.replace(/(?:에서는|으로는|으로|에서|에게|에는|까지|부터|과의|와의|하고|하며|했다|한다|하는|되는|됐다|이며|은|는|을|를|의)$/,''):w)
    .map(w=>/^[a-z]{2,8}$/i.test(w)?w.toUpperCase():w)
    .filter(w=>(w.length>=2 || /^(콩|벼|꿀|쌀|잎|꽃|배|밀|팥|감)$/.test(w)) && w.length<=32 && !STOP.has(w) && !/^\d/.test(w));
}
export function validDay(s) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;
  const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;
}
export function plusDays(day,n){if(!validDay(day))return '';let d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function today(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});}
export function parseDate(s, now=new Date()) {
  s=clean(s);if(!s)return '';
  if(/^20\d{2}-\d{2}-\d{2}T.*(?:Z|[+\-]\d{2}:?\d{2})$/.test(s)){const t=new Date(s);if(Number.isFinite(+t))return t.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});}
  let m=s.match(/(20\d{2})\s*[.년/\-]\s*(\d{1,2})\s*[.월/\-]\s*(\d{1,2})/);
  if(m){let d=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;return validDay(d)?d:'';}
  m=s.match(/^(\d+)\s*(분|시간|일)\s*전$/);if(m){let d=new Date(+now-Number(m[1])*({분:60000,시간:3600000,일:86400000}[m[2]]));return d.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});}
  if(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s/i.test(s)){let d=new Date(s);if(Number.isFinite(+d))return d.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});}
  return '';
}
export function titleNoise(s){return !s||s.length<9||s.length>150||/^(광|보도\s*자료|보도\s*시점|배포|담당|붙임|책임|※|\*|[-•○□]|\^|\d{4}[.\-/]|\d{1,2}\.|\d+\s*쪽)/.test(s)||/\d{2,4}[-)]\d{3,4}|@|그림입니다|원본 그림|조간|엠바고/.test(s)||/^농촌진흥청\(청장/.test(s);}
export function inferTitle(lines) {
  let arr=lines.map(x=>typeof x==='string'?{text:clean(x),size:0,page:1}:({...x,text:clean(x.text)})).filter(x=>x.text);
  // The headline precedes the first subtitle or lead paragraph; annex headings are not candidates.
  let end=arr.findIndex(x=>/^[-–]\s*농촌진흥청|^농촌진흥청(?:\(청장|은)|^붙임/.test(x.text));
  let top=arr.slice(0,end>0?end:Math.min(40,arr.length));
  let eligible=top.filter(x=>!titleNoise(x.text)&&!(x.source==='ocr'&&(/보도\s*자료/.test(x.text)||x.confidence<40)));
  if(!eligible.length)return '';
  let max=Math.max(...eligible.map(x=>x.size||0));
  let candidate=max>0?eligible.find(x=>x.size>=max*.9):eligible[0];
  let idx=arr.indexOf(candidate),title=candidate.text;
  if(idx>=0 && arr[idx+1] && !titleNoise(arr[idx+1].text) && !/^(농촌진흥청|국립.*원은)|[다요]\.$/.test(arr[idx+1].text) && (candidate.size?Math.abs(candidate.size-arr[idx+1].size)<.8:!/[다요.]$/.test(title)) && (title.length<30 || (candidate.size&&arr[idx+1].size>=max*.9))){title+=' '+arr[idx+1].text;}
  return clean(title);
}
export function analyzeText(raw, titleOverride='', lines=null) {
  const text=clean(raw);if(text.replace(/\s/g,'').length<2)throw Error('검색할 제목·핵심어를 2자 이상 입력하세요.');
  const title=clean(titleOverride)||inferTitle(lines||text.split('\n'))||(!text.includes('\n')&&text.length<140?text:'');
  const main=text.split(/\n\s*(?:붙임|참고\s*\d|담당\s*부서)/)[0];
  const count=new Map(),tw=words(title),bw=words(main.slice(0,20000));
  bw.forEach(w=>count.set(w,(count.get(w)||0)+1));tw.forEach(w=>count.set(w,(count.get(w)||0)+10));
  // Domain vocabulary is a general agriculture/science lexicon, not document-specific outputs.
  const compact=norm(main),titleCompact=norm(title);
  for(const term of DOMAIN_TERMS)if(compact.includes(norm(term))){
    const existing=[...count.keys()].find(k=>norm(k)===norm(term));
    const key=existing||term;count.set(key,(count.get(key)||0)+5+(titleCompact.includes(norm(term))?8:0));
  }
  const keywords=[...count].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko')).map(([w])=>w).slice(0,24);
  const top=text.slice(0,750),marker=top.search(/배포/);let releaseDate=marker>=0?parseDate(top.slice(marker,marker+160)):'';
  if(!releaseDate)releaseDate=parseDate(top);
  let warnings=[];if(!title)warnings.push('제목을 확인해 주세요.');if(!releaseDate)warnings.push('연도가 포함된 배포일을 찾지 못했습니다. 검색 기간을 직접 지정하세요.');
  const bad=(text.match(/[�\uE000-\uF8FF]/g)||[]).length;
  if(bad>Math.max(3,text.length*.015))warnings.push('일부 글자가 깨졌습니다. 본문을 확인하거나 다른 형식의 원본을 사용하세요.');
  return {title,text,keywords,queries:buildQueries(title,keywords),releaseDate,warnings,characters:text.length,quality:warnings.some(x=>/깨졌|제목/.test(x))?'확인 필요':'추출 완료'};
}
export function buildQueries(title, keywords, max=25){
  const available=[...new Set(keywords===undefined?words(title):keywords)].filter(Boolean);
  // Prefer distinctive title phrases. Avoid repeating both '기능성 소재' and '소재'
  // in the same short query; every enabled word remains available in the editor.
  const compactTitle=norm(title),priority=w=>compactTitle.includes(norm(w))&&norm(w).length>=5?1:0;
  const k=available.filter(w=>!available.some(v=>(/[\s-]/.test(v)||DOMAIN_TERMS.includes(v))&&norm(v)!==norm(w)&&norm(v).includes(norm(w))&&norm(w).length>=2))
    .sort((a,b)=>priority(b)-priority(a)).slice(0,12),out=[];
  const add=q=>{q=clean(q);if(q&&q.length>=2&&!out.includes(q))out.push(q);};
  if(title)add(title.replace(/[“”‘’"']/g,'').slice(0,110));
  if(k.length>=2)add(k.slice(0,2).join(' ')+' 농촌진흥청');
  if(k.length>=3)add(k.slice(0,3).join(' '));
  for(let i=1;i<Math.min(k.length,5);i++)add(k[0]+' '+k[i]+' 농촌진흥청');
  if(k.length>=3)add(k[1]+' '+k[2]+' 농촌진흥청');
  for(let i=0;i<Math.min(3,k.length);i++)add(k[i]+' 농촌진흥청');
  for(let i=2;i<k.length;i++)add(k[0]+' '+k[i]+' 농촌진흥청');
  for(const [a,b] of [['양자컴퓨팅','양자컴퓨터'],['국립농업생명공학정보센터','NABIC'],['과수화상병','화상병']])
    if(norm(k.join(' ')).includes(norm(a)))add(b+' '+(k.find(t=>!norm(a).includes(norm(t)))||'')+' 농촌진흥청');
  for(let i=1;i<k.length-1;i++)add(k[i]+' '+k[i+1]+' 농촌진흥청');
  return out.slice(0,max);
}
export function safeURL(raw, base){if(typeof raw!=='string'||!raw.trim())return '';try{const u=new URL(raw.trim(),base);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function canonicalURL(raw){
  try {let u=new URL(raw);if(/(^|\.)bing\.com$/.test(u.hostname)&&u.searchParams.has('url'))u=new URL(u.searchParams.get('url'));
    if(/(^|\.)naver\.com$/.test(u.hostname)){
      const m=u.pathname.match(/\/article\/(\d+)\/(\d+)/);let oid=m?.[1]||u.searchParams.get('oid'),aid=m?.[2]||u.searchParams.get('aid');
      if(oid&&aid)return `https://n.news.naver.com/mnews/article/${oid}/${aid}`;
    }
    u.hostname=u.hostname.toLowerCase().replace(/^(www|m|mobile)\./,'');u.hash='';
    for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid|ref|from|tracking|sm|spm)$/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();u.pathname=u.pathname.replace(/^\/mobile\/article/,'/news/article');return u.href.replace(/\/$/,'');
  }catch{return '';}
}
export function titleSimilarity(a,b){a=norm(a);b=norm(b);if(!a||!b)return 0;if(a===b)return 1;let x=new Set(),y=new Set();for(let i=0;i<a.length-1;i++)x.add(a.slice(i,i+2));for(let i=0;i<b.length-1;i++)y.add(b.slice(i,i+2));let shared=[...x].filter(c=>y.has(c)).length;return 2*shared/Math.max(1,x.size+y.size);}
export function assess(a, press, start, end){
  const content=norm([a.title,a.snippet,a.body].join(' ')),inst=AGENCIES.find(x=>content.includes(norm(x)))||'';
  const terms=[...new Set(press.activeKeywords||words(press.title).concat(press.keywords||[]))].filter(w=>!STOP.has(w)&&!AGENCIES.includes(w)).slice(0,24);
  const matched=terms.filter(w=>content.includes(norm(w)));
  const titleTerms=words(press.title), titleHits=titleTerms.filter(w=>norm(a.title).includes(norm(w)));
  const sim=titleSimilarity(a.title,press.title);
  const match=Math.min(100,Math.round(55*sim+30*matched.length/Math.max(4,terms.length)+15*titleHits.length/Math.max(3,titleTerms.length)));
  let date=a.date||'',dateOK=validDay(date)&&date>=start&&date<=end;
  const warnings=[];if(!date)warnings.push('기사일 미확인');else if(!dateOK)warnings.push('검색 기간 밖');
  if(a.dateDifference)warnings.push('검색일·원문일 차이: 원문일 적용');if(a.bodyLimited)warnings.push('본문 일부만 확보');if(!inst)warnings.push('기관명 미확인');if(a.linkMismatch)warnings.push('제목·링크 불일치');if(!a.checked)warnings.push('원문 미확인');
  const topicOK=sim>=.42 || matched.length>=2;
  if(!topicOK)warnings.push('주제 근거 부족');
  let host='';try{host=new URL(a.url).hostname;}catch{}
  const excluded=/(^|\.)(rda\.go\.kr|naas\.go\.kr|nics\.go\.kr|nihhs\.go\.kr|nias\.go\.kr|korea\.kr|nongsaro\.go\.kr)$/.test(host)||/(^|\.)(blog\.naver\.com|tistory\.com|shopping\.naver\.com)$/.test(host);
  const eligible=Boolean(inst&&topicOK&&dateOK&&!a.linkMismatch&&!excluded&&a.checked);
  return {...a,match,matched,institution:inst,dateOK,warnings,eligible,excluded,included:a.included===undefined?eligible:a.included};
}
export function dedupe(list){
  const out=[];for(const a of list){const key=canonicalURL(a.url);if(!key)continue;
    const idx=out.findIndex(b=>canonicalURL(b.url)===key || (norm(a.media)&&norm(a.media)===norm(b.media)&&norm(a.title)===norm(b.title)&&a.date===b.date));
    if(idx<0)out.push({...a,id:a.id||key});else{const old=out[idx],prefer=a.checked&&!old.checked;out[idx]={...(prefer?a:old),sources:[...new Set([...(old.sources||[old.source]),...(a.sources||[a.source])])].filter(Boolean),included:old.included};}
  }return out;
}
export function mediaMatch(media,url,master){
  let host='';try{host=new URL(url).hostname.replace(/^www\./,'');}catch{}
  const entries=master?.entries||[],byDomain=entries.find(x=>(x.domains||[]).some(d=>host===d.replace(/^www\./,'')||host.endsWith('.'+d.replace(/^www\./,''))));
  const byName=entries.find(x=>[x.media,...(x.aliases||[])].some(n=>norm(n)===norm(media)));
  const found=byDomain||byName;return found?{media:found.media,mediaScore:found.score==null?null:Number(found.score),category:found.category}:{media:media||host,mediaScore:null,category:'미등록 · 확인 필요'};
}
export function csvCell(s){s=String(s??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function toCSV(rows){return '\ufeff'+rows.map(r=>r.map(s=>csvCell(String(s??'').replace(/[\s\u0000-\u001f\u007f]+/gu,' ').trim())).join(',')).join('\r\n');}

// Assign stable article numbers once; filtering or sorting does not rename articles.
export function numberArticles(articles){
  const used=new Set();let next=1;
  for(const a of [...articles].sort((x,y)=>(y.match||0)-(x.match||0))){
    if(Number.isInteger(a.articleNo)&&a.articleNo>0&&!used.has(a.articleNo)){used.add(a.articleNo);continue;}
    delete a.articleNo;
  }
  for(const a of [...articles].sort((x,y)=>(y.match||0)-(x.match||0))){
    if(a.articleNo)continue;while(used.has(next))next++;a.articleNo=next;used.add(next++);
  }
  return articles;
}
