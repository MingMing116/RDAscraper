import assert from 'node:assert/strict';
import {JSDOM} from './dom_helpers.mjs';
import {parseArticle,cleanReviewSnippet} from '../web/news.mjs';

globalThis.DOMParser=new JSDOM('').window.DOMParser;
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
const url='https://v.daum.net/v/20260101090000000';
const title='농업 데이터 서비스 활용 연구';
const paragraphs=[
  '농촌진흥청 연구진은 농업 데이터를 활용해 재배 환경과 품종의 특성을 비교했다. 여러 지역에서 모은 생육 정보를 분석하고 현장 실증을 통해 결과를 확인했다.',
  '새로운 서비스는 사용자가 필요한 자료를 쉽게 찾을 수 있도록 검색 기능을 개선했다. 연구 자료는 품종 선발과 재배 관리에 활용할 수 있으며 후속 연구를 지원한다.',
  '남성 농업인과 여성 농업인이 함께 실증에 참여했다. 연구진은 음성재생 기능의 접근성을 평가하고 작업을 마친 뒤에는 환기창 닫기 절차도 점검했다고 설명했다.'
];
const full=paragraphs.join('\n\n'),pHTML=paragraphs.map(p=>`<p>${p}</p>`).join('');
const summaryNotice='자동요약 기사 제목과 주요 문장을 기반으로 자동요약한 결과입니다. 전체 맥락을 이해하기 위해서는 본문 보기를 권장합니다.';
const summary=`<div class="layer_summary">${summaryNotice}<p>${paragraphs[0]}</p><span>닫기</span></div>`;
const tts='<div class="layer_tts">음성재생 설정 <p>이동 통신망에서 음성 재생 시 데이터 요금이 발생할 수 있습니다. 글자 수 10,000자 초과 시 일부만 음성으로 제공합니다.</p><label>남성</label> <label>여성</label> <label>느림</label> <label>보통</label> <label>빠름</label> <span>닫기</span></div>';
const font='<div class="layer_font">글자크기 설정 파란원을 좌우로 움직이시면 글자크기가 변경 됩니다. <p>매우 작은 폰트 작은 폰트 보통 폰트 큰 폰트 매우 큰 폰트</p><p>이 글자크기로 변경됩니다.</p><span>닫기</span></div>';
const translation='<div class="layer_translate">번역beta Translated by kaka i 닫기</div>';
const related='<div class="box_related"><h2>다른 뉴스</h2>'+Array.from({length:30},(_,i)=>`<p>연관 없는 추천 기사 ${i} ${'다른 지역 생활 소식을 전합니다. '.repeat(4)}</p>`).join('')+'</div>';
const page=(inside,description='')=>`<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"></head><body>${inside}</body></html>`;

