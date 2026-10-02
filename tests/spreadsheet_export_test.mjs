import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {makeWorkbook} from '../web/spreadsheet-writer.mjs';
import {toCSV} from '../web/core.mjs';

const require=createRequire(import.meta.url);
const JSZip=require('../web/vendor/jszip.min.js');
const sax=require('../web/vendor/sax.js');
globalThis.window={JSZip};
const headers=['선택','번호','기사일','날짜 근거','매체','매체 분류','매체 점수','제목','원문 URL','일치도(0~100)','원문 확인','확인 사항','검색원','일치 핵심어','발췌문','예시 여부'];

function parseXML(source){
  const parser=sax.parser(true,{xmlns:true}),stack=[];let root;
  parser.onopentag=tag=>{
    const node={name:tag.name,attrs:Object.fromEntries(Object.entries(tag.attributes).map(([key,v])=>[key,v.value])),children:[],text:''};
    if(stack.length)stack.at(-1).children.push(node);else root=node;
    stack.push(node);
  };
  parser.ontext=text=>{if(stack.length)stack.at(-1).text+=text;};
  parser.onclosetag=()=>stack.pop();
  parser.write(source).close();return root;
}
function all(node,name){return [...(node.name===name?[node]:[]),...node.children.flatMap(child=>all(child,name))];}
async function workbook(rows,options){
  const bytes=await makeWorkbook(rows,options);
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const files={};
  for(const [name,file] of Object.entries(zip.files))if(!file.dir)files[name]=await file.async('string');
  // Parse every XML/relationship part independently, rather than only matching
  // strings from the implementation. Malformed escaping must fail this check.
  const parsed=Object.fromEntries(Object.entries(files).map(([name,text])=>[name,parseXML(text)]));
  return {bytes,files,parsed,sheet:parsed['xl/worksheets/sheet1.xml']};
}

test('CSV has one physical row per record and keeps UTF-8 BOM, quotes and formula protection',()=>{
  const csv=toCSV([['제목','발췌문'],['첫 줄\r\n둘째 줄\t   끝','"한글", 쉼표'],['\t\n=HYPERLINK("https://evil.invalid")','\u0000+SUM(1,2)'],['\r-1',' @SUM(2)']]);
  assert.equal(csv.charCodeAt(0),0xfeff);
  assert.equal(csv.split('\r\n').length,4);
  assert.equal(csv.replaceAll('\r\n','').includes('\n'),false);
  assert.equal(csv.includes('\t'),false);
  assert.ok(csv.includes('"첫 줄 둘째 줄 끝"'));
  assert.ok(csv.includes('""한글"", 쉼표'));
  for(const prefix of ['=HYPERLINK','+SUM','-1','@SUM'])assert.ok(csv.includes('"\''+prefix));
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(csv)),csv.slice(1));
});

test('XLSX has stable columns, fixed row heights, fixed widths, frozen header and autofilter',async()=>{
  const longKorean='농촌진흥청 연구 결과와 농업 현장 적용 사례를 확인합니다. '.repeat(100);
  const row=['Y',101,'2026-09-18','원문 게시일','농업신문','전문지',5,'긴 제목 '+longKorean,'https://www.rda.go.kr/news?id=1&name=%ED%95%9C%EA%B8%80',96,'확인','특이 사항 없음','검색원','농업, 연구',longKorean,'실제 수집'];
  const input=[headers,row,[...row.slice(0,7),'짧은 기사',...row.slice(8)]];
  const snapshot=structuredClone(input);
  const {sheet,parsed,files}=await workbook(input,{title:'한글 <검수> & "결과" 🌾',period:{start:'2026-09-01',end:'2026-09-18'}});
  assert.deepEqual(input,snapshot,'export must not mutate shared CSV data');
  const rows=all(sheet,'row');
  assert.equal(rows.length,3);
  for(const row of rows){assert.equal(row.attrs.ht,'30');assert.equal(row.attrs.customHeight,'1');assert.equal(all(row,'c').length,16);}
  assert.deepEqual(all(rows[0],'t').map(node=>node.text),headers);
  assert.equal(all(sheet,'pane')[0].attrs.state,'frozen');
  assert.equal(all(sheet,'pane')[0].attrs.ySplit,'1');
  assert.equal(all(sheet,'autoFilter')[0].attrs.ref,'A1:P3');
  assert.equal(all(sheet,'col').length,16);
  for(const column of all(sheet,'col')){assert.equal(column.attrs.customWidth,'1');assert.ok(Number(column.attrs.width)>=9);}
  const styles=parsed['xl/styles.xml'];
  assert.equal(all(styles,'font').length,3);
  assert.equal(all(styles,'b').length,3);
  assert.ok(all(styles,'name').every(node=>node.attrs.val==='맑은 고딕'));
  for(const alignment of all(styles,'alignment')){assert.equal(alignment.attrs.vertical,'center');assert.equal(alignment.attrs.wrapText,'0');}
  assert.equal(all(rows[1],'c').find(c=>c.attrs.r==='O2').children[0].children[0].text,longKorean);
  assert.equal(all(rows[1],'c').find(c=>c.attrs.r==='B2').attrs.t,'n');
  assert.ok(files['docProps/core.xml'].includes('🌾'));
  assert.equal(all(parsed['docProps/core.xml'],'dc:subject')[0].text,'2026-09-01 ~ 2026-09-18');
});

