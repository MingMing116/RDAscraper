// Local TrueType-backed PDF writer. Embedded fonts and a per-character Unicode
// map keep Korean text selectable, including characters that share a glyph.
import {articlesByNumber} from './article-order.mjs';
import {cleanReviewSnippet} from './news.mjs';
const enc = new TextEncoder();
const LEFT = 44, RIGHT = 551, TOP = 792, BOTTOM = 52;
const TEXT_WIDTH = RIGHT - LEFT, PAGE_SPACE = TOP - BOTTOM;
const INK = '0.13 0.19 0.17', GREEN = '0.06 0.32 0.24', BLUE = '0.08 0.35 0.75';
function concat(arr) {
  const result = new Uint8Array(arr.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const bytes of arr) { result.set(bytes, offset); offset += bytes.length; }
  return result;
}
function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufe00-\ufe0f]/g, '')
    .replace(/[\ud800-\udfff]/gu, '\ufffd').normalize('NFC');
}
function safeLink(value) {
  const text = String(value ?? '').trim();
  if (/[\x00-\x20\x7f]/.test(text)) return '';
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function unicodeHex(cp) {
  return String.fromCodePoint(cp).split('')
    .map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
}

export class KoreanPDF {
  constructor(fontBytes) {
    this.font = new Uint8Array(fontBytes);
    this.dv = new DataView(this.font.buffer, this.font.byteOffset, this.font.byteLength);
    const d = this.dv;
    this.tables = {};
    if (d.byteLength < 12) throw Error('한글 글꼴을 읽지 못했습니다.');
    for (let p = 12, i = 0; i < d.getUint16(4); i++, p += 16) {
      if (p + 16 > d.byteLength) throw Error('한글 글꼴 정보가 손상되었습니다.');
      const tag = String.fromCharCode(...this.font.subarray(p, p + 4));
      const offset = d.getUint32(p + 8), length = d.getUint32(p + 12);
      if (offset + length > d.byteLength) throw Error('한글 글꼴 정보가 손상되었습니다.');
      this.tables[tag] = offset;
    }
    for (const tag of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'glyf']) {
      if (!this.tables[tag]) throw Error('지원하지 않는 한글 글꼴입니다.');
    }
    this.units = d.getUint16(this.tables.head + 18);
    this.hm = d.getUint16(this.tables.hhea + 34);
    this.numGlyphs = d.getUint16(this.tables.maxp + 4);
    if (!this.units || !this.hm) throw Error('한글 글꼴 크기 정보를 읽지 못했습니다.');
    const metric = offset => Math.round(d.getInt16(offset) * 1000 / this.units);
    this.fontBox = [36, 38, 40, 42].map(offset => metric(this.tables.head + offset));
    this.ascent = metric(this.tables.hhea + 4);
    this.descent = metric(this.tables.hhea + 6);
    const cmap = this.tables.cmap;
    for (let i = 0; i < d.getUint16(cmap + 2); i++) {
      const p = cmap + 4 + i * 8, platform = d.getUint16(p), encoding = d.getUint16(p + 2);
      if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
      const offset = cmap + d.getUint32(p + 4), format = d.getUint16(offset);
      if (format === 4) this.cmap4 = offset;
      if (format === 12) this.cmap12 = offset;
    }
    if (!this.cmap4 && !this.cmap12) throw Error('지원하지 않는 글꼴 cmap입니다.');
    this.glyphCache = new Map();
    this.used = new Map(); // Unicode scalar -> { cid, glyph, cp }; never glyph -> Unicode.
    this.unsupported = new Set();
    this.pages = [];
    this.newPage();
  }
  glyph(cp) {
    if (this.glyphCache.has(cp)) return this.glyphCache.get(cp);
    const d = this.dv;
    let glyph = 0;
    if (this.cmap12) {
      const p = this.cmap12;
      let low = 0, high = d.getUint32(p + 12) - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1, offset = p + 16 + mid * 12;
        const start = d.getUint32(offset), end = d.getUint32(offset + 4);
        if (cp < start) high = mid - 1;
        else if (cp > end) low = mid + 1;
        else { glyph = d.getUint32(offset + 8) + cp - start; break; }
      }
    }
    if (!glyph && cp <= 0xffff && this.cmap4) {
      const p = this.cmap4, n = d.getUint16(p + 6) / 2;
      const end = p + 14, start = end + 2 * n + 2, delta = start + 2 * n, range = delta + 2 * n;
      let low = 0, high = n - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        if (cp > d.getUint16(end + 2 * mid)) low = mid + 1;
        else high = mid - 1;
      }
      if (low < n && cp >= d.getUint16(start + 2 * low)) {
        const offset = d.getUint16(range + 2 * low), shift = d.getInt16(delta + 2 * low);
        glyph = offset ? d.getUint16(range + 2 * low + offset + 2 * (cp - d.getUint16(start + 2 * low))) : cp;
        if (!offset || glyph) glyph = (glyph + shift) & 0xffff;
      }
    }
    if (glyph >= this.numGlyphs) glyph = 0;
    this.glyphCache.set(cp, glyph);
    return glyph;
  }
  displayGlyph(cp) { return this.glyph(cp) || this.glyph(63); }
  advance(glyph) { return this.dv.getUint16(this.tables.hmtx + 4 * Math.min(glyph, this.hm - 1)) / this.units; }
  width(text, size) {
    let width = 0;
    for (const c of cleanText(text)) width += this.advance(this.displayGlyph(c.codePointAt(0))) * size;
    return width;
  }
  hex(text) {
    let result = '';
    for (const c of cleanText(text)) {
      const cp = c.codePointAt(0);
      if (!this.used.has(cp)) {
        if (this.used.size >= 65534) throw Error('PDF에 포함할 수 있는 서로 다른 문자 수를 초과했습니다.');
        const glyph = this.glyph(cp);
        if (!glyph) this.unsupported.add(cp);
        this.used.set(cp, {cid: this.used.size + 1, glyph: glyph || this.glyph(63), cp});
      }
      result += this.used.get(cp).cid.toString(16).padStart(4, '0');
    }
    return result;
  }
  wrap(text, size = 12, indent = 0) {
    const maxWidth = Math.max(size, TEXT_WIDTH - indent), lines = [];
    for (const paragraph of cleanText(text).split('\n')) {
      let line = [], width = 0, lastSpace = -1;
      for (const c of paragraph) {
        const item = {c, w: this.advance(this.displayGlyph(c.codePointAt(0))) * size};
        if (line.length && width + item.w > maxWidth) {
          const cut = lastSpace > 0 ? lastSpace : line.length;
          lines.push(line.slice(0, cut).map(x => x.c).join(''));
          line = line.slice(cut);
          while (line[0]?.c === ' ') line.shift();
          width = line.reduce((n, x) => n + x.w, 0);
          lastSpace = -1;
          for (let i = 0; i < line.length; i++) if (line[i].c === ' ') lastSpace = i;
        }
        if (c === ' ') lastSpace = line.length;
        line.push(item); width += item.w;
      }
      lines.push(line.map(x => x.c).join(''));
    }
    return lines;
  }
  height(text, size = 12, indent = 0) { return this.wrap(text, size, indent).length * size * 1.65; }
  newPage() { this.page = {ops: [], links: []}; this.pages.push(this.page); this.y = TOP; }
  ensureSpace(height) {
    if (height <= PAGE_SPACE && this.y - height < BOTTOM && this.page.ops.length) this.newPage();
  }
  line(text, size = 12, color = INK, x = LEFT, url = '') {
    if (this.y < BOTTOM) this.newPage();
    this.page.ops.push(`BT /F0 ${size} Tf ${color} rg 1 0 0 1 ${x} ${this.y.toFixed(2)} Tm <${this.hex(text)}> Tj ET`);
    const link = safeLink(url);
    if (link) this.page.links.push({url: link, x, y: this.y - 3, w: Math.min(RIGHT - x, this.width(text, size)), h: size + 5});
    this.y -= size * 1.65;
  }
  text(text, size = 12, color = INK, indent = 0, options = {}) {
    const lines = this.wrap(text, size, indent), lineHeight = size * 1.65;
    if (options.keepTogether) this.ensureSpace(lines.length * lineHeight + (options.reserveAfter || 0));
    for (let i = 0; i < lines.length; i++) {
      // Keep the final two lines with following metadata; a very long title may
      // still span pages, but its last line cannot be stranded above a footer.
      if (lines.length - i <= 2) this.ensureSpace((lines.length - i) * lineHeight + (options.reserveAfter || 0));
      this.line(lines[i], size, color, LEFT + indent, options.url);
    }
  }
  gap(n = 10) { this.y -= n; }
  rule() {
    if (this.y < BOTTOM + 18) return;
    this.page.ops.push(`0.82 0.87 0.84 RG .7 w ${LEFT} ${this.y.toFixed(2)} m ${RIGHT} ${this.y.toFixed(2)} l S`);
    this.y -= 18;
  }
  notice(title, message) {
    const textHeight = this.height(title, 12, 10) + this.height(message, 11, 10);
    this.ensureSpace(textHeight + 28);
    this.page.ops.push(`0.96 0.96 0.90 rg ${LEFT} ${(this.y - textHeight - 6).toFixed(2)} ${TEXT_WIDTH} ${(textHeight + 22).toFixed(2)} re f`);
    this.text(title, 12, '0.40 0.29 0.08', 10);
    this.text(message, 11, INK, 10);
    this.gap(28);
  }
  finish() {
    if (this.finished) return this.finished;
    const objs = [null], reserve = () => { objs.push(null); return objs.length - 1; };
    const add = bytes => { objs.push(typeof bytes === 'string' ? enc.encode(bytes) : bytes); return objs.length - 1; };
    const stream = (raw, extra = '') => {
      const deflate = globalThis.window?.pako?.deflate || globalThis.pako?.deflate;
      // Uncompressed streams remain valid if the bundled compressor is unavailable.
      const bytes = deflate ? deflate(raw) : raw;
      return concat([enc.encode(`<< /Length ${bytes.length} ${deflate ? '/Filter /FlateDecode ' : ''}${extra} >>\nstream\n`), bytes, enc.encode('\nendstream')]);
    };
    const footerOps = this.pages.map((_, i) => `BT /F0 10 Tf .35 .4 .37 rg 1 0 0 1 ${LEFT} 25 Tm <${this.hex('RDAscraper | ' + (i + 1) + ' / ' + this.pages.length)}> Tj ET`);
    const catalog = reserve(), pages = reserve(), file = add(stream(this.font, `/Length1 ${this.font.length}`));
    const descriptor = add(`<< /Type /FontDescriptor /FontName /NotoSansKR-Bold /Flags 4 /FontBBox [${this.fontBox.join(' ')}] /ItalicAngle 0 /Ascent ${this.ascent} /Descent ${this.descent} /CapHeight 750 /StemV 100 /FontFile2 ${file} 0 R >>`);
    const mappings = [...this.used.values()];
    let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < mappings.length; i += 100) {
      const group = mappings.slice(i, i + 100);
      cmap += group.length + ' beginbfchar\n' + group.map(({cid, cp}) => `<${cid.toString(16).padStart(4, '0')}> <${unicodeHex(cp)}>`).join('\n') + '\nendbfchar\n';
    }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    const unicode = add(stream(enc.encode(cmap)));
    const gidBytes = new Uint8Array((mappings.length + 1) * 2), gidView = new DataView(gidBytes.buffer);
    for (const {cid, glyph} of mappings) gidView.setUint16(cid * 2, glyph);
    const gidMap = add(stream(gidBytes));
    const widths = mappings.map(({cid, glyph}) => `${cid} [${Math.round(this.advance(glyph) * 1000)}]`).join(' ');
    const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSansKR-Bold /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${gidMap} 0 R /DW 1000 /W [${widths}] >>`);
    const font = add(`<< /Type /Font /Subtype /Type0 /BaseFont /NotoSansKR-Bold /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${unicode} 0 R >>`), kids = [];
    for (let index = 0; index < this.pages.length; index++) {
      const page = this.pages[index], content = add(stream(enc.encode([...page.ops, footerOps[index]].join('\n'))));
      const links = page.links.map(link => add(`<< /Type /Annot /Subtype /Link /Rect [${link.x} ${link.y} ${link.x + link.w} ${link.y + link.h}] /Border [0 0 0] /A << /S /URI /URI (${link.url.replace(/[\\()]/g, '\\$&')}) >> >>`));
      kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F0 ${font} 0 R >> >> /Contents ${content} 0 R /Annots [${links.map(id => id + ' 0 R').join(' ')}] >>`));
    }
    objs[pages] = enc.encode(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(id => id + ' 0 R').join(' ')}] >>`);
    objs[catalog] = enc.encode(`<< /Type /Catalog /Pages ${pages} 0 R /Lang (ko-KR) >>`);
    const chunks = [enc.encode('%PDF-1.7\n%RDAscraper\n')], offsets = [0];
    let pos = chunks[0].length;
    for (let i = 1; i < objs.length; i++) {
      offsets.push(pos);
      const bytes = concat([enc.encode(i + ' 0 obj\n'), objs[i], enc.encode('\nendobj\n')]);
      chunks.push(bytes); pos += bytes.length;
    }
    chunks.push(enc.encode('xref\n0 ' + objs.length + '\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    this.finished = concat(chunks);
    return this.finished;
  }
}

export async function makeReport(articles, press, range, bodyMode = false) {
  articles=articlesByNumber(articles);
  const response = await fetch('./assets/NotoSansKR-Bold.ttf');
  if (!response.ok) throw Error('내장 한글 글꼴을 읽지 못했습니다. 프로그램을 다시 실행해 주세요.');
  const pdf = new KoreanPDF(await response.arrayBuffer());
  pdf.text(bodyMode ? '기사 본문 스크랩' : '보도기사 검수 목록', 26, GREEN);
  pdf.gap();
  pdf.text(press.title || '보도자료 기사 검색', 18, INK, 0, {keepTogether: true, reserveAfter: 80});
  pdf.text(`기간 ${range.start} ~ ${range.end} | 선택 ${articles.length}건`, 12);
  pdf.text('일치도는 자동 판별 참고값입니다. 매체 점수는 기존 등록 기준표를 사용합니다.', 12);
  pdf.rule();
  for (let i = 0; i < articles.length; i++) {
    const article = {...articles[i],snippet:cleanReviewSnippet(articles[i].snippet)};
    const title = `${article.articleNo || i + 1}. ${article.title || '제목 없음'}`;
    const metadata = `${article.media || '매체 미확인'} | ${article.date || '기사일 미확인'} | 일치도 ${article.match || 0}점 | 매체 점수 ${article.mediaScore ?? '확인 필요'}`;
    const verification = `확인: ${article.checked ? '원문 확인' : '원문 미확인'} / ${article.dateSource || '날짜 근거 없음'}${article.warnings?.length ? ' / ' + article.warnings.join(', ') : ''}`;
    const following = pdf.height(metadata, 12) + Math.min(pdf.height(verification, 11), 72) + 65;
    if (bodyMode && i > 0) pdf.newPage();
    pdf.ensureSpace(pdf.height(title, 18) + following);
    pdf.text(title, 18, GREEN, 0, {keepTogether: true, reserveAfter: Math.min(following, 160)});
    pdf.text(metadata, 12, INK, 0, {keepTogether: true, reserveAfter: 50});
    pdf.text(verification, 11, INK, 0, {reserveAfter: 28});
    const url = safeLink(article.url);
    if (url) {
      pdf.text('원문 기사 열기', 12, BLUE, 0, {url});
      // Print the destination as well, so a paper copy still identifies the source.
      pdf.text(url, 9, BLUE, 0, {url});
    } else pdf.text('원문 링크 없음 또는 지원하지 않는 주소', 11);
    pdf.gap(6);
    if (bodyMode) {
      const body = cleanText(article.body).trim();
      if (!body) {
        pdf.notice('본문 미확보', '기사 본문을 가져오지 못했습니다. 아래는 검색 발췌문이며 기사 전문이 아닙니다. 전체 내용은 원문 링크에서 확인하세요.');
        pdf.text('검색 발췌문', 12, GREEN, 0, {reserveAfter: 44});
        pdf.text(article.snippet || '검색 발췌문도 없습니다.', 13);
      } else {
        if (article.bodyUserEdited) pdf.notice('사용자가 보완한 본문 · 원문 대조 필요', '직접 입력하거나 수정한 본문입니다. 정확성과 전체 내용은 원문 링크에서 확인하세요.');
        if (article.bodyLimited) {
          pdf.notice('본문 일부 확보', '아래 본문은 일부가 누락되었을 수 있습니다. 전체 내용은 원문 링크에서 확인하세요.');
          if (article.snippet) pdf.text('검색 발췌문: ' + article.snippet, 11);
        }
        pdf.text('기사 본문', 12, GREEN, 0, {reserveAfter: 44});
        pdf.text(body, 13);
      }
    } else pdf.text('발췌: ' + (article.snippet || '발췌문 없음'), 13);
    pdf.gap(7); pdf.rule();
  }
  if (pdf.unsupported.size) {
    pdf.gap(8);
    pdf.notice('특수문자 표시 안내', '내장 글꼴에 없는 문자는 ?로 표시했습니다. PDF에서 복사하면 원래 문자가 유지됩니다.');
  }
  return pdf.finish();
}
