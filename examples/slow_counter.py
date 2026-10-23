"""Counts slowly so there is time to test Stop, Ctrl+C and the elapsed time display."""

import sys
import time

GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"

STEPS = 60


def main() -> int:
    print(f"Counting to {STEPS}, one step per second. Press Ctrl+C or Stop to end early.")
    try:
        for step in range(1, STEPS + 1):
            # \r goes back to the start of the line, so the counter updates in place
            print(f"\r  step {step}/{STEPS}", end="", flush=True)
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Interrupted with Ctrl+C at step {step}.{RESET}")
        return 130
    print(f"\n{GREEN}Done.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