test('untrusted strings remain literal cells without formulas, macros, XML injection or lost Korean',async()=>{
  const values=['=HYPERLINK("https://evil.invalid","악성")','+SUM(1,2)','-1+1','@SUM(A1)','\t=1+1','</t></is></c><c r="A99"><f>1+1</f></c>','한글 "따옴표" & <태그>\r\n다음 줄\t🌾','_x000A_와 _x0041_ 원문','금지\u0000문자\u000b와\uffff','https://example.com/?a=%22&b=%3Ctest%3E'];
  const {sheet,parsed,files}=await workbook([values.map((_,i)=>'열 '+i),values],{title:'<title> & "인용"\u0000'});
  assert.equal(all(sheet,'f').length,0);
  assert.equal(all(sheet,'c').length,values.length*2);
  const cells=all(sheet,'row')[1].children;
  for(const cell of cells)assert.equal(cell.attrs.t,'inlineStr');
  for(let i=0;i<7;i++)assert.equal(all(cells[i],'t')[0].text,values[i]);
  assert.equal(all(cells[7],'t')[0].text,'_x005F_x000A_와 _x005F_x0041_ 원문');
  assert.equal(all(cells[8],'t')[0].text,'금지_x0000_문자_x000B_와_xFFFF_');
  assert.equal(all(parsed['docProps/core.xml'],'dc:title')[0].text,'<title> & "인용"');
  assert.equal(Object.keys(files).some(name=>/vba|macro|externalLinks|connections/i.test(name)),false);
  assert.equal(files['[Content_Types].xml'].includes('macroEnabled'),false);
  assert.equal(all(parsed['xl/worksheets/_rels/sheet1.xml.rels'],'Relationship')[0].attrs.Target,values[9]);
});

test('only public HTTP(S) URLs become clickable, while every original URL is retained',async()=>{
  const safe=['https://www.rda.go.kr/news?key=한글&n=1','http://news.example.com/article?id=2','https://8.8.8.8/news','https://[2606:4700:4700::1111]/news'];
  const unsafe=['javascript:alert(1)','file:///C:/Windows/system.ini','data:text/html,test','https://user:pass@example.com/','https://localhost/','http://127.0.0.1/','http://2130706433/','http://0x7f000001/','http://10.0.0.1/','http://172.16.2.1/','http://192.168.1.1/','http://169.254.169.254/','http://100.64.1.1/','http://198.18.1.1/','http://192.0.2.1/','http://203.0.113.1/','http://224.0.0.1/','http://[::1]/','http://[::ffff:127.0.0.1]/','http://[fc00::1]/','http://[fe80::1]/','http://[2001:db8::1]/','http://[2002:7f00:1::]/','https://machine.local/','https://intranet/','https://news.example.com:8443/','https://example.com/\nattack','https://example.com/\\attack','https://example.com/%22"/><Relationship Target="file:///secret"/>'];
  const values=[...safe,...unsafe];
  const {sheet,parsed}=await workbook([['원문 URL'],...values.map(url=>[url])]);
  assert.deepEqual(all(sheet,'row').slice(1).map(row=>all(row,'t')[0].text),values);
  const links=all(parsed['xl/worksheets/_rels/sheet1.xml.rels'],'Relationship');
  assert.equal(links.length,safe.length);
  assert.deepEqual(links.map(node=>node.attrs.Target),safe.map(url=>new URL(url).href));
  for(const link of links){assert.equal(link.attrs.TargetMode,'External');assert.ok(link.attrs.Type.endsWith('/hyperlink'));}
  assert.deepEqual(all(sheet,'hyperlink').map(link=>link.attrs.ref),safe.map((_,i)=>'A'+(i+2)));
});

test('empty rows, inconsistent columns and overlong cells fail explicitly; header-only workbook is valid',async()=>{
  await assert.rejects(makeWorkbook([]),/표가 없습니다/);
  await assert.rejects(makeWorkbook([['열'],['값','초과']]),/열 수/);
  await assert.rejects(makeWorkbook([['열'],['가'.repeat(32768)]]),/32,767/);
  const {sheet,files}=await workbook([['원문 URL']]);
  assert.equal(all(sheet,'row').length,1);
  assert.equal(all(sheet,'autoFilter')[0].attrs.ref,'A1:A1');
  assert.equal(files['xl/worksheets/_rels/sheet1.xml.rels'],undefined);
});