test('Daum harmony article core excludes longer title, TTS, font and recommendation wrappers',()=>{
  const r=parseArticle(page(`<article><div class="head_view"><h1>${title}</h1><div class="info_view">홍길동 2026. 1. 1. 09:00</div>${summary}${tts}${font}${translation}</div><div class="news_view"><div id="harmonyContainer" class="article_view">${pHTML}</div></div>${related}</article>`),url);
  assert.equal(r.body,full);assert.equal(r.bodySource,'#harmonyContainer');assert.equal(r.checked,true);assert.equal(r.bodyLimited,false);
  assert.doesNotMatch(r.body,/자동요약|파란원|추천 기사|Translated|10,000/);
  assert.match(r.body,/남성 농업인과 여성 농업인/);assert.match(r.body,/음성재생 기능/);assert.match(r.body,/환기창 닫기/);
});
test('Daum news_view article_view remains preferred when harmony ID is absent',()=>{
  const r=parseArticle(page(`<article>${summary}${tts}<div class="news_view"><div class="article_view">${pHTML}</div>${related}</div>${font}</article>`),url);
  assert.equal(r.body,full);assert.equal(r.bodySource,'.news_view .article_view');
});
test('A news_view root removes nested controls and related-feed paragraphs without core ID',()=>{
  const r=parseArticle(page(`<article><div class="news_view">${tts}${pHTML}${font}${translation}${related}</div></article>`),url);
  assert.equal(r.body,full);assert.equal(r.bodySource,'.news_view');
});
test('Unknown control wrapper names require control signatures rather than isolated words',()=>{
  const altered=tts.replace('layer_tts','reading-options').replaceAll('<label>','<span>').replaceAll('</label>','</span>')+font.replace('layer_font','reading-settings')+translation.replace('layer_translate','tool-popup');
  const r=parseArticle(page(`<article>${altered}${pHTML}<div class="speech-options"><p>${paragraphs[2]}</p></div></article>`),'https://publisher.example/news/1');
  assert.ok(r.body.startsWith(full));assert.ok(r.body.endsWith(paragraphs[2]));assert.doesNotMatch(r.body,/파란원|10,000|Translated/);
});
test('An image-only Daum core does not accept auto-summary or outer UI as a full body',()=>{
  const r=parseArticle(page(`<article>${summary}${tts}<div id="harmonyContainer"><figure><img src="/article.jpg"></figure></div>${related}</article>`),url);
  assert.equal(r.body,'');assert.equal(r.checked,false);assert.equal(r.bodyLimited,true);assert.match(r.fetchNote,/이미지|영상/);
});
test('A hidden Daum core cannot fall back to unrelated visible recommendations',()=>{
  const r=parseArticle(page(`<article><div hidden><div id="harmonyContainer">${pHTML}</div></div>${related}</article>`),url);
  assert.equal(r.body,'');assert.equal(r.checked,false);
});
test('Daum-specific class cleanup does not remove a publisher article with coincidental class name',()=>{
  const r=parseArticle(page(`<div class="article_body"><div class="list_news">${pHTML}</div></div>`),'https://publisher.example/news/2');
  assert.equal(r.body,full);
});
test('Existing contaminated metadata becomes actual summary prose instead of heading/byline/UI',()=>{
  const contaminated=`${title} 홍길동 2026. 1. 1. 09:00 ${summaryNotice} ${paragraphs[0]} 닫기`;
  const r=parseArticle(page(`<div id="harmonyContainer">${pHTML}</div>`,contaminated),url);
  assert.equal(r.snippet,paragraphs[0]);assert.equal(cleanReviewSnippet(contaminated),paragraphs[0]);
});
test('Blank metadata uses clean article prose and does not fall back to an outer summary panel',()=>{
  const r=parseArticle(page(`<article>${summary}${tts}<div id="harmonyContainer">${pHTML}</div>${related}</article>`),url);
  assert.ok(r.snippet.startsWith('농촌진흥청 연구진은'));assert.doesNotMatch(r.snippet,/자동요약|음성재생 설정|닫기$/);
});
test('Cached TTS, translation and font panels are removed only with complete UI signatures',()=>{
  const flatten=s=>new JSDOM(s).window.document.body.textContent.replace(/\s+/g,' ').trim();
  const contaminated=[paragraphs[0],flatten(tts),flatten(font),flatten(translation),paragraphs[1]].join(' ');
  assert.equal(cleanReviewSnippet(contaminated),paragraphs[0]+' '+paragraphs[1]);
});
test('Legitimate prose and short captions preserve gender, voice and closing vocabulary',()=>{
  for(const text of [paragraphs[2],'남성 여성 농업인의 작업 시간 비교','음성재생 설정 방법을 연구했다.','안전한 환기창 닫기','닫기','번역 기술과 글자크기 설정 기능을 설명했다.'])assert.equal(cleanReviewSnippet(text),text);
  const r=parseArticle(page(`<article><div class="speech-settings">${pHTML}</div></article>`),'https://publisher.example/news/3');
  assert.equal(r.body,full);
});
console.log(`TOTAL ${count} PASS`);
