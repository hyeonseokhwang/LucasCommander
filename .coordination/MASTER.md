# Lucas Initiative - 사령탑 지시서 (MASTER)

> **이 파일은 사령탑만 작성합니다. 워커 세션은 읽기만 하세요.**
> 마지막 업데이트: 2026-02-28 23:20 (14B 전환 결정)
> 전체 비전: `VISION.md` 참조

---

## 세션 배치

| 세션 | 역할 | 상태 파일 | 담당 코드 | 현재 상태 |
|------|------|----------|----------|----------|
| **사령탑** | 조율, 아키텍처, 지시 | 이 파일 | 직접 코딩 안함 | 활성 — 전체 작업 지시 |
| **Worker-Dashboard** | AI 대시보드 + 리서치 엔진 | `worker-dashboard.md` | `G:\LucasDashboard\` | **14B 모델 전환 [즉시]** |
| **Worker-Scheduler** | 스케줄러 + 음성인식 | `worker-scheduler.md` | `G:\Lucas-Initiative\scheduler\` | **14B 모델 전환 + 포트 복구 [즉시]** |
| **Worker-3** | 로컬 LLM 벤치마킹 | `worker-benchmarker.md` | `G:\Lucas-Initiative\Secretary\` | 14B 벤치마크 완료 ✅ |
| **Worker-5** | Command Center 개선 | `worker-5.md` | `G:\Lucas-Initiative\command-center\` | CC 대시보드 완료 ✅ |
| **Worker-6** | 홈페이지 제작 | `worker-6.md` | `G:\Lucas-Initiative\WorkSpace\lucas-homepage\` | **14B 벤치마크 결과 반영 [즉시]** |

---

## 현재 지시사항

### Worker-Dashboard (:7777) — 14B 모델 전환 [즉시 진행] ⚡ 계획 변경

**14B 벤치마크 결과**: qwen2.5:14b = **82 tok/s, 6/6 PASS, VRAM 17.8GB (97% GPU)**
72B(1.2 tok/s) 대비 68배 빠르면서 동일 품질. **골디락스 모델 확정.**

**지시사항** (72B 지시 철회, 14B로 변경):
1. `config.py`의 DEFAULT_MODEL → `qwen2.5:14b` (72B 아님!)
2. `research_service.py` 분석 모델 → `qwen2.5:14b` (증거 필터링/번역은 기존 경량 모델 유지)
3. 14B 적용 후 리서치 품질 테스트 1회 실행 → 결과 보고
4. 타임아웃은 기존 유지 (82 tok/s로 충분히 빠름)

#### 요청 처리
| 요청 | 결정 |
|------|------|
| 70B 모델 | **완료**: `qwen2.5:72b-instruct-q4_K_M` 다운로드 & 벤치마크 완료 |
| LucasDashboard → LucasInitiative 이전 | **보류** — 현 작업 안정화 후 |
| Naver API 키 | **Lucas 결정 필요** — 발급 여부 |
| Telegram 봇 토큰 | **Lucas 결정 필요** — @BotFather 발급 여부 |

#### 금지
- scheduler 디렉토리 코드 수정

---

### Worker-Scheduler (:7778) — 14B 전환 + 포트 복구 [즉시 진행] ⚡ 계획 변경

**14B 벤치마크 결과**: qwen2.5:14b = **82 tok/s, 6/6 PASS, VRAM 17.8GB**
14B + Whisper = 22.3GB < 24GB → **동시 운영 확인됨!**

**지시사항**:
1. 포트 7778 사용 가능 여부 확인 → 복구
2. `conversation_service.py` 모델 → `qwen2.5:14b` (기존 qwen2.5-coder:7b에서 업그레이드)
3. `llm_service.py` 모델 → `qwen2.5:14b`
4. keep_alive 설정 유지 ("30m")
5. 서버 재시작 후 음성비서 + 14B 정상 동작 확인 & 보고

#### 요청 처리
| 요청 | 결정 |
|------|------|
| 72B 모델 시 conversation_service 교체 | **14B로 변경** — 82 tok/s 실시간 대화 가능 |
| Whisper VRAM 충돌 | **해결** — 14B(17.8GB) + Whisper(3GB) = 20.8GB, 여유 있음 |

#### 금지
- 대시보드 관련 코드 수정

---

### Worker-3 — 14B 모델 벤치마크 [즉시 진행]

**지시사항**:
1. `qwen2.5:14b` (9GB) 벤치마크 — 6개 테스트 (한국어, 추론, 코드, 요약, 복잡추론, 한국어리서치)
2. `deepseek-r1:14b` (9GB) 벤치마크 — 동일 6개 테스트
3. VRAM 사용량, tok/s, 품질 측정
4. 기존 8B/72B와 비교 분석
5. `.coordination/BENCHMARK_REPORT.md`에 결과 추가
6. 완료 후 보고

**목표**: 14B가 8B 대비 품질 향상이 있으면서 72B보다 빠른 "골디락스 모델"인지 확인

---

### Worker-5 — Command Center 대시보드 개선 [즉시 진행]

**지시사항**:
1. **워커 상태 카드 뷰** — 각 워커의 현재 상태, PID, 마지막 보고 시간 시각화
2. **사령관 지시 패널** — UI에서 워커 선택 후 지시 전송 (POST /api/instruct 연동)
3. **보고/지시 타임라인** — inbox 보고와 지시 이력을 시간순 표시
4. 대상: `G:\Lucas-Initiative\command-center\` (frontend/ + server/)
5. 단계별로 보고하면서 진행

#### 금지
- command-center 외 프로젝트 코드 수정

---

### Worker-6 — 루카스 이니셔티브 홈페이지 [즉시 진행]

**지시사항**:
1. **위치**: `G:\Lucas-Initiative\WorkSpace\lucas-homepage\`
2. **스택**: React + Vite + Tailwind CSS
3. **콘텐츠**: Lucas Initiative 프로젝트 소개 랜딩 페이지
   - Hero 섹션: 프로젝트 소개 + 비전
   - Features: AI Dashboard, Voice Scheduler, Research Engine, Multi-Agent Orchestration
   - Tech Stack: 로컬 LLM (Ollama), Whisper STT, Edge TTS, RTX 4090
   - Architecture: 시스템 구성도
4. **디자인**: 모던 다크 테마, 반응형, 애니메이션
5. **언어**: 한국어 메인
6. **포트**: 3000
7. MVP로 빠르게 만들고 보고

#### 금지
- lucas-homepage 외 프로젝트 코드 수정

---

## 아키텍처 결정 로그

### [AD-001] 세션 간 통신 방식
- **결정**: `.coordination/` 폴더 내 파일 기반 (턴 기반 폴링)
- **이유**: 파일 락 방지 (각 세션이 자기 파일만 쓰기), REST API 불필요

### [AD-002] 모델 전략 — 3티어 구조 (v3 확정)
- **Tier 0 (Jarvis 코어)**: `qwen2.5:14b` ⭐ NEW
  - 용도: 리서치 분석, 대화, 추론, 일상 운영의 두뇌
  - 실측 속도: **82 tok/s** (VRAM 17.8GB, 97% GPU 적재)
  - 품질: 6/6 PASS (한국어, 추론, 코드, 요약, 복잡추론, 리서치)
  - Whisper 공존: 14B(17.8GB) + Whisper(3GB) = 20.8GB ✅
  - 상태: ✅ 벤치마크 완료, **전 시스템 적용 지시**
- **Tier 1 (야간 배치)**: `qwen2.5:72b-instruct-q4_K_M` (47GB, Q4)
  - 용도: 야간 심층 리서치, 복잡한 배치 분석
  - 실측 속도: 1.2 tok/s (RAM 대역폭 병목)
  - 상태: 대기 (필요 시 수동 호출)
- **Tier 2 (근육)**: 기존 경량 모델들
  - gemma2:2b — 증거 필터링, 번역 (257 tok/s)
  - qwen2.5-coder:7b — 코드 생성 (136 tok/s) → 14B로 대체 예정
  - deepseek-r1:8b — 간단한 추론 (122 tok/s)
- **벤치마크 상세**: `BENCHMARK_REPORT.md` 참조

### [AD-003] 리서치 엔진 모델 업그레이드 절차
1. ~~72B 다운 완료 확인~~ ✅
2. ~~72B 벤치마크 수행~~ ✅ (1.2 tok/s, 6/6 PASS)
3. Dashboard 워커에 모델 교체 지시 ← **현재 단계 (진행 중)**
4. Dashboard가 config.py, research_service.py 변경
5. 72B로 리서치 1회 실행 → 품질 비교

### [AD-004] Claude API 에스컬레이션 정책
- 기본: 로컬 Ollama (비용 0원)
- priority ≤ 2: Claude API (월 20만원 한도)
- 현재 사용량: 5원 / 200,000원

### [AD-005] GPU 활용 정책
- RTX 4090은 적극 활용 — 놀리지 않는다
- Ollama 모델 추론 + Whisper STT 동시 운영
- VRAM 예산: Whisper ~3GB + 모델 추론 ~20GB = 총 23GB/24GB
- 14B 벤치마크로 최적 모델 사이즈 확정 예정

---

## 다음 계획

### Phase 1: 현 상태 안정화 (거의 완료)
- [x] 사령탑 인수 완료
- [x] Worker-Scheduler GitHub push 완료
- [x] 72B 다운로드 & 벤치마크 완료
- [ ] Scheduler 포트 7778 복구 (진행 중)

### Phase 2: 모델 최적화 (진행 중)
- [ ] 14B 벤치마크 (Worker-3, 진행 중)
- [ ] Dashboard 리서치 엔진에 72B 적용 (Worker-Dashboard, 진행 중)
- [ ] Whisper + 최적 모델 VRAM 공존 테스트

### Phase 3: 플랫폼 강화 (진행 중)
- [ ] Command Center 대시보드 개선 (Worker-5, 진행 중)
- [ ] 루카스 이니셔티브 홈페이지 (Worker-6, 진행 중)

### Phase 4: 통합
- [ ] Dashboard + Scheduler 연동
- [ ] 음성인식 모듈 통합
- [ ] Telegram 봇 활성화

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
| Scheduler API | localhost:7778 | 스케줄러 백엔드 (복구 진행 중) |
| Scheduler Dev | localhost:5174 | 프론트엔드 dev 서버 |
| Command Center | localhost:9000 | 오케스트레이션 플랫폼 |
| Homepage | localhost:3000 | 루카스 이니셔티브 홈페이지 (신규) |
| GitHub | hyeonseokhwang/LucasInitiative | master 브랜치 |
| GitHub | hyeonseokhwang/LucasVoiceScheduler | 스케줄러 별도 레포 |
| 조율 폴더 | `.coordination/` | 파일 기반 통신 |
