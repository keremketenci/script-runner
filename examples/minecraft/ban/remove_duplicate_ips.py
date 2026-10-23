"""Removes duplicate IP addresses from failed_ips.txt.

Keeps the first time each IP appears and drops the later copies, so the order of
the file stays the same. Lists every IP that was duplicated and how often, and only
rewrites the file when something was actually removed. Blank lines and spaces around
the IPs are cleaned up as well.
"""

import sys
from collections import Counter
from pathlib import Path

GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
BOLD = "\033[1m"
RESET = "\033[0m"

DEFAULT_FILE = "failed_ips.txt"


def main() -> int:
    print(f"{BOLD}Duplicate IP remover{RESET}")
    answer = input(f"IP list file {CYAN}[{DEFAULT_FILE}]{RESET}: ").strip()
    path = Path(answer or DEFAULT_FILE).expanduser()
    if not path.is_file():
        print(f"{RED}File not found: {path.resolve()}{RESET}")
        return 1

    ips = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    counts = Counter(ips)
    duplicates = {ip_address: count for ip_address, count in counts.items() if count > 1}

    if not duplicates:
        print(f"{GREEN}No duplicates: all {len(ips)} IPs are unique. The file was not changed.{RESET}")
        return 0

    print(f"\n{YELLOW}Found {len(duplicates)} duplicated IPs:{RESET}")
    for ip_address, count in sorted(duplicates.items()):
        print(f"  {ip_address:<16} {count}x  {YELLOW}-{count - 1}{RESET}")

    # dict.fromkeys keeps the first occurrence of each IP in the original order
    unique = list(dict.fromkeys(ips))
    path.write_text("\n".join(unique) + "\n", encoding="utf-8")
    removed = len(ips) - len(unique)
    print(f"\n{GREEN}Removed {removed} lines: {len(ips)} -> {len(unique)} IPs in {path}{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
