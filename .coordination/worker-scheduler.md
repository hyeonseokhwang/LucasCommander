# Worker-Scheduler (:7778) 상태

> **에이전트명: 스케줄러 + 음성 담당 에이전트**
> **이 파일은 Scheduler 세션만 작성합니다.**
> 마지막 업데이트: 2026-02-28 23:00
> 세션 교체: 신규 세션 인수 (GitHub push 완료)

## 담당 범위
- 스케줄러 앱 전체 (포트 7778 백엔드, 5174 프론트 dev)
- 위치: `G:\Lucas-Initiative\scheduler\`
- 스택: FastAPI + React 19 + Vite + Tailwind + SQLite + Ollama + Whisper
- 음성비서 모듈 포함

---

## 현재 상태
- [x] 백엔드 가동 중 (localhost:7778)
- [x] 프론트엔드 가동 중 (localhost:5174)
- [x] Ollama 연동 완료 (qwen2.5-coder:7b, 대화형 비서)
- [x] Whisper large-v3 CUDA 로드 완료 (로컬 STT)
- [x] 전체 기능 테스트 통과
- [x] 음성 응답 스트리밍 전환 완료 (SSE)
- [x] Ollama keep_alive 30m 설정 완료
- [x] 기본 STT를 Browser STT(Web Speech API)로 복구 (UX 우선)
- [x] 대화 모드 자동 연속 대화 수정 완료 (버튼 재클릭 불필요)
- [x] Edge TTS 적용 완료 (Neural 음성, 사용자 체감 "대박 자연스럽다")
- [x] GitHub push 완료 → `hyeonseokhwang/LucasVoiceScheduler` (별도 레포)
- **대기 중**: 72B 벤치마킹 완료 대기 (7B 모델 VRAM 로딩 차단 중)
- **포트 변경**: 7778 → 7779 (유령 소켓 점유 문제, 재부팅 후 7778 복구 예정)

---

## 이번 세션 작업 내역 (세션 교체 후 전체)

### 1. Browser STT 기본값 복구
- **문제**: 이전 세션에서 Whisper(local STT)를 기본값으로 전환했으나, 실시간 중간 텍스트 미지원으로 UX 저하
- **해결**: `useSpeechRecognition.ts` — Browser STT(Web Speech API)를 기본으로 복구
- Whisper는 백엔드에 대기 상태 유지 (토글 UI 추후 추가 가능)

### 2. 음성 응답 20초+ 지연 해결
- **원인 분석**:
  - `qwen2.5:72b`(벤치마킹용)가 VRAM 13.5GB 점유
  - 7B 모델이 매 호출마다 콜드 로딩 (13초) + non-streaming 대기
  - 사용자 체감: 말한 후 20초 이상 무반응
- **해결 1 — 프론트엔드 SSE 스트리밍**:
  - `VoiceAssistant.tsx`의 `handleChat()` 수정
  - `/api/voice/chat` (non-streaming) → `/api/voice/chat/stream` (SSE) 전환
  - ReadableStream으로 토큰 단위 실시간 표시
  - 스트리밍 실패 시 기존 non-streaming 자동 폴백
- **해결 2 — Ollama keep_alive 설정**:
  - `conversation_service.py` + `llm_service.py` 모든 Ollama 호출에 `keep_alive: "30m"` 추가
  - 7B 모델이 VRAM에서 안 내려감 → 콜드 로딩 13초 → 0.3초
- **수정 파일**: `VoiceAssistant.tsx`, `conversation_service.py`, `llm_service.py`

### 3. 대화 모드 자동 연속 대화 수정
- **문제**: 대화 모드에서 한 턴 주고받으면 다시 버튼 눌러야 함
- **원인**: `useSpeechRecognition()` 훅이 Browser STT의 `transcript`를 감시하는데, `startContinuous()`는 Local Whisper를 시작 → Whisper의 결과가 Browser `transcript`에 반영 안 됨 → 대화 루프 끊김
- **해결**: 대화 모드에서도 `start()` (Browser STT) 사용으로 통일
  - Browser STT는 이미 `continuous: true` + `autoRestart` 지원
  - TTS 완료 콜백 → `start()` → 자동 재청취
  - 흐름: 말하기 → 인식 → stop → LLM 스트리밍 → TTS → start → 자동 루프
- **수정 파일**: `VoiceAssistant.tsx` (3곳의 `startContinuous ? startContinuous() : start()` → `start()`)

### 5. Edge TTS 적용 (Windows 내장 TTS → Neural 음성)
- **변경 이유**: Windows SAPI TTS가 로봇 같고 부자연스러움
- **해결**: Edge TTS (MS Neural 음성) 적용
  - 백엔드: `POST /api/voice/tts` 엔드포인트 추가 (`routers/voice.py`)
  - `edge-tts` 패키지, 음성: `ko-KR-SunHiNeural`, rate: `+10%`
  - 스트리밍 MP3 반환 (StreamingResponse)
  - 프론트엔드: `speak()` 함수 교체 (`useSpeechRecognition.ts`)
  - `/api/voice/tts` 호출 → MP3 blob → `Audio` 객체 재생
  - Edge TTS 실패 시 브라우저 내장 TTS 자동 폴백
- **성능**: 짧은 문장 ~0.8-1.3초, GPU 미사용 (MS 클라우드 처리)
- **비용**: 무료, API 키 불필요
- **수정 파일**: `routers/voice.py`, `useSpeechRecognition.ts`

### 6. 포트 변경 (7778 → 7779)
- 이전 프로세스가 남긴 유령 소켓이 7778 포트 점유 (Windows 커널 잔여물)
- `config.py` PORT 7779, `vite.config.ts` proxy target 7779로 임시 변경
- 재부팅 후 7778로 복구 예정

### 7. 현재 차단 이슈
- **72B 벤치마킹이 VRAM을 점유** → 7B 모델 로딩 타임아웃 (30초+)
- 벤치마킹 완료까지 음성비서 LLM 응답 불가 (폴백 템플릿 응답만 가능)
- **결정**: 벤치마킹 우선. 완료 후 7B 로드하면 정상 동작

---

## 완료 작업 (이전 세션 포함)

### Phase 1: UI 프로덕션 폴리시
- 사이드바 + 미니 캘린더 (`Sidebar.tsx`, `MiniCalendar.tsx`)
- 타임슬롯 클릭 → 빠른 일정 생성
- 드래그 앤 드롭 (`useDragDrop.ts`)
- 키보드 단축키 (`useKeyboardShortcuts.ts`)
- 검색 (`SearchResults.tsx`, 300ms 디바운스)
- UX 개선 (Toast, 낙관적 업데이트, 애니메이션, 이벤트 겹침 레이아웃)

### Phase 2: 음성비서 (완전 로컬, 비용 0원)
- 한국어 NLP 룰 기반 파서 (`nlp_service.py`, 280줄)
- Ollama LLM 연동 (`llm_service.py`)
- 대화형 음성비서 멀티턴 (`conversation_service.py`)
- 음성비서 API 6개 엔드포인트 (`voice.py`)
- Whisper 로컬 STT (`whisper_service.py`, large-v3, CUDA)
- 프론트엔드 음성비서 UI (`VoiceAssistant.tsx`)

### Phase 3: 추가 폴리시
- 자연어 입력 바 (`QuickInput.tsx`)
- Undo 기능
- 알림 고도화 (`ReminderToast.tsx`, 스누즈)

### Phase 4: 성능 최적화 (이번 세션)
- SSE 스트리밍 응답 전환
- Ollama keep_alive 30m 설정
- Browser STT 기본값 복구
- 대화 모드 자동 연속 대화 수정

---

## 기술 스택 상세

### 로컬 AI 파이프라인 (비용 0원)
```
마이크 → Browser STT (Web Speech API, 실시간 중간 텍스트)
    ↓
