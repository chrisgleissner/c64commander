#!/usr/bin/env python3
"""
C64 Commander - C64U telnet context menu exporter
"""

from __future__ import annotations

import argparse
import ftplib
import importlib.util
import io
import re
import select
import socket
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

import yaml

HELPER_MODULE_PATH = Path(__file__).with_name("dump_c64u_config.py")
HELPER_SPEC = importlib.util.spec_from_file_location("dump_c64u_config", HELPER_MODULE_PATH)
if HELPER_SPEC is None or HELPER_SPEC.loader is None:
    raise RuntimeError(f"Unable to load helper module from {HELPER_MODULE_PATH}")
HELPER_MODULE = importlib.util.module_from_spec(HELPER_SPEC)
HELPER_SPEC.loader.exec_module(HELPER_MODULE)

_IndentedDumper = HELPER_MODULE._IndentedDumper
_convert_single_quoted_scalars = HELPER_MODULE._convert_single_quoted_scalars
_fetch_json = HELPER_MODULE._fetch_json
infer_device_family = HELPER_MODULE.infer_device_family
_indent_sequences = HELPER_MODULE._indent_sequences
_quote_mapping_values_with_spaces = HELPER_MODULE._quote_mapping_values_with_spaces

SCREEN_WIDTH = 60
SCREEN_HEIGHT = 24
TELNET_PORT = 23
FTP_PORT = 21
DEFAULT_PRIMARY_OUTPUT = "docs/c64/c64u-telnet.yaml"

ACS_MAP = {
    "j": "┘",
    "k": "┐",
    "l": "┌",
    "m": "└",
    "n": "┼",
    "q": "─",
    "t": "├",
    "u": "┤",
    "v": "┴",
    "w": "┬",
    "x": "│",
}

BOX_CHARS = {"┌", "┐", "└", "┘", "─", "│", "├", "┤", "┬", "┴", "┼"}

KEYS = {
    "DOWN": b"\x1b[B",
    "ENTER": b"\r",
    "ESC": b"\x1b",
    "F1": b"\x1b[11~",
    "F5": b"\x1b[15~",
    "F6": b"\x1b[17~",
    "F7": b"\x1b[18~",
    "LEFT": b"\x1b[D",
    "RIGHT": b"\x1b[C",
    "UP": b"\x1b[A",
}

FAST_SETTLE = 0.1
MENU_OPEN_SETTLE = 0.6
MODAL_OPEN_SETTLE = 1.0
ACTION_MENU_SETTLE = 0.6
QUIET_WINDOW = 0.02
MENU_PREPARE_SETTLE = 0.8
MIN_MENU_BOX_WIDTH = 4
MIN_MENU_BOX_HEIGHT = 3
SUBMENU_CAPTURE_ATTEMPTS = 3

@dataclass(frozen=True)
class Cell:
    char: str = " "
    reverse: bool = False


@dataclass(frozen=True)
class Box:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left + 1

    @property
    def height(self) -> int:
        return self.bottom - self.top + 1

    @property
    def area(self) -> int:
        return self.width * self.height


def is_menu_sized_box(box: Box) -> bool:
    return box.width >= MIN_MENU_BOX_WIDTH and box.height >= MIN_MENU_BOX_HEIGHT


def same_box(left: Box, right: Box) -> bool:
    return (
        left.left == right.left
        and left.top == right.top
        and left.right == right.right
        and left.bottom == right.bottom
    )


def box_contains(parent: Box, child: Box) -> bool:
    return (
        parent.left < child.left
        and parent.top < child.top
        and parent.right > child.right
        and parent.bottom > child.bottom
    )


def log(message: str) -> None:
    print(f"[dump-c64-telnet-screens] {message}", flush=True)


def format_screen_dump(screen: TerminalScreen, label: str) -> str:
    header = f"=== {label} ==="
    lines = screen.render_lines()
    return "\n".join([header, *lines, "=" * len(header)])


class TerminalScreen:
    def __init__(self, width: int = SCREEN_WIDTH, height: int = SCREEN_HEIGHT) -> None:
        self.width = width
        self.height = height
        self.reset()

    def reset(self) -> None:
        self.cells = [[Cell() for _ in range(self.width)] for _ in range(self.height)]
        self.row = 0
        self.col = 0
        self.reverse = False
        self.acs = False

    def _write(self, char: str) -> None:
        display = ACS_MAP.get(char, char) if self.acs else char
        if 0 <= self.row < self.height and 0 <= self.col < self.width:
            self.cells[self.row][self.col] = Cell(display, self.reverse)
        if self.col < self.width - 1:
            self.col += 1

    def _handle_sgr(self, params: str) -> None:
        parts = [part for part in params.split(";") if part != ""]
        if not parts:
            self.reverse = False
            return
        for part in parts:
            if part == "0":
                self.reverse = False
            elif part == "7":
                self.reverse = True
            elif part == "27":
                self.reverse = False

    def feed(self, data: bytes) -> None:
        index = 0
        state = "normal"
        csi = ""
        while index < len(data):
            value = data[index]
            char = chr(value)

            if state == "normal":
                if value == 0xFF:
                    if index + 1 >= len(data):
                        break
                    command = data[index + 1]
                    if command in {0xFB, 0xFC, 0xFD, 0xFE}:
                        index += 3
                        continue
                    if command == 0xFA:
                        index += 2
                        while index + 1 < len(data):
                            if data[index] == 0xFF and data[index + 1] == 0xF0:
                                index += 2
                                break
                            index += 1
                        continue
                    index += 2
                    continue
                if value == 0x1B:
                    state = "escape"
                elif value == 0x0D:
                    self.col = 0
                elif value == 0x0A:
                    if self.row < self.height - 1:
                        self.row += 1
                elif 0x20 <= value <= 0x7E:
                    self._write(char)
            elif state == "escape":
                if char == "[":
                    state = "csi"
                    csi = ""
                elif char == "(":
                    state = "charset"
                elif char == "c":
                    self.reset()
                    state = "normal"
                else:
                    state = "normal"
            elif state == "charset":
                if char == "0":
                    self.acs = True
                elif char == "B":
                    self.acs = False
                state = "normal"
            elif state == "csi":
                csi += char
                if 0x40 <= value <= 0x7E:
                    params = csi[:-1]
                    final = csi[-1]
                    if final in {"H", "f"}:
                        parts = [part for part in params.split(";") if part != ""]
                        row = int(parts[0]) if len(parts) >= 1 else 1
                        col = int(parts[1]) if len(parts) >= 2 else 1
                        self.row = max(0, min(self.height - 1, row - 1))
                        self.col = max(0, min(self.width - 1, col - 1))
                    elif final == "J" and params in {"", "2"}:
                        self.reset()
                    elif final == "m":
                        self._handle_sgr(params)
                    state = "normal"

            index += 1

    def row_text(self, row: int) -> str:
        return "".join(cell.char for cell in self.cells[row]).rstrip()

    def reverse_count(self, row: int, left: int, right: int) -> int:
        return sum(1 for cell in self.cells[row][left:right] if cell.reverse)

    def render_lines(self) -> list[str]:
        return [self.row_text(row) for row in range(self.height)]


