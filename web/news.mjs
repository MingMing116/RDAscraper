import {clean,safeURL,canonicalURL,parseDate,plusDays,today,titleSimilarity} from './core.mjs';
const parser=()=>new DOMParser();
export async function fetchPage(url,token,signal,{refresh=false}={}){
  const request=new AbortController();const abort=()=>request.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)request.abort();let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;request.abort();},20000);
  try{const res=await fetch('/api/fetch',{method:'POST',headers:{'Content-Type':'application/json','X-RDA-Token':token},body:JSON.stringify({url,...(refresh?{refresh:true}:{})}),signal:request.signal});
    if(!res.ok)throw Error('프로그램 연결 오류 '+res.status);
    const d=await res.json();if(!d.ok){const e=Error(d.error||'응답을 읽지 못했습니다.');e.status=d.status||(/\b(403|429)\b/.exec(e.message)?.[1]);throw e;}return d;
  }catch(e){if(timedOut&&!signal?.aborted)throw Error('응답 시간 초과(20초)');throw e;}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
export function searchURL(source,q,start,end){
  if(source==='google')return 'https://news.google.com/rss/search?'+new URLSearchParams({q:q+' after:'+plusDays(start,-1)+' before:'+plusDays(end,1),hl:'ko',gl:'KR',ceid:'KR:ko'});
  if(source==='bing')return 'https://www.bing.com/news/search?'+new URLSearchParams({q:q,format:'rss',setlang:'ko-KR'});
  if(source==='naver')return 'https://search.naver.com/search.naver?'+new URLSearchParams({where:'news',query:q,sort:'0',pd:'3',ds:start.replaceAll('-','.'),de:end.replaceAll('-','.'),nso:'so:r,p:from'+start.replaceAll('-','')+'to'+end.replaceAll('-','')+',a:all'});
  if(source==='daum')return 'https://search.daum.net/search?'+new URLSearchParams({w:'news',q:q,period:'u',sd:start.replaceAll('-','')+'000000',ed:end.replaceAll('-','')+'235959'});
  throw Error('지원하지 않는 검색원');
}
export const SOURCES={naver:'네이버 뉴스',google:'Google News',daum:'다음 뉴스',bing:'Bing News'};
const textOnly=s=>{const d=parser().parseFromString(s||'','text/html');d.querySelectorAll('script,style').forEach(x=>x.remove());return clean(d.body.textContent);};
export function parseRSS(xml,source,q){
  const d=parser().parseFromString(xml,'text/xml');if(d.querySelector('parsererror'))throw Error('RSS 응답 형식이 변경됐습니다.');
  return [...d.querySelectorAll('item')].slice(0,30).flatMap(item=>{
    const t=name=>item.querySelector(name)?.textContent||'';
    let title=textOnly(t('title')),url=safeURL(t('link')),media=textOnly(t('source'));
    if(!media)media=[...item.children].find(n=>/source/i.test(n.localName)&&n.localName!=='resource')?.textContent||'';
    if(media&&title.endsWith(' - '+media))title=title.slice(0,-media.length-3);
    if(!url||!title)return [];
    if(source==='bing'){const target=new URL(url).searchParams.get('url');if(target&&safeURL(target))url=safeURL(target);}
    return [{title,url,media:clean(media),snippet:textOnly(t('description')).replace(title,'').trim().slice(0,600),date:parseDate(t('pubDate')),dateSource:'검색원 게시일',source:SOURCES[source],query:q,checked:false}];
  });
}
const articleLabel=node=>clean(node?.textContent||'').replace(/새\s*창\s*열림/g,'').replace(/\s+/g,' ').trim();
export function parseNewsHTML(html,source,q,base){
  const d=parser().parseFromString(html,'text/html');
  const titleSelector=source==='naver'?'a.news_tit,a[data-heatmap-target=".tit"],a[data-heatmap-target="tit"],a[data-heatmap-target="title"]':'.tit-g a,a.tit-g,a.tit_main,a[data-tiara-layer="title"]';
  const anchors=[...d.querySelectorAll(titleSelector)];
  return anchors.slice(0,60).flatMap(a=>{
    const title=clean(a.getAttribute('title')||articleLabel(a)),url=safeURL(a.getAttribute('href'),base);
    if(!title||title.length<6||!url||new URL(url).hostname.startsWith('search.'))return [];
    let card;
    if(source==='naver'){
      const group=a.closest('.fds-news-item-list-tab');
      if(group&&group.querySelector(titleSelector)===a)card=group;
      else {card=a.parentElement;while(card?.parentElement&&card.parentElement.querySelectorAll(titleSelector).length===1)card=card.parentElement;}
      card=card||a.closest('.news_wrap,.news_area,li');
    }else card=a.closest('li[data-docid],li')||a.closest('.c-item');
    const mediaNode=card?.querySelector(source==='naver'?'.sds-comps-profile-info-title-text,.info.press,.press':'.item-writer .tit_item,.info_cp,.txt_cp');
    const media=articleLabel(mediaNode).replace(/언론사\s*선정|네이버뉴스/g,'').trim();
    const bodyLinks=[...(card?.querySelectorAll('a[data-heatmap-target=".body"]')||[])];
    const bodyLink=bodyLinks.find(x=>canonicalURL(safeURL(x.getAttribute('href'),base))===canonicalURL(url));
    const snippet=articleLabel(bodyLink||card?.querySelector(source==='naver'?'.news_dsc,.dsc_wrap':'.conts-desc,.item-contents .desc')).slice(0,700);
    const times=[...(card?.querySelectorAll('time,.sds-comps-profile-info-subtext,.info,.gem-subinfo .txt_info,.date')||[])];
    const rawDate=times.map(x=>x.getAttribute('datetime')||articleLabel(x)).find(x=>parseDate(x))||'';
    const portalURL=safeURL(card?.querySelector('a[data-heatmap-target=".nav"]')?.getAttribute('href'),base);
    return [{title,url,media,snippet,date:parseDate(rawDate),dateSource:rawDate?'검색 목록 게시일':'',portalURL,source:SOURCES[source],query:q,checked:false}];
  });
}
// Publishers nest Article nodes under @graph, mainEntity and other JSON-LD objects.
// Only strings (or explicit JSON-LD text values) are article text; never stringify objects.
function jsonNodes(value,out=[]){
  if(!value||typeof value!=='object')return out;
  if(Array.isArray(value)){value.forEach(v=>jsonNodes(v,out));return out;}
  if([value['@type']].flat().some(t=>typeof t==='string'&&/(?:^|[/#])(?:Article|NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|BlogPosting)$/.test(t)))out.push(value);
  for(const [key,v] of Object.entries(value))if(key!=='articleBody')jsonNodes(v,out);
  return out;
}
const scalarText=value=>typeof value==='string'?clean(value):'';
const DAUM_BODY_SELECTORS=['#harmonyContainer','.news_view .article_view','.news_view'];
const BODY_SELECTORS=['.story-news','.news_txt.ck-content','#dic_area','#articleBodyContents','#articeBody','#articleBody','#article_body','#articleText','#article_txt','#article_content','#news_body','#newsBody','#newsEndContents','#CmAdContent','#article-view-content-div','[itemprop="articleBody"]','.article-body','.article_body','.article_body_content','.article-content','.article_content','.article-contents','.article_txt','.article_view','.news_body','.news-text','.newsct_article','.news_view','.view_con','.view_cont','.view_content','.view_text','.entry-content','article'];
const BODY_NOISE='script,style,noscript,template,nav,header,footer,aside,iframe,button,form,input,select,textarea,svg,h1,figure,figcaption,[hidden],[aria-hidden="true"],[role="navigation"],[role="dialog"],.ad,.ads,.advert,.advertisement,.adsbygoogle,.ad_wrap,.ad-wrap,.adbox,.ad_box,.ad-area,.ad_area,.article-ad,.article_ad,.related,.related-news,.related_news,.related-articles,.recommend,.recommendation,.popular-news,.ranking,.copyright,.txt-copyright,.share,.sns,.social,.comment,.comments,.reporter-profile,.reporter_area,.byline,.caption,.caption-con,.photo-caption,.img_caption,.adrs,.banner,.banner_render,.dablewidget,.paywall,.subscription,.login-box';
// Daum's outer <article> also contains reading controls and a recommendation feed.
// Remove those UI containers, never individual words such as 남성, 여성 or 닫기.
const DAUM_BODY_NOISE='.head_view,.info_view,.util_view,.layer_util,.layer_tts,.tts_player,.tts_setting,.voice_setting,.layer_translate,.layer_font,.layer_fontsize,.layer_font_size,.layer_summary,.box_summary,.summary_view,.box_util,.list_relate,.list_related,.news_related,.relate_news,.box_relate,.box_related,.box_recommend,.list_news,.cp_view,.link_copyright,.txt_copyright,.view_notice,[data-tiara-layer="tts"],[data-tiara-layer="font"],[data-tiara-layer="translate"],[data-tiara-layer="related"]';
const AUTO_SUMMARY_NOTICE=/자동요약\s*기사\s*제목과\s*주요\s*문장을\s*기반으로\s*자동요약한\s*결과입니다\.?\s*(?:전체\s*맥락을\s*이해하기\s*위해서는\s*본문\s*보기를\s*권장합니다\.?)?/;
// Old saved projects may already contain text flattened from an entire UI panel.
// These complete control signatures provide evidence; isolated vocabulary does not.
export function cleanReviewSnippet(value){
  let text=clean(value),hadControls=false;
  const summary=AUTO_SUMMARY_NOTICE.exec(text);
  if(summary){text=text.slice(summary.index+summary[0].length);hadControls=true;}
  const panels=[
    /음성\s*재생\s*설정\s*이동\s*통신망에서\s*음성\s*재생\s*시\s*데이터\s*요금이\s*발생할\s*수\s*있습니다\.[\s\S]{0,600}?남성\s*여성\s*느림\s*보통\s*빠름\s*닫기/g,
    /번역\s*beta\s*Translated\s+by\s+kaka\s*o?\s*i\s*닫기/gi,
    /글자\s*크기\s*설정\s*파란원을\s*좌우로\s*움직이시면\s*글자\s*크기가\s*변경\s*됩니다\.[\s\S]{0,1400}?이\s*글자\s*크기로\s*변경됩니다\.[\s\S]{0,800}?닫기/g
  ];
  for(const pattern of panels)text=text.replace(pattern,()=>{hadControls=true;return '';});
  if(hadControls)text=text.replace(/(?:^|\s)닫기\s*$/,'');
  return clean(text);
}
function daumPage(url){try{return /^(?:v|news|news\.v|media)\.daum\.net$/i.test(new URL(url).hostname);}catch{return false;}}
function removeArticleControls(root){
  // Apply signature detection only to a control-like wrapper. A prose paragraph
  // describing speech playback or gender differences remains article content.
  for(const el of [...root.querySelectorAll('div,section,ul,dl')].reverse()){
    const identity=(el.id+' '+el.className).toLowerCase();
    if(!/(?:layer|popup|control|util|setting|option|tts|voice|font|translate|summary)/.test(identity))continue;
    const value=clean(el.textContent);if(value.length>2400)continue;
    const tts=/음성\s*재생\s*설정/.test(value)&&/남성\s*여성/.test(value)&&/느림\s*보통\s*빠름/.test(value);
    const font=/글자\s*크기\s*설정/.test(value)&&/매우\s*작은\s*폰트/.test(value)&&/매우\s*큰\s*폰트/.test(value);
    const summary=AUTO_SUMMARY_NOTICE.test(value);
    const translate=/번역\s*beta\s*Translated\s+by/i.test(value);
    if(tts||font||summary||translate)el.remove();
  }
}
const ACCESS_MESSAGE=/(?:로그인(?:을|이)?\s*(?:하|해|후|필요)|로그인\s*(?:또는|및)\s*(?:회원가입|구독)|회원(?:가입|\s*전용)|구독(?:자|\s*후|\s*하시면)|접근(?:이|을)?\s*(?:제한|차단)|요청(?:이|을)?\s*차단|보안\s*(?:문자|확인)|자동(?:입력|화된\s*접근)|access denied|verify (?:that )?you are human|checking your browser|enable javascript(?: and cookies)?|just a moment|captcha|sign in to (?:read|continue)|subscribe to (?:read|continue)|subscriber.only)/i;
const ACCESS_TITLE=/^(?:(?:(?:회원\s*)?로그인|회원가입)(?:\s*[-|:–]\s*.{0,80})?$|접근\s*(?:거부|제한)|서비스\s*접근\s*제한|보안\s*확인|access denied|forbidden|just a moment|verify (?:that )?you are human|sign in|log in)(?:[\s!:.|–-]|$)/i;
const ACCESS_INSTRUCTION=/^(?:please\s+)?(?:(?:이|해당)\s*(?:기사|콘텐츠|서비스)(?:를|는|은|의)?\s*)?(?:읽으시려면|이용하려면|열람하려면|서비스\s*이용을\s*위해|(?:계속|전체|전문|기사|본문)\s*(?:읽기|보기|내용|확인|열람)|(?:로그인|회원가입|구독)|access denied|verify (?:that )?you are human|checking your browser|enable javascript|just a moment|sign in|subscribe)/i;
function paragraphText(node){
  const walk=n=>{
    if(n.nodeType===3)return n.nodeValue.replace(/[\t\r\n ]+/g,' ');
    if(n.nodeType!==1)return '';
    if(n.tagName==='BR')return '\n';
    if(n.tagName==='PRE')return '\n\n'+n.textContent+'\n\n';
    const text=[...n.childNodes].map(walk).join('');
    if(/^(?:TD|TH)$/.test(n.tagName))return text+' ';
    return /^(?:P|DIV|SECTION|ARTICLE|BLOCKQUOTE|H[2-6]|LI|UL|OL|TABLE|TR)$/.test(n.tagName)?'\n\n'+text+'\n\n':text;
  };
  // Text-only bodies sometimes use literal newlines rather than paragraph tags.
  return clean([...node.children].length?walk(node):node.textContent).split('\n').map(line=>line.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
function tidyBody(text){
  return clean(text).split('\n').filter(line=>!/^\s*(?:[©ⓒ]|copyright\b|무단.{0,12}(?:전재|복제)|재배포\s*금지)/i.test(line)).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
const NAVIGATION_WORDS=new Set('홈 뉴스 정치 경제 사회 문화 스포츠 연예 생활 과학 국제 지역 전체기사 로그인 회원가입 검색 메뉴 종합 오피니언 포토 영상 주요뉴스 많이본뉴스 구독 신문 이전 다음 전체 메뉴닫기 메뉴열기'.split(' '));
function navigationOnly(text){
  const words=text.split(/[\s|>·/]+/).filter(Boolean);
  return words.length>=4&&words.every(word=>NAVIGATION_WORDS.has(word));
}
function readBody(node,source,{daum=false}={}){
  // A matching descendant can otherwise escape a hidden/ad/paywall ancestor.
  const noise=BODY_NOISE+(daum?','+DAUM_BODY_NOISE:'');
  for(let el=node;el;el=el.parentElement)if(el.matches?.(noise)||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i.test(el.getAttribute?.('style')||''))return {body:'',source,score:0,restricted:!!el.matches?.('.paywall,.subscription,.login-box'),hasImage:false};
  const copy=node.cloneNode(true);
  // Record restricted/visual content before removing controls and captions.
  const hasImage=!!copy.querySelector('img,picture,video');
  const restricted=!!copy.querySelector('.paywall,.subscription,.login-box')||[copy,...copy.querySelectorAll('p,div,span')].some(el=>{const t=clean(el.textContent);return t.length<600&&ACCESS_INSTRUCTION.test(t)&&ACCESS_MESSAGE.test(t);});
  removeArticleControls(copy);
  copy.querySelectorAll(noise).forEach(el=>el.remove());
  copy.querySelectorAll('[style]').forEach(el=>{if(/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i.test(el.getAttribute('style')))el.remove();});
  let body=tidyBody(paragraphText(copy));
  body=body.split(/\n+/).filter(line=>!navigationOnly(line)&&!(line.length<600&&ACCESS_INSTRUCTION.test(line)&&ACCESS_MESSAGE.test(line))).join('\n\n');
  const linkText=[...copy.querySelectorAll('a')].reduce((n,a)=>n+clean(a.textContent).length,0),linkDensity=linkText/Math.max(1,body.length);
  const paragraphs=body.split(/\n+/).filter(p=>p.length>=60).length;
  // A list of links or an access challenge is not a recovered article.
  if(linkDensity>.5||(!paragraphs&&linkDensity>.25)||(!paragraphs&&ACCESS_MESSAGE.test(body)))body='';
  const score=body.length*Math.pow(1-Math.min(1,linkDensity),2)*(source==='article'?.85:1)+paragraphs*35;
  return {body,source,score,restricted,hasImage};
}
function structuredBody(value){
  const empty={body:'',restricted:false,hasImage:false};
  if(Array.isArray(value)){
    const parts=value.map(structuredBody);
    return {body:parts.map(p=>p.body).filter(Boolean).join('\n\n'),restricted:parts.some(p=>p.restricted),hasImage:parts.some(p=>p.hasImage)};
  }
  if(value&&typeof value==='object')return typeof value['@value']==='string'?structuredBody(value['@value']):empty;
  if(typeof value!=='string')return empty;
  const doc=parser().parseFromString(value,'text/html');
  return readBody(doc.body,'JSON-LD');
}
export function parseArticle(html,url){
  const doc=parser().parseFromString(html,'text/html'),meta=(...keys)=>{for(const k of keys){const n=[...doc.querySelectorAll('meta')].find(x=>x.getAttribute('property')===k||x.getAttribute('name')===k);if(n?.content)return clean(n.content);}return '';};
  const js=[];doc.querySelectorAll('script[type="application/ld+json"]').forEach(s=>{try{jsonNodes(JSON.parse(s.textContent),js);}catch{}});
  const pageTitle=meta('og:title','twitter:title')||clean(doc.querySelector('h1')?.textContent)||clean(doc.title);
  const article=js.map(node=>({node,agreement:pageTitle?titleSimilarity(pageTitle,scalarText(node.headline)):1})).filter(x=>!pageTitle||x.agreement>=.28||!x.node.headline).sort((a,b)=>b.agreement-a.agreement)[0]?.node||{};
  let title=pageTitle||scalarText(article.headline);
  const h1=clean(doc.querySelector('h1')?.textContent);if(h1&&titleSimilarity(h1,title)>.5)title=h1;
  const media=meta('og:site_name')||scalarText(article.publisher?.name)||'';
  let rawDate=meta('article:published_time','og:article:published_time','datePublished','pubdate','publishdate','date','DC.date.issued')||scalarText(article.datePublished)||doc.querySelector('time[datetime]')?.getAttribute('datetime')||doc.querySelector('[data-date-time]')?.getAttribute('data-date-time')||'';
  // Read publication labels, not modification/footer/URL dates.
  if(!rawDate){
    const known=doc.querySelector('.info_view .num_date,.date_published,.publish-date,.date-public,.media_end_head_info_datestamp_time');
    if(known)rawDate=known.getAttribute('data-date-time')||known.getAttribute('datetime')||known.textContent;
  }
  if(!rawDate){for(const el of doc.querySelectorAll('time,pre,span,p,li')){
    const value=clean(el.textContent);if(value.length>170||!/(?:입력|등록|게재|송고)/.test(value))continue;
    const match=value.match(/(?:입력|등록|게재|송고)\s*[:：]?\s*(20\d{2}\s*[.년/\-]\s*\d{1,2}\s*[.월/\-]\s*\d{1,2}(?:[^\n]*?))(?=수정|$)/);
    if(match&&parseDate(match[1])){rawDate=match[1];break;}
  }}
  const date=parseDate(rawDate),bodies=[],seen=new Set(),daum=daumPage(url);
  const selectors=daum?[...DAUM_BODY_SELECTORS,...BODY_SELECTORS]:BODY_SELECTORS;
  for(const selector of selectors)for(const node of doc.querySelectorAll(selector))if(!seen.has(node)){
    seen.add(node);bodies.push({...readBody(node,selector,{daum}),priority:daum?DAUM_BODY_SELECTORS.indexOf(selector):-1});
  }
  const jsonBody=structuredBody(article.articleBody);
  if(article.articleBody)bodies.push({...jsonBody,source:'JSON-LD',score:jsonBody.body.length+jsonBody.body.split(/\n+/).filter(p=>p.length>=60).length*35});
  // Specific Daum article roots are authoritative even when a surrounding
  // container is longer. An image-only core must not fall back to UI prose.
  const cores=daum?bodies.filter(x=>x.priority>=0):[];
  const corePriority=cores.length?Math.min(...cores.map(x=>x.priority)):-1;
  const eligible=corePriority>=0?cores.filter(x=>x.priority===corePriority):bodies;
  const best=eligible.filter(x=>x.body).sort((a,b)=>b.score-a.score)[0];
  let body=best?.body||'',bodySource=best?.source||'';
  const blocked=ACCESS_TITLE.test(title);
  if(blocked){body='';bodySource='';}
  const limited=body.length<200||!!best?.restricted||((body.match(/�/g)||[]).length>Math.max(3,body.length*.005));
  let fetchNote='';
  if(!body)fetchNote=blocked||bodies.some(x=>x.restricted)?'로그인·접근 제한으로 원문 본문을 확보하지 못했습니다.':bodies.some(x=>x.hasImage)?'이미지·영상 중심 기사: 텍스트 본문을 확보하지 못했습니다. 원문을 확인하세요.':'원문 본문을 확보하지 못했습니다. 원문을 확인하세요.';
  else if(best?.restricted)fetchNote='열람 제한으로 본문 일부만 확보했습니다. 원문을 확인하세요.';
  else if(limited)fetchNote=(body.match(/�/g)||[]).length>3?'본문에 깨진 문자가 있습니다. 원문을 확인하세요.':'본문 일부만 확보했습니다. 원문을 확인하세요.';
  let snippet=cleanReviewSnippet(meta('og:description','description'))||body.split(/(?<=[.!?])\s+/).slice(0,2).join(' ').slice(0,360);
  if(/동영상\s*(재생|플레이어)|재생시간|무단전재|로그인|쿠키|copyright/i.test(snippet)&&body)snippet=body.slice(0,350);
  const canonical=safeURL(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),url);
  if(canonical&&safeURL(url)&&new URL(canonical).hostname===new URL(url).hostname&&new URL(canonical).pathname!=='/')url=canonical;
  const originAnchor=[...doc.querySelectorAll('a[href]')].find(a=>/^(기사원문|원문보기|언론사 원문|기사 원문)$/.test(clean(a.textContent))||a.classList.contains('media_end_head_origin_link'));
  const origin=originAnchor?safeURL(originAnchor.getAttribute('href'),url):'';
  return {title,url,media,body,snippet,date,dateSource:date?'원문 게시일':'',origin,bodyLimited:limited,bodySource,fetchNote,checked:Boolean(title&&body.length>=80)};
}
export async function verifyArticle(candidate,token,signal,{refresh=false}={}){
  candidate={...candidate};delete candidate.included;
  const primaryURL=safeURL(candidate.url);
  if(!primaryURL)return {...candidate,checked:false,bodyLimited:true,fetchNote:'올바른 원문 주소가 아닙니다.'};
  if(new URL(primaryURL).hostname==='news.google.com')return {...candidate,checked:false,bodyLimited:true,fetchNote:'검색원 중간 링크 · 원문 확인 필요'};
  const visited=new Set(),queue=[{url:primaryURL,kind:'primary'}];
  // Fallbacks are URLs already associated with this result, never guessed articles.
  for(const [kind,value] of [['portal',candidate.portalURL],['origin',candidate.origin]]){const url=safeURL(value,primaryURL);if(url)queue.push({url,kind});}
  let best=null,lastError='',mismatch='',recoveredDate='',recoveredDateSource='',recoveredMedia='';
  while(queue.length&&visited.size<4){
    const next=queue.shift(),key=canonicalURL(next.url);
    if(!key||visited.has(key)||new URL(next.url).hostname==='news.google.com')continue;
    visited.add(key);
    try{
      const page=await fetchPage(next.url,token,signal,{refresh}),pageURL=safeURL(page.url,next.url);
      if(!pageURL){lastError='올바른 원문 응답 주소가 아닙니다.';continue;}
      const meta=parseArticle(page.text,pageURL);
      if(!meta.title){lastError='원문 제목 추출 실패';continue;}
      const expected=candidate.title||best?.title||'';
      const threshold=next.kind==='primary'?.28:.55;
      if(expected&&titleSimilarity(expected,meta.title)<threshold){mismatch=meta.title;continue;}
      // A fallback without a title to compare cannot establish article identity.
      if(next.kind!=='primary'&&!expected)continue;
      if(meta.date&&(!recoveredDate||next.kind==='origin')){recoveredDate=meta.date;recoveredDateSource=meta.dateSource;}
      if(meta.media&&!recoveredMedia)recoveredMedia=meta.media;
      if(meta.origin&&canonicalURL(meta.origin)!==key)queue.push({url:meta.origin,kind:'origin'});
      if(!best||(!meta.bodyLimited&&best.bodyLimited)||(meta.bodyLimited===best.bodyLimited&&meta.body.length>best.body.length))best={...meta,kind:next.kind};
      // A full primary article needs only its explicitly linked origin, if any.
      if(next.kind==='primary'&&!meta.bodyLimited&&meta.checked){for(let i=queue.length-1;i>=0;i--)if(queue[i].kind==='portal')queue.splice(i,1);}
    }catch(e){if(e.name==='AbortError')throw e;lastError=e.message;}
  }
  if(!best)return {...candidate,checked:false,bodyLimited:true,...(mismatch?{linkMismatch:true,observedTitle:mismatch}:{}),fetchNote:mismatch?'원문 제목이 검색 제목과 다름':lastError||'원문 본문을 확보하지 못했습니다.'};
  const {kind,...meta}=best;
  // Keep previously recovered text when a later request only returns an empty shell.
  if(!meta.body&&candidate.body){meta.body=candidate.body;meta.bodyLimited=true;}
  const result={...candidate,...meta,media:meta.media||recoveredMedia||candidate.media,date:recoveredDate||candidate.date,dateSource:recoveredDateSource||candidate.dateSource,originalSearchTitle:candidate.originalSearchTitle||candidate.title,searchDate:candidate.searchDate||candidate.date,dateDifference:!!(recoveredDate&&(candidate.searchDate||candidate.date)&&recoveredDate!==(candidate.searchDate||candidate.date)),linkMismatch:false};
  delete result.observedTitle;
  if(kind==='origin')result.portalURL=candidate.portalURL||primaryURL;
  if(kind==='portal')result.portalURL=meta.url;
  return result;
}
export async function pool(items,workers,fn,signal){let index=0;const run=async()=>{while(index<items.length&&!signal?.aborted){const i=index++;await fn(items[i],i);}};await Promise.all(Array.from({length:Math.min(workers,items.length)},run));}
