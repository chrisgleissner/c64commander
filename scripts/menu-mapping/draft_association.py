#!/usr/bin/env python3
"""Draft a REST <-> menu *association* YAML for the menu-config mapping layer.

This is an AUTHORING AID, not part of the build. It bootstraps the association
sidecar consumed by `scripts/compile-menu-mapping.mjs` when a NEW device-menu YAML
is captured. It walks a `*-menu.yaml`, auto-matches each settings leaf to a REST
item in its target category (normalized: lowercase + strip non-alphanumerics), and
either prints a review report or emits the association YAML.

The compile script (`menu-mapping:check`, wired into `npm run lint`) is the real
safety net — it re-validates whatever this emits against the menu + config YAMLs.
So the workflow is: draft here -> human review the report -> `--emit` -> review the
YAML diff -> `npm run menu-mapping:compile` -> fix any compile/drift errors.

Usage
-----
    # Report only (matched / menuOnly / UNMATCHED / unmapped-REST-items):
    python3 scripts/menu-mapping/draft_association.py

    # Emit the association YAML (review the diff before committing):
    python3 scripts/menu-mapping/draft_association.py --emit

Adding a new family/firmware
----------------------------
Copy this file's RULES block and retarget MENU/CFG/OUT + the per-menu-category REST
mappings (DEFAULT_CAT / SECTION_CAT / OVERRIDE / ALIAS_SECTIONS / EXPLICIT_MENU_ONLY).
Everything below the RULES block is generic. See the SKILL at
`.github/skills/menu-mapping-authoring/SKILL.md` and
`docs/research/menu-config-mapping/README.md`.
"""
from __future__ import annotations
import argparse
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - operator guidance
    sys.exit("PyYAML required: pip install pyyaml")

# ===================== RULES (edit for a new family/firmware) =====================
# Repo root derived from this script's own location (scripts/menu-mapping/<file>),
# so the authoring aid works from any checkout and in CI — never a developer-specific path.
REPO = str(Path(__file__).resolve().parents[2])
MENU = f"{REPO}/docs/c64/devices/c64u/1.1.0/c64u-menu.yaml"
CFG = f"{REPO}/docs/c64/devices/c64u/1.1.0/c64u-config.yaml"
OUT = f"{REPO}/src/lib/config/menuMapping/c64u-1.1.0.association.yaml"
FAMILY = "C64U"
FIRMWARE = "1.1.0"
MENU_REL = "docs/c64/devices/c64u/1.1.0/c64u-menu.yaml"
CFG_REL = "docs/c64/devices/c64u/1.1.0/c64u-config.yaml"

# Menu pages that are NOT REST-config surfaces (file browser / search form / info).
NON_CONFIG = ["Disk file browser", "CommoServe file search", "System information"]

# menuCategory -> default REST category (None => section-driven only).
DEFAULT_CAT = {
    "Memory & ROMs": "C64 and Cartridge Settings",
    "Turbo boost": "U64 Specific Settings",
    "Video setup": "U64 Specific Settings",
    "Audio mixer": "Audio Mixer",
    "Speaker mixer": "Speaker Mixer",
    "SID sockets configuration": "SID Sockets Configuration",
    "UltiSID configuration": "UltiSID Configuration",
    "SID addressing": "SID Addressing",
    "SID player behavior": "U64 Specific Settings",
    "Joystick & controllers": "U64 Specific Settings",
    "LED lighting": None,  # section-driven
    "Network services & timezone": "Network Settings",
    "Wired network setup": "Ethernet Settings",
    "Wi-Fi network setup": "WiFi settings",
    "Modems": "Modem Settings",
    "Printers": "Printer Settings",
    "User interface": "User Interface Settings",
    "Built-in drive A": "Drive A Settings",
    "Built-in drive B": "Drive B Settings",
}
# (menuCategory, sectionLabel) -> REST category override.
SECTION_CAT = {
    ("Memory & ROMs", "Drive A"): "Drive A Settings",
    ("Memory & ROMs", "Drive B"): "Drive B Settings",
    ("LED lighting", "Power LED (if installed)"): "U64 Specific Settings",
    ("LED lighting", "Case lights"): "LED Strip Settings",
    ("LED lighting", "Keyboard lights"): "Keyboard Lighting",
}
# Sections whose items are aliases of a primary elsewhere (share REST state).
ALIAS_SECTIONS = {("Memory & ROMs", "Drive A"), ("Memory & ROMs", "Drive B")}
# Explicit (menuCategory, leafLabel) -> REST item, where the normalized auto-match fails.
OVERRIDE = {
    ("Memory & ROMs", "Character ROM"): "Char ROM",
    ("Memory & ROMs", "Size"): "REU Size",
    ("Memory & ROMs", "Ultimate audio"): "Map Ultimate Audio $DF20-DFFF",
    ("Joystick & controllers", "Joystick input"): "Joystick Swapper",
    ("LED lighting", "Output 1"): "LED Select Top",
    ("LED lighting", "Output 2"): "LED Select Bot",
    ("LED lighting", "Mode"): "LedStrip Mode",
    ("LED lighting", "Music detect"): "LedStrip Auto SID Mode",
    ("LED lighting", "Pattern"): "LedStrip Pattern",
    ("LED lighting", "Brightness"): "Strip Intensity",
    ("LED lighting", "Color"): "Fixed Color",
    ("LED lighting", "Tint"): "Color tint",
    ("SID addressing", "Auto addr mirroring"): "Auto Address Mirroring",
}
# Menu leaves that are explicitly menu-only (no persistent REST config).
EXPLICIT_MENU_ONLY = {("Joystick & controllers", "Paddle override")}


