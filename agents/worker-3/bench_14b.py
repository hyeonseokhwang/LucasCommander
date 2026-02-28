"""14B Model Benchmark Script for Lucas Initiative — v2"""
import requests
import time
import json
import sys
import subprocess

OLLAMA_URL = "http://localhost:11434"

TESTS = [
    {
        "name": "한국어 이해력",
        "prompt": "대한민국의 경제 발전 과정을 1960년대부터 현재까지 시대별로 나누어 설명해주세요. 각 시대의 핵심 산업과 주요 정책을 포함해주세요.",
        "max_tokens": 300,
        "max_tokens_think": 1200,  # deepseek-r1 thinking model needs more
        "check": lambda r: any(k in r for k in ["경제", "산업", "발전", "정책"]),
    },
    {
        "name": "추론 능력",
        "prompt": "A farmer has 17 sheep. All but 9 die. How many sheep are left? Also, if you have 3 apples and take away 2, how many do you have? Explain your reasoning step by step.",
        "max_tokens": 200,
        "max_tokens_think": 800,
        "check": lambda r: "9" in r and "2" in r,
    },
    {
        "name": "코드 생성",
        "prompt": "Write a Python function that implements binary search on a sorted list. Include type hints, docstring, and handle edge cases. Then write a function to find the longest common subsequence of two strings using dynamic programming.",
        "max_tokens": 500,
        "max_tokens_think": 2000,
        "check": lambda r: "def " in r and ("binary" in r.lower() or "search" in r.lower()),
    },
    {
        "name": "요약 능력",
        "prompt": "Summarize the following in 3 bullet points: Machine learning is a subset of artificial intelligence that enables systems to learn from data. Deep learning uses neural networks with many layers. Transformers revolutionized NLP with attention mechanisms, leading to models like GPT and BERT that achieve state-of-the-art results.",
        "max_tokens": 150,
        "max_tokens_think": 600,
        "check": lambda r: len(r.strip()) > 50,
    },
    {
        "name": "복잡 추론",
        "prompt": "세 명의 친구 A, B, C가 있습니다. A는 항상 진실을 말하고, B는 항상 거짓을 말하고, C는 무작위로 진실 또는 거짓을 말합니다. 당신은 이 세 명 중 누가 누구인지 모릅니다. 한 번의 예/아니오 질문으로 C가 누구인지 알아낼 수 있는 질문을 제안하고, 왜 그 질문이 작동하는지 논리적으로 설명해주세요.",
        "max_tokens": 500,
        "max_tokens_think": 2000,
        "check": lambda r: any(k in r for k in ["진실", "거짓", "질문", "논리"]),
    },
    {
        "name": "한국어 리서치 분석",
        "prompt": "다음 뉴스를 분석해주세요: '삼성전자가 AI 반도체 분야에 3년간 10조원을 투자한다고 발표했다. 이는 엔비디아와의 경쟁에서 뒤처지지 않기 위한 전략이다.' 이 뉴스의 (1) 긍정적 측면 3가지 (2) 부정적/우려 측면 3가지 (3) 투자자 관점에서의 시사점을 분석해주세요.",
        "max_tokens": 600,
        "max_tokens_think": 2400,
        "check": lambda r: any(k in r for k in ["긍정", "부정", "투자", "시사점", "분석"]),
    },
]


