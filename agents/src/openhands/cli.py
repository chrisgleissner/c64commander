from __future__ import annotations

import argparse
import sys

from .config import DEFAULT_MAX_ITERATIONS, ensure_runtime_directories
from .providers import load_selection, login_selected_provider
from .run_loop import run_loop


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agent", description="C64 Commander autonomous OpenHands loop")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("login", help="Authenticate and validate a provider")
    subparsers.add_parser("run", help="Run or resume the autonomous loop")
    return parser


def main(argv: list[str] | None = None) -> int:
    ensure_runtime_directories()
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "login":
        selection = login_selected_provider()
        print(f"Validated {selection.label}. Metadata saved to the local agent config.", flush=True)
        return 0

    if args.command == "run":
        selection = load_selection()
        if selection is None:
            print("No provider is configured. Run `agent login` first.", file=sys.stderr)
            return 1
        run_loop(selection, max_iterations=DEFAULT_MAX_ITERATIONS)
        return 0

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
