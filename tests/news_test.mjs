import assert from 'node:assert/strict';
import {JSDOM} from './dom_helpers.mjs';
import {parseNewsHTML,parseArticle,parseRSS,verifyArticle,fetchPage,searchURL,pool} from '../web/news.mjs';
import {buildQueries,assess,parseDate} from '../web/core.mjs';
globalThis.DOMParser=new JSDOM('').window.DOMParser;
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
const full='농촌진흥청 국립농업과학원은 국산 콩 유전체 데이터와 디지털육종 기술을 활용해 품종 선발을 개선했다. '.repeat(5);
const title='국산 콩 디지털육종 기술 개발';
const article=(t=title,date='2026-06-09')=>`<meta property="og:title" content="${t}"><meta property="article:published_time" content="${date}T10:00:00+09:00"><meta property="og:site_name" content="농업신문"><div class="story-news"><p>${full}</p><figure>광고 캡션</figure><div class="copyright">무단 전재 금지</div></div>`;
await test('NAVER current card: title/date/body/media belong to same item',()=>{
 const html=`<div class="fds-news-item-list-tab"><div class="sds-comps-profile-info-title-text">농업신문</div><span class="sds-comps-profile-info-subtext">2026.06.09.</span><a data-heatmap-target=".tit" href="https://news.example/1">${title}<span>새 창 열림</span></a><a data-heatmap-target=".body" href="https://news.example/1">첫 기사 본문</a></div><div class="fds-news-item-list-tab"><div class="sds-comps-profile-info-title-text">연구신문</div><span class="sds-comps-profile-info-subtext">2026.06.10.</span><a data-heatmap-target=".tit" href="https://news.example/2">콩 품종 데이터 확대</a></div>`;
 const r=parseNewsHTML(html,'naver','콩','https://search.naver.com/');assert.equal(r.length,2);assert.equal(r[0].title,title);assert.equal(r[0].date,'2026-06-09');assert.equal(r[0].snippet,'첫 기사 본문');assert.equal(r[1].media,'연구신문');assert.equal(r[1].date,'2026-06-10');
});
await test('Daum current title container and publication date',()=>{const r=parseNewsHTML(`<li data-docid="a"><div class="item-writer"><span class="tit_item">농업신문</span></div><div class="tit-g"><a href="https://v.daum.net/v/202606091">${title}</a></div><div class="gem-subinfo"><span class="txt_info">2026.06.09</span></div><div class="conts-desc">콩 유전체</div></li>`,'daum','콩','https://search.daum.net/');assert.equal(r.length,1);assert.equal(r[0].date,'2026-06-09');assert.equal(r[0].media,'농업신문');});
await test('RSS keeps independent source and date',()=>{const r=parseRSS(`<rss><channel><item><title>${title} - 농업신문</title><source>농업신문</source><link>https://news.example/1</link><pubDate>Mon, 08 Jun 2026 16:00:00 GMT</pubDate></item></channel></rss>`,'google','콩');assert.equal(r[0].title,title);assert.equal(r[0].date,'2026-06-09');});
await test('Publication timezone uses Korea day',()=>assert.equal(parseDate('2026-06-08T16:30:00Z'),'2026-06-09'));
await test('Full original body is kept, captions removed',()=>{const r=parseArticle(article(),'https://news.example/1');assert.equal(r.body,full.trim());assert.equal(r.date,'2026-06-09');assert.ok(r.checked);assert.equal(r.bodyLimited,false);});
await test('Visible publication label works without metadata',()=>{const r=parseArticle(`<h1>${title}</h1><pre>입력: 2026-06-13 10:00 수정: 2026-06-14 11:00</pre><article>${full}</article>`,'https://news.example/1');assert.equal(r.date,'2026-06-13');});
await test('Missing date never inferred from URL or footer',()=>{const r=parseArticle(`<h1>${title}</h1><article>${full}</article><footer>2026-06-09</footer>`,'https://news.example/20260609');assert.equal(r.date,'');});
await test('Limited body explicitly identified',()=>{const r=parseArticle(`<h1>${title}</h1><article>${full.slice(0,110)}</article>`,'https://news.example/1');assert.equal(r.bodyLimited,true);});
const reply=html=>{globalThis.fetch=async(_u,opts)=>new Response(JSON.stringify({ok:true,url:JSON.parse(opts.body).url,text:html}));};
await test('Wrong linked article never silently accepted',async()=>{reply(article('산업은행 임원 인사 공고'));const r=await verifyArticle({title,url:'https://news.example/1'},'token');assert.equal(r.linkMismatch,true);assert.equal(r.checked,false);assert.equal(r.title,title);});
await test('Original date wins and discrepancy remains visible',async()=>{reply(article());const r=await verifyArticle({title,url:'https://news.example/1',date:'2026-06-08'},'token');assert.equal(r.date,'2026-06-09');assert.equal(r.dateDifference,true);});
await test('Google intermediate links are not marked original verified',async()=>{const r=await verifyArticle({title,url:'https://news.google.com/rss/articles/example'},'token');assert.ok(!r.checked);assert.match(r.fetchNote,/중간 링크/);});
await test('429 response remains actionable status',async()=>{globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,status:429,error:'HTTP 429'}));await assert.rejects(()=>fetchPage('https://news.example','x'),e=>e.status===429);});
await test('Cancellation cancels current fetch and queued pool',async()=>{globalThis.fetch=async(_u,o)=>{if(o.signal.aborted)throw new DOMException('Aborted','AbortError');return new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));};const c=new AbortController();const p=fetchPage('https://news.example','x',c.signal);c.abort();await assert.rejects(()=>p,{name:'AbortError'});let n=0;await pool([1,2,3],2,async()=>n++,c.signal);assert.equal(n,0);});
await test('Keyword exclusion stays excluded from combinations',()=>{const r=buildQueries('양자컴퓨팅 기술로 유전체 분석',['유전체','희귀변이']);assert.ok(r.slice(1).every(q=>!q.includes('양자컴퓨팅')&&!q.includes('양자컴퓨터')));assert.match(r[0],/양자컴퓨팅/);});
await test('Search dates include both end days',()=>{const u=new URL(searchURL('google','콩','2026-06-09','2026-06-23'));assert.match(u.searchParams.get('q'),/after:2026-06-08 before:2026-06-24/);});
console.log(`TOTAL ${count} PASS`);