def check_gpu():
    """Check GPU VRAM usage."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total,memory.free",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            parts = result.stdout.strip().split(", ")
            return {"used_mb": int(parts[0]), "total_mb": int(parts[1]), "free_mb": int(parts[2])}
    except:
        pass
    return None


def run_benchmark(model: str, use_chat_api: bool = False, is_thinking_model: bool = False):
    print(f"\n{'='*60}")
    print(f"  Benchmarking: {model}")
    print(f"  API: {'chat' if use_chat_api else 'generate'}")
    print(f"  Thinking model: {is_thinking_model}")
    print(f"{'='*60}\n")

    # GPU before
    gpu_before = check_gpu()
    if gpu_before:
        print(f"  GPU VRAM before: {gpu_before['used_mb']}MB / {gpu_before['total_mb']}MB")

    results = []

    for i, test in enumerate(TESTS):
        print(f"\n[{i+1}/{len(TESTS)}] {test['name']}...", flush=True)

        max_tok = test["max_tokens_think"] if is_thinking_model else test["max_tokens"]

        if use_chat_api:
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": test["prompt"]}],
                "stream": False,
                "options": {"num_predict": max_tok},
            }
            url = f"{OLLAMA_URL}/api/chat"
        else:
            payload = {
                "model": model,
                "prompt": test["prompt"],
                "stream": False,
                "options": {"num_predict": max_tok},
            }
            url = f"{OLLAMA_URL}/api/generate"

        start = time.time()
        try:
            resp = requests.post(url, json=payload, timeout=600)
            elapsed = time.time() - start
            data = resp.json()

            if use_chat_api:
                response_text = data.get("message", {}).get("content", "")
            else:
                response_text = data.get("response", "")

            eval_count = data.get("eval_count", 0)
            eval_duration = data.get("eval_duration", 0)
            load_duration = data.get("load_duration", 0)
            prompt_eval_count = data.get("prompt_eval_count", 0)

            if eval_duration > 0:
                tok_per_sec = eval_count / (eval_duration / 1e9)
            elif eval_count > 0 and elapsed > 0:
                tok_per_sec = eval_count / elapsed
            else:
                tok_per_sec = 0

            load_sec = load_duration / 1e9 if load_duration else 0
            passed = test["check"](response_text)

            # For thinking models, count actual visible output length
            visible_len = len(response_text)

            result = {
                "name": test["name"],
                "speed": round(tok_per_sec, 1),
                "tokens": eval_count,
                "total_time": round(elapsed, 1),
                "load_time": round(load_sec, 1),
                "passed": passed,
                "visible_chars": visible_len,
                "response_preview": response_text[:300],
            }
            results.append(result)

            status = "PASS" if passed else "FAIL"
            print(f"  → {status} | {tok_per_sec:.1f} tok/s | {eval_count} tokens | {elapsed:.1f}s (load: {load_sec:.1f}s) | visible: {visible_len} chars")
            if not passed:
                print(f"  → Response preview: {response_text[:200]}")

            # Check GPU after first test (model should be loaded)
            if i == 0:
                gpu_after = check_gpu()
                if gpu_after:
                    print(f"  GPU VRAM after load: {gpu_after['used_mb']}MB / {gpu_after['total_mb']}MB")
                    vram_model = gpu_after['used_mb'] - (gpu_before['used_mb'] if gpu_before else 0)
                    print(f"  Estimated model VRAM: ~{vram_model}MB ({vram_model/1024:.1f}GB)")

        except Exception as e:
            elapsed = time.time() - start
            print(f"  → ERROR: {e}")
            results.append({
                "name": test["name"],
                "speed": 0, "tokens": 0, "total_time": round(elapsed, 1),
                "load_time": 0, "passed": False, "visible_chars": 0,
                "response_preview": str(e),
            })

    # Summary
    speeds = [r["speed"] for r in results if r["speed"] > 0]
    avg_speed = sum(speeds) / len(speeds) if speeds else 0
    pass_count = sum(1 for r in results if r["passed"])
    total_count = len(results)

    gpu_final = check_gpu()

    print(f"\n{'='*60}")
    print(f"  {model} Summary")
    print(f"  Pass: {pass_count}/{total_count}")
    print(f"  Avg Speed: {avg_speed:.1f} tok/s")
    if gpu_final:
        print(f"  GPU VRAM: {gpu_final['used_mb']}MB / {gpu_final['total_mb']}MB")
    print(f"{'='*60}\n")

    return {
        "model": model,
        "results": results,
        "avg_speed": round(avg_speed, 1),
        "pass_count": pass_count,
        "total_count": total_count,
        "gpu_before": gpu_before,
        "gpu_after": gpu_final,
    }


if __name__ == "__main__":
    models_to_test = [
        ("qwen2.5:14b", False, False),
        ("deepseek-r1:14b", True, True),  # chat API + thinking model
    ]

    if len(sys.argv) > 1:
        target = sys.argv[1]
        models_to_test = [(m, c, t) for m, c, t in models_to_test if m == target]

    all_results = {}
    for model, use_chat, is_thinking in models_to_test:
        result = run_benchmark(model, use_chat_api=use_chat, is_thinking_model=is_thinking)
        all_results[model] = result

    # Save results
    with open("bench_14b_results.json", "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)

    print(f"\nResults saved to bench_14b_results.json")
