import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { MediaEntry } from "@/lib/media-index";
import {
  buildHvscBrowseIndexFromEntries,
  buildHvscBrowseIndexFromSonglengthSnapshot,
  listFolderFromBrowseIndex,
  listSongsRecursiveFromBrowseIndex,
  streamSongsRecursiveFromBrowseIndex,
} from "@/lib/hvsc/hvscBrowseIndexStore";
import { parseDeletionList } from "@/lib/hvsc/hvscDownload";
import { archiveNameHash } from "@/lib/hvsc/hvscArchiveExtraction";
import { buildPlaylistQueryIndex, queryPlaylistIndex } from "@/lib/playlistRepository/queryIndex";
import type { PlaylistItemRecord, SerializedPlaylistSnapshot, TrackRecord } from "@/lib/playlistRepository/types";

import { summarizeMetric } from "./webPerfSummary.mjs";

type NodePerfProfileName = "smoke" | "nightly" | "manual-extended";

type NodePerfProfile = {
  name: NodePerfProfileName;
  scales: number[];
  samples: number;
  warmups: number;
};

type NodePerfScenarioResult = {
  scenario: string;
  scale: number;
  dataset: Record<string, number | string>;
  thresholdMs: number;
  status: "pass" | "fail";
  durationMs: ReturnType<typeof summarizeMetric>;
  heapUsedMb: ReturnType<typeof summarizeMetric>;
  rssMb: ReturnType<typeof summarizeMetric>;
};

export type NodePerfSummary = {
  generatedAt: string;
  profile: NodePerfProfileName;
  suite: "node-hvsc-data-paths";
  status: "pass" | "fail";
  runtime: Record<string, unknown>;
  scenarios: NodePerfScenarioResult[];
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    return [key, value ?? ""];
  }),
);

export const resolveNodePerfProfile = (profileName?: string): NodePerfProfile => {
  switch (profileName) {
    case "manual-extended":
      return { name: "manual-extended", scales: [10_000, 50_000, 100_000, 150_000], samples: 24, warmups: 2 };
    case "nightly":
      return { name: "nightly", scales: [10_000, 50_000, 100_000], samples: 8, warmups: 1 };
    case "smoke":
    default:
      return { name: "smoke", scales: [10_000, 50_000], samples: 2, warmups: 1 };
  }
};

const resolveNumericOverride = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const resolveScaleOverride = (value: string | undefined, fallback: number[]) => {
  if (!value?.trim()) return fallback;
  const parsed = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.floor(item));
  return parsed.length ? parsed : fallback;
};

const createEntries = (count: number): MediaEntry[] =>
  Array.from({ length: count }, (_, index) => {
    const bucket = String(index % 10);
    const authorIndex = String(index % 250).padStart(3, "0");
    return {
      path: `/MUSICIANS/Composer ${authorIndex}/${bucket}/Track_${String(index).padStart(6, "0")}.sid`,
      name: `Track_${String(index).padStart(6, "0")}.sid`,
      type: "sid",
      durationSeconds: 180 + (index % 120),
    };
  });

const createPlaylistSnapshot = (count: number): SerializedPlaylistSnapshot => {
  const createdAt = "2026-04-26T00:00:00.000Z";
  const tracks: TrackRecord[] = Array.from({ length: count }, (_, index) => ({
    trackId: `track-${index}`,
    sourceKind: "hvsc",
    sourceLocator: `hvsc:/MUSICIANS/Composer ${String(index % 250).padStart(3, "0")}/${String(index % 10)}/Track_${String(index).padStart(6, "0")}.sid`,
    category: "song",
    title: `Track ${String(index).padStart(6, "0")}`,
    author: `Composer ${String(index % 250).padStart(3, "0")}`,
    released: `19${String(80 + (index % 20)).padStart(2, "0")}`,
    path: `/MUSICIANS/Composer ${String(index % 250).padStart(3, "0")}/${String(index % 10)}/Track_${String(index).padStart(6, "0")}.sid`,
    defaultDurationMs: (180 + (index % 120)) * 1000,
    subsongCount: 1,
    createdAt,
    updatedAt: createdAt,
  }));
  const playlistItems: PlaylistItemRecord[] = tracks.map((track, index) => ({
    playlistItemId: `item-${index}`,
    playlistId: "playlist-default",
    trackId: track.trackId,
    songNr: 1,
    sortKey: String(index).padStart(6, "0"),
    status: "ready",
    addedAt: createdAt,
  }));
  return { tracks, playlistItems };
};

