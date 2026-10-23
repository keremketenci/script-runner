"""Step 3 of the example sequence: add the new IPs to a ban list without duplicates.

Reads failed_ips.txt (written by find_failed_logins.py) and merges it into
ban_list.txt. IPs already on the list are skipped, so running the sequence
again every day only adds the new ones.
"""

import sys
from pathlib import Path

GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
BOLD = "\033[1m"
RESET = "\033[0m"

NEW_IPS = Path("failed_ips.txt")
BAN_LIST = Path("ban_list.txt")


def read_ips(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def main() -> int:
    print(f"{BOLD}Ban list updater{RESET}")
    if not NEW_IPS.exists():
        print(f"{RED}{NEW_IPS} not found. Run find_failed_logins.py first.{RESET}")
        return 1

    new_ips = read_ips(NEW_IPS)
    banned = read_ips(BAN_LIST)
    added = sorted(new_ips - banned)

    for ip_address in added:
        print(f"  {GREEN}+ {ip_address}{RESET}")
    for ip_address in sorted(new_ips & banned):
        print(f"  {YELLOW}= {ip_address} (already banned){RESET}")

    BAN_LIST.write_text("\n".join(sorted(banned | new_ips)) + "\n", encoding="utf-8")
    print(f"{GREEN}{len(added)} new, {len(banned | new_ips)} IPs on {BAN_LIST} in total{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
