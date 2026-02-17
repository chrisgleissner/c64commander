#!/usr/bin/env python3
from __future__ import annotations

import csv
import os
import struct
import zlib
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


def color_hex_to_rgb(color: str) -> Tuple[int, int, int]:
    value = color.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def metric_label(metric: str) -> str:
    labels = {
        "cpu_percent": "CPU %",
        "rss_kb": "RSS (KB)",
        "total_pss_kb": "Total PSS (KB)",
    }
    return labels.get(metric, metric)


def build_metric_series(
    platform: str, platform_series: Dict[str, List[Point]]
) -> Tuple[Dict[str, Dict[str, List[Point]]], List[str]]:
    metric_to_process: Dict[str, Dict[str, List[Point]]] = defaultdict(lambda: defaultdict(list))
    for key, points in platform_series.items():
        process_name, metric = key.split("|", 1)
        metric_to_process[metric][process_name] = sorted(points, key=lambda point: point.timestamp)

    metrics = [metric for metric in METRICS_COMMON if metric in metric_to_process]
    if platform == "android" and "total_pss_kb" in metric_to_process:
        metrics.append("total_pss_kb")
    return metric_to_process, metrics


def render_platform_svg(platform: str, platform_series: Dict[str, List[Point]], out_path: str) -> None:
    metric_to_process, metrics = build_metric_series(platform, platform_series)
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


def draw_pixel(buffer: bytearray, width: int, height: int, x: int, y: int, color: Tuple[int, int, int]) -> None:
    if x < 0 or y < 0 or x >= width or y >= height:
        return
    index = (y * width + x) * 3
    buffer[index] = color[0]
    buffer[index + 1] = color[1]
    buffer[index + 2] = color[2]


def draw_line(
    buffer: bytearray,
    width: int,
    height: int,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: Tuple[int, int, int],
) -> None:
    dx = abs(x1 - x0)
    sx = 1 if x0 < x1 else -1
    dy = -abs(y1 - y0)
    sy = 1 if y0 < y1 else -1
    err = dx + dy

    while True:
        draw_pixel(buffer, width, height, x0, y0, color)
        if x0 == x1 and y0 == y1:
            break
        err2 = err * 2
        if err2 >= dy:
            err += dy
            x0 += sx
        if err2 <= dx:
            err += dx
            y0 += sy


def draw_rect(
    buffer: bytearray,
    width: int,
    height: int,
    x: int,
    y: int,
    w: int,
    h: int,
    fill_color: Tuple[int, int, int],
    border_color: Tuple[int, int, int] | None = None,
) -> None:
    for py in range(y, y + h):
        for px in range(x, x + w):
            draw_pixel(buffer, width, height, px, py, fill_color)
    if border_color is not None:
        for px in range(x, x + w):
            draw_pixel(buffer, width, height, px, y, border_color)
            draw_pixel(buffer, width, height, px, y + h - 1, border_color)
        for py in range(y, y + h):
            draw_pixel(buffer, width, height, x, py, border_color)
            draw_pixel(buffer, width, height, x + w - 1, py, border_color)


def write_png(path: str, width: int, height: int, rgb_buffer: bytearray) -> None:
    rows = bytearray()
    stride = width * 3
    for y in range(height):
        rows.append(0)
        start = y * stride
        rows.extend(rgb_buffer[start : start + stride])
    compressed = zlib.compress(bytes(rows), level=9)

    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        return (
            struct.pack("!I", len(data))
            + chunk_type
            + data
            + struct.pack("!I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        )

    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0)))
    png.extend(chunk(b"IDAT", compressed))
    png.extend(chunk(b"IEND", b""))

    with open(path, "wb") as handle:
        handle.write(png)


def render_platform_png(platform: str, platform_series: Dict[str, List[Point]], out_path: str) -> None:
    metric_to_process, metrics = build_metric_series(platform, platform_series)
    if not metrics:
        return

    panel_count = len(metrics)
    width = 1280
    panel_height = 260
    chart_height = panel_count * panel_height + 80
    margin_left = 88
    margin_right = 80
    margin_top = 40

    buffer = bytearray([255] * (width * chart_height * 3))

    all_timestamps = [point.timestamp for process in metric_to_process.values() for series in process.values() for point in series]
    min_ts = min(all_timestamps)
    max_ts = max(all_timestamps)
    span_ts = max(1, max_ts - min_ts)

    grid_color = color_hex_to_rgb("#e2e8f0")
    panel_color = color_hex_to_rgb("#f8fafc")

    for panel_index, metric in enumerate(metrics):
        panel_top = margin_top + panel_index * panel_height
        panel_bottom = panel_top + panel_height - 40
        panel_left = margin_left
        panel_right = width - margin_right
        draw_rect(
            buffer,
            width,
            chart_height,
            panel_left,
            panel_top,
            panel_right - panel_left,
            panel_bottom - panel_top,
            panel_color,
            grid_color,
        )

        values = [point.value for series in metric_to_process[metric].values() for point in series]
        min_v = min(values)
        max_v = max(values)
        if min_v == max_v:
            min_v = min_v * 0.95 if min_v != 0 else -1
            max_v = max_v * 1.05 if max_v != 0 else 1
        value_span = max_v - min_v

        for tick in range(0, 6):
            y = int(round(panel_bottom - (tick / 5.0) * (panel_bottom - panel_top)))
            draw_line(buffer, width, chart_height, panel_left, y, panel_right, y, grid_color)

        for process_name in sorted(metric_to_process[metric].keys()):
            series = metric_to_process[metric][process_name]
            color = color_hex_to_rgb(color_for(process_name))
            points: List[Tuple[int, int]] = []
            for point in series:
                x = int(round(panel_left + ((point.timestamp - min_ts) / span_ts) * (panel_right - panel_left)))
                y = int(round(panel_bottom - ((point.value - min_v) / value_span) * (panel_bottom - panel_top)))
                points.append((x, y))
            if len(points) == 1:
                draw_pixel(buffer, width, chart_height, points[0][0], points[0][1], color)
            else:
                for index in range(1, len(points)):
                    draw_line(
                        buffer,
                        width,
                        chart_height,
                        points[index - 1][0],
                        points[index - 1][1],
                        points[index][0],
                        points[index][1],
                        color,
                    )

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    write_png(out_path, width, chart_height, buffer)


def write_index_md(charts_dir: str, platforms: List[str]) -> None:
    lines = ["# Telemetry Charts", ""]
    lines.append("Charts are generated from raw `metrics.csv` and use deterministic SVG+PNG rendering.")
    lines.append("")
    for platform in platforms:
        lines.append(f"## {platform}")
        lines.append("")
        lines.append(f"![{platform} telemetry png](./{platform}.png)")
        lines.append("")
        lines.append(f"SVG source: ./{platform}.svg")
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
        svg_out = os.path.join(charts_dir, f"{platform}.svg")
        png_out = os.path.join(charts_dir, f"{platform}.png")
        render_platform_svg(platform, series[platform], svg_out)
        render_platform_png(platform, series[platform], png_out)
        if os.path.exists(svg_out) and os.path.exists(png_out):
            rendered.append(platform)
            print(f"telemetry charts: wrote {svg_out}")
            print(f"telemetry charts: wrote {png_out}")

    if not rendered:
        raise SystemExit("telemetry charts: no charts rendered")

    write_index_md(charts_dir, rendered)
    print(f"telemetry charts: wrote {os.path.join(charts_dir, 'index.md')}")


if __name__ == "__main__":
    main()