class TelnetSession:
    def __init__(
        self,
        host: str,
        password: Optional[str],
        connect_timeout: float,
        read_timeout: float,
        telnet_port: int = TELNET_PORT,
        debug_screens: bool = False,
        debug_prefix: str = "telnet",
    ) -> None:
        self.host = host
        self.password = password
        self.connect_timeout = connect_timeout
        self.read_timeout = read_timeout
        self.telnet_port = telnet_port
        self.debug_screens = debug_screens
        self.debug_prefix = debug_prefix
        self.screen_counter = 0
        self.screen = TerminalScreen()
        self.socket = socket.create_connection((host, self.telnet_port), timeout=connect_timeout)
        self.socket.settimeout(read_timeout)
        self._authenticate_if_needed()
        self.wait_for_quiet(initial_timeout=0.20, quiet_window=QUIET_WINDOW)
        self.emit_screen("initial")

    def emit_screen(self, reason: str) -> None:
        if not self.debug_screens:
            return
        self.screen_counter += 1
        label = f"{self.debug_prefix} screen {self.screen_counter}: {reason}"
        print(format_screen_dump(self.screen, label), flush=True)

    def _authenticate_if_needed(self) -> None:
        deadline = time.time() + max(1.0, self.read_timeout)
        received = bytearray()
        while time.time() < deadline:
            try:
                chunk = self.socket.recv(65535)
            except socket.timeout:
                break
            if not chunk:
                break
            received.extend(chunk)
            if b"Password:" in received:
                if self.password is None:
                    raise RuntimeError("Telnet password prompt received but no password was supplied")
                self.socket.sendall(self.password.encode("utf-8") + b"\r")
                received.clear()
                break
        if received:
            self.screen.feed(bytes(received))

    def wait_for_quiet(self, initial_timeout: float = 0.08, quiet_window: float = QUIET_WINDOW) -> None:
        deadline = time.monotonic() + initial_timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            ready, _, _ = select.select([self.socket], [], [], remaining)
            if not ready:
                break
            chunk = self.socket.recv(65535)
            if not chunk:
                break
            self.screen.feed(chunk)
            deadline = time.monotonic() + quiet_window

    def send_key(self, key: str, settle: float = MENU_OPEN_SETTLE, quiet_window: float = QUIET_WINDOW) -> None:
        self.socket.sendall(KEYS[key])
        self.wait_for_quiet(initial_timeout=settle, quiet_window=quiet_window)
        self.emit_screen(f"after {key}")

    def close(self) -> None:
        try:
            self.socket.close()
        except OSError:
            pass

    def __enter__(self) -> "TelnetSession":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


def make_screen(lines: Iterable[str], reverse_rows: Optional[dict[int, tuple[int, int]]] = None) -> TerminalScreen:
    screen = TerminalScreen()
    for row, source in enumerate(lines):
        if row >= screen.height:
            break
        padded = source.ljust(screen.width)
        reverse_range = (None, None)
        if reverse_rows and row in reverse_rows:
            reverse_range = reverse_rows[row]
        for col, char in enumerate(padded[: screen.width]):
            reverse = False
            if reverse_range[0] is not None and reverse_range[1] is not None:
                reverse = reverse_range[0] <= col < reverse_range[1]
            screen.cells[row][col] = Cell(char, reverse)
    return screen


def find_boxes(screen: TerminalScreen) -> list[Box]:
    boxes: list[Box] = []
    seen: set[tuple[int, int, int, int]] = set()
    for top in range(screen.height):
        for left in range(screen.width):
            if screen.cells[top][left].char != "┌":
                continue
            for right in range(left + 2, screen.width):
                if screen.cells[top][right].char != "┐":
                    continue
                if any(screen.cells[top][column].char != "─" for column in range(left + 1, right)):
                    continue
                for bottom in range(top + 2, screen.height):
                    if screen.cells[bottom][left].char != "└" or screen.cells[bottom][right].char != "┘":
                        continue
                    if any(screen.cells[bottom][column].char != "─" for column in range(left + 1, right)):
                        continue
                    if any(screen.cells[row][left].char not in BOX_CHARS for row in range(top + 1, bottom)):
                        continue
                    if any(screen.cells[row][right].char not in BOX_CHARS for row in range(top + 1, bottom)):
                        continue
                    key = (left, top, right, bottom)
                    box = Box(left, top, right, bottom)
                    if key not in seen and is_menu_sized_box(box):
                        seen.add(key)
                        boxes.append(box)
                    break
    return boxes


