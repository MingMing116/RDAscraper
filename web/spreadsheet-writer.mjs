// A real, macro-free OOXML workbook, assembled locally with the bundled JSZip.
// rows[0] is the existing export header; no title rows or columns are inserted.
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL='http://schemas.openxmlformats.org/package/2006/relationships';
const WIDTHS=[9,9,15,23,22,19,15,64,56,20,17,45,25,40,80,16];
const ROW_HEIGHT=30;

function xml(value){
  return String(value??'').replace(/[&<>"'\r]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;','\r':'&#13;'}[c]));
}

// Escape literal OOXML escape sequences before encoding characters XML forbids.
// This keeps e.g. the literal title "_x000A_" from becoming a newline in Excel.
function cellText(value){
  return xml(String(value??'').replace(/_x[0-9a-f]{4}_/gi,s=>'_x005F_'+s.slice(1))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udfff]/gu,c=>
      '_x'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')+'_'));
}

function columnName(index){
  let name='';
  for(let n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;
  return name;
}

// Hyperlinks never execute formulas. Only literal, public web addresses become
// links; rejected values remain complete, inert text. No DNS/network is used.
function publicLink(value){
  if(typeof value!=='string'||!/^https?:\/\//i.test(value)||/[\s\u0000-\u001f\u007f\\]/u.test(value))return '';
  try{
    const u=new URL(value);
    if(!/^https?:$/.test(u.protocol)||u.username||u.password||(u.port&&u.port!=='80'&&u.port!=='443'))return '';
    const host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(!host||host==='localhost'||/\.(localhost|local|internal|lan|home|test|invalid|example)$/.test(host))return '';
    if(host.startsWith('[')){
      // Restrict numeric IPv6 links to global unicast, excluding documentation,
      // transition/tunnel ranges and embedded IPv4 addresses.
      const h=host.slice(1,-1),parts=h.split(':'),first=parseInt(parts[0],16),second=parseInt(parts[1]||'0',16);
      if(!Number.isFinite(first)||first<0x2000||first>=0x3fff||h.includes('.')||
        (first===0x2001&&(second<0x200||second===0xdb8))||first===0x2002)return '';
    }else if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){
      const [a,b,c]=host.split('.').map(Number);
      if(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||
        (a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===88&&c===99))||
        (a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113))return '';
    }else if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host))return '';
    return u.href;
  }catch{return '';}
}

const STYLES=XML+`<styleSheet xmlns="${MAIN}">
<fonts count="3">
  <font><b/><sz val="12"/><color rgb="FF172D27"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>
  <font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>
  <font><b/><u/><sz val="12"/><color rgb="FF1455A0"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF15563F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6F3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom style="hair"><color rgb="FFD7E3DC"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="0"/></xf>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="0"/></xf>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="0"/></xf>
  <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="0"/></xf>
  <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="0"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * Export the same rectangular rows used by CSV to Uint8Array XLSX bytes.
 * title / period are document metadata; period may be text or {start,end}.
 * Fixed row heights and disabled wrapping keep the list tidy. Full cell values
 * remain available in Excel's formula bar, including multiline/long articles.
 */
export async function makeWorkbook(rows,{title='보도기사 검수 목록',period=''}={}){
  if(!Array.isArray(rows)||!rows.length||!Array.isArray(rows[0])||!rows[0].length)throw Error('엑셀로 저장할 표가 없습니다.');
  const count=rows[0].length;
  if(rows.length>1048576||count>16384)throw Error('엑셀에서 지원하는 행 또는 열 수를 초과했습니다.');
  const Zip=globalThis.JSZip||globalThis.window?.JSZip;
  if(typeof Zip!=='function')throw Error('내장 엑셀 저장 모듈을 읽지 못했습니다. 프로그램을 다시 실행해 주세요.');
  const zip=new Zip(),links=[],sheetRows=[];
  for(let i=0;i<rows.length;i++){
    if(!Array.isArray(rows[i])||rows[i].length!==count)throw Error('엑셀 저장 자료의 열 수가 일치하지 않습니다.');
    const cells=[];
    for(let j=0;j<count;j++){
      const value=rows[i][j],text=String(value??'');
      // Excel cannot retain longer cells. Fail explicitly instead of silently
      // truncating source material or producing a repair dialog on opening.
      if(text.length>32767)throw Error(`${i+1}행 ${j+1}열의 내용이 엑셀 셀 제한(32,767자)을 초과했습니다.`);
      const ref=columnName(j)+(i+1),link=i?publicLink(value):'',stripe=i%2===0;
      const style=i===0?1:link?(stripe?4:3):(stripe?2:0);
      if(link)links.push({ref,url:link});
      const numeric=i>0&&typeof value==='number'&&Number.isFinite(value);
      cells.push(numeric?`<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`:
        `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${cellText(value)}</t></is></c>`);
    }
    sheetRows.push(`<row r="${i+1}" ht="${ROW_HEIGHT}" customHeight="1">${cells.join('')}</row>`);
  }
  const range=`A1:${columnName(count-1)}${rows.length}`;
  const columns=Array.from({length:count},(_,i)=>`<col min="${i+1}" max="${i+1}" width="${WIDTHS[i]||24}" customWidth="1"/>`).join('');
  const hyperlinks=links.length?'<hyperlinks>'+links.map((l,i)=>`<hyperlink ref="${l.ref}" r:id="link${i+1}"/>`).join('')+'</hyperlinks>':'';
  zip.file('xl/worksheets/sheet1.xml',XML+`<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="${ROW_HEIGHT}"/><cols>${columns}</cols><sheetData>${sheetRows.join('')}</sheetData><autoFilter ref="${range}"/>${hyperlinks}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>`);
  if(links.length)zip.file('xl/worksheets/_rels/sheet1.xml.rels',XML+`<Relationships xmlns="${PACKAGE_REL}">`+links.map((l,i)=>`<Relationship Id="link${i+1}" Type="${REL}/hyperlink" Target="${xml(l.url)}" TargetMode="External"/>`).join('')+'</Relationships>');
  zip.file('xl/styles.xml',STYLES);
  zip.file('xl/workbook.xml',XML+`<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="선택 기사" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',XML+`<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`);
  zip.file('_rels/.rels',XML+`<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  const periodText=typeof period==='object'&&period!==null?`${period.start||''} ~ ${period.end||''}`:String(period??'');
  // Metadata cannot use SpreadsheetML character escapes, so remove XML-invalid
  // code units while preserving valid supplementary Unicode characters.
  const metadata=v=>xml(String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udfff]/gu,''));
  zip.file('docProps/core.xml',XML+`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${metadata(title)}</dc:title><dc:subject>${metadata(periodText)}</dc:subject><dc:creator>RDAscraper</dc:creator></cp:coreProperties>`);
  zip.file('[Content_Types].xml',XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
}
