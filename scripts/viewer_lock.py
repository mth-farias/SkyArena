#!/usr/bin/env python3
"""Stop leftover SkyArena HTTP viewers before a new one starts.

Stdlib only. Kills leftover ``python`` processes running this repo's
``serve.py``. Do not kill shells whose command line merely mentions
``serve.py``. Then fail if 127.0.0.1:5444 is still held by a foreign
program.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

HOST = "127.0.0.1"
PORT = 5444
MAGIC = "skyarena-viewer"


def repo_root() -> Path:
    """Return the repository root (parent of ``scripts/``)."""
    return Path(__file__).resolve().parents[1]


def pid_path(root: Path) -> Path:
    """Return the pid file at the repo root (gitignored ``*.pid``)."""
    return root / "viewer.pid"


def _pid_candidates(root: Path) -> tuple[Path, ...]:
    """Return the viewer pid file paths."""
    return (pid_path(root),)


def port_open() -> bool:
    """Return True if TCP 5444 accepts a connection."""
    try:
        with socket.create_connection((HOST, PORT), timeout=0.4):
            return True
    except OSError:
        return False


def _pid_alive(pid: int) -> bool:
    """Return True if ``pid`` is still a process."""
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        kernel.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _kill_pid(pid: int) -> None:
    """Terminate ``pid`` (Windows taskkill, else SIGTERM)."""
    if pid <= 0 or pid == os.getpid():
        return
    if os.name == "nt":
        windir = os.environ.get("SYSTEMROOT") or r"C:\Windows"
        exe = Path(windir) / "System32" / "taskkill.exe"
        argv = [
            str(exe) if exe.is_file() else "taskkill",
            "/PID",
            str(pid),
            "/T",
            "/F",
        ]
        subprocess.run(argv, check=False, capture_output=True)
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    for _ in range(15):
        if not _pid_alive(pid):
            return
        time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return


def _root_s(root: Path) -> str:
    """Return ``root`` as a lowercase slash path."""
    return str(root).replace("\\", "/").lower()


def _exe_path(pid: int) -> str:
    """Return the executable path for ``pid``, or empty."""
    if pid <= 0:
        return ""
    if os.name == "nt":
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Process -Filter "
                f"\"ProcessId={pid}\").ExecutablePath",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return (proc.stdout or "").strip()
    try:
        return str(Path(f"/proc/{pid}/exe").resolve())
    except OSError:
        return ""


def _is_ours(command: str, root: Path, pid: int = 0) -> bool:
    """Return True if ``pid`` is Python running this repo's serve.py."""
    blob = command.replace("\\", "/").lower()
    exe = _exe_path(pid).replace("\\", "/").lower() if pid else ""
    if "python" not in exe:
        return False
    if "serve.py" not in blob and "http.server" not in blob:
        return False
    root_s = _root_s(root)
    if root_s in exe or root_s in blob:
        return True
    # ``cd scripts; python serve.py`` has no repo path on the command line.
    name = Path(exe).name.lower()
    return name.startswith("python") and "serve.py" in blob


def _is_5444_leftover(command: str, root: Path, pid: int) -> bool:
    """Return True if the 5444 listener is a leftover ``serve.py``."""
    blob = command.replace("\\", "/").lower()
    if "--stop" in blob:
        return False
    return _is_ours(command, root, pid)


def _is_server_cmd(command: str, root: Path, pid: int = 0) -> bool:
    """Return True if ``command`` is a leftover server, not a --stop helper."""
    if "--stop" in command.lower():
        return False
    return _is_ours(command, root, pid)


def _cmdline(pid: int) -> str:
    """Return the command line for ``pid``, or empty."""
    if pid <= 0:
        return ""
    if os.name == "nt":
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}'"
                ").CommandLine",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return (proc.stdout or "").strip()
    proc = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return (proc.stdout or "").strip()


