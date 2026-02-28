# Command Center 인코딩 문제 진단 결과

> 진단일: 2026-02-28
> 진단자: Commander

---

## 결론

**원인: MINGW bash의 `curl -d` (inline)가 한글 UTF-8 바이트를 깨뜨림**

서버 코드(`api.ts`)는 정상이다. `express.json()` 파싱도, `fs.writeFileSync(... 'utf-8')`도 문제없다.
문제는 **curl 호출 방식**에 있다.

---

## 증거

### 깨지는 방식 (현재)
```bash
curl -d '{"worker":"worker-1","instruction":"한글 테스트"}'
```
- MINGW bash가 `-d` 인라인 문자열의 한글 바이트를 CP949/ANSI로 변환
- 서버에 도착할 때 이미 깨진 상태 → `req.body.instruction`이 이미 손상됨
- 파일에 `EF BF BD` (U+FFFD replacement character) 대량 발생

### 정상 작동하는 방식
```bash
printf '{"worker":"worker-1","instruction":"한글 테스트"}' > /tmp/payload.json
curl --data-binary @/tmp/payload.json -H "Content-Type: application/json; charset=utf-8" ...
```
- 파일 경유 시 UTF-8 바이트가 그대로 보존됨
- 서버에서 정상 파싱 → 파일에 올바른 한글 저장

### 바이트 비교
| 방식 | "한" 바이트 | 결과 |
|------|------------|------|
| `-d` inline | `ef bf bd d1 b1 ef bf bd` | BROKEN (replacement chars) |
| `--data-binary @file` | `ed 95 9c` | CORRECT (UTF-8 한) |

---

## 수정 방안

### 방안 1: 서버측 수정 (권장)
`api.ts`의 `/instruct`와 `/report` 엔드포인트에서 임시 파일을 사용하지 않고,
**curl 호출부를 수정**하면 된다.

Commander/Worker가 curl을 호출할 때:
```bash
# 기존 (깨짐)
curl -d '{"worker":"w","instruction":"한글"}'

# 수정 (정상)
printf '{"worker":"w","instruction":"한글"}' > /tmp/_msg.json
curl --data-binary @/tmp/_msg.json -H "Content-Type: application/json; charset=utf-8" URL
rm /tmp/_msg.json
```

### 방안 2: 서버측 래퍼 (대안)
Node.js 서버에서 요청 바디를 raw buffer로 받아 직접 UTF-8 디코딩하는 미들웨어 추가.
하지만 이는 과도한 수정이고, curl 호출부만 고치면 됨.

---

## 서버 코드 상태
- `command-center/server/routes/api.ts` — 코드 자체는 정상
- 재기동 불필요, 코드 수정 불필요 (curl 호출부만 변경하면 됨)

## 테스트 명령어
```bash
# 정상 동작 확인용
printf '{"worker":"worker-1","instruction":"인코딩 테스트 OK"}' > /tmp/_test.json
curl -s -X POST http://localhost:9000/api/instruct -H "Content-Type: application/json; charset=utf-8" --data-binary @/tmp/_test.json
```
