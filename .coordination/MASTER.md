# Lucas Initiative - 사령탑 지시서 (MASTER)

> **이 파일은 사령탑만 작성합니다. 워커 세션은 읽기만 하세요.**
> 마지막 업데이트: 2026-02-28 20:00
> 사령탑 교체: 새 세션 인수 (이전 사령탑 → LLM 벤치마킹 전환)
> 전체 비전: `VISION.md` 참조

---

## 세션 배치

| 세션 | 역할 | 상태 파일 | 담당 코드 | 현재 상태 |
|------|------|----------|----------|----------|
| **사령탑 (신규)** | 조율, 아키텍처, 지시 | 이 파일 | 직접 코딩 안함 | 인수 완료, 상태 파악 중 |
| **Worker-Dashboard** | AI 대시보드 + 리서치 엔진 | `worker-dashboard.md` | `G:\LucasDashboard\` | 보고 완료, 대기 중 |
| **Worker-Scheduler** | 스케줄러 + 음성인식 | `worker-scheduler.md` | `G:\Lucas-Initiative\scheduler\` | Phase 1~3 완료, push 미완료 |
| **Worker-3 (이전 사령탑)** | 로컬 LLM 벤치마킹 | - | - | 벤치마킹 중 |

---

## 현재 지시사항

### Worker-Dashboard (:7777) — 대기 중
- **완료 확인**: 자율 심층 리서치 엔진, 멀티소스 검색, Telegram 봇, Research API/UI 등
- **GitHub push**: commit a6d22ca on master — 확인
- **현재**: 대기 중 — 아래 지시 대기

#### 다음 지시 (72B 다운 완료 시 하달 예정)
1. `config.py`의 DEFAULT_MODEL → `qwen2.5:72b-instruct-q4_K_M`
2. `research_service.py` 분석 모델 → 72B (증거 필터링/번역은 기존 경량 모델 유지)
3. 72B 적용 후 리서치 품질 테스트 1회 실행 → 결과 보고

#### 요청 처리
| 요청 | 결정 |
|------|------|
| 70B 모델 | **채택**: `qwen2.5:72b-instruct-q4_K_M` — 다운로드 진행 중 (네트워크 병목) |
| LucasDashboard → LucasInitiative 이전 | **보류** — 현 작업 안정화 후 |
| Naver API 키 | **Lucas 결정 필요** — 발급 여부 |
| Telegram 봇 토큰 | **Lucas 결정 필요** — @BotFather 발급 여부 |

#### 금지
- scheduler 디렉토리 코드 수정

---

### Worker-Scheduler (:7778) — Phase 1~3 완료
- **완료 확인**: UI 폴리시, 음성비서(Whisper+NLP+LLM+대화), 추가 기능 모두 동작
- **Whisper**: large-v3 CUDA 로드, 0.15초/2초 오디오 처리
- **GitHub push**: 미완료

#### 다음 지시
1. **GitHub push 진행** — 현재 작업물 커밋 & 푸시
2. push 후 상태 파일 업데이트

#### 요청 처리
| 요청 | 결정 |
|------|------|
| 72B 모델 시 conversation_service 교체 | **승인** — 72B 안착 후 진행 |
| Whisper VRAM 충돌 (3GB + 72B) | **주시** — 72B 실제 VRAM 사용량 확인 후 판단. 필요 시 medium 다운그레이드 |

#### 금지
- 대시보드 관련 코드 수정

---

### Worker-3 (이전 사령탑)
- 로컬 LLM 벤치마킹 진행 중
- 벤치마크 결과는 `BENCHMARK_REPORT.md`에 기록

---

## 아키텍처 결정 로그

### [AD-001] 세션 간 통신 방식
- **결정**: `.coordination/` 폴더 내 파일 기반 (턴 기반 폴링)
- **이유**: 파일 락 방지 (각 세션이 자기 파일만 쓰기), REST API 불필요

### [AD-002] 모델 전략 — 2티어 구조
- **Tier 1 (두뇌)**: `qwen2.5:72b-instruct-q4_K_M` (47GB, Q4)
  - 용도: 리서치 분석, 복잡한 추론, 보고서 작성
  - 예상 속도: 10~20 tok/s (GPU+RAM 오프로드)
  - 상태: 다운로드 중 (네트워크 병목)
- **Tier 2 (근육)**: 기존 8B 모델들
  - gemma2:2b — 증거 필터링, 번역 (257 tok/s)
  - qwen2.5-coder:7b — 코드 생성 (136 tok/s)
  - deepseek-r1:8b — 간단한 추론 (122 tok/s, chat API 사용)
- **벤치마크 상세**: `BENCHMARK_REPORT.md` 참조

### [AD-003] 리서치 엔진 모델 업그레이드 절차
1. 72B 다운 완료 확인 (사령탑)
2. 사령탑이 72B 벤치마크 수행 (한국어/추론/속도)
3. 벤치마크 통과 시 Dashboard 워커에 모델 교체 지시
4. Dashboard가 config.py, research_service.py 변경
5. 72B로 리서치 1회 실행 → 품질 비교

### [AD-004] Claude API 에스컬레이션 정책
- 기본: 로컬 Ollama (비용 0원)
- priority ≤ 2: Claude API (월 20만원 한도)
- 현재 사용량: 5원 / 200,000원

### [AD-005] GPU 활용 정책 (신규)
- RTX 4090은 적극 활용 — 놀리지 않는다
- Ollama 모델 추론 + Whisper STT 동시 운영
- VRAM 예산: Whisper ~3GB + 모델 추론 ~20GB = 총 23GB/24GB
- 72B 도입 시 VRAM 충돌 모니터링 필요

---

## 다음 계획

### Phase 1: 현 상태 안정화 (즉시)
- [x] 사령탑 인수 완료
- [ ] Worker-Scheduler GitHub push
- [ ] 72B 다운로드 완료 대기

### Phase 2: 72B 모델 안착
- [ ] 72B 벤치마크
- [ ] Dashboard 리서치 엔진에 72B 적용
- [ ] Whisper + 72B VRAM 공존 테스트

### Phase 3: 콜라보레이션 웹앱 (구상)
- 파일 기반 조율은 유지하되, 시각적 모니터링 앱 개발 검토
- 워커 상태 대시보드 + 사령관 지시 패널

### Phase 4: 통합
- Dashboard + Scheduler 연동
- 음성인식 모듈 통합
- Telegram 봇 활성화

---

## 금지사항 (전체 공통)

1. 다른 세션의 상태 파일 수정 금지
2. 담당 범위 밖 코드 수정 금지
3. 공통 인터페이스(포트, API 스펙, DB 스키마) 임의 변경 금지
4. `.coordination/MASTER.md` 수정 금지 (사령탑 전용)
5. VISION.md 수정 금지 (사령탑 전용)

---

## 공유 리소스

| 리소스 | 주소 | 비고 |
|--------|------|------|
| Ollama | localhost:11434 | 모델 서빙 (전체 공유) |
| Dashboard | localhost:7777 | AI 대시보드 |
| Scheduler API | localhost:7778 | 스케줄러 백엔드 |
| Scheduler Dev | localhost:5174 | 프론트엔드 dev 서버 |
| GitHub | hyeonseokhwang/LucasInitiative | master 브랜치 |
| 조율 폴더 | `.coordination/` | 파일 기반 통신 |
