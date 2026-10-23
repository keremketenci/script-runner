"""Collects the IP addresses of players who failed to log in.

Step 2 of the example sequence: read merged_logs.txt (written by merge_logs.py),
find failed logins and write the unique IPs to failed_ips.txt.

Asks two questions with input(), uses colors, writes a file next to itself
(the app runs scripts inside their own folder) and exits with code 1 if the
log file does not exist.
"""

import re
import sys
from pathlib import Path

GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
BOLD = "\033[1m"
RESET = "\033[0m"

# Written by merge_logs.py, the step before this one in the example sequence
DEFAULT_LOG = "merged_logs.txt"
DEFAULT_OUTPUT = "failed_ips.txt"

# Matches: [08:39:36] [Server thread/INFO]: FishNet (/176.65.149.198:61000) lost connection: Disconnected
FAILED_LOGIN = re.compile(r"\]: (\S+) \(/([\d.]+):\d+\) lost connection: (.+)")

# Only disconnects with these reasons are counted as failed logins.
# Add more reasons here (e.g. "Wrong password!") if your log contains them.
FAILED_REASONS = {"Disconnected"}


def ask(question: str, default: str) -> str:
    answer = input(f"{question} {CYAN}[{default}]{RESET}: ").strip()
    return answer or default


def main() -> int:
    print(f"{BOLD}Failed login finder{RESET}")
    print(f"Working folder: {Path.cwd()}\n")

    log_path = Path(ask("Log file", DEFAULT_LOG)).expanduser()
    if not log_path.is_file():
        print(f"{RED}Log file not found: {log_path}{RESET}")
        return 1

    attempts_by_ip: dict[str, set[str]] = {}
    attempt_count = 0
    with log_path.open(encoding="utf-8", errors="replace") as log_file:
        for line in log_file:
            match = FAILED_LOGIN.search(line)
            if not match:
                continue
            player, ip_address, reason = match.groups()
            if reason.strip() not in FAILED_REASONS:
                continue
            attempts_by_ip.setdefault(ip_address, set()).add(player)
            attempt_count += 1

    if not attempts_by_ip:
        print(f"{GREEN}No failed logins found.{RESET}")
        return 0

    print(f"\n{YELLOW}{attempt_count} failed attempts from {len(attempts_by_ip)} IPs:{RESET}")
    for ip_address in sorted(attempts_by_ip):
        players = ", ".join(sorted(attempts_by_ip[ip_address]))
        print(f"  {ip_address:<16} {players}")

    output_path = Path(ask("\nOutput file", DEFAULT_OUTPUT)).expanduser()
    output_path.write_text("\n".join(sorted(attempts_by_ip)) + "\n", encoding="utf-8")
    print(f"{GREEN}Wrote {len(attempts_by_ip)} unique IPs to {output_path.resolve()}{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
