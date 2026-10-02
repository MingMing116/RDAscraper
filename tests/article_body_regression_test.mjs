import assert from 'node:assert/strict';
import {JSDOM} from './dom_helpers.mjs';
import {parseArticle,verifyArticle,fetchPage} from '../web/news.mjs';

globalThis.DOMParser=new JSDOM('').window.DOMParser;
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
const title='국산 콩 디지털육종 기술 개발';
const paragraphs=[
  '농촌진흥청 국립농업과학원은 국산 콩 유전체 데이터와 디지털육종 기술을 활용해 품종 선발을 개선했다. 연구진은 지역별 생육 환경과 재배 정보를 함께 분석해 생산성을 높이는 방법을 제시했다.',
  '이번 연구에서는 다양한 콩 자원의 유전자형을 비교하고 병해 저항성과 수량을 확인했다. 현장 실증에 참여한 농업인들은 품종별 특성을 직접 살피고 재배 과정에서 얻은 정보를 연구진에게 전달했다.',
  '연구 결과와 분석 자료는 후속 품종 개발에 활용할 계획이다. 농촌진흥청은 관계 기관과 협력해 검증을 이어가고 농가에서 활용할 수 있도록 재배 안내 자료를 제공하겠다고 밝혔다.'
];
const full=paragraphs.join('\n\n');
const pHTML=paragraphs.map(p=>`<p>${p}</p>`).join('');
const url='https://news.example/article/1';
const portal='https://n.news.naver.com/mnews/article/001/0000000001';
const page=(body,{headline=title,date='2026-06-09',extra=''}={})=>`<html><head><meta property="og:title" content="${headline}"><meta property="article:published_time" content="${date}T10:00:00+09:00"><meta property="og:site_name" content="농업신문">${extra}</head><body>${body}</body></html>`;
const jsonPage=value=>page(`<script type="application/ld+json">${JSON.stringify(value).replaceAll('<','\\u003c')}</script>`);
function reply(pages){const calls=[];globalThis.fetch=async(_request,options)=>{const payload=JSON.parse(options.body);calls.push(payload);const value=pages[payload.url];assert.ok(value,`Unexpected request: ${payload.url}`);return new Response(JSON.stringify(typeof value==='string'?{ok:true,url:payload.url,text:value}:value));};return calls;}

