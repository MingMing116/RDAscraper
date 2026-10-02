"""Create contact-free parser fixtures from synthetic text only.

HWP/HWPX files intentionally contain the minimal structures read by this app;
they test extraction, not full Hancom editor compatibility. PDF and OCR fixtures
are ordinary viewable PDFs/PNGs. No original press release is read or copied.
Development dependencies: reportlab, pdftoppm (Poppler).
"""
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import zipfile
from xml.sax.saxutils import escape

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / 'tests'
FIXTURES = HERE / 'fixtures'
OCR = HERE / 'ocr'
DATE = '2026-01-05'
NOTICE = '공개용 합성 시험 문서입니다.'
CASES = [
    ('synthetic_breeding', '농촌진흥청 합성 디지털육종 자료 공개',
     '디지털육종 유전체 유전형 희귀변이 전사체 대사체 분자표지 품종선발 데이터표준화 품질검사 오믹스 생육특성 기후변화 스마트팜 병해충 종자 수확량 참조서열 결측치 유전자형 내병성 재현성 탐색 통합조회'),
    ('synthetic_materials', '농촌진흥청 합성 식물 소재 분석 결과 공개',
     '기능성소재 조직배양 세포배양 배양조건 광합성 대사체 전사체 효소활성 생육특성 추출물 발아율 양분흡수 환경반응 내병성 종자 자원선발 품질검사 재현성 표준화 생물량 분자표지 유전체 배양액 통합조회'),
    ('synthetic_genome', '농촌진흥청 합성 유전체 분석 방법 공개',
     '유전체 유전형 희귀변이 참조서열 결측치 전사체 대사체 분자표지 유전자형 후보유전자 오믹스 재현성 데이터표준화 품질검사 품종선발 연관분석 염색체 변이탐색 내병성 생육특성 종자 수확량 통합조회 교차검증'),
]

def paragraphs(title, terms):
    words = terms.split()
    rows = ['보도자료', '배포 2026.01.05.', title, NOTICE]
    for i in range(9):
        group = [words[(i*5+j) % len(words)] for j in range(8)]
        rows.append(
            '농촌진흥청은 합성 작물 자료를 이용하여 ' + ', '.join(group) + ' 정보를 비교한다. '
            '시험 데이터는 문서 읽기와 핵심어 추출 결과를 확인하기 위해 새로 작성했다. '
            '동일한 내용의 여러 파일 형식에서 제목과 배포일이 유지되는지 확인한다. '
            '분석에 쓰인 수치와 설명은 예시이며 실제 연구 결과를 나타내지 않는다.'
        )
    return rows

def record(tag, payload, level=0):
    n = len(payload)
    if n < 4095:
        return struct.pack('<I', tag | (level << 10) | (n << 20)) + payload
    return struct.pack('<II', tag | (level << 10) | (4095 << 20), n) + payload

