#!/usr/bin/env python3
"""
validate_screenshots.py — Lighting Studio screenshot validator

Checks screenshots in docs/img/app/home/dialogs/ against a set of layout rules
to detect visual regressions introduced by design changes.

Rules
-----
1. profile-label        Every lighting-studio PNG filename must contain -compact, -medium,
                        or -expanded.
2. blank-band           For Context Lens screenshots, detects a horizontal blank band
                        wider than 25 % of the image height in the upper-middle region.
                        Such a band indicates the CSS grid stretch bug (F1).
3. metadata-bounds      When a JSON layout-metadata sidecar exists alongside a screenshot,
                        verifies that key elements reported in the sidecar are within the
                        expected viewport height (not cut off at the bottom).

Usage
-----
    python scripts/validate_screenshots.py [--screenshot-dir PATH] [--metadata-dir PATH]

    --screenshot-dir   Directory containing the dialog PNGs
                       (default: docs/img/app/home/dialogs)
    --metadata-dir     Directory containing layout-metadata JSON sidecars
                       (default: playwright/fixtures/layout-metadata)

Exit code
---------
    0  all checks pass
    1  one or more checks failed (failures are printed to stdout)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image


# ---------------------------------------------------------------------------
# Rule constants
# ---------------------------------------------------------------------------

PROFILE_LABELS = ("-compact", "-medium", "-expanded")
LIGHTING_STUDIO_STEM_PREFIX = (
    "05-lighting-studio",
    "06-lighting-studio-compose",
    "07-lighting-studio-automation",
    "08-lighting-context-lens",
)

#: Fraction of image height to scan for blank-band detection (skip top/bottom 15 %)
BLANK_BAND_VERTICAL_SKIP = 0.15
#: Minimum fraction of image height that a blank band must span to trigger a failure
BLANK_BAND_MINIMUM_HEIGHT_FRACTION = 0.25
#: A row is considered "blank" when its mean luminance is above this threshold
#: (0–255 scale; the app's dialog background resolves to ~235–236 in screenshots)
BLANK_ROW_LUMINANCE_THRESHOLD = 232


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mean_row_luminance(img_rgb: Image.Image, row_y: int) -> float:
    """Return the mean luminance of a single pixel row."""
    row_pixels = img_rgb.crop((0, row_y, img_rgb.width, row_y + 1))
    r, g, b = row_pixels.split()
    # Standard luminance: 0.299 R + 0.587 G + 0.114 B
    lum = (
        0.299 * sum(r.getdata())  # type: ignore[arg-type]
        + 0.587 * sum(g.getdata())  # type: ignore[arg-type]
        + 0.114 * sum(b.getdata())  # type: ignore[arg-type]
    ) / img_rgb.width
    return lum


def _longest_blank_band(img_rgb: Image.Image) -> tuple[int, int]:
    """
    Return (start_row, length) for the longest consecutive run of blank rows
    within the central vertical region of *img_rgb*.

    A row is "blank" when its mean luminance exceeds BLANK_ROW_LUMINANCE_THRESHOLD.
    Only rows between [BLANK_BAND_VERTICAL_SKIP, 1 - BLANK_BAND_VERTICAL_SKIP] of
    the image height are examined.
    """
    h = img_rgb.height
    top = int(h * BLANK_BAND_VERTICAL_SKIP)
    bottom = int(h * (1.0 - BLANK_BAND_VERTICAL_SKIP))

    best_start = 0
    best_len = 0
    run_start = -1
    run_len = 0

    for y in range(top, bottom):
        if _mean_row_luminance(img_rgb, y) > BLANK_ROW_LUMINANCE_THRESHOLD:
            if run_start == -1:
                run_start = y
                run_len = 1
            else:
                run_len += 1
            if run_len > best_len:
                best_len = run_len
                best_start = run_start
        else:
            run_start = -1
            run_len = 0

    return best_start, best_len


# ---------------------------------------------------------------------------
# Rule implementations
# ---------------------------------------------------------------------------


def check_profile_label(png_path: Path) -> list[str]:
    """Rule 1: filename must contain a profile label."""
    stem = png_path.stem
    interesting = any(stem.startswith(prefix) for prefix in LIGHTING_STUDIO_STEM_PREFIX)
    if not interesting:
        return []
    if not any(label in stem for label in PROFILE_LABELS):
        return [
            f"[profile-label] {png_path.name}: lighting studio screenshot has no profile label "
            f"(-compact / -medium / -expanded) in the filename."
        ]
    return []


def check_blank_band(png_path: Path) -> list[str]:
    """Rule 2: Context Lens screenshots must not have a large blank band."""
    if "context-lens" not in png_path.stem:
        return []

    img = Image.open(png_path).convert("RGB")
    _, band_len = _longest_blank_band(img)
    threshold_px = int(img.height * BLANK_BAND_MINIMUM_HEIGHT_FRACTION)

    if band_len >= threshold_px:
        fraction = band_len / img.height
        return [
            f"[blank-band] {png_path.name}: detected a {band_len}px blank band "
            f"({fraction:.0%} of {img.height}px image height). "
            f"Threshold is {BLANK_BAND_MINIMUM_HEIGHT_FRACTION:.0%}. "
            f"This indicates the CSS grid stretch bug (F1)."
        ]
    return []


def check_metadata_bounds(metadata_path: Path) -> list[str]:
    """Rule 3: layout-metadata JSON — key elements must not be clipped below viewport."""
    failures: list[str] = []
    try:
        data = json.loads(metadata_path.read_text())
    except Exception as exc:
        return [f"[metadata-bounds] {metadata_path.name}: failed to parse ({exc})"]

    viewport = data.get("viewport", {})
    vh = viewport.get("height")
    if not isinstance(vh, (int, float)) or vh <= 0:
        return [f"[metadata-bounds] {metadata_path.name}: missing or invalid viewport.height"]

    elements: dict = data.get("elements", {})
    for key, bounds in elements.items():
        if bounds is None:
            # Element not found in DOM — only report if it's a required element
            required = ("dialog-header", "chip-row", "ownership-case", "ownership-keyboard")
            if key in required:
                failures.append(
                    f"[metadata-bounds] {metadata_path.name}: required element '{key}' "
                    f"was not found in the DOM."
                )
            continue
        bottom = bounds["y"] + bounds["height"]
        if bottom > vh:
            failures.append(
                f"[metadata-bounds] {metadata_path.name}: element '{key}' bottom edge "
                f"({bottom:.0f}px) exceeds viewport height ({vh}px) — element is clipped."
            )
    return failures


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--screenshot-dir",
        default="docs/img/app/home/dialogs",
        type=Path,
        help="Directory containing lighting-studio dialog PNGs",
    )
    parser.add_argument(
        "--metadata-dir",
        default="playwright/fixtures/layout-metadata",
        type=Path,
        help="Directory containing layout-metadata JSON sidecars",
    )
    args = parser.parse_args(argv)

    screenshot_dir: Path = args.screenshot_dir
    metadata_dir: Path = args.metadata_dir

    failures: list[str] = []

    # ---- screenshots ----
    if not screenshot_dir.is_dir():
        print(f"[warn] screenshot-dir not found: {screenshot_dir}")
    else:
        pngs = sorted(screenshot_dir.glob("*.png"))
        if not pngs:
            print(f"[warn] no PNG files found in {screenshot_dir}")
        for png in pngs:
            failures.extend(check_profile_label(png))
            failures.extend(check_blank_band(png))

    # ---- metadata sidecars ----
    if metadata_dir.is_dir():
        for json_file in sorted(metadata_dir.glob("*.json")):
            failures.extend(check_metadata_bounds(json_file))

    if failures:
        print("Screenshot validation FAILED:")
        for f in failures:
            print(f"  {f}")
        return 1
    else:
        print("Screenshot validation passed.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
