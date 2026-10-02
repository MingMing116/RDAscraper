# 원문 PDF 오류 검토와 안정 배포 결정

검토 대상: 65.2.0의 Windows 원문 PDF 인쇄. 반영 배포: 65.3.0.

## 확인된 실패 지점

사용자가 제시한 네 기사 모두 `PDF 변환 브라우저가 시작되지 않았습니다`라는 동일한 오류가 발생했다. 이 문구는 실행 요청과 Windows 프로세스 관리 설정 이후, 브라우저가 준비 정보를 생성하기 전에 종료됐을 때 표시된다. 기사 웹페이지를 불러와 인쇄하는 단계에는 도달하지 못했다.

이전 구현은 브라우저의 표준 오류 출력과 종료 오류를 버렸다. 따라서 현재 메시지로는 종료 코드나 구체적인 종료 원인을 확정할 수 없다. 이러한 진단 정보 부족은 확인된 구현상의 한계다.

## 기술적으로 해결 가능한가

브라우저를 이용한 원문 PDF 인쇄 자체는 가능하다. 다만 사용자 PC의 브라우저 상태, 실행 정책, 보안 제품 개입 여부는 확인되지 않았다. Microsoft Edge는 headless 실행과 원격 디버깅을 제한하는 관리 정책을 제공한다. 해당 정책이 사용자 PC에 적용됐다고 단정하지 않는다.

Chrome의 기본 프로필 디버깅 제한은 이전 구현의 별도 임시 프로필 사용으로 대응하고 있어, 이번 실패 원인으로 지목할 근거가 없다. 실행 플래그를 임의로 변경하거나 보호 기능을 해제해 해결됐다고 제시하지 않는다.

다시 도입하려면 크기가 제한된 진단 로그와 종료 코드를 보존하고, 실제 Windows에서 브라우저 준비부터 한 기사 인쇄까지 확인해야 한다. 이번 제작 환경에서는 해당 PC에서의 해결 여부를 확인할 수 없었다.

## 이번 배포의 변경

- 원문 PDF와 보조 추출 본문 PDF 버튼 및 관련 안내 제거.
- 원문 PDF 서버 API, 인쇄 브라우저 실행 코드, 원문 페이지 가공 모듈, pdf-lib 병합 번들 제거.
- 검수 목록 PDF는 프로그램에 포함된 한글 글꼴과 PDF 작성 코드로 생성. 별도 인쇄용 브라우저나 기사 재접속 없이 저장.
- 선택한 기사는 기존 번호의 오름차순으로 정렬. 미선택 번호와 원문 링크 유지.
- XLSX의 고정 행 높이 30pt와 CSV 데이터 저장 유지.
- 기사 본문 확인 및 직접 보완은 검수와 작업 파일 보관 기능으로 유지.

검수 목록에는 기사 번호, 기사일, 매체, 제목, 발췌문, 확인 상태, 원문 링크가 포함된다. 기사 전체 웹페이지나 사진을 PDF로 복제하는 기능은 제공하지 않는다.

## 근거

- [Microsoft Edge HeadlessModeEnabled](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/HeadlessModeEnabled)
- [Microsoft Edge RemoteDebuggingAllowed](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/RemoteDebuggingAllowed)
- [Chrome 원격 디버깅과 별도 프로필](https://developer.chrome.com/blog/remote-debugging-port)
- [Windows JobObject 프로세스 연결](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)

실제 검증 범위는 [검증 기록](VALIDATION_KO.md)에 기재한다. Windows 실행파일 빌드는 Windows 실기기 실행 검증을 대신하지 않는다.
