# Activity Log

> 세션이 끊겨도 이 파일을 읽어 컨텍스트를 복원합니다.

## 현재 상태
- 완료 (Yoga V3 Backend Security Hardening)

## 작업 이력

## 2026-02-28 23:12 - Yoga V3 Backend Security Hardening
- 지시: Commander로부터 yoga-v3 서버 보안 강화 요청 (rate limiting + input validation)
- 수행:
  1. express-rate-limit, express-validator 패키지 설치
  2. middleware/rateLimiter.js 생성 — general (100req/15min), auth (5req/15min)
  3. middleware/validators.js 생성 — 모든 POST/PUT 엔드포인트 입력 검증 + XSS 방지 (HTML 태그 strip)
  4. index.js에 미들웨어 적용:
     - generalLimiter: 모든 /api/ 라우트
     - authLimiter: login, register, password reset/set, login-start, login-verify
     - validators: memberSignup, memberLogin, loginStart, loginVerify, passwordSet, passwordReset, passwordChange, securitySetup, adminLogin, memberUpdate, workshopCreate, workshopUpdate, galleryDeleteMany, galleryFolderCreate
  5. 서버 정상 시작 확인 (PORT=4099 테스트 통과)
- 결과: 보안 강화 완료, 서버 정상 동작
- 상태: 완료

## 2026-02-28 22:59 - Command Center 서버 + Claude 사용량 모니터링 검증
- 지시: Commander로부터 서버 재시작 + 사용량 모니터링 검증 요청
- 수행:
  1. 서버 상태 확인 — localhost:9000 이미 정상 동작 중 (재빌드 불필요)
  2. GET /api/claude-usage 정상 확인 (5hr: 35%, 7day: 5%, tier: claude_max_20x)
  3. POST /api/claude-usage/refresh 정상 확인 (데이터 갱신 동작)
  4. claude-usage-monitor.ts 전체 파이프라인 동작 확인
- 결과: 모든 검증 통과. 서버 정상, API 정상, 모니터링 정상
- 상태: 완료

## 2026-02-28 22:55 - Claude 사용량 모니터링 도구 구현
- 지시: Commander로부터 구현 승인 — OAuth API 기반 사용량 모니터링을 Command Center에 통합
- 수행:
  1. server/services/claude-usage-monitor.ts 생성 (토큰 읽기 + 3분 폴링 + 에러 처리)
  2. routes/api.ts에 GET /api/claude-usage, POST /api/claude-usage/refresh 추가
  3. socket/monitor-handler.ts에 'claude-usage' 브로드캐스트 추가
  4. server/index.ts에 claudeUsageMonitor.startPolling 추가
  5. frontend: types 추가, useClaudeUsage 훅 생성, SystemMonitor.tsx에 게이지 UI 추가
- 결과: TypeScript 체크 통과, 프론트엔드 빌드 성공. 서버 재시작하면 동작
- 상태: 완료

## 2026-02-28 22:50 - Claude 사용량 모니터링 구현 가능성 검토
- 지시: Commander로부터 연구 보고서 기반 실제 모니터링 도구 구현 가능성 검토 요청
- 수행:
  1. claude-usage-research.md 보고서 재검토
  2. Command Center 아키텍처 분석 (Node.js+Express+Socket.IO+React, 기존 System Monitor 패턴 확인)
  3. OAuth Usage API 실제 호출 테스트 성공 (5hr: 30%, 7day: 4%)
  4. credentials.json 토큰 추출 확인 (Max $200, claude_max_20x tier)
  5. 구현 방안 수립 (서비스+API+Socket.IO+프론트엔드, 4개 파일)
- 결과: 구현 가능 판정. 기존 System Monitor 패턴 활용하면 깔끔하게 통합 가능. Commander에 보고 완료 (report-worker-2-1772286541541.md, needsUserDecision: true)
- 상태: 완료 (구현 진행 여부 Commander 결정 대기)

## 2026-02-28 22:46 - 상태 보고
- 지시: Commander로부터 상태 보고 요청 (현재 작업, 블로커, 마지막 완료 작업, 세션 컨텍스트 여부)
- 수행: activity.md로 컨텍스트 복원, MASTER.md 확인, Command Center API로 보고
- 결과: 보고 전달 완료 (report-worker-2-1772286382887.md) — 대기 중, 블로커 없음, 즉시 가동 가능
- 상태: 완료

## 2026-02-28 21:45 - Claude Code 사용량 모니터링 연구
- 지시: Commander로부터 Claude Max $200 한도 실시간 모니터링 방법 조사 요청
- 수행: 웹 검색으로 6개 항목 조사 (Anthropic API, CLI 명령, 웹 대시보드, Admin API, 커뮤니티 도구, 리셋 주기)
- 결과:
  - 핵심 발견: OAuth Usage API (api.anthropic.com/api/oauth/usage) — five_hour/seven_day utilization % + 리셋 시각 반환
  - Windows 토큰 위치: ~/.claude/.credentials.json → claudeAiOauth.accessToken
  - Admin API는 API 크레딧 전용, Max 구독 쿼터 확인 불가
  - CLI /usage, /status는 인터랙티브 전용
  - 리셋: 5시간/7일 롤링 윈도우 (월초 아님)
  - 커뮤니티 도구: Tray-Usage-Monitor(Windows), ccusage, Claude-Code-Usage-Monitor 등
  - 권장: OAuth API 직접 호출이 Command Center 통합에 최적
  - 보고서: WorkSpace/claude-usage-research.md 저장
- 상태: 완료

## 2026-02-28 11:48 - 인코딩 테스트 (파일 경유 보고)
- 지시: Commander로부터 인코딩 테스트 요청 — 한글 메시지가 정상 보이면 파일 경유 방식으로 보고
- 수행: 지시 파일 읽기 → 한글 정상 확인 → printf로 JSON 파일 생성 후 --data-binary @파일로 보고
- 결과: 보고 정상 전달 (report-worker-2-1772279335486.md)
- 상태: 완료

## 2026-02-28 - 테스트 메시지 응답
- 지시: Commander로부터 테스트 메시지 수신 (인코딩 깨짐, 상태 확인 요청으로 판단)
- 수행: MASTER.md 확인, 현재 상태 파악, Command Center에 보고
- 결과: 보고 전달 완료 (status: delivered)
- 상태: 완료
