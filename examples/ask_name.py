"""Test script for the embedded terminal.

Covers the things a real script needs: interactive prompts, colored output
and a chosen exit code. Uses only the standard library.
"""

import shutil
import sys

GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
BOLD = "\033[1m"
RESET = "\033[0m"


def print_terminal_size() -> None:
    size = shutil.get_terminal_size()
    print(f"{CYAN}terminal size: {size.columns}x{size.lines}{RESET}")


def main() -> int:
    # True when running inside a real terminal (PTY), False when piped
    print(f"{CYAN}stdin is a terminal: {sys.stdin.isatty()}{RESET}")
    print_terminal_size()

    name = input("What is your name? ").strip() or "stranger"
    print(f"{BOLD}{GREEN}Hello, {name}!{RESET}")
    # Printed again so resizing the window during the prompt shows the new size
    print_terminal_size()

    answer = input("Exit code to return (empty for 0): ").strip()
    try:
        exit_code = int(answer) if answer else 0
    except ValueError:
        print(f"{YELLOW}'{answer}' is not a number, using 1.{RESET}")
        exit_code = 1

    print(f"Exiting with code {exit_code}.")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