def find_box_clusters(screen: TerminalScreen) -> list[Box]:
    visited: set[tuple[int, int]] = set()
    clusters: list[Box] = []

    for top in range(screen.height):
        for left in range(screen.width):
            if (left, top) in visited:
                continue
            if screen.cells[top][left].char not in BOX_CHARS:
                continue

            stack = [(left, top)]
            points: list[tuple[int, int]] = []
            min_x = max_x = left
            min_y = max_y = top

            while stack:
                x, y = stack.pop()
                if (x, y) in visited:
                    continue
                if not (0 <= x < screen.width and 0 <= y < screen.height):
                    continue
                if screen.cells[y][x].char not in BOX_CHARS:
                    continue
                visited.add((x, y))
                points.append((x, y))
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                for delta_x in (-1, 0, 1):
                    for delta_y in (-1, 0, 1):
                        if delta_x == 0 and delta_y == 0:
                            continue
                        stack.append((x + delta_x, y + delta_y))

            if points:
                clusters.append(Box(min_x, min_y, max_x, max_y))

    return clusters


def find_right_overlay_boxes(screen: TerminalScreen) -> list[Box]:
    overlays: list[Box] = []
    start_row: Optional[int] = None
    end_row = -1
    active_columns: list[int] = []

    def flush() -> None:
        nonlocal start_row, end_row, active_columns
        if start_row is None or end_row - start_row < 2 or not active_columns:
            start_row = None
            end_row = -1
            active_columns = []
            return
        left = min(active_columns)
        right = max(active_columns)
        box = Box(left, start_row, right, end_row)
        if is_menu_sized_box(box):
            overlays.append(box)
        start_row = None
        end_row = -1
        active_columns = []

    for row in range(screen.height):
        positions = [
            column
            for column, cell in enumerate(screen.cells[row])
            if column >= screen.width // 2 and cell.char in BOX_CHARS
        ]
        if len(positions) >= 2:
            if start_row is None:
                start_row = row
            end_row = row
            active_columns.extend(positions)
        else:
            flush()

    flush()
    return overlays


def candidate_boxes(screen: TerminalScreen) -> list[Box]:
    exact = find_boxes(screen)
    if exact:
        return exact
    overlays = [box for box in find_right_overlay_boxes(screen) if is_menu_sized_box(box)]
    if overlays:
        return overlays
    return [box for box in find_box_clusters(screen) if is_menu_sized_box(box)]


def choose_modal_box(screen: TerminalScreen) -> Box:
    boxes = [box for box in candidate_boxes(screen) if is_menu_sized_box(box) and not (box.width >= 58 and box.height >= 20)]
    if not boxes:
        raise RuntimeError("No modal box found on telnet screen")
    return max(boxes, key=lambda box: (box.area, box.width, box.height))


def choose_menu_box(screen: TerminalScreen) -> Box:
    boxes = [box for box in candidate_boxes(screen) if is_menu_sized_box(box) and not (box.width >= 58 and box.height >= 20)]
    if not boxes:
        raise RuntimeError("No menu box found on telnet screen")
    return min(boxes, key=lambda box: (box.area, box.left, box.top))


def visible_menu_boxes(screen: TerminalScreen) -> list[Box]:
    boxes = [box for box in candidate_boxes(screen) if is_menu_sized_box(box) and not (box.width >= 58 and box.height >= 20)]
    return sorted(boxes, key=lambda box: (box.left, box.top, box.area))


def wait_for_menu_box(session: TelnetSession, retry_delays: tuple[float, ...] = (0.0, 0.05, 0.10, 0.20, 0.35)) -> Box:
    last_error: Optional[RuntimeError] = None
    for delay in retry_delays:
        if delay > 0:
            session.wait_for_quiet(initial_timeout=delay, quiet_window=QUIET_WINDOW)
        try:
            return choose_menu_box(session.screen)
        except RuntimeError as exc:
            last_error = exc
    if last_error is None:
        raise RuntimeError("No menu box found on telnet screen")
    raise last_error


def wait_for_modal_box(session: TelnetSession, retry_delays: tuple[float, ...] = (0.0, 0.08, 0.16, 0.28, 0.40)) -> Box:
    last_error: Optional[RuntimeError] = None
    for delay in retry_delays:
        if delay > 0:
            session.wait_for_quiet(initial_timeout=delay, quiet_window=QUIET_WINDOW)
        try:
            return choose_modal_box(session.screen)
        except RuntimeError as exc:
            last_error = exc
    if last_error is None:
        raise RuntimeError("No modal box found on telnet screen")
    raise last_error


def open_action_menu(
    session: TelnetSession,
    action_key: str,
    *,
    pre_wait: float = MENU_PREPARE_SETTLE,
    settle_delays: tuple[float, ...] = (ACTION_MENU_SETTLE, 0.9, 1.2),
) -> Box:
    session.wait_for_quiet(initial_timeout=pre_wait, quiet_window=QUIET_WINDOW)
    last_error: Optional[RuntimeError] = None
    for settle in settle_delays:
        session.send_key(action_key, settle=settle)
        try:
            return wait_for_menu_box(session, retry_delays=(0.0, 0.08, 0.16, 0.32, 0.64, 1.0))
        except RuntimeError as exc:
            last_error = exc
            session.wait_for_quiet(initial_timeout=0.35, quiet_window=QUIET_WINDOW)
    if last_error is None:
        raise RuntimeError(f"Unable to open action menu with {action_key}")
    raise last_error


