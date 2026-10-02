import {clean,escapeHTML as esc,norm,validDay,plusDays,today,analyzeText,buildQueries,assess,dedupe,mediaMatch,toCSV,safeURL,canonicalURL,numberArticles} from './core.mjs';
import {extractDocument} from './documents.mjs';
import {fetchPage,searchURL,parseRSS,parseNewsHTML,verifyArticle,pool,SOURCES} from './news.mjs';
import {makeReport} from './pdf-writer.mjs';
import {makeWorkbook} from './spreadsheet-writer.mjs';
import {recoverArticleBody} from './article-export.mjs';
import {PROJECT_VERSION,PROJECT_KEYS,MAX_PROJECT_BYTES,validateProject,restoreProject} from './project.mjs';
const $=id=>document.getElementById(id),$$=sel=>[...document.querySelectorAll(sel)];
// Appearance is a local preference, separate from documents and saved projects.
const textSizes=new Set(['default','large','extra']);
function setTextSize(value,remember=false){
  const size=textSizes.has(value)?value:'default';
  document.documentElement.dataset.textSize=size;
  if($('textSize'))$('textSize').value=size;
  if(remember)try{localStorage.setItem('rda-text-size',size);}catch{}
}
try{setTextSize(localStorage.getItem('rda-text-size'));}catch{setTextSize('default');}
if($('textSize'))$('textSize').onchange=()=>setTextSize($('textSize').value,true);
let pendingSave=null,saveTimer=null,saveQueue=Promise.resolve(),articleIndex=-1;
let autoSave=true,privacyBusy=false,exporting=false,exportController=null,articleDraftBody='';
let analyzing=false,resetting=false,analysisController=null,activeAnalysis=Promise.resolve(),activeTask=Promise.resolve();
let state={press:null,results:[],start:today(),end:plusDays(today(),14),demo:false},master={},token='',view='all',controller=null,running=false,duration=14,logs=[],startMs=0,timer=null,calendarTarget='start',calendarMonth='',failedPing=0,analysisGeneration=0;
const status=(id,msg,kind='')=>{$(id).textContent=msg;$(id).className='status '+kind;};
const notice=msg=>{$('notice').textContent=msg;$('notice').hidden=!msg;};
const log=msg=>{logs.push(new Date().toLocaleTimeString('ko-KR')+' '+msg);logs=logs.slice(-250);$('logs').textContent=logs.join('\n');$('logs').scrollTop=$('logs').scrollHeight;};
function snapshot(){return {schema:'rdascraper-project',version:PROJECT_VERSION,savedAt:Date.now(),...state,reset:!state.press,start:$('start').value,end:$('end').value,queries:$('queries').value,mode:$('mode').value,ocrMode:$('ocrMode').value,duration,sources:$$('input[name=source]:checked').map(x=>x.value)};}
async function flushSave(){
  clearTimeout(saveTimer);if(!autoSave){pendingSave=null;return false;}if(!token)return false;if(!pendingSave)return saveQueue;
  const project=pendingSave;pendingSave=null;
  saveQueue=saveQueue.catch(()=>false).then(async()=>{try{
    const response=await fetch('/api/project',{method:'POST',headers:{'Content-Type':'application/json','X-RDA-Token':token},body:JSON.stringify(project)});
    const d=await response.json();if(!response.ok||!d.ok)throw Error(d.error||'저장 실패');
    if($('saveStatus'))$('saveStatus').textContent='이 PC에 저장됨';return true;
  }catch(e){if($('saveStatus'))$('saveStatus').textContent='작업 JSON 저장 필요';notice(e.message+' · 상단 작업 저장으로 JSON 파일을 보관하세요.');return false;}});
  return saveQueue;
}
function persist(){if(!autoSave||privacyBusy)return false;if(resetting||!$('start')||!state.press)return true;const p=snapshot();let saved=false;
  try{localStorage.setItem(PROJECT_KEYS[0],JSON.stringify(p));saved=true;}catch{}
  pendingSave=p;if($('saveStatus'))$('saveStatus').textContent='저장 중…';clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,450);return saved;
}
function activeKeywords(){return state.press?.activeKeywords||state.press?.keywords||[];}
function renderKeywords(){
  const active=activeKeywords();$('keywordCount').textContent=active.length+'개 선택';
  $('keywords').innerHTML=(state.press?.keywords||[]).map((k,i)=>`<button type="button" class="chip ${active.includes(k)?'':'off'}" data-key="${i}" aria-pressed="${active.includes(k)}">${esc(k)}<span>${active.includes(k)?'✓':'+'}</span></button>`).join('');
  $$('#keywords [data-key]').forEach(b=>b.onclick=()=>{if(running||analyzing||exporting||resetting)return;const k=state.press.keywords[Number(b.dataset.key)];state.press.activeKeywords=active.includes(k)?active.filter(x=>x!==k):[...active,k];refreshKeywords();});
}
function refreshKeywords(){renderKeywords();state.press.queries=buildQueries(state.press.title,activeKeywords());$('queries').value=state.press.queries.join('\n');updateQueryCount();state.results=state.results.map(a=>assess(a,state.press,$('start').value,$('end').value));render();persist();}
$('addKeyword').onclick=()=>{if(!state.press||running)return;const extras=$('keywordInput').value.split(/[,，\n]/).map(clean).filter(x=>x&&x.length<=40);state.press.keywords=[...new Set([...state.press.keywords,...extras])].slice(0,40);state.press.activeKeywords=[...new Set([...activeKeywords(),...extras])].filter(x=>state.press.keywords.includes(x));$('keywordInput').value='';refreshKeywords();};
$('keywordInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('addKeyword').click();}});
function download(bytes,name,type){const u=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
function renderPress(p){
  state.press=p;$('analysis').hidden=false;$('pressTitle').value=p.title||'';$('preview').value=p.text||'';$('keywords').innerHTML=(p.keywords||[]).map(k=>`<span class="chip">${esc(k)}</span>`).join('');renderKeywords();
  $('queries').value=(p.queries||buildQueries(p.title,p.keywords)).join('\n');updateQueryCount();syncControls();
  status('analysisStatus',`${p.format||'직접 입력'} · ${p.characters||p.text?.length||0}자 · ${p.quality||'분석 완료'}${p.warnings?.length?'\n'+p.warnings.join('\n'):''}`,p.warnings?.length?'':'ok');
  $('searchStatus').textContent='날짜를 확인한 뒤 검색을 시작하세요.';
}
async function analyzeFile(file){
  if(running||analyzing||exporting||resetting)return;const generation=++analysisGeneration;analysisController=new AbortController();analyzing=true;syncControls();$('manual').value='';$('fileLabel').textContent=file.name;status('analysisStatus','문서의 제목과 본문을 읽고 있습니다…');
  try{const p=await extractDocument(file,{ocrMode:$('ocrMode').value,signal:analysisController.signal,onProgress:m=>{if(generation===analysisGeneration)status('analysisStatus',m.message);}});if(generation!==analysisGeneration)return;state.demo=false;state.results=[];renderPress(p);if(p.releaseDate){$('start').value=p.releaseDate;$('end').value=plusDays(p.releaseDate,duration);}notice('');render();persist();}
  catch(e){if(generation!==analysisGeneration)return;if(e.name==='AbortError'){status('analysisStatus','분석을 중단했습니다. 다른 파일을 선택하거나 다시 분석하세요.');return;}state.press=null;state.results=[];$('analysis').hidden=true;$('queries').value='';updateQueryCount();render();status('analysisStatus',e.message||'문서를 읽지 못했습니다.','error');}
  finally{if(generation===analysisGeneration){analyzing=false;analysisController=null;syncControls();}}
}
function beginFile(file){activeAnalysis=analyzeFile(file);return activeAnalysis;}
$('cancelAnalysis').onclick=()=>{analysisController?.abort();$('cancelAnalysis').disabled=true;};
$('file').addEventListener('change',()=>{if($('file').files[0])beginFile($('file').files[0]);});
for(const ev of ['dragenter','dragover'])$('dropzone').addEventListener(ev,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
for(const ev of ['dragleave','drop'])$('dropzone').addEventListener(ev,e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(ev==='drop'&&e.dataTransfer.files[0])beginFile(e.dataTransfer.files[0]);});
$('analyzeBtn').onclick=()=>{if(clean($('manual').value)){try{analysisGeneration++;state.demo=false;state.results=[];const p=analyzeText($('manual').value);renderPress(p);if(p.releaseDate){$('start').value=p.releaseDate;$('end').value=plusDays(p.releaseDate,duration);}notice('');render();persist();}catch(e){status('analysisStatus',e.message,'error');}}else if($('file').files[0])beginFile($('file').files[0]);else status('analysisStatus','파일을 선택하거나 제목·본문을 입력하세요.','error');};
$('reanalyzeBtn').onclick=()=>{try{const p=analyzeText($('preview').value,$('pressTitle').value);renderPress(p);state.results=state.results.map(a=>assess(a,p,$('start').value,$('end').value));render();persist();}catch(e){status('analysisStatus',e.message,'error');}};
$('pressTitle').addEventListener('change',()=>{if(!state.press)return;state.press.title=clean($('pressTitle').value);state.press.queries=buildQueries(state.press.title,activeKeywords());$('queries').value=state.press.queries.join('\n');updateQueryCount();persist();});
function updateQueryCount(){$('queryCount').textContent=queryLines().length+'개';}
function queryLines(){return [...new Set($('queries').value.split('\n').map(clean).filter(Boolean))].slice(0,25);}
$('queries').oninput=()=>{updateQueryCount();persist();};
for(const input of $$('input[name=source],#mode,#ocrMode'))input.addEventListener('change',persist);
function datesChanged(){state.start=$('start').value;state.end=$('end').value;if(validDay(state.start)&&validDay(state.end)){state.results=state.results.map(a=>({...assess(a,state.press||{},state.start,state.end),included:a.included&&(!a.date||a.date>=state.start&&a.date<=state.end)}));render();persist();}}
$$('[data-days]').forEach(b=>b.onclick=()=>{duration=Number(b.dataset.days);if(!validDay($('start').value))return notice('먼저 검색 시작일을 입력하세요.');$('end').value=plusDays($('start').value,duration);$$('[data-days]').forEach(x=>x.classList.toggle('active',x===b));datesChanged();});
$('start').addEventListener('change',()=>{if(validDay($('start').value))$('end').value=plusDays($('start').value,duration);datesChanged();});$('end').addEventListener('change',datesChanged);
function drawCalendar(){const [year,month]=calendarMonth.split('-').map(Number),first=new Date(Date.UTC(year,month-1,1)).getUTCDay(),last=new Date(Date.UTC(year,month,0)).getUTCDate();$('monthLabel').textContent=`${year}년 ${month}월`;$('days').innerHTML='<span></span>'.repeat(first)+Array.from({length:last},(_,i)=>{const day=`${calendarMonth}-${String(i+1).padStart(2,'0')}`;return `<button type="button" data-day="${day}" class="${day===today()?'today ':''}${day===$(calendarTarget).value?'chosen':''}" aria-label="${year}년 ${month}월 ${i+1}일">${i+1}</button>`;}).join('');
  $$('#days [data-day]').forEach(b=>b.onclick=()=>{$(calendarTarget).value=b.dataset.day;if(calendarTarget==='start')$('end').value=plusDays(b.dataset.day,duration);$('calendar').close();datesChanged();});}
$$('.calendar-open').forEach(b=>b.onclick=()=>{calendarTarget=b.dataset.target;calendarMonth=(validDay($(calendarTarget).value)?$(calendarTarget).value:today()).slice(0,7);drawCalendar();$('calendar').showModal();});
function moveMonth(n){let d=new Date(calendarMonth+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);calendarMonth=d.toISOString().slice(0,7);drawCalendar();}
$('prevMonth').onclick=()=>moveMonth(-1);$('nextMonth').onclick=()=>moveMonth(1);$('calendarClose').onclick=()=>$('calendar').close();$('calendar').addEventListener('click',e=>{if(e.target===$('calendar')){const r=$('calendar').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('calendar').close();}});
function syncControls(){
  const busy=running||analyzing||exporting||resetting||privacyBusy;
  $('inputFields').disabled=busy;$('searchFields').disabled=busy;$('searchBtn').disabled=busy||!state.press||!token;$('stopBtn').disabled=!running||resetting;
  $('cancelAnalysis').hidden=!analyzing;$('cancelAnalysis').disabled=resetting;$('homeBtn').disabled=resetting||privacyBusy;
  for(const id of ['rememberWork','clearLocalData'])if($(id))$(id).disabled=resetting||privacyBusy||!token;
  for(const id of ['analyzeBtn','pressTitle','preview','reanalyzeBtn','addURL','restoreBtn','quitBtn','selectShown','clearShown','addKeyword','keywordInput'])$(id).disabled=busy;syncExportControls();
}
function setRunning(value){running=value;syncControls();}
async function runSearch(){
  if(running||analyzing||exporting||resetting||!state.press)return;
  const start=$('start').value,end=$('end').value,queries=queryLines().slice(0,Number($('mode').value)),sources=$$('input[name=source]:checked').map(x=>x.value);
  if(!validDay(start)||!validDay(end)||start>end)return notice('시작일·종료일을 YYYY-MM-DD로 확인하세요. 종료일은 시작일 이후여야 합니다.');
  if(!queries.length||!sources.length)return notice('검색어와 검색원을 하나 이상 선택하세요.');
  state.start=start;state.end=end;state.demo=false;state.results=[];notice('');render();logs=[];controller=new AbortController();const signal=controller.signal;setRunning(true);startMs=Date.now();
  const deadline=setTimeout(()=>controller?.abort('time'),300000);timer=setInterval(()=>{$('timer').textContent=new Date(Date.now()-startMs).toISOString().slice(14,19);},500);
  const jobs=queries.flatMap(q=>sources.map(source=>({q,source})));let done=0,fail=0,success=0,raw=[],sourceLocked={},blocked=new Set();
  log(`검색어 ${queries.length}개 × 검색원 ${sources.length}개. 화면 요청 대기 최대 20초, 전체 최대 5분.`);
  try {
    await pool(jobs,4,async({q,source})=>{
      if(blocked.has(source)){done++;return;}
      const previous=sourceLocked[source]||Promise.resolve();let release;sourceLocked[source]=new Promise(r=>release=r);await previous;
      try{if(signal.aborted||blocked.has(source))return;
        await new Promise(r=>setTimeout(r,350));if(signal.aborted)return;
        $('searchStatus').textContent=`${SOURCES[source]} 검색 중 · ${done}/${jobs.length}`;
        const url=searchURL(source,q,start,end),page=await fetchPage(url,token,signal);
        const results=['google','bing'].includes(source)?parseRSS(page.text,source,q):parseNewsHTML(page.text,source,q,url);
        if(!results.length && ['naver','daum'].includes(source))log(`${SOURCES[source]} 0건: 결과 없음 또는 화면 구조 변경 가능`);
        else log(`${SOURCES[source]} · ${q.slice(0,40)} → ${results.length}건`);
        raw.push(...results);success++;
        state.results=dedupe(raw).map(a=>assess({...a,...mediaMatch(a.media,a.url,master)},state.press,start,end));render();
      }catch(e){if(e.name!=='AbortError'){fail++;log(`${SOURCES[source]}: ${e.message}`);if(['403','429'].includes(String(e.status))){blocked.add(source);log(`${SOURCES[source]} 접근 제한: 이번 검색에서 추가 요청을 중단했습니다.`);}}}
      finally{done++;$('progressFill').style.width=Math.round(done/jobs.length*65)+'%';release();}
    },signal);
    raw=dedupe(raw);const candidates=raw.map(a=>assess(a,state.press,start,end)).filter(a=>!a.excluded).sort((a,b)=>b.match-a.match).slice(0,80);
    log(`중복 제거 ${raw.length}건 · 원문 확인 최대 ${candidates.length}건`);let checked=0;
    await pool(candidates,4,async a=>{try{const updated=await verifyArticle(a,token,signal);const index=raw.findIndex(x=>canonicalURL(x.url)===canonicalURL(a.url));if(index>=0)raw[index]=updated;checked++;$('searchStatus').textContent=`원문 · 날짜 확인 ${checked}/${candidates.length}`;$('progressFill').style.width=(65+Math.round(checked/Math.max(1,candidates.length)*35))+'%';state.results=dedupe(raw).map(a=>assess({...a,...mediaMatch(a.media,a.url,master)},state.press,start,end));render();}catch(e){if(e.name!=='AbortError')log(e.message);}},signal);
    if(raw.length>80)log('81번째 이후 후보는 원문 미확인으로 남겼습니다. 필요하면 URL 직접 추가로 확인하세요.');
  }catch(e){if(e.name!=='AbortError')log(e.message);}
  finally{clearTimeout(deadline);clearInterval(timer);const stopped=signal.aborted;setRunning(false);controller=null;state.results=dedupe(raw).map(a=>assess({...a,...mediaMatch(a.media,a.url,master)},state.press,start,end));render();persist();
    $('searchStatus').textContent=`${stopped?'검색 중단 · 현재 결과 유지':'검색 완료'} · 후보 ${state.results.length}건 · 요청 오류 ${fail}회`;
    if(!stopped)$('progressFill').style.width='100%';
    if(!state.results.length)notice(success===0?'검색원에 연결하지 못했습니다. 검색 로그에서 연결 오류를 확인하세요.':'검색 결과가 없습니다. 기간·핵심어를 확인하거나 검색 범위를 넓혀 주세요.');
    log(stopped?'중단되었습니다. 확보한 후보는 검수할 수 있습니다.':'검색 완료');
  }
}
$('searchBtn').onclick=()=>{activeTask=runSearch();return activeTask;};$('stopBtn').onclick=()=>{controller?.abort('user');$('stopBtn').disabled=true;$('searchStatus').textContent='중단 중 · 현재 결과를 정리합니다.';};
function visible(){const q=norm($('filter').value),min=Number($('minMatch').value);return state.results.filter(a=>(view==='all'||(view==='ready'&&a.eligible)||(view==='review'&&!a.eligible)||(view==='selected'&&a.included))&&a.match>=min&&(!q||norm(a.title+' '+a.media).includes(q))).sort((a,b)=>$('sort').value==='date'?(b.date||'').localeCompare(a.date||''):$('sort').value==='media'?(a.media||'').localeCompare(b.media||'','ko'):b.match-a.match);}
function render(){
  if(!running)numberArticles(state.results);
  const currentStep=running?1:state.results.length?2:state.press?1:0;$$('.steps li').forEach((el,i)=>{el.classList.toggle('active',i===currentStep);el.classList.toggle('done',i<currentStep);});$('saveBtn').disabled=!state.press;
  const selected=state.results.filter(a=>a.included),ready=state.results.filter(a=>a.eligible),shown=visible();$('totalCount').textContent=state.results.length;$('readyCount').textContent=ready.length;$('selectedCount').textContent=selected.length;$('mediaTotal').textContent=selected.reduce((n,a)=>n+(a.mediaScore??0),0).toFixed(1);const unknown=selected.filter(a=>a.mediaScore==null).length;$('unknownScore').textContent=unknown?`미등록 ${unknown}건 제외`:'';$('shownCount').textContent=shown.length+'건 표시';
  syncExportControls();
  if(!shown.length){$('results').innerHTML=`<tr class="empty-row"><td colspan="7"><div class="empty"><b>${state.results.length?'조건에 맞는 기사가 없습니다.':'검색한 기사가 여기에 모입니다.'}</b><p>${state.results.length?'필터를 바꾸거나 전체 탭을 선택하세요.':'제목, 기사일, 원문 링크를 확인하고 필요한 기사만 선택하세요.'}</p></div></td></tr>`;return;}
  $('results').innerHTML=shown.map(a=>{const i=state.results.indexOf(a);return `<tr data-index="${i}" class="${a.included?'selected':''}" tabindex="0" aria-selected="${a.included}" aria-label="기사 선택 ${esc(a.title)}"><td><input type="checkbox" data-select="${i}" ${a.included?'checked':''} aria-label="${esc(a.title)} 선택"></td><td class="article-number">${esc(a.articleNo||i+1)}</td><td>${esc(a.date||'미확인')}<div class="result-source">${esc(a.dateSource||'날짜 근거 없음')}</div></td><td>${esc(a.media||'미확인')}<div class="result-source">매체 ${esc(a.mediaScore??'확인 필요')}${a.mediaScore!=null?'점':''}</div></td><td><a href="${esc(safeURL(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a><div class="snippet">${esc(a.snippet||'발췌문 없음 · 원문을 확인하세요.')}</div><div class="result-source">${esc((a.sources||[a.source]).filter(Boolean).join(' · '))}${state.demo?' · 예시 데이터':''}</div></td><td><span class="match">${esc(a.match)}</span></td><td><span class="${a.eligible?'state-good':'state-warn'}">${a.eligible?'자동 확인':'확인 필요'}</span><button data-detail="${i}" class="detail-btn">${a.eligible?'판별 근거 보기':esc(a.warnings?.[0]||'원문 미확인')}</button></td></tr>`;}).join('');
  $$('#results tr[data-index]').forEach(tr=>{const toggle=()=>{if(running||analyzing||exporting||resetting)return notice('기사 정보 확인 중입니다. 검색을 완료하거나 중단한 뒤 선택하세요.');const a=state.results[Number(tr.dataset.index)];a.included=!a.included;render();persist();};tr.addEventListener('click',e=>{if(e.target.closest('a,button,input'))return;toggle();});tr.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&e.target===tr){e.preventDefault();toggle();}});});
  $$('[data-select]').forEach(cb=>{cb.disabled=running||analyzing||exporting||resetting||privacyBusy;cb.onchange=()=>{if(running||analyzing||exporting||resetting||privacyBusy){cb.checked=state.results[Number(cb.dataset.select)].included;return;}state.results[Number(cb.dataset.select)].included=cb.checked;render();persist();};});
  $$('[data-detail]').forEach(b=>b.onclick=()=>{articleIndex=Number(b.dataset.detail);const a=state.results[articleIndex];
    $('editArticleTitle').value=a.title||'';$('editArticleDate').value=a.date||'';$('editArticleMedia').value=a.media||'';
    articleDraftBody=a.body||'';$('articleBody').value=a.body||a.snippet||'본문과 발췌문을 확보하지 못했습니다.';$('articleBody').readOnly=true;$('editBodyBtn').disabled=false;
    $('articleEvidence').textContent=`${a.checked?'원문 확인':'원문 미확인'} · ${a.dateSource||'날짜 근거 없음'}${a.bodyLimited?' · 본문 일부만 확보':''}\n일치 핵심어: ${(a.matched||[]).join(', ')||'없음'}\n${(a.warnings||[]).join(' / ')}${a.fetchNote?'\n'+a.fetchNote:''}${a.bodyUserEdited?'\n사용자가 보완한 본문 · 원문 대조 필요':''}${a.bodySource?'\n본문 출처: '+a.bodySource:''}`;
    $('articleLink').href=safeURL(a.url);$('saveArticle').disabled=running||analyzing||exporting||resetting;$('articleDialog').showModal();syncExportControls();});

}
$$('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b));render();});
for(const id of ['filter','minMatch','sort'])$(id).addEventListener(id==='filter'?'input':'change',render);
$('selectShown').onclick=()=>{visible().forEach(a=>a.included=true);render();persist();};$('clearShown').onclick=()=>{visible().forEach(a=>a.included=false);render();persist();};
$('manualSearch').onclick=()=>{window.open(searchURL('naver',queryLines()[0]||state.press?.title||'농촌진흥청',$('start').value,$('end').value),'_blank','noopener');};
async function addURLs(){
  if(!state.press)return notice('보도자료를 먼저 분석하세요.');if(running||analyzing||exporting||resetting)return;
  const start=$('start').value,end=$('end').value;
  if(!validDay(start)||!validDay(end)||start>end)return notice('검색 기간을 먼저 확인하세요.');
  const urls=[...new Set($('urls').value.split('\n').map(x=>safeURL(x.trim())).filter(Boolean))].slice(0,20);
  if(!urls.length)return notice('http 또는 https 기사 주소를 입력하세요.');
  controller=new AbortController();const signal=controller.signal;
  const deadline=setTimeout(()=>controller?.abort('time'),300000);setRunning(true);
  try{let done=0;for(const url of urls){
    if(signal.aborted)break;
    $('searchStatus').textContent=`기사 URL 확인 ${++done}/${urls.length}`;
    const a=await verifyArticle({title:'',url,manual:true,source:'직접 추가',date:'',query:''},token,signal);
    if(!a.title){log(`추가 실패 ${url}: ${a.fetchNote||'제목을 읽지 못함'}`);continue;}
    const result=assess({...a,...mediaMatch(a.media,a.url,master)},state.press,start,end);
    state.results=dedupe([...state.results,result]);render();
  }}catch(e){if(e.name!=='AbortError')log(e.message);}
  finally{clearTimeout(deadline);setRunning(false);controller=null;render();persist();
    $('searchStatus').textContent=signal.aborted?'URL 확인 중단 · 확보한 결과 유지':'URL 확인 완료';
    notice(signal.aborted?'중단했습니다. 확보한 기사는 검수할 수 있습니다.':'URL 확인을 마쳤습니다. 확인 상태와 검색 로그를 확인하세요.');
  }
};
$('addURL').onclick=()=>{activeTask=addURLs();return activeTask;};
function exportRows(){
  const rows=[['선택','번호','기사일','날짜 근거','매체','매체 분류','매체 점수','제목','원문 URL','일치도(0~100)','원문 확인','확인 사항','검색원','일치 핵심어','발췌문','예시 여부']];
  state.results.filter(a=>a.included).forEach(a=>rows.push(['Y',a.articleNo,a.date,a.dateSource,a.media,a.category,a.mediaScore??'확인 필요',a.title,a.url,a.match,a.checked?'확인':'미확인',(a.warnings||[]).join(' / '),(a.sources||[a.source]).join(' / '),(a.matched||[]).join(', '),a.snippet,state.demo?'예시':'실제 수집']));return rows;
}
function syncExportControls(){
  const busy=running||analyzing||exporting||resetting||privacyBusy;
  for(const id of ['xlsxBtn','csvBtn','pdfBtn'])$(id).disabled=busy||!state.results.some(a=>a.included);
  $$('[data-select]').forEach(cb=>cb.disabled=busy);
  for(const id of ['refreshArticleBody','editBodyBtn'])if($(id))$(id).disabled=busy||($('articleDialog').open&&!$('articleBody').readOnly);
}
function finishExport(owner){if(exportController===owner){exportController=null;exporting=false;syncControls();syncExportControls();}}
$('csvBtn').onclick=()=>{
  if(exporting||running||analyzing||resetting)return;
  download(toCSV(exportRows()),'RDA_선택기사_'+today()+'.csv','text/csv;charset=utf-8');
  status('exportStatus','CSV를 저장했습니다. 셀 안 줄바꿈은 한 줄로 정리했습니다. 고정 행 높이는 엑셀 XLSX에서 지원합니다.','ok');
};
$('xlsxBtn').onclick=async()=>{
  if(exporting||running||analyzing||resetting)return;
  const generation=analysisGeneration,owner=new AbortController();exportController=owner;exporting=true;syncControls();syncExportControls();
  status('exportStatus','행 높이가 일정한 엑셀 파일을 만들고 있습니다…');
  try{const bytes=await makeWorkbook(exportRows(),{title:state.press?.title||'선택 기사',period:$('start').value+' ~ '+$('end').value});
    if(generation!==analysisGeneration||owner.signal.aborted)return;
    download(bytes,'RDA_선택기사_'+today()+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    status('exportStatus','엑셀 XLSX를 저장했습니다. 모든 행 높이는 30pt로 고정되며, 긴 내용은 셀을 선택해 전체를 확인할 수 있습니다.','ok');
  }catch(e){if(generation===analysisGeneration)status('exportStatus','엑셀 저장 실패: '+e.message,'error');}finally{finishExport(owner);}
};
async function exportPDF(){
  if(exporting||running||analyzing||resetting)return;
  const generation=analysisGeneration,owner=new AbortController();exportController=owner;exporting=true;syncControls();syncExportControls();
  const articles=state.results.filter(a=>a.included).map(a=>({...a}));
  try{
    status('exportStatus','기사 번호순으로 검수 목록 PDF를 만들고 있습니다…');
    const p=state.demo?{...state.press,title:'[예시 데이터] '+state.press.title}:state.press;
    const bytes=await makeReport(articles,p,{start:$('start').value,end:$('end').value},false);
    if(generation!==analysisGeneration||owner.signal.aborted)return;
    download(bytes,`RDA_검수목록_${today()}.pdf`,'application/pdf');
    status('exportStatus',`선택 ${articles.length}건의 검수 목록 PDF를 기사 번호순으로 저장했습니다.`,'ok');
  }catch(e){if(generation===analysisGeneration)status('exportStatus','검수 목록 PDF 생성 실패: '+e.message,'error');}
  finally{finishExport(owner);}
}
$('pdfBtn').onclick=exportPDF;
$('editBodyBtn').onclick=()=>{
  if(exporting||articleIndex<0)return;
  $('articleBody').readOnly=false;$('articleBody').value=articleDraftBody;$('articleBody').focus();syncExportControls();
  $('articleEvidence').textContent+='\n원문에서 확인한 본문을 붙여넣고 수정 내용 저장을 누르세요. 사용자 보완으로 구분됩니다.';
};
$('refreshArticleBody').onclick=async()=>{
  if(exporting||articleIndex<0||!$('articleBody').readOnly)return;
  const generation=analysisGeneration,index=articleIndex,old=state.results[index],owner=new AbortController();
  exportController=owner;exporting=true;syncControls();syncExportControls();$('saveArticle').disabled=true;
  $('articleEvidence').textContent='기사 본문을 다시 가져오고 있습니다…';
  try{let updated=await recoverArticleBody({...old,bodyUserEdited:false},{token,signal:owner.signal});
    if(old.bodyUserEdited&&(!updated.checked||updated.bodyLimited))updated={...old,fetchNote:'본문 재확인에 실패하여 사용자가 보완한 본문을 유지했습니다.'};
    if(generation!==analysisGeneration||state.results[index]!==old)return;
    state.results[index]=assess({...updated,...mediaMatch(updated.media,updated.url,master)},state.press,$('start').value,$('end').value);
    if(articleIndex===index&&$('articleDialog').open){
      articleDraftBody=updated.body||'';$('articleBody').value=updated.body||updated.snippet||'본문을 확보하지 못했습니다.';$('articleBody').readOnly=true;
      $('articleEvidence').textContent=(updated.bodyUserEdited?'사용자 보완 본문':updated.bodyLimited?'본문 확인 필요':'본문 확인 완료')+(updated.fetchNote?'\n'+updated.fetchNote:'')+(updated.bodySource?'\n본문 출처: '+updated.bodySource:'');
    }render();persist();
  }catch(e){if(generation===analysisGeneration&&articleIndex===index&&$('articleDialog').open)$('articleEvidence').textContent='본문 다시 가져오기 실패: '+e.message;}
  finally{finishExport(owner);if(generation===analysisGeneration)$('saveArticle').disabled=false;}
};
$('saveBtn').onclick=()=>{download(JSON.stringify(snapshot(),null,2),'RDA_작업_'+today()+'.json','application/json');persist();flushSave();notice('작업 JSON 파일을 다운로드했습니다. 다른 PC에서도 작업 불러오기로 이어갈 수 있습니다.');};
$('restoreBtn').onclick=()=>$('projectFile').click();
function restore(raw){
  // Complete validation and derived-data recomputation precede every state/DOM
  // mutation so invalid files cannot partially replace the current session.
  const p=restoreProject(raw,master);
  if(!p.press)throw Error('문서가 없는 초기화 작업 파일입니다.');
  duration=p.duration;$('ocrMode').value=p.ocrMode;
  $$('[data-days]').forEach(b=>b.classList.toggle('active',Number(b.dataset.days)===duration));
  $$('input[name=source]').forEach(input=>input.checked=p.sources.includes(input.value));
  state={press:p.press,results:p.results,start:p.start,end:p.end,demo:p.demo};
  $('start').value=p.start;$('end').value=p.end;renderPress(p.press);$('queries').value=p.queries;$('mode').value=p.mode;updateQueryCount();render();
}
$('projectFile').onchange=async()=>{try{
  if(running||analyzing||exporting||resetting||privacyBusy)return notice('진행 중인 작업을 마친 뒤 작업 파일을 불러오세요.');
  const f=$('projectFile').files[0];if(!f)return;const generation=++analysisGeneration;if(f.size>MAX_PROJECT_BYTES)throw Error('작업 파일은 15MB 이하로 선택하세요.');
  const text=await f.text();if(new TextEncoder().encode(text).byteLength>MAX_PROJECT_BYTES)throw Error('작업 파일은 15MB 이하로 선택하세요.');
  if(generation!==analysisGeneration||running||analyzing||exporting||resetting||privacyBusy)return;
  restore(JSON.parse(text));persist();notice(state.demo?'예시 작업을 불러왔습니다. 실제 기사 자료가 아닙니다.':'저장한 작업을 불러왔습니다. 매체 점수·일치도를 다시 계산했으며 원문 확인 상태는 재검수가 필요합니다.');
}catch(e){notice(e instanceof SyntaxError?'작업 JSON 형식이 올바르지 않습니다.':e.message);}finally{$('projectFile').value='';}};
$('helpBtn').onclick=()=>$('help').showModal();$('closeHelp').onclick=()=>$('help').close();
$('closeArticle').onclick=()=>$('articleDialog').close();
$('saveArticle').onclick=()=>{if(running||exporting||articleIndex<0)return;const a=state.results[articleIndex],title=clean($('editArticleTitle').value),date=$('editArticleDate').value;
  if(!title||date&&!validDay(date))return notice('제목과 게시일을 확인하세요.');
  const bodyChanged=!$('articleBody').readOnly&&$('articleBody').value!==articleDraftBody;const body=bodyChanged?clean($('articleBody').value):a.body;
  if(bodyChanged&&(!body||body.length>2000000))return notice('보완할 본문을 입력하세요. 최대 200만 자까지 저장할 수 있습니다.');
  const edited={...a,title,media:clean($('editArticleMedia').value),date,dateSource:date!==a.date?'사용자 확인':a.dateSource,userEdited:true,...(bodyChanged?{body,bodyUserEdited:true,bodySource:'사용자 보완',bodyLimited:false,checked:false,fetchNote:'사용자가 원문을 보고 보완한 본문입니다. 원문 대조가 필요합니다.'}:{})};
  state.results[articleIndex]=assess({...edited,...mediaMatch(edited.media,edited.url,master)},state.press,$('start').value,$('end').value);$('articleDialog').close();render();persist();};
$('quitBtn').onclick=async()=>{const localSaved=persist(),diskSaved=await flushSave();
  if(autoSave&&!diskSaved&&!localSaved&&!window.confirm('작업을 자동 저장하지 못했습니다. 작업 JSON을 보관하지 않았다면 취소하세요. 그래도 종료할까요?'))return;
  try{const r=await fetch('/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-RDA-Token':token},body:'{}'});if(!r.ok||!(await r.json()).ok)throw Error();}
  catch{notice('프로그램 종료를 확인하지 못했습니다. 작업 JSON 파일을 보관하세요.');return;}
  document.body.innerHTML='<main class="goodbye"><div class="eyebrow">RDA NEWS DESK</div><h1>오늘의 스크랩을 마쳤습니다.</h1><p>'+(!autoSave?'자동 저장을 끈 상태로 종료했습니다.':diskSaved?'작업을 이 PC에 저장했습니다.':localSaved?'작업을 이 브라우저에 저장했습니다.':'자동 저장은 하지 못했습니다.')+'</p><p>다음에는 RDAscraper.exe를 다시 실행하세요.</p><small>이 창은 닫아도 됩니다.</small></main>';
};
async function heartbeat(){if(!$('connection'))return;try{const res=await fetch('/api/health',{cache:'no-store'});if(!res.ok)throw Error();failedPing=0;$('connection').textContent='내 PC에서 실행 중';$('connection').className='badge';}catch{if(++failedPing>=2&&$('connection')){$('connection').textContent='연결 끊김';$('connection').className='badge error';notice('프로그램 연결이 끊겼습니다. 작업 저장 후 RDAscraper.exe를 다시 실행하세요.');}}}
async function init(){
  $('start').value=state.start;$('end').value=state.end;
  try{
    const [config,m]=await Promise.all([fetch('/api/config').then(r=>r.json()),fetch('./media_master.json').then(r=>r.json())]);
    if(!config.ok||!config.token)throw Error('설정 오류');token=config.token;master=m;await heartbeat();
    let preference;try{preference=JSON.parse(localStorage.getItem('rda-preferences')||'null');}catch{}
    autoSave=typeof config.autoSave==='boolean'?config.autoSave:preference?.autoSave!==false;
    if($('rememberWork'))$('rememberWork').checked=autoSave;
    try{localStorage.setItem('rda-preferences',JSON.stringify({autoSave}));}catch{}
    const candidates=[];let invalidSaved=false,serverReset=null;
    const consider=raw=>{if(!raw)return;try{candidates.push(validateProject(raw));}catch{invalidSaved=true;}};
    if(autoSave){
      for(const key of PROJECT_KEYS){try{const text=localStorage.getItem(key);if(text){if(new TextEncoder().encode(text).byteLength>MAX_PROJECT_BYTES){invalidSaved=true;continue;}consider(JSON.parse(text));}}catch{invalidSaved=true;}}
      try{const r=await fetch('/api/project',{headers:{'X-RDA-Token':token}});const d=await r.json();if(d.ok){consider(d.project);if(d.project?.reset===true){try{serverReset=validateProject(d.project);}catch{invalidSaved=true;}}}else invalidSaved=true;}catch{invalidSaved=true;}
      const saved=serverReset||candidates.sort((a,b)=>b.savedAt-a.savedAt||Number(b.reset||!b.press)-Number(a.reset||!a.press))[0];
      if(saved?.press){restore(saved);$('saveStatus').textContent='이전 작업 복원됨';notice(saved.demo?'예시 작업을 복원했습니다. 실제 기사 데이터가 아닙니다.':'이전 작업을 복원했습니다. 원문 확인 상태는 재검수가 필요합니다.');}
      else if(invalidSaved)notice('형식이 올바르지 않은 이전 작업은 복원하지 않았습니다. 현재 작업은 유지됩니다.');
    }else{clearBrowserProjects();$('saveStatus').textContent='자동 저장 꺼짐';}

  }catch(e){notice('프로그램 연결을 확인하지 못했습니다. RDAscraper.exe를 다시 실행하세요.');$('connection').textContent='연결 확인 필요';}
  render();syncControls();setInterval(heartbeat,15000);window.addEventListener('beforeunload',persist);
}
// Reset serializes after all in-flight work and saves an empty snapshot with a
// timestamp. This also prevents an older browser cache on another port reviving it.
$('homeBtn').onclick=async()=>{
  if(resetting||privacyBusy)return;resetting=true;syncControls();
  await initialization;
  analysisGeneration++;analysisController?.abort();controller?.abort('reset');exportController?.abort('reset');exportController=null;exporting=false;
  clearTimeout(saveTimer);pendingSave=null;
  try{
    await Promise.allSettled([activeTask,activeAnalysis]);
    await saveQueue.catch(()=>false);
    state={press:null,results:[],start:today(),end:plusDays(today(),14),demo:false};
    view='all';duration=14;logs=[];articleIndex=-1;calendarTarget='start';calendarMonth='';running=false;analyzing=false;analysisController=null;controller=null;
    clearInterval(timer);clearTimeout(saveTimer);pendingSave=null;
    for(const id of ['manual','pressTitle','preview','queries','keywordInput','filter','urls','file','projectFile','editArticleTitle','editArticleDate','editArticleMedia','articleBody'])$(id).value='';
    $('articleEvidence').textContent='';$('articleLink').removeAttribute('href');$('tableWrap').scrollLeft=0;
    $('start').value=state.start;$('end').value=state.end;$('mode').value='8';$('ocrMode').value='auto';$('sort').value='match';$('minMatch').value='0';
    $('fileLabel').textContent='파일 선택 또는 여기에 놓기';$('analysis').hidden=true;$('keywords').innerHTML='';$('keywordCount').textContent='';
    $('logs').textContent='검색 전입니다.';$('timer').textContent='00:00';$('progressFill').style.width='0%';
    $('searchStatus').textContent='자료 분석을 완료하면 검색할 수 있습니다.';
    status('analysisStatus','파일을 선택하면 자동으로 분석합니다.');status('exportStatus','');
    $$('input[name=source]').forEach(x=>x.checked=x.value!=='bing');
    $$('[data-days]').forEach(x=>x.classList.toggle('active',x.dataset.days==='14'));
    $$('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view==='all'));
    $$('details').forEach(x=>x.open=false);$$('dialog[open]').forEach(x=>x.close());$('dropzone').classList.remove('drag');
    updateQueryCount();render();
    const blank=snapshot();let localOK=false;
    try{clearBrowserProjects();if(autoSave)localStorage.setItem(PROJECT_KEYS[0],JSON.stringify(blank));localOK=true;}catch{}
    pendingSave=autoSave?blank:null;const diskOK=autoSave?await flushSave():true;
    $('saveStatus').textContent=!autoSave?'자동 저장 꺼짐':diskOK?'새 작업 준비':'초기화 저장 확인 필요';
    notice(diskOK?'처음 화면으로 초기화했습니다.':localOK?'화면을 초기화했습니다. PC 저장을 확인하지 못해 재실행 시 이전 작업이 나타날 수 있습니다.':'초기화 내용을 저장하지 못했습니다. 프로그램 연결을 확인하세요.');
    window.scrollTo({top:0,behavior:'smooth'});
  }finally{resetting=false;syncControls();}
};
function clearBrowserProjects(){let ok=true;for(const key of PROJECT_KEYS){try{localStorage.removeItem(key);}catch{ok=false;}}return ok;}
async function changePrivacy(enabled,clear=false){
  if(resetting||privacyBusy)return;
  privacyBusy=true;const priorAutoSave=autoSave;let browserCleared=true;
  // Stop new writes before waiting for a write already in flight. The server
  // atomically records the preference and tombstone after that write completes.
  if(!enabled){autoSave=false;clearTimeout(saveTimer);pendingSave=null;}
  syncControls();
  try{
    await saveQueue.catch(()=>false);
    if(!enabled){browserCleared=clearBrowserProjects();try{localStorage.setItem('rda-preferences',JSON.stringify({autoSave:false}));}catch{}}
    const response=await fetch(clear?'/api/project':'/api/preferences',{method:clear?'DELETE':'POST',headers:{'Content-Type':'application/json','X-RDA-Token':token},...(clear?{}:{body:JSON.stringify({autoSave:enabled})})});
    const d=await response.json();if(!response.ok||!d.ok)throw Error(d.error||'PC 저장 설정을 변경하지 못했습니다.');
    autoSave=enabled;
    try{localStorage.setItem('rda-preferences',JSON.stringify({autoSave}));}catch{}
    if(!enabled){logs=[];$('logs').textContent='검색 전입니다.';}
    if($('privacyStatus'))$('privacyStatus').textContent=enabled?'이 PC에 작업을 자동 저장합니다.':'PC의 자동 저장 작업·검색 로그를 삭제하고 자동 저장을 껐습니다. 현재 화면의 작업과 직접 다운로드한 JSON·CSV·PDF 파일은 유지됩니다.'+(browserCleared?'':' 브라우저 저장소 삭제는 확인하지 못했습니다.');
    $('saveStatus').textContent=enabled?'자동 저장 켜짐':'자동 저장 꺼짐';
  }catch(e){
    if(enabled)autoSave=priorAutoSave;
    const message=!enabled?'이 화면의 자동 저장을 중지했습니다. PC에 남아 있는 작업·로그 삭제와 다음 실행의 설정은 확인하지 못했습니다. 연결을 확인한 뒤 다시 삭제하세요.':'자동 저장 설정을 변경하지 못했습니다. 다시 시도하세요.';
    if($('privacyStatus'))$('privacyStatus').textContent=message;notice(message);$('saveStatus').textContent=autoSave?'저장 설정 확인 필요':'자동 저장 꺼짐';
  }finally{
    if($('rememberWork'))$('rememberWork').checked=autoSave;privacyBusy=false;syncControls();
    if(enabled&&autoSave)persist();
  }
}
if($('privacyBtn'))$('privacyBtn').onclick=()=>$('privacyDialog').showModal();
if($('closePrivacy'))$('closePrivacy').onclick=()=>$('privacyDialog').close();
if($('rememberWork'))$('rememberWork').onchange=()=>changePrivacy($('rememberWork').checked);
if($('clearLocalData'))$('clearLocalData').onclick=()=>changePrivacy(false,true);
const initialization=init();
