"""DeepSeek-R1:14b Re-benchmark with higher token limits (thinking tokens)"""
import requests
import time
import json

OLLAMA_URL = "http://localhost:11434"

TESTS = [
    {
        "name": "한국어 이해력",
        "prompt": "대한민국의 경제 발전 과정을 1960년대부터 현재까지 시대별로 나누어 설명해주세요. 각 시대의 핵심 산업과 주요 정책을 포함해주세요.",
        "max_tokens": 1200,
        "check": lambda r: any(k in r for k in ["경제", "산업", "발전", "정책"]),
    },
    {
        "name": "추론 능력",
        "prompt": "A farmer has 17 sheep. All but 9 die. How many sheep are left? Also, if you have 3 apples and take away 2, how many do you have? Explain your reasoning step by step.",
        "max_tokens": 800,
        "check": lambda r: "9" in r and "2" in r,
    },
    {
        "name": "코드 생성",
        "prompt": "Write a Python function that implements binary search on a sorted list. Include type hints, docstring, and handle edge cases. Then write a function to find the longest common subsequence of two strings using dynamic programming.",
        "max_tokens": 1500,
        "check": lambda r: "def " in r and ("binary" in r.lower() or "search" in r.lower()),
    },
    {
        "name": "요약 능력",
        "prompt": "Summarize the following in 3 bullet points: Machine learning is a subset of artificial intelligence that enables systems to learn from data. Deep learning uses neural networks with many layers. Transformers revolutionized NLP with attention mechanisms, leading to models like GPT and BERT that achieve state-of-the-art results.",
        "max_tokens": 600,
        "check": lambda r: len(r.strip()) > 50,
    },
    {
        "name": "복잡 추론",
        "prompt": "세 명의 친구 A, B, C가 있습니다. A는 항상 진실을 말하고, B는 항상 거짓을 말하고, C는 무작위로 진실 또는 거짓을 말합니다. 당신은 이 세 명 중 누가 누구인지 모릅니다. 한 번의 예/아니오 질문으로 C가 누구인지 알아낼 수 있는 질문을 제안하고, 왜 그 질문이 작동하는지 논리적으로 설명해주세요.",
        "max_tokens": 1500,
        "check": lambda r: any(k in r for k in ["진실", "거짓", "질문", "논리"]),
    },
    {
        "name": "한국어 리서치 분석",
        "prompt": "다음 뉴스를 분석해주세요: '삼성전자가 AI 반도체 분야에 3년간 10조원을 투자한다고 발표했다. 이는 엔비디아와의 경쟁에서 뒤처지지 않기 위한 전략이다.' 이 뉴스의 (1) 긍정적 측면 3가지 (2) 부정적/우려 측면 3가지 (3) 투자자 관점에서의 시사점을 분석해주세요.",
        "max_tokens": 2000,
        "check": lambda r: any(k in r for k in ["긍정", "부정", "투자", "시사점", "분석"]),
    },
]

MODEL = "deepseek-r1:14b"

print(f"\n{'='*60}")
print(f"  Re-benchmarking: {MODEL} (extended token limits)")
print(f"  API: chat (thinking tokens accounted for)")
print(f"{'='*60}\n")

results = []

for i, test in enumerate(TESTS):
    print(f"[{i+1}/{len(TESTS)}] {test['name']} (max_tokens={test['max_tokens']})...", flush=True)

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": test["prompt"]}],
        "stream": False,
        "options": {"num_predict": test["max_tokens"]},
    }

    start = time.time()
    try:
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=600)
        elapsed = time.time() - start
        data = resp.json()

        response_text = data.get("message", {}).get("content", "")
        eval_count = data.get("eval_count", 0)
        eval_duration = data.get("eval_duration", 0)
        load_duration = data.get("load_duration", 0)

        if eval_duration > 0:
            tok_per_sec = eval_count / (eval_duration / 1e9)
        else:
            tok_per_sec = 0

        load_sec = load_duration / 1e9 if load_duration else 0

        # For deepseek-r1, strip <think>...</think> tags for content check
        visible_text = response_text
        if "<think>" in visible_text:
            import re
            visible_text = re.sub(r'<think>.*?</think>', '', visible_text, flags=re.DOTALL).strip()

        think_tokens = len(response_text) - len(visible_text)
        passed = test["check"](visible_text)

        result = {
            "name": test["name"],
            "speed": round(tok_per_sec, 1),
            "tokens": eval_count,
            "total_time": round(elapsed, 1),
            "load_time": round(load_sec, 1),
            "passed": passed,
            "visible_length": len(visible_text),
            "think_length": think_tokens,
        }
        results.append(result)

        status = "PASS" if passed else "FAIL"
        print(f"  -> {status} | {tok_per_sec:.1f} tok/s | {eval_count} tokens | {elapsed:.1f}s (load: {load_sec:.1f}s)")
        print(f"     visible: {len(visible_text)} chars | think: {think_tokens} chars")
        if not passed:
            print(f"     Preview: {visible_text[:150]}")

    except Exception as e:
        print(f"  -> ERROR: {e}")
        results.append({
            "name": test["name"],
            "speed": 0, "tokens": 0, "total_time": 0,
            "load_time": 0, "passed": False,
            "visible_length": 0, "think_length": 0,
        })

avg_speed = sum(r["speed"] for r in results) / len(results) if results else 0
pass_count = sum(1 for r in results if r["passed"])

print(f"\n{'='*60}")
print(f"  {MODEL} Summary (extended)")
print(f"  Pass: {pass_count}/{len(results)}")
print(f"  Avg Speed: {avg_speed:.1f} tok/s")
print(f"{'='*60}\n")

output = {
    "model": MODEL,
    "results": results,
    "avg_speed": round(avg_speed, 1),
    "pass_count": pass_count,
    "total_count": len(results),
}

with open("bench_14b_ds_results.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print("Results saved to bench_14b_ds_results.json")
