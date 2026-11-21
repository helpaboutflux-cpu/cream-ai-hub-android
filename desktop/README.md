# Creamy Browser for Windows

Cream ai Hub의 윈도우 PC용 독립 데스크탑 브라우저. Electron 기반으로 GitHub Actions 클라우드에서 빌드됩니다.

## 빌드 (로컬)

```
cd desktop
npm install
npm start
npm run build
```

빌드 결과물은 `desktop/dist/`에 생성됩니다.

- `Cream-ai-Hub-Windows-Setup.exe`: NSIS 인스톨러
- `Cream-ai-Hub-Windows-Portable.exe`: 포터블 실행 파일

## 빌드 (클라우드)

main 브랜치에 `desktop/` 변경을 푸시하면 `.github/workflows/build-windows.yml`이
windows-latest에서 NSIS와 포터블 타깃을 빌드하고 아티팩트로 업로드합니다.
수동 실행은 Actions 탭의 Build Windows Desktop에서 workflow_dispatch로 가능합니다.

## 구성

- `main.js`: 메인 프로세스. 프레임리스 창, 세션(광고 차단, 다운로드), IPC, 미디어 추출(yt-dlp), RSS/환율/증시/날씨 프록시, PDF 저장, 브라우저 잠금(scrypt 해시 저장·검증)
- `sync.js`: LK 계정 · Google Drive 동기화 엔진. 127.0.0.1 1회성 인증 브리지(랜덤 포트·1회성 state·5분 제한), Drive REST v3(drive.file) 폴더·파일 입출력, 상태 파일 `userData/creamy-sync.json`(0600)
- `sync-merge.js`: 북마크·방문기록·Lemon Pass 금고 병합 규칙(네트워크 없는 순수 함수)
- `adblock.js`: 광고/트래커 도메인 차단 목록과 onBeforeRequest 필터
- `translate.js`: 구글 gtx 번역 엔진 클라이언트(동시 8건, 캐시 포함)
- `preload.js`: 컨텍스트 브리지. 셸 페이지와 시작 페이지(file://)에만 노출 (잠금 API는 셸 페이지에서만)
- `renderer/`: 탭 스트립, 옴니박스, 사이드바, 4대 테마, 설정 패널, Lemon Pass 패널
- `renderer/pass-vault.js`: pass.html 과 같은 금고 암호화(PBKDF2-SHA256 250,000회 · AES-256-GCM)
- `assets/start_page.html`: 시작 페이지 대시보드(시계, 날씨, 뉴스, 환율, 증시, 바로가기, 커스텀 배경)
- `build/icon.ico`: 행성 로고 아이콘

## v1.2.1 변경 내역

- 다운로드 목록 오류 수정: 존재하지 않는 `session.getAllDownloads()`·`getUniqueId()` 호출을 걷어내고
  앱이 직접 다운로드 기록(`dl_...` id)을 들고 있도록 바꿨습니다. 다운로드 도중·완료·취소·중단
  상태가 모두 표시되고, 진행 중 항목은 `중지`, 완료 항목은 `열기`·`폴더`를 쓸 수 있습니다.
- 자동 업데이트: GitHub Releases(`releases/latest`)의 `creamy-vX.Y.Z` 태그를 앱 버전과 비교합니다.
  설정 > 업데이트에서 `자동 업데이트 확인`(기본 켜짐), `지금 확인`, 진행률, `지금 업데이트 설치`를 제공하고,
  새 버전이 있으면 화면 오른쪽 위에 인라인 배너를 띄웁니다. 설치판은 `creamy-browser-setup.exe`,
  무설치판(`PORTABLE_EXECUTABLE_FILE`)은 `creamy-browser-portable.exe`를 받아 SHA-256을 릴리즈 digest와
  대조한 뒤 실행하고 앱을 닫습니다.
- 툴바 오른쪽 LK 계정 프로필: 미로그인은 `로그인` 버튼(누르면 바로 인증 탭), 로그인 상태는 이니셜 원형
  배지와 인라인 드롭다운(이름·이메일, Drive 상태, 마지막 동기화, 지금 동기화, LK 계정 열기, 로그아웃).
- 설정의 사용자 이름 예시를 `예: 크리미 사용자`로 바꿨습니다.

## 주요 기능

- 크롬 PC형 탭 스트립: 파비콘, 제목 말줄임, 새 탭, 6색 탭 그룹(접기/펼치기, 이름·색상 변경)
- 옴니박스: 검색 제안(기록, 북마크, 구글 자동완성), SSL 표시, 페이지 번역 칩, 미디어 저장 칩
- 프레임리스 타이틀바: 최소화, 최대화/복원, 닫기, 창 드래그
- 사이드바: Creamy AI 질답, My Bag 보관함, 북마크 관리자, 다운로드 관리자, 전체 메뉴, 설정
- 4대 테마(기본 다크/라이트, 핑크 다크/라이트) + 커스텀 포인트 컬러
- 시작 페이지: 시계, 시간대 인사말, Open-Meteo 날씨, 구글 뉴스 RSS, 환율, 증시 지수, 커스텀 배경
- 페이지 번역: 본문 최대 2,000 노드 수집 후 일괄 번역, 원문 복원 지원
- 클린 광고 차단: 세션 webRequest 필터링
- 유튜브: 백그라운드 오디오(visibility 락 주입), PIP, MP4/M4A 추출(yt-dlp 자동 다운로드)
- PDF 저장: printToPDF 기반 고화질 저장
- 컨텍스트 메뉴: 링크 새 탭 열기, 이미지/동영상/음원 저장, 페이지 번역, PDF 저장, My Bag 보관
- 브라우저 잠금: 앱을 열면 잠금 화면이 먼저 표시되고 비밀번호를 넣어야 브라우저가 열립니다. 테마(다크/라이트/핑크/커스텀 포인트)가 잠금 화면에도 그대로 적용됩니다.

## 브라우저 잠금
- 설정 > 브라우저 잠금에서 비밀번호를 설정하면 다음 실행부터 잠금 화면이 먼저 뜹니다.
- 비밀번호는 `userData/creamy-lock.json`에 `scrypt`(랜덤 16바이트 salt, 64바이트 키) 해시로만 저장되며 평문은 어디에도 남지 않습니다. 해시·salt는 렌더러로 전달되지 않습니다.
- 잠금 해제 전에는 탭·주소창·웹뷰·북마크가 만들어지지 않고 잠금 화면만 표시됩니다. 잠금 중에도 창 이동·최소화·닫기는 그대로 동작합니다.
- 설정에서 잠금 끄기·비밀번호 변경은 현재 비밀번호 확인이 필요하고, '지금 바로 잠그기'로 즉시 잠글 수 있습니다.
- 비밀번호를 잊으면 `creamy-lock.json`을 삭제해 잠금 설정을 초기화할 수 있습니다(비밀번호·잠금 상태만 초기화되고 다른 설정은 유지).

## LK 계정 · Google Drive 동기화 (v1.2.0, v1.2.1에서 인앱 탭으로 변경)

- 설정 > LK 계정 · 동기화에서 `계정 연결`을 누르거나 툴바 오른쪽의 `로그인` 버튼을 누르면,
  크리미 브라우저 안의 새 탭에서 `desktop-auth.html`(Soft Hub)이 열립니다. 그 페이지에서
  LK 계정 로그인과 Google Drive 연결을 마치면, 앱이 연 1회성 로컬 서버(`127.0.0.1`, 랜덤 포트,
  1회성 state, 5분 제한)로 세션과 Drive 토큰을 받아 저장하고 인증 탭을 스스로 닫아 원래 탭으로 돌아갑니다.
  인증 탭을 직접 닫으면 대기 중인 연결도 함께 취소됩니다.
- Google Cloud Console 의 Redirect URI 는 그대로입니다 — Google 로그인 창은 기존
  GitHub Pages 출처에서 열리고 결과만 로컬 루프백으로 POST 합니다. webview용 UA는 Electron 토큰을
  뺀 Chrome UA입니다. 인증 화면이 열리지 않을 때만 쓰는 시스템 브라우저 보조 링크가 프로필 메뉴에 있습니다.
- `지금 동기화`(또는 앱을 열 때 자동 1회)는 내 드라이브의 `Soft Hub Backup` 폴더에
  `creamy-browser-sync.json`(북마크·방문기록 병합본)을 쓰고, 병합 결과를 이 PC에 반영합니다.
  같은 URL 은 더 최근 항목을 남기고, 방문기록은 최대 500개까지 최신 순으로 유지합니다.
- `soft-hub-snapshot.json`(Soft Hub 웹 백업)은 건드리지 않습니다. 단, 아래 금고 동기화를
  켜면 그 안의 `lemon_pass_vault` 키 하나만 갱신하고 나머지 키·메타는 그대로 보존합니다.
- 토큰은 약 1시간 뒤 만료되며, 설정에 `Drive 만료`가 표시되면 `계정 연결`을 다시 누르면
  동의 화면 없이 갱신됩니다.

## Lemon Pass (비밀번호 금고)

- 사이드바의 열쇠 버튼으로 엽니다. 마스터 비밀번호로 금고를 만들거나 열고, 항목을
  추가·삭제하고 아이디/비밀번호를 복사하거나 현재 탭의 로그인 칸에 자동 입력합니다.
- 금고 형식은 `pass.html` 과 100% 같습니다(PBKDF2-SHA256 250,000회, salt 16바이트,
  AES-256-GCM, iv 12바이트). 그래서 웹에서 만든 금고를 PC에서, PC에서 만든 금고를
  웹에서 그대로 열 수 있습니다. 마스터 비밀번호와 평문은 어디에도 저장되지 않습니다.
- `Lemon Pass 비밀번호 동기화`는 기본 꺼짐입니다. 켜면 금고 암호문(ct) 그대로 Drive
  백업에 포함하고, 더 최근에 저장된 쪽(meta.updated)을 기준으로 양쪽을 맞춥니다.
  끄면 다음 백업부터 금고가 빠지고 이 PC에만 남습니다.