한국어 텍스트
    ↓ 1차: 룰 기반 NLP (즉시)
    ↓ 2차: Ollama qwen2.5-coder:7b (SSE 스트리밍, 실시간 토큰 표시)
    ↓ 충돌 검사 (DB 조회)
구조화된 일정 데이터
    ↓
Edge TTS Neural (ko-KR-SunHiNeural, MS 클라우드, 무료) → 자동 재청취 (대화 모드)
```

### Ollama 모델 사용
- `qwen2.5-coder:7b` — 일정 파싱 + 대화 응답
- `keep_alive: "30m"` — VRAM 상주
- TIMEOUT: 15초 (generate), 60초 (chat)

### Whisper 모델 (백엔드 대기)
- `large-v3` on CUDA (float16)
- 서버 시작 시 백그라운드 프리로드
- VRAM 사용: ~3GB
- 현재: 백엔드에서 대기 상태 (Browser STT 기본 사용 중)

---

## 사령탑에 보고/요청

### 보고
1. **Phase 1~4 구현 완료** — UI 폴리시, 음성비서, 추가 기능, 성능 최적화 모두 동작 확인
2. **세션 교체 인수 완료** — 이전 세션 실수 종료 후 신규 에이전트(스케줄러 + 음성 담당) 인수
3. **응답 지연 근본 해결** — SSE 스트리밍 + keep_alive로 20초→즉시 응답 (7B 로드 시)
4. **대화 모드 자동 연속 대화 수정** — STT 훅 불일치 버그 수정, 버튼 재클릭 불필요
5. **72B 벤치마킹 VRAM 충돌 확인** — 72B(13.5GB) + 7B(4.5GB) + Whisper(3GB) = 21GB. 이론상 가능하나, 벤치마킹 중 동시 로딩 타임아웃 발생

### 요청 (사령탑 판단 필요)
1. **72B 벤치마킹 완료 후 알림** — 완료되면 7B 모델 로드하여 음성비서 LLM 정상화
2. **VRAM 공존 전략 결정**:
   - 옵션A: 72B 내리고 7B 전용 → 스케줄러 즉시 응답, 대시보드 72B 사용 불가
   - 옵션B: 스케줄러도 72B 사용 → 콜드 스타트 없음, 토큰 생성 느림(~15 tok/s)
   - 옵션C: 둘 다 상주 (21GB/24GB) → VRAM 빡빡하지만 가능
3. ~~**GitHub push 타이밍**~~ — ✅ 완료. 별도 레포 `hyeonseokhwang/LucasVoiceScheduler`로 push (사용자 결정). 정규화 시 LucasInitiative 레포로 합칠 예정.

---

## 포트/리소스 사용
| 리소스 | 값 |
|--------|-----|
| API 서버 | localhost:7779 (임시, 유령 소켓 해제 후 7778 복구) |
| 프론트 dev | localhost:5174 |
| Ollama | localhost:11434 (공유) |
| DB | scheduler/backend/scheduler.db |
| GPU | Ollama 추론 + Whisper STT |
| Whisper VRAM | ~3GB (large-v3 float16) |
