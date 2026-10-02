# RDAscraper

**보도자료 입력 → 뉴스 검색 → 기사 검수 → 엑셀·CSV·PDF 저장.** 설치 없이 `RDAscraper.exe`로 실행하는 Windows 64비트 프로그램입니다. 화면은 PC의 브라우저에서 열리고 문서 분석과 한국어·영어 OCR은 PC에서 처리합니다.

**[Windows 실행용 ZIP 다운로드](https://github.com/MingMing116/RDAscraper/releases/latest/download/RDAscraper_Windows_x64.zip)** · [SHA-256](https://github.com/MingMing116/RDAscraper/releases/latest/download/SHA256SUMS.txt)

[사용 안내](README_KO.md) · [검수 목록 PDF](docs/REVIEW_PDF_KO.md) · [글자 크기·업데이트](docs/APPEARANCE_KO.md) · [보관 정보](PRIVACY.md) · [보안 정책](SECURITY.md) · [검증 기록](docs/VALIDATION_KO.md) · [변경 기록](CHANGELOG.md) · [GitHub 공개 절차](docs/PUBLISH_KO.md) · [기존 실행 오류 해결](docs/STARTUP_FIX_KO.md)

## 사용자 실행

1. 위 **Windows 실행용 ZIP 다운로드**를 누릅니다.
2. ZIP을 압축 해제하고 **RDAscraper.exe**를 실행합니다.
3. 문서를 선택하고 핵심어·기간을 확인한 뒤 기사를 검색합니다.

Windows 10/11 64비트, Edge 또는 Chrome이 필요합니다. Python·Node.js·Go·.NET 또는 별도 OCR 프로그램은 필요하지 않습니다. 검색·기사 수집에는 인터넷이 필요하며, 문서와 OCR을 처리하는 별도 중계 서버는 없습니다. HTTP(S) 프록시 설정이 있으면 그 경로를 유지합니다.

GitHub는 프로그램을 받는 곳입니다. **GitHub 페이지 안에서 EXE를 실행하지 않습니다.** 외부망 PC에서 다운로드가 허용된다면 해당 PC에서 내려받아 실행할 수 있습니다. GitHub Pages는 정적 웹사이트를 제공하므로 이 프로그램의 로컬 엔진을 대신 실행하지 않습니다. [GitHub Pages 설명](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## 주요 기능

- HWP/HWPX/PDF/TXT와 이미지에서 제목·본문·핵심어 추출
- 한국어·영어 로컬 OCR과 스캔 PDF 인식
- 기간별 뉴스 검색, 기사 URL 직접 추가, 날짜·제목·원문 검수
- 기사 번호 유지, 행 선택, 엑셀 XLSX(행 높이 30pt)·한글 CSV 저장
- 선택한 기사 정보를 기사 번호순으로 정리하는 검수 목록 PDF
- 부족한 본문 재수집과 사용자 본문 보완을 통한 화면 검수
- 작업 JSON 저장·불러오기, 자동 저장 설정, 저장본·실행 로그 삭제
- 내장 Noto Sans KR 굵은 글꼴, 창 너비에 맞춰 조절되는 글자·메뉴와 세 단계 글자 크기 선택

검색어는 검색 서비스에 전달됩니다. 불러온 작업의 검수 완료 표시는 초기화하며 자동 저장본은 평문입니다. 자세한 처리는 [PRIVACY.md](PRIVACY.md)에 설명합니다.

## 이번 배포: 65.3.1

공개 배포 전 점검에서 발견한 원본 업무자료명을 매체 기준표에서 제거했습니다. 398개 매체의 분류·점수와 기존 검색·검수·저장 기능은 유지합니다. 수정한 소스로 Windows 실행파일을 다시 빌드하고, 한 장 설명서와 시연 안내를 현재 기능에 맞춰 정리했습니다.

결과는 **엑셀 XLSX · 한글 CSV · 검수 목록 PDF**로 저장합니다. PDF는 선택한 기사 정보를 기존 기사 번호의 오름차순으로 정리하며, 원문 전체는 기사 링크에서 확인합니다. 별도의 기사 원문·추출 본문 PDF는 제공하지 않습니다. [검수 목록 PDF 사용 안내](docs/REVIEW_PDF_KO.md)

이번 배포에서 실제로 수행한 검사와 Windows 실기기 등 미확인 범위는 [검증 기록](docs/VALIDATION_KO.md)에 구분합니다. 공개 검증 자료에는 현재 시험·빌드·점검 범위의 요약을 포함하며, 과거 내부 검증·영상 제작 기록은 제외합니다. ZIP에는 과거 Git 이력이 들어 있지 않으며, 기존 원격 저장소의 과거 커밋까지 삭제·정리했다는 뜻은 아닙니다.

## 개발과 빌드

소스에는 화면, OCR 모델, 글꼴, 문서 처리 구성요소가 포함됩니다. Go가 이를 EXE에 내장합니다. 아래 도구는 개발자에게만 필요합니다.

| 목적 | 환경 |
| --- | --- |
| 로컬 엔진 시험 및 Windows 빌드 | Go 1.27.1 |
| 화면·문서·OCR 자동 시험 | Node.js 24.3 이상 24.x, npm |
| 실제 브라우저 통합 시험 | npm 잠금 파일의 Playwright와 시험용 Chromium |
| 합성 시험 문서 재생성 | Python, ReportLab, Poppler. 기존 시험 실행에는 불필요 |

의존성 다운로드에는 인터넷이 필요합니다. Go 도구 버전은 [공식 릴리스](https://go.dev/dl/)를 기준으로 고정했습니다.

```sh
go mod download
go mod verify
go test -buildvcs=false ./...
npm ci
npm test
npm run test:security
npm run test:exports
npm run test:ocr
```

실제 Chromium 통합 시험은 [시험 실행 안내](tests/README.md)의 환경별 명령으로 실행합니다. Playwright와 시험용 브라우저는 개발·CI 도구이며 사용자 EXE에 설치 요구사항을 추가하지 않습니다.

Windows 실환경에서 설치된 Edge로 공개 뉴스 검색부터 원문 확인·검수 목록 PDF 저장까지 검사하려면 `npm ci`와 EXE 빌드 후 다음 명령을 사용합니다. 이 명령은 실제 응답을 사용하며 검색 실패를 합성 응답으로 바꾸지 않습니다.

```powershell
.\tests\windows_e2e.ps1 -Binary dist/RDAscraper.exe -Headed
```

화면 없이 실행하려면 `-Headed`를 생략합니다. `-SyntheticOnly`는 별도 합성 응답 회귀시험이므로 실제 뉴스 수집 성공 근거로 사용하지 않습니다. 실제 실행 결과는 `tests/artifacts/live_browser/validation.json`에 남습니다.

Windows PowerShell에서 다음 명령으로 빌드합니다.

```powershell
.\build_windows.ps1
```

결과는 `dist/RDAscraper.exe`입니다. 이어 `.\package_windows.ps1`을 실행하면 설명서·제3자 라이선스·SHA-256을 포함한 `dist/RDAscraper_Windows_x64.zip`을 만듭니다. 직접 빌드할 때의 명령은 다음과 같습니다.

```powershell
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'
$env:CGO_ENABLED = '0'
go build -buildvcs=false -trimpath -ldflags '-s -w -H=windowsgui' -o dist/RDAscraper.exe .
```

소스에 Windows 아이콘·일반 사용자 권한 manifest·버전 정보가 든 `rsrc_windows_amd64.syso`가 포함됩니다. 이를 재생성하려면 빌드 전에 선택적으로 `.\build_resources.ps1`을 실행합니다. 이 스크립트는 고정된 `go-winres@v0.3.3`으로 임시 디렉터리에 결과를 만든 뒤 성공한 리소스만 교체합니다. 처음 실행할 때 도구 다운로드를 위한 인터넷이 필요하며, 관리자 권한을 요청하는 manifest를 만들지 않습니다.

화면과 출력 PDF에는 배포 버전을 표시하지 않습니다. 소스·변경 기록의 버전은 재현과 배포 파일 구분을 위한 값입니다.

## 자동 검사

`.github/workflows/ci.yml`은 pull request, `main`/`master` push 또는 수동 실행 시 다음 검사를 수행합니다.

| 작업 | 검사와 산출물 |
| --- | --- |
| Linux | Go 모듈 검증·시험·vet, `npm ci`, 핵심 로직·뉴스·화면·재시작·문서·보안·OCR 시험, 실제 Chromium 통합 시험 |
| Windows | Go 모듈 검증·시험·vet, Windows x64 EXE 빌드와 실제 Chromium 통합 시험, 실행용 ZIP과 SHA-256 |

Windows 산출물은 Linux 검사도 통과한 실행에서만 업로드합니다. `release.yml`은 **수동 실행**으로 같은 검사를 수행합니다. 일반 검사와 수동 후보 빌드는 읽기 권한으로 실행합니다. main에 `[publish-release]`가 포함된 커밋을 푸시하면 Linux·Windows 검사를 모두 통과한 뒤 해당 실행의 Windows ZIP과 SHA-256만 GitHub Release에 게시합니다. 이 게시 작업에만 `contents: write`와 `actions: read` 권한을 부여합니다. 기존 Release는 덮어쓰지 않습니다. 웹사이트는 배포하지 않습니다. 다른 검사 작업은 저장소 읽기로 제한하고 외부 Actions는 확인한 커밋 SHA에 고정했습니다. npm·Go·Actions 변경은 Dependabot이 주기적으로 제안합니다. [GitHub Actions 보안 지침](https://docs.github.com/en/actions/reference/security/secure-use)

이 workflow는 실행 가능한 설정으로 준비했으며 이 패키지를 만드는 과정에서 원격 GitHub Actions를 실행한 것은 아닙니다. 자동 시험 통과와 사용자 PC의 실제 실행 확인은 구분합니다. 로컬에서 수행한 시험, 보안 회귀시험 범위와 Windows 실기기 확인 여부는 [검증 기록](docs/VALIDATION_KO.md)에 있습니다.

`.github/workflows/live-windows.yml`의 **Windows live news verification**은 별도 수동 실행입니다. Windows EXE와 설치된 Edge로 실제 공개 뉴스 검색·원문 확인·검수 목록 PDF 저장을 검사하고 성공 또는 실패 증거를 산출물에 남깁니다. 일반 CI의 합성 뉴스 시험과 목적이 다르며, 이 workflow도 아직 원격 실행하지 않았습니다.

## GitHub 공개 절차

1. 이 소스 폴더의 내용으로 저장소를 구성합니다. `.github`, `.gitignore`, 잠금 파일과 제3자 라이선스를 포함하고 개인 작업 파일과 과거 검토용 원본 문서는 넣지 않습니다.
2. 저장소에서 Actions를 실행하고 결과를 확인합니다. **Prepare release candidate**를 수동 실행하면 같은 검사를 거친 Windows 파일을 받을 수 있습니다.
3. Windows PC 또는 **Windows live news verification**에서 실제 실행·공개 뉴스 검색·원문 확인·검수 목록 PDF 저장을 검사합니다. 합성 응답 회귀시험과 구분하여 실행파일 해시·실행 환경·결과를 배포 기록에 남깁니다.
4. **Releases → Draft a new release**에서 태그와 변경 내용을 정하고 검증된 실행용 ZIP과 SHA-256, 배포 안내와 제3자 라이선스 자료를 첨부합니다.
5. 첨부 파일과 설명을 확인한 뒤 공개합니다. 실행용 파일은 Release 자산으로 배포하고 자동 생성되는 ‘Source code’ ZIP과 구분합니다.

공식 배포 저장소는 [MingMing116/RDAscraper](https://github.com/MingMing116/RDAscraper)입니다. 이 저장소의 Releases에서 Windows 실행용 ZIP과 해시를 제공합니다. 최초 게시 시에는 자동 검사와 Windows 빌드가 끝난 후 다운로드 파일이 표시됩니다. 별도 프로젝트 전체 라이선스는 아직 선택하지 않았으며 제3자 코드·글꼴·모델은 각 라이선스를 유지합니다. [구성요소와 라이선스](docs/THIRD_PARTY.md)

## 데이터와 제한

398개 매체 분류·점수 기준표는 프로그램과 소스에 포함됩니다. 담당자 정보가 있던 시험 문서는 합성 자료로 교체했습니다. 사용자가 첨부한 실제 기사 PDF·검수 목록 PDF·CSV·XLSX와 작업 파일, 해당 입력 자료의 해시·크기·추출 결과 기록은 공개 소스에 포함하지 않습니다. 자동 시험용 HWP/HWPX 일부는 추출기 확인을 위한 최소 구조이므로 모든 한글 문서 편집 기능을 검증하는 자료는 아닙니다.

검색 제공 범위·사이트 접근 제한에 따라 기사 누락과 본문 수집 실패가 있을 수 있습니다. 프로그램은 접근 제한을 해제하지 않습니다. 실행파일은 코드 서명되지 않았습니다. 사용 한계는 [사용 안내](README_KO.md)를 참고하세요.
