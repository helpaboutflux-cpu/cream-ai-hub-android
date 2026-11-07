# Cream ai Hub — Android Native App

> **Autonomous AI SuperApp for Everyone**  
> 공식 웹: [doteai.base44.app](https://doteai.base44.app) · [Cream Motion Studio (Reels Showcase)](https://github.com/helpaboutflux-cpu/cream-ai-hub-android)

---

##  프로젝트 소개

Cream ai Hub의 공식 안드로이드 네이티브 클라이언트 애플리케이션입니다.  
웹 서비스(Base44)의 `floraChat` 백엔드 엔진과 실시간 직통 통신하며, 안드로이드 시스템 레벨의 다양한 편의 기능을 제공합니다.

- **현재 버전**: v1.8 (Release APK 6.2MB)
- **최소 지원 사양**: Android 10 (API 29) 이상 (Android 14+ 타일 및 어댑티브 아이콘 최적화)

---

##  핵심 기능

1. **원터치 콘텐츠 공유 & 분석**
   - 웹 브라우저 링크 및 텍스트 공유 시 Creamy 채팅 화면으로 직통 연결
   - 갤러리 이미지 공유 시 1024px 스마트 압축 후 온디바이스 OCR 및 질답 자동 첨부

2. **시스템 레벨 통합 (OS Integration)**
   - **상단바 빠른 설정(Quick Settings) 타일**: 어디서든 플로팅 창으로 즉시 Cream ai 호출
   - **홈 화면 위젯**: 다크/라이트 모드 자동 연동되는 미니멀 알약 검색 위젯
   - **텍스트 선택 메뉴 (PROCESS_TEXT)**: 어디서든 텍스트 드래그 후 'Cream ai로 질문' 메뉴 지원
   - **매일 모닝 브리핑 푸시**: 매일 아침 맞춤 요약 알림 및 백그라운드 생성 완료 알림

3. **Cream Motion Studio 연동**
   - 인스타그램 릴스 및 쇼츠용 60FPS 자율 모션 비디오 렌더러 지원
   - *"Cook for Cream ai"* 시네마틱 릴스 쇼릴 탑재

---

## 기술 스택 및 빌드

- **언어**: Kotlin, Java
- **UI**: Android SDK, RemoteViews (Widget), Custom Floating Window
- **CI/CD**: GitHub Actions 클라우드 무인 빌드 (`.github/workflows/build-apk.yml`)
- **API 연동**: Base44 `floraChat` Backend Direct API, WebAppInterface 자바스크립트 브릿지

---

##  라이선스

Copyright © 2026 Minjung Kim (@helpaboutflux-cpu). All rights reserved.
