// Synthetic output regressions: embedded Korean, Unicode, page bounds, missing
// bodies and safe links. Node/PDF.js is mandatory; --browser also runs Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function dependency(name) {
  try { return require(name); }
  catch (error) {
    if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
    return require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, name));
  }
}
const canvas = dependency('@napi-rs/canvas');
for (const key of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[key] = canvas[key];
const pako = require(path.join(root, 'web/vendor/pako.min.js'));
globalThis.window = {pako, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout};
const fontBytes = fs.readFileSync(path.join(root, 'web/assets/NotoSansKR-Bold.ttf'));
const fetchRequests = [];
globalThis.fetch = async url => {
  fetchRequests.push(String(url));
  assert.equal(String(url), './assets/NotoSansKR-Bold.ttf', 'Export only loads its bundled font');
  return new Response(fontBytes);
};
const {KoreanPDF, makeReport} = await import('../web/pdf-writer.mjs');
const pdfjs = await import('../web/vendor/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../web/vendor/pdf.worker.mjs', import.meta.url).href;
const out = process.env.RDA_PDF_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rdascraper-pdf-output-'));
fs.mkdirSync(out, {recursive: true});
const compact = text => text.replace(/\s+/g, '');
const paragraph = '농촌진흥청은 기후 변화에 대응하는 콩 품종과 디지털 육종 기술을 개발했다. 연구진은 생육 자료와 유전체 정보를 함께 분석하고 농가 현장에서 수확량과 품질을 검증했다. ';
const body = Array.from({length: 20}, (_, i) => `문단${i + 1} 시작 ${paragraph.repeat(5)} 문단${i + 1} 끝`).join('\n\n');
const longToken = 'https://example.invalid/research/' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(9) + '?source=regression';
const articles = [
  {articleNo: 1, title: '농촌진흥청, 콩 디지털 육종 연구 결과 발표', media: '농업신문', date: '2026-09-18', dateSource: '원문 게시일', checked: true, match: 95, mediaScore: 4, warnings: [], url: 'https://example.invalid/article/1?section=agriculture&item=(soy)', body: body + '\n최종본문표식 농업의 미래를 준비한다.', snippet: '현장 검증을 거친 새로운 품종을 소개한다.'},
  {articleNo: 2, title: '본문 미확보 기사도 검색 발췌문과 출처를 남긴다', media: '지역농업신문', date: '2026-09-18', checked: false, match: 71, mediaScore: null, warnings: ['원문 접근 제한'], url: 'https://example.invalid/article/2', body: '', snippet: '검색발췌표식 원문 본문을 확보하지 못한 기사의 실제 검색 발췌문이다.'},
  {articleNo: 3, title: '긴 제목 회귀 확인: ' + '농업 연구 현장과 지역 농가의 공동 검증 결과를 상세히 설명하는 제목 '.repeat(10), media: '농업연구소', date: '2026-09-18', checked: true, match: 82, mediaScore: 3, warnings: ['본문 일부만 확보'], url: longToken, bodyLimited: true, body: '부분본문표식\r\n한\u200b글\u0000 문장\t간격\u001f을 확인한다.\u2028분리된 문단과 지원되는 보충 문자 🄀 🄋, 원문 기호 ⓪, 미지원 그림문자 🙂 🚜, 조합한 한글 한글, 잘못된 코드 \ud800를 확인한다.\n긴문자열표식 ' + '가나다라마바사아자차카타파하'.repeat(100) + '\n부분기사끝표식', snippet: '부분발췌표식 전체 기사 확인에는 원문을 대조해야 한다.'},
  {articleNo: 4, title: '사용자가 보완한 본문', media: '수동 입력', date: '2026-09-18', checked: true, match: 0, warnings: [], url: 'https://example.invalid/article/4', bodyUserEdited: true, body: '사용자본문표식 원문과 대조할 보완 본문이다.', snippet: '직접 입력한 기사이다.'},
];
const press = {title: '콩 디지털 육종과 현장 보급 연구'};
const range = {start: '2026-09-01', end: '2026-09-18'};

const probe = new KoreanPDF(fontBytes);
assert.notEqual(probe.glyph(0x1f100), 0, 'Format-12 supplementary glyph must be found');
assert.equal(probe.glyph(0x1f642), 0, 'Fixture emoji is deliberately not present in font');
probe.hex(' A\u00a0🄋⓪?🙂🚜');
assert.equal(probe.used.get(0x20).glyph, probe.used.get(0xa0).glyph);
assert.notEqual(probe.used.get(0x20).cid, probe.used.get(0xa0).cid, 'Shared glyphs retain separate Unicode entries');
assert.equal(probe.used.get(0x1f10b).glyph, probe.used.get(0x24ea).glyph);
assert.notEqual(probe.used.get(0x1f10b).cid, probe.used.get(0x24ea).cid);
assert.notEqual(probe.used.get(0x1f642).cid, probe.used.get(0x1f69c).cid, 'Fallbacks cannot overwrite each other');
const unsafe = ['javascript:alert(1)', 'file:///tmp/private', 'data:text/html,hello', 'https://user:pass@example.invalid/', 'https://example.invalid/\nunsafe'];
for (const url of unsafe) probe.line('주소 검사', 12, undefined, 44, url);
assert.equal(probe.page.links.length, 0);
probe.text('https://example.invalid/' + 'x'.repeat(1500), 13);
for (const line of probe.wrap('x'.repeat(1500), 13)) assert.ok(probe.width(line, 13) <= 507.01);
const cleaned = new KoreanPDF(fontBytes);
cleaned.text('한\u200b글\u0000\t정상\r\n다음\ud800');
assert.equal(cleaned.used.has(0), false);
assert.equal(cleaned.used.has(0x200b), false);
assert.ok(cleaned.used.has(0xfffd));
const aliasBytes = probe.finish();
assert.deepEqual(probe.finish(), aliasBytes, 'finish() is idempotent');
console.log('PASS format-12 glyphs, separate Unicode CIDs, input cleanup, long-word wrapping and URI allowlist');

async function inspect(bytes, filename, expectedFullBody) {
  fs.writeFileSync(path.join(out, filename), bytes);
  const task = pdfjs.getDocument({data: bytes.slice(), enableXfa: false, useSystemFonts: false});
  const document = await task.promise;
  try {
    assert.equal(await document.getJSActions(), null);
    const texts = [], links = [];
    for (let pageNo = 1; pageNo <= document.numPages; pageNo++) {
      const page = await document.getPage(pageNo);
      const content = await page.getTextContent({disableNormalization: true});
      texts.push(content.items.filter(item => item.transform?.[5] !== 25).map(item => item.str || '').join(''));
      for (const item of content.items.filter(item => item.str?.trim())) {
        const [,,, , x, y] = item.transform;
        assert.ok(x >= 43.8 && x + item.width <= 552, `Page ${pageNo} text exceeds horizontal bounds: ${item.str.slice(0, 30)}`);
        assert.ok(y >= 24 && y <= 793, `Page ${pageNo} text exceeds page bounds`);
        assert.ok(y === 25 || y >= 52, `Page ${pageNo} body overlaps the footer`);
      }
      const annotations = await page.getAnnotations();
      for (const annotation of annotations) {
        if (annotation.subtype !== 'Link') continue;
        assert.match(annotation.url, /^https?:\/\//);
        assert.ok(annotation.rect[0] >= 44 && annotation.rect[2] <= 552);
        links.push(annotation.url);
      }
      const viewport = page.getViewport({scale: 0.85});
      const surface = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({canvasContext: surface.getContext('2d'), viewport}).promise;
      fs.writeFileSync(path.join(out, filename.replace('.pdf', `-page-${pageNo}.png`)), surface.toBuffer('image/png'));
    }
    assert.ok(links.includes(articles[0].url));
    assert.ok(links.includes(articles[1].url));
    const allText = compact(texts.join('\n'));
    assert.ok(allText.includes('농촌진흥청,콩디지털육종연구결과발표'));
    if (expectedFullBody) {
      assert.ok(document.numPages >= 7, 'Fixture must exercise continuation pages');
      assert.ok(allText.includes(compact(body)), 'Entire long article survives pagination');
      for (const marker of ['최종본문표식', '검색발췌표식', '부분본문표식', '부분발췌표식', '부분기사끝표식', '사용자본문표식', '본문미확보', '본문일부확보', '사용자가보완한본문·원문대조필요', '특수문자표시안내', '🄀', '🄋', '⓪', '🙂', '🚜']) assert.ok(allText.includes(marker), `Missing ${marker}`);
      assert.ok(allText.includes(compact('가나다라마바사아자차카타파하'.repeat(100))));
      assert.ok(allText.includes(compact(longToken)), 'Long source URL is neither clipped nor truncated');
      const longTitlePages = texts.map((text, i) => compact(text).includes('긴제목회귀확인') ? i : -1).filter(i => i >= 0);
      assert.equal(longTitlePages.length, 1);
      assert.ok(compact(texts[longTitlePages[0]]).includes('농업연구소'), 'Long title remains with its metadata');
    } else {
      assert.ok(allText.includes('검색발췌표식'));
      assert.equal(allText.includes('최종본문표식'), false);
    }
    return {pages: document.numPages, characters: allText.length, links: links.length};
  } finally { await task.destroy(); }
}

const bodyBytes = await makeReport(articles, press, range, true);
const nodeBody = await inspect(bodyBytes, 'node-body-report.pdf', true);
const nodeList = await inspect(await makeReport(articles, press, range, false), 'node-list-report.pdf', false);
assert.deepEqual(fetchRequests, ['./assets/NotoSansKR-Bold.ttf', './assets/NotoSansKR-Bold.ttf']);
console.log(`PASS Node/PDF.js selectable Korean and complete article body, ${nodeBody.pages} body pages / ${nodeList.pages} list pages, all pages rendered`);

let browserResult;
if (process.argv.includes('--browser')) {
  const {chromium} = dependency('playwright');
  const web = path.join(root, 'web');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data:; connect-src 'self'");
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>PDF output regression</title><script src="/vendor/pako.min.js"></script><body><canvas></canvas></body></html>');
      return;
    }
    const target = path.resolve(web, '.' + url.pathname);
    if (!target.startsWith(web + path.sep) || !fs.existsSync(target)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', target.endsWith('.mjs') || target.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    response.end(fs.readFileSync(target));
  });
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({headless: true, ...(process.env.RDA_BROWSER_EXECUTABLE ? {executablePath: process.env.RDA_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
    const page = await browser.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.goto(base);
    browserResult = await page.evaluate(async ({articles, press, range}) => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
      const {makeReport} = await import('/pdf-writer.mjs');
      const pdfjs = await import('/vendor/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
      const bytes = await makeReport(articles, press, range, true);
      const loadingTask = pdfjs.getDocument({data: bytes.slice(), useSystemFonts: false});
      const pdf = await loadingTask.promise;
      const text = [], links = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        text.push((await page.getTextContent({disableNormalization: true})).items.filter(item => item.transform?.[5] !== 25).map(item => item.str || '').join(''));
        links.push(...(await page.getAnnotations()).filter(item => item.subtype === 'Link').map(item => item.url));
        const viewport = page.getViewport({scale: 1});
        const canvas = document.querySelector('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
      }
      const pages = pdf.numPages;
      await loadingTask.destroy();
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return {pages, text: text.join('\n'), links, violations, base64: btoa(binary)};
    }, {articles, press, range});
    assert.equal(browserResult.pages, nodeBody.pages);
    assert.ok(compact(browserResult.text).includes(compact(body)));
    for (const marker of ['최종본문표식', '검색발췌표식', '부분기사끝표식', '사용자본문표식', '🄀', '🄋', '🙂', '🚜']) assert.ok(browserResult.text.includes(marker));
    assert.ok(browserResult.links.includes(articles[1].url));
    assert.deepEqual(browserResult.violations, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(url => !url.startsWith(base) && !url.startsWith('blob:')), []);
    fs.writeFileSync(path.join(out, 'browser-body-report.pdf'), Buffer.from(browserResult.base64, 'base64'));
    await page.locator('canvas').screenshot({path: path.join(out, 'browser-last-page.png')});
    browserResult = {pages: browserResult.pages, browser: await browser.version(), externalRequests: 0, cspViolations: 0};
    console.log(`PASS Chromium generated, extracted and rendered ${browserResult.pages} PDF pages using only local assets under CSP`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({nodeBody, nodeList, browser: browserResult || 'not requested'}, null, 2));
console.log('ARTIFACTS ' + out);
