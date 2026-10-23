"""Step 1 of the example sequence: merge the server logs into one text file.

Minecraft keeps one gzip file per day (for example 2026-10-20-1.log.gz) and
the current day in latest.log. This script asks for the logs folder, unpacks
every .gz file in date order, adds latest.log at the end and writes it all
into merged_logs.txt for the next step. Other .log files (mod logs) are skipped.
"""

import gzip
import sys
from pathlib import Path

GREEN = "\033[32m"
RED = "\033[31m"
CYAN = "\033[36m"
BOLD = "\033[1m"
RESET = "\033[0m"

DEFAULT_FOLDER = "logs"
OUTPUT = "merged_logs.txt"
# The log Minecraft is writing right now; it is not zipped yet
CURRENT_LOG = "latest.log"


def archive_order(archive: Path) -> tuple[str, int]:
    """Date first, then the number of the day's file, so -10 comes after -9."""
    # "2026-10-09-3.log.gz" -> ("2026-10-09", 3)
    stem = archive.name.removesuffix(".log.gz").removesuffix(".gz")
    date, _separator, number = stem.rpartition("-")
    return (date, int(number)) if number.isdigit() else (stem, 0)


def read_lines(log: Path) -> list[str]:
    opener = gzip.open if log.suffix == ".gz" else open
    with opener(log, "rt", encoding="utf-8", errors="replace") as log_file:
        return log_file.readlines()


def main() -> int:
    print(f"{BOLD}Log merger{RESET}")
    answer = input(f"Folder with .log.gz files {CYAN}[{DEFAULT_FOLDER}]{RESET}: ").strip()
    folder = Path(answer or DEFAULT_FOLDER).expanduser()

    if not folder.is_dir():
        print(f"{RED}Folder not found: {folder.resolve()}{RESET}")
        return 1

    logs = sorted(folder.glob("*.gz"), key=archive_order)
    current = folder / CURRENT_LOG
    if current.is_file():
        logs.append(current)
    if not logs:
        print(f"{RED}No .gz files or {CURRENT_LOG} found in {folder.resolve()}{RESET}")
        return 1

    line_count = 0
    with open(OUTPUT, "w", encoding="utf-8") as merged:
        for log in logs:
            lines = read_lines(log)
            # A file that does not end with a newline would glue its last line to the next file
            if lines and not lines[-1].endswith("\n"):
                lines[-1] += "\n"
            merged.writelines(lines)
            line_count += len(lines)
            print(f"  {log.name:<24} {len(lines):>6} lines")

    print(f"{GREEN}Merged {len(logs)} files ({line_count} lines) into {OUTPUT}{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
