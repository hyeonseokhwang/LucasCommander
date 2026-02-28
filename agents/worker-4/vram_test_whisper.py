"""Whisper large-v3 CUDA load test for VRAM coexistence testing."""
import sys
import time
import subprocess
import signal

def get_vram_mb():
    """Get current GPU VRAM usage in MiB."""
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            text=True
        )
        return int(out.strip())
    except Exception:
        return -1

def main():
    model_size = sys.argv[1] if len(sys.argv) > 1 else "large-v3"
    print(f"=== Whisper {model_size} CUDA Load Test ===")

    vram_before = get_vram_mb()
    print(f"VRAM before load: {vram_before} MiB")

    print(f"Loading Whisper {model_size} on CUDA (float16)...")
    t0 = time.time()

    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device="cuda", compute_type="float16")

    load_time = time.time() - t0
    vram_after = get_vram_mb()
    whisper_vram = vram_after - vram_before

    print(f"Load time: {load_time:.1f}s")
    print(f"VRAM after load: {vram_after} MiB")
    print(f"Whisper VRAM usage: {whisper_vram} MiB ({whisper_vram/1024:.1f} GB)")
    print(f"VRAM remaining: {24564 - vram_after} MiB ({(24564 - vram_after)/1024:.1f} GB)")
    print()
    print("Whisper model loaded and held in memory.")
    print("Press Ctrl+C or send SIGTERM to unload and exit.")
    print("READY")  # Signal for parent process
    sys.stdout.flush()

    # Keep model in memory
    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        print("\nUnloading Whisper model...")
        del model
        time.sleep(1)
        vram_final = get_vram_mb()
        print(f"VRAM after unload: {vram_final} MiB")

if __name__ == "__main__":
    main()
