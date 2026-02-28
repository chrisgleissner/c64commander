#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import os
from collections import defaultdict
from dataclasses import dataclass
from glob import glob
from statistics import median
from typing import Dict, Iterable, List, Optional, Tuple

NUMERIC_FIELDS = [
    "cpu_percent",
    "rss_kb",
    "pss_kb",
    "dalvik_pss_kb",
    "native_pss_kb",
    "total_pss_kb",
]

INT_FIELDS = {"rss_kb", "pss_kb", "dalvik_pss_kb", "native_pss_kb", "total_pss_kb"}

SCHEMA = [
    "timestamp",
    "platform",
    "device",
    "process_name",
    "pid",
    "cpu_percent",
    "rss_kb",
    "threads",
    "pss_kb",
    "dalvik_pss_kb",
    "native_pss_kb",
    "total_pss_kb",
]


@dataclass
class Record:
    timestamp: int
    platform: str
    device: str
    process_name: str
    pid: str
    values: Dict[str, Optional[float]]


def parse_value(field: str, value: str) -> Optional[float]:
    if value is None:
        return None
    trimmed = value.strip()
    if trimmed == "":
        return None
    try:
        number = float(trimmed)
    except ValueError:
        return None
    if field in INT_FIELDS:
        return float(int(number))
    return number


def to_output_number(field: str, value: float) -> float | int:
    if field in INT_FIELDS:
        return int(round(value))
    return round(value, 1)


def summarize(values: List[float], field: str) -> Dict[str, float | int]:
    if not values:
        return {}
    values_sorted = sorted(values)
    return {
        "min": to_output_number(field, values_sorted[0]),
        "median": to_output_number(field, float(median(values_sorted))),
        "max": to_output_number(field, values_sorted[-1]),
    }


def discover_csv_inputs(root: str) -> List[str]:
    candidates = sorted(glob(os.path.join(root, "**", "*.csv"), recursive=True))
    results: List[str] = []
    for path in candidates:
        name = os.path.basename(path)
        if name == "metrics.csv":
            results.append(path)
    return results