await test('JSON-LD mainEntity, nested graph and paragraph arrays keep the complete body',()=>{
  const r=parseArticle(jsonPage({'@graph':[{'@type':'WebPage',mainEntity:{'@graph':[{'@type':['Thing','https://schema.org/NewsArticle'],headline:title,articleBody:[paragraphs[0],{'@value':paragraphs[1]},paragraphs[2],{unexpected:'must not become object text'}]}]}}]}),url);
  assert.equal(r.body,full);assert.equal(r.bodySource,'JSON-LD');assert.equal(r.bodyLimited,false);assert.equal(r.checked,true);assert.doesNotMatch(r.body,/\[object Object\]/);
});
await test('Structured HTML strips executable and hidden content without losing paragraphs',()=>{
  const r=parseArticle(jsonPage({'@type':'NewsArticle',headline:title,articleBody:`${pHTML}<script>malicious()</script><style>bad css</style><p hidden>HIDDEN TEXT</p>`}),url);
  assert.equal(r.body,full);assert.doesNotMatch(r.body,/malicious|bad css|HIDDEN/);
});
await test('Unrelated JSON-LD recommendation cannot replace current article body or date',()=>{
  const r=parseArticle(page(`<script type="application/ld+json">${JSON.stringify([{'@type':'NewsArticle',headline:'주말 스포츠 경기 결과',datePublished:'2025-01-01',articleBody:'다른 기사 내용입니다. '.repeat(80)},{'@type':'NewsArticle',headline:title,articleBody:paragraphs}])}</script>`),url);
  assert.equal(r.body,full);assert.equal(r.date,'2026-06-09');
});
await test('Every match is cleaned before choosing the body, including repeated selectors',()=>{
  const r=parseArticle(page(`<div class="story-news"><aside>${'광고와 추천 링크 '.repeat(100)}</aside><div class="ad">${'광고 '.repeat(100)}</div></div><div class="story-news">${pHTML}</div>`),url);
  assert.equal(r.body,full);assert.equal(r.bodySource,'.story-news');
});
await test('A long navigation candidate does not hide the readable article',()=>{
  const links=Array.from({length:80},(_,i)=>`<a href="/category/${i}">분야별 주요 뉴스 탐색 ${i}</a>`).join(' ');
  const r=parseArticle(page(`<div class="story-news">${links}</div><div id="news_body">${pHTML}</div>`),url);
  assert.equal(r.body,full);assert.equal(r.bodySource,'#news_body');
});
await test('Unlinked mobile menu text is not article prose',()=>{
  const r=parseArticle(page(`<article>${'홈 뉴스 정치 경제 사회 문화 스포츠 연예 생활 과학 국제 지역 로그인 회원가입 검색 메뉴 '.repeat(8)}</article>`),url);
  assert.equal(r.body,'');assert.equal(r.checked,false);assert.equal(r.bodyLimited,true);
});
await test('Body-specific Korean selectors preserve paragraphs and inline wording',()=>{
  for(const selector of ['id="article_body"','id="articleText"','id="newsBody"','id="newsEndContents"','id="CmAdContent"','class="view_con"','class="article_body_content"']){
    const r=parseArticle(page(`<div ${selector}><p>${paragraphs[0].replace('디지털육종','디지털<strong>육종</strong>')}</p><div>${paragraphs[1]}</div><p>${paragraphs[2]}</p></div>`),url);
    assert.equal(r.body,full,selector);
  }
});
await test('A complete DOM body wins over a truncated structured teaser',()=>{
  const r=parseArticle(page(`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',headline:title,articleBody:paragraphs[0]})}</script><div class="article_view">${pHTML}</div>`),url);
  assert.equal(r.body,full);assert.equal(r.bodyLimited,false);
});
await test('Complete structured body wins over a DOM preview without adding duplicate text',()=>{
  const r=parseArticle(page(`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',headline:title,articleBody:paragraphs})}</script><article><p>${paragraphs[0]}</p></article>`),url);
  assert.equal(r.body,full);assert.equal(r.bodySource,'JSON-LD');
});
await test('Image-only and empty articles have explicit incomplete-content notes',()=>{
  const r=parseArticle(page('<article><figure><img src="/report.jpg"><figcaption>보도 내용 이미지</figcaption></figure></article>'),url);
  assert.equal(r.body,'');assert.equal(r.checked,false);assert.equal(r.bodyLimited,true);assert.match(r.fetchNote,/이미지|영상/);
  const empty=parseArticle(page('<article></article>'),url);assert.equal(empty.bodyLimited,true);assert.match(empty.fetchNote,/확보하지 못/);
});
await test('A login gate with article metadata is not accepted as article content',()=>{
  const r=parseArticle(page(`<article><p>로그인 후 전체 기사를 확인하실 수 있습니다. ${'회원가입과 구독 서비스를 이용해 주세요. '.repeat(8)}</p><form>사용자 이름과 비밀번호</form></article>`),url);
  assert.equal(r.body,'');assert.equal(r.checked,false);assert.equal(r.bodyLimited,true);assert.match(r.fetchNote,/로그인|접근 제한/);
});
await test('A challenge page cannot be verified even when wrapped in article markup',()=>{
  const r=parseArticle(page(`<article>${'Please wait while we check your browser and verify you are human. '.repeat(8)}</article>`,{headline:'Just a moment...'}),url);
  assert.equal(r.body,'');assert.equal(r.checked,false);assert.equal(r.bodyLimited,true);
});
await test('An article about login security is not mistaken for the login page',()=>{
  const r=parseArticle(page(`<article>${pHTML}</article>`,{headline:'로그인 보안을 강화한 농업 데이터 서비스'}),url);
  assert.equal(r.body,full);assert.equal(r.checked,true);
});
await test('Subscription previews keep only real paragraphs and remain marked incomplete',()=>{
  const r=parseArticle(page(`<article>${pHTML}<div class="paywall">로그인 후 전체 기사를 확인하세요.</div></article>`),url);
  assert.equal(r.body,full);assert.equal(r.checked,true);assert.equal(r.bodyLimited,true);assert.match(r.fetchNote,/열람 제한/);
});
await test('Access instructions phrased as an article-reading requirement stay unverified',()=>{
  const r=parseArticle(page('<article>이 기사를 읽으시려면 로그인이 필요합니다. 회원가입을 하시면 뉴스와 다양한 정보를 만나실 수 있습니다. 회원 계정으로 로그인하거나 새로운 계정을 만들어 서비스를 이용해주세요. 회원 가입은 무료이며 모든 콘텐츠를 즐길 수 있습니다.</article>'),url);
  assert.equal(r.body,'');assert.equal(r.checked,false);assert.equal(r.bodyLimited,true);assert.match(r.fetchNote,/로그인|접근 제한/);
});
await test('Hidden roots, hidden ancestors and related article descendants cannot supply a body',()=>{
  for(const html of [`<div class="article_body" style="display:none">${pHTML}</div>`,`<div hidden><article>${pHTML}</article></div>`,`<aside><article>${pHTML}</article></aside>`,`<div class="related"><article>${pHTML}</article></div>`]){
    const r=parseArticle(page(html),url);assert.equal(r.body,'');assert.equal(r.checked,false);assert.equal(r.bodyLimited,true);
  }
});
await test('Structured bodies retain paywall evidence instead of claiming a complete preview',()=>{
  const r=parseArticle(jsonPage({'@type':'NewsArticle',headline:title,articleBody:`${pHTML}<div class="paywall">로그인 후 전체 기사를 확인하세요.</div>`}),url);
  assert.equal(r.body,full);assert.equal(r.bodyLimited,true);assert.match(r.fetchNote,/열람 제한/);
});
await test('Subheadings, line breaks, entities and table cells remain readable',()=>{
  const r=parseArticle(page(`<article><h2>연구 &amp; 현장</h2><p>${paragraphs[0]}<br>${paragraphs[1]}</p><table><tr><th>품종</th><th>수량</th></tr><tr><td>국산 콩</td><td>100</td></tr></table><p>${paragraphs[2]}</p></article>`),url);
  assert.match(r.body,/연구 & 현장/);assert.ok(r.body.includes(paragraphs[0]+'\n\n'+paragraphs[1]));assert.match(r.body,/품종 수량/);assert.match(r.body,/국산 콩 100/);assert.ok(r.body.endsWith(paragraphs[2]));
});
await test('A title/date/url lookalike cannot cause unsafe original links or canonical changes',()=>{
  const r=parseArticle(page(`<article>${pHTML}</article><a class="media_end_head_origin_link" href="javascript:alert(1)">기사원문</a>`,{extra:'<link rel="canonical" href="https://wrong.example/other">'}),url);
  assert.equal(r.url,url);assert.equal(r.origin,'');assert.equal(r.date,'2026-06-09');
});
await test('A blocked origin is recovered from the known matching portal, including refresh',async()=>{
  const calls=reply({[url]:{ok:false,status:403,error:'HTTP 403'},[portal]:page(`<div id="dic_area">${pHTML}</div>`)});
  const r=await verifyArticle({title,url,portalURL:portal,date:'2026-06-08'},'token',undefined,{refresh:true});
  assert.equal(r.body,full);assert.equal(r.checked,true);assert.equal(r.bodyLimited,false);assert.equal(r.url,portal);assert.equal(r.fetchNote,'');assert.equal(r.date,'2026-06-09');assert.equal(r.dateDifference,true);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.refresh===true));
});
await test('A missing publisher body can use a matching portal and clear stale errors',async()=>{
  reply({[url]:page('<article></article>'),[portal]:page(`<div id="dic_area">${pHTML}</div>`)});
  const r=await verifyArticle({title,url,portalURL:portal,bodyLimited:true,fetchNote:'HTTP 403',linkMismatch:true,observedTitle:'이전 오류'},'token');
  assert.equal(r.body,full);assert.equal(r.linkMismatch,false);assert.equal(r.observedTitle,undefined);assert.equal(r.fetchNote,'');
});
await test('Matching portal recovery retains the publication date already recovered from the publisher',async()=>{
  const noDate=`<meta property="og:title" content="${title}"><div id="dic_area">${pHTML}</div>`;
  reply({[url]:page(`<article><p>${paragraphs[0]}</p></article>`),[portal]:noDate});
  const r=await verifyArticle({title,url,portalURL:portal,date:'2026-06-08'},'token');
  assert.equal(r.body,full);assert.equal(r.date,'2026-06-09');assert.equal(r.dateSource,'원문 게시일');assert.equal(r.dateDifference,true);assert.equal(r.media,'농업신문');
});
await test('An unrelated portal fallback never supplies article text or metadata',async()=>{
  reply({[url]:{ok:false,status:403,error:'HTTP 403'},[portal]:page(`<article>${pHTML}</article>`,{headline:'산업은행 임원 인사 공고',date:'2025-01-01'})});
  const r=await verifyArticle({title,url,portalURL:portal,date:'2026-06-08'},'token');
  assert.equal(r.checked,false);assert.equal(r.title,title);assert.equal(r.date,'2026-06-08');assert.equal(r.body,undefined);assert.equal(r.linkMismatch,true);
});
await test('An explicit original recovers full text and keeps original date/source evidence',async()=>{
  reply({[portal]:page(`<article><p>${paragraphs[0]}</p></article><a href="${url}">기사원문</a>`,{date:'2026-06-10'}),[url]:page(`<div class="story-news">${pHTML}</div>`)});
  const r=await verifyArticle({title,url:portal,date:'2026-06-08'},'token');
  assert.equal(r.body,full);assert.equal(r.url,url);assert.equal(r.portalURL,portal);assert.equal(r.date,'2026-06-09');assert.equal(r.dateSource,'원문 게시일');assert.equal(r.dateDifference,true);
});
await test('A shorter original preview does not replace complete portal paragraphs',async()=>{
  reply({[portal]:page(`<article>${pHTML}</article><a href="${url}">기사원문</a>`),[url]:page(`<article><p>${paragraphs[0]}</p><div class="paywall">로그인 후 전체 기사를 확인하세요.</div></article>`)});
  const r=await verifyArticle({title,url:portal},'token');assert.equal(r.body,full);assert.equal(r.bodyLimited,false);assert.equal(r.url,portal);
});
await test('An unrelated linked original is ignored without losing valid portal content',async()=>{
  reply({[portal]:page(`<article>${pHTML}</article><a href="${url}">기사원문</a>`),[url]:page(`<article>${'다른 기사 내용 '.repeat(100)}</article>`,{headline:'산업은행 임원 인사 공고'})});
  const r=await verifyArticle({title,url:portal},'token');assert.equal(r.body,full);assert.equal(r.url,portal);assert.equal(r.linkMismatch,false);
});
await test('Unsafe fallback URLs are never sent to fetch and old text survives an empty response',async()=>{
  const calls=reply({[url]:page('<article></article>')});
  const r=await verifyArticle({title,url,portalURL:'javascript:alert(1)',origin:'https://name:password@news.example/private',body:paragraphs[0]},'token');
  assert.equal(calls.length,1);assert.equal(r.body,paragraphs[0]);assert.equal(r.bodyLimited,true);
});
await test('Fallback requests keep cancellation behavior',async()=>{
  const controller=new AbortController();let calls=0;
  globalThis.fetch=async(_request,options)=>{calls++;if(calls===1)return new Response(JSON.stringify({ok:false,status:403,error:'HTTP 403'}));controller.abort();assert.equal(options.signal.aborted,true);throw new DOMException('Aborted','AbortError');};
  await assert.rejects(()=>verifyArticle({title,url,portalURL:portal},'token',controller.signal),{name:'AbortError'});assert.equal(calls,2);
});
await test('Direct fetch refresh is opt-in and remains backward compatible',async()=>{
  const calls=reply({[url]:page(`<article>${pHTML}</article>`)});
  await fetchPage(url,'token');await fetchPage(url,'token',undefined,{refresh:true});assert.equal(calls[0].refresh,undefined);assert.equal(calls[1].refresh,true);
});
console.log(`TOTAL ${count} PASS`);