const resolveThresholdMs = (scenario: string, scale: number, datasetCount: number) => {
  switch (scenario) {
    case "build-browse-index":
    case "build-songlength-projection":
    case "build-playlist-query-index":
      return Math.round(600 + scale * 0.12);
    case "browse-folder-query":
    case "query-playlist-high-match":
    case "query-playlist-low-match":
    case "query-playlist-zero-match":
      return Math.round(120 + scale * 0.012);
    case "recursive-list":
    case "recursive-stream":
      return Math.round(250 + scale * 0.02);
    case "parse-update-deletions":
      return Math.round(120 + datasetCount * 0.02);
    case "hash-archive-names":
      return Math.round(100 + datasetCount * 0.08);
    case "serialize-playlist-snapshot":
    case "hydrate-playlist-snapshot":
      return Math.round(180 + scale * 0.03);
    default:
      return Math.round(500 + scale * 0.05);
  }
};

const measureSamples = async (samples: number, warmups: number, run: () => Promise<void> | void) => {
  for (let index = 0; index < warmups; index += 1) {
    await run();
  }

  const durationSamples: number[] = [];
  const heapSamples: number[] = [];
  const rssSamples: number[] = [];

  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    await run();
    durationSamples.push(Number((performance.now() - startedAt).toFixed(3)));
    const memoryUsage = process.memoryUsage();
    heapSamples.push(Number((memoryUsage.heapUsed / (1024 * 1024)).toFixed(3)));
    rssSamples.push(Number((memoryUsage.rss / (1024 * 1024)).toFixed(3)));
  }

  return {
    durationMs: summarizeMetric(durationSamples),
    heapUsedMb: summarizeMetric(heapSamples),
    rssMb: summarizeMetric(rssSamples),
  };
};