def clean_menu_item(raw_text: str) -> str:
    text = raw_text.strip()
    if not text:
        return ""
    if text.count("│") >= 2:
        first = text.find("│")
        last = text.rfind("│")
        if last > first:
            inner = text[first + 1 : last].strip()
            if inner:
                return inner
    text = text.strip("│┌┐└┘─├┤┬┴┼ ")
    if len(text) <= 2 and text.isupper():
        return ""
    return text


def normalize_overlay_menu_item(text: str) -> str:
    last_separator = max(text.rfind(char) for char in "│┌┐└┘─├┤┬┴┼")
    if last_separator >= 0:
        normalized = text[last_separator + 1 :].strip()
        if normalized:
            return normalized
    return text


def extract_menu_items(screen: TerminalScreen, box: Box) -> dict[str, Any]:
    items: list[str] = []
    selected_index: Optional[int] = None
    selected_text: Optional[str] = None
    best_reverse = -1
    for row in range(box.top + 1, box.bottom):
        raw_text = "".join(cell.char for cell in screen.cells[row][box.left + 1 : box.right])
        text = clean_menu_item(raw_text)
        if not text:
            continue
        if set(text) <= {"─", "│", "┌", "┐", "└", "┘"}:
            continue
        items.append(text)
        reverse = screen.reverse_count(row, box.left + 1, box.right)
        if reverse > best_reverse:
            best_reverse = reverse
            selected_index = len(items) - 1
            selected_text = text
    return {
        "items": items,
        "selected_index": selected_index,
        "selected_item": selected_text,
    }


def re_escape(value: str) -> str:
    return re.escape(value)


def split_path(path: str) -> list[str]:
    return [part for part in path.split("/") if part]


def parent_path(path: str) -> str:
    parts = split_path(path)
    if len(parts) <= 1:
        return "/"
    return "/" + "/".join(parts[:-1])


def basename(path: str) -> str:
    parts = split_path(path)
    if not parts:
        return "/"
    return parts[-1]


def fetch_device_metadata(base_url: str, headers: dict[str, str], timeout: float, retries: int, retry_delay: float) -> dict[str, Any]:
    info = _fetch_json(f"{base_url}/v1/info", headers, timeout, retries, retry_delay)
    version = _fetch_json(f"{base_url}/v1/version", headers, timeout, retries, retry_delay)
    return {
        "device_type": info.get("product"),
        "firmware_version": info.get("firmware_version"),
        "hostname": info.get("hostname"),
        "rest_api_version": version.get("version"),
    }


def open_ftp(host: str, password: Optional[str], timeout: float, ftp_port: int = FTP_PORT) -> ftplib.FTP:
    ftp = ftplib.FTP()
    ftp.connect(host, ftp_port, timeout=timeout)
    ftp.login(passwd=password or "")
    return ftp


def ftp_entries(ftp: ftplib.FTP, path: str) -> list[str]:
    ftp.cwd(path)
    return ftp.nlst()


def resolve_test_data_path(ftp: ftplib.FTP, candidates: list[str]) -> str:
    for candidate in candidates:
        try:
            ftp.cwd(candidate)
            return candidate
        except ftplib.all_errors:
            continue
    raise RuntimeError(f"Unable to resolve any test-data path from candidates: {candidates}")


