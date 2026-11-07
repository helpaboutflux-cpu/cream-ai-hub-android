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

- `main.js`: 메인 프로세스. 프레임리스 창, 세션(광고 차단, 다운로드), IPC, 미디어 추출(yt-dlp), RSS/환율/증시/날씨 프록시, PDF 저장
- `adblock.js`: 광고/트래커 도메인 차단 목록과 onBeforeRequest 필터
- `translate.js`: 구글 gtx 번역 엔진 클라이언트(동시 8건, 캐시 포함)
- `preload.js`: 컨텍스트 브리지. 셸 페이지와 시작 페이지(file://)에만 노출
- `renderer/`: 탭 스트립, 옴니박스, 사이드바, 4대 테마, 설정 패널
- `assets/start_page.html`: 시작 페이지 대시보드(시계, 날씨, 뉴스, 환율, 증시, 바로가기, 커스텀 배경)
- `build/icon.ico`: 행성 로고 아이콘

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