def hwp_bytes(rows):
    # A fresh CFB v3 container. Large-stream storage avoids mini-stream ambiguity.
    end, free, fat_sector = 0xfffffffe, 0xffffffff, 0xfffffffd
    file_header = bytearray(4096)
    signature = b'HWP Document File'
    file_header[:len(signature)] = signature
    struct.pack_into('<II', file_header, 32, 0x05000300, 0)
    section = bytearray()
    for i, row in enumerate(rows):
        text = (row + '\r').encode('utf-16le')
        section += record(66, struct.pack('<IIHBBHHHI', len(text)//2, 0, 0, 0, 0, 1, 0, 0, i))
        section += record(67, text, 1)
        section += record(68, struct.pack('<II', 0, 0), 1)
    section += bytes(max(4096, (len(section)+511)//512*512)-len(section))
    n_header, n_section = 8, len(section)//512
    first_header, first_section = 1, 9
    fat_id = first_section+n_section
    if fat_id >= 128:
        raise ValueError('fixture too large for single-FAT container')
    header = bytearray(512)
    header[:8] = bytes.fromhex('d0cf11e0a1b11ae1')
    struct.pack_into('<HHHHH', header, 24, 0x003e, 3, 0xfffe, 9, 6)
    struct.pack_into('<IIIIIIIII', header, 40, 0, 1, 0, 0, 4096, end, 0, end, 0)
    struct.pack_into('<109I', header, 76, fat_id, *([free]*108))
    def entry(name, kind, start=end, size=0, child=free, right=free):
        value = bytearray(128)
        label = (name+'\0').encode('utf-16le')
        value[:len(label)] = label
        struct.pack_into('<HBBIII', value, 64, len(label), kind, 1, free, right, child)
        struct.pack_into('<IQ', value, 116, start, size)
        return value
    directory = b''.join([
        entry('Root Entry', 5, child=1),
        entry('FileHeader', 2, first_header, len(file_header), right=2),
        entry('BodyText', 1, child=3),
        entry('Section0', 2, first_section, len(section)),
    ])
    fat = [free]*128
    fat[0] = end
    for start, count in [(first_header,n_header),(first_section,n_section)]:
        for s in range(start,start+count):
            fat[s] = s+1 if s < start+count-1 else end
    fat[fat_id] = fat_sector
    return bytes(header)+directory+file_header+section+struct.pack('<128I', *fat)

def hwpx_file(path, rows):
    body = ''.join(
        '<hp:p id="%d" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>%s</hp:t></hp:run></hp:p>'
        % (i, escape(row)) for i,row in enumerate(rows)
    )
    xml = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'+body+'</hs:sec>'
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('mimetype','application/hwp+zip',compress_type=zipfile.ZIP_STORED)
        z.writestr('Contents/section0.xml',xml)
        z.writestr('Preview/PrvText.txt','\n'.join(rows))

def wrapped(text, width, size):
    line = ''
    for word in text.split():
        candidate = (line+' '+word).strip()
        if line and pdfmetrics.stringWidth(candidate,'Fixture',size)>width:
            yield line
            line = word
        else:
            line = candidate
    if line:
        yield line

def pdf_file(path, rows):
    c = Canvas(str(path),pagesize=A4,invariant=1)
    c.setTitle(rows[2]);c.setAuthor('RDAscraper');c.setSubject('Synthetic extraction fixture')
    width,height = A4
    c.setFillColorRGB(.12,.25,.18)
    for text,size,y in [(rows[0],12,height-43),(rows[1],10,height-65),(rows[2],17,height-99),(rows[3],10,height-122)]:
        c.setFont('Fixture',size);c.drawString(43,y,text)
    y = height-150
    c.setFillColorRGB(.08,.1,.08);c.setFont('Fixture',10)
    for paragraph in rows[4:]:
        for line in wrapped(paragraph,width-86,10):
            if y<45:
                c.showPage();c.setFont('Fixture',10);y=height-43
            c.drawString(43,y,line);y-=14
        y-=7
    c.save()

def main():
    FIXTURES.mkdir(parents=True,exist_ok=True);OCR.mkdir(parents=True,exist_ok=True)
    pdfmetrics.registerFont(TTFont('Fixture',str(ROOT/'web/assets/NanumGothic-Bold.ttf')))
    for i,(stem,title,terms) in enumerate(CASES):
        rows=paragraphs(title,terms)
        assert len('\n'.join(rows))>1000
        hwpx_file(FIXTURES/(stem+'.hwpx'),rows)
        if i<2:
            (FIXTURES/(stem+'.hwp')).write_bytes(hwp_bytes(rows))
            pdf_file(FIXTURES/(stem+'.pdf'),rows)
    subprocess.run(['pdftoppm','-f','1','-singlefile','-r','180','-png',str(FIXTURES/'synthetic_breeding.pdf'),str(OCR/'scanned_press')],check=True)
    c=Canvas(str(OCR/'scanned_press.pdf'),pagesize=A4,invariant=1)
    c.setTitle('Synthetic OCR fixture');c.setAuthor('RDAscraper')
    c.drawImage(ImageReader(str(OCR/'scanned_press.png')),0,0,width=A4[0],height=A4[1])
    c.save()
    files=sorted(FIXTURES.glob('*'))+[OCR/'scanned_press.png',OCR/'scanned_press.pdf']
    result={'source':'fresh synthetic text; no source press release or contact records',
            'minimal_parser_fixtures':['*.hwp','*.hwpx'],
            'files':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files if p.is_file()]}
    (HERE/'synthetic_fixture_manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print('Generated seven contact-free extraction fixtures and two OCR fixtures.')

if __name__=='__main__':
    main()
