# Worker-Dashboard (:7777) 상태

> **이 파일은 Dashboard 세션만 작성합니다.**
> 마지막 업데이트: 2026-02-28 17:30

## 담당 범위
- Lucas AI Dashboard (포트 7777)
- 위치: `G:\LucasDashboard\` (추후 `G:\LucasInitiative\`로 이전 예정)
- GitHub: https://github.com/hyeonseokhwang/LucasInitiative.git
- 스택: FastAPI + React + Vite + Tailwind + SQLite + Ollama + Claude API

---

## 현재 상태
- [x] 서버 가동 중 (localhost:7777)
- [x] Research Engine 자율 운영 중 (주말 모드: 8h 주기)
- [x] GitHub push 완료 (commit: a6d22ca)
- [ ] 대기 중 — 사령탑 지시 대기

---

## 완료 작업 (2026-02-28)

### 1. 자율 심층 리서치 엔진 구축 (신규)
- **5단계 파이프라인**: 토픽 선정 → 다각도 증거 수집 → 교차검증 → AI 분석 → 보고서 저장
- 교차검증 알고리즘: Jaccard 유사도 + 상승/하락 방향 감지
- 주말 자동 감지: 평일 2h / 주말 8h 주기, 주말엔 알림 배치 처리
- 토픽 중복 제거: 6시간 윈도우 내 유사 토픽 차단
- 파일: `backend/services/research_service.py` (신규, 839줄)

### 2. 멀티소스 검색 엔진 (crawl_service.py 전면 개편)
- DuckDuckGo (기본) + Google (보조) + Naver API (뉴스)
- 엔진별 결과를 URL/제목으로 중복 제거 후 통합
- Naver: `NAVER_CLIENT_ID/SECRET` 환경변수 (선택, 없으면 스킵)
- Google: `googlesearch-python` 패키지 (API 키 불필요)

### 3. 다국어 검색 (한/영/일)
- Ollama gemma2:2b로 검색 쿼리 자동 번역 (비용 0원)
- 한국어 원본 + 영어 번역 + 일본어 번역으로 3배 커버리지

### 4. Smart API 에스컬레이션
- 기본: 로컬 Ollama (DeepSeek-r1:8b) — GPU 활용, 비용 0원
- 고우선도 (priority ≤ 2): Claude API 사용 (예산 내)
  - priority 1 (긴급 알림) → Claude Sonnet 4.6
  - priority 2 (중요) → Claude Haiku 4.5
- 월 예산 추적: api_usage 테이블 조회, 200,000 KRW 한도
- 예산 초과 시 자동으로 Ollama fallback
- 현재 사용량: 5원 / 200,000원

### 5. 증거 품질 필터링
- gemma2:2b (최경량 모델)로 증거 relevance 평가
- 광고/중복/무관 항목 자동 제거
- 테스트: 45건 → 36건으로 노이즈 제거

### 6. Telegram 봇 (telegram_service.py 신규)
- 토큰 미설정 시 graceful skip
- 슬래시 커맨드: /start, /help, /status, /report, /alerts, /research
- 푸시 알림: 급등락, 리서치 완료, 일일 보고서
- 자유 텍스트 → Supervisor PM 전달

### 7. Research API (research.py 라우터 신규)
- GET /api/research/topics — 조사 주제 목록
- GET /api/research/reports — 보고서 목록
- GET /api/research/reports/{id} — 보고서 + 증거 체인
- POST /api/research/trigger?query=... — 수동 리서치
- GET /api/research/status — 엔진 상태 + API 예산

### 8. Research 탭 프론트엔드 (ResearchPanel.tsx 신규)
- 보고서 목록: 신뢰도 색상 (초록 ≥70%, 노랑 ≥40%, 빨강 <40%)
- 보고서 상세: 신뢰도 바, 요약, 전문, 증거 체인
- 수동 리서치 입력창, 엔진 상태 표시
- WebSocket 실시간 업데이트 (research_update, research_complete)

### 9. 기존 시스템 연동 (13개 파일 수정)
- main.py: lifespan에 research_engine + telegram 시작/종료
- collector_service.py: ±3% 알림 → 배치 리서치 큐 (개별이 아닌 종합)
- supervisor_service.py: DEEP_RESEARCH 도구 추가
- report_service.py: 일일 보고서 → Telegram 푸시
- agent_service.py: Scholar 에이전트 추가
- config.py: RESEARCH_CYCLE_INTERVAL, API_MONTHLY_BUDGET_KRW
- DB schema.sql: 5개 테이블 추가 (research_topics, research_evidence, research_reports, source_reliability, telegram_config)
- 프론트: App.tsx, useWebSocket.ts, api.ts, types/index.ts, CompanyView.tsx

### 10. 이전 기능 (이전 세션에서 구축)
- 시스템 모니터링 (GPU/CPU/RAM)
- 채팅 (Ollama + Supervisor PM)
- 일정/가계부/API 사용량 추적
- 주식 수집 (yfinance 5분), 뉴스 (30분), 부동산 (60분)
- 급등락 알림 (±3%), 일일 보고서
- Company View (8명 에이전트 조직도)
- 백그라운드 Collector 자동 가동

---

## 변경된 파일 목록 (오늘)

| 파일 | 상태 | 변경 내용 |
|------|------|----------|
| `backend/services/research_service.py` | **신규** | 리서치 엔진 전체 (839줄) |
| `backend/services/telegram_service.py` | **신규** | Telegram 봇 |
| `backend/routers/research.py` | **신규** | Research API 라우터 |
| `frontend/src/components/ResearchPanel.tsx` | **신규** | Research 탭 UI |
| `backend/services/crawl_service.py` | **전면 개편** | 멀티소스 + 다국어 검색 |
| `backend/config.py` | 수정 | 리서치/API 예산 설정 |
| `backend/db/schema.sql` | 수정 | 5개 테이블 + 3개 인덱스 |
| `backend/main.py` | 수정 | lifespan 연동 |
| `backend/services/collector_service.py` | 수정 | 알림 배치 + 리서치 큐 |
| `backend/services/supervisor_service.py` | 수정 | DEEP_RESEARCH 도구 |
| `backend/services/report_service.py` | 수정 | Telegram 일일 보고서 |
| `backend/services/agent_service.py` | 수정 | Scholar 에이전트 |
| `frontend/src/App.tsx` | 수정 | research 탭 |
| `frontend/src/hooks/useWebSocket.ts` | 수정 | research 이벤트 |
| `frontend/src/lib/api.ts` | 수정 | research API |
| `frontend/src/types/index.ts` | 수정 | research 타입 |
| `frontend/src/components/CompanyView.tsx` | 수정 | Scholar 아바타 |

---

## 사령탑에 보고/요청

### 보고
1. **리서치 엔진 동작 확인 완료** — 수동 트리거 "미국 트럼프 관세 정책 영향" → 36건 증거, 62% 신뢰도, 보고서 정상 생성
2. **주말 모드 정상** — 8시간 주기, 알림 배치 처리
3. **API 예산** — 월 5원/200,000원 사용 (사실상 로컬 Ollama만 사용 중)
4. **GitHub push 완료** — commit a6d22ca on master

### 요청
1. **70B 모델 도입 시** — research_service.py의 DEFAULT_MODEL과 config.py 변경 필요. 분석 품질 대폭 향상 예상. 어떤 모델 확정되면 알려주세요.
2. **LucasDashboard → LucasInitiative 이전** — 타이밍/방법 결정 필요
3. **Naver API 키** — 발급하면 뉴스 검색 품질 올라감 (선택사항)
4. **Telegram 봇 토큰** — @BotFather에서 발급하면 핸드폰 푸시 가능 (선택사항)

---

## 포트/리소스 사용
| 리소스 | 값 |
|--------|-----|
| HTTP | localhost:7777 |
| WebSocket | ws://localhost:7777/ws |
| Ollama | localhost:11434 (공유) |
| DB | G:\LucasDashboard\backend\db\lucas.db |
| GPU | Ollama 모델 추론 시 사용 |
