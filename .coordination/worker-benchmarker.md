# Worker-Benchmarker (Secretary) 상태

> **이 파일은 Benchmarker 세션만 작성합니다.**
> 마지막 업데이트: 2026-02-28 19:30

## 담당 범위
- 로컬 LLM 벤치마크 수행 및 보고
- 위치: `G:\Lucas-Initiative\Secretary\`
- 역할: 모델 성능 측정, VRAM 분석, 최적화 전략 수립
- 벤치마크 보고서: `.coordination/BENCHMARK_REPORT.md`

---

## 현재 상태
- [x] 72B 모델 다운로드 완료 (qwen2.5:72b-instruct-q4_K_M, 47GB)
- [x] 72B 벤치마크 완료 (6/6 PASS, 1.2 tok/s)
- [x] 전체 모델 속도 벤치마크 완료 (9개 모델)
- [x] VRAM 분배/대역폭 병목 분석 완료
- [x] BENCHMARK_REPORT.md v2 업데이트 완료
- [ ] 32B 모델 벤치마크 (미다운로드)
- [ ] Whisper + 72B 동시 VRAM 충돌 실측
- [ ] 멀티모델 부하 테스트

---

## 완료 작업 (2026-02-28)

### 1. 72B 벤치마크 (신규)
- **속도**: 1.2 tok/s (일관)
- **품질**: 6/6 전부 PASS (한국어, 추론, 코드, 요약, 복잡추론, 한국어리서치)
- **병목 원인**: RAM 대역폭 (DDR5-3600, 58 GB/s) → CPU 처리 부분이 0.56초/토큰
- **VRAM 분배**: 16.9GB GPU (34%) + 32.5GB RAM (66%)
- **첫 로드**: ~19초, Hot 상태: 0.1초

### 2. VRAM 충돌 분석
- 72B + Whisper large-v3: 21.4GB → 이론상 가능 (24GB 이내)
- 72B + Whisper + 8B: 26.4GB → VRAM 초과!

### 3. BENCHMARK_REPORT.md v2 작성
- 72B 실측 데이터 반영
- RAM 대역폭 병목 이론 분석
- VRAM 충돌 시나리오
- 3가지 운영 전략 (속도/품질/균형) 제시

---

## 사령탑에 보고

### 핵심 발견
1. **72B 품질은 우수** — 8B 대비 확실히 나은 한국어, 복잡 추론, 리서치 분석
2. **72B 속도는 1.2 tok/s** — 실시간 대화 부적합, 배치 리서치에는 사용 가능
3. **원인은 물리적 한계** — DDR5 RAM 대역폭 58 GB/s vs GPU 1,008 GB/s
4. **32B가 최적 후보** — VRAM에 ~95% 적재 → 15-25 tok/s 예상, 품질도 양호할 것

### 권장 사항
1. **32B 다운로드 승인 요청** — `qwen2.5:32b-instruct-q4_K_M` (~20GB)
2. **72B는 야간 배치 전용** — 리서치 엔진 배치 분석용
3. **Whisper-72B 동시 사용 주의** — Scheduler에 Whisper medium 전환 권고 필요
4. **command-r-plus 삭제 검토** — 59GB 낭비, 사용 불가 (0.1 tok/s)

---

## 벤치마크 도구
| 파일 | 용도 |
|------|------|
| `Secretary/benchmark.py` | v1 벤치마크 (8B 모델, 4테스트) |
| `Secretary/bench_full.py` | v2 벤치마크 (전체 모델, 6테스트) |
| `Secretary/benchmark_results.json` | v1 결과 |
| `Secretary/bench_72b_prompt.json` | 72B 인코딩 우회용 프롬프트 |
