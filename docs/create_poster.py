"""Generate the one-page Korean guide from bundled local assets.

Run from any working directory: python path/to/docs/create_poster.py
Development dependency: reportlab. No network requests are made.
The application does not need Python to run.
"""
from pathlib import Path
import argparse
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "docs" / "RDAscraper_Quick_Guide.pdf"
ASSETS = ROOT / "web" / "assets"
WIDTH, HEIGHT = A4
COLORS = {
    "dark": "#173E30", "green": "#237450", "ink": "#254838",
    "muted": "#466451", "light": "#EFF5EF", "line": "#D5E4D8",
    "white": "#FFFFFF", "paper": "#F8FAF5",
}


def create_guide(output=DEFAULT_OUTPUT):
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("GuideBold", str(ASSETS / "NanumGothic-Bold.ttf")))
    c = canvas.Canvas(str(output), pagesize=A4, invariant=1)
    c.setTitle("RDAscraper 한 장 사용 안내")
    c.setAuthor("RDAscraper")
    c.setCreator("RDAscraper guide generator")
    c.setSubject("자료 입력부터 검수 목록 PDF, XLSX, CSV 저장까지")
    c.setKeywords("RDAscraper, 검수 목록 PDF, XLSX, CSV")

    def rect(x, y, width, height, fill, radius=0, stroke=None):
        c.setFillColor(HexColor(fill))
        c.setStrokeColor(HexColor(stroke or fill))
        c.setLineWidth(.6)
        if radius:
            c.roundRect(x, HEIGHT-y-height, width, height, radius, fill=1, stroke=bool(stroke))
        else:
            c.rect(x, HEIGHT-y-height, width, height, fill=1, stroke=bool(stroke))

    def text(x, y, value, size=10, color=None):
        c.setFillColor(HexColor(color or COLORS["ink"]))
        c.setFont("GuideBold", size)
        c.drawString(x, HEIGHT-y, value)

    def lines(x, y, values, size=10, color=None, leading=16):
        for index, value in enumerate(values):
            text(x, y+index*leading, value, size, color)

    def chip(x, y, width, value):
        rect(x, y, width, 18, COLORS["white"], 4)
        text(x+6, y+12, value, 7.6, COLORS["green"])

    def check(x, y):
        rect(x, y, 9, 9, COLORS["green"], 2)
        c.setStrokeColor(HexColor(COLORS["white"]))
        c.setLineWidth(1.2)
        p = c.beginPath()
        p.moveTo(x+2, HEIGHT-y-4.4)
        p.lineTo(x+4, HEIGHT-y-6.4)
        p.lineTo(x+7, HEIGHT-y-2.4)
        c.drawPath(p)

    rect(0, 0, WIDTH, HEIGHT, COLORS["paper"])
    rect(0, 0, WIDTH, 143, COLORS["dark"])
    text(29, 37, "RDAscraper", 19, "#BCE3CB")
    text(164, 36, "QUICK GUIDE", 7.8, "#C3D7C8")
    lines(29, 76, ["보도자료에서 기사 검수까지,", "필요한 결과만 깔끔하게."], 21, COLORS["white"], 27)
    text(30, 129, "자료 입력  /  뉴스 검색  /  원문 확인  /  선택 저장", 9, "#C3D7C8")
    rect(435, 20, 130, 108, COLORS["white"], 13)
    c.drawImage(ImageReader(str(ASSETS / "isaki.png")), 449, HEIGHT-123,
                105, 105, mask="auto", preserveAspectRatio=True, anchor="c")

    rect(28, 157, WIDTH-56, 42, "#E4EFE4", 8)
    text(42, 174, "먼저 실행하기", 9, COLORS["green"])
    text(42, 190, "ZIP 압축 해제  →  RDAscraper.exe 더블클릭  →  실행 화면 열기", 9.5)

    steps = [
        ("01", 211, "자료 넣고 핵심어 확인",
         ["HWP · HWPX · PDF · TXT · 이미지 파일을 넣거나", "보도자료 제목·본문을 직접 입력하세요."],
         "추출된 제목·핵심어를 확인하고 필요하면 수정하세요."),
        ("02", 319, "날짜 맞추고 뉴스 검색",
         ["보도자료 배포일과 검색 종료일을 확인한 뒤", "‘뉴스 검색 시작’을 누르세요."],
         "검색어에 비공개 정보가 포함되지 않았는지 확인하세요."),
        ("03", 427, "기사 확인하고 선택",
         ["기사 번호·기사일·매체·제목을 살펴보세요.", "제목을 누르면 원문, 행을 누르면 선택·해제."],
         "‘확인 필요’ 기사는 실제 원문에서 날짜·내용을 검수하세요."),
    ]
    for index, (number, y, title, body, tip) in enumerate(steps):
        rect(28, y, WIDTH-56, 98, COLORS["white"], 10, COLORS["line"])
        text(43, y+31, number, 21, COLORS["green"])
        text(88, y+28, title, 14.5)
        lines(88, y+48, body, 9.1, leading=16)
        text(88, y+84, tip, 8.3, COLORS["muted"])
        x = 414
        rect(x, y+24, 137, 53, "#F0F5EF", 6)
        if index == 0:
            text(x+8, y+39, "파일 선택 또는 여기에 놓기", 7.7, COLORS["green"])
            for j, value in enumerate(["HWPX", "PDF", "이미지"]):
                chip(x+7+j*42, y+47, 38, value)
        elif index == 1:
            for j, value in enumerate(["+7일", "+14일", "+21일", "+28일"]):
                rect(x+5+j*32, y+30, 29, 16, COLORS["white"], 3)
                text(x+8+j*32, y+41, value, 6.9, COLORS["green"])
            rect(x+7, y+51, 123, 18, COLORS["green"], 4)
            text(x+35, y+64, "뉴스 검색 시작", 8, COLORS["white"])
        else:
            text(x+7, y+39, "선택", 6.7, COLORS["muted"])
            text(x+34, y+39, "번호", 6.7, COLORS["muted"])
            text(x+62, y+39, "제목 · 발췌문", 6.7, COLORS["muted"])
            check(x+9, y+50)
            text(x+38, y+59, "1", 8, COLORS["green"])
            text(x+61, y+59, "기사 원문 확인", 7.2, COLORS["green"])

    y = 535
    rect(28, y, WIDTH-56, 169, COLORS["white"], 10, COLORS["line"])
    text(43, y+31, "04", 21, COLORS["green"])
    text(88, y+28, "선택한 기사 저장", 14.5)
    text(88, y+48, "목록은 PDF로, 정리·분석은 XLSX 또는 CSV로 저장하세요.", 9.1)
    for index, (title, body) in enumerate([
        ("검수 목록 PDF", ["기사 번호 오름차순", "원문 링크로 기사 확인"]),
        ("엑셀 XLSX", ["행 높이 30pt 고정", "표를 정돈해 보관"]),
        ("한글 CSV", ["줄바꿈을 정리한 데이터", "다른 도구에서 활용"]),
    ]):
        x = 43+index*171
        rect(x, y+64, 166, 66, COLORS["green"] if index == 0 else COLORS["light"], 6)
        title_color = COLORS["white"] if index == 0 else COLORS["ink"]
        body_color = "#E5F1E7" if index == 0 else COLORS["muted"]
        text(x+12, y+83, title, 11, title_color)
        lines(x+12, y+102, body, 9, body_color, 14)
    text(44, y+151, "선택한 기사만 저장합니다. 번호 사이의 빈자리는 미선택 기사입니다.", 8.6, COLORS["muted"])

    rect(28, 716, WIDTH-56, 84, "#E9F0E7", 8)
    text(43, 734, "알아두면 편리해요", 10, COLORS["ink"])
    for y, label, body in [
        (752, "이미지 인식", "스캔 PDF·이미지는 OCR 사용 → 인식한 제목·핵심어 확인"),
        (770, "이어서 작업", "상단 ‘작업 저장’으로 보관 → ‘작업 불러오기’로 이어가기"),
        (788, "처음부터 시작", "작업을 먼저 저장한 뒤 → 왼쪽 상단 RDAscraper 로고 클릭"),
    ]:
        text(43, y, label, 8.7, COLORS["green"])
        text(129, y, body, 8.7)
    closing = "연구성과 홍보를 돕는 RDAscraper"
    text((WIDTH-pdfmetrics.stringWidth(closing, "GuideBold", 11))/2, 825, closing, 11, COLORS["green"])
    c.showPage()
    c.save()
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="PDF destination")
    args = parser.parse_args()
    print(create_guide(args.output))
