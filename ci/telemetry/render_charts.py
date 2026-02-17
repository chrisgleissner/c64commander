#!/usr/bin/env python3
from __future__ import annotations

import csv
import os
from collections import defaultdict
from dataclasses import dataclass
from glob import glob
from hashlib import sha1
from html import escape
from typing import Dict, List, Tuple

METRICS_COMMON = ["cpu_percent", "rss_kb"]
METRICS_ANDROID_EXTRA = ["total_pss_kb"]

PALETTE = [
    "#2563eb",
    "#dc2626",
    "#16a34a",
    "#9333ea",
    "#ea580c",
    "#0891b2",
    "#ca8a04",
    "#64748b",
]


@dataclass
class Point:
    timestamp: int
    process_name: str
    value: float


def discover_csv(root: str) -> List[str]:
    return sorted(glob(os.path.join(root, "**", "metrics.csv"), recursive=True))


def parse_float(raw: str) -> float | None:
    text = (raw or "").strip()
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_series(csv_paths: List[str]) -> Dict[str, Dict[str, List[Point]]]:
    data: Dict[str, Dict[str, List[Point]]] = defaultdict(lambda: defaultdict(list))
    for path in csv_paths:
        with open(path, newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                platform = (row.get("platform") or "").strip()
                process_name = (row.get("process_name") or "").strip()
                timestamp_raw = (row.get("timestamp") or "").strip()
                if not platform or not process_name or not timestamp_raw.isdigit():
                    continue
                timestamp = int(timestamp_raw)
                metrics = list(METRICS_COMMON)
                if platform == "android":
                    metrics.extend(METRICS_ANDROID_EXTRA)
                for metric in metrics:
                    value = parse_float(row.get(metric, ""))
                    if value is None:
                        continue
                    key = f"{process_name}|{metric}"
                    data[platform][key].append(Point(timestamp, process_name, value))
    return data


def color_for(name: str) -> str:
    digest = int(sha1(name.encode("utf-8")).hexdigest()[:8], 16)
    return PALETTE[digest % len(PALETTE)]


def metric_label(metric: str) -> str:
    labels = {
        "cpu_percent": "CPU %",
        "rss_kb": "RSS (KB)",
        "total_pss_kb": "Total PSS (KB)",
    }
    return labels.get(metric, metric)


def render_platform_svg(platform: str, platform_series: Dict[str, List[Point]], out_path: str) -> None:
    metric_to_process: Dict[str, Dict[str, List[Point]]] = defaultdict(lambda: defaultdict(list))
    for key, points in platform_series.items():
        process_name, metric = key.split("|", 1)
        metric_to_process[metric][process_name] = sorted(points, key=lambda point: point.timestamp)

    metrics = [metric for metric in METRICS_COMMON if metric in metric_to_process]
    if platform == "android" and "total_pss_kb" in metric_to_process:
        metrics.append("total_pss_kb")
    if not metrics:
        return

    panel_count = len(metrics)
    width = 1280
    panel_height = 260
    chart_height = panel_count * panel_height + 80
    margin_left = 88
    margin_right = 220
    margin_top = 40

    all_timestamps = [point.timestamp for process in metric_to_process.values() for series in process.values() for point in series]
    min_ts = min(all_timestamps)
    max_ts = max(all_timestamps)
    span_ts = max(1, max_ts - min_ts)

    parts: List[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{chart_height}" viewBox="0 0 {width} {chart_height}">'
    )
    parts.append('<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>')
    parts.append(
        f'<text x="24" y="28" font-family="Inter, Arial, sans-serif" font-size="20" fill="#0f172a">Telemetry ({escape(platform)})</text>'
    )
    parts.append(
        f'<text x="24" y="48" font-family="Inter, Arial, sans-serif" font-size="12" fill="#475569">x-axis: seconds since start ({min_ts} to {max_ts})</text>'
    )

    legend_processes = sorted({process for metric in metric_to_process.values() for process in metric.keys()})
    legend_y = 72
    for process in legend_processes:
        color = color_for(process)
        parts.append(f'<line x1="1080" y1="{legend_y}" x2="1110" y2="{legend_y}" stroke="{color}" stroke-width="3"/>')
        parts.append(
            f'<text x="1118" y="{legend_y + 4}" font-family="Inter, Arial, sans-serif" font-size="11" fill="#0f172a">{escape(process)}</text>'
        )
        legend_y += 16

    for panel_index, metric in enumerate(metrics):
        panel_top = margin_top + panel_index * panel_height
        panel_bottom = panel_top + panel_height - 40
        panel_left = margin_left
        panel_right = width - margin_right

        values = [point.value for series in metric_to_process[metric].values() for point in series]
        min_v = min(values)
        max_v = max(values)
        if min_v == max_v:
            min_v = min_v * 0.95 if min_v != 0 else -1
            max_v = max_v * 1.05 if max_v != 0 else 1
        value_span = max_v - min_v

        parts.append(f'<rect x="{panel_left}" y="{panel_top}" width="{panel_right - panel_left}" height="{panel_bottom - panel_top}" fill="#f8fafc" stroke="#e2e8f0"/>')
        parts.append(
            f'<text x="{panel_left}" y="{panel_top - 10}" font-family="Inter, Arial, sans-serif" font-size="14" fill="#0f172a">{escape(metric_label(metric))}</text>'
        )

        for tick in range(0, 6):
            y = panel_bottom - (tick / 5.0) * (panel_bottom - panel_top)
            v = min_v + (tick / 5.0) * value_span
            parts.append(f'<line x1="{panel_left}" y1="{y:.1f}" x2="{panel_right}" y2="{y:.1f}" stroke="#e2e8f0" stroke-width="1"/>')
            parts.append(
                f'<text x="{panel_left - 8}" y="{y + 4:.1f}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="10" fill="#64748b">{v:.1f}</text>'
            )

        for process_name in sorted(metric_to_process[metric].keys()):
            series = metric_to_process[metric][process_name]
            points: List[str] = []
            for point in series:
                x = panel_left + ((point.timestamp - min_ts) / span_ts) * (panel_right - panel_left)
                y = panel_bottom - ((point.value - min_v) / value_span) * (panel_bottom - panel_top)
                points.append(f"{x:.2f},{y:.2f}")
            if len(points) == 1:
                x, y = points[0].split(",")
                color = color_for(process_name)
                parts.append(f'<circle cx="{x}" cy="{y}" r="2.5" fill="{color}"/>')
            elif points:
                color = color_for(process_name)
                parts.append(f'<polyline fill="none" stroke="{color}" stroke-width="2" points="{" ".join(points)}"/>')

        x_axis_y = panel_bottom + 14
        for tick in range(0, 6):
            frac = tick / 5.0
            x = panel_left + frac * (panel_right - panel_left)
            seconds = int(frac * span_ts)
            parts.append(f'<line x1="{x:.1f}" y1="{panel_bottom}" x2="{x:.1f}" y2="{panel_bottom + 4}" stroke="#64748b" stroke-width="1"/>')
            parts.append(
                f'<text x="{x:.1f}" y="{x_axis_y + 12}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="10" fill="#64748b">+{seconds}s</text>'
            )

    parts.append("</svg>")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(parts) + "\n")