def _windows_cmdlines() -> list[tuple[int, str]]:
    """Return (pid, command line) pairs that mention serve.py."""
    proc = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | "
            "Where-Object { $_.CommandLine -match 'serve\\.py' } | "
            "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    raw = (proc.stdout or "").strip()
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if isinstance(payload, dict):
        payload = [payload]
    out: list[tuple[int, str]] = []
    if not isinstance(payload, list):
        return out
    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            pid = int(item.get("ProcessId") or 0)
        except (TypeError, ValueError):
            continue
        cmd = str(item.get("CommandLine") or "")
        if pid > 0 and cmd:
            out.append((pid, cmd))
    return out


def _posix_cmdlines() -> list[tuple[int, str]]:
    """Return (pid, command line) pairs from ``ps``."""
    proc = subprocess.run(
        ["ps", "-ax", "-o", "pid=,command="],
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    out: list[tuple[int, str]] = []
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if "serve.py" not in line:
            continue
        pid_s, _, cmd = line.partition(" ")
        try:
            pid = int(pid_s)
        except ValueError:
            continue
        out.append((pid, cmd))
    return out


def _listener_pid() -> int | None:
    """Return the PID listening on 127.0.0.1:5444, if known."""
    if os.name == "nt":
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-NetTCPConnection -LocalAddress '127.0.0.1' "
                f"-LocalPort {PORT} -State Listen "
                "-ErrorAction SilentlyContinue "
                "| Select-Object -First 1 -ExpandProperty OwningProcess)",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        text = (proc.stdout or "").strip()
        try:
            pid = int(text)
        except ValueError:
            return None
        return pid if pid > 0 else None
    proc = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{PORT}", "-sTCP:LISTEN", "-t"],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    for line in (proc.stdout or "").splitlines():
        try:
            return int(line.strip())
        except ValueError:
            continue
    return None


def read_pid(root: Path) -> int | None:
    """Return the recorded pid if the magic line matches."""
    for path in _pid_candidates(root):
        if not path.is_file():
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        if len(lines) < 2 or lines[1].strip() != MAGIC:
            continue
        try:
            return int(lines[0].strip())
        except ValueError:
            continue
    return None


def clear_pid(root: Path) -> None:
    """Remove the viewer pid file."""
    for path in _pid_candidates(root):
        if path.is_file():
            path.unlink()


def stop_viewer_servers(root: Path) -> int:
    """Kill this repo's leftover viewers. Do not kill a foreign 5444.

    Returns:
        0 if 5444 is free (or will be ours), 1 if a foreign process holds it.
    """
    me = os.getpid()
    protected = {me, os.getppid()}
    recorded = read_pid(root)
    if recorded and recorded not in protected and _pid_alive(recorded):
        _kill_pid(recorded)
        for _ in range(25):
            if not _pid_alive(recorded):
                break
            time.sleep(0.1)
    pairs = _windows_cmdlines() if os.name == "nt" else _posix_cmdlines()
    for pid, cmd in pairs:
        if pid in protected:
            continue
        if _is_server_cmd(cmd, root, pid):
            _kill_pid(pid)
    deadline = time.time() + 3.0
    while time.time() < deadline:
        if not port_open():
            clear_pid(root)
            print("skyarena: port 5444 is free", flush=True)
            return 0
        owner = _listener_pid()
        if owner and owner not in protected:
            cmd = _cmdline(owner)
            if _is_5444_leftover(cmd, root, owner):
                _kill_pid(owner)
                time.sleep(0.1)
                continue
            print(
                f"skyarena: {HOST}:{PORT} is in use by "
                "another process",
                file=sys.stderr,
            )
            print("skyarena: will not kill it", file=sys.stderr)
            return 1
        time.sleep(0.1)
    clear_pid(root)
    if port_open():
        print(
            f"skyarena: {HOST}:{PORT} is in use by "
            "another process",
            file=sys.stderr,
        )
        print("skyarena: will not kill it", file=sys.stderr)
        return 1
    print("skyarena: port 5444 is free", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(stop_viewer_servers(repo_root()))
