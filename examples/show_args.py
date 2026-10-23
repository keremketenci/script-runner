"""Prints what the script received, to check the run settings of Script Runner."""

import os
import sys

CYAN = "\033[36m"
RESET = "\033[0m"

print(f"{CYAN}Interpreter:{RESET}    {sys.executable}")
print(f"{CYAN}Working folder:{RESET} {os.getcwd()}")
print(f"{CYAN}Arguments ({len(sys.argv) - 1}):{RESET}")
for index, argument in enumerate(sys.argv[1:], start=1):
    # repr() shows spaces and empty strings clearly, e.g. 'my file.txt' or ''
    print(f"  {index}. {argument!r}")