const getGitValue = (gitArgs: string[]) => {
  const result = spawnSync("git", gitArgs, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
};

const buildRuntimeMetadata = (profile: NodePerfProfileName) => ({
  profile,
  commitSha: process.env.GITHUB_SHA || getGitValue(["rev-parse", "HEAD"]),
  branch: process.env.GITHUB_REF_NAME || getGitValue(["branch", "--show-current"]),
  nodeVersion: process.version,
  npmVersion: process.env.npm_config_user_agent ?? null,
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  cpuModel: os.cpus()[0]?.model ?? null,
  cpuCount: os.cpus().length,
  totalMemoryBytes: os.totalmem(),
});

export const runNodePerfSuite = async (
  options: {
    profile?: NodePerfProfileName;
    scales?: number[];
    samples?: number;
    warmups?: number;
  } = {},
): Promise<NodePerfSummary> => {
  const profile = resolveNodePerfProfile(options.profile);
  const scales = options.scales ?? profile.scales;
  const samples = options.samples ?? profile.samples;
  const warmups = options.warmups ?? profile.warmups;
  const scenarios: NodePerfScenarioResult[] = [];

  for (const scale of scales) {
    const entries = createEntries(scale);
    const browseSnapshot = buildHvscBrowseIndexFromEntries(entries);
    const songlengthSnapshot = {
      pathToSeconds: new Map(entries.map((entry) => [entry.path, [entry.durationSeconds ?? 0]])),
      md5ToSeconds: new Map<string, number[]>(),
    };
    const songlengthProjection = buildHvscBrowseIndexFromSonglengthSnapshot(songlengthSnapshot);
    const recursiveFolderPath = "/MUSICIANS/Composer 042";
    const deletionList = entries
      .slice(0, Math.min(scale, 20_000))
      .map((entry) => entry.path.slice(1))
      .join("\n");
    const archiveNames = entries.slice(0, Math.min(Math.floor(scale / 2), 5_000)).map((entry) => entry.path);
    const playlistSnapshot = createPlaylistSnapshot(scale);
    const tracksById = Object.fromEntries(playlistSnapshot.tracks.map((track) => [track.trackId, track]));
    const playlistIndex = buildPlaylistQueryIndex(playlistSnapshot.playlistItems, tracksById);
    const serializedPlaylist = JSON.stringify(playlistSnapshot);

    const scenarioDefinitions = [
      {
        scenario: "build-browse-index",
        dataset: { entryCount: entries.length },
        run: () => {
          buildHvscBrowseIndexFromEntries(entries);
        },
        datasetCount: entries.length,
      },
      {
        scenario: "build-songlength-projection",
        dataset: { songCount: entries.length },
        run: () => {
          buildHvscBrowseIndexFromSonglengthSnapshot(songlengthSnapshot);
        },
        datasetCount: entries.length,
      },
      {
        scenario: "browse-folder-query",
        dataset: { songCount: entries.length, limit: 200 },
        run: () => {
          listFolderFromBrowseIndex(browseSnapshot, recursiveFolderPath, "track_000", 0, 200);
        },
        datasetCount: entries.length,
      },
      {
        scenario: "recursive-list",
        dataset: { songCount: entries.length },
        run: () => {
          listSongsRecursiveFromBrowseIndex(songlengthProjection, recursiveFolderPath);
        },
        datasetCount: entries.length,
      },
      {
        scenario: "recursive-stream",
        dataset: { songCount: entries.length, chunkSize: 250 },
        run: async () => {
          await streamSongsRecursiveFromBrowseIndex(songlengthProjection, recursiveFolderPath, {
            chunkSize: 250,
            onChunk: () => undefined,
          });
        },
        datasetCount: entries.length,
      },
      {
        scenario: "parse-update-deletions",
        dataset: { deletionCount: Math.min(scale, 20_000) },
        run: () => {
          parseDeletionList(deletionList);
        },
        datasetCount: Math.min(scale, 20_000),
      },
      {
        scenario: "hash-archive-names",
        dataset: { archiveNameCount: archiveNames.length },
        run: () => {
          archiveNames.forEach((archiveName) => archiveNameHash(archiveName));
        },
        datasetCount: archiveNames.length,
      },
      {
        scenario: "build-playlist-query-index",
        dataset: { playlistItems: playlistSnapshot.playlistItems.length },
        run: () => {
          buildPlaylistQueryIndex(playlistSnapshot.playlistItems, tracksById);
        },
        datasetCount: playlistSnapshot.playlistItems.length,
      },
      {
        scenario: "query-playlist-high-match",
        dataset: { playlistItems: playlistSnapshot.playlistItems.length, query: "composer 042" },
        run: () => {
          queryPlaylistIndex(playlistIndex, {
            playlistId: "playlist-default",
            query: "composer 042",
            categoryFilter: ["song"],
            limit: 200,
            offset: 0,
            sort: "playlist-position",
          });
        },
        datasetCount: playlistSnapshot.playlistItems.length,
      },
      {
        scenario: "query-playlist-low-match",
        dataset: { playlistItems: playlistSnapshot.playlistItems.length, query: "track 000042" },
        run: () => {
          queryPlaylistIndex(playlistIndex, {
            playlistId: "playlist-default",
            query: "track 000042",
            categoryFilter: ["song"],
            limit: 200,
            offset: 0,
            sort: "playlist-position",
          });
        },
        datasetCount: playlistSnapshot.playlistItems.length,
      },
      {
        scenario: "query-playlist-zero-match",
        dataset: { playlistItems: playlistSnapshot.playlistItems.length, query: "zzzz-no-match" },
        run: () => {
          queryPlaylistIndex(playlistIndex, {
            playlistId: "playlist-default",
            query: "zzzz-no-match",
            categoryFilter: ["song"],
            limit: 200,
            offset: 0,
            sort: "playlist-position",
          });
        },
        datasetCount: playlistSnapshot.playlistItems.length,
      },
      {
        scenario: "serialize-playlist-snapshot",
        dataset: { playlistItems: playlistSnapshot.playlistItems.length },
        run: () => {
          JSON.stringify(playlistSnapshot);
        },
        datasetCount: playlistSnapshot.playlistItems.length,
      },
      {
        scenario: "hydrate-playlist-snapshot",
        dataset: { playlistItems: playlistSnapshot.playlistItems.length },
        run: () => {
          JSON.parse(serializedPlaylist) as SerializedPlaylistSnapshot;
        },
        datasetCount: playlistSnapshot.playlistItems.length,
      },
    ] as const;

    for (const scenario of scenarioDefinitions) {
      const metrics = await measureSamples(samples, warmups, scenario.run);
      const thresholdMs = resolveThresholdMs(scenario.scenario, scale, scenario.datasetCount);
      scenarios.push({
        scenario: scenario.scenario,
        scale,
        dataset: scenario.dataset,
        thresholdMs,
        status: (metrics.durationMs.p95 ?? Number.POSITIVE_INFINITY) <= thresholdMs ? "pass" : "fail",
        durationMs: metrics.durationMs,
        heapUsedMb: metrics.heapUsedMb,
        rssMb: metrics.rssMb,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    profile: profile.name,
    suite: "node-hvsc-data-paths",
    status: scenarios.every((scenario) => scenario.status === "pass") ? "pass" : "fail",
    runtime: buildRuntimeMetadata(profile.name),
    scenarios,
  };
};

const buildMarkdownSummary = (summary: NodePerfSummary) => {
  const lines = [
    `# HVSC Node Perf Summary (${summary.profile})`,
    "",
    `- Generated: ${summary.generatedAt}`,
    `- Status: ${summary.status}`,
    `- Commit: ${summary.runtime.commitSha ?? "unknown"}`,
    `- Node: ${summary.runtime.nodeVersion}`,
    `- Platform: ${summary.runtime.platform} ${summary.runtime.arch}`,
    "",
    "| Scenario | Scale | p50 ms | p75 ms | p95 ms | p99 ms | Mean ms | Threshold ms | Status |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  summary.scenarios.forEach((scenario) => {
    lines.push(
      `| ${scenario.scenario} | ${scenario.scale} | ${scenario.durationMs.p50 ?? "n/a"} | ${scenario.durationMs.p75 ?? "n/a"} | ${scenario.durationMs.p95 ?? "n/a"} | ${scenario.durationMs.p99 ?? "n/a"} | ${scenario.durationMs.mean ?? "n/a"} | ${scenario.thresholdMs} | ${scenario.status} |`,
    );
  });
  return `${lines.join("\n")}\n`;
};

export const runNodePerfCli = async () => {
  const requestedProfile = (args.get("--profile") || process.env.HVSC_PERF_PROFILE || "smoke") as NodePerfProfileName;
  const profile = resolveNodePerfProfile(requestedProfile);
  const summary = await runNodePerfSuite({
    profile: profile.name,
    scales: resolveScaleOverride(args.get("--scales") || process.env.HVSC_PERF_DATA_SCALES, profile.scales),
    samples: resolveNumericOverride(args.get("--samples") || process.env.HVSC_PERF_DATA_SAMPLES, profile.samples),
    warmups: resolveNumericOverride(args.get("--warmups") || process.env.HVSC_PERF_DATA_WARMUPS, profile.warmups),
  });
  const outFile =
    args.get("--out") ||
    process.env.HVSC_NODE_PERF_SUMMARY_FILE ||
    `ci-artifacts/hvsc-performance/node/node-${summary.profile}.json`;
  const summaryFile =
    args.get("--summary") ||
    process.env.HVSC_NODE_PERF_HUMAN_SUMMARY_FILE ||
    `ci-artifacts/hvsc-performance/node/node-${summary.profile}.md`;

  mkdirSync(path.dirname(outFile), { recursive: true });
  mkdirSync(path.dirname(summaryFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(summary, null, 2), "utf8");
  writeFileSync(summaryFile, buildMarkdownSummary(summary), "utf8");
  process.stdout.write(`${path.resolve(outFile)}\n${path.resolve(summaryFile)}\n`);
  if (summary.status !== "pass") {
    process.exit(1);
  }
};

if (!process.env.VITEST && process.argv[1]?.includes("collect-node-perf.ts")) {
  void runNodePerfCli();
}