def load_records(csv_paths: Iterable[str]) -> Tuple[List[Record], List[str]]:
    records: List[Record] = []
    warnings: List[str] = []

    for path in csv_paths:
        with open(path, newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != SCHEMA:
                warnings.append(f"schema mismatch in {path}")
            for row in reader:
                try:
                    timestamp = int((row.get("timestamp") or "").strip())
                except ValueError:
                    warnings.append(f"invalid timestamp in {path}")
                    continue

                values = {field: parse_value(field, row.get(field, "")) for field in NUMERIC_FIELDS}
                records.append(
                    Record(
                        timestamp=timestamp,
                        platform=(row.get("platform") or "").strip(),
                        device=(row.get("device") or "").strip(),
                        process_name=(row.get("process_name") or "").strip(),
                        pid=(row.get("pid") or "").strip(),
                        values=values,
                    )
                )

    return records, warnings


def summarize_per_process(records: List[Record]) -> List[dict]:
    grouped: Dict[Tuple[str, str, str], List[Record]] = defaultdict(list)
    for record in records:
        grouped[(record.platform, record.device, record.process_name)].append(record)

    summaries: List[dict] = []
    for key in sorted(grouped.keys()):
        platform, device, process_name = key
        group_records = grouped[key]
        metrics: Dict[str, dict] = {}
        for field in NUMERIC_FIELDS:
            values = [r.values[field] for r in group_records if r.values[field] is not None]
            stats = summarize([v for v in values if v is not None], field)
            if stats:
                metrics[field] = stats
        summaries.append(
            {
                "platform": platform,
                "device": device,
                "process_name": process_name,
                "samples": len(group_records),
                "metrics": metrics,
            }
        )
    return summaries


def summarize_aggregate(records: List[Record]) -> List[dict]:
    # Aggregate across monitored processes per timestamp per platform/device.
    by_timestamp: Dict[Tuple[str, str, int], Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for record in records:
        key = (record.platform, record.device, record.timestamp)
        for field in NUMERIC_FIELDS:
            value = record.values.get(field)
            if value is not None:
                by_timestamp[key][field] += value

    grouped_series: Dict[Tuple[str, str], Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
    global_series: Dict[str, List[float]] = defaultdict(list)

    for (platform, device, _timestamp), values in sorted(by_timestamp.items()):
        for field in NUMERIC_FIELDS:
            if field in values:
                grouped_series[(platform, device)][field].append(values[field])
                global_series[field].append(values[field])

    rows: List[dict] = []
    for (platform, device), field_map in sorted(grouped_series.items()):
        metrics: Dict[str, dict] = {}
        sample_count = 0
        for field in NUMERIC_FIELDS:
            series = field_map.get(field, [])
            if series:
                sample_count = max(sample_count, len(series))
                metrics[field] = summarize(series, field)
        rows.append(
            {
                "platform": platform,
                "device": device,
                "process_name": "__aggregate__",
                "samples": sample_count,
                "metrics": metrics,
            }
        )

    global_metrics: Dict[str, dict] = {}
    for field in NUMERIC_FIELDS:
        series = global_series.get(field, [])
        if series:
            global_metrics[field] = summarize(series, field)

    rows.append(
        {
            "platform": "all",
            "device": "all",
            "process_name": "__aggregate__",
            "samples": max((len(v) for v in global_series.values()), default=0),
            "metrics": global_metrics,
        }
    )

    return rows


def load_metadata(root: str) -> List[dict]:
    paths = sorted(glob(os.path.join(root, "**", "metadata.json"), recursive=True))
    metadata_entries: List[dict] = []
    for path in paths:
        try:
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
                payload["path"] = path
                metadata_entries.append(payload)
        except Exception as exc:  # noqa: BLE001
            metadata_entries.append({"path": path, "error": str(exc)})
    return metadata_entries


def write_summary_md(path: str, summary: dict) -> None:
    def row(metric: str, stats: dict) -> str:
        return f"| {metric} | {stats.get('min', '')} | {stats.get('median', '')} | {stats.get('max', '')} |"

    lines: List[str] = []
    lines.append("# Telemetry Summary")
    lines.append("")
    lines.append("## Run Metadata")
    lines.append("")
    lines.append(f"- commit_sha: {summary['run_metadata'].get('commit_sha', 'unknown')}")
    lines.append(f"- run_id: {summary['run_metadata'].get('run_id', 'unknown')}")
    lines.append(f"- job_name: {summary['run_metadata'].get('job_name', 'unknown')}")
    lines.append(f"- sampling_interval_sec: {summary['run_metadata'].get('sampling_interval_sec', 'unknown')}")
    lines.append(f"- start_timestamp: {summary['run_metadata'].get('start_timestamp', 'unknown')}")
    lines.append(f"- end_timestamp: {summary['run_metadata'].get('end_timestamp', 'unknown')}")
    lines.append("")

    lines.append("## Per-Process")
    lines.append("")
    for process in summary["per_process"]:
        lines.append(
            f"### {process['platform']} / {process['device']} / {process['process_name']} (samples={process['samples']})"
        )
        lines.append("")
        lines.append("| metric | min | median | max |")
        lines.append("|---|---:|---:|---:|")
        for metric in NUMERIC_FIELDS:
            if metric in process["metrics"]:
                lines.append(row(metric, process["metrics"][metric]))
        lines.append("")

    lines.append("## Aggregate")
    lines.append("")
    for process in summary["aggregate"]:
        lines.append(
            f"### {process['platform']} / {process['device']} / {process['process_name']} (samples={process['samples']})"
        )
        lines.append("")
        lines.append("| metric | min | median | max |")
        lines.append("|---|---:|---:|---:|")
        for metric in NUMERIC_FIELDS:
            if metric in process["metrics"]:
                lines.append(row(metric, process["metrics"][metric]))
        lines.append("")

    lines.append("## Notes")
    lines.append("")
    lines.append("- Capacitor TypeScript executes in WebView V8; growth appears mainly in native/off-heap memory, not only VM heap counters.")
    lines.append("- On Android, compare Dalvik vs Native vs TOTAL PSS trends to separate Java/Kotlin pressure from WebView/native pressure.")
    lines.append("- Correlate telemetry timestamps with Maestro logs using unix UTC seconds.")

    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines).rstrip() + "\n")


def main() -> None:
    out_dir = os.environ.get("TELEMETRY_SUMMARY_DIR", "ci-artifacts/telemetry")
    os.makedirs(out_dir, exist_ok=True)

    input_paths_env = os.environ.get("TELEMETRY_INPUT_CSVS", "").strip()
    if input_paths_env:
        csv_paths = [entry.strip() for entry in input_paths_env.split(",") if entry.strip()]
    else:
        csv_paths = discover_csv_inputs(out_dir)

    if not csv_paths:
        raise SystemExit("telemetry summary: no metrics.csv inputs found")

    records, warnings = load_records(csv_paths)
    if not records:
        for csv_path in csv_paths:
            try:
                with open(csv_path, "r", encoding="utf-8") as handle:
                    line_count = sum(1 for _ in handle)
                print(f"telemetry summary debug: {csv_path} lines={line_count}")
            except OSError as error:
                print(f"telemetry summary debug: failed to count lines in {csv_path}: {error}")
        raise SystemExit("telemetry summary: no telemetry samples in inputs")

    min_ts = min(record.timestamp for record in records)
    max_ts = max(record.timestamp for record in records)

    metadata_entries = load_metadata(out_dir)
    default_meta = {
        "commit_sha": os.environ.get("GITHUB_SHA", "unknown"),
        "run_id": os.environ.get("GITHUB_RUN_ID", "local"),
        "job_name": os.environ.get("GITHUB_JOB", "unknown-job"),
        "sampling_interval_sec": int(os.environ.get("TELEMETRY_INTERVAL_SEC", "1")),
        "start_timestamp": min_ts,
        "end_timestamp": max_ts,
    }

    if metadata_entries:
        first = metadata_entries[0]
        default_meta["commit_sha"] = first.get("commit_sha", default_meta["commit_sha"])
        default_meta["run_id"] = first.get("run_id", default_meta["run_id"])
        default_meta["job_name"] = first.get("job_name", default_meta["job_name"])
        default_meta["sampling_interval_sec"] = first.get(
            "sampling_interval_sec", default_meta["sampling_interval_sec"]
        )

    summary = {
        "run_metadata": default_meta,
        "input_csv_files": sorted(csv_paths),
        "metadata_files": metadata_entries,
        "sample_count": len(records),
        "time_range": {"start_timestamp": min_ts, "end_timestamp": max_ts},
        "warnings": warnings,
        "per_process": summarize_per_process(records),
        "aggregate": summarize_aggregate(records),
    }

    summary_json = os.path.join(out_dir, "summary.json")
    summary_md = os.path.join(out_dir, "summary.md")

    with open(summary_json, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, sort_keys=True)

    write_summary_md(summary_md, summary)

    print(f"telemetry summary: wrote {summary_json}")
    print(f"telemetry summary: wrote {summary_md}")


if __name__ == "__main__":
    main()
