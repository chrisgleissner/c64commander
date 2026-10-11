#!/usr/bin/env python3
"""Render a set of tunes through every SID engine the app ships and compare them with reSIDfp.

    python3 tools/sid-engines/run_matrix.py --ez-render <ez_render> --out <dir> \
        [--hvsc ~/C64Music] [--roms ~/roms] [--seconds 30] [--tunes default|fixtures]

`fixtures` uses only files in this repository, so it runs in CI. `default` adds a set of HVSC tunes
chosen to cover what changes emulation behaviour: chip model, multi-SID, multispeed, NTSC, RSID,
BASIC, sample playback and many subsongs. Writes `matrix.json` and `matrix.md` to --out.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compare_engines  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
RATE = 48000

FIXTURE_TUNES = [
    ("tests/fixtures/tone-ladder.sid", 0, "tone ladder (PSID, undeclared model)"),
]

HVSC_TUNES = [
    ("MUSICIANS/H/Hubbard_Rob/Commando.sid", 0, "PSID 6581, single speed"),
    ("MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid", 0, "PSID 6581, filter-heavy"),
    ("MUSICIANS/L/Laxity/A_Trace_of_Space.sid", 0, "PSID 6581, modern player"),
    ("MUSICIANS/J/Jammer/Ad_Astra.sid", 0, "PSID 8580"),
    ("MUSICIANS/G/Galway_Martin/Wizball.sid", 3, "PSID, CIA multispeed, subsong 4"),
    ("MUSICIANS/L/Lieblich_Russell/Master_of_the_Lamps.sid", 0, "RSID NTSC"),
    ("MUSICIANS/G/Galway_Martin/Arkanoid.sid", 0, "RSID, sample playback"),
    ("MUSICIANS/M/Mahoney/Storebror.sid", 0, "RSID, 8-bit digi"),
    ("MUSICIANS/A/A-Man/Phat_Frog_2SID.sid", 0, "2SID 8580"),
    ("MUSICIANS/C/Chiummo_Gaetano/A_Walk_in_the_Countryside_3SID.sid", 0, "3SID 8580"),
    ("MUSICIANS/P/Pace_Wayne/Air.sid", 0, "PSID NTSC"),
    ("MUSICIANS/P/Pace_Wayne/Polonaise_BASIC.sid", 0, "RSID BASIC (needs BASIC ROM)"),
    ("MUSICIANS/P/Peters_Alan/Tusari.sid", 9, "PSID, 14 subsongs, subsong 10"),
]


def render_wasm(engine: str, tune: Path, song: int, seconds: float, out: Path, roms: Path | None) -> dict:
    cmd = ["node", str(REPO / "tools/sid-engines/render-wasm.mjs"), engine, str(tune), str(song), str(seconds),
           str(RATE), "8580", str(out)]
    if roms:
        cmd += [str(roms / "kernal.901227-03.bin"), str(roms / "basic.901226-01.bin")]
    return json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True, cwd=REPO).stdout)


def render_ez(binary: Path, tune: Path, song: int, seconds: float, out: Path, roms: Path | None) -> dict:
    cmd = [str(binary), str(tune), str(song), str(seconds), str(RATE), "8580", str(out)]
    if roms:
        cmd += [str(roms / "kernal.901227-03.bin"), str(roms / "basic.901226-01.bin"),
                str(roms / "characters.901225-01.bin")]
    return json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ez-render", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--hvsc", type=Path, default=Path(os.environ.get("HVSC", "~/C64Music")).expanduser())
    parser.add_argument("--roms", type=Path, default=None)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--tunes", choices=["default", "fixtures"], default="default")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    tunes = [(REPO / path, song, label) for path, song, label in FIXTURE_TUNES]
    if args.tunes == "default":
        tunes += [(args.hvsc / path, song, label) for path, song, label in HVSC_TUNES]

    rows = []
    for tune, song, label in tunes:
        if not tune.exists():
            print(f"missing tune {tune}", file=sys.stderr)
            return 1
        stem = f"{tune.stem}-{song}"
        renders = {}
        timings = {}
        for engine in ("residfp", "sidlite"):
            out = args.out / f"{stem}.{engine}.raw"
            timings[engine] = render_wasm(engine, tune, song, args.seconds, out, args.roms)
            renders[engine] = out
        out = args.out / f"{stem}.sidplayez.raw"
        timings["sidplayez"] = render_ez(args.ez_render, tune, song, args.seconds, out, args.roms)
        renders["sidplayez"] = out
        reference = compare_engines.load_raw(str(renders["residfp"]))
        for engine in ("sidplayez", "sidlite"):
            result = compare_engines.compare(reference, compare_engines.load_raw(str(renders[engine])), RATE,
                                             engine, "residfp")
            row = {"tune": str(tune.relative_to(args.hvsc) if args.hvsc in tune.parents else tune.relative_to(REPO)),
                   "song": song + 1, "label": label, **result.__dict__,
                   "render_ms_per_s": timings[engine]["renderMs"] / args.seconds,
                   "reference_render_ms_per_s": timings["residfp"]["renderMs"] / args.seconds}
            rows.append(row)
            print(f"{row['tune']}#{row['song']} {engine}: offset {row['start_offset_ms']:+.0f} ms, "
                  f"level {row['level_db']:+.2f} dB, env {row['envelope_corr']:.3f}, chroma {row['chroma_sim']:.3f}, "
                  f"bands {row['band_db_mae']:.2f} dB", flush=True)
        for raw in renders.values():
            if not os.environ.get("KEEP_RENDERS"):
                raw.unlink()

    (args.out / "matrix.json").write_text(json.dumps(rows, indent=2))
    lines = ["| Tune | Song | What it covers | Engine | Frames | Start offset (ms) | Level (dB) | Envelope r |"
             " Chroma sim | Band MAE (dB) | Stereo r (ref) | Render ms/s (ref) |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        lines.append(
            f"| {r['tune']} | {r['song']} | {r['label']} | {r['engine']} | {r['frames']} | {r['start_offset_ms']:+.0f} |"
            f" {r['level_db']:+.2f} | {r['envelope_corr']:.3f} | {r['chroma_sim']:.3f} | {r['band_db_mae']:.2f} |"
            f" {r['stereo_corr']:.2f} ({r['reference_stereo_corr']:.2f}) |"
            f" {r['render_ms_per_s']:.1f} ({r['reference_render_ms_per_s']:.1f}) |")
    (args.out / "matrix.md").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
