#!/usr/bin/env python3
"""Host-side monitor. DB/worker can fail while the host timer still sends mail."""
import json
import os
import re
import subprocess
import time
from pathlib import Path


def collectStatus(container):
    try:
        result = subprocess.run(
            ["/usr/bin/docker", "exec", container, "node", "dist/scripts/accountDeletionOps.js", "monitor"],
            capture_output=True, text=True, timeout=40, check=False,
        )
        if result.returncode not in (0, 2):
            return {"monitor_unavailable": True}
        data = json.loads(result.stdout.strip().splitlines()[-1])
        fields = ("failed_count", "overdue_count", "long_pending_count", "pending_count", "oldest_pending_seconds", "worker_stale", "resolution_overdue_count", "push_worker_stale", "push_long_pending_count")
        if not all(key in data for key in fields):
            return {"monitor_unavailable": True}
        # Never forward raw process output, request IDs, environment or error details.
        return {key: bool(data[key]) if key.endswith("stale") else int(data[key]) for key in fields}
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError, IndexError):
        return {"monitor_unavailable": True}


def needsAlert(data):
    return bool(data.get("monitor_unavailable") or data.get("worker_stale") or data.get("push_worker_stale") or data.get("push_long_pending_count") or
                data.get("failed_count") or data.get("overdue_count") or data.get("long_pending_count"))


def shouldSend(previous, alert, now):
    return (alert and (not previous.get("alert") or now - previous.get("sent_at", 0) >= 3600)) or (
        not alert and previous.get("alert", False))


def main():
    container = os.environ.get("PRIVACY_MONITOR_CONTAINER", "")
    recipient = os.environ.get("PRIVACY_ALERT_EMAIL", "")
    sender = os.environ.get("PRIVACY_ALERT_FROM", "")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", container):
        raise ValueError("MONITOR_CONTAINER_REQUIRED")
    for address in (recipient, sender):
        if not re.fullmatch(r"[a-zA-Z0-9_.+%-]+@[a-zA-Z0-9.-]+", address):
            raise ValueError("MONITOR_EMAIL_INVALID")
    state_file = Path("/var/lib/shiftmate-privacy-monitor/state.json")
    state_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        previous = json.loads(state_file.read_text())
    except (FileNotFoundError, ValueError):
        previous = {}
    data = collectStatus(container)
    alert = needsAlert(data)
    now = time.time()
    if shouldSend(previous, alert, now):
        subject = "ShiftMate privacy ALERT" if alert else "ShiftMate privacy RECOVERED"
        message = f"To: {recipient}\nFrom: {sender}\nSubject: {subject}\nContent-Type: text/plain; charset=UTF-8\n\n{json.dumps(data)}\n"
        result = subprocess.run(["/usr/sbin/sendmail", "-t", "-oi"], input=message, text=True,
                                capture_output=True, timeout=20, check=False)
        if result.returncode != 0:
            raise RuntimeError("MONITOR_MAIL_FAILED")
        temporary = state_file.with_suffix(".tmp")
        temporary.write_text(json.dumps({"alert": alert, "sent_at": now}))
        temporary.chmod(0o600)
        temporary.replace(state_file)
    print(json.dumps({"privacy_alert": alert, **data}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Transport failures remain visible to systemd without leaking mail credentials.
        print('{"code":"PRIVACY_MONITOR_FAILED"}', flush=True)
        raise SystemExit(1)