def write_index_md(charts_dir: str, platforms: List[str]) -> None:
    lines = ["# Telemetry Charts", ""]
    lines.append("Charts are generated from raw `metrics.csv` and use deterministic SVG rendering.")
    lines.append("")
    for platform in platforms:
        lines.append(f"## {platform}")
        lines.append("")
        lines.append(f"![{platform} telemetry](./{platform}.svg)")
        lines.append("")
    with open(os.path.join(charts_dir, "index.md"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines).rstrip() + "\n")


def main() -> None:
    root = os.environ.get("TELEMETRY_SUMMARY_DIR", "ci-artifacts/telemetry")
    csv_paths = discover_csv(root)
    if not csv_paths:
        raise SystemExit("telemetry charts: no metrics.csv files found")

    series = load_series(csv_paths)
    charts_dir = os.path.join(root, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    rendered: List[str] = []
    for platform in sorted(series.keys()):
        out_path = os.path.join(charts_dir, f"{platform}.svg")
        render_platform_svg(platform, series[platform], out_path)
        if os.path.exists(out_path):
            rendered.append(platform)
            print(f"telemetry charts: wrote {out_path}")

    if not rendered:
        raise SystemExit("telemetry charts: no charts rendered")

    write_index_md(charts_dir, rendered)
    print(f"telemetry charts: wrote {os.path.join(charts_dir, 'index.md')}")


if __name__ == "__main__":
    main()
