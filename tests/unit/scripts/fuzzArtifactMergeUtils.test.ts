import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertNoShardLocalArtifactPaths,
  remapMergedIssueExamples,
  removeMergedShardDirectories,
  resolveMergedSessionArtifactPath,
  resolveMergedShardArtifactPath,
} from "../../../scripts/fuzzArtifactMergeUtils.mjs";
import { renderReadme } from "../../../scripts/fuzzReportUtils.mjs";

const tempDirectories = [];

const makeTempDirectory = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "c64commander-fuzz-merge-"));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("resolveMergedShardArtifactPath", () => {
  it("rewrites shard examples to canonical top-level artifact paths", () => {
    expect(resolveMergedShardArtifactPath("videos/session-0001.webm", 2, 4)).toBe("videos/shard-2-session-0001.webm");
    expect(resolveMergedShardArtifactPath("sessions/session-0001.png", 2, 4)).toBe("sessions/shard-2-session-0001.png");
  });

  it("preserves canonical artifact paths when already prefixed", () => {
    expect(resolveMergedShardArtifactPath("videos/shard-1-session-0009.webm", 1, 2)).toBe(
      "videos/shard-1-session-0009.webm",
    );
  });

  it("leaves single-shard artifact paths unchanged", () => {
    expect(resolveMergedShardArtifactPath("videos/session-0001.webm", 0, 1)).toBe("videos/session-0001.webm");
  });
});

describe("resolveMergedSessionArtifactPath", () => {
  it("rewrites session json artifact references to canonical merged paths", () => {
    expect(resolveMergedSessionArtifactPath("sessions/session-0003.log", "sessions/shard-7-session-0003.json", 8)).toBe(
      "sessions/shard-7-session-0003.log",
    );
  });

  it("does not change single-shard session json artifact references", () => {
    expect(resolveMergedSessionArtifactPath("videos/session-0003.webm", "sessions/session-0003.json", 1)).toBe(
      "videos/session-0003.webm",
    );
  });
});

describe("remapMergedIssueExamples", () => {
  it("produces README links that point only at canonical top-level artifacts", () => {
    const examples = remapMergedIssueExamples(
      [
        {
          sessionId: "session-0001",
          video: "videos/session-0001.webm",
          screenshot: "sessions/session-0001.png",
          sessionOffsetMs: 2500,
        },
      ],
      2,
      4,
    );
    const group = {
      issue_group_id: "issue-1",
      signature: {
        exception: "app.log.error",
        message: "Broken artifact path contract",
        topFrames: [],
      },
      severityCounts: { errorLog: 1 },
      platforms: ["android-phone"],
      examples,
    };
    const classificationMap = new Map([
      [
        "issue-1",
        {
          classification: "UNCERTAIN",
          domain: "UNKNOWN",
          confidence: "LOW",
          explanation: null,
        },
      ],
    ]);

    const readme = renderReadme(
      {
        platform: "android-phone",
        shardTotal: 4,
        sessions: 1,
        durationTotalMs: 1000,
      },
      [group],
      classificationMap,
    );

    expect(readme).toContain("videos/shard-2-session-0001.webm");
    expect(readme).toContain("sessions/shard-2-session-0001.png");
    expect(readme).not.toContain("shard-2/videos/session-0001.webm");
    expect(readme).not.toContain("shard-2/sessions/session-0001.png");
    expect(() => assertNoShardLocalArtifactPaths(readme, "README.md")).not.toThrow();
  });

  it("keeps single-shard examples unchanged", () => {
    expect(
      remapMergedIssueExamples(
        [
          {
            video: "videos/session-0001.webm",
            screenshot: "sessions/session-0001.png",
          },
        ],
        0,
        1,
      ),
    ).toEqual([
      {
        video: "videos/session-0001.webm",
        screenshot: "sessions/session-0001.png",
      },
    ]);
  });
});

describe("assertNoShardLocalArtifactPaths", () => {
  it("throws when top-level report content still references shard directories", () => {
    expect(() => assertNoShardLocalArtifactPaths("[video](shard-1/videos/session-0001.webm)", "README.md")).toThrow(
      /README.md contains shard-local artifact paths/,
    );
  });

  it("rejects shard-directory prefix but accepts canonical shard-filename prefix", () => {
    const brokenPath = `shard-0/videos/session-0001.webm`;
    const canonicalPath = resolveMergedShardArtifactPath("videos/session-0001.webm", 0, 2);
    expect(canonicalPath).toBe("videos/shard-0-session-0001.webm");
    expect(() => assertNoShardLocalArtifactPaths(brokenPath, "example")).toThrow(/shard-local artifact paths/);
    expect(() => assertNoShardLocalArtifactPaths(canonicalPath, "example")).not.toThrow();
  });
});

describe("removeMergedShardDirectories", () => {
  it("removes shard directories after successful multi-shard consolidation", async () => {
    const outputRoot = await makeTempDirectory();
    await fs.mkdir(path.join(outputRoot, "sessions"), { recursive: true });
    await fs.mkdir(path.join(outputRoot, "videos"), { recursive: true });
    await fs.writeFile(path.join(outputRoot, "sessions", "shard-0-session-0001.json"), "{}", "utf8");
    await fs.writeFile(path.join(outputRoot, "videos", "shard-0-session-0001.webm"), "video", "utf8");
    await fs.mkdir(path.join(outputRoot, "shard-0", "sessions"), {
      recursive: true,
    });
    await fs.mkdir(path.join(outputRoot, "shard-1", "videos"), {
      recursive: true,
    });
    await fs.writeFile(path.join(outputRoot, "shard-0", "README.md"), "old shard readme", "utf8");
    await fs.writeFile(path.join(outputRoot, "shard-1", "fuzz-issue-report.json"), "{}", "utf8");

    const removed = await removeMergedShardDirectories(outputRoot, 2);

    expect(removed).toHaveLength(2);
    await expect(fs.stat(path.join(outputRoot, "shard-0"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.stat(path.join(outputRoot, "shard-1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.readFile(path.join(outputRoot, "sessions", "shard-0-session-0001.json"), "utf8")).resolves.toBe(
      "{}",
    );
    await expect(fs.readFile(path.join(outputRoot, "videos", "shard-0-session-0001.webm"), "utf8")).resolves.toBe(
      "video",
    );
  });

  it("does nothing for single-shard runs", async () => {
    const outputRoot = await makeTempDirectory();
    await fs.mkdir(path.join(outputRoot, "shard-0"), { recursive: true });

    const removed = await removeMergedShardDirectories(outputRoot, 1);

    expect(removed).toEqual([]);
    await expect(fs.stat(path.join(outputRoot, "shard-0"))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });
});