def formatter_for(cat, item):
    if item == "CPU Speed":
        return "cpuSpeedMhz"
    if cat in ("Audio Mixer", "Speaker Mixer") and item.startswith("Vol "):
        return "db"
    if cat == "Audio Mixer" and item.startswith("Pan "):
        return "pan"
    if cat == "SID Addressing" and item.endswith("Address"):
        return "address"
    return None
# =================================================================================


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def walk(items, path, section):
    """Yield (leafLabel, fullPath, kind, sectionLabel) for every leaf under `items`."""
    for label, obj in (items or {}).items():
        obj = obj or {}
        kind = obj.get("kind")
        if kind == "section" and isinstance(obj.get("items"), dict):
            yield from walk(obj["items"], path + [label], label)
        else:
            yield (label, path + [label], kind, section)


def compute():
    menu = yaml.safe_load(open(MENU))["config"]
    cfg = yaml.safe_load(open(CFG))["config"]["categories"]
    rest = {cat: list((cv or {}).get("items", {}).keys()) for cat, cv in cfg.items()}
    rest_norm = {cat: {norm(i): i for i in items} for cat, items in rest.items()}

    mappings, menu_only, unmatched = [], [], []
    used = {cat: set() for cat in rest}

    for menu_cat, cv in menu["categories"].items():
        if menu_cat in NON_CONFIG:
            continue
        mp = cv.get("menu_path", [menu_cat])
        for label, full, kind, section in walk(cv.get("items") or {}, list(mp), None):
            rc = SECTION_CAT.get((menu_cat, section)) or DEFAULT_CAT.get(menu_cat)
            is_alias = (menu_cat, section) in ALIAS_SECTIONS
            if (menu_cat, label) in EXPLICIT_MENU_ONLY:
                menu_only.append(full)
                continue
            ov = OVERRIDE.get((menu_cat, label))
            item = None
            if rc:
                if ov and norm(ov) in rest_norm.get(rc, {}):
                    item = rest_norm[rc][norm(ov)]
                elif norm(label) in rest_norm.get(rc, {}):
                    item = rest_norm[rc][norm(label)]
            if item:
                entry = {"path": full, "category": rc, "item": item}
                f = formatter_for(rc, item)
                if f:
                    entry["formatter"] = f
                if is_alias:
                    entry["alias"] = True
                mappings.append(entry)
                used[rc].add(item)
            elif kind in ("action", "status") or section == "Status":
                menu_only.append(full)
            else:
                unmatched.append((full, rc, kind, section))

    return rest, used, mappings, menu_only, unmatched


def report(rest, used, mappings, menu_only, unmatched):
    print(f"MAPPINGS: {len(mappings)}   MENU-ONLY: {len(menu_only)}   UNMATCHED: {len(unmatched)}")
    if unmatched:
        print("\n!!! UNMATCHED — NEEDS ATTENTION:")
        for full, rc, kind, section in unmatched:
            print(f"  {' / '.join(full)}  (cat={rc}, kind={kind}, section={section})")
    print("\nREST items NOT mapped (candidate intentionallyUnmapped):")
    for cat in rest:
        leftover = [i for i in rest[cat] if i not in used[cat]]
        if leftover:
            print(f"  [{cat}]: {', '.join(leftover)}")


def yscalar(s):
    s = str(s)
    specials = [",", ":", "[", "]", "{", "}", "#", "&", "*", "'", '"']
    if any(c in s for c in specials) or s != s.strip():
        return '"' + s.replace('"', '\\"') + '"'
    return s


def yflow(lst):
    return "[" + ", ".join(yscalar(x) for x in lst) + "]"


def emit(rest, used, mappings, menu_only):
    lines = [
        f"# {FAMILY} {FIRMWARE} REST <-> menu association — AUTHORITATIVE SOURCE (hand-reviewed).",
        "#",
        "# Drafted by scripts/menu-mapping/draft_association.py then reviewed. Carries ONLY",
        "# what the menu YAML lacks (REST pointers + formatter/alias flags). Labels live in",
        "# the menu YAML; `path` arrays are validated join keys. Consumed by",
        "# scripts/compile-menu-mapping.mjs -> *.generated.ts.",
        "",
        f"family: {FAMILY}",
        f'firmwareVersion: "{FIRMWARE}"',
        "sources:",
        f"  menu: {MENU_REL}",
        f"  config: {CFG_REL}",
        "",
        "nonConfigPages:",
        *[f"  - {p}" for p in NON_CONFIG],
        "",
        "mappings:",
    ]
    for m in mappings:
        parts = [f"path: {yflow(m['path'])}", f"category: {yscalar(m['category'])}", f"item: {yscalar(m['item'])}"]
        if m.get("formatter"):
            parts.append(f"formatter: {yscalar(m['formatter'])}")
        if m.get("alias"):
            parts.append("alias: true")
        lines.append("  - { " + ", ".join(parts) + " }")
    lines += ["", "menuOnly:", *[f"  - {yflow(p)}" for p in menu_only], "", "intentionallyUnmapped:"]
    for cat in rest:
        for i in [x for x in rest[cat] if x not in used[cat]]:
            lines.append(f"  - {{ category: {yscalar(cat)}, item: {yscalar(i)} }}")
    lines.append("")
    open(OUT, "w").write("\n".join(lines))
    print(f"wrote {OUT} ({len(lines)} lines)")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--emit", action="store_true", help="write the association YAML to OUT")
    args = ap.parse_args()
    rest, used, mappings, menu_only, unmatched = compute()
    report(rest, used, mappings, menu_only, unmatched)
    if args.emit:
        if unmatched:
            sys.exit("\nrefusing to --emit with UNMATCHED leaves; resolve overrides first.")
        emit(rest, used, mappings, menu_only)


if __name__ == "__main__":
    main()
