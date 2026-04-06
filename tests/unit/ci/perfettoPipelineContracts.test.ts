import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const readRepoFile = (...parts: string[]) => readFileSync(path.resolve(process.cwd(), ...parts), "utf8");

describe("Perfetto pipeline contracts", () => {
  it("Perfetto config captures sched, ftrace, FrameTimeline, and app atrace", () => {
    const cfg = readRepoFile("ci", "telemetry", "android", "perfetto-hvsc.cfg");
    expect(cfg).toContain("linux.ftrace");
    expect(cfg).toContain("sched/sched_switch");
    expect(cfg).toContain("sched/sched_waking");
    expect(cfg).toContain("power/cpu_frequency");
    expect(cfg).toContain('atrace_categories: "view"');
    expect(cfg).toContain('atrace_categories: "gfx"');
    expect(cfg).toContain('atrace_apps: "uk.gleissner.c64commander"');
    expect(cfg).toContain("linux.process_stats");
    expect(cfg).toContain("linux.sys_stats");
    expect(cfg).toContain("android.log");
  });

  it("Perfetto config buffer is large enough for rich tracing", () => {
    const cfg = readRepoFile("ci", "telemetry", "android", "perfetto-hvsc.cfg");
    const match = cfg.match(/size_kb:\s*(\d+)/);
    expect(match).not.toBeNull();
    const sizeKb = Number(match![1]);
    // At least 32 MiB to hold sched + atrace + process_stats
    expect(sizeKb).toBeGreaterThanOrEqual(32768);
  });

  it("SQL extraction queries exist for all required metric families", () => {
    const sqlDir = path.resolve(process.cwd(), "ci", "telemetry", "android", "perfetto-sql");
    expect(existsSync(sqlDir)).toBe(true);
    const files = readdirSync(sqlDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    // Required query families
    expect(files).toContain("app_trace_sections.sql");
    expect(files).toContain("cpu_usage.sql");
    expect(files).toContain("frame_jank.sql");
    expect(files).toContain("memory_rss.sql");
    expect(files).toContain("scheduling_latency.sql");
  });

  it("SQL queries target the c64commander process", () => {
    const sqlDir = path.resolve(process.cwd(), "ci", "telemetry", "android", "perfetto-sql");
    const files = readdirSync(sqlDir).filter((f) => f.endsWith(".sql"));
    for (const file of files) {
      const sql = readFileSync(path.join(sqlDir, file), "utf8");
      expect(sql).toContain("c64commander");
    }
  });

  it("app_trace_sections query filters for hvsc: prefix", () => {
    const sql = readRepoFile("ci", "telemetry", "android", "perfetto-sql", "app_trace_sections.sql");
    expect(sql).toContain("slice.name LIKE 'hvsc:%'");
  });

  it("extraction script exists and handles missing trace_processor_shell", () => {
    const script = readRepoFile("scripts", "hvsc", "extract-perfetto-metrics.mjs");
    expect(script).toContain("trace_processor_shell");
    expect(script).toContain("no-processor");
    expect(script).toContain("no-trace");
    expect(script).toContain("--trace=");
    expect(script).toContain("--output=");
    expect(script).toContain("--sql-dir=");
  });

  it("runner script streams Perfetto traces locally before extraction", () => {
    const script = readRepoFile("scripts", "run-hvsc-android-benchmark.sh");
    expect(script).toContain("shell 'perfetto --txt -o - -c -'");
    expect(script).toContain('> "$PERFETTO_LOCAL_PATH"');
    expect(script).toContain('2> "$PERFETTO_LOG_PATH"');
    expect(script).toContain('if [[ ! -s "$PERFETTO_LOCAL_PATH" ]]');
    expect(script).toContain("extract-perfetto-metrics.mjs");
    expect(script).toContain("PERFETTO_METRICS_PATH");
    expect(script).toContain("--perfetto-metrics=");
    expect(script).not.toContain('adb -s "$DEVICE_ID" pull "$PERFETTO_REMOTE_PATH"');
  });

  it("summary writer includes Perfetto extraction metadata", () => {
    const script = readRepoFile("scripts", "hvsc", "write-android-perf-summary.mjs");
    expect(script).toContain("perfettoMetricsPath");
    expect(script).toContain("perfettoExtraction");
    expect(script).toContain("appTraceSections");
    expect(script).toContain("frameJank");
  });

  it("androidPerfSummary reports trace-processor-sql extraction mode", () => {
    const script = readRepoFile("scripts", "hvsc", "androidPerfSummary.mjs");
    expect(script).toContain("trace-processor-sql");
    expect(script).toContain("sqlQueriesAvailable");
    expect(script).toContain("jankMetricsAvailable");
  });
});

describe("Kotlin android.os.Trace instrumentation", () => {
  it("HvscArchiveExtractor uses android.os.Trace for key operations", () => {
    const kt = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "uk",
      "gleissner",
      "c64commander",
      "hvsc",
      "HvscArchiveExtractor.kt",
    );
    expect(kt).toContain("import android.os.Trace");
    expect(kt).toContain('Trace.beginSection("hvsc:probe")');
    expect(kt).toContain('Trace.beginSection("hvsc:extract")');
    expect(kt).toContain('Trace.beginSection("hvsc:extract7z")');
    expect(kt).toContain('Trace.beginSection("hvsc:extractZip")');
    expect(kt).toContain('Trace.beginSection("hvsc:materialize")');
    // Every beginSection must have a matching endSection
    const beginCount = (kt.match(/Trace\.beginSection/g) || []).length;
    const endCount = (kt.match(/Trace\.endSection/g) || []).length;
    expect(beginCount).toBe(endCount);
    expect(beginCount).toBeGreaterThanOrEqual(5);
  });

  it("HvscIngestionPlugin uses android.os.Trace for key operations", () => {
    const kt = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "uk",
      "gleissner",
      "c64commander",
      "HvscIngestionPlugin.kt",
    );
    expect(kt).toContain("import android.os.Trace");
    expect(kt).toContain('Trace.beginSection("hvsc:ingestHvsc")');
    expect(kt).toContain('Trace.beginSection("hvsc:flushSongBatch")');
    expect(kt).toContain('Trace.beginSection("hvsc:applyDeletionRows")');
    // Every beginSection must have a matching endSection
    const beginCount = (kt.match(/Trace\.beginSection/g) || []).length;
    const endCount = (kt.match(/Trace\.endSection/g) || []).length;
    expect(beginCount).toBe(endCount);
    expect(beginCount).toBeGreaterThanOrEqual(3);
  });
});