def build_file_type_menu_definitions(menu_payloads: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    menu_definitions: dict[str, dict[str, Any]] = {}
    for payload in menu_payloads:
        menu_definitions[payload["label"]] = {
            "representative_file": payload["path"],
            "items": payload["menu_items"],
            "default_item": payload["default_item"],
        }
    return dict(sorted(menu_definitions.items(), key=lambda item: item[0]))


def build_menu_tree_node(menu: dict[str, Any], submenus: Optional[dict[str, dict[str, Any]]] = None) -> dict[str, Any]:
    node = {
        "items": menu["items"],
        "default_item": menu["selected_item"],
    }
    if submenus:
        node["submenus"] = submenus
    return node


def representative_files(ftp: ftplib.FTP, root_path: str) -> list[dict[str, str]]:
    wanted = [
        ("crt", ".crt"),
        ("d64", ".d64"),
        ("d71", ".d71"),
        ("d81", ".d81"),
        ("mod", ".mod"),
        ("prg", ".prg"),
        ("reu", ".reu"),
        ("sid", ".sid"),
        ("archive_7z", ".7z"),
    ]
    results: list[dict[str, str]] = []
    for entry_name, extension in wanted:
        directory = root_path if entry_name == "archive_7z" else f"{root_path}/{entry_name.upper() if entry_name == 'sid' else entry_name}"
        if entry_name == "archive_7z":
            directory = f"{root_path}/SID"
        elif entry_name == "reu":
            directory = f"{root_path}/snapshots"
        items = ftp_entries(ftp, directory)
        for item in items:
            if item.lower().endswith(extension):
                results.append(
                    {
                        "label": entry_name,
                        "directory": directory,
                        "path": f"{directory}/{item}",
                        "name": item,
                    }
                )
                break
        else:
            raise RuntimeError(f"No representative file with extension {extension} found under {directory}")
    return results


def ensure_remote_directory(ftp: ftplib.FTP, path: str) -> bool:
    try:
        ftp.cwd(path)
        return False
    except ftplib.all_errors:
        ftp.mkd(path)
        ftp.cwd(path)
        return True


def ensure_reu_probe_fixture(ftp: ftplib.FTP, root_path: str) -> Optional[dict[str, Any]]:
    reu_directory = f"{root_path}/snapshots"
    created_directory = ensure_remote_directory(ftp, reu_directory)
    existing_items = ftp.nlst()
    if any(item.lower().endswith(".reu") for item in existing_items):
        return None

    probe_name = "menu_probe.reu"
    log(f"Creating temporary REU probe fixture at {reu_directory}/{probe_name}")
    ftp.storbinary(f"STOR {probe_name}", io.BytesIO(b"\x00"))
    return {
        "directory": reu_directory,
        "name": probe_name,
        "created_directory": created_directory,
    }


def cleanup_reu_probe_fixture(ftp: ftplib.FTP, fixture: Optional[dict[str, Any]]) -> None:
    if fixture is None:
        return
    directory = str(fixture["directory"])
    name = str(fixture["name"])
    created_directory = bool(fixture["created_directory"])
    try:
        ftp.cwd(directory)
        ftp.delete(name)
    except ftplib.all_errors as exc:
        raise RuntimeError(f"Failed to remove temporary REU probe fixture {directory}/{name}") from exc

    if created_directory:
        try:
            remaining = ftp.nlst()
        except ftplib.all_errors:
            remaining = []
        if not remaining:
            try:
                ftp.cwd("/")
                ftp.rmd(directory)
            except ftplib.all_errors as exc:
                raise RuntimeError(f"Failed to remove temporary REU probe directory {directory}") from exc


def enter_directory(session: TelnetSession, ftp: ftplib.FTP, path: str) -> None:
    current_path = "/"
    for part in split_path(path):
        entries = ftp_entries(ftp, current_path)
        try:
            target_index = entries.index(part)
        except ValueError as exc:
            raise RuntimeError(f"Unable to locate {part} while navigating to {path}") from exc
        log(f"Navigating to {part} inside {current_path}")
        for _ in range(target_index):
            session.send_key("DOWN", settle=FAST_SETTLE)
        if current_path == "/":
            session.send_key("RIGHT", settle=1.0)
            session.wait_for_quiet(initial_timeout=1.0, quiet_window=0.05)
        else:
            session.send_key("ENTER", settle=MENU_OPEN_SETTLE)
            wait_for_menu_box(session)
            session.wait_for_quiet(initial_timeout=0.3, quiet_window=QUIET_WINDOW)
            session.send_key("ENTER", settle=1.0)
            session.wait_for_quiet(initial_timeout=1.0, quiet_window=0.05)
        current_path = f"{current_path.rstrip('/')}/{part}" if current_path != "/" else f"/{part}"


def open_context_menu(session: TelnetSession, ftp: ftplib.FTP, parent: str, name: str) -> dict[str, Any]:
    if parent != "/":
        enter_directory(session, ftp, parent)
    entries = ftp_entries(ftp, parent)
    try:
        target_index = entries.index(name)
    except ValueError as exc:
        raise RuntimeError(f"Unable to locate {name} inside {parent}") from exc
    log(f"Opening context menu for {parent.rstrip('/')}/{name}".rstrip("/"))
    for _ in range(target_index):
        session.send_key("DOWN", settle=FAST_SETTLE)
    session.send_key("ENTER", settle=MENU_OPEN_SETTLE)
    box = wait_for_menu_box(session)
    menu = extract_menu_items(session.screen, box)
    return {
        "browser_path": parent if parent.endswith("/") or parent == "/" else f"{parent}/",
        "selected_entry": name,
        "menu_items": menu["items"],
        "default_item": menu["selected_item"],
    }


def move_menu_selection(session: TelnetSession, current_index: int, target_index: int) -> int:
    if target_index < current_index:
        for _ in range(current_index - target_index):
            session.send_key("UP", settle=FAST_SETTLE)
    elif target_index > current_index:
        for _ in range(target_index - current_index):
            session.send_key("DOWN", settle=FAST_SETTLE)
    return target_index


def extract_deepest_menu(screen: TerminalScreen) -> tuple[Box, dict[str, Any]]:
    boxes = visible_menu_boxes(screen)
    if not boxes:
        raise RuntimeError("No visible menu boxes found on telnet screen")
    box = max(boxes, key=lambda candidate: (candidate.left, candidate.top, candidate.area))
    return box, extract_menu_items(screen, box)


def select_browser_entry(session: TelnetSession, ftp: ftplib.FTP, parent: str, name: str) -> None:
    if parent != "/":
        enter_directory(session, ftp, parent)
    entries = ftp_entries(ftp, parent)
    try:
        target_index = entries.index(name)
    except ValueError as exc:
        raise RuntimeError(f"Unable to locate {name} inside {parent}") from exc
    for _ in range(target_index):
        session.send_key("DOWN", settle=FAST_SETTLE)
    session.wait_for_quiet(initial_timeout=MENU_PREPARE_SETTLE, quiet_window=QUIET_WINDOW)


def find_child_menu_box(screen: TerminalScreen, parent_box: Box) -> Optional[Box]:
    child_boxes = [box for box in visible_menu_boxes(screen) if box_contains(parent_box, box)]
    if not child_boxes:
        return None
    return max(child_boxes, key=lambda box: (box.left, box.top, box.area))


def extract_box_lines(screen: TerminalScreen, box: Box) -> list[str]:
    lines: list[str] = []
    for row in range(box.top + 1, box.bottom):
        raw = "".join(cell.char for cell in screen.cells[row][box.left + 1 : box.right]).rstrip()
        text = raw.strip()
        if text:
            lines.append(text)
    return lines


def describe_direct_entry_screen(screen: TerminalScreen) -> Optional[dict[str, Any]]:
    boxes = visible_menu_boxes(screen)
    if not boxes:
        return None
    box = max(boxes, key=lambda candidate: (candidate.area, candidate.width, candidate.height))
    lines = extract_box_lines(screen, box)
    if not lines:
        return None
    title = lines[0]
    if "Query Form" not in title and not any(":" in line for line in lines[1:]):
        return None
    return {
        "kind": "direct_entry",
        "title": title,
    }


def extract_overlay_menu_items(screen: TerminalScreen, parent_box: Box) -> Optional[dict[str, Any]]:
    items: list[str] = []
    for row in range(parent_box.top + 1, parent_box.bottom):
        raw = "".join(cell.char for cell in screen.cells[row][parent_box.left + 1 : parent_box.right])
        if "│" not in raw:
            continue
        parts = raw.split("│")
        if len(parts) < 2:
            continue
        candidate = normalize_overlay_menu_item(clean_menu_item(parts[-2]))
        if not candidate:
            continue
        if candidate not in items:
            items.append(candidate)
    if not items:
        return None
    return {
        "items": items,
        "selected_index": 0,
        "selected_item": items[0],
    }


def collect_dropdown_options_from_windows(
    windows: Iterable[list[str]],
    stable_threshold: int = 8,
) -> list[str]:
    options: list[str] = []
    previous_window: Optional[tuple[str, ...]] = None
    has_scrolled = False
    stable_windows = 0

    for window in windows:
        for item in window:
            if item not in options:
                options.append(item)
        current_window = tuple(window)
        if previous_window == current_window:
            stable_windows += 1
        else:
            if previous_window is not None:
                has_scrolled = True
            stable_windows = 0
        previous_window = current_window
        if has_scrolled and stable_windows >= stable_threshold:
            break

    return options


def collect_static_dropdown_options(session: TelnetSession, max_steps: int = 32) -> list[str]:
    options: list[str] = []
    repeated_selected = 0
    previous_selected: Optional[str] = None

    for _ in range(max_steps):
        menu_box = wait_for_menu_box(session)
        menu = extract_menu_items(session.screen, menu_box)
        for item in menu["items"]:
            if item not in options:
                options.append(item)
        current_selected = menu["selected_item"]
        if not menu["items"] or current_selected is None:
            break
        if current_selected == previous_selected:
            repeated_selected += 1
        else:
            repeated_selected = 0
        if repeated_selected >= 8 or current_selected == menu["items"][-1]:
            break
        previous_selected = current_selected
        session.send_key("DOWN", settle=FAST_SETTLE)

    return options


def capture_followup_menu_node(session: TelnetSession, parent_box: Box) -> Optional[dict[str, Any]]:
    session.send_key("RIGHT", settle=MENU_OPEN_SETTLE)
    child_box = find_child_menu_box(session.screen, parent_box)
    if child_box is not None:
        return build_menu_tree_node(extract_menu_items(session.screen, child_box))
    overlay_menu = extract_overlay_menu_items(session.screen, parent_box)
    if overlay_menu is not None:
        return build_menu_tree_node(overlay_menu)
    return describe_direct_entry_screen(session.screen)


def capture_initial_context_menus(
    host: str,
    password: Optional[str],
    connect_timeout: float,
    read_timeout: float,
    telnet_port: int = TELNET_PORT,
    action_keys: Optional[list[str]] = None,
) -> dict[str, Any]:
    for action_key in (action_keys or ["F1", "F5"]):
        log(f"Capturing initial action menu via {action_key}")
        try:
            with TelnetSession(
                host,
                password,
                connect_timeout,
                read_timeout,
                telnet_port=telnet_port,
                debug_screens=args_debug_screens,
                debug_prefix=f"initial-context-{action_key.lower()}",
            ) as session:
                root_box = open_action_menu(session, action_key)
                root_menu = extract_menu_items(session.screen, root_box)
        except RuntimeError:
            continue

        submenu_nodes: dict[str, dict[str, Any]] = {}
        for target_index, item in enumerate(root_menu["items"]):
            captured_node: Optional[dict[str, Any]] = None
            last_error: Optional[RuntimeError] = None
            for attempt in range(1, SUBMENU_CAPTURE_ATTEMPTS + 1):
                try:
                    with TelnetSession(
                        host,
                        password,
                        connect_timeout,
                        read_timeout,
                        telnet_port=telnet_port,
                        debug_screens=args_debug_screens,
                        debug_prefix=f"initial-context-{action_key.lower()}-{target_index}-attempt-{attempt}",
                    ) as session:
                        root_box = open_action_menu(session, action_key)
                        current_menu = extract_menu_items(session.screen, root_box)
                        current_index = current_menu["selected_index"] or 0
                        move_menu_selection(session, current_index, target_index)
                        parent_box = wait_for_menu_box(session)
                        node = capture_followup_menu_node(session, parent_box)
                        if node is not None:
                            captured_node = node
                            break
                except RuntimeError as exc:
                    last_error = exc
            if captured_node is not None:
                submenu_nodes[item] = captured_node
            elif last_error is not None:
                log(f"Skipping submenu capture for {item!r} via {action_key}: {last_error}")
        return {
            "opened_with": action_key,
            "screen_context": "initial telnet screen with no selected filesystem entry",
            "action_menu": build_menu_tree_node(root_menu, submenu_nodes or None),
        }
    raise RuntimeError("Unable to open initial telnet action menu with F1 or F5")


def capture_selected_directory_action_menus(
    host: str,
    password: Optional[str],
    connect_timeout: float,
    read_timeout: float,
    ftp: ftplib.FTP,
    path: str,
    telnet_port: int = TELNET_PORT,
    action_keys: Optional[list[str]] = None,
) -> dict[str, Any]:
    parent = parent_path(path)
    name = basename(path)
    for action_key in (action_keys or ["F1", "F5"]):
        log(f"Capturing selected-directory action menu via {action_key} for {path}")
        try:
            with TelnetSession(
                host,
                password,
                connect_timeout,
                read_timeout,
                telnet_port=telnet_port,
                debug_screens=args_debug_screens,
                debug_prefix=f"selected-directory-action-{action_key.lower()}",
            ) as session:
                select_browser_entry(session, ftp, parent, name)
                root_box = open_action_menu(session, action_key)
                root_menu = extract_menu_items(session.screen, root_box)
        except RuntimeError:
            continue

        submenu_nodes: dict[str, dict[str, Any]] = {}
        for target_index, item in enumerate(root_menu["items"]):
            captured_node: Optional[dict[str, Any]] = None
            last_error: Optional[RuntimeError] = None
            for attempt in range(1, SUBMENU_CAPTURE_ATTEMPTS + 1):
                try:
                    with TelnetSession(
                        host,
                        password,
                        connect_timeout,
                        read_timeout,
                        telnet_port=telnet_port,
                        debug_screens=args_debug_screens,
                        debug_prefix=f"selected-directory-action-{action_key.lower()}-{target_index}-attempt-{attempt}",
                    ) as session:
                        select_browser_entry(session, ftp, parent, name)
                        root_box = open_action_menu(session, action_key)
                        current_menu = extract_menu_items(session.screen, root_box)
                        current_index = current_menu["selected_index"] or 0
                        move_menu_selection(session, current_index, target_index)
                        parent_box = wait_for_menu_box(session)
                        node = capture_followup_menu_node(session, parent_box)
                        if node is not None:
                            captured_node = node
                            break
                except RuntimeError as exc:
                    last_error = exc
            if captured_node is not None:
                submenu_nodes[item] = captured_node
            elif last_error is not None:
                log(f"Skipping selected-directory submenu capture for {item!r} via {action_key}: {last_error}")
        return {
            "path": path,
            "browser_path": parent if parent.endswith("/") or parent == "/" else f"{parent}/",
            "selected_entry": name,
            "opened_with": action_key,
            "screen_context": "filesystem browser with a directory selected and the action menu opened via function key",
            "action_menu": build_menu_tree_node(root_menu, submenu_nodes or None),
        }
    raise RuntimeError(f"Unable to open selected-directory action menu with F1 or F5 for {path}")


def resolve_output_paths(
    output: Path,
    mirror_output: Optional[str],
    firmware_version: str,
    device_family: str = "c64u",
) -> list[Path]:
    output_text = output.as_posix()
    should_write_primary = device_family == "c64u" or not output_text.endswith(DEFAULT_PRIMARY_OUTPUT)
    outputs = [output] if should_write_primary else []
    if mirror_output:
        outputs.append(
            Path(
                mirror_output.format(
                    firmware_version=firmware_version,
                    device_family=device_family,
                )
            )
        )
    return outputs


def dump_yaml(document: dict[str, Any]) -> str:
    yaml_text = yaml.dump(
        document,
        Dumper=_IndentedDumper,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
        indent=2,
        width=float("inf"),
    )
    return _quote_mapping_values_with_spaces(
        _convert_single_quoted_scalars(_indent_sequences(yaml_text))
    )


def build_telnet_document(
    *,
    base_url: str,
    host: str,
    metadata: dict[str, Any],
    requested_test_data_paths: list[str],
    resolved_test_data_path: str,
    initial_action_menus: dict[str, Any],
    selected_directory_action_menus: dict[str, Any],
    directory_menu_capture: dict[str, Any],
    menu_definitions: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    initial_action_menus = {
        "screen_context": "initial telnet screen with no selected filesystem entry",
        **initial_action_menus,
    }
    selected_directory_action_menus = {
        "screen_context": "filesystem browser with a directory selected and the action menu opened via function key",
        **selected_directory_action_menus,
    }
    return {
        "telnet": {
            "general": {
                "base_url": base_url,
                "host": host,
                "device_type": metadata["device_type"],
                "firmware_version": metadata["firmware_version"],
                "rest_api_version": metadata["rest_api_version"],
                "requested_test_data_paths": requested_test_data_paths,
                "resolved_test_data_path": resolved_test_data_path,
            },
            "initial_action_menus": initial_action_menus,
            "selected_directory_action_menus": selected_directory_action_menus,
            "filesystem_context_menus": {
                "screen_context": "filesystem browser with a selected entry and its ENTER-opened context menu",
                "selected_directory": {
                    "path": resolved_test_data_path,
                    "browser_path": directory_menu_capture["browser_path"],
                    "selected_entry": directory_menu_capture["selected_entry"],
                    "menu_items": directory_menu_capture["menu_items"],
                    "default_item": directory_menu_capture["default_item"],
                },
                "menu_definitions": menu_definitions,
            },
        }
    }


args_debug_screens = False


def run_telnet_capture(
    *,
    host: str,
    password: Optional[str],
    connect_timeout: float,
    read_timeout: float,
    telnet_port: int = TELNET_PORT,
    debug_screens: bool,
    debug_prefix: str,
    action,
    attempts: int = 2,
):
    last_error: Optional[Exception] = None
    for attempt in range(1, attempts + 1):
        try:
            with TelnetSession(
                host,
                password,
                connect_timeout,
                read_timeout,
                telnet_port=telnet_port,
                debug_screens=debug_screens,
                debug_prefix=debug_prefix,
            ) as session:
                return action(session)
        except RuntimeError as exc:
            last_error = exc
            log(f"Retrying {debug_prefix} capture after attempt {attempt} failed: {exc}")
    if last_error is None:
        raise RuntimeError(f"{debug_prefix} capture failed")
    raise last_error


def main() -> int:
    parser = argparse.ArgumentParser(description="Dump C64U telnet menus to YAML.")
    parser.add_argument("--base-url", default="http://c64u", help="Base URL for REST metadata lookup")
    parser.add_argument("--password", default=None, help="Optional network password for REST, FTP, and Telnet")
    parser.add_argument("--output", default="docs/c64/c64u-telnet.yaml", help="Primary YAML output path")
    parser.add_argument(
        "--mirror-output",
        default="docs/c64/devices/{device_family}/{firmware_version}/c64u-telnet.yaml",
        help="Optional secondary output path template. Use {device_family} and {firmware_version} as placeholders.",
    )
    parser.add_argument(
        "--preferred-test-data-path",
        default="/USB0/test-data",
        help="Preferred test-data path to resolve first",
    )
    parser.add_argument(
        "--fallback-test-data-path",
        action="append",
        default=["/USB1/test-data"],
        help="Additional test-data paths to try after the preferred path",
    )
    parser.add_argument("--timeout", type=float, default=5.0, help="REST and FTP timeout in seconds")
    parser.add_argument("--connect-timeout", type=float, default=5.0, help="Telnet connect timeout in seconds")
    parser.add_argument("--read-timeout", type=float, default=0.3, help="Telnet read timeout in seconds")
    parser.add_argument("--ftp-port", type=int, default=FTP_PORT, help="FTP port to probe")
    parser.add_argument("--telnet-port", type=int, default=TELNET_PORT, help="Telnet port to probe")
    parser.add_argument("--retries", type=int, default=2, help="REST retry count")
    parser.add_argument("--retry-delay", type=float, default=1.0, help="REST retry delay in seconds")
    parser.add_argument(
        "--debug-screens",
        action="store_true",
        help="Print every settled telnet screen state to stdout for debugging",
    )
    args = parser.parse_args()
    global args_debug_screens
    args_debug_screens = args.debug_screens

    base_url = args.base_url.rstrip("/")
    parsed = urlparse(base_url)
    host = parsed.hostname or "c64u"
    headers = {"Accept": "application/json"}
    if args.password:
        headers["X-Password"] = args.password

    script_root = Path(__file__).resolve().parent
    repo_root = script_root.parent
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = repo_root / output_path

    log(f"Fetching device metadata from {base_url}")
    metadata = fetch_device_metadata(base_url, headers, args.timeout, args.retries, args.retry_delay)
    action_keys = ["F1"] if metadata.get("device_type") == "C64 Ultimate" else ["F5"]

    with open_ftp(host, args.password, args.timeout, ftp_port=args.ftp_port) as ftp:
        candidates = [args.preferred_test_data_path, *args.fallback_test_data_path]
        log(f"Resolving test-data path from {candidates}")
        resolved_test_data_path = resolve_test_data_path(ftp, candidates)
        log(f"Resolved test-data path to {resolved_test_data_path}")
        reu_probe_fixture = ensure_reu_probe_fixture(ftp, resolved_test_data_path)

        try:
            directory_menu_capture = run_telnet_capture(
                host=host,
                password=args.password,
                connect_timeout=args.connect_timeout,
                read_timeout=args.read_timeout,
                telnet_port=args.telnet_port,
                debug_screens=args.debug_screens,
                debug_prefix="directory-menu",
                action=lambda session: open_context_menu(
                    session,
                    ftp,
                    parent_path(resolved_test_data_path),
                    basename(resolved_test_data_path),
                ),
            )

            file_menu_payloads: list[dict[str, Any]] = []
            for file_info in representative_files(ftp, resolved_test_data_path):
                capture = run_telnet_capture(
                    host=host,
                    password=args.password,
                    connect_timeout=args.connect_timeout,
                    read_timeout=args.read_timeout,
                    telnet_port=args.telnet_port,
                    debug_screens=args.debug_screens,
                    debug_prefix=f"file-menu-{file_info['label']}",
                    action=lambda session, file_info=file_info: open_context_menu(
                        session,
                        ftp,
                        file_info["directory"],
                        file_info["name"],
                    ),
                )
                file_menu_payloads.append(
                    {
                        "label": file_info["label"],
                        "path": file_info["path"],
                        "menu_items": capture["menu_items"],
                        "default_item": capture["default_item"],
                    }
                )
        finally:
            cleanup_reu_probe_fixture(ftp, reu_probe_fixture)

    menu_definitions = build_file_type_menu_definitions(file_menu_payloads)

    initial_action_menus = capture_initial_context_menus(
        host,
        args.password,
        connect_timeout=args.connect_timeout,
        read_timeout=args.read_timeout,
        telnet_port=args.telnet_port,
        action_keys=action_keys,
    )

    with open_ftp(host, args.password, args.timeout, ftp_port=args.ftp_port) as ftp:
        selected_directory_action_menus = capture_selected_directory_action_menus(
            host,
            args.password,
            connect_timeout=args.connect_timeout,
            read_timeout=args.read_timeout,
            ftp=ftp,
            path=resolved_test_data_path,
            telnet_port=args.telnet_port,
            action_keys=action_keys,
        )

    document = build_telnet_document(
        base_url=base_url,
        host=host,
        metadata=metadata,
        requested_test_data_paths=list(dict.fromkeys([args.preferred_test_data_path, *args.fallback_test_data_path])),
        resolved_test_data_path=resolved_test_data_path,
        initial_action_menus=initial_action_menus,
        selected_directory_action_menus=selected_directory_action_menus,
        directory_menu_capture=directory_menu_capture,
        menu_definitions=menu_definitions,
    )

    yaml_text = dump_yaml(document)
    outputs = resolve_output_paths(
        output_path,
        args.mirror_output,
        metadata["firmware_version"],
        infer_device_family(metadata.get("device_type")),
    )
    for destination in outputs:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(yaml_text, encoding="utf-8")
        log(f"Wrote {destination}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
