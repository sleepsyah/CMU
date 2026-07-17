from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
STATE_ROOT = Path(os.environ.get("ELLIPSIS_BACKEND_STATE_DIR", str(BACKEND))).expanduser()
VENV = STATE_ROOT / ".venv"
PYTHON = VENV / "bin" / "python"
PIP = VENV / "bin" / "pip"
HOST = "127.0.0.1"
PORT = "8000"
BASE_URL = f"http://{HOST}:{PORT}"
PID_FILE = STATE_ROOT / ".backend.pid"
LOG_FILE = STATE_ROOT / ".backend.log"
HF_CACHE = STATE_ROOT / ".hf-cache"


def run(command: list[str], **kwargs: object) -> None:
    subprocess.run(command, check=True, cwd=ROOT, **kwargs)


def request_json(path: str, timeout: int = 5) -> dict[str, object] | None:
    try:
        request = Request(f"{BASE_URL}{path}", method="POST" if path == "/warmup" else "GET")
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, TimeoutError, json.JSONDecodeError):
        return None


def process_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def existing_backend_is_healthy() -> bool:
    health = request_json("/health", timeout=2)
    return bool(health and health.get("status") == "ok")


def ensure_venv() -> None:
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    if not PYTHON.exists():
        print("Creating backend virtual environment...")
        run([sys.executable, "-m", "venv", str(VENV)])
    print("Installing backend requirements...")
    run([str(PIP), "install", "-r", str(BACKEND / "requirements.txt")])
    run([str(PIP), "install", "-r", str(BACKEND / "requirements-ml.txt")])


def stop_stale_pid() -> None:
    if not PID_FILE.exists():
        return
    try:
        pid = int(PID_FILE.read_text().strip())
    except ValueError:
        PID_FILE.unlink(missing_ok=True)
        return
    if process_running(pid):
        return
    PID_FILE.unlink(missing_ok=True)


def start_server() -> None:
    stop_stale_pid()
    if existing_backend_is_healthy():
        print(f"Backend already running at {BASE_URL}")
        return

    env = os.environ.copy()
    env.setdefault("HF_HOME", str(HF_CACHE))
    env.setdefault("TRANSFORMERS_CACHE", str(HF_CACHE / "transformers"))
    env.setdefault("TOKENIZERS_PARALLELISM", "false")
    log = LOG_FILE.open("ab")
    process = subprocess.Popen(
        [str(PYTHON), "-m", "uvicorn", "backend.app.main:app", "--host", HOST, "--port", PORT],
        cwd=ROOT,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    PID_FILE.write_text(str(process.pid))
    print(f"Started backend pid {process.pid}; logs: {LOG_FILE}")


def wait_for_health(seconds: int = 30) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if existing_backend_is_healthy():
            return
        time.sleep(0.5)
    raise RuntimeError(f"Backend did not become healthy at {BASE_URL}. Check {LOG_FILE}.")


def warmup() -> None:
    print("Warming supporting models. First run may download model files...")
    payload = request_json("/warmup", timeout=180)
    if not payload:
        raise RuntimeError(f"Warmup failed. Check {LOG_FILE}.")
    print(json.dumps(payload, indent=2))
    if not payload.get("ready"):
        print("Backend is reachable, but one or more supporting models did not load.")


def main() -> int:
    try:
        ensure_venv()
        start_server()
        wait_for_health()
        warmup()
        print(f"Supporting backend ready at {BASE_URL}")
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f"Backend start failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
